from __future__ import annotations

import json
import re
from pathlib import Path
from string import Formatter
from typing import Any, Iterable

from app.schemas.safety_eval import (
    ALLOWED_ACTIONS,
    DETECTOR_TYPES,
    REQUIRED_ACTIONS,
    CorpusCase,
    GatewayEffects,
    SafetyDecision,
    SafetyEvalError,
)


REQUIRED_TOP_LEVEL_FIELDS = {
    "caseId",
    "inputTemplate",
    "placeholderBindings",
    "expectedSafetyDecision",
    "expectedGatewayEffects",
    "tags",
}
REDACT_DETECTOR_TYPES = {
    "email",
    "phone_number",
    "postal_address",
    "date_of_birth",
    "person_name",
    "customer_id",
    "employee_id",
    "account_id",
    "ip_address",
}
BLOCK_DETECTOR_TYPES = DETECTOR_TYPES - REDACT_DETECTOR_TYPES


def load_corpus(corpus_path: Path, schema_path: Path | None = None) -> list[CorpusCase]:
    if schema_path is not None:
        validate_schema_title(schema_path)
    if not corpus_path.exists():
        raise SafetyEvalError(f"corpus not found: {corpus_path}")

    cases: list[CorpusCase] = []
    for line_number, line in enumerate(corpus_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            raise SafetyEvalError(f"blank JSONL line at {line_number}")
        try:
            raw_case = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SafetyEvalError(f"corpus JSONL parse failed at line {line_number}: {exc}") from exc
        if not isinstance(raw_case, dict):
            raise SafetyEvalError(f"corpus line {line_number} is not an object")
        cases.append(parse_corpus_case(raw_case, line_number))

    validate_coverage(cases)
    return cases


def validate_schema_title(schema_path: Path) -> None:
    if not schema_path.exists():
        raise SafetyEvalError(f"schema not found: {schema_path}")
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SafetyEvalError(f"schema JSON parse failed: {exc}") from exc
    if schema.get("title") != "GateLM v1 Safety Eval Corpus Line":
        raise SafetyEvalError("schema title mismatch")


def parse_corpus_case(raw_case: dict[str, Any], index: int) -> CorpusCase:
    label = raw_case.get("caseId", f"line {index}")
    if set(raw_case) != REQUIRED_TOP_LEVEL_FIELDS:
        raise SafetyEvalError(f"{label}: top-level fields mismatch: {sorted(raw_case)}")

    case_id = raw_case["caseId"]
    input_template = raw_case["inputTemplate"]
    placeholder_bindings = raw_case["placeholderBindings"]
    tags = raw_case["tags"]

    if not isinstance(case_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_\-]*", case_id):
        raise SafetyEvalError(f"{label}: invalid caseId")
    if not isinstance(input_template, str) or not input_template:
        raise SafetyEvalError(f"{label}: inputTemplate must be a non-empty string")
    if not isinstance(placeholder_bindings, dict):
        raise SafetyEvalError(f"{label}: placeholderBindings must be an object")
    if not isinstance(tags, list) or not tags:
        raise SafetyEvalError(f"{label}: tags must be a non-empty array")
    if not all(isinstance(tag, str) and re.fullmatch(r"[a-z0-9][a-z0-9_\-]*", tag) for tag in tags):
        raise SafetyEvalError(f"{label}: invalid tag value")

    placeholders = placeholders_for(input_template)
    if placeholders != set(placeholder_bindings):
        raise SafetyEvalError(
            f"{label}: placeholders {sorted(placeholders)} do not match bindings {sorted(placeholder_bindings)}"
        )
    for placeholder, detector_type in placeholder_bindings.items():
        if not isinstance(placeholder, str) or not re.fullmatch(r"SYNTHETIC_[A-Z0-9_]+", placeholder):
            raise SafetyEvalError(f"{label}: invalid placeholder name {placeholder!r}")
        if detector_type not in DETECTOR_TYPES:
            raise SafetyEvalError(f"{label}: invalid placeholder detector type {detector_type!r}")

    expected_decision = SafetyDecision.from_dict(
        raw_case["expectedSafetyDecision"],
        f"{label}: expectedSafetyDecision",
    )
    expected_effects = GatewayEffects.from_dict(
        raw_case["expectedGatewayEffects"],
        f"{label}: expectedGatewayEffects",
    )
    expected_type_counts = count_expected_detector_types(input_template, placeholder_bindings)
    validate_case_semantics(
        case_id,
        placeholder_bindings,
        expected_decision,
        expected_effects,
        expected_type_counts,
    )

    return CorpusCase(
        case_id=case_id,
        input_template=input_template,
        placeholder_bindings={str(k): str(v) for k, v in placeholder_bindings.items()},
        expected_safety_decision=expected_decision,
        expected_gateway_effects=expected_effects,
        tags=tuple(tags),
        expected_type_counts=expected_type_counts,
    )


def placeholders_for(template: str) -> set[str]:
    names: set[str] = set()
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name:
            names.add(field_name)
    return names


def ordered_placeholders_for(template: str) -> list[str]:
    names: list[str] = []
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name:
            names.append(field_name)
    return names


def count_expected_detector_types(template: str, bindings: dict[str, str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for placeholder in ordered_placeholders_for(template):
        detector_type = bindings[placeholder]
        counts[detector_type] = counts.get(detector_type, 0) + 1
    return counts


def validate_case_semantics(
    case_id: str,
    placeholder_bindings: dict[str, str],
    decision: SafetyDecision,
    effects: GatewayEffects,
    expected_type_counts: dict[str, int],
) -> None:
    detected_types = set(decision.detected_types)
    binding_types = set(placeholder_bindings.values())
    if detected_types != binding_types:
        raise SafetyEvalError(f"{case_id}: detectedTypes must match placeholder binding detector types")
    if decision.detected_count != sum(expected_type_counts.values()):
        raise SafetyEvalError(f"{case_id}: detectedCount must match placeholder occurrence count")

    if decision.action == "none":
        if detected_types:
            raise SafetyEvalError(f"{case_id}: none action must not have detections")
        if decision.block_reason is not None:
            raise SafetyEvalError(f"{case_id}: none action must not have blockReason")
        if effects != GatewayEffects(True, True, "success", 200, None):
            raise SafetyEvalError(f"{case_id}: none action gateway effects mismatch")
    elif decision.action == "redacted":
        if not detected_types:
            raise SafetyEvalError(f"{case_id}: redacted action requires detections")
        if not detected_types.issubset(REDACT_DETECTOR_TYPES):
            raise SafetyEvalError(f"{case_id}: redacted action contains non-redacting detector type")
        if decision.block_reason is not None:
            raise SafetyEvalError(f"{case_id}: redacted action must not have blockReason")
        if effects != GatewayEffects(True, True, "success", 200, None):
            raise SafetyEvalError(f"{case_id}: redacted action gateway effects mismatch")
    elif decision.action == "blocked":
        if not detected_types:
            raise SafetyEvalError(f"{case_id}: blocked action requires detections")
        if not detected_types.issubset(BLOCK_DETECTOR_TYPES):
            raise SafetyEvalError(f"{case_id}: blocked action contains non-blocking detector type")
        if decision.block_reason != "sensitive_data_blocked":
            raise SafetyEvalError(f"{case_id}: blocked action blockReason must be sensitive_data_blocked")
        if effects != GatewayEffects(False, False, "blocked", 403, "sensitive_data_blocked"):
            raise SafetyEvalError(f"{case_id}: blocked action gateway effects mismatch")

    if decision.action not in ALLOWED_ACTIONS:
        raise SafetyEvalError(f"{case_id}: invalid action {decision.action}")


def validate_coverage(cases: list[CorpusCase]) -> None:
    if not cases:
        raise SafetyEvalError("corpus is empty")

    seen_case_ids: set[str] = set()
    seen_actions: set[str] = set()
    seen_detectors: set[str] = set()

    for case in cases:
        if case.case_id in seen_case_ids:
            raise SafetyEvalError(f"duplicate caseId {case.case_id}")
        seen_case_ids.add(case.case_id)
        seen_actions.add(case.expected_safety_decision.action)
        seen_detectors.update(case.expected_safety_decision.detected_types)

    missing_actions = REQUIRED_ACTIONS - seen_actions
    if missing_actions:
        raise SafetyEvalError(f"missing action coverage: {sorted(missing_actions)}")
    missing_detectors = DETECTOR_TYPES - seen_detectors
    if missing_detectors:
        raise SafetyEvalError(f"missing detector coverage: {sorted(missing_detectors)}")


def filter_cases(
    cases: Iterable[CorpusCase],
    *,
    tags: set[str] | None = None,
    case_ids: set[str] | None = None,
) -> list[CorpusCase]:
    selected: list[CorpusCase] = []
    for case in cases:
        if tags and not tags.intersection(case.tags):
            continue
        if case_ids and case.case_id not in case_ids:
            continue
        selected.append(case)
    if not selected:
        raise SafetyEvalError("no corpus cases selected")
    return selected
