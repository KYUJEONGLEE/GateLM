from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.schemas.safety_eval import (
    ActualResult,
    GatewayEffects,
    SafetyDecision,
    SafetyEvalError,
    parse_detected_type_counts,
)


MODE_DETECTOR_OUTPUT = "detector_output"
MODE_GATEWAY_SAFETY_OUTPUT = "gateway_safety_output"
REQUIRED_FIXTURE_FIELDS = {"fixtureName", "fixtureVersion", "mode", "results"}


def normalize_mode(mode: str) -> str:
    normalized = mode.strip().replace("-", "_")
    if normalized not in {MODE_DETECTOR_OUTPUT, MODE_GATEWAY_SAFETY_OUTPUT}:
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
        actual = (
            parse_detector_output_result(raw_result, index)
            if normalized_mode == MODE_DETECTOR_OUTPUT
            else parse_gateway_output_result(raw_result, index)
        )
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
