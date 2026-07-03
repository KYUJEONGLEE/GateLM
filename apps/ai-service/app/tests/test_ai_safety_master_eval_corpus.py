from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.domain.ai_safety_eval.master_corpus import (
    ALLOWED_LLM_REASON_CODES,
    MasterEvalError,
    load_master_eval_corpus,
    parse_master_eval_case,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "master-safety-eval-corpus.jsonl"


class AiSafetyMasterEvalCorpusTests(unittest.TestCase):
    def test_master_corpus_has_target_specific_expectations(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        self.assertGreaterEqual(len(cases), 18)
        for case in cases:
            self.assertIsNotNone(case.expectations.gateway)
            self.assertIsNotNone(case.expectations.detector)
            self.assertIsNotNone(case.expectations.llm_classifier)

    def test_master_corpus_covers_llm_classifier_reason_codes(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)
        reason_codes = {
            detection.reason_code
            for case in cases
            for detection in case.expectations.llm_classifier.expected_detections
        }

        self.assertEqual(reason_codes, ALLOWED_LLM_REASON_CODES)

    def test_master_corpus_marks_regex_sufficient_cases_as_llm_skip(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)
        skip_cases = [
            case
            for case in cases
            if "llm-skip" in case.tags
        ]

        self.assertGreaterEqual(len(skip_cases), 3)
        for case in skip_cases:
            expectation = case.expectations.llm_classifier
            self.assertFalse(expectation.should_run)
            self.assertEqual(expectation.expected_window_count, 0)
            self.assertEqual(expectation.expected_detections, ())

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


if __name__ == "__main__":
    unittest.main()
