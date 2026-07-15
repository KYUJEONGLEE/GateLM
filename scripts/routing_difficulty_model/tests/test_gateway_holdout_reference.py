from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from gatelm_difficulty_model.gateway_holdout_reference import (
    aggregate_reports,
    classification_summary,
)


class GatewayHoldoutReferenceTests(unittest.TestCase):
    def test_classification_summary_keeps_directional_denominators(self) -> None:
        samples = [
            {
                "expectedDifficulty": "simple",
                "prediction": "complex",
            },
            {
                "expectedDifficulty": "complex",
                "prediction": "simple",
            },
            {
                "expectedDifficulty": "complex",
                "prediction": "complex",
            },
        ]
        self.assertEqual(
            classification_summary(samples, "prediction"),
            {
                "samples": 3,
                "correct": 1,
                "accuracy": 1 / 3,
                "simpleExpectedSamples": 1,
                "simpleToComplexCount": 1,
                "complexExpectedSamples": 2,
                "complexToSimpleCount": 1,
            },
        )

    def test_aggregate_requires_three_passing_runs(self) -> None:
        run = {
            "schemaVersion": "gatelm.difficulty-gateway-holdout-replay-run.v1",
            "parity": {
                "labelMatches": 100,
                "labelMismatches": 0,
                "maxAbsoluteScoreDelta": 0.000001,
            },
            "routingInvariance": {"matched": 100, "mismatched": 0},
            "selectedClassification": {"accuracy": 0.9, "complexToSimpleCount": 1},
            "offlineBatch16Classification": {"accuracy": 0.91, "complexToSimpleCount": 1},
            "offlineAggregateReproduced": False,
            "ruleBaselineClassification": {"accuracy": 0.86, "complexToSimpleCount": 10},
            "latencyMicros": {
                "shadowCompletion": {"p95": 10.0, "p99": 12.0, "max": 13.0},
            },
            "memoryBytes": {
                "afterInit": {"rss": 100, "cgroupCurrent": 200},
            },
            "busySaturation": {"rejectedBusy": 8},
            "nativeTimeoutRecovery": {"status": "not_proven"},
        }
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for index in range(3):
                path = Path(directory) / f"run-{index + 1}.json"
                path.write_text(json.dumps(run), encoding="utf-8")
                paths.append(path)
            aggregate = aggregate_reports(paths)
        self.assertEqual(aggregate["runCount"], 3)
        self.assertEqual(aggregate["parity"]["labelMatches"], 100)
        self.assertFalse(aggregate["promotionSafetyGate"]["passed"])
        self.assertEqual(aggregate["nativeTimeoutRecovery"]["status"], "not_proven")

    def test_aggregate_fails_closed_on_label_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            paths = []
            for index in range(3):
                run = {
                    "schemaVersion": "gatelm.difficulty-gateway-holdout-replay-run.v1",
                    "parity": {
                        "labelMatches": 99,
                        "labelMismatches": 1,
                        "maxAbsoluteScoreDelta": 0.0,
                    },
                    "routingInvariance": {"matched": 100, "mismatched": 0},
                    "selectedClassification": {"accuracy": 0.9, "complexToSimpleCount": 1},
                    "offlineBatch16Classification": {"accuracy": 0.91, "complexToSimpleCount": 1},
                    "offlineAggregateReproduced": False,
                    "ruleBaselineClassification": {"accuracy": 0.86, "complexToSimpleCount": 10},
                    "latencyMicros": {},
                    "memoryBytes": {},
                    "busySaturation": {"rejectedBusy": 8},
                }
                path = Path(directory) / f"run-{index + 1}.json"
                path.write_text(json.dumps(run), encoding="utf-8")
                paths.append(path)
            with self.assertRaisesRegex(ValueError, "frozen parity gates"):
                aggregate_reports(paths)


if __name__ == "__main__":
    unittest.main()
