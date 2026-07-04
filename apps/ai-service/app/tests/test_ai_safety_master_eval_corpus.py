from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

from app.domain.ai_safety_eval.master_corpus import (
    ALLOWED_DETECTOR_TYPES,
    MasterEvalError,
    load_master_eval_corpus,
    parse_master_eval_case,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "master-safety-eval-corpus.jsonl"
MASTER_CORPUS_TARGET_SIZE = 1000


class AiSafetyMasterEvalCorpusTests(unittest.TestCase):
    def test_master_corpus_has_target_specific_expectations(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        self.assertEqual(len(cases), MASTER_CORPUS_TARGET_SIZE)
        for case in cases:
            self.assertIsNotNone(case.expectations.gateway)
            self.assertIsNotNone(case.expectations.detector)

    def test_master_corpus_has_shadow_eval_distribution(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        self.assertEqual(count_tagged(cases, "expanded"), 0)
        self.assertGreaterEqual(count_tagged(cases, "person-name"), 20)
        self.assertGreaterEqual(count_tagged(cases, "address"), 15)
        self.assertGreaterEqual(count_tagged(cases, "account-number", "account-id"), 10)
        self.assertGreaterEqual(count_tagged(cases, "secret", "private-url", "provider-api-key"), 15)
        self.assertGreaterEqual(count_tagged(cases, "private-date", "resident-registration-number"), 10)
        self.assertGreaterEqual(count_tagged(cases, "health", "confidential-business"), 10)

    def test_master_corpus_has_fp_fn_coverage_for_critical_korean_detectors(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        for detector_type in (
            "organization_name",
            "person_name",
            "resident_registration_number",
            "account_number",
        ):
            with self.subTest(detector_type=detector_type):
                self.assertGreaterEqual(count_positive_expected(cases, detector_type), 1)
                self.assertGreaterEqual(count_pass_guard(cases, detector_type), 1)

    def test_master_corpus_diversifies_each_detector_type(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        for detector_type in sorted(ALLOWED_DETECTOR_TYPES):
            detector_cases = cases_for_detector(cases, detector_type)
            with self.subTest(detector_type=detector_type):
                self.assertGreaterEqual(len(detector_cases), 20)
                self.assertGreaterEqual(count_tagged(detector_cases, "case-redact"), 1)
                self.assertGreaterEqual(count_tagged(detector_cases, "case-block"), 1)
                self.assertGreaterEqual(count_tagged(detector_cases, "case-allow"), 1)
                self.assertGreaterEqual(count_tagged(detector_cases, "case-safe"), 1)
                self.assertGreaterEqual(count_tagged(detector_cases, "risk-false-positive"), 1)
                self.assertGreaterEqual(count_tagged(detector_cases, "risk-false-negative"), 1)

    def test_master_corpus_has_cross_cutting_context_and_pattern_tags(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        self.assertGreaterEqual(count_tags_with_prefix(cases, "context-"), 15)
        self.assertGreaterEqual(count_tags_with_prefix(cases, "pattern-"), 20)
        self.assertGreaterEqual(count_tags_with_prefix(cases, "detector-"), len(ALLOWED_DETECTOR_TYPES))
        for tag in (
            "outcome-passed",
            "outcome-redacted",
            "outcome-blocked",
            "risk-direct-sensitive",
            "risk-exfiltration",
            "risk-false-negative",
            "risk-false-positive",
            "risk-policy-allow",
        ):
            self.assertGreaterEqual(count_tagged(cases, tag), 1)

    def test_placeholder_binding_mismatch_fails(self) -> None:
        raw_case = json.loads(CORPUS_PATH.read_text(encoding="utf-8").splitlines()[0])
        raw_case["placeholderBindings"] = {}

        with self.assertRaisesRegex(MasterEvalError, "placeholders"):
            parse_master_eval_case(raw_case, 1)

    def test_case_without_all_target_expectations_fails(self) -> None:
        raw_case = json.loads(CORPUS_PATH.read_text(encoding="utf-8").splitlines()[0])
        del raw_case["expectations"]["gateway"]

        with self.assertRaisesRegex(MasterEvalError, "expectations fields mismatch"):
            parse_master_eval_case(raw_case, 1)


def count_tagged(cases: list[Any], *tags: str) -> int:
    wanted = set(tags)
    return sum(1 for case in cases if wanted.intersection(case.tags))


def count_positive_expected(cases: list[Any], detector_type: str) -> int:
    return sum(
        1
        for case in cases
        if detector_type in case.expectations.detector.detected_types
        and case.expectations.detector.outcome in {"redacted", "blocked"}
    )


def count_pass_guard(cases: list[Any], detector_type: str) -> int:
    return sum(
        1
        for case in cases
        if case.expectations.detector.outcome == "passed"
        and case_mentions_detector_type(case, detector_type)
    )


def case_mentions_detector_type(case: Any, detector_type: str) -> bool:
    return (
        detector_type in case.placeholder_bindings.values()
        or detector_type in case.expectations.detector.detected_types
        or detector_type.replace("_", "-") in case.tags
    )


def cases_for_detector(cases: list[Any], detector_type: str) -> list[Any]:
    detector_tag = detector_type.replace("_", "-")
    return [
        case
        for case in cases
        if detector_type in case.placeholder_bindings.values()
        or detector_type in case.expectations.detector.detected_types
        or detector_tag in case.tags
    ]


def count_tags_with_prefix(cases: list[Any], prefix: str) -> int:
    return len({tag for case in cases for tag in case.tags if tag.startswith(prefix)})


if __name__ == "__main__":
    unittest.main()
