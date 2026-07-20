from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from gatelm_difficulty_model.lightgbm_shadow import (
    MODEL_ID,
    MODEL_SOURCE_REVISION,
    PROFILE_SCHEMA,
    SEMANTIC_RUNTIME_CANDIDATES,
    _validate_family_disjoint,
    _validated_training_inputs,
    require_training_eligible_dataset_manifest,
    train_lightgbm_shadow_candidates,
)


class LightGBMShadowInputGuardTests(unittest.TestCase):
    def test_current_initial_dataset_is_rejected_for_training(self) -> None:
        repository_root = Path(__file__).resolve().parents[3]
        manifest_path = (
            repository_root
            / "docs"
            / "routing"
            / "datasets"
            / "difficulty"
            / "data"
            / "initial-routing-difficulty-15000.manifest.json"
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        with self.assertRaisesRegex(ValueError, "not training eligible"):
            require_training_eligible_dataset_manifest(manifest)
        with tempfile.TemporaryDirectory() as temporary_directory, self.assertRaisesRegex(
            ValueError,
            "not training eligible",
        ):
            train_lightgbm_shadow_candidates(
                rule_vectors=[],
                pooled_embeddings=[],
                labels=[],
                splits=[],
                family_ids=[],
                encoder_descriptor={},
                dataset_manifest=manifest,
                dataset_provenance={},
                output_directory=Path(temporary_directory),
                model_version="difficulty-lightgbm-shadow.must-not-train.v1",
            )

    def test_exact_768d_embedding_shape_is_required(self) -> None:
        with self.assertRaisesRegex(ValueError, r"\[records,768\]"):
            _validated_training_inputs(
                np.zeros((3, 42), dtype=np.float64),
                np.zeros((3, 384), dtype=np.float32),
                ["simple", "complex", "simple"],
                ["train", "validation", "test"],
                ["train-family", "validation-family", "test-family"],
            )

    def test_prompt_families_must_be_disjoint_across_splits(self) -> None:
        with self.assertRaisesRegex(ValueError, "prompt family crosses"):
            _validate_family_disjoint(
                np.asarray(["shared-family", "shared-family", "test-family"], dtype=object),
                np.asarray(["train", "validation", "test"], dtype=object),
            )


@unittest.skipUnless(
    importlib.util.find_spec("lightgbm") is not None,
    "LightGBM optional dependency is not installed",
)
class LightGBMShadowTrainingTests(unittest.TestCase):
    def test_training_emits_only_runtime_artifacts_and_aggregate_evidence(self) -> None:
        rng = np.random.default_rng(20260721)
        split_values = ["train"] * 264 + ["validation"] * 32 + ["test"] * 32
        count = len(split_values)
        rules = rng.uniform(0.0, 1.0, size=(count, 42)).astype(np.float64)
        embeddings = rng.normal(size=(count, 768)).astype(np.float32)
        embeddings /= np.linalg.norm(embeddings, axis=1, keepdims=True)
        labels = np.where(rules[:, 0] + embeddings[:, 0] > 0.5, "complex", "simple")
        family_ids = [f"{split}-family-{index}" for index, split in enumerate(split_values)]
        encoder_descriptor = {
            "modelId": MODEL_ID,
            "sourceRevision": MODEL_SOURCE_REVISION,
            "outputDimension": 768,
            "pooling": "attention_mask_weighted_mean_excluding_padding",
            "inputPrefix": "query: ",
            "maximumTokenLength": 128,
            "artifactDirectory": "encoder",
            "runtimeArtifacts": [
                {
                    "role": role,
                    "relativePath": f"{index}.artifact",
                    "sizeBytes": 1,
                    "sha256": hashlib.sha256(b"x").hexdigest(),
                }
                for index, role in enumerate(
                    (
                        "model_config",
                        "sentence_transformer_config",
                        "pooling_config",
                        "special_tokens",
                        "tokenizer_json",
                        "tokenizer_config",
                        "tokenizer_model",
                        "encoder_onnx_dynamic_qint8",
                    )
                )
            ],
        }
        provenance = {
            "datasetVersion": "approved-synthetic-test.v1",
            "datasetSha256": "sha256:" + "1" * 64,
            "splitPolicyVersion": "prompt-family-disjoint.v1",
        }
        dataset_manifest = {
            "dataset_version": provenance["datasetVersion"],
            "dataset_sha256": "1" * 64,
            "scope": {"training_eligible": True},
            "review": {
                "production_gold": True,
                "human_reviewed": True,
                "review_status": "approved",
            },
            "counts": {"human_reviewed_records": count},
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            encoder_directory = output_directory / "encoder"
            encoder_directory.mkdir()
            for artifact in encoder_descriptor["runtimeArtifacts"]:
                (encoder_directory / artifact["relativePath"]).write_bytes(b"x")
            result = train_lightgbm_shadow_candidates(
                rule_vectors=rules,
                pooled_embeddings=embeddings,
                labels=labels,
                splits=split_values,
                family_ids=family_ids,
                encoder_descriptor=encoder_descriptor,
                dataset_manifest=dataset_manifest,
                dataset_provenance=provenance,
                output_directory=output_directory,
                model_version="difficulty-lightgbm-shadow.synthetic-test.v1",
            )

            self.assertIn(result.selected_candidate, SEMANTIC_RUNTIME_CANDIDATES)
            profile = json.loads(result.profile_manifest_path.read_text(encoding="utf-8"))
            report = json.loads(result.aggregate_report_path.read_text(encoding="utf-8"))
            self.assertEqual(profile["schemaVersion"], PROFILE_SCHEMA)
            self.assertEqual(profile["promotionState"], "offline_shadow_only")
            self.assertTrue(profile["trainingProvenance"]["familyDisjoint"])
            self.assertEqual(profile["trainingProvenance"]["selectionSplit"], "validation")
            self.assertEqual(profile["trainingProvenance"]["testAccess"], "after_selection_freeze")
            self.assertFalse(report["containsPerSampleMaterial"])
            serialized_report = json.dumps(report, sort_keys=True).lower()
            for forbidden in ("instructiontext", "prompttext", "embeddingvalues", "rulevectorvalues", "scoresbysample"):
                self.assertNotIn(forbidden, serialized_report)


if __name__ == "__main__":
    unittest.main()
