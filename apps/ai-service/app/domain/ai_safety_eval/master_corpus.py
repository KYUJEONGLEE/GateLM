from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from string import Formatter
from typing import Any

from app.schemas.safety_eval import DETECTOR_TYPES


MASTER_CORPUS_EXTRA_DETECTOR_TYPES = frozenset(
    {
        "confidential_business_context",
        "sensitive_health_context",
    }
)
ALLOWED_DETECTOR_TYPES = DETECTOR_TYPES | MASTER_CORPUS_EXTRA_DETECTOR_TYPES
TOP_LEVEL_FIELDS = frozenset(
    {
        "caseId",
        "locale",
        "inputTemplate",
        "placeholderBindings",
        "expectations",
        "tags",
    }
)
EXPECTATION_FIELDS = frozenset({"gateway", "detector"})
GATEWAY_FIELDS = frozenset(
    {
        "safetyOutcome",
        "providerCalled",
        "cacheLookup",
        "streamingStarted",
        "terminalStatus",
        "httpStatus",
        "errorCode",
    }
)
DETECTOR_FIELDS = frozenset({"outcome", "mode", "detectedTypes", "detectedCount", "blockReason"})
SAFETY_OUTCOMES = frozenset({"passed", "redacted", "blocked"})
TERMINAL_STATUSES = frozenset({"success", "blocked", "rate_limited", "failed", "cancelled"})
MODES = frozenset({"shadow", "enforce"})
ERROR_CODES = frozenset({None, "sensitive_data_blocked", "safety_timeout"})
CASE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
PLACEHOLDER_PATTERN = re.compile(r"^SYNTHETIC_[A-Z0-9_]+$")
TAG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class MasterEvalError(ValueError):
    """Raised when the AI Safety Lab master corpus violates its contract."""


@dataclass(frozen=True)
class GatewayExpectation:
    safety_outcome: str
    provider_called: bool
    cache_lookup: bool
    streaming_started: bool
    terminal_status: str
    http_status: int
    error_code: str | None


@dataclass(frozen=True)
class DetectorExpectation:
    outcome: str
    mode: str
    detected_types: tuple[str, ...]
    detected_count: int
    block_reason: str | None


@dataclass(frozen=True)
class TargetExpectations:
    gateway: GatewayExpectation
    detector: DetectorExpectation


@dataclass(frozen=True)
class MasterEvalCase:
    case_id: str
    locale: str
    input_template: str
    placeholder_bindings: dict[str, str]
    expectations: TargetExpectations
    tags: tuple[str, ...]


def load_master_eval_corpus(corpus_path: Path) -> list[MasterEvalCase]:
    if not corpus_path.exists():
        raise MasterEvalError(f"master corpus not found: {corpus_path}")

    cases: list[MasterEvalCase] = []
    for line_number, line in enumerate(corpus_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            raise MasterEvalError(f"blank master corpus line at {line_number}")
        try:
            raw_case = json.loads(line)
        except json.JSONDecodeError as exc:
            raise MasterEvalError(f"master corpus JSONL parse failed at line {line_number}: {exc}") from exc
        if not isinstance(raw_case, dict):
            raise MasterEvalError(f"master corpus line {line_number} is not an object")
        cases.append(parse_master_eval_case(raw_case, line_number))

    validate_master_eval_coverage(cases)
    return cases


def render_master_eval_prompt(case: MasterEvalCase) -> str:
    values = {
        placeholder: _synthetic_value_for_detector_type(detector_type)
        for placeholder, detector_type in case.placeholder_bindings.items()
    }
    try:
        return case.input_template.format(**values)
    except KeyError as exc:
        raise MasterEvalError(f"{case.case_id}: missing synthetic placeholder value {exc}") from exc


def parse_master_eval_case(raw_case: dict[str, Any], line_number: int) -> MasterEvalCase:
    label = _label(raw_case, line_number)
    if set(raw_case) != TOP_LEVEL_FIELDS:
        raise MasterEvalError(f"{label}: top-level fields mismatch: {sorted(raw_case)}")

    case_id = raw_case["caseId"]
    locale = raw_case["locale"]
    input_template = raw_case["inputTemplate"]
    placeholder_bindings = raw_case["placeholderBindings"]
    tags = raw_case["tags"]

    if not isinstance(case_id, str) or CASE_ID_PATTERN.fullmatch(case_id) is None:
        raise MasterEvalError(f"{label}: invalid caseId")
    if not isinstance(locale, str) or not locale:
        raise MasterEvalError(f"{label}: locale must be a non-empty string")
    if not isinstance(input_template, str) or not input_template:
        raise MasterEvalError(f"{label}: inputTemplate must be a non-empty string")
    if not isinstance(placeholder_bindings, dict):
        raise MasterEvalError(f"{label}: placeholderBindings must be an object")
    if not isinstance(tags, list) or not tags:
        raise MasterEvalError(f"{label}: tags must be a non-empty array")
    if not all(isinstance(tag, str) and TAG_PATTERN.fullmatch(tag) for tag in tags):
        raise MasterEvalError(f"{label}: invalid tag value")

    placeholders = placeholders_for(input_template)
    if placeholders != set(placeholder_bindings):
        raise MasterEvalError(
            f"{label}: placeholders {sorted(placeholders)} do not match bindings {sorted(placeholder_bindings)}"
        )
    parsed_bindings = _parse_placeholder_bindings(placeholder_bindings, label)
    expectations = _parse_expectations(raw_case["expectations"], label)

    return MasterEvalCase(
        case_id=case_id,
        locale=locale,
        input_template=input_template,
        placeholder_bindings=parsed_bindings,
        expectations=expectations,
        tags=tuple(tags),
    )


def placeholders_for(template: str) -> set[str]:
    placeholders: set[str] = set()
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name:
            placeholders.add(field_name)
    return placeholders


def validate_master_eval_coverage(cases: list[MasterEvalCase]) -> None:
    if not cases:
        raise MasterEvalError("master corpus is empty")

    seen_case_ids: set[str] = set()
    for case in cases:
        if case.case_id in seen_case_ids:
            raise MasterEvalError(f"duplicate master corpus caseId {case.case_id}")
        seen_case_ids.add(case.case_id)


def _parse_placeholder_bindings(value: dict[str, Any], label: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for placeholder, detector_type in value.items():
        if not isinstance(placeholder, str) or PLACEHOLDER_PATTERN.fullmatch(placeholder) is None:
            raise MasterEvalError(f"{label}: invalid placeholder name {placeholder!r}")
        if not isinstance(detector_type, str) or detector_type not in ALLOWED_DETECTOR_TYPES:
            raise MasterEvalError(f"{label}: invalid placeholder detector type {detector_type!r}")
        parsed[placeholder] = detector_type
    return parsed


def _parse_expectations(value: Any, label: str) -> TargetExpectations:
    if not isinstance(value, dict):
        raise MasterEvalError(f"{label}: expectations must be an object")
    if set(value) != EXPECTATION_FIELDS:
        raise MasterEvalError(f"{label}: expectations fields mismatch")
    return TargetExpectations(
        gateway=_parse_gateway_expectation(value["gateway"], label),
        detector=_parse_detector_expectation(value["detector"], label),
    )


def _parse_gateway_expectation(value: Any, label: str) -> GatewayExpectation:
    if not isinstance(value, dict):
        raise MasterEvalError(f"{label}: gateway expectation must be an object")
    if set(value) != GATEWAY_FIELDS:
        raise MasterEvalError(f"{label}: gateway expectation fields mismatch")
    safety_outcome = value["safetyOutcome"]
    provider_called = value["providerCalled"]
    cache_lookup = value["cacheLookup"]
    streaming_started = value["streamingStarted"]
    terminal_status = value["terminalStatus"]
    http_status = value["httpStatus"]
    error_code = value["errorCode"]
    if safety_outcome not in SAFETY_OUTCOMES:
        raise MasterEvalError(f"{label}: invalid gateway safetyOutcome {safety_outcome!r}")
    if not isinstance(provider_called, bool):
        raise MasterEvalError(f"{label}: providerCalled must be boolean")
    if not isinstance(cache_lookup, bool):
        raise MasterEvalError(f"{label}: cacheLookup must be boolean")
    if not isinstance(streaming_started, bool):
        raise MasterEvalError(f"{label}: streamingStarted must be boolean")
    if terminal_status not in TERMINAL_STATUSES:
        raise MasterEvalError(f"{label}: invalid terminalStatus {terminal_status!r}")
    if not isinstance(http_status, int) or not 100 <= http_status <= 599:
        raise MasterEvalError(f"{label}: invalid httpStatus")
    if error_code not in ERROR_CODES:
        raise MasterEvalError(f"{label}: invalid errorCode {error_code!r}")
    if terminal_status == "blocked" and (provider_called or cache_lookup or streaming_started):
        raise MasterEvalError(f"{label}: blocked gateway path must not call provider, cache, or streaming")
    return GatewayExpectation(
        safety_outcome=safety_outcome,
        provider_called=provider_called,
        cache_lookup=cache_lookup,
        streaming_started=streaming_started,
        terminal_status=terminal_status,
        http_status=http_status,
        error_code=error_code,
    )


def _parse_detector_expectation(value: Any, label: str) -> DetectorExpectation:
    if not isinstance(value, dict):
        raise MasterEvalError(f"{label}: detector expectation must be an object")
    if set(value) != DETECTOR_FIELDS:
        raise MasterEvalError(f"{label}: detector expectation fields mismatch")
    outcome = value["outcome"]
    mode = value["mode"]
    detected_types = value["detectedTypes"]
    detected_count = value["detectedCount"]
    block_reason = value["blockReason"]
    if outcome not in SAFETY_OUTCOMES:
        raise MasterEvalError(f"{label}: invalid detector outcome {outcome!r}")
    if mode not in MODES:
        raise MasterEvalError(f"{label}: invalid detector mode {mode!r}")
    if not isinstance(detected_types, list):
        raise MasterEvalError(f"{label}: detector detectedTypes must be an array")
    if len(detected_types) != len(set(detected_types)):
        raise MasterEvalError(f"{label}: detector detectedTypes must be unique")
    if not set(detected_types).issubset(ALLOWED_DETECTOR_TYPES):
        raise MasterEvalError(f"{label}: unknown detector detectedTypes {detected_types!r}")
    if not isinstance(detected_count, int) or detected_count < 0:
        raise MasterEvalError(f"{label}: detector detectedCount must be a non-negative integer")
    if detected_count < len(detected_types):
        raise MasterEvalError(f"{label}: detector detectedCount cannot be less than detectedTypes length")
    if block_reason is not None and block_reason != "sensitive_data_blocked":
        raise MasterEvalError(f"{label}: invalid detector blockReason {block_reason!r}")
    if outcome == "blocked" and block_reason != "sensitive_data_blocked":
        raise MasterEvalError(f"{label}: blocked detector outcome requires sensitive_data_blocked")
    if outcome != "blocked" and block_reason is not None:
        raise MasterEvalError(f"{label}: non-blocked detector outcome must not have blockReason")
    return DetectorExpectation(
        outcome=outcome,
        mode=mode,
        detected_types=tuple(sorted(str(item) for item in detected_types)),
        detected_count=detected_count,
        block_reason=block_reason,
    )


def _synthetic_value_for_detector_type(detector_type: str) -> str:
    values = {
        "account_id": "SYNTHETIC-ORDER-0001",
        "account_number": "SYNTHETIC-ACCOUNT-0001",
        "confidential_business_context": "SYNTHETIC_CONFIDENTIAL_METRIC_VALUE",
        "person_name": "Synthetic Person",
        "phone_number": "010-0000-0000",
        "postal_address": "Synthetic District 123",
        "private_date": "1999-03-02",
        "private_url": "https://example.test/reset?token=SYNTHETIC_TOKEN",
        "provider_api_key": "SYNTHETIC_PROVIDER_KEY_VALUE",
        "resident_registration_number": "900101-0000000",
        "secret": "synthetic-secret-value",
        "sensitive_health_context": "SYNTHETIC_HEALTH_CONTEXT",
    }
    return values.get(detector_type, f"SYNTHETIC_{detector_type.upper()}_VALUE")


def _label(raw_case: dict[str, Any], line_number: int) -> str:
    case_id = raw_case.get("caseId")
    if isinstance(case_id, str) and case_id:
        return case_id
    return f"line {line_number}"
