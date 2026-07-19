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


if __name__ == "__main__":
    unittest.main()
