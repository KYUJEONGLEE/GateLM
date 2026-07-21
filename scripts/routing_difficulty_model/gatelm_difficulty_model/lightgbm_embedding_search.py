"""Deterministic LightGBM search, refit, and OOF generation."""

from __future__ import annotations

import importlib.metadata
import json
import time
import warnings
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import product
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.metrics import average_precision_score, log_loss

from .lightgbm_embedding_experiment import (
    EXPERIMENT_SEED,
    N_FOLDS,
    ExperimentError,
    ExperimentStatus,
    FoldMembership,
    canonical_sha256,
)


LIGHTGBM_VERSION = "4.6.0"
FINAL_CANDIDATE_COUNT = 80
SMOKE_CANDIDATE_COUNT = 30
SEARCH_NUM_BOOST_ROUND = 3000
SEARCH_EARLY_STOPPING_ROUNDS = 100
BASELINE_NUM_BOOST_ROUND = 300
BASELINE_EARLY_STOPPING_ROUNDS = 30

FIXED_PARAMS: dict[str, Any] = {
    "objective": "binary",
    "metric": "binary_logloss",
    "boosting_type": "gbdt",
    "bagging_freq": 1,
    "deterministic": True,
    "force_col_wise": True,
    "device_type": "cpu",
    "num_threads": 1,
    "seed": EXPERIMENT_SEED,
    "feature_fraction_seed": EXPERIMENT_SEED,
    "bagging_seed": EXPERIMENT_SEED,
    "data_random_seed": EXPERIMENT_SEED,
    "verbosity": -1,
    "first_metric_only": True,
}

BASELINE_PARAMS: dict[str, Any] = {
    "learning_rate": 0.05,
    "num_leaves": 31,
    "max_depth": -1,
    "min_data_in_leaf": 20,
    "feature_fraction": 1.0,
    "bagging_fraction": 1.0,
    "bagging_freq": 0,
    "lambda_l1": 0,
    "lambda_l2": 0,
    "min_gain_to_split": 0,
}

SEARCH_SPACE: dict[str, tuple[int | float, ...]] = {
    "learning_rate": (0.01, 0.03, 0.05, 0.1),
    "num_leaves": (7, 15, 31, 63),
    "max_depth": (4, 6, 8, -1),
    "min_data_in_leaf": (20, 50, 100, 200),
    "feature_fraction": (0.5, 0.7, 0.85, 1.0),
    "bagging_fraction": (0.7, 0.85, 1.0),
    "lambda_l1": (0, 0.1, 1, 10),
    "lambda_l2": (0, 0.1, 1, 10),
    "min_gain_to_split": (0, 0.01, 0.05, 0.1),
}


@dataclass(frozen=True)
class SearchCandidate:
    candidate_id: str
    parameters: Mapping[str, int | float]

    def as_json(self) -> dict[str, Any]:
        return {"candidateId": self.candidate_id, "parameters": dict(self.parameters)}


@dataclass(frozen=True)
class CandidateResult:
    candidate_id: str
    parameters: Mapping[str, int | float]
    fold_average_precision: tuple[float, ...]
    fold_binary_log_loss: tuple[float, ...]
    fold_best_iteration: tuple[int, ...]
    mean_average_precision: float | None
    std_average_precision: float | None
    median_best_iteration: int | None
    warning_count: int
    error_count: int
    elapsed_seconds: float
    fold_set_sha256: str
    status: str = "completed"
    error_reason_code: str | None = None

    def aggregate_json(self) -> dict[str, Any]:
        return {
            "candidateId": self.candidate_id,
            "parameters": dict(self.parameters),
            "foldAveragePrecision": list(self.fold_average_precision),
            "foldBinaryLogLoss": list(self.fold_binary_log_loss),
            "foldBestIteration": list(self.fold_best_iteration),
            "meanAveragePrecision": self.mean_average_precision,
            "stdAveragePrecision": self.std_average_precision,
            "medianBestIteration": self.median_best_iteration,
            "warningCount": self.warning_count,
            "errorCount": self.error_count,
            "elapsedSeconds": self.elapsed_seconds,
            "foldSetSha256": self.fold_set_sha256,
            "status": self.status,
            "errorReasonCode": self.error_reason_code,
        }


class SearchIncompleteError(ExperimentError):
    """All frozen candidates were attempted, but at least one failed."""

    def __init__(self, results: Sequence[CandidateResult]) -> None:
        self.results = tuple(results)
        super().__init__(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SEARCH_INCOMPLETE",
        )


def _canonical_parameter_json(parameters: Mapping[str, Any]) -> str:
    return json.dumps(parameters, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _candidate_valid(parameters: Mapping[str, int | float]) -> bool:
    depth = int(parameters["max_depth"])
    leaves = int(parameters["num_leaves"])
    return depth == -1 or leaves <= 2**depth


def all_valid_combinations() -> tuple[dict[str, int | float], ...]:
    names = tuple(SEARCH_SPACE)
    combinations: list[dict[str, int | float]] = []
    for values in product(*(SEARCH_SPACE[name] for name in names)):
        candidate = dict(zip(names, values, strict=True))
        if _candidate_valid(candidate):
            combinations.append(candidate)
    combinations.sort(key=_canonical_parameter_json)
    return tuple(combinations)


def frozen_search_candidates(
    *,
    seed: int = EXPERIMENT_SEED,
    count: int = FINAL_CANDIDATE_COUNT,
) -> tuple[SearchCandidate, ...]:
    if seed != EXPERIMENT_SEED or count != FINAL_CANDIDATE_COUNT:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SEARCH_CONFIGURATION_DRIFT",
        )
    combinations = all_valid_combinations()
    rng = np.random.default_rng(seed)
    selected_indices = rng.choice(len(combinations), size=count, replace=False)
    selected: list[SearchCandidate] = []
    seen: set[str] = set()
    for index in selected_indices.tolist():
        parameters = combinations[int(index)]
        candidate_id = f"lgb-{canonical_sha256(parameters)[:16]}"
        if candidate_id in seen:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "CANDIDATE_ID_COLLISION",
            )
        seen.add(candidate_id)
        selected.append(SearchCandidate(candidate_id, parameters))
    return tuple(selected)


def candidate_set_manifest(
    candidates: Sequence[SearchCandidate],
) -> dict[str, Any]:
    if len(candidates) != FINAL_CANDIDATE_COUNT:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CANDIDATE_COUNT_INVALID",
        )
    material = [candidate.as_json() for candidate in candidates]
    if len({candidate["candidateId"] for candidate in material}) != len(material):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CANDIDATE_ID_DUPLICATE",
        )
    return {
        "schemaVersion": "gatelm.lightgbm-embedding-candidate-set.v1",
        "seed": EXPERIMENT_SEED,
        "selection": "numpy.default_rng.choice_without_replacement",
        "canonicalCombinationCount": len(all_valid_combinations()),
        "candidateCount": len(material),
        "candidates": material,
        "candidateSetSha256": canonical_sha256(material),
    }


def require_official_lightgbm() -> Any:
    try:
        version = importlib.metadata.version("lightgbm")
        import lightgbm as lgb
    except (ImportError, importlib.metadata.PackageNotFoundError) as exc:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "LIGHTGBM_NOT_INSTALLED",
        ) from exc
    if version != LIGHTGBM_VERSION:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "LIGHTGBM_VERSION_MISMATCH",
        )
    return lgb


def _validated_probability(values: Any, expected_count: int) -> np.ndarray:
    probability = np.asarray(values, dtype=np.float64)
    if (
        probability.shape != (expected_count,)
        or not np.all(np.isfinite(probability))
        or np.any((probability < 0.0) | (probability > 1.0))
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "MODEL_PROBABILITY_INVALID",
        )
    return probability


def _fold_set_identity(folds: Sequence[FoldMembership]) -> str:
    if len(folds) != N_FOLDS:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "FOLD_COUNT_INVALID",
        )
    return canonical_sha256([fold.membership_sha256 for fold in folds])


def evaluate_candidate(
    matrix: np.ndarray,
    labels: np.ndarray,
    folds: Sequence[FoldMembership],
    candidate: SearchCandidate,
    *,
    baseline: bool = False,
    num_boost_round: int | None = None,
    early_stopping_rounds: int | None = None,
) -> CandidateResult:
    lgb = require_official_lightgbm()
    if matrix.dtype != np.float32 or matrix.ndim != 2 or matrix.shape[0] != len(labels):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "TRAINING_MATRIX_INVALID",
        )
    if set(np.asarray(labels).tolist()) != {0, 1}:
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "TRAINING_LABEL_SUPPORT_INVALID",
        )
    expected_rounds = BASELINE_NUM_BOOST_ROUND if baseline else SEARCH_NUM_BOOST_ROUND
    expected_stopping = (
        BASELINE_EARLY_STOPPING_ROUNDS if baseline else SEARCH_EARLY_STOPPING_ROUNDS
    )
    rounds = expected_rounds if num_boost_round is None else num_boost_round
    stopping = expected_stopping if early_stopping_rounds is None else early_stopping_rounds
    if rounds <= 0 or stopping <= 0:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "BOOSTING_CONFIGURATION_INVALID",
        )
    parameters = {**FIXED_PARAMS, **dict(candidate.parameters)}
    if any(key in parameters for key in ("class_weight", "is_unbalance", "scale_pos_weight")):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CLASS_WEIGHTING_PROHIBITED",
        )
    fold_ap: list[float] = []
    fold_loss: list[float] = []
    fold_iterations: list[int] = []
    warning_count = 0
    started = time.perf_counter()
    for fold in folds:
        fit_index = fold.fit_indices
        valid_index = fold.validation_indices
        # New Dataset instances are intentionally created for every candidate/fold.
        fit_dataset = lgb.Dataset(
            matrix[fit_index],
            label=labels[fit_index],
            free_raw_data=True,
        )
        valid_dataset = lgb.Dataset(
            matrix[valid_index],
            label=labels[valid_index],
            reference=fit_dataset,
            free_raw_data=True,
        )
        with warnings.catch_warnings(record=True) as captured:
            warnings.simplefilter("always")
            booster = lgb.train(
                params=parameters,
                train_set=fit_dataset,
                num_boost_round=rounds,
                valid_sets=[valid_dataset],
                valid_names=["fold_validation"],
                callbacks=[
                    lgb.early_stopping(
                        stopping_rounds=stopping,
                        first_metric_only=True,
                        verbose=False,
                    ),
                    lgb.log_evaluation(period=0),
                ],
            )
        warning_count += len(captured)
        iteration = int(booster.best_iteration)
        if iteration <= 0:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "BEST_ITERATION_INVALID",
            )
        probability = _validated_probability(
            booster.predict(matrix[valid_index], num_iteration=iteration),
            len(valid_index),
        )
        fold_ap.append(float(average_precision_score(labels[valid_index], probability)))
        fold_loss.append(float(log_loss(labels[valid_index], probability, labels=[0, 1])))
        fold_iterations.append(iteration)
    elapsed = time.perf_counter() - started
    if len(fold_ap) != N_FOLDS:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CANDIDATE_FOLD_RUN_COUNT_INVALID",
        )
    median_iteration = int(np.median(np.asarray(fold_iterations, dtype=np.int64)))
    return CandidateResult(
        candidate_id=candidate.candidate_id,
        parameters=dict(candidate.parameters),
        fold_average_precision=tuple(fold_ap),
        fold_binary_log_loss=tuple(fold_loss),
        fold_best_iteration=tuple(fold_iterations),
        mean_average_precision=float(np.mean(fold_ap)),
        std_average_precision=float(np.std(fold_ap, ddof=1)),
        median_best_iteration=median_iteration,
        warning_count=warning_count,
        error_count=0,
        elapsed_seconds=float(elapsed),
        fold_set_sha256=_fold_set_identity(folds),
    )


def evaluate_baseline(
    matrix: np.ndarray,
    labels: np.ndarray,
    folds: Sequence[FoldMembership],
    *,
    test_round_override: int | None = None,
    test_stopping_override: int | None = None,
) -> CandidateResult:
    return evaluate_candidate(
        matrix,
        labels,
        folds,
        SearchCandidate("baseline-fixed-v1", BASELINE_PARAMS),
        baseline=True,
        num_boost_round=test_round_override,
        early_stopping_rounds=test_stopping_override,
    )


def run_random_search(
    matrix: np.ndarray,
    labels: np.ndarray,
    folds: Sequence[FoldMembership],
    candidates: Sequence[SearchCandidate],
    *,
    smoke: bool = False,
    test_round_override: int | None = None,
    test_stopping_override: int | None = None,
) -> tuple[CandidateResult, ...]:
    expected = SMOKE_CANDIDATE_COUNT if smoke else FINAL_CANDIDATE_COUNT
    selected = tuple(candidates[:expected])
    if len(candidates) != FINAL_CANDIDATE_COUNT or len(selected) != expected:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SEARCH_CANDIDATE_BUDGET_INVALID",
        )
    results: list[CandidateResult] = []
    for candidate in selected:
        started = time.perf_counter()
        try:
            results.append(
                evaluate_candidate(
                    matrix,
                    labels,
                    folds,
                    candidate,
                    num_boost_round=test_round_override,
                    early_stopping_rounds=test_stopping_override,
                )
            )
        except Exception as exc:
            reason_code = (
                exc.reason_code
                if isinstance(exc, ExperimentError)
                else "LIGHTGBM_CANDIDATE_FAILED"
            )
            results.append(
                CandidateResult(
                    candidate_id=candidate.candidate_id,
                    parameters=dict(candidate.parameters),
                    fold_average_precision=(),
                    fold_binary_log_loss=(),
                    fold_best_iteration=(),
                    mean_average_precision=None,
                    std_average_precision=None,
                    median_best_iteration=None,
                    warning_count=0,
                    error_count=1,
                    elapsed_seconds=float(time.perf_counter() - started),
                    fold_set_sha256=_fold_set_identity(folds),
                    status="failed",
                    error_reason_code=reason_code,
                )
            )
    if len(results) != expected:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SEARCH_INCOMPLETE",
        )
    if len({result.fold_set_sha256 for result in results}) != 1:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SEARCH_FOLD_SET_DRIFT",
        )
    if any(result.error_count for result in results):
        raise SearchIncompleteError(results)
    return tuple(results)


def select_best_candidate(results: Sequence[CandidateResult]) -> CandidateResult:
    if (
        not results
        or any(result.error_count for result in results)
        or any(
            result.mean_average_precision is None
            or result.std_average_precision is None
            for result in results
        )
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "NO_COMPLETE_SEARCH_RESULT",
        )
    return min(
        results,
        key=lambda result: (
            -result.mean_average_precision,
            result.std_average_precision,
            result.candidate_id,
        ),
    )


def final_best_iteration(result: CandidateResult) -> int:
    if len(result.fold_best_iteration) != N_FOLDS:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "BEST_ITERATION_FOLD_COUNT_INVALID",
        )
    value = int(np.median(np.asarray(result.fold_best_iteration, dtype=np.int64)))
    if value <= 0:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "BEST_ITERATION_INVALID",
        )
    return value


def refit_full_train(
    matrix: np.ndarray,
    labels: np.ndarray,
    result: CandidateResult,
) -> Any:
    lgb = require_official_lightgbm()
    iteration = final_best_iteration(result)
    parameters = {**FIXED_PARAMS, **dict(result.parameters)}
    dataset = lgb.Dataset(matrix, label=labels, free_raw_data=True)
    booster = lgb.train(
        params=parameters,
        train_set=dataset,
        num_boost_round=iteration,
        callbacks=[lgb.log_evaluation(period=0)],
    )
    if int(booster.num_feature()) != int(matrix.shape[1]):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_DIMENSION_MISMATCH,
            "MODEL_FEATURE_COUNT_MISMATCH",
        )
    _validated_probability(booster.predict(matrix, num_iteration=iteration), len(labels))
    return booster


def save_model_with_parity(
    booster: Any,
    path: Path,
    *,
    parity_matrix: np.ndarray,
    best_iteration: int,
) -> None:
    lgb = require_official_lightgbm()
    if best_iteration <= 0 or parity_matrix.ndim != 2 or parity_matrix.shape[0] == 0:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "MODEL_PARITY_INPUT_INVALID",
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    if temporary.exists():
        temporary.unlink()
    booster.save_model(str(temporary), num_iteration=best_iteration)
    loaded = lgb.Booster(model_file=str(temporary))
    before = _validated_probability(
        booster.predict(parity_matrix, num_iteration=best_iteration),
        len(parity_matrix),
    )
    after = _validated_probability(
        loaded.predict(parity_matrix, num_iteration=best_iteration),
        len(parity_matrix),
    )
    if int(loaded.num_feature()) != parity_matrix.shape[1] or not np.allclose(
        before, after, rtol=0.0, atol=1e-12
    ):
        temporary.unlink(missing_ok=True)
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "MODEL_SAVE_LOAD_PARITY_FAILED",
        )
    temporary.replace(path)


def generate_oof_probabilities(
    matrix: np.ndarray,
    labels: np.ndarray,
    family_ids: Sequence[str] | np.ndarray,
    folds: Sequence[FoldMembership],
    result: CandidateResult,
    *,
    test_round_override: int | None = None,
) -> np.ndarray:
    lgb = require_official_lightgbm()
    iteration = final_best_iteration(result) if test_round_override is None else test_round_override
    if iteration <= 0:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "OOF_ITERATION_INVALID",
        )
    families = np.asarray(family_ids, dtype=object)
    if len(families) != len(labels):
        raise ExperimentError(
            ExperimentStatus.BLOCKED_INVALID_FOLD,
            "OOF_ROW_ALIGNMENT_MISMATCH",
        )
    probability = np.full(len(labels), np.nan, dtype=np.float64)
    coverage = np.zeros(len(labels), dtype=np.int8)
    parameters = {**FIXED_PARAMS, **dict(result.parameters)}
    for fold in folds:
        fit = fold.fit_indices
        valid = fold.validation_indices
        if set(families[fit].tolist()) & set(families[valid].tolist()):
            raise ExperimentError(
                ExperimentStatus.BLOCKED_INVALID_FOLD,
                "OOF_SELF_FIT_FAMILY_LEAKAGE",
            )
        dataset = lgb.Dataset(matrix[fit], label=labels[fit], free_raw_data=True)
        booster = lgb.train(
            params=parameters,
            train_set=dataset,
            num_boost_round=iteration,
            callbacks=[lgb.log_evaluation(period=0)],
        )
        probability[valid] = _validated_probability(
            booster.predict(matrix[valid], num_iteration=iteration),
            len(valid),
        )
        coverage[valid] += 1
    if not np.all(coverage == 1) or not np.all(np.isfinite(probability)):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "OOF_EXACTLY_ONCE_COVERAGE_FAILED",
        )
    return probability
