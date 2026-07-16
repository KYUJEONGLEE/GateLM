from __future__ import annotations

import unittest

import numpy as np

from gatelm_difficulty_model.model_path_5000 import (
    _operating_point_metrics_core,
    family_bootstrap_joint_accuracy,
    operating_point_metrics,
    sweep_thresholds,
    validate_selection_export,
    validate_test_export,
)


def sample(sample_id: str, family: str, split: str, label: int) -> dict:
    return {
        "sampleId": sample_id,
        "familyId": family,
        "split": split,
        "label": label,
        "modelPath": True,
        "expectedCategory": "general",
        "actualCategory": "general",
        "expectedDifficulty": "complex" if label else "simple",
        "language": "en",
        "evaluationSlices": ["english"],
    }


class ModelPath5000Tests(unittest.TestCase):
    def test_selection_export_rejects_holdout_access(self) -> None:
        exported = {
            "holdoutOutcomeAccessed": True,
            "includedPartitions": ["train", "calibration"],
            "samples": [],
        }
        with self.assertRaisesRegex(ValueError, "accessed holdout"):
            validate_selection_export(exported, {})

    def test_final_test_export_requires_frozen_test_roles(self) -> None:
        samples = [sample(f"e-{index}", f"evaluation-{index // 5}", "holdout", index % 2) for index in range(750)]
        samples.extend(
            sample(f"p-{index}", f"promotion-{index // 5}", "holdout", index % 2)
            for index in range(250)
        )
        roles = {
            **{f"evaluation-{index}": "evaluation_holdout" for index in range(150)},
            **{f"promotion-{index}": "promotion_holdout" for index in range(50)},
        }
        actual, report = validate_test_export(
            {
                "holdoutOutcomeAccessed": True,
                "includedPartitions": ["holdout"],
                "samples": samples,
            },
            roles,
        )
        self.assertEqual(len(actual), 1000)
        self.assertEqual(report["records"], {"evaluation_holdout": 750, "promotion_holdout": 250})

    def test_threshold_sweep_maximizes_joint_accuracy_with_inclusive_boundary(self) -> None:
        samples = [
            sample("s1", "f1", "calibration", 0),
            sample("s2", "f2", "calibration", 0),
            sample("c1", "f3", "calibration", 1),
            sample("c2", "f4", "calibration", 1),
        ]
        selected, points = sweep_thresholds(samples, np.asarray([0.1, 0.2, 0.8, 0.9]))
        self.assertEqual(selected["jointRoutingAccuracy"], 1.0)
        self.assertGreaterEqual(selected["threshold"], 0.2)
        self.assertLessEqual(selected["threshold"], 0.8)
        self.assertGreater(len(points), 1000)

    def test_operating_point_core_matches_compatibility_wrapper(self) -> None:
        samples = [
            sample("s1", "f1", "calibration", 0),
            sample("c1", "f2", "calibration", 1),
        ]
        samples[1]["actualCategory"] = "code"
        probabilities = np.asarray([0.2, 0.8])
        expected = operating_point_metrics(samples, probabilities, 0.5)

        actual = _operating_point_metrics_core(
            np.asarray([0, 1], dtype=int),
            np.asarray([True, False], dtype=bool),
            probabilities,
            0.5,
        )

        self.assertEqual(actual, expected)

    def test_family_bootstrap_remains_deterministic_with_array_indices(self) -> None:
        samples = [
            sample("s1", "f1", "holdout", 0),
            sample("s2", "f1", "holdout", 0),
            sample("c1", "f2", "holdout", 1),
            sample("c2", "f3", "holdout", 1),
        ]
        probabilities = np.asarray([0.1, 0.9, 0.8, 0.2])

        first = family_bootstrap_joint_accuracy(
            samples, probabilities, 0.5, iterations=100
        )
        second = family_bootstrap_joint_accuracy(
            samples, probabilities, 0.5, iterations=100
        )

        self.assertEqual(first, second)
        self.assertLessEqual(first["lower95"], first["upper95"])


if __name__ == "__main__":
    unittest.main()
