from __future__ import annotations

import unittest

from gatelm_difficulty_model.calibration_feasibility import (
    evaluate_threshold_feasibility,
    family_grouped_oof_calibrated_scores,
)
from gatelm_difficulty_model.calibration_feasibility_cli import parse_args
from gatelm_difficulty_model.calibration_feasibility_cli import _validate_frozen_material


def balanced_calibration() -> tuple[list[dict], list[float | None]]:
    samples: list[dict] = []
    scores: list[float | None] = []
    categories = ("code", "general", "reasoning", "summarization", "translation")
    simple_index = 0
    for category in categories:
        for _ in range(10):
            samples.append(
                {
                    "split": "calibration",
                    "familyId": f"{category}.simple.{simple_index // 2}",
                    "expectedCategory": category,
                    "expectedDifficulty": "simple",
                    "ruleDifficulty": "simple",
                    "modelPath": True,
                }
            )
            scores.append(0.9 if simple_index < 9 else 0.1)
            simple_index += 1
        for index in range(10):
            samples.append(
                {
                    "split": "calibration",
                    "familyId": f"{category}.complex.{index // 2}",
                    "expectedCategory": category,
                    "expectedDifficulty": "complex",
                    "ruleDifficulty": "complex",
                    "modelPath": True,
                }
            )
            scores.append(0.9)
    return samples, scores


class CalibrationFeasibilityTest(unittest.TestCase):

    def test_v3_feasibility_refuses_the_current_decision_boundary(self) -> None:
        with self.assertRaisesRegex(ValueError, "decision boundary"):
            _validate_frozen_material(
                {},
                {},
                {},
                {},
                {
                    "decisionBoundaryVersion": (
                        "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2"
                    )
                },
            )
    def test_cli_refuses_non_runtime_batch_shapes(self) -> None:
        with self.assertRaises(SystemExit):
            parse_args(["--batch-size", "2"])

    def test_selects_a_fixed_grid_threshold_that_meets_the_91_and_1_gate(self) -> None:
        samples, scores = balanced_calibration()

        report = evaluate_threshold_feasibility(
            samples,
            scores,
            reference_threshold=0.45,
            threshold_step=0.01,
            minimum_accuracy=0.91,
            maximum_complex_to_simple_count=1,
        )

        self.assertEqual(report["status"], "calibration_threshold_feasible")
        self.assertEqual(report["selectedOperatingPoint"]["threshold"], 0.45)
        self.assertEqual(report["selectedOperatingPoint"]["classification"]["correct"], 91)
        self.assertEqual(
            report["selectedOperatingPoint"]["classification"]["complexToSimpleCount"],
            0,
        )
        self.assertTrue(report["selectedOperatingPoint"]["gate"]["passed"])

    def test_reports_the_best_safety_constrained_point_when_accuracy_is_infeasible(self) -> None:
        samples, _ = balanced_calibration()
        scores = [0.9 for _ in samples]

        report = evaluate_threshold_feasibility(
            samples,
            scores,
            reference_threshold=0.45,
            threshold_step=0.01,
            minimum_accuracy=0.91,
            maximum_complex_to_simple_count=1,
        )

        self.assertEqual(report["status"], "calibration_threshold_infeasible")
        self.assertIsNone(report["selectedOperatingPoint"])
        self.assertEqual(report["bestSafetyConstrainedOperatingPoint"]["threshold"], 0.45)
        self.assertEqual(
            report["bestSafetyConstrainedOperatingPoint"]["classification"]["accuracy"],
            0.5,
        )

    def test_builds_family_grouped_oof_scores_only_for_model_path_samples(self) -> None:
        samples = []
        vectors = []
        for family_index in range(10):
            for expected, value in (("simple", 0.1), ("complex", 0.9)):
                samples.append(
                    {
                        "split": "calibration",
                        "familyId": f"family.{family_index:02d}",
                        "expectedDifficulty": expected,
                        "modelPath": True,
                    }
                )
                vectors.append([value])
        samples.append(
            {
                "split": "calibration",
                "familyId": "bypass.00",
                "expectedDifficulty": "complex",
                "modelPath": False,
            }
        )
        vectors.append([1.0])
        artifact = {
            "weights": [2.0],
            "bias": -1.0,
            "calibrator": {"type": "platt"},
        }
        calibration_policy = {
            "groupFolds": 5,
            "platt": {"solver": "lbfgs", "c": 1000000.0, "maxIterations": 2000},
        }

        scores = family_grouped_oof_calibrated_scores(
            samples,
            vectors,
            artifact,
            calibration_policy,
        )

        self.assertEqual(len(scores), len(samples))
        self.assertTrue(all(0.0 <= score <= 1.0 for score in scores[:-1]))
        self.assertIsNone(scores[-1])


if __name__ == "__main__":
    unittest.main()
