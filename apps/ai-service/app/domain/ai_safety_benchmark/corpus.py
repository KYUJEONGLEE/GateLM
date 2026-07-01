from __future__ import annotations

import json
import re
from pathlib import Path
from string import Formatter
from typing import Any

from app.domain.ai_safety_benchmark.types import (
    CASE_GROUPS,
    INPUT_LENGTH_BUCKETS,
    BenchmarkCase,
    BenchmarkError,
)


REQUIRED_FIELDS = {
    "caseId",
    "caseGroup",
    "inputLengthBucket",
    "inputTemplate",
    "placeholderBindings",
    "locale",
    "tags",
}
ALLOWED_PLACEHOLDER_TYPES = {
    "safe_text",
    "email",
    "phone_number",
    "person_name",
    "postal_address",
    "private_date",
    "private_url",
    "account_number",
    "secret",
}
CASE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
PLACEHOLDER_PATTERN = re.compile(r"^SYNTHETIC_[A-Z0-9_]+$")
TAG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

LONG_SAFE_BLOCK = (
    "This synthetic benchmark paragraph describes a staged rollout, documentation review, "
    "service readiness checks, and routine operational notes without customer data. "
) * 9

PLACEHOLDER_VALUES = {
    "safe_text": LONG_SAFE_BLOCK,
    "email": "benchmark.user@example.test",
    "phone_number": "+1-555-010-0100",
    "person_name": "Alex Benchmark",
    "postal_address": "100 Example Street, Test City",
    "private_date": "2026-01-02",
    "private_url": "https://profile.example.test/synthetic-user",
    "account_number": "ACCT-SYNTH-000123",
    "secret": "SYNTHETIC_SECRET_TOKEN",
}
PLACEHOLDER_VALUE_OVERRIDES = {
    "SYNTHETIC_KO_NAME": "테스트사용자",
    "SYNTHETIC_KO_PHONE": "010-0000-0100",
    "SYNTHETIC_KO_ADDRESS": "서울시 테스트구 샘플로 100",
    "SYNTHETIC_KO_PRIVATE_DATE": "2026년 1월 2일",
}


def load_benchmark_corpus(path: Path) -> list[BenchmarkCase]:
    if not path.exists():
        raise BenchmarkError(f"benchmark corpus not found: {path}")

    cases: list[BenchmarkCase] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            raise BenchmarkError(f"blank benchmark corpus line at {line_number}")
        try:
            raw_case = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BenchmarkError(f"benchmark corpus JSONL parse failed at line {line_number}: {exc}") from exc
        if not isinstance(raw_case, dict):
            raise BenchmarkError(f"benchmark corpus line {line_number} is not an object")
        cases.append(parse_benchmark_case(raw_case, line_number))

    validate_corpus_coverage(cases)
    return cases


def parse_benchmark_case(raw_case: dict[str, Any], line_number: int) -> BenchmarkCase:
    label = raw_case.get("caseId", f"line {line_number}")
    if set(raw_case) != REQUIRED_FIELDS:
        raise BenchmarkError(f"{label}: benchmark corpus fields mismatch: {sorted(raw_case)}")

    case_id = raw_case["caseId"]
    case_group = raw_case["caseGroup"]
    input_length_bucket = raw_case["inputLengthBucket"]
    input_template = raw_case["inputTemplate"]
    placeholder_bindings = raw_case["placeholderBindings"]
    locale = raw_case["locale"]
    tags = raw_case["tags"]

    if not isinstance(case_id, str) or not CASE_ID_PATTERN.fullmatch(case_id):
        raise BenchmarkError(f"{label}: invalid caseId")
    if case_group not in CASE_GROUPS:
        raise BenchmarkError(f"{label}: invalid caseGroup {case_group!r}")
    if input_length_bucket not in INPUT_LENGTH_BUCKETS:
        raise BenchmarkError(f"{label}: invalid inputLengthBucket {input_length_bucket!r}")
    if not isinstance(input_template, str) or not input_template:
        raise BenchmarkError(f"{label}: inputTemplate must be a non-empty string")
    if not isinstance(placeholder_bindings, dict):
        raise BenchmarkError(f"{label}: placeholderBindings must be an object")
    if locale is not None and not isinstance(locale, str):
        raise BenchmarkError(f"{label}: locale must be string or null")
    if not isinstance(tags, list) or not tags:
        raise BenchmarkError(f"{label}: tags must be a non-empty array")
    if not all(isinstance(tag, str) and TAG_PATTERN.fullmatch(tag) for tag in tags):
        raise BenchmarkError(f"{label}: invalid tag value")

    placeholders = placeholders_for(input_template)
    if placeholders != set(placeholder_bindings):
        raise BenchmarkError(
            f"{label}: placeholders {sorted(placeholders)} do not match bindings "
            f"{sorted(placeholder_bindings)}"
        )
    parsed_bindings: dict[str, str] = {}
    for placeholder, placeholder_type in placeholder_bindings.items():
        if not isinstance(placeholder, str) or not PLACEHOLDER_PATTERN.fullmatch(placeholder):
            raise BenchmarkError(f"{label}: invalid placeholder name {placeholder!r}")
        if placeholder_type not in ALLOWED_PLACEHOLDER_TYPES:
            raise BenchmarkError(f"{label}: invalid placeholder type {placeholder_type!r}")
        parsed_bindings[placeholder] = placeholder_type

    return BenchmarkCase(
        case_id=case_id,
        case_group=case_group,
        input_length_bucket=input_length_bucket,
        input_template=input_template,
        placeholder_bindings=parsed_bindings,
        locale=locale,
        tags=tuple(str(tag) for tag in tags),
    )


def placeholders_for(template: str) -> set[str]:
    placeholders: set[str] = set()
    for _, field_name, _, _ in Formatter().parse(template):
        if field_name:
            placeholders.add(field_name)
    return placeholders


def render_case_prompt(case: BenchmarkCase) -> str:
    values = {
        placeholder: PLACEHOLDER_VALUE_OVERRIDES.get(
            placeholder,
            PLACEHOLDER_VALUES[placeholder_type],
        )
        for placeholder, placeholder_type in case.placeholder_bindings.items()
    }
    try:
        return case.input_template.format(**values)
    except KeyError as exc:
        raise BenchmarkError(f"{case.case_id}: missing placeholder value {exc}") from exc


def validate_corpus_coverage(cases: list[BenchmarkCase]) -> None:
    if len(cases) != 50:
        raise BenchmarkError(f"benchmark corpus must contain exactly 50 cases, found {len(cases)}")
    seen_case_ids: set[str] = set()
    group_counts = {case_group: 0 for case_group in CASE_GROUPS}
    for case in cases:
        if case.case_id in seen_case_ids:
            raise BenchmarkError(f"duplicate benchmark caseId {case.case_id}")
        seen_case_ids.add(case.case_id)
        group_counts[case.case_group] += 1
    invalid_counts = {
        case_group: count
        for case_group, count in group_counts.items()
        if count != 10
    }
    if invalid_counts:
        raise BenchmarkError(f"benchmark corpus must contain 10 cases per group: {invalid_counts}")
