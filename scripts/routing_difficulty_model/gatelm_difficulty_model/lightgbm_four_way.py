"""Four-way LightGBM feature comparison with process-local semantic material."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from .semantic_features import RULE_VECTOR_V1_DIMENSION, SEMANTIC_HEAD_SPECS_V1


EXPERIMENT_SCHEMA = "gatelm.routing-difficulty-lightgbm-four-way.v1"
EXPERIMENT_VERSION = "difficulty-lightgbm-four-way.owner-approved-15000.2026-07-22.v1"
TRAINING_SEED = 20260721
CANDIDATE_DIMENSIONS = {
    "rule_42_plus_e5_small_pca_64": 106,
    "rule_42_plus_semantic_heads_12": 54,
    "e5_base_raw_768": 768,
    "rule_42_plus_e5_base_raw_768": 810,
}
SPLIT_ALIASES = {
    "train": "train",
    "calibration": "validation",
    "validation": "validation",
    "holdout": "test",
    "test": "test",
}


@dataclass(frozen=True)
class CandidateResult:
    candidate: str
    dimension: int
    threshold: float
    best_iteration: int
    validation_accuracy: float
    validation_complex_to_simple: int
    validation_log_loss: float
    test_accuracy: float
    test_complex_to_simple: int
    test_log_loss: float
    model_path: Path
    model_sha256: str


def flatten_semantic_heads(probabilities: Mapping[str, Any]) -> np.ndarray:
    expected = {spec.name for spec in SEMANTIC_HEAD_SPECS_V1}
    if set(probabilities) != expected:
        raise ValueError("semantic head probability keys are invalid")
    matrices: list[np.ndarray] = []
    sample_count: int | None = None
    for spec in SEMANTIC_HEAD_SPECS_V1:
        matrix = np.asarray(probabilities[spec.name], dtype=np.float32)
        if matrix.ndim != 2 or matrix.shape[1] != len(spec.classes):
            raise ValueError("semantic head probability shape is invalid")
        if sample_count is None:
            sample_count = matrix.shape[0]
        if matrix.shape[0] != sample_count or not np.all(np.isfinite(matrix)):
            raise ValueError("semantic head probability rows are invalid")
        if np.any(matrix < 0) or np.any(matrix > 1):
            raise ValueError("semantic head probabilities must stay within [0,1]")
        if not np.allclose(matrix.sum(axis=1), 1.0, atol=1e-6, rtol=0):
            raise ValueError("semantic head probabilities must sum to one")
        matrices.append(matrix)
    flattened = np.ascontiguousarray(np.concatenate(matrices, axis=1), dtype=np.float32)
    if flattened.shape != (sample_count, 12):
        raise ValueError("semantic head probability matrix must be exact [records,12]")
    return flattened


def build_four_way_matrices(
    *,
    rule_vectors: Any,
    e5_small_pca_64: Any,
    semantic_head_probabilities: Mapping[str, Any] | Any,
    e5_base_raw_768: Any,
) -> dict[str, np.ndarray]:
    rules = np.asarray(rule_vectors, dtype=np.float32)
    pca = np.asarray(e5_small_pca_64, dtype=np.float32)
    base = np.asarray(e5_base_raw_768, dtype=np.float32)
    heads = (
        flatten_semantic_heads(semantic_head_probabilities)
        if isinstance(semantic_head_probabilities, Mapping)
        else np.asarray(semantic_head_probabilities, dtype=np.float32)
    )
    if rules.ndim != 2 or rules.shape[1] != RULE_VECTOR_V1_DIMENSION:
        raise ValueError("rule vectors must have exact shape [records,42]")
    count = rules.shape[0]
    expected_shapes = {
        "E5-small PCA": (count, 64),
        "semantic heads": (count, 12),
        "E5-base": (count, 768),
    }
    for name, matrix, shape in (
        ("E5-small PCA", pca, expected_shapes["E5-small PCA"]),
        ("semantic heads", heads, expected_shapes["semantic heads"]),
        ("E5-base", base, expected_shapes["E5-base"]),
    ):
        if matrix.shape != shape or not np.all(np.isfinite(matrix)):
            raise ValueError(f"{name} matrix shape or values are invalid")
    if not np.all(np.isfinite(rules)) or np.any(rules < 0) or np.any(rules > 1):
        raise ValueError("rule vector values must be finite and within [0,1]")
    matrices = {
        "rule_42_plus_e5_small_pca_64": np.concatenate((rules, pca), axis=1),
        "rule_42_plus_semantic_heads_12": np.concatenate((rules, heads), axis=1),
        "e5_base_raw_768": base,
        "rule_42_plus_e5_base_raw_768": np.concatenate((rules, base), axis=1),
    }
    for candidate, dimension in CANDIDATE_DIMENSIONS.items():
        matrix = np.ascontiguousarray(matrices[candidate], dtype=np.float32)
        if matrix.shape != (count, dimension):
            raise ValueError(f"{candidate} feature shape is invalid")
        matrices[candidate] = matrix
    return matrices


def train_four_way_candidates(
    *,
    matrices: Mapping[str, Any],
    labels: Sequence[str | int],
    splits: Sequence[str],
    family_ids: Sequence[str],
    output_directory: Path,
    dataset_provenance: Mapping[str, Any],
    encoder_provenance: Mapping[str, Any],
) -> tuple[CandidateResult, ...]:
    import lightgbm as lgb

    if set(matrices) != set(CANDIDATE_DIMENSIONS):
        raise ValueError("four-way candidate set is incomplete")
    count = len(labels)
    y = np.asarray(
        [1 if value in (1, "complex") else 0 if value in (0, "simple") else -1 for value in labels],
        dtype=np.int8,
    )
    if y.shape != (count,) or np.any(y < 0):
        raise ValueError("labels must be simple/complex or 0/1")
    normalized_splits = np.asarray(
        [SPLIT_ALIASES.get(str(value), "") for value in splits], dtype=object
    )
    families = np.asarray([str(value).strip() for value in family_ids], dtype=object)
    if normalized_splits.shape != (count,) or set(normalized_splits.tolist()) != {
        "train",
        "validation",
        "test",
    }:
        raise ValueError("train/validation/test splits are required")
    if families.shape != (count,) or any(not value for value in families):
        raise ValueError("family IDs must align and be non-empty")
    family_splits: dict[str, set[str]] = {}
    for family, split in zip(families, normalized_splits, strict=True):
        family_splits.setdefault(str(family), set()).add(str(split))
    if any(len(values) != 1 for values in family_splits.values()):
        raise ValueError("prompt family crosses dataset splits")
    indices = {
        split: np.flatnonzero(normalized_splits == split)
        for split in ("train", "validation", "test")
    }
    if any(set(y[index].tolist()) != {0, 1} for index in indices.values()):
        raise ValueError("every split must contain both classes")

    output_directory.mkdir(parents=True, exist_ok=True)
    results: list[CandidateResult] = []
    for candidate, dimension in CANDIDATE_DIMENSIONS.items():
        matrix = np.asarray(matrices[candidate], dtype=np.float32)
        if matrix.shape != (count, dimension) or not np.all(np.isfinite(matrix)):
            raise ValueError(f"{candidate} matrix is invalid")
        train_set = lgb.Dataset(
            matrix[indices["train"]],
            label=y[indices["train"]],
            free_raw_data=False,
        )
        validation_set = lgb.Dataset(
            matrix[indices["validation"]],
            label=y[indices["validation"]],
            reference=train_set,
            free_raw_data=False,
        )
        booster = lgb.train(
            _parameters(),
            train_set,
            num_boost_round=500,
            valid_sets=[validation_set],
            callbacks=[lgb.early_stopping(40, verbose=False), lgb.log_evaluation(0)],
        )
        validation_scores = _scores(
            booster, matrix[indices["validation"]], booster.best_iteration
        )
        threshold = _select_threshold(y[indices["validation"]], validation_scores)
        test_scores = _scores(booster, matrix[indices["test"]], booster.best_iteration)
        validation_metrics = _metrics(
            y[indices["validation"]], validation_scores, threshold
        )
        test_metrics = _metrics(y[indices["test"]], test_scores, threshold)
        model_path = output_directory / f"{candidate}.lightgbm.txt"
        booster.save_model(str(model_path), num_iteration=booster.best_iteration)
        results.append(
            CandidateResult(
                candidate=candidate,
                dimension=dimension,
                threshold=threshold,
                best_iteration=int(booster.best_iteration),
                validation_accuracy=validation_metrics["accuracy"],
                validation_complex_to_simple=validation_metrics["complexToSimple"],
                validation_log_loss=validation_metrics["logLoss"],
                test_accuracy=test_metrics["accuracy"],
                test_complex_to_simple=test_metrics["complexToSimple"],
                test_log_loss=test_metrics["logLoss"],
                model_path=model_path,
                model_sha256=_sha256_file(model_path),
            )
        )
    _write_report(
        output_directory=output_directory,
        results=results,
        split_counts={key: int(value.size) for key, value in indices.items()},
        dataset_provenance=dataset_provenance,
        encoder_provenance=encoder_provenance,
    )
    return tuple(results)


def write_runtime_profiles(
    *,
    output_directory: Path,
    results: Sequence[CandidateResult],
    e5_base_encoder_descriptor: Mapping[str, Any],
    e5_small_encoder_manifest: Mapping[str, Any],
    e5_small_encoder_manifest_path: Path,
    e5_small_projection_path: Path,
    semantic_heads_artifact: Mapping[str, Any],
    semantic_heads_artifact_path: Path,
    dataset_provenance: Mapping[str, Any],
    split_counts: Mapping[str, int],
) -> tuple[Path, ...]:
    profiles: list[Path] = []
    by_candidate = {result.candidate: result for result in results}
    selected_from = list(CANDIDATE_DIMENSIONS)
    projection = e5_small_encoder_manifest.get("projection")
    preprocessing = e5_small_encoder_manifest.get("preprocessing")
    pooling = e5_small_encoder_manifest.get("pooling")
    if (
        not isinstance(projection, Mapping)
        or not isinstance(preprocessing, Mapping)
        or not isinstance(pooling, Mapping)
    ):
        raise ValueError("E5-small manifest is missing runtime pipeline material")
    if projection.get("fileSha256") != _sha256_file(e5_small_projection_path):
        raise ValueError("E5-small PCA file hash does not match its manifest")
    if semantic_heads_artifact.get("artifactContentHash") is None:
        raise ValueError("semantic-head artifact content identity is missing")

    e5_small_encoder_descriptor = {
        "modelId": e5_small_encoder_manifest["modelId"],
        "sourceRevision": e5_small_encoder_manifest["sourceRevision"],
        "bundleVersion": e5_small_encoder_manifest["bundleVersion"],
        "bundleSha256": e5_small_encoder_manifest["bundleSha256"],
        "manifest": {
            "relativePath": e5_small_encoder_manifest_path.name,
            "sizeBytes": e5_small_encoder_manifest_path.stat().st_size,
            "sha256": _sha256_file(e5_small_encoder_manifest_path),
        },
        "artifactDirectory": e5_small_encoder_manifest["artifactDirectory"],
        "runtimeArtifacts": e5_small_encoder_manifest["runtimeArtifacts"],
        "inputPrefix": preprocessing["inputPrefix"],
        "maximumTokenLength": preprocessing["maximumTokenLength"],
        "outputDimension": e5_small_encoder_manifest["encoder"]["outputDimension"],
        "pooling": pooling["rule"],
        "poolingVersion": pooling["version"],
    }
    projection_descriptor = {
        "kind": projection["kind"],
        "version": projection["version"],
        "relativePath": e5_small_projection_path.name,
        "sizeBytes": e5_small_projection_path.stat().st_size,
        "sha256": _sha256_file(e5_small_projection_path),
        "parameterSha256": projection["parameterSha256"],
        "inputDimension": projection["inputDimension"],
        "outputDimension": projection["outputDimension"],
        "fitSplit": projection["fitSplit"],
        "fitRecordCount": projection["fitRecordCount"],
        "l2Normalize": True,
        "l2Epsilon": 1e-12,
    }
    semantic_heads_descriptor = {
        "version": semantic_heads_artifact["version"],
        "contentHash": f"sha256:{semantic_heads_artifact['artifactContentHash']}",
        "relativePath": semantic_heads_artifact_path.name,
        "sizeBytes": semantic_heads_artifact_path.stat().st_size,
        "sha256": _sha256_file(semantic_heads_artifact_path),
        "inputDimension": semantic_heads_artifact["inputDimension"],
        "outputDimension": semantic_heads_artifact[
            "semanticHeadProbabilityDimension"
        ],
        "probabilityRule": semantic_heads_artifact["probabilityRule"],
        "headOrder": semantic_heads_artifact["headOrder"],
        "classOrder": [
            {"name": head["name"], "classes": head["classes"]}
            for head in semantic_heads_artifact["heads"]
        ],
    }
    pipeline_specs = (
        (
            "rule_42_plus_e5_small_pca_64",
            "difficulty-lightgbm-shadow.rule42-e5-small-pca64.v1",
            "e5_small",
            e5_small_encoder_descriptor,
            42,
            "pca_64",
            64,
            ["rule_vector_v1", "e5_small_pca_64"],
            projection_descriptor,
            None,
        ),
        (
            "rule_42_plus_semantic_heads_12",
            "difficulty-lightgbm-shadow.rule42-semantic-heads12.v1",
            "e5_small",
            e5_small_encoder_descriptor,
            42,
            "semantic_heads_12",
            12,
            ["rule_vector_v1", "semantic_heads_12"],
            projection_descriptor,
            semantic_heads_descriptor,
        ),
        (
            "e5_base_raw_768",
            "difficulty-lightgbm-shadow.e5-base-768.v1",
            "e5_base",
            e5_base_encoder_descriptor,
            0,
            "raw_768",
            768,
            ["raw_embedding_768"],
            None,
            None,
        ),
        (
            "rule_42_plus_e5_base_raw_768",
            "difficulty-lightgbm-shadow.e5-base-768.v1",
            "e5_base",
            e5_base_encoder_descriptor,
            42,
            "raw_768",
            768,
            ["rule_vector_v1", "raw_embedding_768"],
            None,
            None,
        ),
    )
    for (
        candidate,
        profile_version,
        encoder_mode,
        encoder_descriptor,
        rule_dimension,
        semantic_mode,
        semantic_dimension,
        feature_order,
        candidate_projection,
        candidate_semantic_heads,
    ) in pipeline_specs:
        result = by_candidate[candidate]
        manifest = {
            "schemaVersion": "gatelm.routing-difficulty-lightgbm-shadow-profile.v1",
            "profileVersion": profile_version,
            "contractVersion": "gatelm.internal.routing-difficulty-lightgbm-shadow.v1",
            "promotionState": "offline_shadow_only",
            "executionShape": {
                "unit": "single_request",
                "batchSize": 1,
                "paddingScope": "within_request_only",
            },
            "encoderMode": encoder_mode,
            "encoder": dict(encoder_descriptor),
            "featureShape": {
                "ruleVectorVersion": "difficulty-feature-vector.v1",
                "ruleDimension": rule_dimension,
                "tabularFeatureNames": (
                    [] if rule_dimension == 0 else _rule_feature_names()
                ),
                "semanticMode": semantic_mode,
                "semanticDimension": semantic_dimension,
                "totalDimension": result.dimension,
                "featureOrder": feature_order,
                "projection": candidate_projection,
                "semanticHeads": candidate_semantic_heads,
            },
            "model": {
                "version": f"{EXPERIMENT_VERSION}.{candidate}",
                "contentHash": f"sha256:{result.model_sha256}",
                "format": "lightgbm_text",
                "objective": "binary",
                "relativePath": result.model_path.name,
                "sizeBytes": result.model_path.stat().st_size,
                "sha256": result.model_sha256,
                "numFeatures": result.dimension,
                "threshold": result.threshold,
                "parameters": _parameters(),
            },
            "trainingProvenance": {
                "datasetVersion": dataset_provenance["datasetVersion"],
                "datasetSha256": f"sha256:{dataset_provenance['datasetSha256']}",
                "splitPolicyVersion": dataset_provenance["splitPolicyVersion"],
                "seed": TRAINING_SEED,
                "splitCounts": dict(split_counts),
                "familyDisjoint": True,
                "selectedFrom": selected_from,
                "selectionSplit": "validation",
                "testAccess": "after_selection_freeze",
            },
        }
        path = output_directory / f"{candidate}.shadow-profile.v1.json"
        path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        profiles.append(path)
    return tuple(profiles)


def _rule_feature_names() -> list[str]:
    from .semantic_features import RULE_VECTOR_V1_FEATURE_NAMES

    return [f"ruleVectorV1.{name}" for name in RULE_VECTOR_V1_FEATURE_NAMES]


def _parameters() -> dict[str, Any]:
    return {
        "objective": "binary",
        "metric": "binary_logloss",
        "learning_rate": 0.03,
        "num_leaves": 31,
        "max_depth": -1,
        "min_data_in_leaf": 20,
        "feature_fraction": 1.0,
        "bagging_fraction": 1.0,
        "bagging_freq": 0,
        "lambda_l1": 0.0,
        "lambda_l2": 0.1,
        "seed": TRAINING_SEED,
        "feature_fraction_seed": TRAINING_SEED,
        "bagging_seed": TRAINING_SEED,
        "data_random_seed": TRAINING_SEED,
        "deterministic": True,
        "force_col_wise": True,
        "num_threads": 1,
        "verbosity": -1,
    }


def _scores(booster: Any, matrix: np.ndarray, iteration: int) -> np.ndarray:
    values = np.asarray(
        booster.predict(matrix, num_iteration=iteration), dtype=np.float64
    )
    if values.shape != (matrix.shape[0],) or not np.all(np.isfinite(values)):
        raise ValueError("LightGBM probability output is invalid")
    return values


def _select_threshold(labels: np.ndarray, scores: np.ndarray) -> float:
    return min(
        (value / 1000 for value in range(1, 1000)),
        key=lambda threshold: (
            -float(np.mean((scores >= threshold) == labels)),
            int(np.sum((labels == 1) & (scores < threshold))),
            abs(threshold - 0.5),
            threshold,
        ),
    )


def _metrics(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    predictions = scores >= threshold
    clipped = np.clip(scores, 1e-12, 1 - 1e-12)
    return {
        "accuracy": float(np.mean(predictions == labels)),
        "complexToSimple": int(np.sum((labels == 1) & (predictions == 0))),
        "simpleToComplex": int(np.sum((labels == 0) & (predictions == 1))),
        "logLoss": float(
            -np.mean(labels * np.log(clipped) + (1 - labels) * np.log(1 - clipped))
        ),
    }


def _write_report(
    *,
    output_directory: Path,
    results: Sequence[CandidateResult],
    split_counts: Mapping[str, int],
    dataset_provenance: Mapping[str, Any],
    encoder_provenance: Mapping[str, Any],
) -> None:
    selected = min(
        results,
        key=lambda result: (
            -result.validation_accuracy,
            result.validation_complex_to_simple,
            result.validation_log_loss,
            result.dimension,
            result.candidate,
        ),
    )
    report = {
        "schemaVersion": EXPERIMENT_SCHEMA,
        "experimentVersion": EXPERIMENT_VERSION,
        "promotionState": "offline_shadow_only",
        "candidateOrder": list(CANDIDATE_DIMENSIONS),
        "selectedCandidate": selected.candidate,
        "splitCounts": dict(split_counts),
        "datasetProvenance": dict(dataset_provenance),
        "encoderProvenance": dict(encoder_provenance),
        "candidates": [
            {
                "candidate": result.candidate,
                "dimension": result.dimension,
                "threshold": result.threshold,
                "bestIteration": result.best_iteration,
                "validation": {
                    "accuracy": round(result.validation_accuracy, 8),
                    "complexToSimple": result.validation_complex_to_simple,
                    "logLoss": round(result.validation_log_loss, 8),
                },
                "test": {
                    "accuracy": round(result.test_accuracy, 8),
                    "complexToSimple": result.test_complex_to_simple,
                    "logLoss": round(result.test_log_loss, 8),
                },
                "model": {
                    "relativePath": result.model_path.name,
                    "sizeBytes": result.model_path.stat().st_size,
                    "sha256": result.model_sha256,
                },
            }
            for result in results
        ],
        "containsPromptOrEmbeddingMaterial": False,
    }
    path = output_directory / "four-way-evaluation.v1.json"
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
