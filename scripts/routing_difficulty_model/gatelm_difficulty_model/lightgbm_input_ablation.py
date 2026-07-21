"""Fixed-parameter E1-E4 LightGBM input representation experiment.

Prompt-derived vectors and per-sample probabilities remain process-local. The
module writes only aggregate evidence, model artifacts, and semantic-head model
parameters required to reproduce E4.
"""

from __future__ import annotations

import hashlib
import json
import platform
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import Any, Callable, Mapping, Sequence

import numpy as np
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    fbeta_score,
    log_loss,
    precision_recall_fscore_support,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedGroupKFold

from .semantic_features import RULE_VECTOR_V1_DIMENSION, SEMANTIC_HEAD_SPECS_V1
from .semantic_heads import evaluate_semantic_head_probabilities


SCHEMA_VERSION = "gatelm.lightgbm-input-ablation-evidence.v1"
EXPERIMENT_ID = "difficulty-lightgbm-input-ablation.owner-approved-15000.2026-07-22.v1"
TRAINING_SEED = 20260721
HEAD_C = 1.0
HEAD_MAX_ITERATIONS = 1000
CV_FOLDS = 5
PREDICTION_TIMING_REPEATS = 25
EVALUATION_SLICES = (
    "long_simple",
    "short_complex",
    "korean",
    "english",
    "mixed_language",
    "negation",
    "indirect_expression",
    "synonym",
    "payload_contamination",
    "category_confusion",
    "ood_terminology",
)
CANDIDATE_DIMENSIONS = {
    "E1_embedding_768": 768,
    "E2_embedding_768_plus_rule_42": 810,
    "E3_pca_128_plus_rule_42": 170,
    "E4_semantic_heads_12_plus_rule_42": 54,
}
SPLIT_ALIASES = {
    "train": "train",
    "calibration": "validation",
    "validation": "validation",
    "holdout": "test",
    "test": "test",
}
HEAD_LABEL_FIELDS = {
    "semanticTaskBucket": "taskBucket",
    "semanticConstraintBucket": "constraintBucket",
    "semanticScopeBucket": "scopeBucket",
    "semanticDependencyBucket": "dependencyBucket",
}


@dataclass(frozen=True)
class PreparedInputs:
    matrices: Mapping[str, np.ndarray]
    pca: PCA
    semantic_head_artifact: Mapping[str, Any]
    semantic_head_test_evaluation: Mapping[str, Any]
    folds: tuple[tuple[np.ndarray, np.ndarray], ...]


def fixed_lightgbm_parameters() -> dict[str, Any]:
    """Return the current LightGBM shadow baseline without tuned additions."""

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


def prepare_inputs(
    *,
    rule_vectors: Any,
    e5_base_embeddings: Any,
    labels: Sequence[int],
    splits: Sequence[str],
    family_ids: Sequence[str],
    semantic_targets: Mapping[str, Sequence[str]],
    metadata: Sequence[Mapping[str, Any]],
    encoder_provenance: Mapping[str, Any],
) -> PreparedInputs:
    rules = _finite_matrix(rule_vectors, "rule vectors", RULE_VECTOR_V1_DIMENSION)
    embeddings = _finite_matrix(e5_base_embeddings, "E5-base embeddings", 768)
    count = embeddings.shape[0]
    if rules.shape[0] != count:
        raise ValueError("rule and embedding row counts do not align")
    if np.any(rules < 0.0) or np.any(rules > 1.0):
        raise ValueError("rule vectors must stay within [0,1]")
    y, normalized_splits, families, indices = validate_split_contract(
        labels=labels,
        splits=splits,
        family_ids=family_ids,
        expected_count=count,
    )
    _validate_semantic_targets(semantic_targets, count)
    if len(metadata) != count:
        raise ValueError("metadata rows do not align")

    train_indices = indices["train"]
    folds = make_shared_folds(y[train_indices], families[train_indices])

    pca = PCA(n_components=128, svd_solver="full", whiten=False)
    pca.fit(embeddings[train_indices])
    projected = np.asarray(pca.transform(embeddings), dtype=np.float32)
    norms = np.linalg.norm(projected, axis=1, keepdims=True)
    if not np.all(np.isfinite(norms)) or np.any(norms <= 1e-12):
        raise ValueError("PCA projection contains a non-finite or degenerate row")
    projected = np.ascontiguousarray(projected / norms, dtype=np.float32)

    oof_heads = np.zeros((train_indices.size, 12), dtype=np.float32)
    for fold_fit, fold_valid in folds:
        fit_global = train_indices[fold_fit]
        valid_global = train_indices[fold_valid]
        classifiers = _fit_semantic_head_classifiers(
            embeddings[fit_global],
            {
                name: [semantic_targets[name][index] for index in fit_global]
                for name in semantic_targets
            },
        )
        probabilities = _predict_semantic_heads(classifiers, embeddings[valid_global])
        oof_heads[fold_valid] = flatten_semantic_probabilities(probabilities)
    if not np.all(np.isfinite(oof_heads)) or np.any(oof_heads == 0.0, axis=None):
        # Softmax can theoretically underflow to exactly zero; the fitted baseline
        # should not do so on this bounded dataset, and zero also catches unfilled OOF rows.
        if np.any(np.isclose(oof_heads.sum(axis=1), 0.0)):
            raise ValueError("semantic-head OOF generation left an unfilled row")

    full_classifiers = _fit_semantic_head_classifiers(
        embeddings[train_indices],
        {
            name: [semantic_targets[name][index] for index in train_indices]
            for name in semantic_targets
        },
    )
    full_probabilities = _predict_semantic_heads(full_classifiers, embeddings)
    full_heads = flatten_semantic_probabilities(full_probabilities)
    head_features = full_heads.copy()
    head_features[train_indices] = oof_heads

    test_indices = indices["test"]
    test_probabilities = {
        name: np.asarray(values, dtype=np.float64)[test_indices]
        for name, values in full_probabilities.items()
    }
    test_targets = {
        name: [semantic_targets[name][index] for index in test_indices]
        for name in semantic_targets
    }
    test_metadata = [metadata[index] for index in test_indices]
    head_evaluation = evaluate_semantic_head_probabilities(
        test_probabilities,
        test_targets,
        test_metadata,
        calibration_bins=10,
    )
    head_evaluation = dict(head_evaluation)
    head_evaluation["fourHeadExactMatchAccuracy"] = _four_head_exact_match(
        test_probabilities, test_targets
    )

    matrices = {
        "E1_embedding_768": embeddings,
        "E2_embedding_768_plus_rule_42": np.concatenate((rules, embeddings), axis=1),
        "E3_pca_128_plus_rule_42": np.concatenate((rules, projected), axis=1),
        "E4_semantic_heads_12_plus_rule_42": np.concatenate((rules, head_features), axis=1),
    }
    normalized: dict[str, np.ndarray] = {}
    for candidate, dimension in CANDIDATE_DIMENSIONS.items():
        matrix = np.ascontiguousarray(matrices[candidate], dtype=np.float32)
        if matrix.shape != (count, dimension) or not np.all(np.isfinite(matrix)):
            raise ValueError(f"{candidate} matrix violates the frozen dimension contract")
        normalized[candidate] = matrix

    artifact = _semantic_head_artifact(full_classifiers, encoder_provenance)
    return PreparedInputs(
        matrices=normalized,
        pca=pca,
        semantic_head_artifact=artifact,
        semantic_head_test_evaluation=head_evaluation,
        folds=folds,
    )


def run_experiment(
    *,
    prepared: PreparedInputs,
    labels: Sequence[int],
    splits: Sequence[str],
    family_ids: Sequence[str],
    categories: Sequence[str],
    evaluation_slices: Sequence[Sequence[str]],
    output_directory: Path,
    dataset_provenance: Mapping[str, Any],
    encoder_provenance: Mapping[str, Any],
    design_provenance: Mapping[str, Any],
) -> Path:
    import lightgbm as lgb
    import sklearn

    count = len(labels)
    y, normalized_splits, families, indices = validate_split_contract(
        labels=labels,
        splits=splits,
        family_ids=family_ids,
        expected_count=count,
    )
    category_values = np.asarray([str(value) for value in categories], dtype=object)
    slice_values = [tuple(str(item) for item in values) for values in evaluation_slices]
    if category_values.shape != (count,) or len(slice_values) != count:
        raise ValueError("category/slice metadata does not align")

    output_directory.mkdir(parents=True, exist_ok=True)
    semantic_path = output_directory / "e4-semantic-heads.e5-base-768.v1.json"
    _write_json(semantic_path, prepared.semantic_head_artifact)
    pca_path = output_directory / "e3-pca-128.train-only.v1.npz"
    np.savez_compressed(
        pca_path,
        components=np.asarray(prepared.pca.components_, dtype=np.float32),
        mean=np.asarray(prepared.pca.mean_, dtype=np.float32),
        explained_variance=np.asarray(
            prepared.pca.explained_variance_, dtype=np.float32
        ),
        explained_variance_ratio=np.asarray(
            prepared.pca.explained_variance_ratio_, dtype=np.float32
        ),
        singular_values=np.asarray(prepared.pca.singular_values_, dtype=np.float32),
        n_components=np.asarray([prepared.pca.n_components_], dtype=np.int64),
        n_features_in=np.asarray([prepared.pca.n_features_in_], dtype=np.int64),
    )

    train_global = indices["train"]
    results: list[dict[str, Any]] = []
    for candidate, dimension in CANDIDATE_DIMENSIONS.items():
        matrix = np.asarray(prepared.matrices[candidate], dtype=np.float32)
        cv_result = _cross_validation(
            matrix=matrix[train_global],
            labels=y[train_global],
            folds=prepared.folds,
        )
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
        fit_started = time.perf_counter()
        booster = lgb.train(
            fixed_lightgbm_parameters(),
            train_set,
            num_boost_round=300,
            valid_sets=[validation_set],
            callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(0)],
        )
        fit_duration_ms = (time.perf_counter() - fit_started) * 1000.0
        validation_scores = _predict(booster, matrix[indices["validation"]])
        threshold = select_current_shadow_threshold(
            y[indices["validation"]], validation_scores
        )
        test_scores = _predict(booster, matrix[indices["test"]])
        validation_metrics = binary_metrics(
            y[indices["validation"]], validation_scores, threshold
        )
        test_metrics = binary_metrics(y[indices["test"]], test_scores, threshold)

        model_path = output_directory / f"{candidate}.lightgbm.txt"
        booster.save_model(str(model_path), num_iteration=booster.best_iteration)
        auxiliary_artifact = (
            {
                "relativePath": pca_path.name,
                "sizeBytes": pca_path.stat().st_size,
                "sha256": sha256_file(pca_path),
            }
            if candidate == "E3_pca_128_plus_rule_42"
            else {
                "relativePath": semantic_path.name,
                "sizeBytes": semantic_path.stat().st_size,
                "sha256": sha256_file(semantic_path),
            }
            if candidate == "E4_semantic_heads_12_plus_rule_42"
            else None
        )
        latency = {
            "validation": _prediction_latency(
                lambda: booster.predict(
                    matrix[indices["validation"]], num_iteration=booster.best_iteration
                ),
                indices["validation"].size,
            ),
            "test": _prediction_latency(
                lambda: booster.predict(
                    matrix[indices["test"]], num_iteration=booster.best_iteration
                ),
                indices["test"].size,
            ),
            "scope": "LightGBM batch prediction only; encoder and feature generation excluded",
        }
        results.append(
            {
                "candidate": candidate,
                "dimension": dimension,
                "bestIteration": int(booster.best_iteration),
                "threshold": threshold,
                "fixedParameters": fixed_lightgbm_parameters(),
                "crossValidation": cv_result,
                "trainFitDurationMs": _rounded(fit_duration_ms),
                "validation": {
                    "overall": validation_metrics,
                    "byCategory": grouped_metrics(
                        labels=y[indices["validation"]],
                        scores=validation_scores,
                        threshold=threshold,
                        groups=category_values[indices["validation"]],
                        required_groups=(
                            "general",
                            "code",
                            "translation",
                            "summarization",
                            "reasoning",
                        ),
                    ),
                },
                "test": {
                    "overall": test_metrics,
                    "byCategory": grouped_metrics(
                        labels=y[indices["test"]],
                        scores=test_scores,
                        threshold=threshold,
                        groups=category_values[indices["test"]],
                        required_groups=(
                            "general",
                            "code",
                            "translation",
                            "summarization",
                            "reasoning",
                        ),
                    ),
                    "bySlice": slice_metrics(
                        labels=y[indices["test"]],
                        scores=test_scores,
                        threshold=threshold,
                        slices=[slice_values[index] for index in indices["test"]],
                    ),
                },
                "latency": latency,
                "model": {
                    "relativePath": model_path.name,
                    "sizeBytes": model_path.stat().st_size,
                    "sha256": sha256_file(model_path),
                    "numFeatures": int(booster.num_feature()),
                },
                "auxiliaryArtifact": auxiliary_artifact,
                "pipelineArtifactSizeBytes": (
                    model_path.stat().st_size
                    + (auxiliary_artifact["sizeBytes"] if auxiliary_artifact else 0)
                ),
            }
        )

    selected = min(
        results,
        key=lambda item: (
            -item["validation"]["overall"]["accuracy"],
            item["validation"]["overall"]["falseNegativeCount"],
            item["validation"]["overall"]["logLoss"],
            item["dimension"],
            item["candidate"],
        ),
    )
    family_split_overlap = _family_split_overlap(families, normalized_splits)
    report = {
        "schemaVersion": SCHEMA_VERSION,
        "experimentId": EXPERIMENT_ID,
        "status": "executed",
        "evidenceClass": "exploratory_offline_comparison",
        "promotionState": "exploratory_only",
        "runtimeProfileGenerated": False,
        "testAccessState": "all_four_candidates_compared_exploratory_only",
        "selectedCandidateByCurrentValidationRule": selected["candidate"],
        "candidateOrder": list(CANDIDATE_DIMENSIONS),
        "datasetProvenance": dict(dataset_provenance),
        "encoderProvenance": dict(encoder_provenance),
        "designProvenance": dict(design_provenance),
        "splitCounts": {name: int(values.size) for name, values in indices.items()},
        "splitFamilyCounts": {
            name: len(set(families[values].tolist())) for name, values in indices.items()
        },
        "leakageAudit": {
            "crossSplitFamilyOverlapCount": family_split_overlap,
            "allSplitsContainBothLabels": all(
                set(y[values].tolist()) == {0, 1} for values in indices.values()
            ),
            "pcaFitSplit": "train_only",
            "semanticHeadTrainFeatureMode": "family_group_5_fold_oof",
        },
        "lightgbm": {
            "libraryVersion": lgb.__version__,
            "api": "lgb.train",
            "parameters": fixed_lightgbm_parameters(),
            "numBoostRound": 300,
            "earlyStoppingRounds": 30,
            "thresholdSelection": "validation grid 0.01..0.99; accuracy, FN, distance-to-0.5, threshold",
        },
        "environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "architecture": platform.machine(),
            "numpy": np.__version__,
            "scikitLearn": sklearn.__version__,
        },
        "e3Pca": {
            "implementation": "sklearn PCA",
            "solver": "full",
            "fitSplit": "train",
            "components": 128,
            "rowL2Normalized": True,
            "explainedVarianceRatioSum": _rounded(
                float(prepared.pca.explained_variance_ratio_.sum())
            ),
            "artifact": {
                "relativePath": pca_path.name,
                "sizeBytes": pca_path.stat().st_size,
                "sha256": sha256_file(pca_path),
            },
        },
        "e4SemanticHeads": {
            "inputDimension": 768,
            "outputDimension": 12,
            "trainMode": "family_group_5_fold_oof",
            "c": HEAD_C,
            "maxIterations": HEAD_MAX_ITERATIONS,
            "artifact": {
                "relativePath": semantic_path.name,
                "sizeBytes": semantic_path.stat().st_size,
                "sha256": sha256_file(semantic_path),
            },
            "testEvaluation": prepared.semantic_head_test_evaluation,
        },
        "candidates": results,
        "dataSafety": {
            "containsPrompt": False,
            "containsEmbeddingOrMatrix": False,
            "containsPerSampleScoreOrProbability": False,
        },
        "limitations": [
            "All four candidates were evaluated on the same Test split, so this is not one-shot promotion evidence.",
            "The Test split contains 100 records and several slices have insufficient support.",
            "Probabilities are uncalibrated diagnostics because current shadow settings were kept unchanged.",
            "Latency is Windows offline batch prediction and excludes the common E5-base encoder.",
        ],
    }
    report_path = output_directory / "input-ablation-evaluation.v1.json"
    _write_json(report_path, report)
    return report_path


def validate_split_contract(
    *,
    labels: Sequence[int],
    splits: Sequence[str],
    family_ids: Sequence[str],
    expected_count: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict[str, np.ndarray]]:
    y = np.asarray(labels, dtype=np.int8)
    normalized = np.asarray(
        [SPLIT_ALIASES.get(str(value), "") for value in splits], dtype=object
    )
    families = np.asarray([str(value).strip() for value in family_ids], dtype=object)
    if y.shape != (expected_count,) or set(y.tolist()).difference({0, 1}):
        raise ValueError("labels must be exact 0/1 and align")
    if normalized.shape != (expected_count,) or set(normalized.tolist()) != {
        "train",
        "validation",
        "test",
    }:
        raise ValueError("train/validation/test split rows must align")
    if families.shape != (expected_count,) or any(not value for value in families):
        raise ValueError("family IDs must be non-empty and align")
    if _family_split_overlap(families, normalized):
        raise ValueError("prompt family crosses dataset splits")
    indices = {
        name: np.flatnonzero(normalized == name)
        for name in ("train", "validation", "test")
    }
    if any(set(y[index].tolist()) != {0, 1} for index in indices.values()):
        raise ValueError("every split must contain both labels")
    return y, normalized, families, indices


def make_shared_folds(
    labels: np.ndarray, family_ids: np.ndarray
) -> tuple[tuple[np.ndarray, np.ndarray], ...]:
    splitter = StratifiedGroupKFold(
        n_splits=CV_FOLDS,
        shuffle=True,
        random_state=TRAINING_SEED,
    )
    placeholder = np.zeros((labels.size, 1), dtype=np.float32)
    folds = tuple(
        (np.asarray(fit, dtype=np.int64), np.asarray(valid, dtype=np.int64))
        for fit, valid in splitter.split(placeholder, labels, groups=family_ids)
    )
    if len(folds) != CV_FOLDS:
        raise ValueError("shared family-group folds are incomplete")
    for fit, valid in folds:
        if set(family_ids[fit]).intersection(family_ids[valid]):
            raise ValueError("prompt family crosses a shared fold")
        if set(labels[fit].tolist()) != {0, 1} or set(labels[valid].tolist()) != {0, 1}:
            raise ValueError("every shared fold requires both labels")
    return folds


def flatten_semantic_probabilities(probabilities: Mapping[str, Any]) -> np.ndarray:
    matrices: list[np.ndarray] = []
    count: int | None = None
    for spec in SEMANTIC_HEAD_SPECS_V1:
        matrix = np.asarray(probabilities[spec.name], dtype=np.float64)
        if matrix.ndim != 2 or matrix.shape[1] != 3 or not np.all(np.isfinite(matrix)):
            raise ValueError("semantic-head probability shape is invalid")
        if count is None:
            count = matrix.shape[0]
        if matrix.shape[0] != count or not np.allclose(
            matrix.sum(axis=1), 1.0, atol=1e-8, rtol=0
        ):
            raise ValueError("semantic-head probability rows are invalid")
        matrices.append(matrix)
    result = np.ascontiguousarray(np.concatenate(matrices, axis=1), dtype=np.float32)
    if count is None or result.shape != (count, 12):
        raise ValueError("semantic-head probabilities must flatten to exact 12D")
    return result


def select_current_shadow_threshold(labels: np.ndarray, scores: np.ndarray) -> float:
    if labels.shape != scores.shape or not np.all(np.isfinite(scores)):
        raise ValueError("validation scores are invalid")
    return min(
        (round(value / 100, 2) for value in range(1, 100)),
        key=lambda threshold: (
            -float(np.mean((scores >= threshold) == labels)),
            int(np.sum((labels == 1) & (scores < threshold))),
            abs(threshold - 0.5),
            threshold,
        ),
    )


def binary_metrics(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    labels = np.asarray(labels, dtype=np.int8)
    scores = np.asarray(scores, dtype=np.float64)
    predictions = (scores >= threshold).astype(np.int8)
    tn, fp, fn, tp = [
        int(value) for value in confusion_matrix(labels, predictions, labels=[0, 1]).ravel()
    ]
    precision, recall, f1, support = precision_recall_fscore_support(
        labels,
        predictions,
        labels=[0, 1],
        zero_division=0,
    )
    ranking_available = set(labels.tolist()) == {0, 1}
    return {
        "support": int(labels.size),
        "threshold": float(threshold),
        "accuracy": _rounded(accuracy_score(labels, predictions)),
        "balancedAccuracy": (
            _rounded(balanced_accuracy_score(labels, predictions))
            if ranking_available
            else None
        ),
        "macroF1": _rounded(
            f1_score(
                labels,
                predictions,
                labels=[0, 1],
                average="macro",
                zero_division=0,
            )
        ),
        "simple": {
            "precision": _rounded(precision[0]),
            "recall": _rounded(recall[0]),
            "f1": _rounded(f1[0]),
            "support": int(support[0]),
        },
        "complex": {
            "precision": _rounded(precision[1]),
            "recall": _rounded(recall[1]),
            "f1": _rounded(f1[1]),
            "f2": _rounded(fbeta_score(labels, predictions, beta=2, pos_label=1, zero_division=0)),
            "support": int(support[1]),
        },
        "rocAuc": _rounded(roc_auc_score(labels, scores)) if ranking_available else None,
        "averagePrecision": (
            _rounded(average_precision_score(labels, scores)) if ranking_available else None
        ),
        "brierScore": _rounded(float(np.mean((scores - labels) ** 2))),
        "logLoss": _rounded(log_loss(labels, np.clip(scores, 1e-12, 1 - 1e-12), labels=[0, 1])),
        "confusionMatrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "falseNegativeCount": fn,
        "falsePositiveCount": fp,
        "expectedDecisionLoss": {
            f"cFn{cost}": _rounded((cost * fn + fp) / labels.size)
            for cost in (1, 3, 5, 10)
        },
    }


def grouped_metrics(
    *,
    labels: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    groups: np.ndarray,
    required_groups: Sequence[str],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for group in required_groups:
        index = np.flatnonzero(groups == group)
        result[group] = (
            {"status": "empty", "support": 0}
            if index.size == 0
            else {"status": "measured", **_compact_metrics(labels[index], scores[index], threshold)}
        )
    return result


def slice_metrics(
    *,
    labels: np.ndarray,
    scores: np.ndarray,
    threshold: float,
    slices: Sequence[Sequence[str]],
) -> dict[str, Any]:
    return {
        name: (
            {"status": "empty", "support": 0}
            if not indices
            else {
                "status": "measured",
                **_compact_metrics(
                    labels[np.asarray(indices, dtype=np.int64)],
                    scores[np.asarray(indices, dtype=np.int64)],
                    threshold,
                ),
            }
        )
        for name in EVALUATION_SLICES
        for indices in ([index for index, values in enumerate(slices) if name in values],)
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _finite_matrix(values: Any, name: str, dimension: int) -> np.ndarray:
    matrix = np.asarray(values, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[1] != dimension or not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} must be finite [records,{dimension}]")
    return np.ascontiguousarray(matrix)


def _validate_semantic_targets(targets: Mapping[str, Sequence[str]], count: int) -> None:
    if set(targets) != {spec.name for spec in SEMANTIC_HEAD_SPECS_V1}:
        raise ValueError("semantic-head target keys are invalid")
    for spec in SEMANTIC_HEAD_SPECS_V1:
        values = list(targets[spec.name])
        if len(values) != count or set(values).difference(spec.classes):
            raise ValueError(f"semantic-head targets are invalid for {spec.name}")


def _fit_semantic_head_classifiers(
    embeddings: np.ndarray,
    targets: Mapping[str, Sequence[str]],
) -> dict[str, LogisticRegression]:
    result: dict[str, LogisticRegression] = {}
    for spec in SEMANTIC_HEAD_SPECS_V1:
        values = list(targets[spec.name])
        if set(values) != set(spec.classes):
            raise ValueError(f"semantic-head fit for {spec.name} requires all classes")
        encoded = np.asarray([spec.classes.index(value) for value in values], dtype=np.int64)
        classifier = LogisticRegression(
            solver="lbfgs",
            penalty="l2",
            C=HEAD_C,
            max_iter=HEAD_MAX_ITERATIONS,
            random_state=TRAINING_SEED,
        )
        classifier.fit(embeddings, encoded)
        if tuple(int(value) for value in classifier.classes_) != (0, 1, 2):
            raise ValueError("semantic-head class order changed")
        result[spec.name] = classifier
    return result


def _predict_semantic_heads(
    classifiers: Mapping[str, LogisticRegression], embeddings: np.ndarray
) -> dict[str, np.ndarray]:
    return {
        spec.name: np.asarray(classifiers[spec.name].predict_proba(embeddings), dtype=np.float64)
        for spec in SEMANTIC_HEAD_SPECS_V1
    }


def _four_head_exact_match(
    probabilities: Mapping[str, Any], targets: Mapping[str, Sequence[str]]
) -> float:
    correctness: list[np.ndarray] = []
    for spec in SEMANTIC_HEAD_SPECS_V1:
        predicted = np.argmax(np.asarray(probabilities[spec.name]), axis=1)
        expected = np.asarray([spec.classes.index(value) for value in targets[spec.name]])
        correctness.append(predicted == expected)
    return _rounded(float(np.mean(np.logical_and.reduce(correctness))))


def _semantic_head_artifact(
    classifiers: Mapping[str, LogisticRegression], encoder_provenance: Mapping[str, Any]
) -> dict[str, Any]:
    artifact: dict[str, Any] = {
        "schemaVersion": "gatelm.lightgbm-input-ablation-semantic-heads.v1",
        "experimentId": EXPERIMENT_ID,
        "promotionState": "exploratory_only",
        "encoder": dict(encoder_provenance),
        "inputDimension": 768,
        "outputDimension": 12,
        "headOrder": [spec.name for spec in SEMANTIC_HEAD_SPECS_V1],
        "training": {
            "fitSplit": "train",
            "trainFeatureMode": "family_group_5_fold_oof_for_lightgbm",
            "solver": "lbfgs",
            "penalty": "l2",
            "c": HEAD_C,
            "maxIterations": HEAD_MAX_ITERATIONS,
            "randomState": TRAINING_SEED,
        },
        "heads": [
            {
                "name": spec.name,
                "classes": list(spec.classes),
                "coefficient": np.asarray(classifiers[spec.name].coef_).tolist(),
                "intercept": np.asarray(classifiers[spec.name].intercept_).tolist(),
            }
            for spec in SEMANTIC_HEAD_SPECS_V1
        ],
        "containsEmbeddingOrSampleProbability": False,
    }
    canonical = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    artifact["contentSha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return artifact


def _cross_validation(
    *, matrix: np.ndarray, labels: np.ndarray, folds: Sequence[tuple[np.ndarray, np.ndarray]]
) -> dict[str, Any]:
    import lightgbm as lgb

    fold_results: list[dict[str, Any]] = []
    for fold_number, (fit, valid) in enumerate(folds, start=1):
        train_set = lgb.Dataset(matrix[fit], label=labels[fit], free_raw_data=False)
        valid_set = lgb.Dataset(
            matrix[valid], label=labels[valid], reference=train_set, free_raw_data=False
        )
        booster = lgb.train(
            fixed_lightgbm_parameters(),
            train_set,
            num_boost_round=300,
            valid_sets=[valid_set],
            callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(0)],
        )
        scores = _predict(booster, matrix[valid])
        fold_results.append(
            {
                "fold": fold_number,
                "fitRecords": int(fit.size),
                "validationRecords": int(valid.size),
                "averagePrecision": _rounded(average_precision_score(labels[valid], scores)),
                "logLoss": _rounded(log_loss(labels[valid], scores, labels=[0, 1])),
                "bestIteration": int(booster.best_iteration),
            }
        )
    ap = np.asarray([item["averagePrecision"] for item in fold_results], dtype=np.float64)
    losses = np.asarray([item["logLoss"] for item in fold_results], dtype=np.float64)
    iterations = [item["bestIteration"] for item in fold_results]
    return {
        "folds": fold_results,
        "meanAveragePrecision": _rounded(ap.mean()),
        "stdAveragePrecision": _rounded(ap.std(ddof=0)),
        "meanLogLoss": _rounded(losses.mean()),
        "stdLogLoss": _rounded(losses.std(ddof=0)),
        "medianBestIteration": int(median(iterations)),
    }


def _predict(booster: Any, matrix: np.ndarray) -> np.ndarray:
    scores = np.asarray(
        booster.predict(matrix, num_iteration=booster.best_iteration), dtype=np.float64
    )
    if scores.shape != (matrix.shape[0],) or not np.all(np.isfinite(scores)):
        raise ValueError("LightGBM prediction is invalid")
    return scores


def _prediction_latency(function: Callable[[], Any], rows: int) -> dict[str, Any]:
    function()
    durations: list[float] = []
    for _ in range(PREDICTION_TIMING_REPEATS):
        started = time.perf_counter()
        function()
        durations.append((time.perf_counter() - started) * 1000.0)
    median_ms = float(np.median(np.asarray(durations, dtype=np.float64)))
    return {
        "rows": rows,
        "repeats": PREDICTION_TIMING_REPEATS,
        "medianBatchMs": _rounded(median_ms),
        "medianPerRowMs": _rounded(median_ms / rows),
    }


def _compact_metrics(labels: np.ndarray, scores: np.ndarray, threshold: float) -> dict[str, Any]:
    full = binary_metrics(labels, scores, threshold)
    return {
        "support": full["support"],
        "accuracy": full["accuracy"],
        "balancedAccuracy": full["balancedAccuracy"],
        "macroF1": full["macroF1"],
        "complexRecall": full["complex"]["recall"],
        "falseNegativeCount": full["falseNegativeCount"],
        "falsePositiveCount": full["falsePositiveCount"],
        "balancedAccuracyStatus": (
            "measured" if full["balancedAccuracy"] is not None else "not_computable"
        ),
        "rankingStatus": "measured" if full["rocAuc"] is not None else "not_computable",
    }


def _family_split_overlap(families: np.ndarray, splits: np.ndarray) -> int:
    membership: dict[str, set[str]] = {}
    for family, split in zip(families, splits, strict=True):
        membership.setdefault(str(family), set()).add(str(split))
    return sum(1 for values in membership.values() if len(values) != 1)


def _rounded(value: float) -> float:
    return round(float(value), 10)


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
