from __future__ import annotations

import json
import unittest

import numpy as np

from gatelm_difficulty_model.encoder_runtime import canonical_hash
from gatelm_difficulty_model.semantic_heads import (
    evaluate_semantic_head_probabilities,
    flatten_semantic_head_probabilities,
    predict_semantic_head_probabilities,
    train_and_evaluate_semantic_heads,
    train_semantic_heads,
    validate_semantic_heads_artifact,
)
from gatelm_difficulty_model.semantic_features import SEMANTIC_HEAD_SPECS_V1


def training_labels() -> dict[str, list[str]]:
    return {
        spec.name: [spec.classes[index % 3] for index in range(12)]
        for spec in SEMANTIC_HEAD_SPECS_V1
    }


def one_hot_like_probabilities() -> dict[str, np.ndarray]:
    rows = np.asarray(
        [
            [0.8, 0.1, 0.1],
            [0.1, 0.8, 0.1],
            [0.1, 0.1, 0.8],
        ],
        dtype=np.float64,
    )
    return {spec.name: rows.copy() for spec in SEMANTIC_HEAD_SPECS_V1}


def evaluation_targets() -> dict[str, list[str]]:
    return {spec.name: list(spec.classes) for spec in SEMANTIC_HEAD_SPECS_V1}


class SemanticHeadsTest(unittest.TestCase):
    def test_trains_four_ordered_heads_and_replays_twelve_probabilities(self) -> None:
        embeddings = np.asarray(
            [[index, index % 3, (index * 2) % 5, 1.0] for index in range(12)],
            dtype=np.float32,
        )
        artifact = train_semantic_heads(
            embeddings,
            training_labels(),
            artifact_version="difficulty-semantic-heads.test-v1",
            encoder_version="difficulty-encoder.test-v1",
            encoder_hash="a" * 64,
            pooling_version="difficulty-pooling.test-v1",
        )

        self.assertEqual(artifact["semanticHeadProbabilityDimension"], 12)
        self.assertEqual(
            [(head["name"], tuple(head["classes"])) for head in artifact["heads"]],
            [(spec.name, spec.classes) for spec in SEMANTIC_HEAD_SPECS_V1],
        )
        self.assertTrue(artifact["encoderFrozen"])
        self.assertEqual(artifact["optimizerParameterScope"], "semantic_heads_only")
        self.assertEqual(artifact["trainingObjective"], "fixed_unweighted_sum_multinomial_cross_entropy.v1")
        self.assertEqual(
            artifact["headLossWeights"],
            {spec.name: 1.0 for spec in SEMANTIC_HEAD_SPECS_V1},
        )

        first = predict_semantic_head_probabilities(artifact, embeddings[:2])
        second = predict_semantic_head_probabilities(artifact, embeddings[:2])
        for spec in SEMANTIC_HEAD_SPECS_V1:
            self.assertEqual(first[spec.name].shape, (2, 3))
            np.testing.assert_array_equal(first[spec.name], second[spec.name])
            np.testing.assert_allclose(first[spec.name].sum(axis=1), np.ones(2), atol=1e-12)

        flattened = flatten_semantic_head_probabilities(first, sample_index=0)
        self.assertEqual(len(flattened), 12)
        self.assertAlmostEqual(sum(flattened[0:3]), 1.0)
        self.assertAlmostEqual(sum(flattened[9:12]), 1.0)
        validate_semantic_heads_artifact(artifact)

    def test_artifact_hash_and_exact_head_contract_fail_closed(self) -> None:
        embeddings = np.eye(12, 4, dtype=np.float32)
        artifact = train_semantic_heads(
            embeddings,
            training_labels(),
            artifact_version="difficulty-semantic-heads.test-v1",
            encoder_version="difficulty-encoder.test-v1",
            encoder_hash="b" * 64,
            pooling_version="difficulty-pooling.test-v1",
        )

        tampered = json.loads(json.dumps(artifact))
        tampered["heads"][0]["classes"] = list(reversed(tampered["heads"][0]["classes"]))
        with self.assertRaisesRegex(ValueError, "fixed four-head contract"):
            validate_semantic_heads_artifact(tampered)

        tampered = json.loads(json.dumps(artifact))
        tampered["heads"][0]["intercept"][0] += 0.01
        with self.assertRaisesRegex(ValueError, "content hash"):
            validate_semantic_heads_artifact(tampered)

        tampered = json.loads(json.dumps(artifact))
        tampered["encoderHash"] = "not-a-sha256"
        hash_material = dict(tampered)
        hash_material.pop("artifactContentHash")
        tampered["artifactContentHash"] = canonical_hash(hash_material)
        with self.assertRaisesRegex(ValueError, "encoder hash"):
            validate_semantic_heads_artifact(tampered)

    def test_rejects_missing_unknown_or_incomplete_training_labels(self) -> None:
        embeddings = np.eye(6, dtype=np.float32)
        labels = {
            spec.name: [spec.classes[index % 3] for index in range(6)]
            for spec in SEMANTIC_HEAD_SPECS_V1
        }
        labels.pop("semanticTaskBucket")
        with self.assertRaisesRegex(ValueError, "fixed four-head label contract"):
            train_semantic_heads(
                embeddings,
                labels,
                artifact_version="difficulty-semantic-heads.test-v1",
                encoder_version="difficulty-encoder.test-v1",
                encoder_hash="c" * 64,
                pooling_version="difficulty-pooling.test-v1",
            )

        labels = {
            spec.name: [spec.classes[0]] * 6 for spec in SEMANTIC_HEAD_SPECS_V1
        }
        with self.assertRaisesRegex(ValueError, "all three classes"):
            train_semantic_heads(
                embeddings,
                labels,
                artifact_version="difficulty-semantic-heads.test-v1",
                encoder_version="difficulty-encoder.test-v1",
                encoder_hash="c" * 64,
                pooling_version="difficulty-pooling.test-v1",
            )

    def test_reports_head_bucket_calibration_language_and_slice_aggregates(self) -> None:
        report = evaluate_semantic_head_probabilities(
            one_hot_like_probabilities(),
            evaluation_targets(),
            [
                {"language": "ko", "evaluationSlices": ["korean", "long_simple"]},
                {"language": "en", "evaluationSlices": ["english", "short_complex"]},
                {"language": "mixed", "evaluationSlices": ["mixed_language"]},
            ],
            calibration_bins=5,
        )

        self.assertEqual(report["schemaVersion"], "gatelm.difficulty-semantic-head-evaluation.v1")
        self.assertEqual(report["sampleCount"], 3)
        task = report["headMetrics"]["semanticTaskBucket"]
        self.assertEqual(task["macroF1"], 1.0)
        self.assertEqual([item["recall"] for item in task["classes"]], [1.0, 1.0, 1.0])
        self.assertAlmostEqual(task["multiclassBrierScore"], 0.06)
        self.assertAlmostEqual(task["expectedCalibrationError"], 0.2)
        self.assertEqual(report["byLanguage"]["ko"]["support"], 1)
        self.assertEqual(report["byLanguage"]["unknown"], {"status": "empty", "support": 0})
        self.assertEqual(report["bySlice"]["short_complex"]["support"], 1)
        self.assertEqual(report["bySlice"]["ood_terminology"], {"status": "empty", "support": 0})

        serialized = json.dumps(report, sort_keys=True)
        for forbidden in (
            "instructionText",
            "embedding",
            "assembledVector",
            "sampleId",
            "perSample",
            "headProbabilities",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_rejects_invalid_probability_material_without_zero_fill(self) -> None:
        probabilities = one_hot_like_probabilities()
        probabilities["semanticTaskBucket"][0] = [0.4, 0.4, 0.4]
        with self.assertRaisesRegex(ValueError, "sum to one"):
            evaluate_semantic_head_probabilities(
                probabilities,
                evaluation_targets(),
                [{"language": value, "evaluationSlices": []} for value in ("ko", "en", "mixed")],
            )

        probabilities = one_hot_like_probabilities()
        probabilities["semanticTaskBucket"][0, 0] = np.nan
        with self.assertRaisesRegex(ValueError, "finite"):
            flatten_semantic_head_probabilities(probabilities, sample_index=0)

    def test_offline_workflow_trains_and_reports_without_serializing_sensitive_material(self) -> None:
        exported = semantic_head_training_export()

        def encode(instruction_text: str) -> np.ndarray:
            index = int(instruction_text.removeprefix("approved instruction "))
            return np.asarray(
                [index % 3, (index // 3) % 3, index / 20.0, 1.0], dtype=np.float32
            )

        artifact, report = train_and_evaluate_semantic_heads(
            exported,
            encode,
            artifact_version="difficulty-semantic-heads.workflow-test-v1",
            encoder_version="difficulty-encoder.workflow-test-v1",
            encoder_hash="d" * 64,
            pooling_version="difficulty-pooling.workflow-test-v1",
        )

        self.assertEqual(artifact["training"]["datasetVersion"], "approved_semantic_heads_v1")
        self.assertEqual(artifact["training"]["trainSamples"], 9)
        self.assertEqual(report["splits"]["calibration"]["sampleCount"], 3)
        self.assertEqual(report["splits"]["holdout"]["sampleCount"], 3)
        self.assertEqual(report["semanticHeadProbabilityDimension"], 12)
        serialized = json.dumps(report, sort_keys=True)
        for forbidden in (
            "approved instruction",
            "instructionText",
            "embedding",
            "headProbabilities",
            "sampleId",
        ):
            self.assertNotIn(forbidden, serialized)

    def test_candidate_selection_phase_does_not_evaluate_holdout_heads(self) -> None:
        exported = semantic_head_training_export()

        def encode(instruction_text: str) -> np.ndarray:
            index = int(instruction_text.removeprefix("approved instruction "))
            return np.asarray(
                [index % 3, (index // 3) % 3, index / 20.0, 1.0], dtype=np.float32
            )

        _, report = train_and_evaluate_semantic_heads(
            exported,
            encode,
            artifact_version="difficulty-semantic-heads.selection-test-v1",
            encoder_version="difficulty-encoder.selection-test-v1",
            encoder_hash="d" * 64,
            pooling_version="difficulty-pooling.selection-test-v1",
            evaluation_splits=("calibration",),
        )

        self.assertEqual(set(report["splits"]), {"calibration"})
        self.assertNotIn("holdout", report["splits"])

    def test_offline_workflow_rejects_family_split_leakage(self) -> None:
        exported = semantic_head_training_export()
        exported["samples"][-1]["familyId"] = exported["samples"][0]["familyId"]
        with self.assertRaisesRegex(ValueError, "family-disjoint"):
            train_and_evaluate_semantic_heads(
                exported,
                lambda _text: np.ones(4, dtype=np.float32),
                artifact_version="difficulty-semantic-heads.workflow-test-v1",
                encoder_version="difficulty-encoder.workflow-test-v1",
                encoder_hash="e" * 64,
                pooling_version="difficulty-pooling.workflow-test-v1",
            )


def semantic_head_training_export() -> dict:
    samples = []
    splits = (("train", 9), ("calibration", 3), ("holdout", 3))
    index = 0
    for split, count in splits:
        for offset in range(count):
            classes = offset % 3
            samples.append(
                {
                    "sampleId": f"opaque-{index}",
                    "familyId": f"family.{split}.{offset}",
                    "split": split,
                    "expectedCategory": "general",
                    "expectedDifficulty": "simple" if classes == 0 else "complex",
                    "language": ("ko", "en", "mixed")[classes],
                    "evaluationSlices": [("korean", "english", "mixed_language")[classes]],
                    "instructionText": f"approved instruction {index}",
                    "taskBucket": SEMANTIC_HEAD_SPECS_V1[0].classes[classes],
                    "constraintBucket": SEMANTIC_HEAD_SPECS_V1[1].classes[classes],
                    "scopeBucket": SEMANTIC_HEAD_SPECS_V1[2].classes[classes],
                    "dependencyBucket": SEMANTIC_HEAD_SPECS_V1[3].classes[classes],
                }
            )
            index += 1
    return {
        "schemaVersion": "gatelm.difficulty-semantic-head-training-input.v1",
        "datasetVersion": "approved_semantic_heads_v1",
        "datasetSha256": "f" * 64,
        "familyPolicyVersion": "difficulty-prompt-family.v1",
        "familyPolicy": "approved-family-policy-v1",
        "semanticHeads": [
            {"name": spec.name, "classes": list(spec.classes)}
            for spec in SEMANTIC_HEAD_SPECS_V1
        ],
        "excludedEmptyInstructionCount": 0,
        "samples": samples,
    }


if __name__ == "__main__":
    unittest.main()
