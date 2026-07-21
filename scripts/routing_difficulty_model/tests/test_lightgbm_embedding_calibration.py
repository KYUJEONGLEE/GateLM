from __future__ import annotations

import copy
import unittest

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

from gatelm_difficulty_model.lightgbm_embedding_calibration import (
    CALIBRATION_EPSILON,
    CATEGORIES,
    C_FN_SCENARIOS,
    aggregate_category_and_slice_metrics,
    apply_calibrator,
    classification_metrics,
    family_group_metric_bootstrap,
    family_group_threshold_bootstrap,
    fit_calibrator,
    probability_logit,
    select_calibrator,
    select_threshold_for_cost,
    select_threshold_scenarios,
    threshold_candidates,
    validate_calibrator_artifact,
)
from gatelm_difficulty_model.lightgbm_embedding_experiment import (
    REQUIRED_SLICES,
    ExperimentError,
    canonical_sha256,
)


def calibration_data():
    labels = np.asarray(([0, 1] * 20), dtype=np.int8)
    probability = np.asarray(
        [0.05 if label == 0 else 0.95 for label in labels], dtype=np.float64
    )
    probability[::7] = 0.45
    return probability, labels


def threshold_data():
    labels = []
    probability = []
    categories = []
    champion = []
    families = []
    for category_index, category in enumerate(CATEGORIES):
        for offset, (label, score) in enumerate(
            ((0, 0.05), (0, 0.35), (1, 0.55), (1, 0.85))
        ):
            labels.append(label)
            probability.append(score - category_index * 0.005)
            categories.append(category)
            champion.append(1 if label == 1 else 0)
            families.append(f"{category}-{offset}")
    identity = canonical_sha256({"rows": "aligned"})
    return (
        np.asarray(probability),
        np.asarray(labels, dtype=np.int8),
        categories,
        np.asarray(champion, dtype=np.int8),
        families,
        identity,
    )


class CalibratorTests(unittest.TestCase):
    def test_none_serialization_and_apply_parity(self) -> None:
        probability, labels = calibration_data()
        artifact = fit_calibrator("none", probability, labels).as_json()
        self.assertTrue(np.array_equal(apply_calibrator(artifact, probability), probability))
        validate_calibrator_artifact(artifact)

    def test_platt_serialization_and_apply_parity(self) -> None:
        probability, labels = calibration_data()
        artifact = fit_calibrator("platt", probability, labels).as_json()
        expected_model = LogisticRegression(
            penalty="l2", solver="lbfgs", max_iter=1000, random_state=20260721
        ).fit(probability_logit(probability).reshape(-1, 1), labels)
        expected = expected_model.predict_proba(
            probability_logit(probability).reshape(-1, 1)
        )[:, 1]
        self.assertTrue(np.allclose(apply_calibrator(artifact, probability), expected))

    def test_isotonic_serialization_and_apply_parity(self) -> None:
        probability, labels = calibration_data()
        artifact = fit_calibrator("isotonic", probability, labels).as_json()
        expected = IsotonicRegression(out_of_bounds="clip").fit(
            probability, labels
        ).predict(probability)
        self.assertTrue(np.allclose(apply_calibrator(artifact, probability), expected))

    def test_platt_probability_logit_clips_extremes(self) -> None:
        values = probability_logit([0.0, 1.0])
        self.assertTrue(np.all(np.isfinite(values)))
        self.assertAlmostEqual(
            values[0], np.log(CALIBRATION_EPSILON / (1 - CALIBRATION_EPSILON))
        )

    def test_calibration_selection_records_brier_and_log_loss(self) -> None:
        probability, labels = calibration_data()
        selection = select_calibrator(
            oof_probability=probability,
            train_labels=labels,
            validation_raw_probability=probability,
            validation_labels=labels,
        )
        self.assertEqual(len(selection.aggregate_results), 3)
        winner = min(
            selection.aggregate_results,
            key=lambda item: (
                item["validationBrierScore"], item["validationLogLoss"], item["name"]
            ),
        )
        self.assertEqual(selection.selected_artifact["type"], winner["name"])

    def test_calibrator_content_hash_tamper_is_rejected(self) -> None:
        probability, labels = calibration_data()
        artifact = fit_calibrator("platt", probability, labels).as_json()
        artifact["parameters"]["intercept"] += 1
        with self.assertRaisesRegex(ExperimentError, "CALIBRATOR_CONTENT_HASH_MISMATCH"):
            validate_calibrator_artifact(artifact)

    def test_calibrator_rejects_out_of_range_probability(self) -> None:
        probability, labels = calibration_data()
        artifact = fit_calibrator("none", probability, labels).as_json()
        with self.assertRaisesRegex(ExperimentError, "RAW_PROBABILITY_INVALID"):
            apply_calibrator(artifact, [-0.1, 1.1])

    def test_unknown_calibrator_is_rejected(self) -> None:
        probability, labels = calibration_data()
        with self.assertRaisesRegex(ExperimentError, "CALIBRATOR_NAME_INVALID"):
            fit_calibrator("pickle", probability, labels)


class ThresholdTests(unittest.TestCase):
    def test_unique_threshold_candidates_include_all_simple_and_all_complex(self) -> None:
        probability = np.asarray([0.2, 0.5, 0.5, 0.9])
        candidates = threshold_candidates(probability)
        self.assertGreater(candidates[0], 0.9)
        self.assertEqual(candidates[-1], 0.2)
        self.assertEqual(len(candidates), 4)

    def test_threshold_selection_satisfies_overall_safety_and_recall(self) -> None:
        probability, labels, categories, champion, _, identity = threshold_data()
        scenario = select_threshold_for_cost(
            c_fn=3.0,
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        self.assertEqual(scenario.status, "feasible")
        self.assertLessEqual(
            scenario.selected["falseNegative"],
            scenario.selected["championFalseNegative"],
        )
        self.assertGreaterEqual(scenario.selected["complexRecall"], 0.95)

    def test_threshold_selection_satisfies_every_category_safety(self) -> None:
        probability, labels, categories, champion, _, identity = threshold_data()
        scenario = select_threshold_for_cost(
            c_fn=1.0,
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        self.assertTrue(scenario.selected["categorySafetyPassed"])
        for category in CATEGORIES:
            self.assertLessEqual(
                scenario.selected["categoryFalseNegative"][category],
                scenario.selected["championCategoryFalseNegative"][category],
            )

    def test_threshold_missing_category_is_infeasible_not_fallback(self) -> None:
        probability, labels, categories, champion, _, identity = threshold_data()
        scenario = select_threshold_for_cost(
            c_fn=1.0,
            probability=probability[:-4],
            labels=labels[:-4],
            categories=categories[:-4],
            champion_prediction=champion[:-4],
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        self.assertEqual(scenario.status, "infeasible")
        self.assertIsNone(scenario.selected)
        self.assertEqual(scenario.reason_code, "CATEGORY_EVIDENCE_INCOMPLETE")

    def test_threshold_row_identity_mismatch_is_rejected(self) -> None:
        probability, labels, categories, champion, _, identity = threshold_data()
        with self.assertRaisesRegex(ExperimentError, "CHAMPION_ROW_IDENTITY_MISMATCH"):
            select_threshold_for_cost(
                c_fn=1.0,
                probability=probability,
                labels=labels,
                categories=categories,
                champion_prediction=champion,
                row_identity_sha256=identity,
                champion_row_identity_sha256="0" * 64,
            )

    def test_all_four_cost_scenarios_are_returned_without_global_selection(self) -> None:
        probability, labels, categories, champion, _, identity = threshold_data()
        scenarios = select_threshold_scenarios(
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        self.assertEqual(tuple(item.c_fn for item in scenarios), C_FN_SCENARIOS)
        self.assertFalse(hasattr(scenarios, "selected_c_fn"))

    def test_edl_tie_break_is_deterministic(self) -> None:
        probability, labels, categories, champion, _, identity = threshold_data()
        first = select_threshold_for_cost(
            c_fn=5.0,
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        second = select_threshold_for_cost(
            c_fn=5.0,
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        self.assertEqual(first.as_json(), second.as_json())

    def test_family_group_threshold_bootstrap_is_deterministic_aggregate(self) -> None:
        probability, labels, categories, champion, families, _ = threshold_data()
        first = family_group_threshold_bootstrap(
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            family_ids=families,
            c_fn=3.0,
            repeats=30,
        )
        second = family_group_threshold_bootstrap(
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion,
            family_ids=families,
            c_fn=3.0,
            repeats=30,
        )
        self.assertEqual(first, second)
        self.assertFalse(first["containsPerSampleResult"])


class MetricTests(unittest.TestCase):
    def test_confusion_matrix_and_metrics_are_consistent(self) -> None:
        result = classification_metrics(
            labels=[0, 0, 1, 1],
            probability=[0.1, 0.8, 0.2, 0.9],
            threshold=0.5,
        )
        matrix = result["confusionMatrix"]
        self.assertEqual(
            sum(matrix[field] for field in ("trueNegative", "falsePositive", "falseNegative", "truePositive")),
            4,
        )
        self.assertEqual(result["falseNegative"], matrix["falseNegative"])
        self.assertEqual(result["falsePositive"], matrix["falsePositive"])

    def test_missing_class_support_is_protocol_failure_not_zero(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "TEST_LABEL_SUPPORT_PROTOCOL_FAILURE"):
            classification_metrics(labels=[0, 0], probability=[0.1, 0.2], threshold=0.5)

    def test_test_edl_uses_one_frozen_threshold_for_all_costs(self) -> None:
        result = classification_metrics(
            labels=[0, 0, 1, 1],
            probability=[0.1, 0.8, 0.2, 0.9],
            threshold=0.5,
        )
        self.assertEqual(result["threshold"], 0.5)
        self.assertEqual(set(result["expectedDecisionLoss"]), {"1.0", "3.0", "5.0", "10.0"})

    def test_category_and_required_slice_results_are_aggregate_only(self) -> None:
        labels = np.asarray([0, 1] * 5, dtype=np.int8)
        probability = np.asarray([0.1, 0.9] * 5)
        categories = list(CATEGORIES)
        categories = [value for value in categories for _ in (0, 1)]
        slices = [(REQUIRED_SLICES[index % len(REQUIRED_SLICES)],) for index in range(10)]
        result = aggregate_category_and_slice_metrics(
            labels=labels,
            probability=probability,
            threshold=0.5,
            family_ids=[f"family-{index}" for index in range(10)],
            categories=categories,
            slice_membership=slices,
            champion_prediction=labels,
        )
        self.assertEqual(set(result["categories"]), set(CATEGORIES))
        self.assertEqual(set(result["slices"]), set(REQUIRED_SLICES))
        self.assertEqual(
            result["slices"]["ood_terminology"]["complexRecall"],
            "not_computable",
        )

    def test_unknown_slice_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "SLICE_NAME_INVALID"):
            aggregate_category_and_slice_metrics(
                labels=[0, 1],
                probability=[0.1, 0.9],
                threshold=0.5,
                family_ids=["a", "b"],
                categories=["general", "general"],
                slice_membership=[["unknown"], []],
                champion_prediction=[0, 1],
            )

    def test_family_group_metric_bootstrap_is_deterministic(self) -> None:
        labels = [0, 1] * 10
        probability = [0.1, 0.9] * 10
        families = [f"family-{index}" for index in range(20)]
        first = family_group_metric_bootstrap(
            labels=labels,
            probability=probability,
            threshold=0.5,
            family_ids=families,
            repeats=20,
        )
        second = family_group_metric_bootstrap(
            labels=labels,
            probability=probability,
            threshold=0.5,
            family_ids=families,
            repeats=20,
        )
        self.assertEqual(first, second)
        self.assertFalse(first["containsPerSampleResult"])


if __name__ == "__main__":
    unittest.main()
