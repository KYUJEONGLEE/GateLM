from __future__ import annotations

import json
import unittest

from gatelm_difficulty_model.promotion_holdout import build_gate, classification_summary


class PromotionHoldoutTests(unittest.TestCase):
    def test_gate_requires_accuracy_count_and_every_category_non_regression(self) -> None:
        samples = []
        candidate_predictions = []
        baseline_predictions = []
        for category in ("code", "general"):
            for index in range(10):
                difficulty = "simple" if index < 5 else "complex"
                samples.append(
                    {"expectedCategory": category, "expectedDifficulty": difficulty}
                )
                candidate_predictions.append(difficulty)
                baseline_predictions.append(
                    "simple" if difficulty == "complex" and index == 5 else difficulty
                )
        candidate = classification_summary(samples, candidate_predictions)
        baseline = classification_summary(samples, baseline_predictions)
        gate = build_gate(
            candidate,
            baseline,
            {
                "minimumAccuracy": 0.91,
                "maximumComplexToSimpleCount": 1,
                "categoryDirectionalErrorPolicy": "test_policy",
            },
        )
        self.assertTrue(gate["passed"])
        self.assertTrue(gate["categoryNonRegressionVsRule"]["passed"])

    def test_category_regression_blocks_an_otherwise_accurate_candidate(self) -> None:
        samples = [
            {"expectedCategory": "code", "expectedDifficulty": "complex"},
            {"expectedCategory": "general", "expectedDifficulty": "complex"},
        ]
        candidate = classification_summary(samples, ["simple", "complex"])
        baseline = classification_summary(samples, ["complex", "simple"])
        gate = build_gate(
            candidate,
            baseline,
            {
                "minimumAccuracy": 0.5,
                "maximumComplexToSimpleCount": 1,
                "categoryDirectionalErrorPolicy": "test_policy",
            },
        )
        self.assertFalse(gate["passed"])
        self.assertFalse(
            gate["categoryNonRegressionVsRule"]["byExpectedCategory"]["code"][
                "passed"
            ]
        )

    def test_classification_summary_is_aggregate_only(self) -> None:
        summary = classification_summary(
            [{"expectedCategory": "code", "expectedDifficulty": "simple"}],
            ["simple"],
        )
        rendered = json.dumps(summary)
        for forbidden in (
            "sampleId",
            "instructionText",
            "ruleVectorV1",
            "complexityScore",
        ):
            self.assertNotIn(forbidden, rendered)


if __name__ == "__main__":
    unittest.main()
