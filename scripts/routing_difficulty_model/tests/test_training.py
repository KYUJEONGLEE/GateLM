from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
CALIBRATION_GOLDEN_PATH = (
    REPO_ROOT
    / "apps"
    / "gateway-core"
    / "internal"
    / "domain"
    / "routing"
    / "testdata"
    / "difficulty_calibration_lookup_cases.v1.json"
)
if str(TOOL_DIR) not in sys.path:
    sys.path.insert(0, str(TOOL_DIR))

import gatelm_difficulty_model.training as training
from gatelm_difficulty_model.semantic_features import (
    RULE_VECTOR_V1_FEATURE_NAMES,
    SEMANTIC_HEAD_SPECS_V1,
    OfflineFeatureCandidate,
    OfflineFeatureShape,
    OfflineFeatureValues,
)
from gatelm_difficulty_model.training import (
    OfflineArtifactProvenance,
    artifact_content_hash,
    train_from_offline_feature_matrix,
    train_from_vector_export,
)


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
        with tempfile.TemporaryDirectory(prefix="gatelm-difficulty-codegen-") as temp_dir:
            calibrators = {
                "platt": toy_artifact()["calibrator"],
                "single-block-isotonic": {
                    "type": "isotonic",
                    "input": "raw_probability",
                    "xThresholds": [0.35],
                    "yThresholds": [0.6],
                },
            }
            for name, calibrator in calibrators.items():
                with self.subTest(calibrator=name):
                    artifact = toy_artifact()
                    artifact["featureNames"] = feature_names
                    artifact["weights"] = [0.0] * len(feature_names)
                    artifact["calibrator"] = calibrator
                    artifact["contentHash"] = artifact_content_hash(artifact)
                    artifact_path = Path(temp_dir) / f"artifact-{name}.json"
                    output_path = Path(temp_dir) / f"model-{name}_generated.go"
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

    def test_python_offline_artifact_hash_is_accepted_by_go_codegen(self) -> None:
        environment = os.environ.copy()
        environment["GOCACHE"] = str(REPO_ROOT / ".gocache")
        environment["GOTELEMETRY"] = "off"
        artifact = toy_offline_artifact()
        artifact["contentHash"] = artifact_content_hash(artifact)
        with tempfile.TemporaryDirectory(prefix="gatelm-offline-difficulty-codegen-") as temp_dir:
            artifact_path = Path(temp_dir) / "offline-artifact.json"
            output_path = Path(temp_dir) / "offline-model-generated.go"
            report_path = Path(temp_dir) / "offline-validation-report.json"
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
            self.assertIn("generatedDifficultyLogisticOfflineModel", generated)
            self.assertIn(artifact["candidateName"], generated)
            self.assertIn(artifact["contentHash"], generated)
            subprocess.run(
                [
                    "go",
                    "run",
                    "./apps/gateway-core/cmd/difficulty-model-verify",
                    "-artifact",
                    str(artifact_path),
                    "-report",
                    str(report_path),
                ],
                cwd=REPO_ROOT,
                env=environment,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "valid")
            self.assertEqual(report["totalDimension"], artifact["totalDimension"])
            serialized_report = json.dumps(report, sort_keys=True)
            for forbidden in (
                "weights",
                "projectionParameters",
                "semanticHeadParameters",
                "calibrator",
                "coefficient",
                "intercept",
            ):
                self.assertNotIn(forbidden, serialized_report)


class CalibrationMathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            import numpy  # noqa: F401
        except (ImportError, OSError) as error:
            raise unittest.SkipTest(f"offline numeric dependency unavailable: {error}") from error

    def test_pava_groups_exact_ties_and_cascades_weighted_merges(self) -> None:
        import numpy as np

        x_thresholds, y_thresholds, block_counts = training._fit_isotonic_pava(
            np.asarray([0.5, 0.1, 0.4, 0.1, 0.3, 0.2], dtype=float),
            np.asarray([1, 0, 0, 1, 0, 1], dtype=int),
        )
        self.assertEqual(x_thresholds, [0.1, 0.5])
        self.assertEqual(block_counts, [5, 1])
        self.assertEqual(y_thresholds, [0.4, 1.0])

    def test_pava_does_not_quantize_nearby_raw_probabilities(self) -> None:
        import numpy as np

        first = 0.1
        second = np.nextafter(first, 1.0)
        x_thresholds, y_thresholds, block_counts = training._fit_isotonic_pava(
            np.asarray([first, second], dtype=float),
            np.asarray([0, 1], dtype=int),
        )
        self.assertEqual(x_thresholds, [first, second])
        self.assertEqual(y_thresholds, [0.0, 1.0])
        self.assertEqual(block_counts, [1, 1])

    def test_pava_allows_a_single_constant_block(self) -> None:
        import numpy as np

        x_thresholds, y_thresholds, block_counts = training._fit_isotonic_pava(
            np.asarray([0.1, 0.2, 0.3, 0.4], dtype=float),
            np.asarray([1, 1, 0, 0], dtype=int),
        )
        self.assertEqual(x_thresholds, [0.1])
        self.assertEqual(y_thresholds, [0.5])
        self.assertEqual(block_counts, [4])
        actual = training._apply_isotonic_blocks(
            np.asarray([0.0, 0.1, 0.7, 1.0], dtype=float),
            x_thresholds,
            y_thresholds,
        )
        np.testing.assert_array_equal(actual, np.asarray([0.5, 0.5, 0.5, 0.5]))

    def test_pava_rejects_invalid_probabilities_and_labels(self) -> None:
        import numpy as np

        with self.assertRaisesRegex(ValueError, "finite inclusive probabilities"):
            training._fit_isotonic_pava(
                np.asarray([0.1, np.nan], dtype=float),
                np.asarray([0, 1], dtype=int),
            )
        with self.assertRaisesRegex(ValueError, "binary"):
            training._fit_isotonic_pava(
                np.asarray([0.1, 0.2], dtype=float),
                np.asarray([0, 2], dtype=int),
            )

    def test_python_calibration_matches_shared_golden_cases(self) -> None:
        import numpy as np

        golden = json.loads(CALIBRATION_GOLDEN_PATH.read_text(encoding="utf-8"))
        self.assertEqual(golden["schemaVersion"], "gatelm.difficulty-calibration-lookup-cases.v1")
        for section_name in ("isotonic", "singleBlockIsotonic"):
            section = golden[section_name]
            inputs = np.asarray([case["input"] for case in section["cases"]], dtype=float)
            actual = training._apply_isotonic_blocks(
                inputs,
                section["xThresholds"],
                section["yThresholds"],
            )
            expected = np.asarray([case["expected"] for case in section["cases"]], dtype=float)
            np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-15)

        platt = golden["platt"]
        actual = training._apply_platt(
            np.asarray([case["input"] for case in platt["cases"]], dtype=float),
            platt["coefficient"],
            platt["intercept"],
        )
        expected = np.asarray([case["expected"] for case in platt["cases"]], dtype=float)
        np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-15)


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
        self.assertIn(artifact["calibrator"]["type"], {"platt", "isotonic"})
        self.assertTrue(artifact["contentHash"].startswith("sha256:"))
        self.assertEqual(report["modelPathSplitCounts"]["holdout"]["samples"], 4)
        self.assertFalse(report["runtimePromotionEvaluated"])
        serialized_report = json.dumps(report, sort_keys=True)
        for forbidden in (
            "rawProbability",
            "raw_probability",
            "logit",
            "xThresholds",
            "yThresholds",
            "vector",
            "weights",
            "coefficient",
            "intercept",
        ):
            self.assertNotIn(forbidden, serialized_report)
        isotonic_evaluation = next(
            candidate
            for candidate in report["calibrationSelection"]["candidates"]
            if candidate["type"] == "isotonic"
        )
        if isotonic_evaluation["status"] == "valid":
            self.assertTrue(isotonic_evaluation["foldDiagnostics"])
            self.assertTrue(
                all(item["blockCount"] >= 1 for item in isotonic_evaluation["foldDiagnostics"])
            )
            self.assertTrue(
                all(item["minBlockSampleCount"] >= 1 for item in isotonic_evaluation["foldDiagnostics"])
            )
        if artifact["calibrator"]["type"] == "isotonic":
            self.assertEqual(
                report["calibrationSelection"]["selectedFit"]["blockCount"],
                len(artifact["calibrator"]["xThresholds"]),
            )

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

    def test_v1_training_keeps_exact_dimension_names_and_finite_values(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        tests = {
            "dimension": lambda export: export["samples"][0]["vector"].pop(),
            "feature names": lambda export: export["featureNames"].__setitem__(0, "duplicate"),
            "non-finite": lambda export: export["samples"][0]["vector"].__setitem__(0, float("nan")),
        }
        for name, mutate in tests.items():
            with self.subTest(name=name):
                export = toy_vector_export()
                mutate(export)
                with self.assertRaises(ValueError):
                    train_from_vector_export(export, policy, "difficulty-logistic-v1-toy")

    def test_trains_all_offline_candidates_with_separate_fit_material(self) -> None:
        policy = toy_training_policy()
        shape = toy_offline_shape()
        artifacts = []
        with mock.patch.object(
            training,
            "_fit_selected_calibrator",
            wraps=training._fit_selected_calibrator,
        ) as calibrator_fit:
            for candidate in OfflineFeatureCandidate:
                descriptor = shape.descriptor(candidate)
                samples = toy_offline_samples(shape, candidate)
                artifact, report = train_from_offline_feature_matrix(
                    samples,
                    descriptor,
                    policy,
                    f"difficulty-offline.{candidate.value}.synthetic-test-v1",
                    toy_offline_provenance(),
                )
                self.assertEqual(len(artifact["weights"]), descriptor.total_dimension)
                self.assertEqual(artifact["featureNames"], list(descriptor.feature_names))
                self.assertEqual(artifact["candidateName"], candidate.value)
                self.assertIn(artifact["calibrator"]["type"], {"platt", "isotonic"})
                self.assertEqual(
                    report["offlineCandidate"]["totalDimension"],
                    descriptor.total_dimension,
                )
                serialized_report = json.dumps(report, sort_keys=True)
                for forbidden in (
                    "rawProbability",
                    "raw_probability",
                    "logit",
                    "featureNames",
                    "weights",
                    "semanticHeadProbabilities",
                    "projectedEmbedding",
                ):
                    self.assertNotIn(forbidden, serialized_report)
                artifacts.append(artifact)
        self.assertEqual(calibrator_fit.call_count, len(OfflineFeatureCandidate))
        self.assertEqual([len(artifact["weights"]) for artifact in artifacts], [42, 45, 57])
        self.assertEqual(len({artifact["contentHash"] for artifact in artifacts}), 3)
        self.assertTrue(
            all(
                artifacts[index]["calibrator"] is not artifacts[index + 1]["calibrator"]
                for index in range(len(artifacts) - 1)
            )
        )

    def test_offline_matrix_rejects_shape_numeric_and_sensitive_material_errors(self) -> None:
        shape = toy_offline_shape()
        descriptor = shape.descriptor(
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS
        )
        policy = toy_training_policy()

        cases = {
            "mixed dimension": lambda samples: samples[0]["vector"].pop(),
            "non-finite": lambda samples: samples[0]["vector"].__setitem__(42, float("inf")),
            "invalid head": lambda samples: samples[0]["vector"].__setitem__(45, 0.4),
            "sensitive field": lambda samples: samples[0].__setitem__("projectedEmbedding", [0.1]),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                samples = toy_offline_samples(
                    shape,
                    OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS,
                )
                mutate(samples)
                with self.assertRaises(ValueError):
                    train_from_offline_feature_matrix(
                        samples,
                        descriptor,
                        policy,
                        "difficulty-offline.synthetic-test-v1",
                        toy_offline_provenance(),
                    )

    def test_rejects_identity_calibrator_policy(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        policy["calibration"]["candidates"] = ["identity", "platt", "isotonic"]
        with self.assertRaisesRegex(ValueError, "exactly platt then isotonic"):
            training._select_calibrator(*calibration_arrays(), policy["calibration"])

    def test_rejects_isotonic_interpolation_or_small_block_merge_policy(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        policy["calibration"]["isotonic"]["lookup"] = "linear_interpolation"
        policy["calibration"]["isotonic"]["smallBlockMerge"] = "min_5"
        with self.assertRaisesRegex(ValueError, "PAVA floor lookup"):
            training._select_calibrator(*calibration_arrays(), policy["calibration"])

    def test_uses_isotonic_when_platt_candidate_fails(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        policy["calibration"]["groupFolds"] = 2
        original_fit = training._fit_calibrator

        def fail_platt(kind, raw_probabilities, labels, config):
            if kind == "platt":
                raise ValueError("synthetic candidate failure")
            return original_fit(kind, raw_probabilities, labels, config)

        with mock.patch.object(training, "_fit_calibrator", side_effect=fail_platt):
            selected, evaluations = training._select_calibrator(
                *calibration_arrays(), policy["calibration"]
            )
        self.assertEqual(selected, "isotonic")
        self.assertEqual(evaluations[0], {"type": "platt", "status": "failed"})

    def test_fails_when_both_calibrator_candidates_fail(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        policy["calibration"]["groupFolds"] = 2
        with mock.patch.object(training, "_fit_calibrator", side_effect=ValueError("synthetic failure")):
            with self.assertRaisesRegex(ValueError, "all configured calibrator candidates failed"):
                training._select_calibrator(*calibration_arrays(), policy["calibration"])

    def test_final_fit_failure_uses_the_other_valid_candidate(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        raw, labels, _ = calibration_arrays()
        evaluations = [
            {"type": "platt", "status": "valid", "logLoss": 0.1, "brierScore": 0.1},
            {"type": "isotonic", "status": "valid", "logLoss": 0.2, "brierScore": 0.2},
        ]
        original_fit = training._fit_calibrator

        def fail_final_platt(kind, raw_probabilities, fit_labels, config):
            if kind == "platt":
                raise ValueError("synthetic final-fit failure")
            return original_fit(kind, raw_probabilities, fit_labels, config)

        with mock.patch.object(training, "_fit_calibrator", side_effect=fail_final_platt):
            selected, _, material, _ = training._fit_selected_calibrator(
                "platt", evaluations, raw, labels, policy["calibration"]
            )
        self.assertEqual(selected, "isotonic")
        self.assertEqual(material["type"], "isotonic")
        self.assertEqual(evaluations[0]["status"], "failed")
        self.assertEqual(evaluations[0]["failureStage"], "final_fit")

    def test_final_fit_fails_when_no_valid_candidate_remains(self) -> None:
        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        raw, labels, _ = calibration_arrays()
        evaluations = [
            {"type": "platt", "status": "valid"},
            {"type": "isotonic", "status": "valid"},
        ]
        with mock.patch.object(training, "_fit_calibrator", side_effect=ValueError("synthetic failure")):
            with self.assertRaisesRegex(ValueError, "failed final fit"):
                training._fit_selected_calibrator(
                    "platt", evaluations, raw, labels, policy["calibration"]
                )

    def test_calibrator_tie_prefers_platt(self) -> None:
        import numpy as np

        policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
        policy["calibration"]["groupFolds"] = 2

        def equal_fit(kind, raw_probabilities, labels, config):
            del labels, config
            diagnostics = (
                {"blockCount": 1, "blockSampleCounts": [len(raw_probabilities)], "minBlockSampleCount": 1}
                if kind == "isotonic"
                else {}
            )
            return (
                lambda values: np.full(len(values), 0.5, dtype=float),
                {"type": kind, "input": "raw_probability"},
                diagnostics,
            )

        with mock.patch.object(training, "_fit_calibrator", side_effect=equal_fit):
            selected, _ = training._select_calibrator(
                *calibration_arrays(), policy["calibration"]
            )
        self.assertEqual(selected, "platt")


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
        "featureNames": list(RULE_VECTOR_V1_FEATURE_NAMES),
        "categorySource": "actual",
        "samples": samples,
    }


def toy_training_policy() -> dict:
    policy = json.loads((TOOL_DIR / "training-policy.v1.json").read_text(encoding="utf-8"))
    policy["regularization"]["cCandidates"] = [0.1, 1.0]
    policy["regularization"]["groupFolds"] = 2
    policy["calibration"]["groupFolds"] = 2
    return policy


def toy_offline_shape() -> OfflineFeatureShape:
    return OfflineFeatureShape(
        projection_dimension=3,
        projection_version="difficulty-projection.synthetic-test-v1",
        semantic_heads_version="difficulty-semantic-heads.synthetic-test-v1",
    )


def toy_offline_provenance() -> OfflineArtifactProvenance:
    return OfflineArtifactProvenance(
        preprocessing_version="difficulty-preprocessing.synthetic-test-v1",
        tokenizer_version="difficulty-tokenizer.synthetic-test-v1",
        encoder_version="difficulty-encoder.synthetic-test-v1",
        pooling_version="difficulty-pooling.synthetic-test-v1",
        projection_parameters=toy_projection_parameters(),
        semantic_head_input_dimension=4,
        semantic_head_parameters=toy_semantic_head_parameters(),
        training_dataset_version="difficulty-dataset.synthetic-test-v1",
        training_dataset_sha256="a" * 64,
        split_policy_version="difficulty-family-split.synthetic-test-v1",
        split_manifest_sha256="b" * 64,
        training_policy_version="difficulty-logistic-training.v1",
        threshold_policy_version="difficulty-threshold.synthetic-test-v1",
        threshold=0.45,
        component_hashes={
            "ruleVector": "sha256:" + "1" * 64,
            "tokenizer": "sha256:" + "2" * 64,
            "encoder": "sha256:" + "3" * 64,
            "projection": "sha256:" + "4" * 64,
            "semanticHeads": "sha256:" + "5" * 64,
        },
        bundle_version="difficulty-feature-bundle.synthetic-test-v1",
    )


def toy_projection_parameters() -> dict:
    return {
        "kind": "pca_full_svd",
        "inputDimension": 4,
        "outputDimension": 3,
        "dtype": "float32_le",
        "fitSplit": "train",
        "randomSeed": 20260714,
        "whiten": False,
        "l2Position": "after_projection",
        "l2Epsilon": 1e-12,
        "mean": [0.1, 0.2, 0.3, 0.4],
        "components": [
            [0.1, 0.2, 0.3, 0.4],
            [0.2, 0.3, 0.4, 0.5],
            [0.3, 0.4, 0.5, 0.6],
        ],
    }


def toy_semantic_head_parameters() -> list[dict]:
    return [
        {
            "name": spec.name,
            "classes": list(spec.classes),
            "coefficient": [
                [float(head_index + class_index + input_index) / 100.0 for input_index in range(4)]
                for class_index in range(3)
            ],
            "intercept": [float(class_index - head_index) / 10.0 for class_index in range(3)],
        }
        for head_index, spec in enumerate(SEMANTIC_HEAD_SPECS_V1)
    ]


def toy_offline_samples(
    shape: OfflineFeatureShape,
    candidate: OfflineFeatureCandidate,
) -> list[dict]:
    result = []
    for sample_index, sample in enumerate(toy_vector_export()["samples"]):
        rule = tuple(float(value) for value in sample["vector"])
        projection = (
            float(sample["label"]),
            float(sample_index % 3) / 2.0,
            -0.25 if sample["label"] else 0.25,
        )
        heads = {
            spec.name: (
                (0.0, 0.0, 1.0)
                if sample["label"]
                else (1.0, 0.0, 0.0)
            )
            for spec in SEMANTIC_HEAD_SPECS_V1
        }
        if candidate is OfflineFeatureCandidate.RULE_VECTOR_V1:
            values = OfflineFeatureValues(rule_vector_v1=rule)
        elif candidate is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION:
            values = OfflineFeatureValues(
                rule_vector_v1=rule,
                semantic_projection=projection,
            )
        else:
            values = OfflineFeatureValues(
                rule_vector_v1=rule,
                semantic_projection=projection,
                semantic_head_probabilities=heads,
            )
        record = dict(sample)
        record["vector"] = list(shape.assemble(candidate, values))
        result.append(record)
    return result


def toy_offline_artifact() -> dict:
    descriptor = toy_offline_shape().descriptor(
        OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS
    )
    provenance = toy_offline_provenance()
    artifact = {
        "schemaVersion": "gatelm.difficulty-offline-model-artifact.v1",
        "artifactVersion": "difficulty-offline.synthetic-test-v1",
        "modelVersion": "difficulty-logistic-v1",
        "offlineFeatureShapeVersion": descriptor.shape_version,
        "candidateName": descriptor.candidate.value,
        "ruleVectorVersion": descriptor.rule_vector_version,
        "preprocessingVersion": provenance.preprocessing_version,
        "tokenizerVersion": provenance.tokenizer_version,
        "encoderVersion": provenance.encoder_version,
        "poolingVersion": provenance.pooling_version,
        "projectionVersion": descriptor.projection_version,
        "projectionDimension": descriptor.projection_dimension,
        "projectionParameters": dict(provenance.projection_parameters),
        "semanticHeadsVersion": descriptor.semantic_heads_version,
        "semanticHeadClassOrder": [
            {"name": spec.name, "classes": list(spec.classes)}
            for spec in descriptor.semantic_head_specs
        ],
        "semanticHeadInputDimension": provenance.semantic_head_input_dimension,
        "semanticHeadParameters": [dict(head) for head in provenance.semantic_head_parameters],
        "semanticHeadProbabilityRule": "multinomial_linear_softmax.v1",
        "totalDimension": descriptor.total_dimension,
        "featureNames": list(descriptor.feature_names),
        "weights": [float(index - 20) / 100.0 for index in range(descriptor.total_dimension)],
        "bias": -0.25,
        "calibrationVersion": "difficulty-calibration-v1",
        "calibrator": {
            "type": "platt",
            "input": "raw_probability",
            "coefficient": 1.25,
            "intercept": -0.1,
        },
        "thresholdPolicyVersion": provenance.threshold_policy_version,
        "threshold": provenance.threshold,
        "thresholdEquality": "greater_than_or_equal",
        "trainingDatasetVersion": provenance.training_dataset_version,
        "trainingDatasetSha256": provenance.training_dataset_sha256,
        "splitPolicyVersion": provenance.split_policy_version,
        "splitManifestSha256": provenance.split_manifest_sha256,
        "trainingPolicyVersion": provenance.training_policy_version,
        "regularization": {
            "policyVersion": "difficulty-logistic-training.v1",
            "penalty": "l2",
            "solver": "liblinear",
            "selectedC": 1.0,
            "groupFolds": 2,
            "randomSeed": 1729,
        },
        "componentHashes": dict(provenance.component_hashes),
        "bundleVersion": provenance.bundle_version,
        "bundleHashAlgorithm": "difficulty-feature-bundle-material.v1",
        "contentHashAlgorithm": "difficulty-offline-model-inference-material.v1",
    }

    artifact["bundleHash"] = training.offline_bundle_hash(artifact)
    return artifact


def calibration_arrays():
    import numpy as np

    return (
        np.asarray([0.1, 0.9, 0.2, 0.8, 0.15, 0.85, 0.25, 0.75], dtype=float),
        np.asarray([0, 1, 0, 1, 0, 1, 0, 1], dtype=int),
        np.asarray(["g0", "g0", "g1", "g1", "g2", "g2", "g3", "g3"], dtype=object),
    )


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
        "featureNames": list(RULE_VECTOR_V1_FEATURE_NAMES),
        "weights": [index / 100 for index in range(42)],
        "calibrationVersion": "difficulty-calibration-v1",
        "calibrator": {
            "type": "platt",
            "input": "raw_probability",
            "coefficient": 1.25,
            "intercept": -0.1,
        },
        "thresholdPolicyVersion": "difficulty-threshold-v1",
        "threshold": 0.45,
        "contentHashAlgorithm": "difficulty-model-inference-material.v1",
    }


if __name__ == "__main__":
    unittest.main()
