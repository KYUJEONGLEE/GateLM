"""Immutable artifacts, pre-Test freeze, and one-time Test access guards."""

from __future__ import annotations

import json
import math
import os
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np

from .lightgbm_embedding_calibration import (
    C_FN_SCENARIOS,
    aggregate_category_and_slice_metrics,
    apply_calibrator,
    classification_metrics,
    family_group_metric_bootstrap,
)
from .lightgbm_embedding_experiment import (
    EXPERIMENT_SCHEMA_VERSION,
    ExperimentError,
    ExperimentStatus,
    canonical_json_bytes,
    canonical_sha256,
    require_bare_sha256,
    sha256_file,
)
from .lightgbm_embedding_search import require_official_lightgbm


FREEZE_CANDIDATE_SCHEMA = "gatelm.lightgbm-embedding-pretest-candidate.v1"
FREEZE_RECORD_SCHEMA = "gatelm.lightgbm-embedding-pretest-freeze.v1"
TEST_ACCESS_SCHEMA = "gatelm.lightgbm-embedding-test-access.v1"
TEST_EVIDENCE_SCHEMA = "gatelm.lightgbm-embedding-test-evidence.v1"


def _safe_relative_path(value: str) -> bool:
    normalized = value.replace("\\", "/")
    if (
        not normalized
        or normalized.startswith("/")
        or (len(normalized) >= 2 and normalized[1] == ":")
    ):
        return False
    return ".." not in PurePosixPath(normalized).parts


def resolve_output_path(root: Path, relative_path: str) -> Path:
    if not _safe_relative_path(relative_path):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_PATH_INVALID",
        )
    resolved_root = root.resolve(strict=False)
    resolved = (root / Path(relative_path.replace("\\", "/"))).resolve(strict=False)
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_PATH_ESCAPES_OUTPUT_ROOT",
        ) from exc
    return resolved


def deterministic_json_text(value: Any) -> str:
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        ) + "\n"
    except (TypeError, ValueError) as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "JSON_SERIALIZATION_FAILED",
        ) from exc


def atomic_write_bytes(path: Path, content: bytes, *, overwrite: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not overwrite:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "IMMUTABLE_ARTIFACT_ALREADY_EXISTS",
        )
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    if temporary.exists():
        temporary.unlink()
    try:
        with temporary.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists() and not overwrite:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "IMMUTABLE_ARTIFACT_ALREADY_EXISTS",
            )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json_artifact(
    root: Path,
    relative_path: str,
    value: Mapping[str, Any],
    *,
    overwrite: bool = False,
) -> Path:
    scan_aggregate_material(value)
    path = resolve_output_path(root, relative_path)
    atomic_write_bytes(path, deterministic_json_text(value).encode("utf-8"), overwrite=overwrite)
    return path


def read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_JSON_INVALID",
        ) from exc
    if not isinstance(value, dict):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_JSON_OBJECT_REQUIRED",
        )
    return value


def artifact_identity(root: Path, path: Path) -> dict[str, Any]:
    resolved_root = root.resolve(strict=False)
    try:
        resolved_path = path.resolve(strict=True)
    except OSError as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_FILE_INVALID",
        ) from exc
    try:
        relative = resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_OUTSIDE_OUTPUT_ROOT",
        ) from exc
    if not resolved_path.is_file() or resolved_path.stat().st_size <= 0:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_FILE_INVALID",
        )
    return {
        "relativePath": relative.as_posix(),
        "sizeBytes": resolved_path.stat().st_size,
        "sha256": sha256_file(resolved_path),
    }


def verify_artifact_identity(root: Path, identity: Mapping[str, Any]) -> Path:
    if set(identity) != {"relativePath", "sizeBytes", "sha256"}:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_IDENTITY_INVALID",
        )
    relative = identity.get("relativePath")
    size = identity.get("sizeBytes")
    expected_hash = require_bare_sha256(
        identity.get("sha256"),
        reason_code="ARTIFACT_SHA256_INVALID",
    )
    if (
        not isinstance(relative, str)
        or isinstance(size, bool)
        or not isinstance(size, int)
        or size <= 0
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_IDENTITY_INVALID",
        )
    path = resolve_output_path(root, relative)
    if not path.is_file() or path.stat().st_size != size or sha256_file(path) != expected_hash:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "ARTIFACT_INTEGRITY_MISMATCH",
        )
    return path


_FORBIDDEN_KEY_FRAGMENTS = (
    "rawprompt",
    "rawresponse",
    "rawdetectedvalue",
    "rawpromptfragment",
    "instructiontext",
    "payloadtext",
    "normalizedtext",
    "tokenid",
    "embeddingvalues",
    "projectionvector",
    "trainingmatrix",
    "evaluationmatrix",
    "rawlogit",
    "persampleprobability",
    "sampleprobability",
    "samplescore",
    "featurecontribution",
    "treepath",
    "authorizationheader",
    "apikey",
    "apptoken",
    "providerkey",
    "providerrawerror",
    "actualsecret",
)
_SAFE_NEGATIVE_FLAGS = {
    "containsembeddingmatrix",
    "containsperamplescore",  # retained for a historical misspelling guard
    "containspersamplescore",
    "containsindividualscores",
    "containspromptorresponse",
    "containsembeddingorvector",
    "containsmodelparameters",
    "containsperampleresult",
    "containspersampleresult",
}
_SECRET_PATTERNS = (
    re.compile(r"authorization\s*:\s*bearer\s+\S+", re.IGNORECASE),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b"),
)


def _normalized_key(value: str) -> str:
    return "".join(character.lower() for character in value if character.isalnum())


def scan_aggregate_material(value: Any) -> None:
    """Reject sample-level fields and obvious secret material without echoing it."""

    def visit(item: Any) -> None:
        if isinstance(item, Mapping):
            for key, child in item.items():
                normalized = _normalized_key(str(key))
                if normalized in _SAFE_NEGATIVE_FLAGS:
                    if child is not False:
                        raise ExperimentError(
                            ExperimentStatus.INVALID_DATA_SAFETY,
                            "NEGATIVE_DATA_SAFETY_FLAG_NOT_FALSE",
                        )
                    continue
                if any(fragment in normalized for fragment in _FORBIDDEN_KEY_FRAGMENTS):
                    raise ExperimentError(
                        ExperimentStatus.INVALID_DATA_SAFETY,
                        "FORBIDDEN_ARTIFACT_FIELD",
                    )
                visit(child)
        elif isinstance(item, Sequence) and not isinstance(item, (str, bytes, bytearray)):
            for child in item:
                visit(child)
        elif isinstance(item, str):
            if any(pattern.search(item) for pattern in _SECRET_PATTERNS):
                raise ExperimentError(
                    ExperimentStatus.INVALID_DATA_SAFETY,
                    "FORBIDDEN_SECRET_PATTERN",
                )
        elif isinstance(item, float) and not math.isfinite(item):
            raise ExperimentError(
                ExperimentStatus.INVALID_DATA_SAFETY,
                "NON_FINITE_ARTIFACT_VALUE",
            )

    visit(value)


def _rfc3339(value: str) -> str:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TIMESTAMP_INVALID",
        )
    try:
        parsed = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    except ValueError as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TIMESTAMP_INVALID",
        ) from exc
    if parsed.tzinfo is None:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TIMESTAMP_INVALID",
        )
    return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_offline_metadata(
    *,
    experiment_id: str,
    experiment_version: str,
    embedding_dimension: int,
    feature_rows: int,
    encoder_descriptor: Mapping[str, Any],
    selected_parameters: Mapping[str, Any],
    best_iteration: int,
    model_identity: Mapping[str, Any],
    calibrator_type: str,
    calibrator_identity: Mapping[str, Any],
    selected_threshold: float | None,
    selected_c_fn: float | None,
    owner_decision_reference: str | None,
    dataset_identity: Mapping[str, Any],
    candidate_set_sha256: str,
    code_config_sha256: str,
) -> dict[str, Any]:
    if embedding_dimension <= 0 or feature_rows <= 0 or best_iteration <= 0:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "METADATA_SHAPE_INVALID",
        )
    return {
        "schemaVersion": EXPERIMENT_SCHEMA_VERSION,
        "experimentId": experiment_id,
        "experimentVersion": experiment_version,
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "featureShape": f"embedding_only_d{embedding_dimension}",
        "featureMatrixShape": [feature_rows, embedding_dimension],
        "embeddingDimension": embedding_dimension,
        "labelMapping": {"0": "simple", "1": "complex"},
        "encoder": dict(encoder_descriptor),
        "projection": None,
        "lightgbmVersion": "4.6.0",
        "parameters": dict(selected_parameters),
        "bestIteration": best_iteration,
        "model": dict(model_identity),
        "calibrator": {"type": calibrator_type, **dict(calibrator_identity)},
        "threshold": selected_threshold,
        "selectedCFn": selected_c_fn,
        "ownerDecisionReference": owner_decision_reference,
        "dataset": dict(dataset_identity),
        "candidateSetSha256": candidate_set_sha256,
        "codeConfigSha256": code_config_sha256,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }


def prepare_freeze_candidate(
    *,
    experiment_id: str,
    experiment_version: str,
    dataset_identity: Mapping[str, Any],
    encoder_descriptor: Mapping[str, Any],
    embedding_dimension: int,
    candidate_set_sha256: str,
    fold_membership_sha256: str,
    selected_candidate_id: str,
    selected_parameters: Mapping[str, Any],
    best_iteration: int,
    model_identity: Mapping[str, Any],
    calibrator_type: str,
    calibrator_identity: Mapping[str, Any],
    threshold_scenarios: Sequence[Mapping[str, Any]],
    code_config_sha256: str,
    champion_identity: Mapping[str, Any],
    slice_policy: Mapping[str, Any],
) -> dict[str, Any]:
    for value, reason in (
        (candidate_set_sha256, "CANDIDATE_SET_SHA256_INVALID"),
        (fold_membership_sha256, "FOLD_MEMBERSHIP_SHA256_INVALID"),
        (code_config_sha256, "CODE_CONFIG_SHA256_INVALID"),
    ):
        require_bare_sha256(value, reason_code=reason)
    if len(threshold_scenarios) != len(C_FN_SCENARIOS):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "THRESHOLD_SCENARIO_COUNT_INVALID",
        )
    observed_costs = {float(value.get("cFn", -1)) for value in threshold_scenarios}
    if observed_costs != set(C_FN_SCENARIOS):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "THRESHOLD_SCENARIO_SET_INVALID",
        )
    candidate = {
        "schemaVersion": FREEZE_CANDIDATE_SCHEMA,
        "experimentId": experiment_id,
        "experimentVersion": experiment_version,
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "dataset": dict(dataset_identity),
        "encoder": dict(encoder_descriptor),
        "embeddingDimension": embedding_dimension,
        "candidateSetSha256": candidate_set_sha256,
        "foldMembershipSha256": fold_membership_sha256,
        "selectedCandidateId": selected_candidate_id,
        "selectedParameters": dict(selected_parameters),
        "bestIteration": best_iteration,
        "model": dict(model_identity),
        "calibrator": {"type": calibrator_type, **dict(calibrator_identity)},
        "validationThresholdScenarios": [dict(value) for value in threshold_scenarios],
        "codeConfigSha256": code_config_sha256,
        "champion": dict(champion_identity),
        "slicePolicy": dict(slice_policy),
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    scan_aggregate_material(candidate)
    candidate["candidateSha256"] = canonical_sha256(candidate)
    return candidate


def _verify_candidate_hash(candidate: Mapping[str, Any]) -> None:
    if candidate.get("schemaVersion") != FREEZE_CANDIDATE_SCHEMA:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "FREEZE_CANDIDATE_SCHEMA_INVALID",
        )
    material = dict(candidate)
    expected = material.pop("candidateSha256", None)
    if expected != canonical_sha256(material):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "FREEZE_CANDIDATE_HASH_MISMATCH",
        )


def freeze_owner_selection(
    candidate: Mapping[str, Any],
    *,
    selected_c_fn: float,
    selected_threshold: float,
    owner_decision_reference: str,
    owner_decision_timestamp: str,
) -> dict[str, Any]:
    _verify_candidate_hash(candidate)
    if not isinstance(owner_decision_reference, str) or not owner_decision_reference.strip():
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "OWNER_DECISION_REFERENCE_REQUIRED",
        )
    _rfc3339(owner_decision_timestamp)
    if selected_c_fn not in C_FN_SCENARIOS:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "OWNER_C_FN_SELECTION_INVALID",
        )
    scenario = next(
        (
            item
            for item in candidate["validationThresholdScenarios"]
            if float(item.get("cFn", -1)) == selected_c_fn
        ),
        None,
    )
    selected = scenario.get("selected") if isinstance(scenario, Mapping) else None
    if (
        not isinstance(scenario, Mapping)
        or scenario.get("status") != "feasible"
        or not isinstance(selected, Mapping)
        or selected.get("overallSafetyPassed") is not True
        or selected.get("categorySafetyPassed") is not True
        or float(selected.get("complexRecall", -1)) < 0.95
        or float(selected.get("threshold", math.nan)) != float(selected_threshold)
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "OWNER_SELECTION_NOT_IN_VALIDATION_EVIDENCE",
        )
    frozen_candidate = {
        "candidateSha256": candidate["candidateSha256"],
        "selectedCandidateId": candidate["selectedCandidateId"],
        "selectedParameters": dict(candidate["selectedParameters"]),
        "bestIteration": candidate["bestIteration"],
        "embeddingDimension": candidate["embeddingDimension"],
        "model": dict(candidate["model"]),
        "calibrator": dict(candidate["calibrator"]),
        "selectedCFn": float(selected_c_fn),
        "threshold": float(selected_threshold),
    }
    record = {
        "schemaVersion": FREEZE_RECORD_SCHEMA,
        "experimentId": candidate["experimentId"],
        "experimentVersion": candidate["experimentVersion"],
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "candidateIdentity": candidate["candidateSha256"],
        "dataset": dict(candidate["dataset"]),
        "encoder": dict(candidate["encoder"]),
        "candidateSetSha256": candidate["candidateSetSha256"],
        "foldMembershipSha256": candidate["foldMembershipSha256"],
        "codeConfigSha256": candidate["codeConfigSha256"],
        "champion": dict(candidate["champion"]),
        "slicePolicy": dict(candidate["slicePolicy"]),
        "ownerDecision": {
            "reference": owner_decision_reference,
            "timestamp": owner_decision_timestamp,
            "selectedCFn": float(selected_c_fn),
            "selectedThreshold": float(selected_threshold),
        },
        "frozenCandidates": [frozen_candidate],
        "testAccessState": "untouched",
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    scan_aggregate_material(record)
    record["freezeSha256"] = canonical_sha256(record)
    return record


def verify_freeze_record(freeze: Mapping[str, Any], *, artifact_root: Path) -> None:
    if freeze.get("schemaVersion") != FREEZE_RECORD_SCHEMA:
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "PRETEST_FREEZE_MISSING_OR_INVALID",
        )
    material = dict(freeze)
    expected = material.pop("freezeSha256", None)
    if expected != canonical_sha256(material):
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "PRETEST_FREEZE_HASH_MISMATCH",
        )
    candidates = freeze.get("frozenCandidates")
    if not isinstance(candidates, list) or len(candidates) != 1:
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "TEST_CANDIDATE_COUNT_NOT_ONE",
        )
    candidate = candidates[0]
    if not isinstance(candidate, Mapping):
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "FROZEN_CANDIDATE_INVALID",
        )
    model_identity = candidate.get("model")
    calibrator = candidate.get("calibrator")
    if not isinstance(model_identity, Mapping) or not isinstance(calibrator, Mapping):
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "FROZEN_ARTIFACT_IDENTITY_MISSING",
        )
    verify_artifact_identity(artifact_root, model_identity)
    calibrator_identity = {
        key: calibrator.get(key) for key in ("relativePath", "sizeBytes", "sha256")
    }
    verify_artifact_identity(artifact_root, calibrator_identity)
    if freeze.get("testAccessState") != "untouched":
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "PRETEST_FREEZE_ALREADY_CONSUMED",
        )
    scan_aggregate_material(freeze)


def consume_test_access(
    *,
    artifact_root: Path,
    freeze: Mapping[str, Any],
    authorization_reference: str,
    authorization_timestamp: str,
    relative_record_path: str = "test-access-consumed.json",
) -> dict[str, Any]:
    verify_freeze_record(freeze, artifact_root=artifact_root)
    if not isinstance(authorization_reference, str) or not authorization_reference.strip():
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "TEST_EXECUTION_AUTHORIZATION_REQUIRED",
        )
    _rfc3339(authorization_timestamp)
    record = {
        "schemaVersion": TEST_ACCESS_SCHEMA,
        "freezeSha256": freeze["freezeSha256"],
        "authorizationReference": authorization_reference,
        "authorizationTimestamp": authorization_timestamp,
        "accessConsumedAt": utc_now(),
        "state": "consumed_on_test_input_access_start",
        "evaluatedCandidateCount": 1,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    path = resolve_output_path(artifact_root, relative_record_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(deterministic_json_text(record))
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "TEST_ACCESS_ALREADY_CONSUMED",
        ) from exc
    return record


@dataclass(frozen=True)
class TestEvaluationInput:
    matrix: np.ndarray
    labels: np.ndarray
    family_ids: Sequence[str]
    categories: Sequence[str]
    record_ids: Sequence[str]
    slice_membership: Sequence[Sequence[str]]
    champion_prediction: np.ndarray
    source_sha256: str


def evaluate_frozen_test_once(
    *,
    artifact_root: Path,
    freeze: Mapping[str, Any],
    authorization_reference: str,
    authorization_timestamp: str,
    test_loader: Callable[[], TestEvaluationInput],
    bootstrap_repeats: int = 1000,
    access_record_relative_path: str = "test-access-consumed.json",
) -> dict[str, Any]:
    access = consume_test_access(
        artifact_root=artifact_root,
        freeze=freeze,
        authorization_reference=authorization_reference,
        authorization_timestamp=authorization_timestamp,
        relative_record_path=access_record_relative_path,
    )
    # The loader is invoked only after the exclusive access record is durable.
    test = test_loader()
    candidate = freeze["frozenCandidates"][0]
    dimension = int(candidate["embeddingDimension"])
    matrix = np.asarray(test.matrix)
    labels = np.asarray(test.labels, dtype=np.int8)
    if (
        matrix.dtype != np.float32
        or matrix.ndim != 2
        or matrix.shape != (len(labels), dimension)
        or not np.all(np.isfinite(matrix))
    ):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "TEST_FEATURE_SHAPE_INVALID",
        )
    expected_test_sha = freeze.get("dataset", {}).get("testDataSha256")
    require_bare_sha256(test.source_sha256, reason_code="TEST_DATA_SHA256_INVALID")
    if expected_test_sha != test.source_sha256:
        raise ExperimentError(
            ExperimentStatus.INVALID_TEST_CONTAMINATION,
            "TEST_DATA_IDENTITY_MISMATCH",
        )
    if any(
        len(values) != len(labels)
        for values in (
            test.family_ids,
            test.categories,
            test.record_ids,
            test.slice_membership,
            test.champion_prediction,
        )
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TEST_ROW_ALIGNMENT_MISMATCH",
        )
    lgb = require_official_lightgbm()
    model_path = verify_artifact_identity(artifact_root, candidate["model"])
    booster = lgb.Booster(model_file=str(model_path))
    if int(booster.num_feature()) != dimension:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "TEST_MODEL_FEATURE_COUNT_MISMATCH",
        )
    raw = np.asarray(
        booster.predict(matrix, num_iteration=int(candidate["bestIteration"])),
        dtype=np.float64,
    )
    calibrator = candidate["calibrator"]
    calibrator_path = verify_artifact_identity(
        artifact_root,
        {key: calibrator[key] for key in ("relativePath", "sizeBytes", "sha256")},
    )
    calibrated = apply_calibrator(read_json_object(calibrator_path), raw)
    threshold = float(candidate["threshold"])
    overall = classification_metrics(
        labels=labels,
        probability=calibrated,
        threshold=threshold,
    )
    slices = aggregate_category_and_slice_metrics(
        labels=labels,
        probability=calibrated,
        threshold=threshold,
        family_ids=test.family_ids,
        categories=test.categories,
        slice_membership=test.slice_membership,
        champion_prediction=test.champion_prediction,
    )
    candidate_fn = int(overall["falseNegative"])
    champion_fn = int(
        np.sum((labels == 1) & (np.asarray(test.champion_prediction, dtype=np.int8) == 0))
    )
    category_safety = {
        category: slices["categories"][category]["safetyPassed"]
        for category in slices["categories"]
    }
    safety = {
        "overall": {
            "candidateFalseNegative": candidate_fn,
            "championFalseNegative": champion_fn,
            "passed": candidate_fn <= champion_fn,
        },
        "categories": category_safety,
        "allCategoriesPassed": all(value is True for value in category_safety.values()),
        "minimumComplexRecallPassed": float(overall["complex"]["recall"]) >= 0.95,
    }
    uncertainty = family_group_metric_bootstrap(
        labels=labels,
        probability=calibrated,
        threshold=threshold,
        family_ids=test.family_ids,
        repeats=bootstrap_repeats,
    )
    evidence = {
        "schemaVersion": TEST_EVIDENCE_SCHEMA,
        "freezeSha256": freeze["freezeSha256"],
        "testAccess": {
            "recordSha256": canonical_sha256(access),
            "state": access["state"],
            "evaluatedCandidateCount": 1,
        },
        "frozenSelection": {
            "candidateId": candidate["selectedCandidateId"],
            "calibratorType": candidate["calibrator"]["type"],
            "selectedCFn": candidate["selectedCFn"],
            "threshold": threshold,
            "embeddingDimension": dimension,
            "thresholdReselectedOnTest": False,
        },
        "overall": overall,
        "safety": safety,
        "categoryAndSlice": slices,
        "familyGroupBootstrap": uncertainty,
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "containsEmbeddingMatrix": False,
        "containsPerSampleScore": False,
    }
    scan_aggregate_material(evidence)
    evidence["evidenceSha256"] = canonical_sha256(evidence)
    return evidence
