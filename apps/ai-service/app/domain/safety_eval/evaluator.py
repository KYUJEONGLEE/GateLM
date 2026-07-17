from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any

from app.schemas.safety_eval import ActualResult, CorpusCase, DETECTOR_TYPES, GatewayEffects


@dataclass
class DetectorStats:
    detector_type: str
    expected_positive_cases: int = 0
    actual_positive_cases: int = 0
    true_positive_cases: int = 0
    false_positive_cases: int = 0
    false_negative_cases: int = 0
    true_negative_cases: int = 0
    count_mismatch_cases: int = 0

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
            "countMismatchCases": self.count_mismatch_cases,
            "precision": round(self.precision, 6) if self.precision is not None else None,
            "recall": round(self.recall, 6) if self.recall is not None else None,
        }


@dataclass
class EvaluationResult:
    cases: list[dict[str, Any]]
    detectors: dict[str, DetectorStats]
    summary: dict[str, Any]
    action_confusion: dict[str, dict[str, int]]


def evaluate_cases(
    cases: list[CorpusCase],
    actual_by_case_id: dict[str, ActualResult],
) -> EvaluationResult:
    detector_types = sorted(
        DETECTOR_TYPES
        | {
            detector_type
            for actual in actual_by_case_id.values()
            for detector_type in actual.detected_types
        }
    )
    detector_stats = {detector_type: DetectorStats(detector_type) for detector_type in detector_types}
    action_confusion: dict[str, dict[str, int]] = {}
    case_reports: list[dict[str, Any]] = []

    false_positive_cases = 0
    false_negative_cases = 0
    action_mismatch_count = 0
    gateway_effect_mismatch_count = 0

    for case in cases:
        actual = actual_by_case_id.get(case.case_id)
        case_report = evaluate_case(case, actual, detector_stats)
        case_reports.append(case_report)

        expected_action = case.expected_safety_decision.action
        actual_action = case_report["actual"]["action"]
        action_confusion.setdefault(expected_action, {})
        action_confusion[expected_action][actual_action] = action_confusion[expected_action].get(actual_action, 0) + 1

        if case_report["classification"]["falsePositive"]:
            false_positive_cases += 1
        if case_report["classification"]["falseNegative"]:
            false_negative_cases += 1
        if "action_mismatch" in case_report["mismatchReasons"]:
            action_mismatch_count += 1
        if "gateway_effects_mismatch" in case_report["mismatchReasons"]:
            gateway_effect_mismatch_count += 1

    passed = sum(1 for case_report in case_reports if case_report["outcome"] == "pass")
    total = len(case_reports)
    failed = total - passed
    summary = {
        "totalCases": total,
        "passedCases": passed,
        "failedCases": failed,
        "passRate": round(passed / total, 6) if total else None,
        "falsePositiveCases": false_positive_cases,
        "falseNegativeCases": false_negative_cases,
        "actionMismatchCases": action_mismatch_count,
        "gatewayEffectMismatchCases": gateway_effect_mismatch_count,
    }

    return EvaluationResult(
        cases=case_reports,
        detectors=detector_stats,
        summary=summary,
        action_confusion=action_confusion,
    )


def evaluate_case(
    case: CorpusCase,
    actual: ActualResult | None,
    detector_stats: dict[str, DetectorStats],
) -> dict[str, Any]:
    expected = case.expected_safety_decision
    expected_types = set(expected.detected_types)
    actual_types = set(actual.detected_types) if actual else set()

    missing_types = sorted(expected_types - actual_types)
    extra_types = sorted(actual_types - expected_types)
    mismatch_reasons: list[str] = []

    if actual is None:
        mismatch_reasons.append("missing_actual")
        actual_action = "missing"
        actual_count = None
        actual_preview = None
        actual_block_reason = None
        actual_policy_hash = None
        actual_gateway_effects = None
        actual_safety_outcome = None
    else:
        actual_action = actual.action
        actual_count = actual.detected_count
        actual_preview = actual.redacted_prompt_preview
        actual_block_reason = actual.block_reason
        actual_policy_hash = actual.security_policy_hash
        actual_gateway_effects = actual.gateway_effects
        actual_safety_outcome = actual.safety_outcome

    preview_is_canonical = actual is None or actual_safety_outcome is None
    preview_matches = (
        normalize_preview(expected.redacted_prompt_preview) == normalize_preview(actual_preview)
        if preview_is_canonical
        else True
    )

    if actual is None or expected.action != actual.action:
        mismatch_reasons.append("action_mismatch")
    if missing_types or extra_types:
        mismatch_reasons.append("detected_types_mismatch")
    if actual is None or expected.detected_count != actual.detected_count:
        mismatch_reasons.append("detected_count_mismatch")
    if not preview_matches:
        mismatch_reasons.append("preview_mismatch")
    if expected.block_reason != actual_block_reason:
        mismatch_reasons.append("block_reason_mismatch")
    if expected.security_policy_hash != actual_policy_hash:
        mismatch_reasons.append("security_policy_hash_mismatch")
    if actual_gateway_effects is not None and not gateway_effects_equal(case.expected_gateway_effects, actual_gateway_effects):
        mismatch_reasons.append("gateway_effects_mismatch")

    if actual is not None and actual.detected_type_counts:
        for detector_type in sorted(set(case.expected_type_counts) | set(actual.detected_type_counts)):
            expected_count = case.expected_type_counts.get(detector_type, 0)
            actual_count_for_type = actual.detected_type_counts.get(detector_type, 0)
            if expected_count != actual_count_for_type:
                mismatch_reasons.append(f"detected_type_count_mismatch:{detector_type}")
                detector_stats.setdefault(detector_type, DetectorStats(detector_type)).count_mismatch_cases += 1

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

    is_over_enforcement = (
        expected.action == "none"
        and actual_action in {"redacted", "blocked"}
    ) or (
        expected.action == "redacted"
        and actual_action == "blocked"
    )
    is_under_enforcement = (
        expected.action in {"redacted", "blocked"}
        and actual_action in {"none", "missing", "not_checked"}
    ) or (
        expected.action == "blocked"
        and actual_action == "redacted"
    )
    false_positive = bool(extra_types) or is_over_enforcement
    false_negative = bool(missing_types) or is_under_enforcement

    return {
        "caseId": case.case_id,
        "tags": list(case.tags),
        "outcome": "pass" if not mismatch_reasons else "fail",
        "expected": {
            "action": expected.action,
            "safetyOutcome": action_to_v2_safety_outcome(expected.action),
            "detectedTypes": list(expected.detected_types),
            "detectedCount": expected.detected_count,
            "blockReason": expected.block_reason,
            "securityPolicyHash": expected.security_policy_hash,
            "gatewayEffects": case.expected_gateway_effects.to_report(),
        },
        "actual": {
            "action": actual_action,
            "safetyOutcome": actual_safety_outcome,
            "detectedTypes": sorted(actual_types),
            "detectedCount": actual_count,
            "blockReason": actual_block_reason,
            "securityPolicyHash": actual_policy_hash,
            "gatewayEffects": actual_gateway_effects.to_report() if actual_gateway_effects else None,
        },
        "redactedPromptPreviewMatched": preview_matches if preview_is_canonical else None,
        "expectedPreviewHash": preview_hash(expected.redacted_prompt_preview) if preview_is_canonical else None,
        "actualPreviewHash": preview_hash(actual_preview) if preview_is_canonical else None,
        "missingDetectorTypes": missing_types,
        "extraDetectorTypes": extra_types,
        "mismatchReasons": dedupe_preserve_order(mismatch_reasons),
        "classification": {
            "falsePositive": false_positive,
            "falseNegative": false_negative,
        },
    }


def normalize_preview(value: str | None) -> str | None:
    if value is None:
        return None
    return " ".join(value.strip().split())


def preview_hash(value: str | None) -> str | None:
    normalized = normalize_preview(value)
    if normalized is None:
        return None
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def gateway_effects_equal(expected: GatewayEffects, actual: GatewayEffects) -> bool:
    if (
        expected.provider_called != actual.provider_called
        or expected.cache_lookup != actual.cache_lookup
        or expected.terminal_status != actual.terminal_status
        or expected.http_status != actual.http_status
        or expected.error_code != actual.error_code
    ):
        return False
    if expected.cache_write is not None and expected.cache_write != actual.cache_write:
        return False
    if expected.streaming_started is not None and expected.streaming_started != actual.streaming_started:
        return False
    return True


def action_to_v2_safety_outcome(action: str) -> str | None:
    return {
        "none": "passed",
        "redacted": "redacted",
        "blocked": "blocked",
    }.get(action)


def dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        deduped.append(value)
    return deduped
