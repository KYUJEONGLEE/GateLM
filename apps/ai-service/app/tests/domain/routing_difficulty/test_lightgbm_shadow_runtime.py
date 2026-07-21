from __future__ import annotations

import unittest

import numpy as np

from app.domain.routing_lightgbm_shadow.runtime import (
    NATIVE_DIMENSION,
    _ModelMaterial,
    _Projection,
    _masked_mean,
    RoutingLightGBMShadowRuntimeError,
)
from app.schemas.routing_difficulty import RULE_VECTOR_DIMENSION


class _FakeBooster:
    def __init__(self, scores: list[float]) -> None:
        self._scores = scores
        self.last_shape: tuple[int, ...] | None = None

    def predict(self, matrix: object, **_: object) -> list[float]:
        self.last_shape = tuple(np.asarray(matrix).shape)
        return self._scores


class RoutingLightGBMShadowRuntimeTests(unittest.TestCase):
    def test_masked_mean_requires_native_768_dimension(self) -> None:
        hidden = np.ones((1, 2, NATIVE_DIMENSION), dtype=np.float32)
        pooled = _masked_mean(hidden, np.asarray([[1, 0]], dtype=np.int64))
        self.assertEqual(pooled.shape, (1, NATIVE_DIMENSION))

        with self.assertRaisesRegex(
            RoutingLightGBMShadowRuntimeError,
            "shape",
        ):
            _masked_mean(
                np.ones((1, 2, 384), dtype=np.float32),
                np.asarray([[1, 1]], dtype=np.int64),
            )

    def test_raw_768_profile_builds_exact_810d_input(self) -> None:
        booster = _FakeBooster([0.8])
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            rule_dimension=RULE_VECTOR_DIMENSION,
            semantic_mode="raw",
            semantic_dimension=768,
            total_dimension=810,
            projection=None,
        )
        predictions = material.classify_many(
            np.ones((1, 768), dtype=np.float32),
            [[0.0] * RULE_VECTOR_DIMENSION],
        )
        self.assertEqual(predictions[0].difficulty, "complex")
        self.assertEqual(booster.last_shape, (1, 810))

    def test_embedding_only_profile_builds_exact_768d_input(self) -> None:
        booster = _FakeBooster([0.8])
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            rule_dimension=0,
            semantic_mode="raw",
            semantic_dimension=768,
            total_dimension=768,
            projection=None,
        )
        predictions = material.classify_many(
            np.ones((1, 768), dtype=np.float32),
            [[0.0] * RULE_VECTOR_DIMENSION],
        )
        self.assertEqual(predictions[0].difficulty, "complex")
        self.assertEqual(booster.last_shape, (1, 768))

    def test_pca_profile_builds_exact_rule_plus_projection_input(self) -> None:
        booster = _FakeBooster([0.2])
        components = np.zeros((128, 768), dtype=np.float32)
        components[:, :128] = np.eye(128, dtype=np.float32)
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            rule_dimension=RULE_VECTOR_DIMENSION,
            semantic_mode="pca",
            semantic_dimension=128,
            total_dimension=170,
            projection=_Projection(
                mean=np.zeros(768, dtype=np.float32),
                components=components,
                l2_epsilon=1e-12,
            ),
        )
        pooled = np.zeros((1, 768), dtype=np.float32)
        pooled[0, 0] = 1
        predictions = material.classify_many(
            pooled,
            [[0.0] * RULE_VECTOR_DIMENSION],
        )
        self.assertEqual(predictions[0].difficulty, "simple")
        self.assertEqual(booster.last_shape, (1, 170))


if __name__ == "__main__":
    unittest.main()
