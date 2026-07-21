from __future__ import annotations

import unittest

import numpy as np

from gatelm_difficulty_model.lightgbm_input_ablation import (
    CANDIDATE_DIMENSIONS,
    binary_metrics,
    fixed_lightgbm_parameters,
    flatten_semantic_probabilities,
    select_current_shadow_threshold,
    validate_split_contract,
)
from gatelm_difficulty_model.semantic_features import SEMANTIC_HEAD_SPECS_V1


class LightGBMInputAblationTests(unittest.TestCase):
    def test_fixed_parameters_match_current_shadow_baseline(self) -> None:
        parameters = fixed_lightgbm_parameters()
        self.assertEqual(parameters["learning_rate"], 0.05)
        self.assertEqual(parameters["num_leaves"], 31)
        self.assertEqual(parameters["min_data_in_leaf"], 20)
        self.assertEqual(parameters["feature_fraction"], 1.0)
        self.assertEqual(parameters["bagging_fraction"], 1.0)
        self.assertEqual(parameters["bagging_freq"], 0)
        self.assertEqual(parameters["seed"], 20260721)
        self.assertTrue(parameters["deterministic"])
        self.assertTrue(parameters["force_col_wise"])
        self.assertEqual(parameters["num_threads"], 1)
        self.assertEqual(
            CANDIDATE_DIMENSIONS,
            {
                "E1_embedding_768": 768,
                "E2_embedding_768_plus_rule_42": 810,
                "E3_pca_128_plus_rule_42": 170,
                "E4_semantic_heads_12_plus_rule_42": 54,
            },
        )

    def test_threshold_matches_current_accuracy_first_rule(self) -> None:
        labels = np.asarray([0, 0, 1, 1], dtype=np.int8)
        scores = np.asarray([0.1, 0.4, 0.3, 0.8], dtype=np.float64)
        self.assertEqual(select_current_shadow_threshold(labels, scores), 0.3)

    def test_binary_metrics_include_hyperparameter_report_measurements(self) -> None:
        labels = np.asarray([0, 0, 1, 1], dtype=np.int8)
        scores = np.asarray([0.1, 0.7, 0.2, 0.9], dtype=np.float64)
        result = binary_metrics(labels, scores, 0.5)
        self.assertEqual(result["confusionMatrix"], {"tn": 1, "fp": 1, "fn": 1, "tp": 1})
        self.assertEqual(result["falseNegativeCount"], 1)
        self.assertEqual(result["falsePositiveCount"], 1)
        self.assertEqual(result["expectedDecisionLoss"]["cFn10"], 2.75)
        for key in ("accuracy", "balancedAccuracy", "macroF1", "rocAuc", "averagePrecision", "brierScore", "logLoss"):
            self.assertIn(key, result)

    def test_semantic_probabilities_flatten_in_contract_order(self) -> None:
        probabilities = {
            spec.name: np.asarray([[0.2, 0.3, 0.5], [0.1, 0.2, 0.7]])
            for spec in SEMANTIC_HEAD_SPECS_V1
        }
        flattened = flatten_semantic_probabilities(probabilities)
        self.assertEqual(flattened.shape, (2, 12))
        np.testing.assert_allclose(flattened[0, :3], [0.2, 0.3, 0.5])

    def test_split_contract_rejects_cross_split_family(self) -> None:
        with self.assertRaisesRegex(ValueError, "crosses dataset splits"):
            validate_split_contract(
                labels=[0, 1, 0, 1, 0, 1],
                splits=["train", "train", "calibration", "calibration", "holdout", "holdout"],
                family_ids=["a", "b", "a", "d", "e", "f"],
                expected_count=6,
            )


if __name__ == "__main__":
    unittest.main()
