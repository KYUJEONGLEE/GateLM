from __future__ import annotations

import json
import unittest
from pathlib import Path
from typing import Any

from app.domain.ai_safety_eval.master_corpus import (
    MasterEvalError,
    load_master_eval_corpus,
    parse_master_eval_case,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "master-safety-eval-corpus.jsonl"


class AiSafetyMasterEvalCorpusTests(unittest.TestCase):
    def test_master_corpus_has_target_specific_expectations(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        self.assertGreaterEqual(len(cases), 100)
        for case in cases:
            self.assertIsNotNone(case.expectations.gateway)
            self.assertIsNotNone(case.expectations.detector)

    def test_master_corpus_has_shadow_eval_distribution(self) -> None:
        cases = load_master_eval_corpus(CORPUS_PATH)

        self.assertGreaterEqual(count_tagged(cases, "person-name"), 20)
        self.assertGreaterEqual(count_tagged(cases, "address"), 15)
        self.assertGreaterEqual(count_tagged(cases, "account-number", "account-id"), 10)
        self.assertGreaterEqual(count_tagged(cases, "secret", "private-url", "provider-api-key"), 15)
        self.assertGreaterEqual(count_tagged(cases, "private-date", "resident-registration-number"), 10)
        self.assertGreaterEqual(count_tagged(cases, "health", "confidential-business"), 10)

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


if __name__ == "__main__":
    unittest.main()
