from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any


REPORT_VERSION_V1 = "safety-eval-report.v1"
REPORT_VERSION_V2 = "safety-eval-report.v2"
REPORT_VERSION = REPORT_VERSION_V1

DETECTOR_TYPES = {
    "email",
    "phone_number",
    "postal_address",
    "date_of_birth",
    "private_date",
    "private_url",
    "person_name",
    "customer_id",
    "employee_id",
    "account_id",
    "account_number",
    "ip_address",
    "resident_registration_number",
    "api_key",
    "provider_api_key",
    "cloud_access_key",
    "github_token",
    "slack_token",
    "database_url",
    "webhook_url",
    "password_assignment",
    "session_cookie",
    "credit_card",
    "bank_account",
    "passport_number",
    "driver_license",
    "authorization_header",
    "jwt",
    "private_key",
    "secret",
}

ALLOWED_ACTIONS = {"none", "redacted", "blocked"}
REQUIRED_ACTIONS = {"none", "redacted", "blocked"}
V2_ALLOWED_TERMINAL_STATUSES = {
    "success",
    "blocked",
    "rate_limited",
    "failed",
    "cancelled",
}
V1_ALLOWED_TERMINAL_STATUSES = V2_ALLOWED_TERMINAL_STATUSES | {
    "cache_hit",
    "error",
}
ALLOWED_TERMINAL_STATUSES = V2_ALLOWED_TERMINAL_STATUSES
ALLOWED_ERROR_CODES = {None, "sensitive_data_blocked"}
V2_SAFETY_OUTCOMES = {"passed", "redacted", "blocked", "not_checked"}
V2_CACHE_OUTCOMES = {"hit", "miss", "bypassed", "error", "not_used"}
V2_PROVIDER_OUTCOMES = {"success", "timeout", "error", "unauthorized", "not_called"}
V2_STREAMING_OUTCOMES = {"not_streaming", "started", "completed", "interrupted", "cancelled"}
SANITIZED_CATEGORY_PATTERN = re.compile(r"^[a-z][a-z0-9_\-]*$")


class SafetyEvalError(ValueError):
    """Raised when safety eval inputs violate the evaluation contract."""


@dataclass(frozen=True)
class GatewayEffects:
    provider_called: bool
    cache_lookup: bool
    terminal_status: str
    http_status: int
    error_code: str | None
    cache_write: bool | None = None
    streaming_started: bool | None = None

    @classmethod
    def from_dict(
        cls,
        value: dict[str, Any],
        label: str,
        *,
        contract_version: str = "v1",
    ) -> GatewayEffects:
        if not isinstance(value, dict):
            raise SafetyEvalError(f"{label}: must be an object")
        expected_fields = {
            "providerCalled",
            "cacheLookup",
            "terminalStatus",
            "httpStatus",
            "errorCode",
        }
        if contract_version == "v2":
            expected_fields |= {"cacheWrite", "streamingStarted"}
            allowed_terminal_statuses = V2_ALLOWED_TERMINAL_STATUSES
        elif contract_version == "v1":
            allowed_terminal_statuses = V1_ALLOWED_TERMINAL_STATUSES
        else:
            raise SafetyEvalError(f"{label}: unsupported contract version {contract_version!r}")

        if set(value) != expected_fields:
            raise SafetyEvalError(f"{label}: gateway effects fields mismatch")
        provider_called = value["providerCalled"]
        cache_lookup = value["cacheLookup"]
        terminal_status = value["terminalStatus"]
        http_status = value["httpStatus"]
        error_code = value["errorCode"]
        cache_write = value.get("cacheWrite")
        streaming_started = value.get("streamingStarted")
        if not isinstance(provider_called, bool):
            raise SafetyEvalError(f"{label}: providerCalled must be boolean")
        if not isinstance(cache_lookup, bool):
            raise SafetyEvalError(f"{label}: cacheLookup must be boolean")
        if contract_version == "v2" and not isinstance(cache_write, bool):
            raise SafetyEvalError(f"{label}: cacheWrite must be boolean")
        if contract_version == "v2" and not isinstance(streaming_started, bool):
            raise SafetyEvalError(f"{label}: streamingStarted must be boolean")
        if terminal_status not in allowed_terminal_statuses:
            raise SafetyEvalError(f"{label}: invalid terminalStatus {terminal_status!r}")
        if not isinstance(http_status, int) or not 100 <= http_status <= 599:
            raise SafetyEvalError(f"{label}: invalid httpStatus")
        if error_code not in ALLOWED_ERROR_CODES:
            raise SafetyEvalError(f"{label}: invalid errorCode {error_code!r}")
        if (
            contract_version == "v2"
            and terminal_status == "blocked"
            and (provider_called or cache_write or streaming_started)
        ):
            raise SafetyEvalError(
                f"{label}: blocked safety path must not call provider, write cache, or start streaming"
            )
        return cls(
            provider_called=provider_called,
            cache_lookup=cache_lookup,
            terminal_status=terminal_status,
            http_status=http_status,
            error_code=error_code,
            cache_write=cache_write,
            streaming_started=streaming_started,
        )

    def to_report(self) -> dict[str, Any]:
        report = {
            "providerCalled": self.provider_called,
            "cacheLookup": self.cache_lookup,
            "terminalStatus": self.terminal_status,
            "httpStatus": self.http_status,
            "errorCode": self.error_code,
        }
        if self.cache_write is not None:
            report["cacheWrite"] = self.cache_write
        if self.streaming_started is not None:
            report["streamingStarted"] = self.streaming_started
        return report


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
    safety_outcome: str | None = None


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
