from __future__ import annotations

import unittest

from gatelm_difficulty_model.semantic_b1 import (
    validate_fixed_policy,
)


class SemanticB1Tests(unittest.TestCase):
    def test_fixed_policy_rejects_owner_setting_drift(self) -> None:
        policy = {
            "modelVersion": "difficulty-logistic-v1",
            "baselineCandidate": "42d-rule-vector-v1",
            "projection": {
                "kind": "pca_full_svd",
                "inputDimension": 384,
                "outputDimension": 6,
                "fitSplit": "train",
                "whiten": False,
                "l2Position": "after_projection",
                "l2Epsilon": 1e-12,
                "randomSeed": 20260719,
            },
            "semanticHeads": {"c": 10.0},
            "regularization": {"cCandidates": [10.0]},
            "calibration": {
                "fixedCalibrator": "isotonic",
                "policyVersion": "difficulty-calibration-v1",
            },
            "threshold": {"value": 0.5},
        }
        validate_fixed_policy(policy)
        policy["threshold"]["value"] = 0.49
        with self.assertRaisesRegex(ValueError, "drifted"):
            validate_fixed_policy(policy)

if __name__ == "__main__":
    unittest.main()
