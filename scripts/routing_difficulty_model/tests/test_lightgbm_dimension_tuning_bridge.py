from __future__ import annotations

import unittest
from pathlib import Path

from gatelm_difficulty_model.lightgbm_dimension_tuning_bridge import (
    FEATURE_CANDIDATES,
    TARGET_SPLIT_COUNTS,
    canonical_experiment_split,
    load_bridge_config,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = REPOSITORY_ROOT / (
    "docs/testing/routing/difficulty/fixtures/"
    "lightgbm-dimension-tuning-bridge.owner-approved-15000.config.json"
)


class DimensionTuningBridgeTests(unittest.TestCase):
    def test_config_pins_the_exact_four_candidate_protocol(self) -> None:
        config = load_bridge_config(CONFIG_PATH)

        self.assertEqual(config.value["candidateOrder"], list(FEATURE_CANDIDATES))
        self.assertEqual(config.value["split"]["counts"], TARGET_SPLIT_COUNTS)
        self.assertEqual(config.value["search"]["candidateCount"], 80)
        self.assertEqual(config.value["search"]["selectedCFn"], 5)
        config.input_root.relative_to(REPOSITORY_ROOT / ".tmp")
        config.output_root.relative_to(
            REPOSITORY_ROOT / "scripts/routing_difficulty_model/artifacts"
        )

    def test_existing_canonical_splits_are_reused_without_resplitting(self) -> None:
        self.assertEqual(canonical_experiment_split("train"), "train")
        self.assertEqual(canonical_experiment_split("calibration"), "validation")
        self.assertEqual(canonical_experiment_split("holdout"), "test")
        with self.assertRaises(ValueError):
            canonical_experiment_split("dataset1")


if __name__ == "__main__":
    unittest.main()
