from __future__ import annotations

import copy
import importlib.metadata
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from gatelm_difficulty_model.lightgbm_embedding_artifacts import (
    FREEZE_RECORD_SCHEMA,
    TestEvaluationInput,
    artifact_identity,
    deterministic_json_text,
    evaluate_frozen_test_once,
    freeze_owner_selection,
    prepare_freeze_candidate,
    resolve_output_path,
    scan_aggregate_material,
    verify_freeze_record,
    write_json_artifact,
)
from gatelm_difficulty_model.lightgbm_embedding_calibration import (
    C_FN_SCENARIOS,
    fit_calibrator,
)
from gatelm_difficulty_model.lightgbm_embedding_experiment import (
    CATEGORIES,
    REQUIRED_SLICES,
    ExperimentError,
    ExperimentStatus,
    canonical_sha256,
)
from gatelm_difficulty_model.lightgbm_embedding_reporting import (
    REPORT_SECTIONS,
    build_aggregate_evidence,
    render_markdown_report,
    validate_aggregate_evidence,
)


def threshold_scenarios():
    return [
        {
            "cFn": c_fn,
            "cFp": 1.0,
            "bayesThreshold": 1.0 / (1.0 + c_fn),
            "status": "feasible",
            "feasibleCandidateCount": 1,
            "selected": {
                "threshold": 0.25,
                "falseNegative": 0,
                "falsePositive": 1,
                "complexRecall": 1.0,
                "expectedDecisionLoss": 0.1,
                "overallSafetyPassed": True,
                "categorySafetyPassed": True,
            },
            "reasonCode": None,
        }
        for c_fn in C_FN_SCENARIOS
    ]


def create_candidate(root: Path, *, model_content: bytes = b"model"):
    model = root / "model.txt"
    model.write_bytes(model_content)
    calibrator = root / "calibrator.json"
    calibrator.write_text('{"safe":true}\n', encoding="utf-8")
    candidate = prepare_freeze_candidate(
        experiment_id="synthetic-test",
        experiment_version="v1",
        dataset_identity={
            "version": "synthetic.v1",
            "sha256": "1" * 64,
            "manifestSha256": "2" * 64,
            "splitPolicyVersion": "family.v1",
            "splitMembershipSha256": "3" * 64,
            "testDataSha256": "4" * 64,
        },
        encoder_descriptor={
            "providerKind": "synthetic_test_only",
            "modelId": "synthetic/model",
            "sourceRevision": "revision",
            "inputPrefix": "",
            "maximumTokenLength": 8,
            "pooling": "synthetic",
            "normalization": "none",
            "outputDtype": "float32",
            "outputDimension": 3,
            "artifactIdentitySha256": "5" * 64,
        },
        embedding_dimension=3,
        candidate_set_sha256="6" * 64,
        fold_membership_sha256="7" * 64,
        selected_candidate_id="lgb-synthetic",
        selected_parameters={"learning_rate": 0.1},
        best_iteration=3,
        model_identity=artifact_identity(root, model),
        calibrator_type="none",
        calibrator_identity=artifact_identity(root, calibrator),
        threshold_scenarios=threshold_scenarios(),
        code_config_sha256="8" * 64,
        champion_identity={"version": "champion.v1", "sha256": "9" * 64},
        slice_policy={"version": "slices.v1", "sha256": "a" * 64},
    )
    return candidate, model, calibrator


def freeze_candidate(candidate):
    return freeze_owner_selection(
        candidate,
        selected_c_fn=3.0,
        selected_threshold=0.25,
        owner_decision_reference="routing-owner-decision-1",
        owner_decision_timestamp="2026-07-21T00:00:00Z",
    )


class ArtifactSafetyTests(unittest.TestCase):
    def test_path_traversal_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ExperimentError, "ARTIFACT_PATH_INVALID"):
                resolve_output_path(Path(temporary), "../escape.json")

    def test_absolute_output_path_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ExperimentError, "ARTIFACT_PATH_INVALID"):
                resolve_output_path(Path(temporary), "C:/escape.json")

    def test_deterministic_json_is_sorted_and_has_final_newline(self) -> None:
        first = deterministic_json_text({"z": 1, "a": 2})
        second = deterministic_json_text({"a": 2, "z": 1})
        self.assertEqual(first, second)
        self.assertTrue(first.endswith("\n"))
        self.assertLess(first.index('"a"'), first.index('"z"'))

    def test_immutable_json_write_refuses_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_json_artifact(root, "evidence.json", {"safe": True})
            with self.assertRaisesRegex(ExperimentError, "IMMUTABLE_ARTIFACT_ALREADY_EXISTS"):
                write_json_artifact(root, "evidence.json", {"safe": True})

    def test_forbidden_field_scanner_rejects_sample_material(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "FORBIDDEN_ARTIFACT_FIELD"):
            scan_aggregate_material({"rawPrompt": "not allowed"})

    def test_forbidden_content_scanner_rejects_secret_pattern(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "FORBIDDEN_SECRET_PATTERN"):
            scan_aggregate_material({"message": "Authorization: Bearer hidden-value"})

    def test_negative_data_safety_flags_are_allowed_only_when_false(self) -> None:
        scan_aggregate_material(
            {"containsEmbeddingMatrix": False, "containsPerSampleScore": False}
        )
        with self.assertRaisesRegex(ExperimentError, "NEGATIVE_DATA_SAFETY_FLAG_NOT_FALSE"):
            scan_aggregate_material({"containsEmbeddingMatrix": True})


class FreezeAndAccessGuardTests(unittest.TestCase):
    def test_owner_decision_is_required_for_freeze(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            candidate, _, _ = create_candidate(Path(temporary))
            with self.assertRaisesRegex(ExperimentError, "OWNER_DECISION_REFERENCE_REQUIRED"):
                freeze_owner_selection(
                    candidate,
                    selected_c_fn=3.0,
                    selected_threshold=0.25,
                    owner_decision_reference="",
                    owner_decision_timestamp="2026-07-21T00:00:00Z",
                )

    def test_invalid_owner_threshold_selection_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            candidate, _, _ = create_candidate(Path(temporary))
            with self.assertRaisesRegex(
                ExperimentError, "OWNER_SELECTION_NOT_IN_VALIDATION_EVIDENCE"
            ):
                freeze_owner_selection(
                    candidate,
                    selected_c_fn=3.0,
                    selected_threshold=0.5,
                    owner_decision_reference="owner-1",
                    owner_decision_timestamp="2026-07-21T00:00:00Z",
                )

    def test_candidate_hash_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            candidate, _, _ = create_candidate(Path(temporary))
            candidate["bestIteration"] = 99
            with self.assertRaisesRegex(ExperimentError, "FREEZE_CANDIDATE_HASH_MISMATCH"):
                freeze_candidate(candidate)

    def test_pre_freeze_test_evaluation_is_rejected_before_loader(self) -> None:
        called = False

        def loader():
            nonlocal called
            called = True
            raise AssertionError

        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ExperimentError, "PRETEST_FREEZE_MISSING_OR_INVALID"):
                evaluate_frozen_test_once(
                    artifact_root=Path(temporary),
                    freeze={},
                    authorization_reference="approval-1",
                    authorization_timestamp="2026-07-21T00:00:00Z",
                    test_loader=loader,
                )
        self.assertFalse(called)

    def test_more_than_one_frozen_candidate_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, _, _ = create_candidate(root)
            freeze = freeze_candidate(candidate)
            freeze["frozenCandidates"].append(copy.deepcopy(freeze["frozenCandidates"][0]))
            material = dict(freeze)
            material.pop("freezeSha256")
            freeze["freezeSha256"] = canonical_sha256(material)
            with self.assertRaisesRegex(ExperimentError, "TEST_CANDIDATE_COUNT_NOT_ONE"):
                verify_freeze_record(freeze, artifact_root=root)

    def test_artifact_hash_mismatch_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, model, _ = create_candidate(root)
            freeze = freeze_candidate(candidate)
            model.write_bytes(b"changed")
            with self.assertRaisesRegex(ExperimentError, "ARTIFACT_INTEGRITY_MISMATCH"):
                verify_freeze_record(freeze, artifact_root=root)

    def test_test_access_is_consumed_before_loader_and_second_attempt_is_rejected(self) -> None:
        calls = 0

        def loader():
            nonlocal calls
            calls += 1
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "SYNTHETIC_LOADER_STOP",
            )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidate, _, _ = create_candidate(root)
            freeze = freeze_candidate(candidate)
            with self.assertRaisesRegex(ExperimentError, "SYNTHETIC_LOADER_STOP"):
                evaluate_frozen_test_once(
                    artifact_root=root,
                    freeze=freeze,
                    authorization_reference="approval-1",
                    authorization_timestamp="2026-07-21T00:00:00Z",
                    test_loader=loader,
                )
            self.assertTrue((root / "test-access-consumed.json").is_file())
            with self.assertRaisesRegex(ExperimentError, "TEST_ACCESS_ALREADY_CONSUMED"):
                evaluate_frozen_test_once(
                    artifact_root=root,
                    freeze=freeze,
                    authorization_reference="approval-1",
                    authorization_timestamp="2026-07-21T00:00:00Z",
                    test_loader=loader,
                )
        self.assertEqual(calls, 1)


class ReportingTests(unittest.TestCase):
    def test_aggregate_evidence_schema_validation_and_hash(self) -> None:
        evidence = build_aggregate_evidence(
            experiment_id="synthetic",
            experiment_version="v1",
            protocol_sha256="a" * 64,
            validation={"datasetEligibility": "PASS"},
        )
        validate_aggregate_evidence(evidence)
        tampered = copy.deepcopy(evidence)
        tampered["experimentVersion"] = "v2"
        with self.assertRaisesRegex(ExperimentError, "AGGREGATE_EVIDENCE_HASH_MISMATCH"):
            validate_aggregate_evidence(tampered)

    def test_test_evidence_without_freeze_is_rejected(self) -> None:
        with self.assertRaisesRegex(ExperimentError, "TEST_EVIDENCE_WITHOUT_FREEZE"):
            build_aggregate_evidence(
                experiment_id="synthetic",
                experiment_version="v1",
                protocol_sha256="a" * 64,
                test_evidence={"safe": True},
            )

    def test_report_contains_every_required_section_and_no_sample_material(self) -> None:
        evidence = build_aggregate_evidence(
            experiment_id="synthetic",
            experiment_version="v1",
            protocol_sha256="a" * 64,
            validation={"datasetEligibility": "PASS"},
        )
        report = render_markdown_report(evidence)
        for section in REPORT_SECTIONS:
            self.assertIn(section, report)
        lowered = report.lower()
        self.assertNotIn("embeddingvalues", lowered)
        self.assertNotIn("scoresbysample", lowered)


_HAS_LIGHTGBM_460 = (
    importlib.util.find_spec("lightgbm") is not None
    and importlib.metadata.version("lightgbm") == "4.6.0"
)


@unittest.skipUnless(_HAS_LIGHTGBM_460, "official LightGBM 4.6.0 is not installed")
class SyntheticEndToEndTest(unittest.TestCase):
    def test_frozen_single_candidate_is_evaluated_once_with_aggregate_output(self) -> None:
        import lightgbm as lgb

        rng = np.random.default_rng(20260721)
        train_labels = np.asarray([0, 1] * 20, dtype=np.int8)
        train_matrix = rng.normal(size=(40, 3)).astype(np.float32)
        train_matrix[:, 0] += train_labels * 2
        booster = lgb.train(
            {
                "objective": "binary",
                "metric": "binary_logloss",
                "verbosity": -1,
                "num_threads": 1,
                "deterministic": True,
                "force_col_wise": True,
                "seed": 20260721,
            },
            lgb.Dataset(train_matrix, label=train_labels),
            num_boost_round=3,
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model.txt"
            booster.save_model(str(model), num_iteration=3)
            calibrator_value = fit_calibrator(
                "none", [0.1, 0.9, 0.2, 0.8], [0, 1, 0, 1]
            ).as_json()
            calibrator = write_json_artifact(root, "calibrator.json", calibrator_value)
            candidate = prepare_freeze_candidate(
                experiment_id="synthetic-e2e",
                experiment_version="v1",
                dataset_identity={
                    "version": "synthetic.v1",
                    "sha256": "1" * 64,
                    "manifestSha256": "2" * 64,
                    "splitPolicyVersion": "family.v1",
                    "splitMembershipSha256": "3" * 64,
                    "testDataSha256": "4" * 64,
                },
                encoder_descriptor={
                    "providerKind": "synthetic_test_only",
                    "modelId": "synthetic/model",
                    "sourceRevision": "revision",
                    "inputPrefix": "",
                    "maximumTokenLength": 8,
                    "pooling": "synthetic",
                    "normalization": "none",
                    "outputDtype": "float32",
                    "outputDimension": 3,
                    "artifactIdentitySha256": "5" * 64,
                },
                embedding_dimension=3,
                candidate_set_sha256="6" * 64,
                fold_membership_sha256="7" * 64,
                selected_candidate_id="lgb-synthetic",
                selected_parameters={"learning_rate": 0.1},
                best_iteration=3,
                model_identity=artifact_identity(root, model),
                calibrator_type="none",
                calibrator_identity=artifact_identity(root, calibrator),
                threshold_scenarios=threshold_scenarios(),
                code_config_sha256="8" * 64,
                champion_identity={"version": "champion.v1", "sha256": "9" * 64},
                slice_policy={"version": "slices.v1", "sha256": "a" * 64},
            )
            freeze = freeze_candidate(candidate)
            test_labels = np.asarray([0, 1] * 10, dtype=np.int8)
            test_matrix = rng.normal(size=(20, 3)).astype(np.float32)
            test_matrix[:, 0] += test_labels * 2
            categories = [CATEGORIES[index % 5] for index in range(20)]

            def loader():
                return TestEvaluationInput(
                    matrix=test_matrix,
                    labels=test_labels,
                    family_ids=[f"family-{index}" for index in range(20)],
                    categories=categories,
                    record_ids=[f"record-{index}" for index in range(20)],
                    slice_membership=[
                        (REQUIRED_SLICES[index % len(REQUIRED_SLICES)],)
                        for index in range(20)
                    ],
                    champion_prediction=test_labels,
                    source_sha256="4" * 64,
                )

            evidence = evaluate_frozen_test_once(
                artifact_root=root,
                freeze=freeze,
                authorization_reference="test-owner-approval-1",
                authorization_timestamp="2026-07-21T01:00:00Z",
                test_loader=loader,
                bootstrap_repeats=10,
            )
            self.assertEqual(evidence["testAccess"]["evaluatedCandidateCount"], 1)
            self.assertFalse(evidence["frozenSelection"]["thresholdReselectedOnTest"])
            self.assertFalse(evidence["containsEmbeddingMatrix"])
            self.assertFalse(evidence["containsPerSampleScore"])


if __name__ == "__main__":
    unittest.main()
