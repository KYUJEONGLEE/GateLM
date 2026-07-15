from __future__ import annotations

import json
import unittest
from pathlib import Path

from gatelm_difficulty_model.threshold_candidate import derive_threshold_candidate
from gatelm_difficulty_model.threshold_candidate_cli import validate_output_paths
from gatelm_difficulty_model.training import artifact_content_hash, offline_bundle_hash


REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_ARTIFACT = (
    REPO_ROOT
    / "scripts/routing_difficulty_model/artifacts/candidates/"
    "difficulty-candidate-c-118d.owner-approved-500.v3.json"
)
FEASIBILITY_REPORT = (
    REPO_ROOT / "docs/testing/difficulty-v3-calibration-threshold-feasibility.json"
)


class ThresholdCandidateTest(unittest.TestCase):
    def test_cli_cannot_overwrite_the_failed_v3_source_artifact(self) -> None:
        with self.assertRaisesRegex(ValueError, "must not overwrite"):
            validate_output_paths(SOURCE_ARTIFACT, SOURCE_ARTIFACT, FEASIBILITY_REPORT)

    def test_derives_v4_by_changing_only_threshold_identity_and_bundle_identity(self) -> None:
        source = json.loads(SOURCE_ARTIFACT.read_text(encoding="utf-8"))
        feasibility = json.loads(FEASIBILITY_REPORT.read_text(encoding="utf-8"))

        candidate, evidence = derive_threshold_candidate(
            source,
            feasibility,
            artifact_version=(
                "difficulty-offline.owner-approved-500.single-request.2026-07-15."
                "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities.v4"
            ),
            bundle_version=(
                "difficulty-feature-bundle.owner-approved-500.single-request.2026-07-15.v4"
            ),
            threshold_policy_version="difficulty-threshold-v2",
        )

        for field in (
            "weights",
            "bias",
            "calibrator",
            "projectionParameters",
            "semanticHeadParameters",
            "componentHashes",
        ):
            self.assertEqual(candidate[field], source[field])
        self.assertEqual(candidate["threshold"], 0.06)
        self.assertEqual(candidate["thresholdPolicyVersion"], "difficulty-threshold-v2")
        self.assertNotEqual(candidate["bundleHash"], source["bundleHash"])
        self.assertNotEqual(candidate["contentHash"], source["contentHash"])
        self.assertEqual(candidate["bundleHash"], offline_bundle_hash(candidate))
        self.assertEqual(candidate["contentHash"], artifact_content_hash(candidate))
        self.assertEqual(evidence["status"], "threshold_only_v4_candidate_frozen")
        self.assertFalse(evidence["productRuntimeChanged"])
        self.assertTrue(evidence["newUntouchedHoldoutRequired"])


if __name__ == "__main__":
    unittest.main()
