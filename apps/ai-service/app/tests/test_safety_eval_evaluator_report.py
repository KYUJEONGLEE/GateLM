from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.domain.safety_eval.actual import load_actual_fixture
from app.domain.safety_eval.corpus import load_corpus
from app.domain.safety_eval.evaluator import evaluate_cases
from app.domain.safety_eval.report import (
    build_report,
    load_semantic_cache_evidence_fixture,
    scan_path_for_forbidden_sensitive_values,
    write_reports,
)
from app.schemas.safety_eval import SafetyEvalError


REPO_ROOT = Path(__file__).resolve().parents[4]
AI_SERVICE_ROOT = REPO_ROOT / "apps" / "ai-service"
CORPUS_PATH = REPO_ROOT / "docs" / "v1.0.0" / "fixtures" / "safety-eval-corpus.jsonl"
SCHEMA_PATH = REPO_ROOT / "docs" / "v1.0.0" / "schemas" / "safety-eval-corpus.schema.json"
FIXTURE_DIR = AI_SERVICE_ROOT / "app" / "tests" / "fixtures" / "safety_eval"


class SafetyEvalEvaluatorReportTests(unittest.TestCase):
    def test_full_pass_detector_fixture(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        raw_fixture, actual = load_actual_fixture(FIXTURE_DIR / "detector-output.fixture.json", "detector-output")
        evaluation = evaluate_cases(cases, actual)
        self.assertEqual(evaluation.summary["failedCases"], 0)
        self.assertEqual(evaluation.detectors["email"].true_positive_cases, 2)
        self.assertEqual(evaluation.detectors["email"].count_mismatch_cases, 0)
        self.assertEqual(raw_fixture["fixtureName"], "v1-safety-eval-detector-output-pass")

    def test_full_pass_gateway_fixture(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        _, actual = load_actual_fixture(FIXTURE_DIR / "gateway-safety-output.fixture.json", "gateway-safety-output")
        evaluation = evaluate_cases(cases, actual)
        self.assertEqual(evaluation.summary["failedCases"], 0)
        self.assertEqual(evaluation.summary["gatewayEffectMismatchCases"], 0)

    def test_full_pass_gateway_v2_fixture(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        raw_fixture, actual = load_actual_fixture(
            FIXTURE_DIR / "gateway-safety-output-v2.fixture.json",
            "gateway-safety-output-v2",
        )
        evaluation = evaluate_cases(cases, actual)
        self.assertEqual(evaluation.summary["failedCases"], 0)
        self.assertEqual(evaluation.summary["gatewayEffectMismatchCases"], 0)

        report = build_report(
            evaluation,
            corpus_path=CORPUS_PATH,
            fixture_path=FIXTURE_DIR / "gateway-safety-output-v2.fixture.json",
            mode="gateway_safety_output_v2",
            fixture_name=raw_fixture["fixtureName"],
            fixture_version=raw_fixture["fixtureVersion"],
            generated_at=datetime(2026, 6, 30, 0, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(report["reportVersion"], "safety-eval-report.v2")
        blocked_case = next(case for case in report["cases"] if case["caseId"] == "api_key_blocks_before_cache")
        self.assertEqual(blocked_case["actual"]["safetyOutcome"], "blocked")
        self.assertFalse(blocked_case["actual"]["gatewayEffects"]["providerCalled"])
        self.assertFalse(blocked_case["actual"]["gatewayEffects"]["cacheWrite"])
        self.assertFalse(blocked_case["actual"]["gatewayEffects"]["streamingStarted"])

    def test_mixed_failure_counts_fp_fn_and_count_mismatch(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        _, actual = load_actual_fixture(
            FIXTURE_DIR / "detector-output-mixed-failure.fixture.json",
            "detector-output",
        )
        evaluation = evaluate_cases(cases, actual)
        self.assertGreater(evaluation.summary["failedCases"], 0)
        self.assertGreaterEqual(evaluation.summary["falsePositiveCases"], 1)
        self.assertGreaterEqual(evaluation.summary["falseNegativeCases"], 1)
        self.assertEqual(evaluation.detectors["email"].count_mismatch_cases, 2)

    def test_report_excludes_preview_text_and_raw_fields(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        raw_fixture, actual = load_actual_fixture(FIXTURE_DIR / "detector-output.fixture.json", "detector-output")
        evaluation = evaluate_cases(cases, actual)
        report = build_report(
            evaluation,
            corpus_path=CORPUS_PATH,
            fixture_path=FIXTURE_DIR / "detector-output.fixture.json",
            mode="detector_output",
            fixture_name=raw_fixture["fixtureName"],
            fixture_version=raw_fixture["fixtureVersion"],
            generated_at=datetime(2026, 6, 27, 0, 0, tzinfo=timezone.utc),
        )
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("inputTemplate", serialized)
        self.assertNotIn("Send a short support reply to [EMAIL_REDACTED].", serialized)
        self.assertIn("expectedPreviewHash", serialized)
        with tempfile.TemporaryDirectory() as temp_dir:
            json_path, markdown_path = write_reports(report, Path(temp_dir))
            self.assertTrue(json_path.exists())
            self.assertTrue(markdown_path.exists())

    def test_security_scan_rejects_forbidden_raw_fixture(self) -> None:
        with self.assertRaisesRegex(SafetyEvalError, "forbidden field name"):
            scan_path_for_forbidden_sensitive_values(FIXTURE_DIR / "forbidden-raw.fixture.json")

    def test_report_includes_semantic_cache_evidence_only_fixture(self) -> None:
        cases = load_corpus(CORPUS_PATH, SCHEMA_PATH)
        raw_fixture, actual = load_actual_fixture(FIXTURE_DIR / "gateway-safety-output-v2.fixture.json", "gateway-safety-output-v2")
        evaluation = evaluate_cases(cases, actual)
        semantic_evidence = load_semantic_cache_evidence_fixture(
            FIXTURE_DIR / "semantic-cache-evidence-v2.fixture.json"
        )
        report = build_report(
            evaluation,
            corpus_path=CORPUS_PATH,
            fixture_path=FIXTURE_DIR / "gateway-safety-output-v2.fixture.json",
            mode="gateway_safety_output_v2",
            fixture_name=raw_fixture["fixtureName"],
            fixture_version=raw_fixture["fixtureVersion"],
            semantic_cache_evidence=semantic_evidence,
            generated_at=datetime(2026, 6, 30, 0, 0, tzinfo=timezone.utc),
        )
        self.assertTrue(report["semanticCacheEvidence"]["evidence"]["evidenceOnly"])
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("actualCacheHitRate", serialized)
        self.assertNotIn("actualSavedCost", serialized)
        self.assertNotIn("actualProviderBypass", serialized)

        with tempfile.TemporaryDirectory() as temp_dir:
            json_path, markdown_path = write_reports(report, Path(temp_dir))
            self.assertTrue(json_path.exists())
            self.assertTrue(markdown_path.exists())

    def test_security_scan_rejects_semantic_cache_actual_metric_claims(self) -> None:
        raw_fixture = json.loads((FIXTURE_DIR / "semantic-cache-evidence-v2.fixture.json").read_text(encoding="utf-8"))
        raw_fixture["evidence"]["actualCacheHitRate"] = 0.5

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "bad-semantic-cache-evidence.fixture.json"
            fixture_path.write_text(json.dumps(raw_fixture), encoding="utf-8")

            with self.assertRaisesRegex(SafetyEvalError, "forbidden field name"):
                scan_path_for_forbidden_sensitive_values(fixture_path)


if __name__ == "__main__":
    unittest.main()
