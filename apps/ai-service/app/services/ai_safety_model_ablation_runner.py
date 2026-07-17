from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from app.adapters.safety.privacy_filter_adapter import (
    DEFAULT_PRIVACY_FILTER_SOURCE,
    KOELECTRA_PRIVACY_NER_SOURCE,
    KOELECTRA_PRIVACY_NER_LABEL_MAP,
    OPENAI_PRIVACY_FILTER_LABEL_MAP,
)
from app.core.config import load_settings
from app.domain.ai_safety_eval.master_corpus import MasterEvalError, load_master_eval_corpus
from app.domain.safety_eval.report import scan_text_for_forbidden_sensitive_values
from app.schemas.safety_eval import SafetyEvalError
from app.services.ai_safety_master_eval_runner import (
    DEFAULT_CORPUS_PATH,
    MODEL_PROFILE_RULES_BOTH,
    MODEL_PROFILE_RULES_KOELECTRA,
    MODEL_PROFILE_RULES_ONLY,
    MODEL_PROFILE_RULES_OPENAI,
    REPORT_VERSION as MASTER_REPORT_VERSION,
    configured_model_ids_by_source,
    load_screening_subset,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_SUBSET_MANIFEST_PATH = (
    REPO_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "pii-model-screening-subset-v1.json"
)
REPORT_VERSION = "pii-model-ablation-report.v1"
PROFILE_ORDER = (
    MODEL_PROFILE_RULES_ONLY,
    MODEL_PROFILE_RULES_OPENAI,
    MODEL_PROFILE_RULES_KOELECTRA,
    MODEL_PROFILE_RULES_BOTH,
)
OPENAI_DETECTOR_TYPES = tuple(sorted(set(OPENAI_PRIVACY_FILTER_LABEL_MAP.values())))
KOELECTRA_DETECTOR_TYPES = tuple(sorted(set(KOELECTRA_PRIVACY_NER_LABEL_MAP.values())))
KOELECTRA_INCREMENTAL_TARGET_TYPES = ("phone_number", "resident_registration_number")
UNSUPPORTED_REGRESSION_TYPES = ("ip_address", "organization_name", "person_name")
KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS = (
    "gen_email_support_direct_redact_01",
    "gen_email_legal_review_redact_02",
    "gen_email_hr_record_redact_03",
    "gen_email_analytics_minimize_redact_04",
    "gen_email_ko_policy_redact_05",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run isolated rules/OpenAI/KoELECTRA/both screening ablations."
    )
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument(
        "--subset-manifest",
        type=Path,
        default=DEFAULT_SUBSET_MANIFEST_PATH,
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--profile-timeout-seconds",
        type=int,
        default=3600,
        help="Per-profile subprocess timeout.",
    )
    parser.add_argument("--ml-min-confidence", type=float, default=None)
    parser.add_argument("--ml-detector-threshold", action="append", default=[])
    parser.add_argument("--ml-allowed-detector-type", action="append", default=[])
    parser.add_argument(
        "--strict-security-scan",
        action=argparse.BooleanOptionalAction,
        default=True,
    )
    parser.add_argument(
        "--no-fail-on-screening-decision",
        action="store_true",
        help="Return zero after a complete run even when no model passes the screening gate.",
    )
    return parser


def run(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.profile_timeout_seconds <= 0:
        print("FAIL: profile timeout must be positive", file=sys.stderr)
        return 2

    try:
        validate_local_model_configuration()
        all_cases = load_master_eval_corpus(args.corpus)
        _, subset_metadata = load_screening_subset(
            args.subset_manifest,
            corpus_path=args.corpus,
            cases=all_cases,
        )
        profile_reports: dict[str, dict[str, Any]] = {}
        for profile in PROFILE_ORDER:
            profile_reports[profile] = run_profile(
                profile,
                corpus_path=args.corpus,
                subset_manifest_path=args.subset_manifest,
                out_dir=args.out / profile,
                timeout_seconds=args.profile_timeout_seconds,
                strict_security_scan=args.strict_security_scan,
                ml_min_confidence=args.ml_min_confidence,
                ml_detector_thresholds=args.ml_detector_threshold,
                ml_allowed_detector_types=args.ml_allowed_detector_type,
            )
        validate_profile_reports(profile_reports, expected_case_count=subset_metadata["caseCount"])
        report = build_ablation_report(
            profile_reports,
            subset_metadata=subset_metadata,
        )
        json_path, markdown_path = write_ablation_reports(
            report,
            args.out,
            strict_security_scan=args.strict_security_scan,
        )
    except (
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        MasterEvalError,
        SafetyEvalError,
    ) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2
    except subprocess.TimeoutExpired as exc:
        profile = profile_from_command(exc.cmd)
        print(f"FAIL: ablation profile {profile!r} exceeded its timeout", file=sys.stderr)
        return 3

    decision = report["screeningDecision"]
    print(
        "PII model ablation completed: "
        f"openaiEligible={len(decision['openai']['eligibleDetectorTypes'])}, "
        f"koelectraQualityCandidate={decision['koelectra']['qualityCandidate']}, "
        f"json={json_path}, markdown={markdown_path}"
    )
    if not decision["candidateRerunRequired"] and not args.no_fail_on_screening_decision:
        return 1
    return 0


def validate_local_model_configuration() -> None:
    model_ids_by_source = configured_model_ids_by_source(load_settings())
    for source in (DEFAULT_PRIVACY_FILTER_SOURCE, KOELECTRA_PRIVACY_NER_SOURCE):
        model_id = model_ids_by_source.get(source)
        if model_id is None:
            raise SafetyEvalError(f"ablation requires configured local model source {source!r}")
        if not Path(model_id).is_dir():
            raise SafetyEvalError(f"configured ablation model directory is missing for source {source!r}")


def run_profile(
    profile: str,
    *,
    corpus_path: Path,
    subset_manifest_path: Path,
    out_dir: Path,
    timeout_seconds: int,
    strict_security_scan: bool,
    ml_min_confidence: float | None,
    ml_detector_thresholds: list[str],
    ml_allowed_detector_types: list[str],
) -> dict[str, Any]:
    command = build_profile_command(
        profile,
        corpus_path=corpus_path,
        subset_manifest_path=subset_manifest_path,
        out_dir=out_dir,
        strict_security_scan=strict_security_scan,
        ml_min_confidence=ml_min_confidence,
        ml_detector_thresholds=ml_detector_thresholds,
        ml_allowed_detector_types=ml_allowed_detector_types,
    )
    completed = subprocess.run(command, check=False, timeout=timeout_seconds)
    if completed.returncode != 0:
        raise SafetyEvalError(
            f"ablation profile {profile!r} failed with exit code {completed.returncode}"
        )
    report_path = out_dir / "master-corpus-eval-report.json"
    if not report_path.is_file():
        raise SafetyEvalError(f"ablation profile {profile!r} did not produce its JSON report")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("actualSource", {}).get("kind") != profile:
        raise SafetyEvalError(f"ablation profile {profile!r} report source mismatch")
    return report


def build_profile_command(
    profile: str,
    *,
    corpus_path: Path,
    subset_manifest_path: Path,
    out_dir: Path,
    strict_security_scan: bool,
    ml_min_confidence: float | None,
    ml_detector_thresholds: list[str],
    ml_allowed_detector_types: list[str],
) -> list[str]:
    command = [
        sys.executable,
        "-m",
        "app.services.ai_safety_master_eval_runner",
        "--corpus",
        str(corpus_path),
        "--subset-manifest",
        str(subset_manifest_path),
        "--model-profile",
        profile,
        "--out",
        str(out_dir),
        "--no-fail-on-mismatch",
    ]
    if not strict_security_scan:
        command.append("--no-strict-security-scan")
    if ml_min_confidence is not None:
        command.extend(("--ml-min-confidence", str(ml_min_confidence)))
    for value in ml_detector_thresholds:
        command.extend(("--ml-detector-threshold", value))
    for value in ml_allowed_detector_types:
        command.extend(("--ml-allowed-detector-type", value))
    return command


def profile_from_command(command: object) -> str:
    if not isinstance(command, (list, tuple)):
        return "unknown"
    try:
        profile_index = command.index("--model-profile") + 1
        return str(command[profile_index])
    except (ValueError, IndexError):
        return "unknown"


def validate_profile_reports(
    profile_reports: dict[str, dict[str, Any]],
    *,
    expected_case_count: int,
) -> None:
    if set(profile_reports) != set(PROFILE_ORDER):
        raise SafetyEvalError("ablation profile set mismatch")
    expected_case_ids: set[str] | None = None
    for profile in PROFILE_ORDER:
        report = profile_reports[profile]
        if report.get("reportVersion") != MASTER_REPORT_VERSION:
            raise SafetyEvalError(f"ablation profile {profile!r} report version mismatch")
        if report.get("summary", {}).get("totalCases") != expected_case_count:
            raise SafetyEvalError(f"ablation profile {profile!r} case count mismatch")
        case_ids = {str(case["caseId"]) for case in report.get("cases", [])}
        if len(case_ids) != expected_case_count:
            raise SafetyEvalError(f"ablation profile {profile!r} case ids are incomplete")
        if expected_case_ids is None:
            expected_case_ids = case_ids
        elif case_ids != expected_case_ids:
            raise SafetyEvalError("ablation profiles did not evaluate the same case ids")
        model_execution = report.get("modelExecution", {})
        if model_execution.get("modelInvocationAccountingMatched") is not True:
            raise SafetyEvalError(f"ablation profile {profile!r} invocation accounting mismatch")
        if model_execution.get("acceptedDetectionAccountingMatched") is not True:
            raise SafetyEvalError(f"ablation profile {profile!r} contribution accounting mismatch")


def build_ablation_report(
    profile_reports: dict[str, dict[str, Any]],
    *,
    subset_metadata: dict[str, Any],
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    generated = generated_at or datetime.now(tz=timezone.utc)
    comparisons = {
        "rulesToOpenai": compare_profile_reports(
            profile_reports[MODEL_PROFILE_RULES_ONLY],
            profile_reports[MODEL_PROFILE_RULES_OPENAI],
        ),
        "rulesToKoelectra": compare_profile_reports(
            profile_reports[MODEL_PROFILE_RULES_ONLY],
            profile_reports[MODEL_PROFILE_RULES_KOELECTRA],
        ),
        "openaiToBoth": compare_profile_reports(
            profile_reports[MODEL_PROFILE_RULES_OPENAI],
            profile_reports[MODEL_PROFILE_RULES_BOTH],
        ),
    }
    return {
        "reportVersion": REPORT_VERSION,
        "generatedAt": generated.isoformat().replace("+00:00", "Z"),
        "status": "complete",
        "aggregateAndCaseIdsOnly": True,
        "screeningOnly": True,
        "productionPromotionEvidence": False,
        "corpus": subset_metadata,
        "profiles": {
            profile: profile_snapshot(profile_reports[profile])
            for profile in PROFILE_ORDER
        },
        "comparisons": comparisons,
        "screeningDecision": build_screening_decision(
            profile_reports,
            comparisons=comparisons,
        ),
        "contentSafety": {
            "rawRenderedPromptIncluded": False,
            "rawDetectedValueIncluded": False,
            "spanOrOffsetIncluded": False,
            "redactedPromptBodyIncluded": False,
        },
    }


def profile_snapshot(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": report["summary"],
        "modelExecution": report["modelExecution"],
        "adapterStats": report["actualSource"]["adapterStats"],
        "mlAllowedDetectorTypes": report["actualSource"]["mlAllowedDetectorTypes"],
        "mlDetectorThresholds": report["actualSource"]["mlDetectorThresholds"],
    }


def compare_profile_reports(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
) -> dict[str, Any]:
    baseline_cases = {case["caseId"]: case for case in baseline["cases"]}
    candidate_cases = {case["caseId"]: case for case in candidate["cases"]}
    if set(baseline_cases) != set(candidate_cases):
        raise SafetyEvalError("pairwise ablation case ids mismatch")

    detector_types = sorted(
        {detector["detectorType"] for detector in baseline["detectors"]}
        | {detector["detectorType"] for detector in candidate["detectors"]}
    )
    by_detector_type: dict[str, dict[str, int]] = {
        detector_type: {
            "rescuedTruePositiveCases": 0,
            "lostTruePositiveCases": 0,
            "newFalsePositiveCases": 0,
            "newHardNegativeFalsePositiveCases": 0,
            "removedFalsePositiveCases": 0,
        }
        for detector_type in detector_types
    }
    exact_pass_regressions: list[str] = []
    exact_pass_recoveries: list[str] = []
    new_false_positive_case_ids: set[str] = set()
    unsupported_regression_case_ids: set[str] = set()

    for case_id in sorted(baseline_cases):
        base_case = baseline_cases[case_id]
        candidate_case = candidate_cases[case_id]
        if base_case["outcome"] == "pass" and candidate_case["outcome"] == "fail":
            exact_pass_regressions.append(case_id)
        if base_case["outcome"] == "fail" and candidate_case["outcome"] == "pass":
            exact_pass_recoveries.append(case_id)
        expected_types = set(base_case["expected"]["detectedTypes"])
        for detector_type in detector_types:
            baseline_present = actual_detector_count(base_case, detector_type) > 0
            candidate_present = actual_detector_count(candidate_case, detector_type) > 0
            metrics = by_detector_type[detector_type]
            if detector_type in expected_types:
                if not baseline_present and candidate_present:
                    metrics["rescuedTruePositiveCases"] += 1
                elif baseline_present and not candidate_present:
                    metrics["lostTruePositiveCases"] += 1
            else:
                if not baseline_present and candidate_present:
                    metrics["newFalsePositiveCases"] += 1
                    new_false_positive_case_ids.add(case_id)
                    if "risk-false-positive" in base_case.get("tags", []):
                        metrics["newHardNegativeFalsePositiveCases"] += 1
                elif baseline_present and not candidate_present:
                    metrics["removedFalsePositiveCases"] += 1
        if any(
            actual_detector_count(base_case, detector_type)
            != actual_detector_count(candidate_case, detector_type)
            for detector_type in UNSUPPORTED_REGRESSION_TYPES
        ):
            unsupported_regression_case_ids.add(case_id)

    baseline_summary = baseline["summary"]
    candidate_summary = candidate["summary"]
    return {
        "summaryDelta": {
            "passedCases": candidate_summary["passedCases"] - baseline_summary["passedCases"],
            "falsePositiveCases": (
                candidate_summary["falsePositiveCases"]
                - baseline_summary["falsePositiveCases"]
            ),
            "falseNegativeCases": (
                candidate_summary["falseNegativeCases"]
                - baseline_summary["falseNegativeCases"]
            ),
        },
        "exactPassRegressionCaseIds": exact_pass_regressions,
        "exactPassRecoveryCaseIds": exact_pass_recoveries,
        "newFalsePositiveCaseIds": sorted(new_false_positive_case_ids),
        "unsupportedTypeRegressionCaseIds": sorted(unsupported_regression_case_ids),
        "byDetectorType": by_detector_type,
    }


def actual_detector_count(case: dict[str, Any], detector_type: str) -> int:
    counts = case.get("actual", {}).get("detectedCountsByType", {})
    value = counts.get(detector_type, 0) if isinstance(counts, dict) else 0
    return int(value) if isinstance(value, int) and value >= 0 else 0


def build_screening_decision(
    profile_reports: dict[str, dict[str, Any]],
    *,
    comparisons: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    openai_stats = adapter_stats_for_source(
        profile_reports[MODEL_PROFILE_RULES_OPENAI],
        DEFAULT_PRIVACY_FILTER_SOURCE,
    )
    rules_to_openai = comparisons["rulesToOpenai"]
    openai_types: dict[str, dict[str, Any]] = {}
    eligible_openai_types: list[str] = []
    for detector_type in OPENAI_DETECTOR_TYPES:
        delta = rules_to_openai["byDetectorType"][detector_type]
        accepted = openai_stats["acceptedDetectionsByDetectorType"].get(detector_type, 0)
        checks = {
            "acceptedContributionObserved": accepted > 0,
            "rescuedTruePositiveObserved": delta["rescuedTruePositiveCases"] >= 1,
            "lostTruePositiveCasesZero": delta["lostTruePositiveCases"] == 0,
            "newFalsePositiveCasesZero": delta["newFalsePositiveCases"] == 0,
        }
        eligible = all(checks.values())
        if eligible:
            eligible_openai_types.append(detector_type)
        openai_types[detector_type] = {
            "eligible": eligible,
            "acceptedContributionCount": accepted,
            "delta": delta,
            "checks": checks,
        }

    both_koelectra_stats = adapter_stats_for_source(
        profile_reports[MODEL_PROFILE_RULES_BOTH],
        KOELECTRA_PRIVACY_NER_SOURCE,
    )
    openai_to_both = comparisons["openaiToBoth"]
    target_rescued = sum(
        openai_to_both["byDetectorType"][detector_type]["rescuedTruePositiveCases"]
        for detector_type in KOELECTRA_INCREMENTAL_TARGET_TYPES
    )
    target_contribution = sum(
        both_koelectra_stats["acceptedDetectionsByDetectorType"].get(detector_type, 0)
        for detector_type in KOELECTRA_INCREMENTAL_TARGET_TYPES
    )
    lost_true_positives = sum(
        openai_to_both["byDetectorType"][detector_type]["lostTruePositiveCases"]
        for detector_type in KOELECTRA_DETECTOR_TYPES
    )
    new_false_positive_cases = len(openai_to_both["newFalsePositiveCaseIds"])
    both_cases = {
        case["caseId"]: case
        for case in profile_reports[MODEL_PROFILE_RULES_BOTH]["cases"]
    }
    missing_known_cases = sorted(set(KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS) - set(both_cases))
    if missing_known_cases:
        raise SafetyEvalError(
            f"KoELECTRA email count gate cases are missing: {missing_known_cases!r}"
        )
    known_email_count_regression_case_ids = [
        case_id
        for case_id in KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS
        if actual_detector_count(both_cases[case_id], "email") != 1
    ]
    koelectra_checks = {
        "loaded": both_koelectra_stats["loadState"] == "loaded",
        "invoked": both_koelectra_stats["modelInvocationCount"] > 0,
        "targetContributionObserved": target_contribution > 0,
        "phoneOrResidentNumberRescued": target_rescued >= 1,
        "openaiExactPassRegressionCasesZero": (
            len(openai_to_both["exactPassRegressionCaseIds"]) == 0
        ),
        "lostTruePositiveCasesZero": lost_true_positives == 0,
        "newFalsePositiveCasesZero": new_false_positive_cases == 0,
        "unsupportedTypeRegressionCasesZero": (
            len(openai_to_both["unsupportedTypeRegressionCaseIds"]) == 0
        ),
        "knownEmailCountRegressionCasesZero": (
            len(known_email_count_regression_case_ids) == 0
        ),
    }
    koelectra_quality_candidate = all(koelectra_checks.values())
    return {
        "openai": {
            "eligibleDetectorTypes": eligible_openai_types,
            "byDetectorType": openai_types,
            "requiresAllowlistRerun": bool(eligible_openai_types),
        },
        "koelectra": {
            "qualityCandidate": koelectra_quality_candidate,
            "checks": koelectra_checks,
            "phoneOrResidentNumberRescuedCases": target_rescued,
            "targetContributionCount": target_contribution,
            "knownEmailCountRegressionCaseIds": known_email_count_regression_case_ids,
            "pendingWarmP95DeltaGateMs": 50,
        },
        "candidateRerunRequired": bool(eligible_openai_types) or koelectra_quality_candidate,
    }


def adapter_stats_for_source(report: dict[str, Any], source: str) -> dict[str, Any]:
    matches = [
        stats
        for stats in report.get("actualSource", {}).get("adapterStats", [])
        if stats.get("source") == source
    ]
    if len(matches) != 1:
        raise SafetyEvalError(f"expected exactly one adapter stats entry for source {source!r}")
    return matches[0]


def write_ablation_reports(
    report: dict[str, Any],
    out_dir: Path,
    *,
    strict_security_scan: bool = True,
) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "pii-model-ablation-report.json"
    markdown_path = out_dir / "pii-model-ablation-report.md"
    json_text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    markdown_text = render_korean_markdown_report(report)
    if strict_security_scan:
        scan_text_for_forbidden_sensitive_values(json_text, "PII model ablation JSON report")
        scan_text_for_forbidden_sensitive_values(markdown_text, "PII model ablation Markdown report")
    json_path.write_text(json_text, encoding="utf-8")
    markdown_path.write_text(markdown_text, encoding="utf-8")
    return json_path, markdown_path


def render_korean_markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# PII 모델 4-way Screening 비교 보고서",
        "",
        "> 이 결과는 합성 screening 자료이며 production 승격 증거가 아닙니다.",
        "",
        f"- 생성 시각: `{report['generatedAt']}`",
        f"- 평가 건수: `{report['corpus']['caseCount']}`",
        f"- locale: `{json.dumps(report['corpus']['localeCounts'], ensure_ascii=False, sort_keys=True)}`",
        "",
        "## 프로필 결과",
        "",
        "| 프로필 | 통과 | 오탐 사례 | 누락 사례 | 오류 | 모델 호출 | 모델 기여 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for profile in PROFILE_ORDER:
        snapshot = report["profiles"][profile]
        summary = snapshot["summary"]
        execution = snapshot["modelExecution"]
        lines.append(
            f"| {profile} | {summary['passedCases']} | {summary['falsePositiveCases']} | "
            f"{summary['falseNegativeCases']} | {summary['errorCases']} | "
            f"{execution['responseModelInvocationCount']} | "
            f"{execution['responseAcceptedModelDetectionCount']} |"
        )
    lines.extend(
        [
            "",
            "## 비교 변화량",
            "",
            "| 비교 | 통과 변화 | 오탐 변화 | 누락 변화 | exact pass 회귀 | 신규 FP 사례 | 비지원 유형 회귀 |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for name, comparison in report["comparisons"].items():
        delta = comparison["summaryDelta"]
        lines.append(
            f"| {name} | {delta['passedCases']} | {delta['falsePositiveCases']} | "
            f"{delta['falseNegativeCases']} | {len(comparison['exactPassRegressionCaseIds'])} | "
            f"{len(comparison['newFalsePositiveCaseIds'])} | "
            f"{len(comparison['unsupportedTypeRegressionCaseIds'])} |"
        )
    lines.extend(
        [
            "",
            "## OpenAI 유형별 유지 후보",
            "",
            "| 유형 | 유지 후보 | 추가 TP | 손실 TP | 신규 FP | 실제 모델 기여 |",
            "|---|---|---:|---:|---:|---:|",
        ]
    )
    for detector_type, result in report["screeningDecision"]["openai"]["byDetectorType"].items():
        delta = result["delta"]
        lines.append(
            f"| {detector_type} | {'예' if result['eligible'] else '아니오'} | "
            f"{delta['rescuedTruePositiveCases']} | {delta['lostTruePositiveCases']} | "
            f"{delta['newFalsePositiveCases']} | {result['acceptedContributionCount']} |"
        )
    ko = report["screeningDecision"]["koelectra"]
    lines.extend(
        [
            "",
            "## KoELECTRA 판정",
            "",
            f"- 품질 유지 후보: `{'예' if ko['qualityCandidate'] else '아니오'}`",
            f"- 전화번호·주민번호 추가 TP: `{ko['phoneOrResidentNumberRescuedCases']}`",
            f"- 해당 유형 모델 기여 수: `{ko['targetContributionCount']}`",
            f"- 고정 이메일 5건 count 회귀: `{len(ko['knownEmailCountRegressionCaseIds'])}건`",
            f"- 다음 단계 지연 기준: OpenAI 대비 warm p95 추가 `{ko['pendingWarmP95DeltaGateMs']}ms 이하`",
            "",
            "## 안전 확인",
            "",
            "- rendered prompt를 보고서에 저장하지 않았습니다.",
            "- 탐지 원문과 span/offset을 저장하지 않았습니다.",
            "- redacted prompt 본문을 저장하지 않았습니다.",
            "- 상세 원인 확인에는 case ID만 사용합니다.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
