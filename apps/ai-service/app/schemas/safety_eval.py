from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


REPORT_VERSION = "safety-eval-report.v1"

DETECTOR_TYPES = {
    "email",
    "phone_number",
    "resident_registration_number",
    "api_key",
    "authorization_header",
    "jwt",
    "private_key",
}

ALLOWED_ACTIONS = {"none", "redacted", "blocked"}
REQUIRED_ACTIONS = {"none", "redacted", "blocked"}
ALLOWED_TERMINAL_STATUSES = {
    "success",
    "cache_hit",
    "blocked",
    "rate_limited",
    "error",
    "cancelled",
}
ALLOWED_ERROR_CODES = {None, "sensitive_data_blocked"}


class SafetyEvalError(ValueError):
    """Raised when safety eval inputs violate the v1 evaluation contract."""


@dataclass(frozen=True)
class GatewayEffects:
    provider_called: bool
    cache_lookup: bool
    terminal_status: str
    http_status: int
    error_code: str | None

    @classmethod
    def from_dict(cls, value: dict[str, Any], label: str) -> GatewayEffects:
        if set(value) != {
            "providerCalled",
            "cacheLookup",
            "terminalStatus",
            "httpStatus",
            "errorCode",
        }:
            raise SafetyEvalError(f"{label}: gateway effects fields mismatch")
        provider_called = value["providerCalled"]
        cache_lookup = value["cacheLookup"]
        terminal_status = value["terminalStatus"]
        http_status = value["httpStatus"]
        error_code = value["errorCode"]
        if not isinstance(provider_called, bool):
            raise SafetyEvalError(f"{label}: providerCalled must be boolean")
        if not isinstance(cache_lookup, bool):
            raise SafetyEvalError(f"{label}: cacheLookup must be boolean")
        if terminal_status not in ALLOWED_TERMINAL_STATUSES:
            raise SafetyEvalError(f"{label}: invalid terminalStatus {terminal_status!r}")
        if not isinstance(http_status, int) or not 100 <= http_status <= 599:
            raise SafetyEvalError(f"{label}: invalid httpStatus")
        if error_code not in ALLOWED_ERROR_CODES:
            raise SafetyEvalError(f"{label}: invalid errorCode {error_code!r}")
        return cls(
            provider_called=provider_called,
            cache_lookup=cache_lookup,
            terminal_status=terminal_status,
            http_status=http_status,
            error_code=error_code,
        )

    def to_report(self) -> dict[str, Any]:
        return {
            "providerCalled": self.provider_called,
            "cacheLookup": self.cache_lookup,
            "terminalStatus": self.terminal_status,
            "httpStatus": self.http_status,
            "errorCode": self.error_code,
        }


@dataclass(frozen=True)
class SafetyDecision:
    action: str
    detected_types: tuple[str, ...]
    detected_count: int
    redacted_prompt_preview: str | None
    block_reason: str | None
    security_policy_hash: str
    detected_type_counts: dict[str, int] = field(default_factory=dict)

    @classmethod
    def from_dict(
        cls,
        value: dict[str, Any],
        label: str,
        *,
        allow_detected_type_counts: bool = False,
    ) -> SafetyDecision:
        required_fields = {
            "action",
            "detectedTypes",
            "detectedCount",
            "redactedPromptPreview",
            "blockReason",
            "securityPolicyHash",
        }
        allowed_fields = set(required_fields)
        if allow_detected_type_counts:
            allowed_fields.add("detectedTypeCounts")
        if set(value) != allowed_fields and not (
            allow_detected_type_counts and set(value) == required_fields
        ):
            raise SafetyEvalError(f"{label}: safety decision fields mismatch")

        action = value["action"]
        detected_types = value["detectedTypes"]
        detected_count = value["detectedCount"]
        preview = value["redactedPromptPreview"]
        block_reason = value["blockReason"]
        security_policy_hash = value["securityPolicyHash"]

        if action not in ALLOWED_ACTIONS:
            raise SafetyEvalError(f"{label}: invalid action {action!r}")
        if not isinstance(detected_types, list):
            raise SafetyEvalError(f"{label}: detectedTypes must be an array")
        if len(detected_types) != len(set(detected_types)):
            raise SafetyEvalError(f"{label}: detectedTypes must be unique")
        if not set(detected_types).issubset(DETECTOR_TYPES):
            raise SafetyEvalError(f"{label}: unknown detectedTypes {detected_types!r}")
        if not isinstance(detected_count, int) or detected_count < 0:
            raise SafetyEvalError(f"{label}: detectedCount must be non-negative integer")
        if detected_count < len(detected_types):
            raise SafetyEvalError(f"{label}: detectedCount cannot be less than detectedTypes length")
        if preview is not None and not isinstance(preview, str):
            raise SafetyEvalError(f"{label}: redactedPromptPreview must be string or null")
        if block_reason is not None and not isinstance(block_reason, str):
            raise SafetyEvalError(f"{label}: blockReason must be string or null")
        if not isinstance(security_policy_hash, str) or not security_policy_hash:
            raise SafetyEvalError(f"{label}: securityPolicyHash must be non-empty string")

        type_counts = parse_detected_type_counts(
            value.get("detectedTypeCounts", {}),
            f"{label}: detectedTypeCounts",
        )
        return cls(
            action=action,
            detected_types=tuple(sorted(detected_types)),
            detected_count=detected_count,
            redacted_prompt_preview=preview,
            block_reason=block_reason,
            security_policy_hash=security_policy_hash,
            detected_type_counts=type_counts,
        )


@dataclass(frozen=True)
class CorpusCase:
    case_id: str
    input_template: str
    placeholder_bindings: dict[str, str]
    expected_safety_decision: SafetyDecision
    expected_gateway_effects: GatewayEffects
    tags: tuple[str, ...]
    expected_type_counts: dict[str, int]


@dataclass(frozen=True)
class ActualResult:
    case_id: str
    action: str
    detected_types: tuple[str, ...]
    detected_count: int
    redacted_prompt_preview: str | None
    block_reason: str | None
    security_policy_hash: str
    gateway_effects: GatewayEffects | None = None
    detected_type_counts: dict[str, int] = field(default_factory=dict)
    request_id: str | None = None
    prompt_hash: str | None = None


def parse_detected_type_counts(value: Any, label: str) -> dict[str, int]:
    if value in ({}, None):
        return {}
    if not isinstance(value, dict):
        raise SafetyEvalError(f"{label}: must be an object")
    parsed: dict[str, int] = {}
    for detector_type, count in value.items():
        if detector_type not in DETECTOR_TYPES:
            raise SafetyEvalError(f"{label}: unknown detector type {detector_type!r}")
        if not isinstance(count, int) or count < 0:
            raise SafetyEvalError(f"{label}: count for {detector_type!r} must be non-negative integer")
        parsed[detector_type] = count
    return parsed
