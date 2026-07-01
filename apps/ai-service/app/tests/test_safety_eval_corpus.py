from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.domain.safety_eval.corpus import load_corpus, parse_corpus_case
from app.schemas.safety_eval import SafetyEvalError


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = REPO_ROOT / "docs" / "v1.0.0" / "fixtures" / "safety-eval-corpus.jsonl"
SCHEMA_PATH = REPO_ROOT / "docs" / "v1.0.0" / "schemas" / "safety-eval-corpus.schema.json"


class SafetyEvalCorpusTests(unittest.TestCase):
    def test_loads_v1_docs_corpus(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        self.assertEqual(len(cases), 32)
        repeated = next(case for case in cases if case.case_id == "repeated_email_redacts_count")
        self.assertEqual(repeated.expected_type_counts, {"email": 2})
        self.assertEqual(repeated.expected_safety_decision.detected_count, 2)

    def test_duplicate_case_id_fails(self) -> None:
        first_line = CORPUS_PATH.read_text(encoding="utf-8").splitlines()[0]
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "corpus.jsonl"
            path.write_text(first_line + "\n" + first_line + "\n", encoding="utf-8")
            with self.assertRaisesRegex(SafetyEvalError, "duplicate caseId"):
                load_corpus(path)

    def test_placeholder_binding_mismatch_fails(self) -> None:
        raw_case = json.loads(CORPUS_PATH.read_text(encoding="utf-8").splitlines()[1])
        raw_case["placeholderBindings"] = {}
        with self.assertRaisesRegex(SafetyEvalError, "placeholders"):
            parse_corpus_case(raw_case, 1)


if __name__ == "__main__":
    unittest.main()
