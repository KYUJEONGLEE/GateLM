from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from app.adapters.safety.privacy_filter_adapter import (
    DEFAULT_PRIVACY_FILTER_SOURCE,
    KOELECTRA_PRIVACY_NER_SOURCE,
)
from app.services.ai_safety_model_ablation_runner import (
    KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS,
    KOELECTRA_DETECTOR_TYPES,
    MODEL_PROFILE_RULES_BOTH,
    MODEL_PROFILE_RULES_KOELECTRA,
    MODEL_PROFILE_RULES_ONLY,
    MODEL_PROFILE_RULES_OPENAI,
    OPENAI_DETECTOR_TYPES,
    PROFILE_ORDER,
    UNSUPPORTED_REGRESSION_TYPES,
    build_ablation_report,
    build_profile_command,
    validate_profile_reports,
    write_ablation_reports,
)


class AiSafetyModelAblationRunnerTests(unittest.TestCase):
    def test_profile_command_forwards_allowlist_and_threshold_options(self) -> None:
        command = build_profile_command(
            MODEL_PROFILE_RULES_BOTH,
            corpus_path=Path("corpus.jsonl"),
            subset_manifest_path=Path("subset.json"),
            out_dir=Path("out"),
            strict_security_scan=True,
            ml_min_confidence=0.8,
            ml_detector_thresholds=["private_url=0.9"],
            ml_allowed_detector_types=["phone_number,secret"],
        )

        self.assertIn("--model-profile", command)
        self.assertEqual(command[command.index("--model-profile") + 1], MODEL_PROFILE_RULES_BOTH)
        self.assertEqual(command[command.index("--ml-min-confidence") + 1], "0.8")
        self.assertEqual(
            command[command.index("--ml-detector-threshold") + 1],
            "private_url=0.9",
        )
        self.assertEqual(
            command[command.index("--ml-allowed-detector-type") + 1],
            "phone_number,secret",
        )

    def test_ablation_report_calculates_per_type_delta_and_quality_candidates(self) -> None:
        reports = passing_profile_reports()

        report = build_ablation_report(
            reports,
            subset_metadata=subset_metadata(),
        )

        openai_secret = report["screeningDecision"]["openai"]["byDetectorType"]["secret"]
        self.assertTrue(openai_secret["eligible"])
        self.assertEqual(openai_secret["delta"]["rescuedTruePositiveCases"], 1)
        self.assertEqual(openai_secret["acceptedContributionCount"], 1)
        koelectra = report["screeningDecision"]["koelectra"]
        self.assertTrue(koelectra["qualityCandidate"])
        self.assertTrue(koelectra["checks"]["knownEmailCountRegressionCasesZero"])
        self.assertEqual(koelectra["phoneOrResidentNumberRescuedCases"], 1)
        self.assertTrue(report["screeningDecision"]["candidateRerunRequired"])

    def test_known_email_count_regression_forces_koelectra_no_go(self) -> None:
        reports = passing_profile_reports()
        case_id = KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS[1]
        both_case = case_for_id(reports[MODEL_PROFILE_RULES_BOTH], case_id)
        both_case["actual"]["detectedCountsByType"]["email"] = 2
        both_case["actual"]["detectedCount"] = 2
        both_case["outcome"] = "fail"

        report = build_ablation_report(
            reports,
            subset_metadata=subset_metadata(),
        )

        koelectra = report["screeningDecision"]["koelectra"]
        self.assertFalse(koelectra["qualityCandidate"])
        self.assertFalse(koelectra["checks"]["knownEmailCountRegressionCasesZero"])
        self.assertEqual(koelectra["knownEmailCountRegressionCaseIds"], [case_id])

    def test_profile_validation_rejects_adapter_accounting_mismatch(self) -> None:
        reports = passing_profile_reports()
        reports[MODEL_PROFILE_RULES_OPENAI]["modelExecution"][
            "modelInvocationAccountingMatched"
        ] = False

        with self.assertRaisesRegex(ValueError, "invocation accounting mismatch"):
            validate_profile_reports(reports, expected_case_count=7)

    def test_ablation_reports_are_korean_and_exclude_prompt_bodies(self) -> None:
        report = build_ablation_report(
            passing_profile_reports(),
            subset_metadata=subset_metadata(),
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            json_path, markdown_path = write_ablation_reports(report, Path(temp_dir))

            serialized = json_path.read_text(encoding="utf-8")
            markdown = markdown_path.read_text(encoding="utf-8")
            self.assertIn("PII 모델 4-way Screening 비교 보고서", markdown)
            self.assertNotIn("inputTemplate", serialized)
            self.assertNotIn('"redactedPrompt":', serialized)
            self.assertNotIn("AliasValue", serialized)


def passing_profile_reports() -> dict[str, dict[str, object]]:
    case_specs = [
        (case_id, ("email",)) for case_id in KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS
    ]
    case_specs.extend(
        [
            ("screening_openai_secret", ("secret",)),
            ("screening_koelectra_phone", ("phone_number",)),
        ]
    )
    actual_by_profile: dict[str, dict[str, dict[str, int]]] = {
        MODEL_PROFILE_RULES_ONLY: {
            case_id: ({"email": 1} if "email" in expected else {})
            for case_id, expected in case_specs
        },
        MODEL_PROFILE_RULES_OPENAI: {
            case_id: (
                {"email": 1}
                if "email" in expected
                else {"secret": 1}
                if "secret" in expected
                else {}
            )
            for case_id, expected in case_specs
        },
        MODEL_PROFILE_RULES_KOELECTRA: {
            case_id: (
                {"email": 1}
                if "email" in expected
                else {"phone_number": 1}
                if "phone_number" in expected
                else {}
            )
            for case_id, expected in case_specs
        },
        MODEL_PROFILE_RULES_BOTH: {
            case_id: (
                {"email": 1}
                if "email" in expected
                else {"secret": 1}
                if "secret" in expected
                else {"phone_number": 1}
                if "phone_number" in expected
                else {}
            )
            for case_id, expected in case_specs
        },
    }
    reports: dict[str, dict[str, object]] = {}
    all_detector_types = sorted(
        set(OPENAI_DETECTOR_TYPES)
        | set(KOELECTRA_DETECTOR_TYPES)
        | set(UNSUPPORTED_REGRESSION_TYPES)
    )
    for profile in PROFILE_ORDER:
        cases = [
            fake_case(case_id, expected, actual_by_profile[profile][case_id])
            for case_id, expected in case_specs
        ]
        passed = sum(case["outcome"] == "pass" for case in cases)
        adapters = adapter_stats_for_profile(profile)
        reports[profile] = {
            "reportVersion": "master-corpus-eval-report.v2",
            "actualSource": {
                "kind": profile,
                "adapterStats": adapters,
                "mlAllowedDetectorTypes": all_detector_types,
                "mlDetectorThresholds": {
                    detector_type: 0.7 for detector_type in all_detector_types
                },
            },
            "modelExecution": {
                "executionModeCases": {
                    "rules_only": len(cases) if profile == MODEL_PROFILE_RULES_ONLY else 0,
                    "hybrid": 0 if profile == MODEL_PROFILE_RULES_ONLY else len(cases),
                },
                "responseModelInvocationCount": sum(
                    int(adapter["modelInvocationCount"]) for adapter in adapters
                ),
                "recordedModelInvocationCount": sum(
                    int(adapter["modelInvocationCount"]) for adapter in adapters
                ),
                "modelInvocationAccountingMatched": True,
                "responseAcceptedModelDetectionCount": sum(
                    int(adapter["acceptedDetectionCount"]) for adapter in adapters
                ),
                "recordedAcceptedModelDetectionCount": sum(
                    int(adapter["acceptedDetectionCount"]) for adapter in adapters
                ),
                "acceptedDetectionAccountingMatched": True,
            },
            "summary": {
                "totalCases": len(cases),
                "passedCases": passed,
                "failedCases": len(cases) - passed,
                "passRate": passed / len(cases),
                "falsePositiveCases": 0,
                "falseNegativeCases": len(cases) - passed,
                "outcomeMismatchCases": len(cases) - passed,
                "detectedTypesMismatchCases": len(cases) - passed,
                "detectedCountMismatchCases": len(cases) - passed,
                "errorCases": 0,
            },
            "detectors": [
                {"detectorType": detector_type} for detector_type in all_detector_types
            ],
            "cases": cases,
        }
    return copy.deepcopy(reports)


def adapter_stats_for_profile(profile: str) -> list[dict[str, object]]:
    if profile == MODEL_PROFILE_RULES_ONLY:
        return [adapter_stats("rules_only_eval", {}, invocation_count=0)]
    if profile == MODEL_PROFILE_RULES_OPENAI:
        return [adapter_stats(DEFAULT_PRIVACY_FILTER_SOURCE, {"secret": 1})]
    if profile == MODEL_PROFILE_RULES_KOELECTRA:
        return [adapter_stats(KOELECTRA_PRIVACY_NER_SOURCE, {"phone_number": 1})]
    return [
        adapter_stats(DEFAULT_PRIVACY_FILTER_SOURCE, {"secret": 1}),
        adapter_stats(KOELECTRA_PRIVACY_NER_SOURCE, {"phone_number": 1}),
    ]


def adapter_stats(
    source: str,
    contributions: dict[str, int],
    *,
    invocation_count: int = 1,
) -> dict[str, object]:
    return {
        "modelId": source,
        "source": source,
        "runtime": "onnx",
        "loadState": "loaded",
        "supportedDetectorTypes": sorted(contributions),
        "detectManyCalls": invocation_count,
        "inputWindowCount": invocation_count,
        "modelInvocationCount": invocation_count,
        "acceptedDetectionCount": sum(contributions.values()),
        "acceptedDetectionsByDetectorType": contributions,
        "contributedCases": sum(contributions.values()),
    }


def fake_case(
    case_id: str,
    expected_types: tuple[str, ...],
    actual_counts: dict[str, int],
) -> dict[str, object]:
    actual_types = sorted(detector_type for detector_type, count in actual_counts.items() if count)
    passed = set(expected_types) == set(actual_types) and sum(actual_counts.values()) == len(expected_types)
    return {
        "caseId": case_id,
        "tags": ["risk-false-negative"],
        "outcome": "pass" if passed else "fail",
        "expected": {
            "outcome": "redacted",
            "detectedTypes": list(expected_types),
            "detectedCount": len(expected_types),
            "blockReason": None,
        },
        "actual": {
            "outcome": "redacted" if actual_types else "passed",
            "detectedTypes": actual_types,
            "detectedCount": sum(actual_counts.values()),
            "detectedCountsByType": actual_counts,
            "blockReason": None,
            "latencyMs": 1,
            "errorCode": None,
        },
    }


def case_for_id(report: dict[str, object], case_id: str) -> dict[str, object]:
    return next(case for case in report["cases"] if case["caseId"] == case_id)  # type: ignore[index,union-attr]


def subset_metadata() -> dict[str, object]:
    return {
        "schemaVersion": "pii-model-screening-subset.v1",
        "sourceCorpusSha256": "0" * 64,
        "caseCount": 7,
        "syntheticOnly": True,
        "localeCounts": {"en-US": 4, "ko-KR": 3},
        "outcomeCounts": {"redacted": 7},
        "riskFalsePositiveCases": 0,
        "riskFalseNegativeCases": 7,
    }


if __name__ == "__main__":
    unittest.main()
