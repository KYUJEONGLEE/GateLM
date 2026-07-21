from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from gatelm_difficulty_model.lightgbm_four_way import (
    CANDIDATE_DIMENSIONS,
    build_four_way_matrices,
    train_four_way_candidates,
)
from gatelm_difficulty_model.semantic_features import SEMANTIC_HEAD_SPECS_V1


class LightGBMFourWayShapeTests(unittest.TestCase):
    def test_builds_exact_four_candidate_shapes(self) -> None:
        count = 5
        probabilities = {
            spec.name: np.full(
                (count, len(spec.classes)),
                1.0 / len(spec.classes),
                dtype=np.float32,
            )
            for spec in SEMANTIC_HEAD_SPECS_V1
        }
        matrices = build_four_way_matrices(
            rule_vectors=np.zeros((count, 42), dtype=np.float32),
            e5_small_pca_64=np.ones((count, 64), dtype=np.float32),
            semantic_head_probabilities=probabilities,
            e5_base_raw_768=np.ones((count, 768), dtype=np.float32),
        )
        self.assertEqual(set(matrices), set(CANDIDATE_DIMENSIONS))
        for candidate, dimension in CANDIDATE_DIMENSIONS.items():
            self.assertEqual(matrices[candidate].shape, (count, dimension))
            self.assertEqual(matrices[candidate].dtype, np.float32)

    def test_rejects_384d_base_output(self) -> None:
        with self.assertRaisesRegex(ValueError, "E5-base"):
            build_four_way_matrices(
                rule_vectors=np.zeros((2, 42), dtype=np.float32),
                e5_small_pca_64=np.ones((2, 64), dtype=np.float32),
                semantic_head_probabilities=np.ones((2, 12), dtype=np.float32),
                e5_base_raw_768=np.ones((2, 384), dtype=np.float32),
            )


@unittest.skipUnless(
    importlib.util.find_spec("lightgbm") is not None,
    "LightGBM optional dependency is not installed",
)
class LightGBMFourWayTrainingTests(unittest.TestCase):
    def test_trains_and_persists_all_four_heads_without_feature_material(self) -> None:
        rng = np.random.default_rng(20260722)
        splits = ["train"] * 80 + ["validation"] * 20 + ["test"] * 20
        count = len(splits)
        rules = rng.random((count, 42), dtype=np.float32)
        pca = rng.normal(size=(count, 64)).astype(np.float32)
        heads = rng.random((count, 12), dtype=np.float32)
        heads = heads.reshape(count, 4, 3)
        heads /= heads.sum(axis=2, keepdims=True)
        heads = heads.reshape(count, 12)
        base = rng.normal(size=(count, 768)).astype(np.float32)
        labels = np.asarray([0, 1] * (count // 2), dtype=np.int8)
        matrices = build_four_way_matrices(
            rule_vectors=rules,
            e5_small_pca_64=pca,
            semantic_head_probabilities=heads,
            e5_base_raw_768=base,
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            results = train_four_way_candidates(
                matrices=matrices,
                labels=labels.tolist(),
                splits=splits,
                family_ids=[f"{split}-{index}" for index, split in enumerate(splits)],
                output_directory=root,
                dataset_provenance={"datasetVersion": "test"},
                encoder_provenance={"profile": "test"},
            )
            self.assertEqual({result.candidate for result in results}, set(CANDIDATE_DIMENSIONS))
            report = json.loads((root / "four-way-evaluation.v1.json").read_text(encoding="utf-8"))
            self.assertFalse(report["containsPromptOrEmbeddingMaterial"])
            self.assertEqual(report["candidateOrder"], list(CANDIDATE_DIMENSIONS))
            for result in results:
                self.assertTrue(result.model_path.is_file())


if __name__ == "__main__":
    unittest.main()
