"""Stage-separated CLI for the embedding-only LightGBM offline experiment.

The CLI never exposes an all-in-one command.  ``tune`` cannot open the Test
record file; ``evaluate-test`` is the only stage that constructs its loader.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from .encoder_runtime import (
    encode_pooled_single_requests,
    install_network_guard,
    load_runtime,
)
from .lightgbm_embedding_artifacts import (
    TestEvaluationInput,
    artifact_identity,
    build_offline_metadata,
    evaluate_frozen_test_once,
    freeze_owner_selection,
    prepare_freeze_candidate,
    read_json_object,
    resolve_output_path,
    scan_aggregate_material,
    verify_artifact_identity,
    write_json_artifact,
)
from .lightgbm_embedding_calibration import (
    C_FN_SCENARIOS,
    family_group_threshold_bootstrap,
    select_calibrator,
    select_threshold_scenarios,
)
from .lightgbm_embedding_experiment import (
    CATEGORIES,
    EXPERIMENT_SCHEMA_VERSION,
    EXPERIMENT_SEED,
    REQUIRED_SLICES,
    DatasetArrays,
    EmbeddingProvider,
    ExperimentError,
    ExperimentStatus,
    canonical_sha256,
    encode_validated_matrix,
    fold_set_sha256,
    make_stratified_group_folds,
    safe_row_identity_sha256,
    sha256_file,
    validate_dataset_arrays,
    validate_dataset_eligibility,
    validate_encoder_descriptor,
)
from .lightgbm_embedding_reporting import (
    build_aggregate_evidence,
    render_markdown_report,
)
from .lightgbm_embedding_search import (
    candidate_set_manifest,
    evaluate_baseline,
    final_best_iteration,
    frozen_search_candidates,
    generate_oof_probabilities,
    refit_full_train,
    run_random_search,
    save_model_with_parity,
    select_best_candidate,
    SearchIncompleteError,
)


CONFIG_SCHEMA = "gatelm.lightgbm-embedding-experiment-config.v1"
VALIDATION_SCHEMA = "gatelm.lightgbm-embedding-validation.v1"
TUNING_SCHEMA = "gatelm.lightgbm-embedding-tuning.v1"
LOCAL_E5_PROVIDER_KIND = "local_e5_small_native_pooled_v2"


@dataclass(frozen=True)
class LoadedRecords:
    instruction_texts: tuple[str, ...]
    arrays: DatasetArrays
    champion_prediction: np.ndarray
    slice_membership: tuple[tuple[str, ...], ...]
    file_sha256: str


@dataclass(frozen=True)
class ExperimentConfig:
    path: Path
    value: Mapping[str, Any]
    output_root: Path
    config_sha256: str


class LocalE5PooledProvider:
    """Adapter over the pinned, local-only E5 loader; no runtime download path."""

    def __init__(self, encoder_config: Mapping[str, Any]) -> None:
        if encoder_config.get("kind") != LOCAL_E5_PROVIDER_KIND:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "ENCODER_PROVIDER_KIND_UNSUPPORTED",
            )
        manifest_path = Path(str(encoder_config.get("manifestPath", "")))
        artifact_root = Path(str(encoder_config.get("artifactRoot", "")))
        descriptor = encoder_config.get("descriptor")
        if not isinstance(descriptor, Mapping):
            raise ExperimentError(
                ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
                "ENCODER_DESCRIPTOR_INCOMPLETE",
            )
        install_network_guard()
        runtime, manifest = load_runtime(
            manifest_path=manifest_path,
            artifact_root=artifact_root,
        )
        expected_descriptor = {
            "providerKind": LOCAL_E5_PROVIDER_KIND,
            "modelId": manifest.get("modelId"),
            "sourceRevision": manifest.get("sourceRevision"),
            "inputPrefix": manifest.get("preprocessing", {}).get("inputPrefix"),
            "maximumTokenLength": manifest.get("preprocessing", {}).get(
                "maximumTokenLength"
            ),
            "pooling": manifest.get("pooling", {}).get("rule"),
            "normalization": "none_native_pooled",
            "outputDtype": manifest.get("encoder", {}).get("outputDtype"),
            "outputDimension": manifest.get("encoder", {}).get("outputDimension"),
            "artifactIdentitySha256": manifest.get("bundleSha256"),
        }
        if dict(descriptor) != expected_descriptor:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "ENCODER_ARTIFACT_IDENTITY_MISMATCH",
            )
        self._runtime = runtime
        self._descriptor = dict(descriptor)
        self._dimension = validate_encoder_descriptor(self._descriptor)

    @property
    def descriptor(self) -> Mapping[str, Any]:
        return self._descriptor

    @property
    def declared_dimension(self) -> int:
        return self._dimension

    @property
    def artifact_identity_sha256(self) -> str:
        return str(self._descriptor["artifactIdentitySha256"])

    def encode_batch(self, instruction_texts: Sequence[str]) -> Sequence[Sequence[float]]:
        return encode_pooled_single_requests(self._runtime, instruction_texts)


def _object(value: Any, *, reason_code: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            reason_code,
        )
    return value


def load_config(path: Path) -> ExperimentConfig:
    value = read_json_object(path)
    if value.get("schemaVersion") != CONFIG_SCHEMA:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "EXPERIMENT_CONFIG_SCHEMA_INVALID",
        )
    required = {
        "schemaVersion",
        "experimentId",
        "experimentVersion",
        "protocolSha256",
        "outputRoot",
        "dataset",
        "encoder",
        "champion",
        "slicePolicy",
        "bootstrap",
    }
    if set(value) != required:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "EXPERIMENT_CONFIG_FIELDS_INVALID",
        )
    for field in ("experimentId", "experimentVersion"):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "EXPERIMENT_IDENTITY_INVALID",
            )
    protocol_hash = value.get("protocolSha256")
    if not isinstance(protocol_hash, str) or len(protocol_hash) != 64:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "PROTOCOL_SHA256_INVALID",
        )
    output_value = value.get("outputRoot")
    if not isinstance(output_value, str) or not output_value.strip():
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "OUTPUT_ROOT_INVALID",
        )
    output_root = Path(output_value)
    if not output_root.is_absolute():
        output_root = (path.parent / output_root).resolve(strict=False)
    descriptor = _object(value.get("encoder"), reason_code="ENCODER_CONFIG_INVALID").get(
        "descriptor"
    )
    validate_encoder_descriptor(
        _object(descriptor, reason_code="ENCODER_DESCRIPTOR_INCOMPLETE")
    )
    dataset = _object(value.get("dataset"), reason_code="DATASET_CONFIG_INVALID")
    if set(dataset) != {
        "version",
        "datasetSha256",
        "manifestPath",
        "manifestSha256",
        "splitPolicyVersion",
        "train",
        "validation",
        "test",
        "testMembership",
        "testAggregate",
    }:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "DATASET_CONFIG_FIELDS_INVALID",
        )
    for split in ("train", "validation", "test", "testMembership"):
        split_descriptor = _object(
            dataset.get(split),
            reason_code="DATASET_SPLIT_DESCRIPTOR_MISSING",
        )
        if set(split_descriptor) != {"path", "sha256"}:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "DATASET_SPLIT_DESCRIPTOR_INVALID",
            )
    test_aggregate = _object(
        dataset.get("testAggregate"),
        reason_code="TEST_AGGREGATE_MISSING",
    )
    if (
        set(test_aggregate) != {"records", "families", "simple", "complex"}
        or any(
            isinstance(test_aggregate.get(field), bool)
            or not isinstance(test_aggregate.get(field), int)
            or int(test_aggregate[field]) <= 0
            for field in test_aggregate
        )
        or test_aggregate["simple"] + test_aggregate["complex"]
        != test_aggregate["records"]
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "TEST_AGGREGATE_INVALID",
        )
    for identity_name in ("champion", "slicePolicy"):
        identity = _object(
            value.get(identity_name),
            reason_code="IMMUTABLE_IDENTITY_INVALID",
        )
        if (
            set(identity) != {"version", "sha256"}
            or not isinstance(identity.get("version"), str)
            or not identity["version"]
            or not isinstance(identity.get("sha256"), str)
            or len(identity["sha256"]) != 64
        ):
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "IMMUTABLE_IDENTITY_INVALID",
            )
    bootstrap = _object(value.get("bootstrap"), reason_code="BOOTSTRAP_CONFIG_INVALID")
    if set(bootstrap) != {"thresholdRepeats", "testRepeats"} or any(
        isinstance(bootstrap.get(field), bool)
        or not isinstance(bootstrap.get(field), int)
        or not 1 <= int(bootstrap[field]) <= 100000
        for field in bootstrap
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "BOOTSTRAP_CONFIG_INVALID",
        )
    scan_aggregate_material(
        {
            key: child
            for key, child in value.items()
            if key not in {"dataset"}  # dataset paths may use redacted source terminology
        }
    )
    return ExperimentConfig(
        path=path.resolve(strict=True),
        value=value,
        output_root=output_root,
        config_sha256=canonical_sha256(value),
    )


def _configured_path(config: ExperimentConfig, value: Any) -> Path:
    if not isinstance(value, str) or not value:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "INPUT_PATH_INVALID",
        )
    path = Path(value)
    return path if path.is_absolute() else (config.path.parent / path).resolve(strict=False)


def _verify_input_file(config: ExperimentConfig, descriptor: Mapping[str, Any]) -> Path:
    path = _configured_path(config, descriptor.get("path"))
    expected = descriptor.get("sha256")
    if (
        not isinstance(expected, str)
        or len(expected) != 64
        or not path.is_file()
        or sha256_file(path) != expected
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "INPUT_FILE_INTEGRITY_MISMATCH",
        )
    return path


def _load_manifest(config: ExperimentConfig) -> tuple[dict[str, Any], str]:
    dataset = _object(config.value["dataset"], reason_code="DATASET_CONFIG_INVALID")
    manifest_path = _configured_path(config, dataset.get("manifestPath"))
    expected_manifest_hash = dataset.get("manifestSha256")
    if (
        not manifest_path.is_file()
        or not isinstance(expected_manifest_hash, str)
        or sha256_file(manifest_path) != expected_manifest_hash
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DATASET_INELIGIBLE,
            "DATASET_MANIFEST_INTEGRITY_MISMATCH",
        )
    manifest = read_json_object(manifest_path)
    validate_dataset_eligibility(manifest)
    if manifest.get("dataset_sha256") != dataset.get("datasetSha256"):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DATASET_INELIGIBLE,
            "DATASET_IDENTITY_MISMATCH",
        )
    return manifest, expected_manifest_hash


def _load_records(
    config: ExperimentConfig,
    split: str,
) -> LoadedRecords:
    dataset = _object(config.value["dataset"], reason_code="DATASET_CONFIG_INVALID")
    descriptor = _object(dataset.get(split), reason_code="DATASET_SPLIT_DESCRIPTOR_MISSING")
    path = _verify_input_file(config, descriptor)
    rows: list[Mapping[str, Any]] = []
    try:
        with path.open("r", encoding="utf-8") as stream:
            for line in stream:
                if not line.strip():
                    continue
                row = json.loads(line)
                if not isinstance(row, Mapping):
                    raise ValueError
                rows.append(row)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "DATASET_RECORD_FILE_INVALID",
        ) from exc
    if not rows:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "DATASET_RECORD_FILE_EMPTY",
        )
    required = {
        "sample_id",
        "family_id",
        "split",
        "label",
        "category",
        "redacted_prompt",
        "champion_prediction",
        "slices",
    }
    if any(set(row) != required for row in rows):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "DATASET_RECORD_FIELDS_INVALID",
        )
    if any(row["split"] != split for row in rows):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "DATASET_SPLIT_FILE_CONTAMINATED",
        )
    instruction_texts = tuple(str(row["redacted_prompt"]) for row in rows)
    if any(not value.strip() for value in instruction_texts):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "DATASET_TEXT_EMPTY",
        )
    arrays = validate_dataset_arrays(
        labels=[row["label"] for row in rows],
        family_ids=[row["family_id"] for row in rows],
        splits=[row["split"] for row in rows],
        categories=[row["category"] for row in rows],
        record_ids=[row["sample_id"] for row in rows],
        require_all_splits=False,
    )
    champion = np.asarray([row["champion_prediction"] for row in rows], dtype=np.int8)
    if champion.shape != arrays.labels.shape or any(value not in (0, 1) for value in champion):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CHAMPION_PREDICTION_INVALID",
        )
    memberships: list[tuple[str, ...]] = []
    for row in rows:
        values = row["slices"]
        if (
            not isinstance(values, list)
            or any(not isinstance(value, str) or value not in REQUIRED_SLICES for value in values)
        ):
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "SLICE_MEMBERSHIP_INVALID",
            )
        memberships.append(tuple(sorted(set(values))))
    return LoadedRecords(
        instruction_texts=instruction_texts,
        arrays=arrays,
        champion_prediction=champion,
        slice_membership=tuple(memberships),
        file_sha256=sha256_file(path),
    )


def _combine_development_records(train: LoadedRecords, validation: LoadedRecords) -> DatasetArrays:
    return validate_dataset_arrays(
        labels=[*train.arrays.labels.tolist(), *validation.arrays.labels.tolist()],
        family_ids=[*train.arrays.family_ids.tolist(), *validation.arrays.family_ids.tolist()],
        splits=[*train.arrays.splits.tolist(), *validation.arrays.splits.tolist()],
        categories=[*train.arrays.categories.tolist(), *validation.arrays.categories.tolist()],
        record_ids=[*train.arrays.record_ids.tolist(), *validation.arrays.record_ids.tolist()],
        require_all_splits=False,
    )


def _validate_safe_test_membership(
    config: ExperimentConfig,
    development: DatasetArrays,
) -> str:
    dataset = _object(config.value["dataset"], reason_code="DATASET_CONFIG_INVALID")
    descriptor = _object(
        dataset["testMembership"],
        reason_code="TEST_MEMBERSHIP_DESCRIPTOR_INVALID",
    )
    path = _verify_input_file(config, descriptor)
    membership = read_json_object(path)
    if membership.get("schemaVersion") != "gatelm.lightgbm-embedding-safe-test-membership.v1":
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "TEST_MEMBERSHIP_SCHEMA_INVALID",
        )
    families = membership.get("familyIdentitySha256")
    records = membership.get("recordIdentitySha256")
    if (
        not isinstance(families, list)
        or not isinstance(records, list)
        or len(records) != dataset["testAggregate"]["records"]
        or len(set(records)) != len(records)
        or len(set(families)) != dataset["testAggregate"]["families"]
        or any(
            not isinstance(value, str)
            or len(value) != 64
            or any(character not in "0123456789abcdef" for character in value)
            for value in [*families, *records]
        )
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "TEST_MEMBERSHIP_INVALID",
        )
    development_family_hashes = {
        canonical_sha256({"family": str(value)}) for value in development.family_ids.tolist()
    }
    if development_family_hashes & set(families):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "CROSS_SPLIT_FAMILY_LEAKAGE",
        )
    return sha256_file(path)


def _provider(config: ExperimentConfig) -> EmbeddingProvider:
    encoder = dict(
        _object(config.value["encoder"], reason_code="ENCODER_CONFIG_INVALID")
    )
    encoder["manifestPath"] = str(
        _configured_path(config, encoder.get("manifestPath"))
    )
    encoder["artifactRoot"] = str(
        _configured_path(config, encoder.get("artifactRoot"))
    )
    return LocalE5PooledProvider(encoder)


def _dataset_identity(
    config: ExperimentConfig,
    *,
    manifest_sha256: str,
    split_membership_sha256: str,
) -> dict[str, Any]:
    dataset = _object(config.value["dataset"], reason_code="DATASET_CONFIG_INVALID")
    return {
        "version": dataset.get("version"),
        "sha256": dataset.get("datasetSha256"),
        "manifestSha256": manifest_sha256,
        "splitPolicyVersion": dataset.get("splitPolicyVersion"),
        "splitMembershipSha256": split_membership_sha256,
        "testDataSha256": dataset["test"]["sha256"],
    }


def run_validate(config: ExperimentConfig) -> dict[str, Any]:
    manifest, manifest_sha256 = _load_manifest(config)
    train = _load_records(config, "train")
    validation = _load_records(config, "validation")
    development = _combine_development_records(train, validation)
    test_membership_sha256 = _validate_safe_test_membership(config, development)
    test_records = int(config.value["dataset"]["testAggregate"]["records"])
    total_records = train.arrays.count + validation.arrays.count + test_records
    if not (
        train.arrays.count * 100 == total_records * 70
        and validation.arrays.count * 100 == total_records * 15
        and test_records * 100 == total_records * 15
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_SPLIT,
            "SPLIT_RATIO_NOT_70_15_15",
        )
    folds = make_stratified_group_folds(
        labels=train.arrays.labels,
        family_ids=train.arrays.family_ids,
        record_ids=train.arrays.record_ids,
        categories=train.arrays.categories,
    )
    candidates = frozen_search_candidates()
    candidate_manifest = candidate_set_manifest(candidates)
    fold_sha = fold_set_sha256(folds)
    split_identity = canonical_sha256(
        {
            "trainDataSha256": train.file_sha256,
            "validationDataSha256": validation.file_sha256,
            "testMembershipSha256": test_membership_sha256,
        }
    )
    validation_evidence = {
        "schemaVersion": VALIDATION_SCHEMA,
        "experimentId": config.value["experimentId"],
        "experimentVersion": config.value["experimentVersion"],
        "configSha256": config.config_sha256,
        "datasetEligibility": "PASS",
        "dataset": _dataset_identity(
            config,
            manifest_sha256=manifest_sha256,
            split_membership_sha256=split_identity,
        ),
        "embeddingDimension": config.value["encoder"]["descriptor"]["outputDimension"],
        "featureShape": "validated_at_tune_after_in_memory_encoding",
        "dimensionStatus": "DESCRIPTOR_PASS_INPUT_PENDING_TUNE",
        "splitAggregate": {
            "train": {
                "records": train.arrays.count,
                "families": len(set(train.arrays.family_ids.tolist())),
                "simple": int(np.sum(train.arrays.labels == 0)),
                "complex": int(np.sum(train.arrays.labels == 1)),
            },
            "validation": {
                "records": validation.arrays.count,
                "families": len(set(validation.arrays.family_ids.tolist())),
                "simple": int(np.sum(validation.arrays.labels == 0)),
                "complex": int(np.sum(validation.arrays.labels == 1)),
            },
            "test": dict(config.value["dataset"]["testAggregate"]),
        },
        "splitMembershipSha256": split_identity,
        "foldMembershipSha256": fold_sha,
        "familyLeakage": 0,
        "folds": [
            {
                "fold": fold.fold,
                "membershipSha256": fold.membership_sha256,
                "aggregate": dict(fold.aggregate),
            }
            for fold in folds
        ],
        "candidateSetSha256": candidate_manifest["candidateSetSha256"],
        "candidateCount": candidate_manifest["candidateCount"],
        "datasetOwnerDecision": manifest.get("review", {}).get("review_status"),
        "modelTrainingPerformed": False,
        "testOutcomeAccessed": False,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    write_json_artifact(config.output_root, "validation.json", validation_evidence)
    write_json_artifact(config.output_root, "candidate-set.json", candidate_manifest)
    fold_manifest = {
        "schemaVersion": "gatelm.lightgbm-embedding-fold-set.v1",
        "seed": EXPERIMENT_SEED,
        "foldCount": len(folds),
        "foldMembershipSha256": fold_sha,
        "folds": validation_evidence["folds"],
        "containsPerSampleScore": False,
    }
    write_json_artifact(config.output_root, "fold-set.json", fold_manifest)
    return validation_evidence


def _require_validation(config: ExperimentConfig) -> dict[str, Any]:
    path = resolve_output_path(config.output_root, "validation.json")
    validation = read_json_object(path)
    if (
        validation.get("schemaVersion") != VALIDATION_SCHEMA
        or validation.get("configSha256") != config.config_sha256
        or validation.get("datasetEligibility") != "PASS"
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "VALIDATION_EVIDENCE_INVALID",
        )
    scan_aggregate_material(validation)
    return validation


def run_tune(
    config: ExperimentConfig,
    *,
    execution_approval_reference: str,
    smoke: bool,
) -> dict[str, Any]:
    if not execution_approval_reference.strip():
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TUNING_EXECUTION_APPROVAL_REQUIRED",
        )
    validation_evidence = _require_validation(config)
    _load_manifest(config)
    # Deliberately load only the development splits in this stage.
    train = _load_records(config, "train")
    validation = _load_records(config, "validation")
    _combine_development_records(train, validation)
    provider = _provider(config)
    train_matrix = encode_validated_matrix(provider, train.instruction_texts)
    validation_matrix = encode_validated_matrix(provider, validation.instruction_texts)
    folds = make_stratified_group_folds(
        labels=train.arrays.labels,
        family_ids=train.arrays.family_ids,
        record_ids=train.arrays.record_ids,
        categories=train.arrays.categories,
    )
    if fold_set_sha256(folds) != validation_evidence["foldMembershipSha256"]:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "FOLD_MEMBERSHIP_DRIFT",
        )
    candidates = frozen_search_candidates()
    candidate_manifest = candidate_set_manifest(candidates)
    if candidate_manifest["candidateSetSha256"] != validation_evidence["candidateSetSha256"]:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CANDIDATE_SET_DRIFT",
        )
    baseline = evaluate_baseline(train_matrix, train.arrays.labels, folds)
    try:
        results = run_random_search(
            train_matrix,
            train.arrays.labels,
            folds,
            candidates,
            smoke=smoke,
        )
    except SearchIncompleteError as exc:
        failed_evidence = {
            "schemaVersion": TUNING_SCHEMA,
            "experimentId": config.value["experimentId"],
            "experimentVersion": config.value["experimentVersion"],
            "configSha256": config.config_sha256,
            "executionApprovalReference": execution_approval_reference,
            "searchMode": "smoke_first_30" if smoke else "full_80",
            "candidateSetSha256": candidate_manifest["candidateSetSha256"],
            "candidateCount": len(exc.results),
            "completedFoldRuns": sum(
                len(result.fold_average_precision) for result in exc.results
            ),
            "searchComplete": False,
            "candidateResults": [result.aggregate_json() for result in exc.results],
            "failureReasonCounts": dict(
                sorted(
                    Counter(
                        result.error_reason_code
                        for result in exc.results
                        if result.error_reason_code is not None
                    ).items()
                )
            ),
            "testOutcomeAccessed": False,
            "containsEmbeddingMatrix": False,
            "containsPerSampleScore": False,
        }
        write_json_artifact(
            config.output_root,
            "tuning-evidence.json",
            failed_evidence,
        )
        raise
    selected = select_best_candidate(results)
    best_iteration = final_best_iteration(selected)
    booster = refit_full_train(train_matrix, train.arrays.labels, selected)
    model_relative = (
        f"difficulty-lightgbm-embedding-d{provider.declared_dimension}-model."
        f"{config.value['experimentVersion']}.txt"
    )
    model_path = resolve_output_path(config.output_root, model_relative)
    save_model_with_parity(
        booster,
        model_path,
        parity_matrix=train_matrix[: min(32, len(train_matrix))],
        best_iteration=best_iteration,
    )
    oof = generate_oof_probabilities(
        train_matrix,
        train.arrays.labels,
        train.arrays.family_ids,
        folds,
        selected,
    )
    validation_raw = np.asarray(
        booster.predict(validation_matrix, num_iteration=best_iteration),
        dtype=np.float64,
    )
    calibration = select_calibrator(
        oof_probability=oof,
        train_labels=train.arrays.labels,
        validation_raw_probability=validation_raw,
        validation_labels=validation.arrays.labels,
    )
    calibrator_relative = (
        f"difficulty-lightgbm-embedding-d{provider.declared_dimension}-calibrator."
        f"{config.value['experimentVersion']}.json"
    )
    calibrator_path = write_json_artifact(
        config.output_root,
        calibrator_relative,
        calibration.selected_artifact,
    )
    row_identity = safe_row_identity_sha256(
        record_ids=validation.arrays.record_ids.tolist(),
        labels=validation.arrays.labels.tolist(),
        categories=validation.arrays.categories.tolist(),
    )
    scenarios = select_threshold_scenarios(
        probability=calibration.selected_probability,
        labels=validation.arrays.labels,
        categories=validation.arrays.categories.tolist(),
        champion_prediction=validation.champion_prediction,
        row_identity_sha256=row_identity,
        champion_row_identity_sha256=row_identity,
    )
    bootstrap_repeats = int(config.value["bootstrap"]["thresholdRepeats"])
    stability = {
        str(scenario.c_fn): (
            None
            if scenario.selected is None
            else family_group_threshold_bootstrap(
                probability=calibration.selected_probability,
                labels=validation.arrays.labels,
                categories=validation.arrays.categories.tolist(),
                champion_prediction=validation.champion_prediction,
                family_ids=validation.arrays.family_ids.tolist(),
                c_fn=scenario.c_fn,
                repeats=bootstrap_repeats,
            )
        )
        for scenario in scenarios
    }
    model_identity = artifact_identity(config.output_root, model_path)
    calibrator_identity = artifact_identity(config.output_root, calibrator_path)
    tuning_evidence = {
        "schemaVersion": TUNING_SCHEMA,
        "experimentId": config.value["experimentId"],
        "experimentVersion": config.value["experimentVersion"],
        "configSha256": config.config_sha256,
        "executionApprovalReference": execution_approval_reference,
        "searchMode": "smoke_first_30" if smoke else "full_80",
        "candidateSetSha256": candidate_manifest["candidateSetSha256"],
        "candidateCount": len(results),
        "completedFoldRuns": len(results) * len(folds),
        "searchComplete": not smoke and len(results) == 80,
        "baseline": baseline.aggregate_json(),
        "candidateResults": [result.aggregate_json() for result in results],
        "selectedCandidateId": selected.candidate_id,
        "selectedParameters": dict(selected.parameters),
        "selectedMeanAveragePrecision": selected.mean_average_precision,
        "selectedStdAveragePrecision": selected.std_average_precision,
        "bestIteration": best_iteration,
        "model": model_identity,
        "oofCoverage": "exactly_once",
        "oofPersisted": False,
        "calibrationResults": list(calibration.aggregate_results),
        "selectedCalibrator": calibration.selected_artifact["type"],
        "calibrator": calibrator_identity,
        "validationRowIdentitySha256": row_identity,
        "thresholdScenarios": [scenario.as_json() for scenario in scenarios],
        "thresholdStability": stability,
        "testOutcomeAccessed": False,
        "latencyDiagnostic": "not_measured",
        "modelOwnerDecision": "pending_pretest_freeze",
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    write_json_artifact(config.output_root, "tuning-evidence.json", tuning_evidence)
    dataset_identity = dict(validation_evidence["dataset"])
    metadata = build_offline_metadata(
        experiment_id=config.value["experimentId"],
        experiment_version=config.value["experimentVersion"],
        embedding_dimension=provider.declared_dimension,
        feature_rows=train.arrays.count,
        encoder_descriptor=provider.descriptor,
        selected_parameters={**selected.parameters},
        best_iteration=best_iteration,
        model_identity=model_identity,
        calibrator_type=calibration.selected_artifact["type"],
        calibrator_identity=calibrator_identity,
        selected_threshold=None,
        selected_c_fn=None,
        owner_decision_reference=None,
        dataset_identity=dataset_identity,
        candidate_set_sha256=candidate_manifest["candidateSetSha256"],
        code_config_sha256=config.config_sha256,
    )
    write_json_artifact(config.output_root, "offline-metadata.json", metadata)
    return tuning_evidence


def _require_tuning(config: ExperimentConfig) -> dict[str, Any]:
    tuning = read_json_object(resolve_output_path(config.output_root, "tuning-evidence.json"))
    if (
        tuning.get("schemaVersion") != TUNING_SCHEMA
        or tuning.get("configSha256") != config.config_sha256
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TUNING_EVIDENCE_INVALID",
        )
    scan_aggregate_material(tuning)
    return tuning


def run_prepare_freeze(config: ExperimentConfig) -> dict[str, Any]:
    validation = _require_validation(config)
    tuning = _require_tuning(config)
    if tuning.get("searchComplete") is not True or tuning.get("candidateCount") != 80:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SMOKE_RESULT_CANNOT_BE_FROZEN",
        )
    verify_artifact_identity(config.output_root, tuning["model"])
    verify_artifact_identity(config.output_root, tuning["calibrator"])
    champion = _object(config.value["champion"], reason_code="CHAMPION_CONFIG_INVALID")
    slice_policy = _object(config.value["slicePolicy"], reason_code="SLICE_POLICY_INVALID")
    candidate = prepare_freeze_candidate(
        experiment_id=config.value["experimentId"],
        experiment_version=config.value["experimentVersion"],
        dataset_identity=validation["dataset"],
        encoder_descriptor=config.value["encoder"]["descriptor"],
        embedding_dimension=validation["embeddingDimension"],
        candidate_set_sha256=tuning["candidateSetSha256"],
        fold_membership_sha256=validation["foldMembershipSha256"],
        selected_candidate_id=tuning["selectedCandidateId"],
        selected_parameters=tuning["selectedParameters"],
        best_iteration=tuning["bestIteration"],
        model_identity=tuning["model"],
        calibrator_type=tuning["selectedCalibrator"],
        calibrator_identity=tuning["calibrator"],
        threshold_scenarios=tuning["thresholdScenarios"],
        code_config_sha256=config.config_sha256,
        champion_identity=champion,
        slice_policy=slice_policy,
    )
    write_json_artifact(config.output_root, "pretest-freeze-candidate.json", candidate)
    return candidate


def run_freeze(
    config: ExperimentConfig,
    *,
    selected_c_fn: float,
    selected_threshold: float,
    owner_decision_reference: str,
    owner_decision_timestamp: str,
) -> dict[str, Any]:
    candidate = read_json_object(
        resolve_output_path(config.output_root, "pretest-freeze-candidate.json")
    )
    if candidate.get("codeConfigSha256") != config.config_sha256:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "FREEZE_CONFIG_IDENTITY_MISMATCH",
        )
    verify_artifact_identity(config.output_root, candidate["model"])
    calibrator = candidate["calibrator"]
    verify_artifact_identity(
        config.output_root,
        {key: calibrator[key] for key in ("relativePath", "sizeBytes", "sha256")},
    )
    record = freeze_owner_selection(
        candidate,
        selected_c_fn=selected_c_fn,
        selected_threshold=selected_threshold,
        owner_decision_reference=owner_decision_reference,
        owner_decision_timestamp=owner_decision_timestamp,
    )
    write_json_artifact(config.output_root, "pretest-freeze.json", record)
    return record


def run_evaluate_test(
    config: ExperimentConfig,
    *,
    authorization_reference: str,
    authorization_timestamp: str,
) -> dict[str, Any]:
    freeze = read_json_object(resolve_output_path(config.output_root, "pretest-freeze.json"))

    def load_test_after_guard() -> TestEvaluationInput:
        test = _load_records(config, "test")
        provider = _provider(config)
        matrix = encode_validated_matrix(provider, test.instruction_texts)
        return TestEvaluationInput(
            matrix=matrix,
            labels=test.arrays.labels,
            family_ids=test.arrays.family_ids.tolist(),
            categories=test.arrays.categories.tolist(),
            record_ids=test.arrays.record_ids.tolist(),
            slice_membership=test.slice_membership,
            champion_prediction=test.champion_prediction,
            source_sha256=test.file_sha256,
        )

    evidence = evaluate_frozen_test_once(
        artifact_root=config.output_root,
        freeze=freeze,
        authorization_reference=authorization_reference,
        authorization_timestamp=authorization_timestamp,
        test_loader=load_test_after_guard,
        bootstrap_repeats=int(config.value["bootstrap"]["testRepeats"]),
    )
    write_json_artifact(config.output_root, "test-evidence.json", evidence)
    return evidence


def _environment() -> dict[str, Any]:
    versions: dict[str, Any] = {
        "os": platform.system(),
        "architecture": platform.machine(),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "deviceType": "cpu",
        "numThreads": 1,
        "seed": EXPERIMENT_SEED,
    }
    try:
        import importlib.metadata

        versions["scikitLearn"] = importlib.metadata.version("scikit-learn")
        versions["lightgbm"] = importlib.metadata.version("lightgbm")
    except importlib.metadata.PackageNotFoundError:
        versions["lightgbm"] = "not_installed"
    return versions


def _optional_artifact(config: ExperimentConfig, relative: str) -> dict[str, Any] | None:
    path = resolve_output_path(config.output_root, relative)
    return read_json_object(path) if path.is_file() else None


def run_render_report(config: ExperimentConfig) -> tuple[dict[str, Any], str]:
    evidence = build_aggregate_evidence(
        experiment_id=config.value["experimentId"],
        experiment_version=config.value["experimentVersion"],
        protocol_sha256=config.value["protocolSha256"],
        validation=_optional_artifact(config, "validation.json"),
        tuning=_optional_artifact(config, "tuning-evidence.json"),
        freeze_candidate=_optional_artifact(config, "pretest-freeze-candidate.json"),
        freeze_record=_optional_artifact(config, "pretest-freeze.json"),
        test_evidence=_optional_artifact(config, "test-evidence.json"),
        environment=_environment(),
        limitations=(
            "Embedding-only shape is not an active GateLM runtime profile.",
            "Runtime promotion requires a separate active contract and review.",
        ),
    )
    report = render_markdown_report(evidence)
    write_json_artifact(config.output_root, "aggregate-evidence.json", evidence)
    report_path = resolve_output_path(config.output_root, "final-report.md")
    from .lightgbm_embedding_artifacts import atomic_write_bytes

    atomic_write_bytes(report_path, report.encode("utf-8"))
    return evidence, report


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="GateLM embedding-only LightGBM offline experiment protocol."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("validate", "prepare-freeze", "render-report"):
        child = subparsers.add_parser(command)
        child.add_argument("--config", type=Path, required=True)
    tune = subparsers.add_parser("tune")
    tune.add_argument("--config", type=Path, required=True)
    tune.add_argument("--execution-approval-reference", required=True)
    tune.add_argument("--smoke", action="store_true")
    freeze = subparsers.add_parser("freeze")
    freeze.add_argument("--config", type=Path, required=True)
    freeze.add_argument("--c-fn", type=float, choices=C_FN_SCENARIOS, required=True)
    freeze.add_argument("--threshold", type=float, required=True)
    freeze.add_argument("--owner-decision-reference", required=True)
    freeze.add_argument("--owner-decision-timestamp", required=True)
    evaluate = subparsers.add_parser("evaluate-test")
    evaluate.add_argument("--config", type=Path, required=True)
    evaluate.add_argument("--authorization-reference", required=True)
    evaluate.add_argument("--authorization-timestamp", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        config = load_config(args.config)
        if args.command == "validate":
            run_validate(config)
        elif args.command == "tune":
            run_tune(
                config,
                execution_approval_reference=args.execution_approval_reference,
                smoke=args.smoke,
            )
        elif args.command == "prepare-freeze":
            run_prepare_freeze(config)
        elif args.command == "freeze":
            run_freeze(
                config,
                selected_c_fn=args.c_fn,
                selected_threshold=args.threshold,
                owner_decision_reference=args.owner_decision_reference,
                owner_decision_timestamp=args.owner_decision_timestamp,
            )
        elif args.command == "evaluate-test":
            run_evaluate_test(
                config,
                authorization_reference=args.authorization_reference,
                authorization_timestamp=args.authorization_timestamp,
            )
        elif args.command == "render-report":
            run_render_report(config)
        else:  # pragma: no cover - argparse enforces the command set
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "COMMAND_UNSUPPORTED",
            )
    except ExperimentError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(f"{args.command} completed for {config.value['experimentId']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
