#!/usr/bin/env python3
"""Validate the v1 safety eval corpus without requiring Gateway or AI service."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from string import Formatter
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
V1_DOCS_DIR = ROOT / "docs" / "v1.0.0"
FIXTURES_DIR = V1_DOCS_DIR / "fixtures"
SCHEMAS_DIR = V1_DOCS_DIR / "schemas"
SCHEMA_PATH = SCHEMAS_DIR / "safety-eval-corpus.schema.json"
CORPUS_PATH = FIXTURES_DIR / "safety-eval-corpus.jsonl"

DETECTOR_TYPES = {
    "email",
    "phone_number",
    "resident_registration_number",
    "api_key",
    "authorization_header",
    "jwt",
    "private_key",
}
REQUIRED_ACTIONS = {"none", "redacted", "blocked"}
ALLOWED_ACTIONS = REQUIRED_ACTIONS
ALLOWED_TERMINAL_STATUSES = {
    "success",
    "cache_hit",
    "blocked",
    "rate_limited",
    "error",
    "cancelled",
}
ALLOWED_ERROR_CODES = {None, "sensitive_data_blocked"}
REQUIRED_TOP_LEVEL_FIELDS = {
    "caseId",
    "inputTemplate",
    "placeholderBindings",
    "expectedSafetyDecision",
    "expectedGatewayEffects",
    "tags",
}
REQUIRED_DECISION_FIELDS = {
    "action",
    "detectedTypes",
    "detectedCount",
    "redactedPromptPreview",
    "blockReason",
    "securityPolicyHash",
}
REQUIRED_EFFECT_FIELDS = {
    "providerCalled",
    "cacheLookup",
    "terminalStatus",
    "httpStatus",
    "errorCode",
}
FORBIDDEN_FIELD_NAMES = {
    "rawPrompt",
    "rawResponse",
    "fullRequestBody",
    "fullResponseBody",
    "providerApiKey",
    "apiKeyPlaintext",
    "appTokenPlaintext",
    "authorizationHeader",
    "cookie",
    "rawProviderErrorBody",
    "maskingSampleRawValue",
}
FORBIDDEN_LITERAL_PATTERNS = {
    "openai_like_key": re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{10,}"),
    "anthropic_like_key": re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{10,}"),
    "google_api_key_like": re.compile(r"\bAIza[A-Za-z0-9_\-]{10,}"),
    "aws_access_key_like": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github_token_like": re.compile(r"\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "slack_token_like": re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    "authorization_credential": re.compile(r"Authorization\s*:\s*(?:Bearer|Basic)\s+\S+", re.IGNORECASE),
    "jwt_like": re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b"),
    "private_key_block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "rrn_like": re.compile(r"\b\d{6}[-\s]?[1-8]\d{6}\b"),
}


def _synthetic_values() -> dict[str, str]:
    return {
        "SYNTHETIC_EMAIL": "user" + "@" + "example.invalid",
        "SYNTHETIC_PHONE": "010" + "-" + "0000" + "-" + "0000",
        "SYNTHETIC_RRN": "900101" + "-" + "1000000",
        "SYNTHETIC_API_KEY": "TEST_SECRET_VALUE_" + ("A" * 24),
        "SYNTHETIC_AUTHORIZATION_HEADER": "Authorization" + ": " + "Bearer" + " " + "TESTTOKEN" + ("B" * 24),
        "SYNTHETIC_JWT": ("ey" + "J" + "hbGciOiJub25lIn0") + "." + "eyJzdWIiOiJ0ZXN0In0" + "." + "signature",
        "SYNTHETIC_PRIVATE_KEY": "-----BEGIN " + "TEST PRIVATE KEY-----\nnot-a-real-key\n-----END " + "TEST PRIVATE KEY-----",
    }


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_schema() -> dict[str, Any]:
    if not SCHEMA_PATH.exists():
        fail(f"schema not found: {SCHEMA_PATH}")
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"schema JSON parse failed: {exc}")
    if schema.get("title") != "GateLM v1 Safety Eval Corpus Line":
        fail("schema title mismatch")
    return schema


def load_corpus() -> list[dict[str, Any]]:
    if not CORPUS_PATH.exists():
        fail(f"corpus not found: {CORPUS_PATH}")
    cases: list[dict[str, Any]] = []
    for line_number, line in enumerate(CORPUS_PATH.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            fail(f"blank JSONL line at {line_number}")
        try:
            case = json.loads(line)
        except json.JSONDecodeError as exc:
            fail(f"corpus JSONL parse failed at line {line_number}: {exc}")
        if not isinstance(case, dict):
            fail(f"corpus line {line_number} is not an object")
        cases.append(case)
    if not cases:
        fail("corpus is empty")
    return cases


def scan_forbidden_literals() -> None:
    for path in (SCHEMA_PATH, CORPUS_PATH):
        text = path.read_text(encoding="utf-8")
        for field_name in FORBIDDEN_FIELD_NAMES:
            if re.search(rf'"{re.escape(field_name)}"\s*:', text):
                fail(f"forbidden field name {field_name!r} found in {path}")
        for pattern_name, pattern in FORBIDDEN_LITERAL_PATTERNS.items():
            if pattern.search(text):
                fail(f"forbidden secret-like literal {pattern_name!r} found in {path}")


def placeholders_for(template: str) -> set[str]:
    names: set[str] = set()
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name:
            names.add(field_name)
    return names


def validate_case_shape(case: dict[str, Any], index: int) -> None:
    label = case.get("caseId", f"line {index}")
    actual_fields = set(case)
    if actual_fields != REQUIRED_TOP_LEVEL_FIELDS:
        fail(f"{label}: top-level fields mismatch: {sorted(actual_fields)}")

    if not isinstance(case["caseId"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9_\-]*", case["caseId"]):
        fail(f"{label}: invalid caseId")
    if not isinstance(case["inputTemplate"], str) or not case["inputTemplate"]:
        fail(f"{label}: inputTemplate must be a non-empty string")
    if not isinstance(case["placeholderBindings"], dict):
        fail(f"{label}: placeholderBindings must be an object")
    if not isinstance(case["tags"], list) or not case["tags"]:
        fail(f"{label}: tags must be a non-empty array")
    if not all(isinstance(tag, str) and re.fullmatch(r"[a-z0-9][a-z0-9_\-]*", tag) for tag in case["tags"]):
        fail(f"{label}: invalid tag value")

    placeholders = placeholders_for(case["inputTemplate"])
    bindings = case["placeholderBindings"]
    if placeholders != set(bindings):
        fail(f"{label}: placeholders {sorted(placeholders)} do not match bindings {sorted(bindings)}")
    for placeholder, detector_type in bindings.items():
        if not re.fullmatch(r"SYNTHETIC_[A-Z0-9_]+", placeholder):
            fail(f"{label}: invalid placeholder name {placeholder}")
        if detector_type not in DETECTOR_TYPES:
            fail(f"{label}: invalid placeholder detector type {detector_type}")

    decision = case["expectedSafetyDecision"]
    if not isinstance(decision, dict) or set(decision) != REQUIRED_DECISION_FIELDS:
        fail(f"{label}: expectedSafetyDecision fields mismatch")
    if decision["action"] not in ALLOWED_ACTIONS:
        fail(f"{label}: invalid action {decision['action']}")
    if not isinstance(decision["detectedTypes"], list):
        fail(f"{label}: detectedTypes must be an array")
    if len(decision["detectedTypes"]) != len(set(decision["detectedTypes"])):
        fail(f"{label}: detectedTypes must be unique")
    if not set(decision["detectedTypes"]).issubset(DETECTOR_TYPES):
        fail(f"{label}: unknown detectedTypes {decision['detectedTypes']}")
    if not isinstance(decision["detectedCount"], int) or decision["detectedCount"] < 0:
        fail(f"{label}: detectedCount must be a non-negative integer")
    if decision["detectedCount"] != len(decision["detectedTypes"]):
        fail(f"{label}: detectedCount must equal detectedTypes length for Phase 0 corpus")
    if decision["redactedPromptPreview"] is not None and not isinstance(decision["redactedPromptPreview"], str):
        fail(f"{label}: redactedPromptPreview must be string or null")
    if decision["blockReason"] is not None and not isinstance(decision["blockReason"], str):
        fail(f"{label}: blockReason must be string or null")
    if not isinstance(decision["securityPolicyHash"], str) or not decision["securityPolicyHash"]:
        fail(f"{label}: securityPolicyHash must be a non-empty string")

    effects = case["expectedGatewayEffects"]
    if not isinstance(effects, dict) or set(effects) != REQUIRED_EFFECT_FIELDS:
        fail(f"{label}: expectedGatewayEffects fields mismatch")
    if not isinstance(effects["providerCalled"], bool):
        fail(f"{label}: providerCalled must be boolean")
    if not isinstance(effects["cacheLookup"], bool):
        fail(f"{label}: cacheLookup must be boolean")
    if effects["terminalStatus"] not in ALLOWED_TERMINAL_STATUSES:
        fail(f"{label}: invalid terminalStatus {effects['terminalStatus']}")
    if not isinstance(effects["httpStatus"], int) or not 100 <= effects["httpStatus"] <= 599:
        fail(f"{label}: invalid httpStatus")
    if effects["errorCode"] not in ALLOWED_ERROR_CODES:
        fail(f"{label}: invalid errorCode {effects['errorCode']}")


def validate_case_semantics(case: dict[str, Any]) -> None:
    label = case["caseId"]
    decision = case["expectedSafetyDecision"]
    effects = case["expectedGatewayEffects"]
    detected_types = set(decision["detectedTypes"])
    binding_types = set(case["placeholderBindings"].values())

    if detected_types != binding_types:
        fail(f"{label}: detectedTypes must match placeholder binding detector types")

    if decision["action"] == "none":
        if detected_types:
            fail(f"{label}: none action must not have detections")
        if decision["blockReason"] is not None:
            fail(f"{label}: none action must not have blockReason")
        if effects != {
            "providerCalled": True,
            "cacheLookup": True,
            "terminalStatus": "success",
            "httpStatus": 200,
            "errorCode": None,
        }:
            fail(f"{label}: none action gateway effects mismatch")
    elif decision["action"] == "redacted":
        if not detected_types:
            fail(f"{label}: redacted action requires detections")
        if not detected_types.issubset({"email", "phone_number"}):
            fail(f"{label}: v1 redacted corpus may only use email or phone_number")
        if decision["blockReason"] is not None:
            fail(f"{label}: redacted action must not have blockReason")
        if effects["providerCalled"] is not True or effects["cacheLookup"] is not True:
            fail(f"{label}: redacted action must proceed to cache/provider path")
        if effects["terminalStatus"] != "success" or effects["httpStatus"] != 200 or effects["errorCode"] is not None:
            fail(f"{label}: redacted action gateway status mismatch")
    elif decision["action"] == "blocked":
        if not detected_types:
            fail(f"{label}: blocked action requires detections")
        if not detected_types.issubset(DETECTOR_TYPES - {"email", "phone_number"}):
            fail(f"{label}: blocked action contains non-blocking detector type")
        if decision["blockReason"] != "sensitive_data_blocked":
            fail(f"{label}: blocked action blockReason must be sensitive_data_blocked")
        if effects != {
            "providerCalled": False,
            "cacheLookup": False,
            "terminalStatus": "blocked",
            "httpStatus": 403,
            "errorCode": "sensitive_data_blocked",
        }:
            fail(f"{label}: blocked action gateway effects mismatch")

    expanded = case["inputTemplate"].format(**_synthetic_values())
    if "{" in expanded or "}" in expanded:
        fail(f"{label}: unresolved placeholder after synthetic expansion")


def validate_coverage(cases: list[dict[str, Any]]) -> None:
    seen_case_ids: set[str] = set()
    seen_actions: set[str] = set()
    seen_detectors: set[str] = set()

    for case in cases:
        case_id = case["caseId"]
        if case_id in seen_case_ids:
            fail(f"duplicate caseId {case_id}")
        seen_case_ids.add(case_id)
        seen_actions.add(case["expectedSafetyDecision"]["action"])
        seen_detectors.update(case["expectedSafetyDecision"]["detectedTypes"])

    missing_actions = REQUIRED_ACTIONS - seen_actions
    if missing_actions:
        fail(f"missing action coverage: {sorted(missing_actions)}")

    missing_detectors = DETECTOR_TYPES - seen_detectors
    if missing_detectors:
        fail(f"missing detector coverage: {sorted(missing_detectors)}")


def main() -> int:
    load_schema()
    scan_forbidden_literals()
    cases = load_corpus()
    for index, case in enumerate(cases, start=1):
        validate_case_shape(case, index)
        validate_case_semantics(case)
    validate_coverage(cases)
    print(f"v1 safety eval corpus smoke passed: {len(cases)} cases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
