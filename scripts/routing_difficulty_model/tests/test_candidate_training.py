from __future__ import annotations

import copy
import unittest

import numpy as np

from gatelm_difficulty_model.candidate_training import (
    EXPECTED_CANDIDATE_DIMENSIONS,
    EXPECTED_MODEL_PATH_SPLIT_RECORDS,
    assemble_candidate_samples,
    candidate_membership_hash,
    select_candidate_by_calibration_evidence,
    validate_candidate_training_input,
)
from gatelm_difficulty_model.semantic_features import (
    RULE_VECTOR_V1_FEATURE_NAMES,
    SEMANTIC_HEAD_SPECS_V1,
    OfflineFeatureCandidate,
    OfflineFeatureShape,
)


def candidate_export() -> dict:
    samples = []
    split_counts = (("train", 300), ("calibration", 100), ("holdout", 100))
    global_index = 0
    declared_counts = {}
    for split, count in split_counts:
        families = set()
        for split_index in range(count):
            class_index = global_index % 3
            family_id = f"family.{split}.{split_index // 10:02d}"
            families.add(family_id)
            expected_difficulty = "complex" if global_index % 2 else "simple"
            samples.append(
                {
                    "sampleId": f"opaque-{global_index:03d}",
                    "familyId": family_id,
                    "split": split,
                    "label": 1 if expected_difficulty == "complex" else 0,
                    "expectedCategory": "general",
                    "actualCategory": "general",
                    "vectorCategory": "general",
                    "expectedDifficulty": expected_difficulty,
                    "ruleDifficulty": expected_difficulty,
                    "modelPath": split_index < EXPECTED_MODEL_PATH_SPLIT_RECORDS[split],
                    "ruleVectorV1": [float((global_index + offset) % 11) / 10.0 for offset in range(42)],
                    "language": ("ko", "en", "mixed")[class_index],
                    "evaluationSlices": [("korean", "english", "mixed_language")[class_index]],
                    "instructionText": f"eligible instruction {global_index}",
                    "taskBucket": SEMANTIC_HEAD_SPECS_V1[0].classes[class_index],
                    "constraintBucket": SEMANTIC_HEAD_SPECS_V1[1].classes[class_index],
                    "scopeBucket": SEMANTIC_HEAD_SPECS_V1[2].classes[class_index],
                    "dependencyBucket": SEMANTIC_HEAD_SPECS_V1[3].classes[class_index],
                }
            )
            global_index += 1
        declared_counts[split] = {"families": len(families), "records": count}
    return {
        "schemaVersion": "gatelm.difficulty-semantic-head-training-input.v1",
        "datasetVersion": "difficulty_training_test_500_v1",
        "datasetSha256": "a" * 64,
        "manifestSha256": "b" * 64,
        "familyPolicyVersion": "difficulty-prompt-family.v1",
        "familyPolicy": "difficulty-training-minimum-family-policy.test-v1",
        "splitPolicyVersion": "difficulty-family-constrained-split.2026-07-15.v1",
        "splitSeed": 20260715,
        "splitCounts": declared_counts,
        "featureVersion": "difficulty-feature-vector.v1",
        "featureNames": list(RULE_VECTOR_V1_FEATURE_NAMES),
        "categorySource": "actual",
        "semanticHeads": [
            {"name": spec.name, "classes": list(spec.classes)}
            for spec in SEMANTIC_HEAD_SPECS_V1
        ],
        "excludedEmptyInstructionCount": 0,
        "samples": samples,
    }


def semantic_probabilities(sample_count: int) -> dict[str, np.ndarray]:
    result = {}
    for spec in SEMANTIC_HEAD_SPECS_V1:
        values = np.full((sample_count, 3), 0.1, dtype=np.float64)
        for index in range(sample_count):
            values[index, index % 3] = 0.8
        result[spec.name] = values
    return result


def candidate_selection_policy() -> dict:
    return {
        "policyVersion": "difficulty-semantic-candidate-selection.test-v1",
        "evidenceSplit": "calibration",
        "selectionMetric": "selected_calibrator_group_cv_log_loss",
        "tieTolerance": 0.000001,
        "tieBreakers": ["selected_calibrator_group_cv_brier_score", "lower_dimension"],
        "holdoutUsage": "final_evaluation_after_candidate_freeze_only",
    }


def candidate_report(dimension: int, log_loss: float, brier_score: float) -> dict:
    return {
        "totalDimension": dimension,
        "selectionEvidence": {
            "evidenceSplit": "calibration",
            "evaluationMethod": "selected_calibrator_family_grouped_cross_validation",
            "selectedCalibratorType": "platt",
            "groupCvLogLoss": log_loss,
            "groupCvBrierScore": brier_score,
        },
    }


class CandidateTrainingTest(unittest.TestCase):
    def test_selects_lowest_calibration_group_cv_loss_without_holdout(self) -> None:
        reports = {
            "candidate-a": candidate_report(42, 0.70, 0.25),
            "candidate-b": candidate_report(106, 0.40, 0.12),
            "candidate-c": candidate_report(118, 0.31, 0.06),
        }

        self.assertEqual(
            select_candidate_by_calibration_evidence(reports, candidate_selection_policy()),
            "candidate-c",
        )

    def test_holdout_outcomes_cannot_change_candidate_selection(self) -> None:
        reports = {
            "candidate-a": {
                **candidate_report(42, 0.70, 0.25),
                "holdoutClassification": {"accuracy": 1.0},
            },
            "candidate-b": {
                **candidate_report(106, 0.40, 0.12),
                "holdoutClassification": {"accuracy": 0.0},
            },
        }

        self.assertEqual(
            select_candidate_by_calibration_evidence(reports, candidate_selection_policy()),
            "candidate-b",
        )

    def test_breaks_calibration_metric_ties_by_lower_dimension(self) -> None:
        reports = {
            "candidate-b": candidate_report(106, 0.40, 0.12),
            "candidate-c": candidate_report(118, 0.40, 0.12),
        }

        self.assertEqual(
            select_candidate_by_calibration_evidence(reports, candidate_selection_policy()),
            "candidate-b",
        )

    def test_validates_exact_300_100_100_and_assembles_42_106_118(self) -> None:
        exported = candidate_export()
        samples = validate_candidate_training_input(exported)
        projected = np.asarray(
            [[((index + column) % 17) / 8.0 - 1.0 for column in range(64)] for index in range(500)],
            dtype=np.float64,
        )
        shape = OfflineFeatureShape(
            projection_dimension=64,
            projection_version="difficulty-e5-pca-full-svd-64.test-v1",
            semantic_heads_version="difficulty-semantic-heads.test-v1",
        )
        matrices = assemble_candidate_samples(
            samples,
            projected,
            semantic_probabilities(len(samples)),
            shape,
        )

        self.assertEqual(
            {candidate: len(rows[0]["vector"]) for candidate, rows in matrices.items()},
            EXPECTED_CANDIDATE_DIMENSIONS,
        )
        rule = matrices[OfflineFeatureCandidate.RULE_VECTOR_V1][137]["vector"]
        projected_vector = matrices[
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION
        ][137]["vector"]
        combined = matrices[
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS
        ][137]["vector"]
        self.assertEqual(projected_vector[:42], rule)
        self.assertEqual(combined[:106], projected_vector)
        self.assertEqual(
            {candidate_membership_hash(rows) for rows in matrices.values()},
            {candidate_membership_hash(samples)},
        )
        self.assertEqual(
            {
                split: sum(sample["split"] == split and sample["modelPath"] for sample in samples)
                for split in EXPECTED_MODEL_PATH_SPLIT_RECORDS
            },
            EXPECTED_MODEL_PATH_SPLIT_RECORDS,
        )

    def test_rejects_count_drift_and_family_leakage(self) -> None:
        exported = candidate_export()
        exported["splitCounts"]["holdout"]["records"] = 99
        with self.assertRaisesRegex(ValueError, "exactly 100"):
            validate_candidate_training_input(exported)

        exported = candidate_export()
        exported["samples"][300]["familyId"] = exported["samples"][0]["familyId"]
        with self.assertRaisesRegex(ValueError, "leaked across splits"):
            validate_candidate_training_input(exported)

        exported = candidate_export()
        sentinel = next(
            sample
            for sample in exported["samples"]
            if sample["split"] == "train" and not sample["modelPath"]
        )
        sentinel["modelPath"] = True
        with self.assertRaisesRegex(ValueError, "model-path counts"):
            validate_candidate_training_input(exported)

    def test_rejects_candidate_specific_sample_or_prefix_drift(self) -> None:
        exported = candidate_export()
        samples = validate_candidate_training_input(exported)
        tampered = copy.deepcopy(samples)
        tampered[0]["ruleVectorV1"] = [0.0] * 41
        with self.assertRaisesRegex(ValueError, "exact 42D"):
            validate_candidate_training_input({**exported, "samples": tampered})


if __name__ == "__main__":
    unittest.main()
