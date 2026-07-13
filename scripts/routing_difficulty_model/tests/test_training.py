from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
if str(TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(TOOL_DIR))

from gatelm_difficulty_model.training import artifact_content_hash, train_from_vector_export


class ArtifactHashTests(unittest.TestCase):
    def test_hash_is_stable_and_sensitive_to_weights(self) -> None:
        artifact = toy_artifact()
        first = artifact_content_hash(artifact)
        second = artifact_content_hash(dict(artifact))
        self.assertEqual(first, second)
        artifact["weights"][0] = 0.25
        self.assertNotEqual(first, artifact_content_hash(artifact))

    def test_hash_ignores_non_inference_metadata(self) -> None:
        artifact = toy_artifact()
        expected = artifact_content_hash(artifact)
        artifact["artifactVersion"] = "renamed-candidate"
        artifact["trainingDatasetVersion"] = "different-provenance"
        artifact["regularization"]["selectedC"] = 99.0
        self.assertEqual(expected, artifact_content_hash(artifact))

    def test_python_artifact_hash_is_accepted_by_go_codegen(self) -> None:
        environment = os.environ.copy()
        environment["GOCACHE"] = str(REPO_ROOT / ".gocache")
        environment["GOTELEMETRY"] = "off"
        export = subprocess.run(
            [
                "go",
                "run",
                "./apps/gateway-core/cmd/difficulty-training-vector-export",
                "-dataset",
                "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl",
                "-split-manifest",
                "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json",
                "-category-source",
                "actual",
            ],
            cwd=REPO_ROOT,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        feature_names = json.loads(export.stdout)["featureNames"]
        artifact = toy_artifact()
        artifact["featureNames"] = feature_names
        artifact["weights"] = [0.0] * len(feature_names)
        artifact["contentHash"] = artifact_content_hash(artifact)
        with tempfile.TemporaryDirectory(prefix="gatelm-difficulty-codegen-") as temp_dir:
            artifact_path = Path(temp_dir) / "artifact.json"
            output_path = Path(temp_dir) / "model_generated.go"
            artifact_path.write_text(json.dumps(artifact), encoding="utf-8")
            subprocess.run(
                [
                    "go",
                    "run",
                    "./apps/gateway-core/cmd/difficulty-model-codegen",
                    "-artifact",
                    str(artifact_path),
                    "-output",
                    str(output_path),
                ],
                cwd=REPO_ROOT,
                env=environment,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            generated = output_path.read_text(encoding="utf-8")
            self.assertIn(artifact["contentHash"], generated)
            self.assertIn("generatedDifficultyLogisticModelV1", generated)


class ToyTrainingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            import numpy  # noqa: F401
            import sklearn  # noqa: F401
        except (ImportError, OSError) as error:
            raise unittest.SkipTest(f"offline ML dependencies unavailable: {error}") from error

    def test_tiny_grouped_fit_produces_artifact_without_split_leakage(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        policy["regularization"]["cCandidates"] = [0.1, 1.0]
        policy["regularization"]["groupFolds"] = 2
        policy["calibration"]["groupFolds"] = 2
        export = toy_vector_export()
        artifact, report = train_from_vector_export(export, policy, "difficulty-logistic-v1-toy")
        self.assertEqual(len(artifact["weights"]), 42)
        self.assertEqual(artifact["threshold"], 0.45)
        self.assertIn(artifact["calibrator"]["type"], {"identity", "platt", "isotonic"})
        self.assertTrue(artifact["contentHash"].startswith("sha256:"))
        self.assertEqual(report["modelPathSplitCounts"]["holdout"]["samples"], 4)
        self.assertFalse(report["runtimePromotionEvaluated"])

    def test_rejects_family_split_leakage(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        export = toy_vector_export()
        export["samples"][0]["familyId"] = export["samples"][-1]["familyId"]
        with self.assertRaisesRegex(ValueError, "family leaked"):
            train_from_vector_export(export, policy, "difficulty-logistic-v1-toy")

    def test_rejects_missing_model_path_boundary(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        export = toy_vector_export()
        export["samples"][0].pop("modelPath")
        with self.assertRaisesRegex(ValueError, "boolean modelPath"):
            train_from_vector_export(export, policy, "difficulty-logistic-v1-toy")


def toy_vector_export() -> dict:
    samples = []
    group_counter = 0
    for split, group_count in (("train", 4), ("calibration", 4), ("holdout", 2)):
        for _ in range(group_count):
            family = f"general/f{group_counter:02d}"
            group_counter += 1
            for label in (0, 1):
                vector = [0.0] * 42
                vector[0] = float(label)
                vector[1] = group_counter / 20
                samples.append(
                    {
                        "sampleId": f"toy_{family.replace('/', '_')}_{label}",
                        "familyId": family,
                        "split": split,
                        "label": label,
                        "expectedCategory": "general",
                        "actualCategory": "general",
                        "vectorCategory": "general",
                        "expectedDifficulty": "complex" if label else "simple",
                        "modelPath": True,
                        "vector": vector,
                    }
                )
    return {
        "schemaVersion": "gatelm.difficulty-training-vector-export.v1",
        "datasetVersion": "difficulty_toy_v1",
        "datasetSha256": "a" * 64,
        "splitPolicyVersion": "difficulty-family-split.v1",
        "familyRuleVersion": "difficulty-sample-family.v1",
        "featureVersion": "difficulty-feature-vector.v1",
        "featureNames": [f"feature{index:02d}" for index in range(42)],
        "categorySource": "actual",
        "samples": samples,
    }


def toy_artifact() -> dict:
    return {
        "schemaVersion": "gatelm.difficulty-model-artifact.v1",
        "artifactVersion": "toy-v1",
        "modelVersion": "difficulty-logistic-v1",
        "featureVersion": "difficulty-feature-vector.v1",
        "trainingDatasetVersion": "difficulty_toy_v1",
        "trainingDatasetSha256": "a" * 64,
        "splitPolicyVersion": "difficulty-family-split.v1",
        "regularization": {
            "policyVersion": "difficulty-logistic-training.v1",
            "penalty": "l2",
            "solver": "liblinear",
            "selectedC": 1.0,
            "groupFolds": 2,
            "randomSeed": 1729,
        },
        "bias": -0.25,
        "featureNames": [f"feature{index:02d}" for index in range(42)],
        "weights": [index / 100 for index in range(42)],
        "calibrationVersion": "difficulty-calibration-v1",
        "calibrator": {"type": "identity", "input": "raw_probability"},
        "thresholdPolicyVersion": "difficulty-threshold-v1",
        "threshold": 0.45,
        "contentHashAlgorithm": "difficulty-model-inference-material.v1",
    }


if __name__ == "__main__":
    unittest.main()
