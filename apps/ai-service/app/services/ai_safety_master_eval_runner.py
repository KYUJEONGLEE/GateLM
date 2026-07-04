from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from string import Formatter
from typing import Any, Sequence

from app.adapters.safety import PrivacyFilterAdapter
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
REPORT_VERSION = "master-corpus-eval-report.v1"
ACTUAL_SOURCE_CONFIGURED_MODEL = "configured-model"
ACTUAL_SOURCE_NOOP_TEST = "fast-rules-noop-ml"
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
        service = build_detector_service(
            ACTUAL_SOURCE_CONFIGURED_MODEL,
            ml_min_confidence=args.ml_min_confidence,
            ml_detector_thresholds=ml_detector_thresholds,
            ml_allowed_detector_types=ml_allowed_detector_types,
        )
        force_load_detector_models(service)
        report = evaluate_master_corpus(
            cases,
            service=service,
            corpus_path=args.corpus,
            actual_source=ACTUAL_SOURCE_CONFIGURED_MODEL,
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


def evaluate_master_corpus(
    cases: list[MasterEvalCase],
    *,
    service: AiSafetyDetectorService,
    corpus_path: Path,
    actual_source: str,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    detector_stats = {detector_type: DetectorStats(detector_type) for detector_type in sorted(ALLOWED_DETECTOR_TYPES)}
    outcome_confusion: dict[str, dict[str, int]] = {}
    case_reports: list[dict[str, Any]] = []
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
    return {
        "reportVersion": REPORT_VERSION,
        "generatedAt": generated.isoformat().replace("+00:00", "Z"),
        "corpus": {
            "path": str(corpus_path),
        },
        "actualSource": {
            "kind": actual_source,
            "modelLoadPolicy": "required-before-evaluation",
            "adapterLoadStates": dict(sorted(Counter(adapter.load_state for adapter in service.adapters).items())),
            "mlMinConfidence": ml_min_confidence_summary(service),
            "mlDetectorThresholds": ml_detector_threshold_summary(service),
            "mlAllowedDetectorTypes": ml_allowed_detector_type_summary(service),
            "rawPromptStored": False,
            "rawDetectedValueStored": False,
            "redactedPromptStored": False,
        },
        "summary": summary,
        "outcomeConfusion": outcome_confusion,
        "detectors": [stats.to_report() for stats in detector_stats.values()],
        "cases": case_reports,
    }


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
    except Exception:
        return ActualDetectorResult(
            outcome="error",
            detected_types=(),
            detected_count=0,
            block_reason=None,
            error_code="detector_runtime_error",
        )
    return ActualDetectorResult(
        outcome=response.outcome,
        detected_types=tuple(sorted(response.detector_summary.detector_categories)),
        detected_count=response.detector_summary.detected_count,
        block_reason="sensitive_data_blocked" if response.outcome == "blocked" else None,
        latency_ms=response.latency_ms,
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
