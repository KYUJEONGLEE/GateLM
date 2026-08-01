from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.services.pii_shadow_e2e_runner import build_report, write_safe_report


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
                "schemaVersion": "gatelm.pii-shadow-e2e-client.v1",
                "requestCount": 100,
                "sampledRequestCount": 5,
                "successCount": 100,
                "errorCount": 0,
            },
            processed=5,
            shadow_snapshot=shadow_snapshot(mismatches=0),
        )

        self.assertTrue(report["eligibility"]["eligible"])
        self.assertEqual(report["workload"]["actualSamplePercent"], 5.0)
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
                "schemaVersion": "gatelm.pii-shadow-e2e-client.v1",
                "requestCount": 100,
                "sampledRequestCount": 5,
                "successCount": 100,
                "errorCount": 0,
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
            "agreementPercent": matches * 20.0,
        },
        "latencyMs": {
            "baseline": {"count": 5, "p50": 3, "p95": 4, "p99": 4, "max": 4},
            "candidate": {"count": 5, "p50": 4, "p95": 5, "p99": 5, "max": 5},
        },
    }


if __name__ == "__main__":
    unittest.main()
