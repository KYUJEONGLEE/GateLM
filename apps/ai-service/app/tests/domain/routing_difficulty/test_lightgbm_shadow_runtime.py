from __future__ import annotations

import unittest

import numpy as np

from app.domain.routing_lightgbm_shadow.runtime import (
    E5_SMALL_NATIVE_DIMENSION,
    NATIVE_DIMENSION,
    _ModelMaterial,
    _Projection,
    _SemanticHead,
    _SemanticHeads,
    _masked_mean,
    RoutingLightGBMShadowRuntimeError,
)
from app.schemas.routing_difficulty import RULE_VECTOR_DIMENSION


class _FakeBooster:
    def __init__(self, scores: list[float]) -> None:
        self._scores = scores
        self.last_shape: tuple[int, ...] | None = None
        self.last_dtype: np.dtype[object] | None = None

    def predict(self, matrix: object, **_: object) -> list[float]:
        values = np.asarray(matrix)
        self.last_shape = tuple(values.shape)
        self.last_dtype = values.dtype
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

    def test_masked_mean_accepts_the_pinned_small_encoder_dimension(self) -> None:
        hidden = np.ones((1, 2, E5_SMALL_NATIVE_DIMENSION), dtype=np.float32)
        pooled = _masked_mean(
            hidden,
            np.asarray([[1, 0]], dtype=np.int64),
            expected_dimension=E5_SMALL_NATIVE_DIMENSION,
        )
        self.assertEqual(pooled.shape, (1, E5_SMALL_NATIVE_DIMENSION))
        self.assertEqual(pooled.dtype, np.float32)

    def test_raw_768_profile_builds_exact_810d_input(self) -> None:
        booster = _FakeBooster([0.8])
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            encoder_dimension=768,
            rule_dimension=RULE_VECTOR_DIMENSION,
            semantic_mode="raw_768",
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
        self.assertEqual(booster.last_dtype, np.dtype(np.float32))

    def test_embedding_only_profile_builds_exact_768d_input(self) -> None:
        booster = _FakeBooster([0.8])
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            encoder_dimension=768,
            rule_dimension=0,
            semantic_mode="raw_768",
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
            encoder_dimension=768,
            rule_dimension=RULE_VECTOR_DIMENSION,
            semantic_mode="pca_128",
            semantic_dimension=128,
            total_dimension=170,
            projection=_Projection(
                mean=np.zeros(768, dtype=np.float32),
                components=components,
                l2_epsilon=1e-12,
                input_dimension=768,
                output_dimension=128,
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

    def test_small_pca_profile_builds_exact_float32_106d_input(self) -> None:
        booster = _FakeBooster([0.8])
        components = np.zeros((64, E5_SMALL_NATIVE_DIMENSION), dtype=np.float32)
        components[:, :64] = np.eye(64, dtype=np.float32)
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            encoder_dimension=E5_SMALL_NATIVE_DIMENSION,
            rule_dimension=RULE_VECTOR_DIMENSION,
            semantic_mode="pca_64",
            semantic_dimension=64,
            total_dimension=106,
            projection=_Projection(
                mean=np.zeros(E5_SMALL_NATIVE_DIMENSION, dtype=np.float32),
                components=components,
                l2_epsilon=1e-12,
                input_dimension=E5_SMALL_NATIVE_DIMENSION,
                output_dimension=64,
            ),
        )
        pooled = np.zeros((1, E5_SMALL_NATIVE_DIMENSION), dtype=np.float32)
        pooled[0, 0] = 1
        material.classify_many(pooled, [[0.0] * RULE_VECTOR_DIMENSION])
        self.assertEqual(booster.last_shape, (1, 106))
        self.assertEqual(booster.last_dtype, np.dtype(np.float32))

    def test_semantic_head_profile_builds_fixed_order_float32_54d_input(self) -> None:
        booster = _FakeBooster([0.2])
        components = np.zeros((64, E5_SMALL_NATIVE_DIMENSION), dtype=np.float32)
        components[:, :64] = np.eye(64, dtype=np.float32)
        semantic_heads = _SemanticHeads(
            tuple(
                _SemanticHead(
                    name=f"head-{index}",
                    classes=("a", "b", "c"),
                    coefficient=np.zeros((3, 64), dtype=np.float64),
                    intercept=np.asarray([index, 0.0, -index], dtype=np.float64),
                )
                for index in range(1, 5)
            )
        )
        material = _ModelMaterial(
            booster=booster,
            threshold=0.5,
            encoder_dimension=E5_SMALL_NATIVE_DIMENSION,
            rule_dimension=RULE_VECTOR_DIMENSION,
            semantic_mode="semantic_heads_12",
            semantic_dimension=12,
            total_dimension=54,
            projection=_Projection(
                mean=np.zeros(E5_SMALL_NATIVE_DIMENSION, dtype=np.float32),
                components=components,
                l2_epsilon=1e-12,
                input_dimension=E5_SMALL_NATIVE_DIMENSION,
                output_dimension=64,
            ),
            semantic_heads=semantic_heads,
        )
        pooled = np.zeros((1, E5_SMALL_NATIVE_DIMENSION), dtype=np.float32)
        pooled[0, 0] = 1
        material.classify_many(pooled, [[0.0] * RULE_VECTOR_DIMENSION])
        self.assertEqual(booster.last_shape, (1, 54))
        self.assertEqual(booster.last_dtype, np.dtype(np.float32))


if __name__ == "__main__":
    unittest.main()
