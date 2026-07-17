from __future__ import annotations

import argparse
import hashlib
import json
import sys
import traceback
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from string import Formatter
from typing import Any, Sequence

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.privacy_filter_adapter import (
    DEFAULT_PRIVACY_FILTER_SOURCE,
    KOELECTRA_PRIVACY_NER_SOURCE,
    public_model_id_for_model,
    source_for_model,
)
from app.core.config import Settings, load_settings
from app.domain.ai_safety_eval.master_corpus import (
    ALLOWED_DETECTOR_TYPES,
    MasterEvalCase,
    MasterEvalError,
    load_master_eval_corpus,
)
from app.domain.safety_eval.report import scan_text_for_forbidden_sensitive_values
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AiSafetyDetectRequest,
    AiSafetyDetectorConfig,
    AiSafetyDetectorInput,
    SafetyDetector,
)
from app.schemas.safety_eval import SafetyEvalError
from app.services.ai_safety_detector import AiSafetyDetectorService


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CORPUS_PATH = REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "master-safety-eval-corpus.jsonl"
REPORT_VERSION = "master-corpus-eval-report.v2"
ACTUAL_SOURCE_CONFIGURED_MODEL = "configured-model"
ACTUAL_SOURCE_NOOP_TEST = "fast-rules-noop-ml"
ACTUAL_SOURCE_RULES_ONLY = "rules-only"
MODEL_PROFILE_CONFIGURED = "configured"
MODEL_PROFILE_RULES_ONLY = "rules-only"
MODEL_PROFILE_RULES_OPENAI = "rules-openai"
MODEL_PROFILE_RULES_KOELECTRA = "rules-koelectra"
MODEL_PROFILE_RULES_BOTH = "rules-both"
MODEL_PROFILES = (
    MODEL_PROFILE_CONFIGURED,
    MODEL_PROFILE_RULES_ONLY,
    MODEL_PROFILE_RULES_OPENAI,
    MODEL_PROFILE_RULES_KOELECTRA,
    MODEL_PROFILE_RULES_BOTH,
)
SCREENING_SUBSET_VERSION = "pii-model-screening-subset.v1"
SCREENING_SUBSET_MIN_CASES = 80
SCREENING_SUBSET_MAX_CASES = 120
MODEL_LOAD_PROBE_TEXT = "Synthetic Person at Synthetic Organization needs privacy review."
REDACT_DETECTOR_TYPES = frozenset(
    {
        "account_id",
        "customer_id",
        "date_of_birth",
        "email",
        "employee_id",
        "ip_address",
        "organization_name",
        "person_name",
        "phone_number",
        "postal_address",
        "private_date",
        "private_url",
    }
)
OUTCOME_RANK = {"passed": 0, "redacted": 1, "blocked": 2, "error": 3}


@dataclass(frozen=True)
class ActualDetectorResult:
    outcome: str
    detected_types: tuple[str, ...]
    detected_count: int
    block_reason: str | None
    latency_ms: int | None = None
    error_code: str | None = None
    execution_mode: str = "rules_only"
    model_invocation_count: int = 0
    accepted_model_detection_count: int = 0
    detected_counts_by_type: dict[str, int] = field(default_factory=dict)
    model_contributions_by_source_and_type: dict[str, dict[str, int]] = field(default_factory=dict)


@dataclass
class AdapterEvalRecorder:
    """Evaluation-only adapter proxy that records bounded aggregate counters."""

    adapter: PrivacyFilterAdapter
    detect_many_calls: int = 0
    input_window_count: int = 0
    model_invocation_count: int = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self.adapter, name)

    def detect_many(self, texts: list[str], *, batch_size: int = 4) -> Any:
        result = self.adapter.detect_many(texts, batch_size=batch_size)
        self.detect_many_calls += 1
        self.input_window_count += len(texts)
        self.model_invocation_count += result.model_invocation_count
        return result

    def reset(self) -> None:
        self.detect_many_calls = 0
        self.input_window_count = 0
        self.model_invocation_count = 0


@dataclass
class DetectorStats:
    detector_type: str
    expected_positive_cases: int = 0
    actual_positive_cases: int = 0
    true_positive_cases: int = 0
    false_positive_cases: int = 0
    false_negative_cases: int = 0
    true_negative_cases: int = 0

    @property
    def precision(self) -> float | None:
        denominator = self.true_positive_cases + self.false_positive_cases
        if denominator == 0:
            return None
        return self.true_positive_cases / denominator

    @property
    def recall(self) -> float | None:
        denominator = self.true_positive_cases + self.false_negative_cases
        if denominator == 0:
            return None
        return self.true_positive_cases / denominator

    def to_report(self) -> dict[str, Any]:
        return {
            "detectorType": self.detector_type,
            "expectedPositiveCases": self.expected_positive_cases,
            "actualPositiveCases": self.actual_positive_cases,
            "truePositiveCases": self.true_positive_cases,
            "falsePositiveCases": self.false_positive_cases,
            "falseNegativeCases": self.false_negative_cases,
            "trueNegativeCases": self.true_negative_cases,
            "precision": round(self.precision, 6) if self.precision is not None else None,
            "recall": round(self.recall, 6) if self.recall is not None else None,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate the AI Safety Lab master corpus against ai-service detector output.")
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS_PATH,
        help="Path to master-safety-eval-corpus.jsonl.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        required=True,
        help="Output directory for JSON and Markdown reports.",
    )
    parser.add_argument(
        "--subset-manifest",
        type=Path,
        default=None,
        help="Optional case-ID-only screening subset manifest bound to the source corpus checksum.",
    )
    parser.add_argument(
        "--model-profile",
        choices=MODEL_PROFILES,
        default=MODEL_PROFILE_CONFIGURED,
        help="Evaluation model profile. Explicit ablation profiles fail when the configured local model is absent.",
    )
    parser.add_argument(
        "--no-fail-on-mismatch",
        action="store_true",
        help="Return exit code 0 even when evaluation cases fail.",
    )
    parser.add_argument(
        "--ml-min-confidence",
        type=float,
        default=None,
        help="Optional evaluation-only ML confidence threshold override applied to every detector type.",
    )
    parser.add_argument(
        "--ml-detector-threshold",
        action="append",
        default=[],
        metavar="DETECTOR=VALUE",
        help="Evaluation-only ML confidence threshold override for one detector type. Can be repeated or comma-separated.",
    )
    parser.add_argument(
        "--ml-allowed-detector-type",
        action="append",
        default=[],
        metavar="DETECTOR",
        help="Allow ML detections only for these detector types. Can be repeated or comma-separated.",
    )
    parser.add_argument(
        "--strict-security-scan",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Fail if generated reports include forbidden raw sensitive values.",
    )
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        ml_detector_thresholds = parse_ml_detector_thresholds(args.ml_detector_threshold)
        ml_allowed_detector_types = parse_ml_allowed_detector_types(args.ml_allowed_detector_type)
        cases = load_master_eval_corpus(args.corpus)
        subset_metadata = None
        if args.subset_manifest is not None:
            cases, subset_metadata = load_screening_subset(
                args.subset_manifest,
                corpus_path=args.corpus,
                cases=cases,
            )
        service, actual_source = build_detector_service_for_profile(
            args.model_profile,
            ml_min_confidence=args.ml_min_confidence,
            ml_detector_thresholds=ml_detector_thresholds,
            ml_allowed_detector_types=ml_allowed_detector_types,
        )
        force_load_detector_models(service)
        report = evaluate_master_corpus(
            cases,
            service=service,
            corpus_path=args.corpus,
            actual_source=actual_source,
            screening_subset=subset_metadata,
        )
        json_path, markdown_path = write_reports(report, args.out, strict_security_scan=args.strict_security_scan)
    except (MasterEvalError, SafetyEvalError, OSError, UnicodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    summary = report["summary"]
    print(
        "master corpus eval completed: "
        f"{summary['passedCases']}/{summary['totalCases']} passed, "
        f"failed={summary['failedCases']}, "
        f"json={json_path}, markdown={markdown_path}"
    )
    if summary["failedCases"] and not args.no_fail_on_mismatch:
        return 1
    return 0


def build_detector_service(
    actual_source: str = ACTUAL_SOURCE_CONFIGURED_MODEL,
    *,
    settings: Settings | None = None,
    ml_min_confidence: float | None = None,
    ml_detector_thresholds: dict[str, float] | None = None,
    ml_allowed_detector_types: frozenset[str] | None = None,
) -> AiSafetyDetectorService:
    detectors = build_master_detector_config()
    if actual_source == ACTUAL_SOURCE_RULES_ONLY:
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda _text: [],
                model_name="rules-only-eval",
                source="rules_only_eval",
                label_map={},
            ),
            detectors=detectors,
        )
        return service
    if actual_source == ACTUAL_SOURCE_NOOP_TEST:
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
            detectors=detectors,
        )
        apply_ml_eval_policy(
            service,
            ml_min_confidence=ml_min_confidence,
            ml_detector_thresholds=ml_detector_thresholds,
            ml_allowed_detector_types=ml_allowed_detector_types,
        )
        return service
    if actual_source != ACTUAL_SOURCE_CONFIGURED_MODEL:
        raise SafetyEvalError(f"unsupported actual source {actual_source!r}")

    resolved_settings = settings or load_settings()
    service = AiSafetyDetectorService(
        model_id=resolved_settings.ai_safety_detector_model_id,
        additional_model_ids=resolved_settings.ai_safety_additional_detector_model_ids,
        detectors=detectors,
        detector_runtime=resolved_settings.ai_safety_detector_runtime,
    )
    apply_ml_eval_policy(
        service,
        ml_min_confidence=ml_min_confidence,
        ml_detector_thresholds=ml_detector_thresholds,
        ml_allowed_detector_types=ml_allowed_detector_types,
    )
    return service


def build_detector_service_for_profile(
    model_profile: str,
    *,
    settings: Settings | None = None,
    ml_min_confidence: float | None = None,
    ml_detector_thresholds: dict[str, float] | None = None,
    ml_allowed_detector_types: frozenset[str] | None = None,
) -> tuple[AiSafetyDetectorService, str]:
    if model_profile == MODEL_PROFILE_RULES_ONLY:
        return (
            build_detector_service(ACTUAL_SOURCE_RULES_ONLY),
            MODEL_PROFILE_RULES_ONLY,
        )
    if model_profile not in MODEL_PROFILES:
        raise SafetyEvalError(f"unsupported model profile {model_profile!r}")

    resolved_settings = settings or load_settings()
    if model_profile != MODEL_PROFILE_CONFIGURED:
        resolved_settings = settings_for_model_profile(resolved_settings, model_profile)
    service = build_detector_service(
        ACTUAL_SOURCE_CONFIGURED_MODEL,
        settings=resolved_settings,
        ml_min_confidence=ml_min_confidence,
        ml_detector_thresholds=ml_detector_thresholds,
        ml_allowed_detector_types=ml_allowed_detector_types,
    )
    actual_source = (
        ACTUAL_SOURCE_CONFIGURED_MODEL
        if model_profile == MODEL_PROFILE_CONFIGURED
        else model_profile
    )
    return service, actual_source


def settings_for_model_profile(settings: Settings, model_profile: str) -> Settings:
    model_ids_by_source = configured_model_ids_by_source(settings)
    openai_model_id = model_ids_by_source.get(DEFAULT_PRIVACY_FILTER_SOURCE)
    koelectra_model_id = model_ids_by_source.get(KOELECTRA_PRIVACY_NER_SOURCE)

    if model_profile == MODEL_PROFILE_RULES_OPENAI:
        if openai_model_id is None:
            raise SafetyEvalError("rules-openai profile requires a configured OpenAI privacy-filter model")
        selected = (openai_model_id,)
    elif model_profile == MODEL_PROFILE_RULES_KOELECTRA:
        if koelectra_model_id is None:
            raise SafetyEvalError("rules-koelectra profile requires a configured KoELECTRA model")
        selected = (koelectra_model_id,)
    elif model_profile == MODEL_PROFILE_RULES_BOTH:
        if openai_model_id is None or koelectra_model_id is None:
            raise SafetyEvalError("rules-both profile requires configured OpenAI and KoELECTRA models")
        selected = (openai_model_id, koelectra_model_id)
    else:
        raise SafetyEvalError(f"unsupported explicit model profile {model_profile!r}")

    return replace(
        settings,
        ai_safety_detector_model_id=selected[0],
        ai_safety_additional_detector_model_ids=tuple(selected[1:]),
    )


def configured_model_ids_by_source(settings: Settings) -> dict[str, str]:
    model_ids_by_source: dict[str, str] = {}
    for model_id in (
        settings.ai_safety_detector_model_id,
        *settings.ai_safety_additional_detector_model_ids,
    ):
        source = source_for_model(model_id)
        if source not in {DEFAULT_PRIVACY_FILTER_SOURCE, KOELECTRA_PRIVACY_NER_SOURCE}:
            continue
        previous = model_ids_by_source.get(source)
        if previous is not None and previous != model_id:
            raise SafetyEvalError(f"multiple configured model ids resolve to source {source!r}")
        model_ids_by_source[source] = model_id
    return model_ids_by_source


def load_screening_subset(
    manifest_path: Path,
    *,
    corpus_path: Path,
    cases: list[MasterEvalCase],
) -> tuple[list[MasterEvalCase], dict[str, Any]]:
    if not manifest_path.is_file():
        raise MasterEvalError(f"screening subset manifest not found: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise MasterEvalError(f"screening subset manifest JSON parse failed: {exc}") from exc
    if not isinstance(manifest, dict) or set(manifest) != {
        "schemaVersion",
        "sourceCorpus",
        "selection",
        "caseIds",
    }:
        raise MasterEvalError("screening subset manifest fields mismatch")
    if manifest["schemaVersion"] != SCREENING_SUBSET_VERSION:
        raise MasterEvalError("screening subset manifest version mismatch")

    source_corpus = manifest["sourceCorpus"]
    if not isinstance(source_corpus, dict) or set(source_corpus) != {"sha256", "caseCount"}:
        raise MasterEvalError("screening subset sourceCorpus fields mismatch")
    expected_digest = source_corpus["sha256"]
    if (
        not isinstance(expected_digest, str)
        or len(expected_digest) != 64
        or any(char not in "0123456789abcdef" for char in expected_digest)
    ):
        raise MasterEvalError("screening subset source corpus sha256 is invalid")
    actual_digest = hashlib.sha256(corpus_path.read_bytes()).hexdigest()
    if actual_digest != expected_digest:
        raise MasterEvalError("screening subset source corpus checksum mismatch")
    if source_corpus["caseCount"] != len(cases):
        raise MasterEvalError("screening subset source corpus case count mismatch")

    case_ids = manifest["caseIds"]
    if not isinstance(case_ids, list) or not all(isinstance(case_id, str) for case_id in case_ids):
        raise MasterEvalError("screening subset caseIds must be a string array")
    if not SCREENING_SUBSET_MIN_CASES <= len(case_ids) <= SCREENING_SUBSET_MAX_CASES:
        raise MasterEvalError("screening subset case count must be between 80 and 120")
    if len(case_ids) != len(set(case_ids)):
        raise MasterEvalError("screening subset caseIds must be unique")
    cases_by_id = {case.case_id: case for case in cases}
    missing_case_ids = sorted(set(case_ids) - set(cases_by_id))
    if missing_case_ids:
        raise MasterEvalError(f"screening subset contains unknown case ids: {missing_case_ids!r}")
    selected_cases = [cases_by_id[case_id] for case_id in case_ids]

    selection = manifest["selection"]
    expected_selection_fields = {
        "syntheticOnly",
        "caseCount",
        "localeCounts",
        "outcomeCounts",
        "riskFalsePositiveCases",
        "riskFalseNegativeCases",
    }
    if not isinstance(selection, dict) or set(selection) != expected_selection_fields:
        raise MasterEvalError("screening subset selection fields mismatch")
    if selection["syntheticOnly"] is not True or selection["caseCount"] != len(selected_cases):
        raise MasterEvalError("screening subset selection metadata mismatch")
    locale_counts = dict(sorted(Counter(case.locale for case in selected_cases).items()))
    outcome_counts = dict(
        sorted(Counter(case.expectations.detector.outcome for case in selected_cases).items())
    )
    risk_false_positive_cases = sum(
        1 for case in selected_cases if "risk-false-positive" in case.tags
    )
    risk_false_negative_cases = sum(
        1 for case in selected_cases if "risk-false-negative" in case.tags
    )
    if selection["localeCounts"] != locale_counts:
        raise MasterEvalError("screening subset locale counts mismatch")
    if selection["outcomeCounts"] != outcome_counts:
        raise MasterEvalError("screening subset outcome counts mismatch")
    if selection["riskFalsePositiveCases"] != risk_false_positive_cases:
        raise MasterEvalError("screening subset false-positive risk count mismatch")
    if selection["riskFalseNegativeCases"] != risk_false_negative_cases:
        raise MasterEvalError("screening subset false-negative risk count mismatch")

    return selected_cases, {
        "schemaVersion": SCREENING_SUBSET_VERSION,
        "sourceCorpusSha256": actual_digest,
        "caseCount": len(selected_cases),
        "syntheticOnly": True,
        "localeCounts": locale_counts,
        "outcomeCounts": outcome_counts,
        "riskFalsePositiveCases": risk_false_positive_cases,
        "riskFalseNegativeCases": risk_false_negative_cases,
    }


def force_load_detector_models(service: AiSafetyDetectorService) -> None:
    try:
        for adapter in service.adapters:
            adapter.detect(MODEL_LOAD_PROBE_TEXT)
    except Exception as exc:
        raise SafetyEvalError("configured detector model load failed") from exc


def apply_ml_eval_policy(
    service: AiSafetyDetectorService,
    *,
    ml_min_confidence: float | None,
    ml_detector_thresholds: dict[str, float] | None,
    ml_allowed_detector_types: frozenset[str] | None,
) -> None:
    normalized_default = (
        normalize_ml_confidence_threshold(ml_min_confidence)
        if ml_min_confidence is not None
        else None
    )
    normalized_overrides = {
        detector_type: normalize_ml_confidence_threshold(threshold)
        for detector_type, threshold in (ml_detector_thresholds or {}).items()
    }
    for adapter in service.adapters:
        if normalized_default is not None:
            adapter.min_confidence = normalized_default
            by_type = {detector_type: normalized_default for detector_type in ALLOWED_DETECTOR_TYPES}
        else:
            by_type = dict(adapter.min_confidence_by_detector_type)
        by_type.update(normalized_overrides)
        adapter.min_confidence_by_detector_type = by_type
        if ml_allowed_detector_types is not None:
            adapter.label_map = {
                label: detector_type
                for label, detector_type in adapter.label_map.items()
                if detector_type in ml_allowed_detector_types
            }


def normalize_ml_confidence_threshold(threshold: float) -> float:
    if not 0 <= threshold <= 1:
        raise SafetyEvalError("ml confidence threshold must be between 0 and 1")
    return round(float(threshold), 6)


def parse_ml_detector_thresholds(values: Sequence[str]) -> dict[str, float]:
    thresholds: dict[str, float] = {}
    for item in split_cli_csv_values(values):
        detector_type, separator, raw_threshold = item.partition("=")
        detector_type = detector_type.strip()
        raw_threshold = raw_threshold.strip()
        if separator == "" or detector_type == "" or raw_threshold == "":
            raise SafetyEvalError("ml detector threshold must use DETECTOR=VALUE")
        if detector_type not in ALLOWED_DETECTOR_TYPES:
            raise SafetyEvalError(f"unknown ml detector threshold type {detector_type!r}")
        try:
            thresholds[detector_type] = normalize_ml_confidence_threshold(float(raw_threshold))
        except ValueError as exc:
            raise SafetyEvalError(f"invalid ml detector threshold for {detector_type!r}") from exc
    return thresholds


def parse_ml_allowed_detector_types(values: Sequence[str]) -> frozenset[str] | None:
    detector_types = set(split_cli_csv_values(values))
    if not detector_types:
        return None
    unknown = sorted(detector_types - set(ALLOWED_DETECTOR_TYPES))
    if unknown:
        raise SafetyEvalError(f"unknown ml allowed detector types {unknown!r}")
    return frozenset(detector_types)


def split_cli_csv_values(values: Sequence[str]) -> list[str]:
    items: list[str] = []
    for value in values:
        items.extend(item.strip() for item in value.split(",") if item.strip())
    return items


def build_master_detector_config() -> tuple[SafetyDetector, ...]:
    return tuple(
        SafetyDetector(
            type=detector_type,
            enabled=True,
            action="redact" if detector_type in REDACT_DETECTOR_TYPES else "block",
            placeholder=f"[{detector_type.upper()}_REDACTED]",
        )
        for detector_type in sorted(ALLOWED_DETECTOR_TYPES)
    )


def instrument_detector_service(
    service: AiSafetyDetectorService,
) -> tuple[AdapterEvalRecorder, ...]:
    recorders: list[AdapterEvalRecorder] = []
    for adapter in service.adapters:
        if isinstance(adapter, AdapterEvalRecorder):
            recorder = adapter
            recorder.reset()
        else:
            recorder = AdapterEvalRecorder(adapter=adapter)
        recorders.append(recorder)
    sources = [recorder.source for recorder in recorders]
    if len(sources) != len(set(sources)):
        raise SafetyEvalError("evaluation adapter sources must be unique")
    service.adapters = tuple(recorders)  # type: ignore[assignment]
    service.adapter = recorders[0]  # type: ignore[assignment]
    return tuple(recorders)


def evaluate_master_corpus(
    cases: list[MasterEvalCase],
    *,
    service: AiSafetyDetectorService,
    corpus_path: Path,
    actual_source: str,
    generated_at: datetime | None = None,
    screening_subset: dict[str, Any] | None = None,
) -> dict[str, Any]:
    recorders = instrument_detector_service(service)
    detector_stats = {detector_type: DetectorStats(detector_type) for detector_type in sorted(ALLOWED_DETECTOR_TYPES)}
    outcome_confusion: dict[str, dict[str, int]] = {}
    case_reports: list[dict[str, Any]] = []
    execution_mode_cases: Counter[str] = Counter()
    contribution_counts: Counter[tuple[str, str]] = Counter()
    contributed_cases_by_source: Counter[str] = Counter()
    response_model_invocation_count = 0
    response_accepted_model_detection_count = 0
    generated = generated_at or datetime.now(tz=timezone.utc)

    for case in cases:
        actual = run_detector(case, service)
        case_report = evaluate_case(case, actual, detector_stats)
        case_reports.append(case_report)
        expected_outcome = case.expectations.detector.outcome
        outcome_confusion.setdefault(expected_outcome, {})
        outcome_confusion[expected_outcome][actual.outcome] = (
            outcome_confusion[expected_outcome].get(actual.outcome, 0) + 1
        )
        execution_mode_cases[actual.execution_mode] += 1
        response_model_invocation_count += actual.model_invocation_count
        response_accepted_model_detection_count += actual.accepted_model_detection_count
        for source, counts_by_type in actual.model_contributions_by_source_and_type.items():
            source_contributed = False
            for detector_type, count in counts_by_type.items():
                contribution_counts[(source, detector_type)] += count
                source_contributed = source_contributed or count > 0
            if source_contributed:
                contributed_cases_by_source[source] += 1

    passed = sum(1 for case_report in case_reports if case_report["outcome"] == "pass")
    total = len(case_reports)
    failed = total - passed
    summary = {
        "totalCases": total,
        "passedCases": passed,
        "failedCases": failed,
        "passRate": round(passed / total, 6) if total else None,
        "falsePositiveCases": sum(1 for case_report in case_reports if case_report["classification"]["falsePositive"]),
        "falseNegativeCases": sum(1 for case_report in case_reports if case_report["classification"]["falseNegative"]),
        "outcomeMismatchCases": sum(1 for case_report in case_reports if "outcome_mismatch" in case_report["mismatchReasons"]),
        "detectedTypesMismatchCases": sum(
            1 for case_report in case_reports if "detected_types_mismatch" in case_report["mismatchReasons"]
        ),
        "detectedCountMismatchCases": sum(
            1 for case_report in case_reports if "detected_count_mismatch" in case_report["mismatchReasons"]
        ),
        "errorCases": sum(1 for case_report in case_reports if case_report["actual"]["outcome"] == "error"),
    }
    corpus_report: dict[str, Any] = {"path": str(corpus_path)}
    if screening_subset is not None:
        corpus_report["screeningSubset"] = screening_subset
    adapter_stats = build_adapter_eval_stats(
        recorders,
        contribution_counts=contribution_counts,
        contributed_cases_by_source=contributed_cases_by_source,
    )
    recorder_model_invocation_count = sum(
        recorder.model_invocation_count for recorder in recorders
    )
    recorded_accepted_model_detection_count = sum(contribution_counts.values())
    return {
        "reportVersion": REPORT_VERSION,
        "generatedAt": generated.isoformat().replace("+00:00", "Z"),
        "corpus": corpus_report,
        "actualSource": {
            "kind": actual_source,
            "modelLoadPolicy": "required-before-evaluation",
            "adapterLoadStates": dict(sorted(Counter(adapter.load_state for adapter in service.adapters).items())),
            "adapterStats": adapter_stats,
            "mlMinConfidence": ml_min_confidence_summary(service),
            "mlDetectorThresholds": ml_detector_threshold_summary(service),
            "mlAllowedDetectorTypes": ml_allowed_detector_type_summary(service),
            "rawPromptStored": False,
            "rawDetectedValueStored": False,
            "redactedPromptStored": False,
        },
        "modelExecution": {
            "executionModeCases": dict(sorted(execution_mode_cases.items())),
            "responseModelInvocationCount": response_model_invocation_count,
            "recordedModelInvocationCount": recorder_model_invocation_count,
            "modelInvocationAccountingMatched": (
                response_model_invocation_count == recorder_model_invocation_count
            ),
            "responseAcceptedModelDetectionCount": response_accepted_model_detection_count,
            "recordedAcceptedModelDetectionCount": recorded_accepted_model_detection_count,
            "acceptedDetectionAccountingMatched": (
                response_accepted_model_detection_count
                == recorded_accepted_model_detection_count
            ),
        },
        "summary": summary,
        "outcomeConfusion": outcome_confusion,
        "detectors": [stats.to_report() for stats in detector_stats.values()],
        "cases": case_reports,
    }


def build_adapter_eval_stats(
    recorders: tuple[AdapterEvalRecorder, ...],
    *,
    contribution_counts: Counter[tuple[str, str]],
    contributed_cases_by_source: Counter[str],
) -> list[dict[str, Any]]:
    stats: list[dict[str, Any]] = []
    for recorder in recorders:
        accepted_by_detector_type = {
            detector_type: count
            for (source, detector_type), count in sorted(contribution_counts.items())
            if source == recorder.source and count > 0
        }
        stats.append(
            {
                "modelId": public_model_id_for_model(recorder.model_name),
                "source": recorder.source,
                "runtime": recorder.runtime,
                "loadState": recorder.load_state,
                "supportedDetectorTypes": sorted(recorder.supported_detector_types),
                "detectManyCalls": recorder.detect_many_calls,
                "inputWindowCount": recorder.input_window_count,
                "modelInvocationCount": recorder.model_invocation_count,
                "acceptedDetectionCount": sum(accepted_by_detector_type.values()),
                "acceptedDetectionsByDetectorType": accepted_by_detector_type,
                "contributedCases": contributed_cases_by_source[recorder.source],
            }
        )
    return stats


def ml_min_confidence_summary(service: AiSafetyDetectorService) -> float | str:
    thresholds = {round(float(adapter.min_confidence), 6) for adapter in service.adapters}
    if len(thresholds) == 1:
        return next(iter(thresholds))
    return "mixed"


def ml_detector_threshold_summary(service: AiSafetyDetectorService) -> dict[str, float | str]:
    summary: dict[str, float | str] = {}
    for detector_type in sorted(ALLOWED_DETECTOR_TYPES):
        thresholds = {
            round(float(adapter.min_confidence_by_detector_type.get(detector_type, adapter.min_confidence)), 6)
            for adapter in service.adapters
        }
        summary[detector_type] = next(iter(thresholds)) if len(thresholds) == 1 else "mixed"
    return summary


def ml_allowed_detector_type_summary(service: AiSafetyDetectorService) -> list[str]:
    detector_types: set[str] = set()
    for adapter in service.adapters:
        detector_types.update(str(detector_type) for detector_type in adapter.label_map.values())
    return sorted(detector_types)


def run_detector(case: MasterEvalCase, service: AiSafetyDetectorService) -> ActualDetectorResult:
    prompt = render_detector_eval_prompt(case)
    try:
        response = service.detect(
            AiSafetyDetectRequest(
                contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
                input=AiSafetyDetectorInput(promptText=prompt, locale=case.locale),
                detectorConfig=AiSafetyDetectorConfig(returnConfidence=False),
            )
        )
    except Exception as exc:
        print(f"detector runtime error for case {case.case_id}: {exc}", file=sys.stderr)
        traceback.print_exception(type(exc), exc, exc.__traceback__, file=sys.stderr)
        return ActualDetectorResult(
            outcome="error",
            detected_types=(),
            detected_count=0,
            block_reason=None,
            error_code="detector_runtime_error",
        )
    detected_counts_by_type = dict(
        sorted(Counter(detection.detector_type for detection in response.detections).items())
    )
    model_sources = {adapter.source for adapter in service.adapters}
    model_contribution_counts: Counter[tuple[str, str]] = Counter(
        (detection.source, detection.detector_type)
        for detection in response.detections
        if detection.source in model_sources
    )
    model_contributions_by_source_and_type: dict[str, dict[str, int]] = {}
    for (source, detector_type), count in sorted(model_contribution_counts.items()):
        model_contributions_by_source_and_type.setdefault(source, {})[detector_type] = count
    return ActualDetectorResult(
        outcome=response.outcome,
        detected_types=tuple(sorted(response.detector_summary.detector_categories)),
        detected_count=response.detector_summary.detected_count,
        block_reason="sensitive_data_blocked" if response.outcome == "blocked" else None,
        latency_ms=response.latency_ms,
        execution_mode=response.execution_summary.execution_mode,
        model_invocation_count=response.execution_summary.model_invocation_count,
        accepted_model_detection_count=(
            response.execution_summary.accepted_model_detection_count
        ),
        detected_counts_by_type=detected_counts_by_type,
        model_contributions_by_source_and_type=model_contributions_by_source_and_type,
    )


def evaluate_case(
    case: MasterEvalCase,
    actual: ActualDetectorResult,
    detector_stats: dict[str, DetectorStats],
) -> dict[str, Any]:
    expected = case.expectations.detector
    expected_types = set(expected.detected_types)
    actual_types = set(actual.detected_types)
    missing_types = sorted(expected_types - actual_types)
    extra_types = sorted(actual_types - expected_types)
    mismatch_reasons: list[str] = []

    if expected.outcome != actual.outcome:
        mismatch_reasons.append("outcome_mismatch")
    if missing_types or extra_types:
        mismatch_reasons.append("detected_types_mismatch")
    if expected.detected_count != actual.detected_count:
        mismatch_reasons.append("detected_count_mismatch")
    if expected.block_reason != actual.block_reason:
        mismatch_reasons.append("block_reason_mismatch")
    if actual.error_code is not None:
        mismatch_reasons.append(actual.error_code)

    for detector_type, stats in detector_stats.items():
        expected_positive = detector_type in expected_types
        actual_positive = detector_type in actual_types
        if expected_positive:
            stats.expected_positive_cases += 1
        if actual_positive:
            stats.actual_positive_cases += 1
        if expected_positive and actual_positive:
            stats.true_positive_cases += 1
        elif not expected_positive and actual_positive:
            stats.false_positive_cases += 1
        elif expected_positive and not actual_positive:
            stats.false_negative_cases += 1
        else:
            stats.true_negative_cases += 1

    false_positive = bool(extra_types) or is_over_enforcement(expected.outcome, actual.outcome)
    false_negative = bool(missing_types) or is_under_enforcement(expected.outcome, actual.outcome)

    return {
        "caseId": case.case_id,
        "tags": list(case.tags),
        "outcome": "pass" if not mismatch_reasons else "fail",
        "expected": {
            "outcome": expected.outcome,
            "detectedTypes": list(expected.detected_types),
            "detectedCount": expected.detected_count,
            "blockReason": expected.block_reason,
        },
        "actual": {
            "outcome": actual.outcome,
            "detectedTypes": list(actual.detected_types),
            "detectedCount": actual.detected_count,
            "blockReason": actual.block_reason,
            "latencyMs": actual.latency_ms,
            "errorCode": actual.error_code,
            "detectedCountsByType": dict(sorted(actual.detected_counts_by_type.items())),
            "executionMode": actual.execution_mode,
            "modelInvocationCount": actual.model_invocation_count,
            "acceptedModelDetectionCount": actual.accepted_model_detection_count,
            "modelContributionsBySourceAndType": actual.model_contributions_by_source_and_type,
        },
        "missingDetectorTypes": missing_types,
        "extraDetectorTypes": extra_types,
        "mismatchReasons": mismatch_reasons,
        "classification": {
            "falsePositive": false_positive,
            "falseNegative": false_negative,
        },
    }


def render_detector_eval_prompt(case: MasterEvalCase) -> str:
    values = {
        placeholder: synthetic_detector_value(detector_type)
        for placeholder, detector_type in case.placeholder_bindings.items()
    }
    try:
        return case.input_template.format(**values)
    except KeyError as exc:
        raise MasterEvalError(f"{case.case_id}: missing synthetic placeholder value {exc}") from exc


def synthetic_detector_value(detector_type: str) -> str:
    values = {
        "account_id": "account_id=acct_synthetic_000001",
        "account_number": "account number 123-456-789012",
        "api_key": "api_key=syntheticApiKeyValue" + "1234567890abcdef",
        "authorization_header": "Authorization: " + "Bearer " + "syntheticBearerToken" + "123456",
        "bank_account": "bank account number 123-456-789012",
        "cloud_access_key": "AKIA" + ("0" * 16),
        "confidential_business_context": "SYNTHETIC_CONFIDENTIAL_BUSINESS_CONTEXT",
        "credit_card": "4111 1111 1111 1111",
        "customer_id": "customer_id=cus_synthetic001",
        "database_url": "postgres://synthetic_user:synthetic_password@example.test/db",
        "date_of_birth": "date of birth 1999-03-02",
        "driver_license": "driver license 12-34-123456-78",
        "email": "synthetic.user@example.test",
        "employee_id": "employee_id=E123456",
        "github_token": "ghp_" + "syntheticTokenValue" + "1234567890",
        "ip_address": "8.8.8.8",
        "jwt": "eyJsynthetic00" + "." + "eyJsyntheticPayload00" + "." + "syntheticSignature0000",
        "organization_name": "Synthetic Organization",
        "passport_number": "passport number M12345678",
        "password_assignment": "password=syntheticPass12345",
        "person_name": "Synthetic Person",
        "phone_number": "010-1234-5678",
        "postal_address": "address: Synthetic Road 123",
        "private_date": "date 1999-03-02",
        "private_key": (
            "-----BEGIN TEST "
            + "PRIVATE KEY-----\nSYNTHETICKEYDATA\n-----END TEST "
            + "PRIVATE KEY-----"
        ),
        "private_url": "https://example.test/reset?token=syntheticToken1234567890",
        "provider_api_key": "sk-" + "syntheticProviderKey" + "1234567890",
        "resident_registration_number": "900101-1234567",
        "secret": "secret_key=syntheticSecret" + "1234567890abcdef",
        "sensitive_health_context": "SYNTHETIC_SENSITIVE_HEALTH_CONTEXT",
        "session_cookie": "Cookie: sessionid=syntheticSessionToken" + "123456",
        "slack_token": "xoxb-" + "synthetic-token-" + "1234567890",
        "webhook_url": (
            "https://hooks.slack.com/services/"
            + "T00000000/B00000000/"
            + "syntheticWebhookToken"
        ),
    }
    return values.get(detector_type, f"SYNTHETIC_{detector_type.upper()}_VALUE")


def is_over_enforcement(expected_outcome: str, actual_outcome: str) -> bool:
    return OUTCOME_RANK.get(actual_outcome, 3) > OUTCOME_RANK.get(expected_outcome, 0)


def is_under_enforcement(expected_outcome: str, actual_outcome: str) -> bool:
    return OUTCOME_RANK.get(actual_outcome, 3) < OUTCOME_RANK.get(expected_outcome, 0)


def write_reports(report: dict[str, Any], out_dir: Path, *, strict_security_scan: bool = True) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "master-corpus-eval-report.json"
    markdown_path = out_dir / "master-corpus-eval-report.md"
    json_text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    markdown_text = render_markdown_report(report)
    if strict_security_scan:
        scan_text_for_forbidden_sensitive_values(json_text, "master corpus JSON report")
        scan_text_for_forbidden_sensitive_values(markdown_text, "master corpus Markdown report")
    json_path.write_text(json_text + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_text, encoding="utf-8")
    return json_path, markdown_path


def render_markdown_report(report: dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# Master Corpus Eval Report",
        "",
        f"- Report Version: `{report['reportVersion']}`",
        f"- Generated At: `{report['generatedAt']}`",
        f"- Actual Source: `{report['actualSource']['kind']}`",
        f"- Model Load Policy: `{report['actualSource']['modelLoadPolicy']}`",
        f"- Adapter Load States: `{json.dumps(report['actualSource']['adapterLoadStates'], sort_keys=True)}`",
        f"- ML Min Confidence: `{report['actualSource']['mlMinConfidence']}`",
        f"- ML Allowed Detector Types: `{json.dumps(report['actualSource']['mlAllowedDetectorTypes'], sort_keys=True)}`",
        f"- ML Detector Thresholds: `{json.dumps(report['actualSource']['mlDetectorThresholds'], sort_keys=True)}`",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|---|---:|",
    ]
    for key in (
        "totalCases",
        "passedCases",
        "failedCases",
        "passRate",
        "falsePositiveCases",
        "falseNegativeCases",
        "outcomeMismatchCases",
        "detectedTypesMismatchCases",
        "detectedCountMismatchCases",
        "errorCases",
    ):
        lines.append(f"| {key} | {summary[key]} |")
    lines.extend(["", "## Outcome Confusion", "", "| Expected | Actual | Count |", "|---|---|---:|"])
    for expected_outcome, actual_counts in sorted(report["outcomeConfusion"].items()):
        for actual_outcome, count in sorted(actual_counts.items()):
            lines.append(f"| {expected_outcome} | {actual_outcome} | {count} |")
    lines.extend(
        [
            "",
            "## Detector Results",
            "",
            "| Detector | TP | FP | FN | TN | Precision | Recall |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for detector in report["detectors"]:
        lines.append(
            "| {detectorType} | {truePositiveCases} | {falsePositiveCases} | "
            "{falseNegativeCases} | {trueNegativeCases} | {precision} | {recall} |".format(**detector)
        )
    failed_cases = [case for case in report["cases"] if case["outcome"] == "fail"]
    lines.extend(
        [
            "",
            "## Failed Cases",
            "",
            "| Case ID | Expected | Actual | Missing Types | Extra Types | Reasons |",
            "|---|---|---|---|---|---|",
        ]
    )
    if not failed_cases:
        lines.append("| _none_ |  |  |  |  |  |")
    for case in failed_cases:
        lines.append(
            "| {caseId} | {expected} | {actual} | {missing} | {extra} | {reasons} |".format(
                caseId=case["caseId"],
                expected=case["expected"]["outcome"],
                actual=case["actual"]["outcome"],
                missing=", ".join(case["missingDetectorTypes"]) or "-",
                extra=", ".join(case["extraDetectorTypes"]) or "-",
                reasons=", ".join(case["mismatchReasons"]) or "-",
            )
        )
    lines.extend(
        [
            "",
            "## Safety Check",
            "",
            "- Raw rendered prompts are not stored.",
            "- Raw detected values are not stored.",
            "- Source offsets and spans are not stored.",
            "- Redacted prompt bodies are not stored.",
        ]
    )
    return "\n".join(lines) + "\n"


def placeholders_for(template: str) -> set[str]:
    placeholders: set[str] = set()
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name:
            placeholders.add(field_name)
    return placeholders


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
