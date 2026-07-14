from __future__ import annotations

import copy
import unittest

import numpy as np

from gatelm_difficulty_model.candidate_training import (
    EXPECTED_CANDIDATE_DIMENSIONS,
    assemble_candidate_samples,
    candidate_membership_hash,
    select_candidate_by_holdout_accuracy,
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
                    "modelPath": True,
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


class CandidateTrainingTest(unittest.TestCase):
    def test_selects_unique_highest_holdout_accuracy(self) -> None:
        reports = {
            "candidate-a": {"holdoutClassification": {"accuracy": 0.70}},
            "candidate-b": {"holdoutClassification": {"accuracy": 0.90}},
            "candidate-c": {"holdoutClassification": {"accuracy": 0.91}},
        }

        self.assertEqual(
            select_candidate_by_holdout_accuracy(reports),
            "candidate-c",
        )

    def test_rejects_tied_highest_holdout_accuracy(self) -> None:
        reports = {
            "candidate-b": {"holdoutClassification": {"accuracy": 0.90}},
            "candidate-c": {"holdoutClassification": {"accuracy": 0.90}},
        }

        with self.assertRaisesRegex(ValueError, "unique highest"):
            select_candidate_by_holdout_accuracy(reports)

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

    def test_rejects_count_drift_and_family_leakage(self) -> None:
        exported = candidate_export()
        exported["splitCounts"]["holdout"]["records"] = 99
        with self.assertRaisesRegex(ValueError, "exactly 100"):
            validate_candidate_training_input(exported)

        exported = candidate_export()
        exported["samples"][300]["familyId"] = exported["samples"][0]["familyId"]
        with self.assertRaisesRegex(ValueError, "leaked across splits"):
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
