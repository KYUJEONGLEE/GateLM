from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.domain.ai_safety_benchmark.types import BenchmarkError
from app.services.pii_shadow_e2e_runner import (
    _inside_night_window,
    _run_fault_counter_validation,
    build_parser,
    build_report,
    validate_args,
    write_safe_report,
)


class PiiShadowE2EReportTests(unittest.TestCase):
    def test_identical_model_report_is_eligible_and_aggregate_only(self) -> None:
        report = build_report(
            generated_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            git_sha="a" * 40,
            worktree_dirty=False,
            model_binding={
                "modelId": "gatelm/koelectra-small-v3-pii-ner",
                "version": "v0.1.1",
                "modelOnnxSha256": "b" * 64,
            },
            corpus_sha256="c" * 64,
            corpus_case_count=50,
            request_count=100,
            sample_basis_points=500,
            client_result={
                "schemaVersion": "gatelm.pii-shadow-e2e-client.v2",
                "requestCount": 100,
                "sampledRequestCount": 5,
                "deterministicReplaySampledRequestCount": 5,
                "successCount": 100,
                "errorCount": 0,
                "controlRequestCount": 1,
                "controlSampledRequestCount": 0,
                "controlSuccessCount": 1,
                "controlErrorCount": 0,
                "requestLatencyMs": latency_summary(100),
                "sampledRequestLatencyMs": latency_summary(5),
                "nonSampledRequestLatencyMs": latency_summary(95),
            },
            processed=5,
            shadow_snapshot=shadow_snapshot(mismatches=0),
            execution_context="aws_test_tenant_host",
            night_window_bypassed=False,
        )

        self.assertTrue(report["eligibility"]["eligible"])
        self.assertEqual(report["workload"]["actualSamplePercent"], 5.0)
        self.assertFalse(
            report["scope"]["nightWindowBypassedForExplicitE2E"]
        )
        rendered = json.dumps(report, sort_keys=True)
        self.assertNotIn('\"promptText\":', rendered)
        self.assertNotIn('\"redactedPrompt\":', rendered)
        self.assertNotIn('\"detectedValue\":', rendered)

        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "report.json"
            write_safe_report(report, output)
            self.assertTrue(output.is_file())

    def test_mismatch_prevents_same_model_plumbing_eligibility(self) -> None:
        report = build_report(
            generated_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            git_sha="a" * 40,
            worktree_dirty=False,
            model_binding={"version": "v0.1.1"},
            corpus_sha256="c" * 64,
            corpus_case_count=50,
            request_count=100,
            sample_basis_points=500,
            client_result={
                "schemaVersion": "gatelm.pii-shadow-e2e-client.v2",
                "requestCount": 100,
                "sampledRequestCount": 5,
                "deterministicReplaySampledRequestCount": 5,
                "successCount": 100,
                "errorCount": 0,
                "controlRequestCount": 1,
                "controlSampledRequestCount": 0,
                "controlSuccessCount": 1,
                "controlErrorCount": 0,
                "requestLatencyMs": latency_summary(100),
                "sampledRequestLatencyMs": latency_summary(5),
                "nonSampledRequestLatencyMs": latency_summary(95),
            },
            processed=5,
            shadow_snapshot=shadow_snapshot(mismatches=1),
        )

        self.assertFalse(report["eligibility"]["eligible"])
        self.assertFalse(
            report["eligibility"]["checks"][
                "identicalModelAgreementIsExact"
            ]
        )

    def test_fault_validation_counts_every_expected_failure_mode(self) -> None:
        validation = _run_fault_counter_validation()

        self.assertTrue(all(validation["checks"].values()))
        self.assertEqual(
            validation["counters"],
            {
                "expiredItems": 1,
                "evictedItems": 1,
                "oversizedItems": 1,
                "decryptErrors": 1,
                "inferenceErrors": 1,
                "restartDecryptErrors": 1,
            },
        )

    def test_aws_execution_requires_window_and_clean_source_flags(self) -> None:
        args = build_parser().parse_args(
            ["--model-dir", ".", "--execution-context", "aws_test_tenant_host"]
        )

        with self.assertRaises(BenchmarkError):
            validate_args(args)

        approved_args = build_parser().parse_args(
            [
                "--model-dir",
                ".",
                "--execution-context",
                "aws_test_tenant_host",
                "--respect-night-window",
                "--verified-clean-source",
            ]
        )
        validate_args(approved_args)

    def test_night_window_uses_kst_and_excludes_end_hour(self) -> None:
        self.assertTrue(
            _inside_night_window(datetime(2026, 8, 1, 17, 0, tzinfo=timezone.utc))
        )
        self.assertFalse(
            _inside_night_window(datetime(2026, 8, 1, 20, 0, tzinfo=timezone.utc))
        )


def shadow_snapshot(*, mismatches: int) -> dict[str, object]:
    matches = 5 - mismatches
    return {
        "schemaVersion": "gatelm.pii-shadow-aggregate.v1",
        "candidate": {
            "modelId": "gatelm/koelectra-small-v3-pii-ner",
            "version": "v0.1.1",
        },
        "buffer": {
            "pendingItems": 0,
            "storedBytes": 0,
            "capturedItems": 5,
            "expiredItems": 0,
            "evictedItems": 0,
            "oversizedItems": 0,
            "decryptErrors": 0,
        },
        "comparison": {
            "comparedItems": 5,
            "matchedItems": matches,
            "mismatchedItems": mismatches,
            "inferenceErrors": 0,
            "captureErrors": 0,
            "pausedForLiveRequests": 0,
            "modelActiveComparedItems": 3,
            "baselineModelInvocations": 3,
            "candidateModelInvocations": 3,
            "baselineAcceptedModelDetections": 2,
            "candidateAcceptedModelDetections": 2,
            "agreementPercent": matches * 20.0,
        },
        "latencyMs": {
            "baseline": {"count": 5, "p50": 3, "p95": 4, "p99": 4, "max": 4},
            "candidate": {"count": 5, "p50": 4, "p95": 5, "p99": 5, "max": 5},
        },
    }


def latency_summary(count: int) -> dict[str, int | float]:
    return {"count": count, "p50": 1.0, "p95": 2.0, "p99": 3.0, "max": 4.0}


if __name__ == "__main__":
    unittest.main()
