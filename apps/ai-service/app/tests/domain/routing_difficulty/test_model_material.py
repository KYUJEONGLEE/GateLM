from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


@unittest.skipUnless(importlib.util.find_spec("numpy"), "numpy is not installed")
class RoutingDifficultyModelMaterialTests(unittest.TestCase):
    def test_selected_artifact_matches_gateway_synthetic_parity(self) -> None:
        import numpy as np

        from app.domain.routing_difficulty.runtime import _load_model_material

        repo_root = Path(__file__).resolve().parents[6]
        artifact_path = (
            repo_root
            / "scripts"
            / "routing_difficulty_model"
            / "artifacts"
            / "candidates"
            / "difficulty-candidate-b-106d.model-path-5000.shadow.v1.json"
        )
        material = _load_model_material(artifact_path)
        pooled = np.asarray(
            [((index % 17) - 8) / 16 for index in range(384)],
            dtype=np.float32,
        )
        rule_vector = [0.0] * 42
        rule_vector[1] = 1.0
        rule_vector[4] = 0.2
        rule_vector[8] = 1.0
        rule_vector[13] = 0.2

        prediction = material.classify(pooled, rule_vector)

        self.assertEqual(prediction.difficulty, "simple")
        self.assertAlmostEqual(
            prediction.calibrated_score,
            0.00972840314063258,
            delta=1e-6,
        )

    def test_runtime_runs_multi_item_batch_once_and_maps_rows(self) -> None:
        import numpy as np

        from app.domain.routing_difficulty.runtime import (
            RoutingDifficultyPrediction,
            RoutingDifficultyRuntime,
        )

        runtime = object.__new__(RoutingDifficultyRuntime)
        runtime._tokenizer = _FakeTokenizer(np)  # type: ignore[attr-defined]
        runtime._session = _FakeSession(np)  # type: ignore[attr-defined]
        runtime._material = _FakeMaterial()  # type: ignore[attr-defined]
        runtime._input_names = {  # type: ignore[attr-defined]
            "input_ids",
            "attention_mask",
            "token_type_ids",
        }
        runtime._np = np  # type: ignore[attr-defined]
        vectors = [[0.0] * 42, [1.0] * 42]

        predictions = runtime.classify_many(
            ["first safe instruction", "second safe instruction"],
            vectors,
        )

        self.assertEqual(runtime._session.run_count, 1)  # type: ignore[attr-defined]
        self.assertEqual(
            predictions,
            [
                RoutingDifficultyPrediction("simple", 0.25),
                RoutingDifficultyPrediction("complex", 0.75),
            ],
        )


class _FakeTokenizer:
    def __init__(self, np: object) -> None:
        self._np = np

    def __call__(self, texts: list[str], **_kwargs: object) -> dict[str, object]:
        np = self._np
        input_ids = np.asarray(  # type: ignore[attr-defined]
            [[index + 1, index + 2] for index in range(len(texts))],
            dtype=np.int64,  # type: ignore[attr-defined]
        )
        return {
            "input_ids": input_ids,
            "attention_mask": np.ones_like(input_ids),  # type: ignore[attr-defined]
            "token_type_ids": np.zeros_like(input_ids),  # type: ignore[attr-defined]
        }


class _FakeSession:
    def __init__(self, np: object) -> None:
        self._np = np
        self.run_count = 0

    def run(self, _outputs: object, inputs: dict[str, object]) -> list[object]:
        self.run_count += 1
        np = self._np
        input_ids = inputs["input_ids"]
        batch, sequence = input_ids.shape  # type: ignore[union-attr]
        hidden = np.zeros((batch, sequence, 384), dtype=np.float32)  # type: ignore[attr-defined]
        for index in range(batch):
            hidden[index, :, 0] = float(index)
        return [hidden]


class _FakeMaterial:
    def classify(self, pooled: object, rule_vector: object) -> object:
        from app.domain.routing_difficulty.runtime import RoutingDifficultyPrediction

        index = int(list(rule_vector)[0])  # type: ignore[arg-type]
        return RoutingDifficultyPrediction(
            "simple" if index == 0 else "complex",
            0.25 if index == 0 else 0.75,
        )


if __name__ == "__main__":
    unittest.main()
