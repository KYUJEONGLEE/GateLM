from __future__ import annotations

import json
import math
import os
from pathlib import Path
import subprocess
import unittest

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[3]
ARTIFACT_PATH = (
    REPO_ROOT
    / "scripts"
    / "routing_difficulty_model"
    / "artifacts"
    / "candidates"
    / "difficulty-candidate-b-106d.model-path-5000.shadow.v1.json"
)


class GatewayShadowGoParityTests(unittest.TestCase):
    def test_python_canonical_score_matches_generated_go_inference(self) -> None:
        artifact = json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))
        pooled = np.asarray(
            [((index % 17) - 8) / 16 for index in range(384)], dtype=np.float32
        )
        mean = np.asarray(artifact["projectionParameters"]["mean"], dtype=np.float32)
        components = np.asarray(
            artifact["projectionParameters"]["components"], dtype=np.float32
        )
        projection = np.asarray((pooled - mean) @ components.T, dtype=np.float32)
        norm = np.linalg.norm(projection, keepdims=True)
        self.assertTrue(np.all(np.isfinite(norm)))
        self.assertTrue(np.all(norm > np.float32(1e-12)))
        projection = np.asarray(projection / norm, dtype=np.float32)

        rule = np.zeros(42, dtype=np.float64)
        rule[1] = 1.0
        rule[4] = 0.2
        rule[8] = 1.0
        rule[13] = 0.2
        vector = np.concatenate([rule, projection.astype(np.float64)])
        logit = float(
            np.dot(vector, np.asarray(artifact["weights"], dtype=np.float64))
            + artifact["bias"]
        )
        raw_probability = 1.0 / (1.0 + math.exp(-logit))
        calibrator = artifact["calibrator"]
        calibrated_score = 1.0 / (
            1.0
            + math.exp(
                -(calibrator["coefficient"] * raw_probability + calibrator["intercept"])
            )
        )

        environment = os.environ.copy()
        environment["GATELM_DIFFICULTY_GATEWAY_PARITY_SCORE"] = repr(calibrated_score)
        environment["GOCACHE"] = str(REPO_ROOT / ".cache" / "go-build")
        completed = subprocess.run(
            [
                "go",
                "test",
                "./apps/gateway-core/internal/domain/routing",
                "-run",
                "TestDifficultySemanticModelExternalPythonParity",
                "-count=1",
            ],
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            0,
            f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
