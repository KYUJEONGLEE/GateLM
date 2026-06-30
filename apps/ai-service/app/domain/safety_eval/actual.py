from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.schemas.safety_eval import (
    ActualResult,
    GatewayEffects,
    SANITIZED_CATEGORY_PATTERN,
    SafetyDecision,
    SafetyEvalError,
    V2_CACHE_OUTCOMES,
    V2_PROVIDER_OUTCOMES,
    V2_SAFETY_OUTCOMES,
    V2_STREAMING_OUTCOMES,
    parse_detected_type_counts,
)


MODE_DETECTOR_OUTPUT = "detector_output"
MODE_GATEWAY_SAFETY_OUTPUT = "gateway_safety_output"
MODE_GATEWAY_SAFETY_OUTPUT_V2 = "gateway_safety_output_v2"
REQUIRED_FIXTURE_FIELDS = {"fixtureName", "fixtureVersion", "mode", "results"}


def normalize_mode(mode: str) -> str:
    normalized = mode.strip().replace("-", "_")
    if normalized not in {MODE_DETECTOR_OUTPUT, MODE_GATEWAY_SAFETY_OUTPUT, MODE_GATEWAY_SAFETY_OUTPUT_V2}:
        raise SafetyEvalError(f"unsupported mode {mode!r}")
    return normalized


def load_actual_fixture(fixture_path: Path, mode: str) -> tuple[dict[str, Any], dict[str, ActualResult]]:
    normalized_mode = normalize_mode(mode)
    if not fixture_path.exists():
        raise SafetyEvalError(f"actual fixture not found: {fixture_path}")
    try:
        raw_fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SafetyEvalError(f"actual fixture JSON parse failed: {exc}") from exc
    if not isinstance(raw_fixture, dict):
        raise SafetyEvalError("actual fixture must be an object")

    validate_actual_fixture_metadata(raw_fixture)
    fixture_mode = normalize_mode(raw_fixture["mode"])
    if fixture_mode != normalized_mode:
        raise SafetyEvalError(f"actual fixture mode {fixture_mode!r} does not match requested mode {normalized_mode!r}")
    results = raw_fixture.get("results")
    if not isinstance(results, list) or not results:
        raise SafetyEvalError("actual fixture results must be a non-empty array")

    actual_by_case_id: dict[str, ActualResult] = {}
    for index, raw_result in enumerate(results, start=1):
        if not isinstance(raw_result, dict):
            raise SafetyEvalError(f"actual fixture result {index} must be an object")
        if normalized_mode == MODE_DETECTOR_OUTPUT:
            actual = parse_detector_output_result(raw_result, index)
        elif normalized_mode == MODE_GATEWAY_SAFETY_OUTPUT:
            actual = parse_gateway_output_result(raw_result, index)
        else:
            actual = parse_gateway_output_result_v2(raw_result, index)
        if actual.case_id in actual_by_case_id:
            raise SafetyEvalError(f"duplicate actual result caseId {actual.case_id}")
        actual_by_case_id[actual.case_id] = actual

    return raw_fixture, actual_by_case_id


def validate_actual_fixture_metadata(raw_fixture: dict[str, Any]) -> None:
    if set(raw_fixture) != REQUIRED_FIXTURE_FIELDS:
        raise SafetyEvalError(f"actual fixture top-level fields mismatch: {sorted(raw_fixture)}")
    for field_name in ("fixtureName", "fixtureVersion", "mode"):
        value = raw_fixture[field_name]
        if not isinstance(value, str) or not value:
            raise SafetyEvalError(f"actual fixture {field_name} must be a non-empty string")


def parse_detector_output_result(raw_result: dict[str, Any], index: int) -> ActualResult:
    label = raw_result.get("caseId", f"detector result {index}")
    if set(raw_result) != {"caseId", "actualSafetyDecision"}:
        raise SafetyEvalError(f"{label}: detector output result fields mismatch")
    case_id = raw_result["caseId"]
    if not isinstance(case_id, str) or not case_id:
        raise SafetyEvalError(f"{label}: caseId must be non-empty string")
    decision = SafetyDecision.from_dict(
        raw_result["actualSafetyDecision"],
        f"{label}: actualSafetyDecision",
        allow_detected_type_counts=True,
    )
    return ActualResult(
        case_id=case_id,
        action=decision.action,
        detected_types=decision.detected_types,
        detected_count=decision.detected_count,
        redacted_prompt_preview=decision.redacted_prompt_preview,
        block_reason=decision.block_reason,
        security_policy_hash=decision.security_policy_hash,
        detected_type_counts=decision.detected_type_counts,
    )


def parse_gateway_output_result(raw_result: dict[str, Any], index: int) -> ActualResult:
    label = raw_result.get("caseId", f"gateway result {index}")
    allowed = {"caseId", "runtime", "safety", "gatewayEffects"}
    allowed_with_optional = set(allowed) | {"requestId"}
    raw_fields = set(raw_result)
    if raw_fields != allowed and raw_fields != allowed_with_optional:
        raise SafetyEvalError(f"{label}: gateway output result fields mismatch")
    case_id = raw_result["caseId"]
    if not isinstance(case_id, str) or not case_id:
        raise SafetyEvalError(f"{label}: caseId must be non-empty string")
    request_id = raw_result.get("requestId")
    if request_id is not None and not isinstance(request_id, str):
        raise SafetyEvalError(f"{label}: requestId must be string or null")

    runtime = raw_result["runtime"]
    safety = raw_result["safety"]
    if not isinstance(runtime, dict) or set(runtime) != {"securityPolicyHash"}:
        raise SafetyEvalError(f"{label}: runtime fields mismatch")
    if not isinstance(safety, dict):
        raise SafetyEvalError(f"{label}: safety must be an object")
    security_policy_hash = runtime["securityPolicyHash"]
    if not isinstance(security_policy_hash, str) or not security_policy_hash:
        raise SafetyEvalError(f"{label}: runtime.securityPolicyHash must be non-empty string")

    required_safety = {
        "maskingAction",
        "maskingDetectedTypes",
        "maskingDetectedCount",
        "redactedPromptPreview",
    }
    allowed_safety = set(required_safety) | {"promptHash", "detectedTypeCounts"}
    if not required_safety.issubset(safety) or not set(safety).issubset(allowed_safety):
        raise SafetyEvalError(f"{label}: safety fields mismatch")

    action = safety["maskingAction"]
    detected_types = safety["maskingDetectedTypes"]
    detected_count = safety["maskingDetectedCount"]
    preview = safety["redactedPromptPreview"]
    prompt_hash = safety.get("promptHash")
    if action not in {"none", "redacted", "blocked"}:
        raise SafetyEvalError(f"{label}: invalid maskingAction {action!r}")
    if not isinstance(detected_types, list) or len(detected_types) != len(set(detected_types)):
        raise SafetyEvalError(f"{label}: maskingDetectedTypes must be a unique array")
    if not isinstance(detected_count, int) or detected_count < 0:
        raise SafetyEvalError(f"{label}: maskingDetectedCount must be non-negative integer")
    if preview is not None and not isinstance(preview, str):
        raise SafetyEvalError(f"{label}: redactedPromptPreview must be string or null")
    if prompt_hash is not None and not isinstance(prompt_hash, str):
        raise SafetyEvalError(f"{label}: promptHash must be string or null")

    return ActualResult(
        case_id=case_id,
        action=action,
        detected_types=tuple(sorted(detected_types)),
        detected_count=detected_count,
        redacted_prompt_preview=preview,
        block_reason="sensitive_data_blocked" if action == "blocked" else None,
        security_policy_hash=security_policy_hash,
        gateway_effects=GatewayEffects.from_dict(raw_result["gatewayEffects"], f"{label}: gatewayEffects"),
        detected_type_counts=parse_detected_type_counts(safety.get("detectedTypeCounts", {}), f"{label}: detectedTypeCounts"),
        request_id=request_id,
        prompt_hash=prompt_hash,
    )


def parse_gateway_output_result_v2(raw_result: dict[str, Any], index: int) -> ActualResult:
    label = raw_result.get("caseId", f"gateway v2 result {index}")
    allowed = {"caseId", "domainOutcomes", "gatewayEffects"}
    allowed_with_optional = set(allowed) | {"requestId"}
    raw_fields = set(raw_result)
    if raw_fields != allowed and raw_fields != allowed_with_optional:
        raise SafetyEvalError(f"{label}: gateway v2 output result fields mismatch")

    case_id = raw_result["caseId"]
    if not isinstance(case_id, str) or not case_id:
        raise SafetyEvalError(f"{label}: caseId must be non-empty string")
    request_id = raw_result.get("requestId")
    if request_id is not None and not isinstance(request_id, str):
        raise SafetyEvalError(f"{label}: requestId must be string or null")

    domain_outcomes = raw_result["domainOutcomes"]
    if not isinstance(domain_outcomes, dict) or set(domain_outcomes) != {"safety", "cache", "provider", "streaming"}:
        raise SafetyEvalError(f"{label}: domainOutcomes fields mismatch")

    safety = parse_v2_safety_domain_outcome(domain_outcomes["safety"], f"{label}: domainOutcomes.safety")
    cache_outcome = parse_outcome_group(domain_outcomes["cache"], V2_CACHE_OUTCOMES, f"{label}: domainOutcomes.cache")
    provider_outcome = parse_outcome_group(
        domain_outcomes["provider"],
        V2_PROVIDER_OUTCOMES,
        f"{label}: domainOutcomes.provider",
    )
    streaming_outcome = parse_outcome_group(
        domain_outcomes["streaming"],
        V2_STREAMING_OUTCOMES,
        f"{label}: domainOutcomes.streaming",
    )
    gateway_effects = GatewayEffects.from_dict(
        raw_result["gatewayEffects"],
        f"{label}: gatewayEffects",
        contract_version="v2",
    )
    safety_outcome = safety["outcome"]
    if safety_outcome == "blocked":
        if gateway_effects.terminal_status != "blocked":
            raise SafetyEvalError(f"{label}: blocked safety outcome must use terminalStatus=blocked")
        if cache_outcome != "bypassed" or provider_outcome != "not_called" or streaming_outcome != "not_streaming":
            raise SafetyEvalError(f"{label}: blocked safety domain outcomes mismatch")
    elif gateway_effects.terminal_status == "blocked":
        raise SafetyEvalError(f"{label}: terminalStatus=blocked requires safety.outcome=blocked in v2 safety eval")

    return ActualResult(
        case_id=case_id,
        action=v2_safety_outcome_to_action(safety_outcome),
        detected_types=tuple(sorted(safety["detector_categories"])),
        detected_count=safety["detected_count"],
        redacted_prompt_preview=None,
        block_reason="sensitive_data_blocked" if safety_outcome == "blocked" else None,
        security_policy_hash=safety["security_policy_hash"],
        gateway_effects=gateway_effects,
        request_id=request_id,
        safety_outcome=safety_outcome,
    )


def parse_v2_safety_domain_outcome(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {"outcome", "detectorSummary", "policyBasis"}:
        raise SafetyEvalError(f"{label}: safety outcome fields mismatch")
    outcome = value["outcome"]
    if outcome not in V2_SAFETY_OUTCOMES:
        raise SafetyEvalError(f"{label}: invalid safety outcome {outcome!r}")

    detector_summary = value["detectorSummary"]
    if not isinstance(detector_summary, dict):
        raise SafetyEvalError(f"{label}: detectorSummary must be an object")
    if set(detector_summary) not in ({"detectedCount"}, {"detectedCount", "detectorCategories"}):
        raise SafetyEvalError(f"{label}: detectorSummary fields mismatch")
    detected_count = detector_summary["detectedCount"]
    detector_categories = detector_summary.get("detectorCategories", [])
    if not isinstance(detected_count, int) or detected_count < 0:
        raise SafetyEvalError(f"{label}: detectedCount must be non-negative integer")
    if not isinstance(detector_categories, list):
        raise SafetyEvalError(f"{label}: detectorCategories must be an array")
    if len(detector_categories) != len(set(detector_categories)):
        raise SafetyEvalError(f"{label}: detectorCategories must be unique")
    for category in detector_categories:
        if not isinstance(category, str) or not SANITIZED_CATEGORY_PATTERN.fullmatch(category):
            raise SafetyEvalError(f"{label}: invalid detector category {category!r}")
    if detected_count < len(detector_categories):
        raise SafetyEvalError(f"{label}: detectedCount cannot be less than detectorCategories length")

    policy_basis = value["policyBasis"]
    if not isinstance(policy_basis, dict) or set(policy_basis) != {
        "runtimeSnapshotId",
        "runtimeSnapshotVersion",
        "securityPolicyHash",
    }:
        raise SafetyEvalError(f"{label}: policyBasis fields mismatch")
    runtime_snapshot_id = policy_basis["runtimeSnapshotId"]
    runtime_snapshot_version = policy_basis["runtimeSnapshotVersion"]
    security_policy_hash = policy_basis["securityPolicyHash"]
    if not isinstance(runtime_snapshot_id, str) or not runtime_snapshot_id:
        raise SafetyEvalError(f"{label}: runtimeSnapshotId must be non-empty string")
    if not isinstance(runtime_snapshot_version, int) or runtime_snapshot_version < 1:
        raise SafetyEvalError(f"{label}: runtimeSnapshotVersion must be positive integer")
    if not isinstance(security_policy_hash, str) or not security_policy_hash:
        raise SafetyEvalError(f"{label}: securityPolicyHash must be non-empty string")

    return {
        "outcome": outcome,
        "detected_count": detected_count,
        "detector_categories": detector_categories,
        "security_policy_hash": security_policy_hash,
    }


def parse_outcome_group(value: Any, allowed_outcomes: set[str], label: str) -> str:
    if not isinstance(value, dict) or set(value) != {"outcome"}:
        raise SafetyEvalError(f"{label}: outcome group fields mismatch")
    outcome = value["outcome"]
    if outcome not in allowed_outcomes:
        raise SafetyEvalError(f"{label}: invalid outcome {outcome!r}")
    return outcome


def v2_safety_outcome_to_action(outcome: str) -> str:
    return {
        "passed": "none",
        "redacted": "redacted",
        "blocked": "blocked",
        "not_checked": "not_checked",
    }[outcome]
