"""Offline-only LightGBM candidate training for the isolated 768D profile.

All prompt-derived matrices remain in memory. This module writes only the
selected LightGBM model, optional train-only PCA parameters, an immutable
runtime profile, and aggregate evaluation evidence.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

import numpy as np
from sklearn.decomposition import PCA

from .semantic_features import (
    RULE_VECTOR_V1_DIMENSION,
    RULE_VECTOR_V1_FEATURE_NAMES,
    RULE_VECTOR_V1_VERSION,
)


PROFILE_SCHEMA = "gatelm.routing-difficulty-lightgbm-shadow-profile.v1"
PROFILE_VERSION = "difficulty-lightgbm-shadow.e5-base-768.v1"
CONTRACT_VERSION = "gatelm.internal.routing-difficulty-lightgbm-shadow.v1"
MODEL_ID = "intfloat/multilingual-e5-base"
MODEL_SOURCE_REVISION = "d13f1b27baf31030b7fd040960d60d909913633f"
NATIVE_DIMENSION = 768
CANDIDATES = ("tabular_only", "raw_768", "pca_128", "pca_256")
SEMANTIC_RUNTIME_CANDIDATES = frozenset({"raw_768", "pca_128", "pca_256"})
SPLITS = ("train", "validation", "test")
TRAINING_SEED = 20260721
ENCODER_ARTIFACT_ROLES = frozenset(
    {
        "model_config",
        "sentence_transformer_config",
        "pooling_config",
        "special_tokens",
        "tokenizer_json",
        "tokenizer_config",
        "tokenizer_model",
        "encoder_onnx_dynamic_qint8",
    }
)


@dataclass(frozen=True)
class CandidateMetrics:
    candidate: str
    dimension: int
    threshold: float
    accuracy: float
    complex_to_simple: int
    simple_to_complex: int
    log_loss: float
    brier_score: float


@dataclass(frozen=True)
class LightGBMShadowTrainingResult:
    selected_candidate: str
    profile_manifest_path: Path
    profile_manifest_sha256: str
    aggregate_report_path: Path
    validation_metrics: tuple[CandidateMetrics, ...]
    test_metrics: CandidateMetrics


def require_training_eligible_dataset_manifest(
    manifest: Mapping[str, Any],
) -> None:
    scope = manifest.get("scope")
    review = manifest.get("review")
    counts = manifest.get("counts")
    if (
        not isinstance(scope, Mapping)
        or not isinstance(review, Mapping)
        or not isinstance(counts, Mapping)
    ):
        raise ValueError("difficulty dataset manifest is missing scope, review, or counts")
    if scope.get("training_eligible") is not True:
        raise ValueError("difficulty dataset is not training eligible")
    if review.get("production_gold") is not True:
        raise ValueError("difficulty dataset is not approved production gold")
    if (
        review.get("human_reviewed") is not True
        or review.get("review_status") != "approved"
    ):
        raise ValueError("difficulty dataset review is not approved")
    human_reviewed_records = counts.get("human_reviewed_records")
    if (
        not isinstance(human_reviewed_records, int)
        or isinstance(human_reviewed_records, bool)
        or human_reviewed_records <= 0
    ):
        raise ValueError("difficulty dataset has no human-reviewed records")


def train_lightgbm_shadow_candidates(
    *,
    rule_vectors: Any,
    pooled_embeddings: Any,
    labels: Sequence[str | int],
    splits: Sequence[str],
    family_ids: Sequence[str],
    encoder_descriptor: Mapping[str, Any],
    dataset_manifest: Mapping[str, Any],
    dataset_provenance: Mapping[str, Any],
    output_directory: Path,
    model_version: str,
) -> LightGBMShadowTrainingResult:
    """Train fixed candidates and freeze one semantic runtime candidate.

    The caller must construct rule vectors and pooled 768D embeddings in the
    same process. No input/output path for those matrices is intentionally
    provided.
    """

    require_training_eligible_dataset_manifest(dataset_manifest)
    _validate_dataset_provenance(dataset_provenance, dataset_manifest)
    if not _valid_model_version(model_version):
        raise ValueError("LightGBM model version is invalid")
    _validate_encoder_descriptor(encoder_descriptor, output_directory)
    rules, pooled, y, split_values, families = _validated_training_inputs(
        rule_vectors,
        pooled_embeddings,
        labels,
        splits,
        family_ids,
    )

    import lightgbm as lgb

    indices = {
        split: np.flatnonzero(split_values == split)
        for split in SPLITS
    }
    if any(indices[split].size == 0 for split in SPLITS):
        raise ValueError("train, validation, and test splits must be non-empty")
    if any(set(y[indices[split]].tolist()) != {0, 1} for split in SPLITS):
        raise ValueError("every dataset split must contain simple and complex labels")
    _validate_family_disjoint(families, split_values)

    pca_by_candidate: dict[str, PCA] = {}
    matrices: dict[str, np.ndarray] = {
        "tabular_only": rules,
        "raw_768": np.concatenate((rules, pooled), axis=1),
    }
    for projection_dimension in (128, 256):
        if indices["train"].size < projection_dimension:
            raise ValueError(
                f"train split requires at least {projection_dimension} records for PCA"
            )
        pca = PCA(
            n_components=projection_dimension,
            svd_solver="full",
            whiten=False,
        )
        pca.fit(pooled[indices["train"]])
        projected = np.asarray(pca.transform(pooled), dtype=np.float32)
        norms = np.linalg.norm(projected, axis=1, keepdims=True)
        if not np.all(np.isfinite(norms)) or np.any(norms <= 1e-12):
            raise ValueError("LightGBM PCA projection contains a degenerate row")
        projected = np.asarray(projected / norms, dtype=np.float32)
        candidate = f"pca_{projection_dimension}"
        pca_by_candidate[candidate] = pca
        matrices[candidate] = np.concatenate((rules, projected), axis=1)

    boosters: dict[str, Any] = {}
    validation_metrics: list[CandidateMetrics] = []
    for candidate in CANDIDATES:
        matrix = matrices[candidate]
        booster = lgb.train(
            _lightgbm_parameters(),
            lgb.Dataset(
                matrix[indices["train"]],
                label=y[indices["train"]],
                free_raw_data=False,
            ),
            num_boost_round=300,
            valid_sets=[
                lgb.Dataset(
                    matrix[indices["validation"]],
                    label=y[indices["validation"]],
                    reference=None,
                    free_raw_data=False,
                )
            ],
            callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(0)],
        )
        scores = np.asarray(
            booster.predict(
                matrix[indices["validation"]],
                num_iteration=booster.best_iteration,
            ),
            dtype=np.float64,
        )
        threshold = _select_threshold(y[indices["validation"]], scores)
        validation_metrics.append(
            _metrics(candidate, matrix.shape[1], y[indices["validation"]], scores, threshold)
        )
        boosters[candidate] = booster

    selected = min(
        (
            value
            for value in validation_metrics
            if value.candidate in SEMANTIC_RUNTIME_CANDIDATES
        ),
        key=lambda value: (
            -value.accuracy,
            value.complex_to_simple,
            value.log_loss,
            value.dimension,
            value.candidate,
        ),
    )
    selected_matrix = matrices[selected.candidate]
    selected_booster = boosters[selected.candidate]
    test_scores = np.asarray(
        selected_booster.predict(
            selected_matrix[indices["test"]],
            num_iteration=selected_booster.best_iteration,
        ),
        dtype=np.float64,
    )
    test_metrics = _metrics(
        selected.candidate,
        selected.dimension,
        y[indices["test"]],
        test_scores,
        selected.threshold,
    )

    output_directory.mkdir(parents=True, exist_ok=True)
    model_path = output_directory / "difficulty-lightgbm-shadow-model.v1.txt"
    selected_booster.save_model(
        str(model_path),
        num_iteration=selected_booster.best_iteration,
    )
    model_sha = _sha256_file(model_path)
    projection_descriptor: dict[str, Any] | None = None
    semantic_mode = "raw"
    semantic_dimension = NATIVE_DIMENSION
    if selected.candidate.startswith("pca_"):
        semantic_mode = "pca"
        semantic_dimension = int(selected.candidate.removeprefix("pca_"))
        pca = pca_by_candidate[selected.candidate]
        projection_path = output_directory / (
            f"difficulty-lightgbm-shadow-pca-{semantic_dimension}.v1.npz"
        )
        np.savez(
            projection_path,
            mean=np.asarray(pca.mean_, dtype=np.float32),
            components=np.asarray(pca.components_, dtype=np.float32),
        )
        projection_descriptor = {
            "kind": "sklearn_pca_full_svd",
            "relativePath": projection_path.name,
            "sizeBytes": projection_path.stat().st_size,
            "sha256": _sha256_file(projection_path),
            "inputDimension": NATIVE_DIMENSION,
            "outputDimension": semantic_dimension,
            "fitSplit": "train",
            "fitRecordCount": int(indices["train"].size),
            "l2Normalize": True,
            "l2Epsilon": 1e-12,
        }

    total_dimension = RULE_VECTOR_V1_DIMENSION + semantic_dimension
    manifest = {
        "schemaVersion": PROFILE_SCHEMA,
        "profileVersion": PROFILE_VERSION,
        "contractVersion": CONTRACT_VERSION,
        "promotionState": "offline_shadow_only",
        "executionShape": {
            "unit": "single_request",
            "batchSize": 1,
            "paddingScope": "within_request_only",
        },
        "encoder": dict(encoder_descriptor),
        "featureShape": {
            "ruleVectorVersion": RULE_VECTOR_V1_VERSION,
            "ruleDimension": RULE_VECTOR_V1_DIMENSION,
            "tabularFeatureNames": [
                f"ruleVectorV1.{name}" for name in RULE_VECTOR_V1_FEATURE_NAMES
            ],
            "semanticMode": semantic_mode,
            "semanticDimension": semantic_dimension,
            "totalDimension": total_dimension,
            "projection": projection_descriptor,
        },
        "model": {
            "version": model_version,
            "contentHash": f"sha256:{model_sha}",
            "format": "lightgbm_text",
            "objective": "binary",
            "relativePath": model_path.name,
            "sizeBytes": model_path.stat().st_size,
            "sha256": model_sha,
            "numFeatures": total_dimension,
            "threshold": selected.threshold,
            "parameters": _lightgbm_parameters(),
        },
        "trainingProvenance": {
            **dict(dataset_provenance),
            "seed": TRAINING_SEED,
            "splitCounts": {
                split: int(indices[split].size) for split in SPLITS
            },
            "familyDisjoint": True,
            "selectedFrom": list(CANDIDATES),
            "selectionSplit": "validation",
            "testAccess": "after_selection_freeze",
        },
    }
    profile_path = output_directory / "difficulty-lightgbm-shadow-profile.v1.json"
    _write_json(profile_path, manifest)

    report = {
        "schemaVersion": "gatelm.routing-difficulty-lightgbm-shadow-evaluation.v1",
        "profileVersion": PROFILE_VERSION,
        "promotionState": "offline_shadow_only",
        "selectedCandidate": selected.candidate,
        "validation": [_metrics_json(value) for value in validation_metrics],
        "test": _metrics_json(test_metrics),
        "profileManifestSha256": _sha256_file(profile_path),
        "containsPerSampleMaterial": False,
    }
    report_path = output_directory / "difficulty-lightgbm-shadow-evaluation.v1.json"
    _write_json(report_path, report)
    return LightGBMShadowTrainingResult(
        selected_candidate=selected.candidate,
        profile_manifest_path=profile_path,
        profile_manifest_sha256=_sha256_file(profile_path),
        aggregate_report_path=report_path,
        validation_metrics=tuple(validation_metrics),
        test_metrics=test_metrics,
    )


def _validated_training_inputs(
    rule_vectors: Any,
    pooled_embeddings: Any,
    labels: Sequence[str | int],
    splits: Sequence[str],
    family_ids: Sequence[str],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    rules = np.asarray(rule_vectors, dtype=np.float64)
    pooled = np.asarray(pooled_embeddings, dtype=np.float32)
    count = len(labels)
    if rules.shape != (count, RULE_VECTOR_V1_DIMENSION):
        raise ValueError("rule vectors must have exact shape [records,42]")
    if pooled.shape != (count, NATIVE_DIMENSION):
        raise ValueError("pooled embeddings must have exact shape [records,768]")
    if not np.all(np.isfinite(rules)) or not np.all(np.isfinite(pooled)):
        raise ValueError("training matrices must contain only finite values")
    if np.any(rules < 0) or np.any(rules > 1):
        raise ValueError("rule vector values must remain within [0,1]")
    if len(splits) != count or len(family_ids) != count:
        raise ValueError("labels, splits, and family IDs must align")
    y = np.asarray(
        [1 if value in (1, "complex") else 0 if value in (0, "simple") else -1 for value in labels],
        dtype=np.int8,
    )
    if np.any(y < 0):
        raise ValueError("labels must be simple/complex or 0/1")
    split_values = np.asarray([str(value) for value in splits], dtype=object)
    if any(value not in SPLITS for value in split_values):
        raise ValueError("unsupported dataset split")
    families = np.asarray([str(value).strip() for value in family_ids], dtype=object)
    if any(not value for value in families):
        raise ValueError("family IDs must not be empty")
    return rules, pooled, y, split_values, families


def _validate_family_disjoint(families: np.ndarray, splits: np.ndarray) -> None:
    family_splits: dict[str, set[str]] = {}
    for family, split in zip(families, splits, strict=True):
        family_splits.setdefault(str(family), set()).add(str(split))
    if any(len(values) != 1 for values in family_splits.values()):
        raise ValueError("prompt family crosses dataset splits")


def _validate_encoder_descriptor(
    descriptor: Mapping[str, Any],
    artifact_root: Path,
) -> None:
    expected_keys = {
        "modelId",
        "sourceRevision",
        "artifactDirectory",
        "runtimeArtifacts",
        "inputPrefix",
        "maximumTokenLength",
        "outputDimension",
        "pooling",
    }
    runtime_artifacts = descriptor.get("runtimeArtifacts")
    if (
        set(descriptor) != expected_keys
        or descriptor.get("modelId") != MODEL_ID
        or descriptor.get("sourceRevision") != MODEL_SOURCE_REVISION
        or descriptor.get("outputDimension") != NATIVE_DIMENSION
        or descriptor.get("pooling")
        != "attention_mask_weighted_mean_excluding_padding"
        or descriptor.get("inputPrefix") != "query: "
        or not isinstance(descriptor.get("artifactDirectory"), str)
        or not _safe_relative_path(str(descriptor.get("artifactDirectory", "")))
        or not isinstance(descriptor.get("maximumTokenLength"), int)
        or isinstance(descriptor.get("maximumTokenLength"), bool)
        or not 1 <= int(descriptor["maximumTokenLength"]) <= 512
        or not isinstance(runtime_artifacts, list)
        or len(runtime_artifacts) != len(ENCODER_ARTIFACT_ROLES)
    ):
        raise ValueError("encoder descriptor is not the pinned 768D profile")
    seen_roles: set[str] = set()
    for entry in runtime_artifacts:
        if (
            not isinstance(entry, Mapping)
            or set(entry) != {"role", "relativePath", "sizeBytes", "sha256"}
            or entry.get("role") not in ENCODER_ARTIFACT_ROLES
            or entry.get("role") in seen_roles
            or not _safe_relative_path(str(entry.get("relativePath", "")))
            or not isinstance(entry.get("sizeBytes"), int)
            or isinstance(entry.get("sizeBytes"), bool)
            or not 1 <= int(entry["sizeBytes"]) <= 2 * 1024 * 1024 * 1024
            or not _valid_bare_sha256(str(entry.get("sha256", "")))
        ):
            raise ValueError("encoder runtime artifact descriptor is invalid")
        seen_roles.add(str(entry["role"]))
    if seen_roles != ENCODER_ARTIFACT_ROLES:
        raise ValueError("encoder runtime artifacts are incomplete")
    encoder_root = _resolved_bundle_path(
        artifact_root,
        str(descriptor["artifactDirectory"]),
    )
    for entry in runtime_artifacts:
        artifact_path = _resolved_bundle_path(
            encoder_root,
            str(entry["relativePath"]),
        )
        if (
            not artifact_path.is_file()
            or artifact_path.stat().st_size != int(entry["sizeBytes"])
            or _sha256_file(artifact_path) != entry["sha256"]
        ):
            raise ValueError("encoder runtime artifact integrity mismatch")


def _validate_dataset_provenance(
    provenance: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> None:
    required = ("datasetVersion", "datasetSha256", "splitPolicyVersion")
    if set(provenance) != set(required) or any(
        not isinstance(provenance.get(key), str) or not provenance.get(key)
        for key in required
    ):
        raise ValueError("dataset provenance is incomplete")
    dataset_sha = str(provenance["datasetSha256"])
    if not (
        dataset_sha.startswith("sha256:")
        and len(dataset_sha) == 71
        and all(character in "0123456789abcdef" for character in dataset_sha[7:])
    ):
        raise ValueError("dataset provenance hash must be prefixed SHA-256")
    if (
        provenance["datasetVersion"] != manifest.get("dataset_version")
        or provenance["datasetSha256"]
        != f"sha256:{manifest.get('dataset_sha256', '')}"
    ):
        raise ValueError("dataset provenance does not match approved manifest")


def _lightgbm_parameters() -> dict[str, Any]:
    return {
        "objective": "binary",
        "metric": "binary_logloss",
        "learning_rate": 0.05,
        "num_leaves": 31,
        "min_data_in_leaf": 20,
        "feature_fraction": 1.0,
        "bagging_fraction": 1.0,
        "bagging_freq": 0,
        "seed": TRAINING_SEED,
        "feature_fraction_seed": TRAINING_SEED,
        "bagging_seed": TRAINING_SEED,
        "data_random_seed": TRAINING_SEED,
        "deterministic": True,
        "force_col_wise": True,
        "num_threads": 1,
        "verbosity": -1,
    }


def _select_threshold(labels: np.ndarray, scores: np.ndarray) -> float:
    if scores.shape != labels.shape or not np.all(np.isfinite(scores)):
        raise ValueError("validation scores are invalid")
    candidates = [round(value / 100, 2) for value in range(1, 100)]
    return min(
        candidates,
        key=lambda threshold: (
            -float(np.mean((scores >= threshold) == labels)),
            _directional_counts(labels, scores >= threshold)[0],
            abs(threshold - 0.5),
            threshold,
        ),
    )


def _metrics(
    candidate: str,
    dimension: int,
    labels: np.ndarray,
    scores: np.ndarray,
    threshold: float,
) -> CandidateMetrics:
    clipped = np.clip(scores, 1e-12, 1 - 1e-12)
    predictions = scores >= threshold
    complex_to_simple, simple_to_complex = _directional_counts(labels, predictions)
    return CandidateMetrics(
        candidate=candidate,
        dimension=dimension,
        threshold=threshold,
        accuracy=float(np.mean(predictions == labels)),
        complex_to_simple=complex_to_simple,
        simple_to_complex=simple_to_complex,
        log_loss=float(
            -np.mean(labels * np.log(clipped) + (1 - labels) * np.log(1 - clipped))
        ),
        brier_score=float(np.mean((scores - labels) ** 2)),
    )


def _directional_counts(labels: np.ndarray, predictions: np.ndarray) -> tuple[int, int]:
    return (
        int(np.sum((labels == 1) & (predictions == 0))),
        int(np.sum((labels == 0) & (predictions == 1))),
    )


def _metrics_json(value: CandidateMetrics) -> dict[str, Any]:
    return {
        "candidate": value.candidate,
        "dimension": value.dimension,
        "threshold": value.threshold,
        "accuracy": round(value.accuracy, 8),
        "complexToSimple": value.complex_to_simple,
        "simpleToComplex": value.simple_to_complex,
        "logLoss": round(value.log_loss, 8),
        "brierScore": round(value.brier_score, 8),
    }


def _valid_model_version(value: str) -> bool:
    if not value or len(value) > 160 or not value[0].isalnum():
        return False
    return all(character.islower() or character.isdigit() or character in "._-" for character in value)


def _valid_bare_sha256(value: str) -> bool:
    return len(value) == 64 and all(
        character in "0123456789abcdef" for character in value
    )


def _safe_relative_path(value: str) -> bool:
    normalized = value.replace("\\", "/")
    if (
        not normalized
        or normalized.startswith("/")
        or (len(normalized) >= 2 and normalized[1] == ":")
    ):
        return False
    return ".." not in PurePosixPath(normalized).parts


def _resolved_bundle_path(root: Path, relative: str) -> Path:
    if not _safe_relative_path(relative):
        raise ValueError("artifact path is invalid")
    resolved_root = root.resolve(strict=False)
    resolved_path = (root / Path(relative.replace("\\", "/"))).resolve(strict=False)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("artifact path escapes bundle root") from exc
    return resolved_path


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
