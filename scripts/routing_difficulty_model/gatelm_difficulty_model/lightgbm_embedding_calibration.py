"""OOF calibration, safety-constrained thresholding, and aggregate metrics."""

from __future__ import annotations

import importlib.metadata
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    fbeta_score,
    log_loss,
    precision_recall_fscore_support,
    roc_auc_score,
)

from .lightgbm_embedding_experiment import (
    CATEGORIES,
    EXPERIMENT_SEED,
    REQUIRED_SLICES,
    ExperimentError,
    ExperimentStatus,
    canonical_json_bytes,
    canonical_sha256,
)


CALIBRATOR_FORMAT_VERSION = "gatelm.lightgbm-embedding-calibrator.v1"
CALIBRATOR_NAMES = ("none", "platt", "isotonic")
C_FP = 1.0
C_FN_SCENARIOS = (1.0, 3.0, 5.0, 10.0)
MIN_COMPLEX_RECALL = 0.95
CALIBRATION_EPSILON = 1e-12


def _probability(values: Any, *, reason_code: str) -> np.ndarray:
    result = np.asarray(values, dtype=np.float64)
    if (
        result.ndim != 1
        or result.size == 0
        or not np.all(np.isfinite(result))
        or np.any((result < 0.0) | (result > 1.0))
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            reason_code,
        )
    return result


def _labels(values: Any, *, expected_count: int | None = None) -> np.ndarray:
    labels = np.asarray(values, dtype=np.int8)
    if (
        labels.ndim != 1
        or labels.size == 0
        or (expected_count is not None and labels.size != expected_count)
        or any(value not in (0, 1) for value in labels.tolist())
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CALIBRATION_LABELS_INVALID",
        )
    return labels


def probability_logit(values: Any) -> np.ndarray:
    probability = _probability(values, reason_code="CALIBRATION_PROBABILITY_INVALID")
    clipped = np.clip(probability, CALIBRATION_EPSILON, 1.0 - CALIBRATION_EPSILON)
    return np.log(clipped / (1.0 - clipped))


@dataclass(frozen=True)
class CalibratorArtifact:
    calibrator_type: str
    payload: Mapping[str, Any]

    def as_json(self) -> dict[str, Any]:
        material = {
            "schemaVersion": CALIBRATOR_FORMAT_VERSION,
            "type": self.calibrator_type,
            "libraryVersions": {
                "numpy": importlib.metadata.version("numpy"),
                "scikitLearn": importlib.metadata.version("scikit-learn"),
            },
            "parameters": dict(self.payload),
            "unsafePickle": False,
            "containsPerSampleScore": False,
        }
        material["contentSha256"] = canonical_sha256(material)
        material["sizeBytes"] = len(canonical_json_bytes(material))
        return material


def validate_calibrator_artifact(artifact: Mapping[str, Any]) -> None:
    if artifact.get("schemaVersion") != CALIBRATOR_FORMAT_VERSION:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CALIBRATOR_SCHEMA_INVALID",
        )
    calibrator_type = artifact.get("type")
    parameters = artifact.get("parameters")
    if calibrator_type not in CALIBRATOR_NAMES or not isinstance(parameters, Mapping):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CALIBRATOR_TYPE_INVALID",
        )
    material = dict(artifact)
    expected_hash = material.pop("contentSha256", None)
    size = material.pop("sizeBytes", None)
    # Hash and size are generated over the artifact before these integrity fields.
    if expected_hash != canonical_sha256(material):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CALIBRATOR_CONTENT_HASH_MISMATCH",
        )
    reconstructed = dict(material)
    reconstructed["contentSha256"] = expected_hash
    if size != len(canonical_json_bytes(reconstructed)):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CALIBRATOR_SIZE_MISMATCH",
        )
    if artifact.get("unsafePickle") is not False or artifact.get("containsPerSampleScore") is not False:
        raise ExperimentError(
            ExperimentStatus.INVALID_DATA_SAFETY,
            "CALIBRATOR_UNSAFE_MATERIAL",
        )
    if calibrator_type == "none" and parameters != {"identity": True}:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "NONE_CALIBRATOR_PARAMETERS_INVALID",
        )
    if calibrator_type == "platt":
        if set(parameters) != {"coefficient", "intercept", "epsilon"}:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "PLATT_PARAMETERS_INVALID",
            )
        for field in ("coefficient", "intercept"):
            value = parameters.get(field)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ExperimentError(
                    ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                    "PLATT_PARAMETERS_INVALID",
                )
        if parameters.get("epsilon") != CALIBRATION_EPSILON:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "PLATT_EPSILON_INVALID",
            )
    if calibrator_type == "isotonic":
        if set(parameters) != {"xThresholds", "yThresholds", "outOfBounds"}:
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "ISOTONIC_PARAMETERS_INVALID",
            )
        x = np.asarray(parameters.get("xThresholds"), dtype=np.float64)
        y = np.asarray(parameters.get("yThresholds"), dtype=np.float64)
        if (
            x.ndim != 1
            or y.shape != x.shape
            or x.size < 2
            or not np.all(np.isfinite(x))
            or not np.all(np.isfinite(y))
            or np.any(np.diff(x) < 0)
            or np.any(np.diff(y) < 0)
            or np.any((y < 0.0) | (y > 1.0))
            or parameters.get("outOfBounds") != "clip"
        ):
            raise ExperimentError(
                ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
                "ISOTONIC_PARAMETERS_INVALID",
            )


def fit_calibrator(
    name: str,
    oof_probability: Any,
    labels: Any,
) -> CalibratorArtifact:
    probability = _probability(oof_probability, reason_code="OOF_PROBABILITY_INVALID")
    y = _labels(labels, expected_count=len(probability))
    if set(y.tolist()) != {0, 1}:
        raise ExperimentError(
            ExperimentStatus.INSUFFICIENT_EVIDENCE,
            "CALIBRATOR_LABEL_SUPPORT_INSUFFICIENT",
        )
    if name == "none":
        return CalibratorArtifact("none", {"identity": True})
    if name == "platt":
        model = LogisticRegression(
            penalty="l2",
            solver="lbfgs",
            max_iter=1000,
            random_state=EXPERIMENT_SEED,
        ).fit(probability_logit(probability).reshape(-1, 1), y)
        return CalibratorArtifact(
            "platt",
            {
                "coefficient": float(model.coef_[0, 0]),
                "intercept": float(model.intercept_[0]),
                "epsilon": CALIBRATION_EPSILON,
            },
        )
    if name == "isotonic":
        model = IsotonicRegression(out_of_bounds="clip").fit(probability, y)
        return CalibratorArtifact(
            "isotonic",
            {
                "xThresholds": [float(value) for value in model.X_thresholds_],
                "yThresholds": [float(value) for value in model.y_thresholds_],
                "outOfBounds": "clip",
            },
        )
    raise ExperimentError(
        ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
        "CALIBRATOR_NAME_INVALID",
    )


def apply_calibrator(artifact: Mapping[str, Any], raw_probability: Any) -> np.ndarray:
    validate_calibrator_artifact(artifact)
    raw = _probability(raw_probability, reason_code="RAW_PROBABILITY_INVALID")
    calibrator_type = str(artifact["type"])
    parameters = artifact["parameters"]
    if calibrator_type == "none":
        result = raw.copy()
    elif calibrator_type == "platt":
        logits = probability_logit(raw)
        linear = float(parameters["coefficient"]) * logits + float(parameters["intercept"])
        result = np.empty_like(linear)
        nonnegative = linear >= 0
        result[nonnegative] = 1.0 / (1.0 + np.exp(-linear[nonnegative]))
        exponential = np.exp(linear[~nonnegative])
        result[~nonnegative] = exponential / (1.0 + exponential)
    else:
        x = np.asarray(parameters["xThresholds"], dtype=np.float64)
        y = np.asarray(parameters["yThresholds"], dtype=np.float64)
        result = np.interp(raw, x, y, left=y[0], right=y[-1])
    return _probability(result, reason_code="CALIBRATED_PROBABILITY_INVALID")


@dataclass(frozen=True)
class CalibrationSelection:
    selected_artifact: Mapping[str, Any]
    selected_probability: np.ndarray
    aggregate_results: tuple[Mapping[str, Any], ...]


def select_calibrator(
    *,
    oof_probability: Any,
    train_labels: Any,
    validation_raw_probability: Any,
    validation_labels: Any,
) -> CalibrationSelection:
    validation_raw = _probability(
        validation_raw_probability,
        reason_code="VALIDATION_RAW_PROBABILITY_INVALID",
    )
    validation_y = _labels(validation_labels, expected_count=len(validation_raw))
    results: list[tuple[dict[str, Any], np.ndarray, dict[str, Any]]] = []
    for name in CALIBRATOR_NAMES:
        artifact = fit_calibrator(name, oof_probability, train_labels).as_json()
        calibrated = apply_calibrator(artifact, validation_raw)
        aggregate = {
            "name": name,
            "validationBrierScore": float(brier_score_loss(validation_y, calibrated)),
            "validationLogLoss": float(log_loss(validation_y, calibrated, labels=[0, 1])),
            "artifactContentSha256": artifact["contentSha256"],
            "artifactSizeBytes": artifact["sizeBytes"],
        }
        if name == "isotonic":
            aggregate["effectiveSteps"] = len(artifact["parameters"]["xThresholds"])
        results.append((artifact, calibrated, aggregate))
    selected_artifact, selected_probability, _ = min(
        results,
        key=lambda item: (
            item[2]["validationBrierScore"],
            item[2]["validationLogLoss"],
            item[2]["name"],
        ),
    )
    return CalibrationSelection(
        selected_artifact=selected_artifact,
        selected_probability=selected_probability,
        aggregate_results=tuple(item[2] for item in results),
    )


def threshold_candidates(probability: Any) -> np.ndarray:
    values = _probability(probability, reason_code="THRESHOLD_PROBABILITY_INVALID")
    unique = np.unique(values)[::-1]
    all_simple = np.nextafter(float(unique[0]), np.inf)
    candidates = np.concatenate(([all_simple], unique))
    if len(candidates) != len(unique) + 1 or candidates[-1] != float(unique[-1]):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "THRESHOLD_CANDIDATES_INVALID",
        )
    return candidates


def _confusion(labels: np.ndarray, prediction: np.ndarray) -> tuple[int, int, int, int]:
    matrix = confusion_matrix(labels, prediction, labels=[0, 1])
    tn, fp, fn, tp = (int(value) for value in matrix.ravel())
    return tn, fp, fn, tp


@dataclass(frozen=True)
class ThresholdScenario:
    c_fn: float
    status: str
    feasible_candidate_count: int
    selected: Mapping[str, Any] | None
    reason_code: str | None

    def as_json(self) -> dict[str, Any]:
        return {
            "cFn": self.c_fn,
            "cFp": C_FP,
            "bayesThreshold": C_FP / (C_FP + self.c_fn),
            "status": self.status,
            "feasibleCandidateCount": self.feasible_candidate_count,
            "selected": None if self.selected is None else dict(self.selected),
            "reasonCode": self.reason_code,
        }


def select_threshold_for_cost(
    *,
    c_fn: float,
    probability: Any,
    labels: Any,
    categories: Sequence[str],
    champion_prediction: Any,
    row_identity_sha256: str,
    champion_row_identity_sha256: str,
) -> ThresholdScenario:
    if c_fn not in C_FN_SCENARIOS:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "C_FN_SCENARIO_INVALID",
        )
    values = _probability(probability, reason_code="THRESHOLD_PROBABILITY_INVALID")
    y = _labels(labels, expected_count=len(values))
    category_values = np.asarray(categories, dtype=object)
    champion = np.asarray(champion_prediction, dtype=np.int8)
    if (
        len(category_values) != len(values)
        or champion.shape != y.shape
        or any(value not in (0, 1) for value in champion.tolist())
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "THRESHOLD_ROW_ALIGNMENT_MISMATCH",
        )
    if row_identity_sha256 != champion_row_identity_sha256:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CHAMPION_ROW_IDENTITY_MISMATCH",
        )
    if set(category_values.tolist()) != set(CATEGORIES):
        return ThresholdScenario(
            c_fn=c_fn,
            status="infeasible",
            feasible_candidate_count=0,
            selected=None,
            reason_code="CATEGORY_EVIDENCE_INCOMPLETE",
        )
    _, _, champion_fn, _ = _confusion(y, champion)
    champion_category_fn = {
        category: _confusion(y[category_values == category], champion[category_values == category])[2]
        for category in CATEGORIES
    }
    bayes = C_FP / (C_FP + c_fn)
    feasible: list[dict[str, Any]] = []
    for threshold in threshold_candidates(values):
        prediction = (values >= threshold).astype(np.int8)
        tn, fp, fn, tp = _confusion(y, prediction)
        complex_support = fn + tp
        recall = tp / complex_support if complex_support else math.nan
        category_fn = {
            category: _confusion(
                y[category_values == category],
                prediction[category_values == category],
            )[2]
            for category in CATEGORIES
        }
        category_passed = all(
            category_fn[category] <= champion_category_fn[category]
            for category in CATEGORIES
        )
        if not (
            fn <= champion_fn
            and category_passed
            and math.isfinite(recall)
            and recall >= MIN_COMPLEX_RECALL
        ):
            continue
        feasible.append(
            {
                "threshold": float(threshold),
                "trueNegative": tn,
                "falsePositive": fp,
                "falseNegative": fn,
                "truePositive": tp,
                "complexRecall": float(recall),
                "expectedDecisionLoss": float((c_fn * fn + C_FP * fp) / len(y)),
                "overallSafetyPassed": True,
                "categorySafetyPassed": True,
                "categoryFalseNegative": category_fn,
                "championFalseNegative": champion_fn,
                "championCategoryFalseNegative": champion_category_fn,
            }
        )
    if not feasible:
        return ThresholdScenario(
            c_fn=c_fn,
            status="infeasible",
            feasible_candidate_count=0,
            selected=None,
            reason_code="NO_SAFETY_CONSTRAINED_THRESHOLD",
        )
    selected = min(
        feasible,
        key=lambda item: (
            item["expectedDecisionLoss"],
            item["falseNegative"],
            abs(item["threshold"] - bayes),
            item["threshold"],
        ),
    )
    return ThresholdScenario(
        c_fn=c_fn,
        status="feasible",
        feasible_candidate_count=len(feasible),
        selected=selected,
        reason_code=None,
    )


def select_threshold_scenarios(
    *,
    probability: Any,
    labels: Any,
    categories: Sequence[str],
    champion_prediction: Any,
    row_identity_sha256: str,
    champion_row_identity_sha256: str,
) -> tuple[ThresholdScenario, ...]:
    return tuple(
        select_threshold_for_cost(
            c_fn=c_fn,
            probability=probability,
            labels=labels,
            categories=categories,
            champion_prediction=champion_prediction,
            row_identity_sha256=row_identity_sha256,
            champion_row_identity_sha256=champion_row_identity_sha256,
        )
        for c_fn in C_FN_SCENARIOS
    )


def _quantile(values: Sequence[float]) -> dict[str, float] | None:
    if not values:
        return None
    array = np.asarray(values, dtype=np.float64)
    return {
        "lower": float(np.quantile(array, 0.025)),
        "median": float(np.quantile(array, 0.5)),
        "upper": float(np.quantile(array, 0.975)),
    }


def family_group_threshold_bootstrap(
    *,
    probability: Any,
    labels: Any,
    categories: Sequence[str],
    champion_prediction: Any,
    family_ids: Sequence[str],
    c_fn: float,
    repeats: int = 1000,
    seed: int = EXPERIMENT_SEED,
) -> dict[str, Any]:
    values = _probability(probability, reason_code="BOOTSTRAP_PROBABILITY_INVALID")
    y = _labels(labels, expected_count=len(values))
    category_values = np.asarray(categories, dtype=object)
    champion = np.asarray(champion_prediction, dtype=np.int8)
    families = np.asarray(family_ids, dtype=object)
    if any(len(item) != len(values) for item in (category_values, champion, families)):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "BOOTSTRAP_ROW_ALIGNMENT_MISMATCH",
        )
    if (
        isinstance(repeats, bool)
        or not isinstance(repeats, int)
        or repeats <= 0
        or repeats > 100000
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "BOOTSTRAP_REPEAT_COUNT_INVALID",
        )
    unique_families = np.asarray(sorted(set(str(value) for value in families)), dtype=object)
    if unique_families.size == 0 or any(not value for value in unique_families):
        raise ExperimentError(
            ExperimentStatus.INSUFFICIENT_EVIDENCE,
            "BOOTSTRAP_FAMILY_SUPPORT_INSUFFICIENT",
        )
    indices_by_family = {
        family: np.flatnonzero(families == family) for family in unique_families.tolist()
    }
    rng = np.random.default_rng(seed)
    aggregate: dict[str, list[float]] = {
        "threshold": [],
        "falseNegative": [],
        "falsePositive": [],
        "complexRecall": [],
        "expectedDecisionLoss": [],
    }
    infeasible = 0
    for _ in range(repeats):
        sampled = rng.choice(unique_families, size=len(unique_families), replace=True)
        index = np.concatenate([indices_by_family[str(family)] for family in sampled.tolist()])
        identity = canonical_sha256({"bootstrap": "process_local"})
        scenario = select_threshold_for_cost(
            c_fn=c_fn,
            probability=values[index],
            labels=y[index],
            categories=category_values[index].tolist(),
            champion_prediction=champion[index],
            row_identity_sha256=identity,
            champion_row_identity_sha256=identity,
        )
        if scenario.selected is None:
            infeasible += 1
            continue
        for field in aggregate:
            aggregate[field].append(float(scenario.selected[field]))
    return {
        "method": "family_group_percentile",
        "seed": seed,
        "repeats": repeats,
        "familyCount": int(unique_families.size),
        "feasibleReplicates": repeats - infeasible,
        "infeasibleReplicates": infeasible,
        "intervals": {field: _quantile(values) for field, values in aggregate.items()},
        "usedForSelection": False,
        "containsPerSampleResult": False,
    }


def classification_metrics(
    *,
    labels: Any,
    probability: Any,
    threshold: float,
    c_fn_scenarios: Sequence[float] = C_FN_SCENARIOS,
) -> dict[str, Any]:
    values = _probability(probability, reason_code="METRIC_PROBABILITY_INVALID")
    y = _labels(labels, expected_count=len(values))
    if set(y.tolist()) != {0, 1}:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "TEST_LABEL_SUPPORT_PROTOCOL_FAILURE",
        )
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(float(threshold))
        or float(threshold) < 0.0
        or float(threshold) > 1.0
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "FROZEN_THRESHOLD_INVALID",
        )
    prediction = (values >= float(threshold)).astype(np.int8)
    tn, fp, fn, tp = _confusion(y, prediction)
    precision, recall, f1, support = precision_recall_fscore_support(
        y,
        prediction,
        labels=[0, 1],
        zero_division=0,
    )
    result = {
        "records": len(y),
        "threshold": float(threshold),
        "accuracy": float(accuracy_score(y, prediction)),
        "macroF1": float(f1_score(y, prediction, average="macro")),
        "simple": {
            "precision": float(precision[0]),
            "recall": float(recall[0]),
            "f1": float(f1[0]),
            "support": int(support[0]),
        },
        "complex": {
            "precision": float(precision[1]),
            "recall": float(recall[1]),
            "f1": float(f1[1]),
            "f2": float(fbeta_score(y, prediction, beta=2, pos_label=1)),
            "support": int(support[1]),
        },
        "rocAuc": float(roc_auc_score(y, values)),
        "averagePrecision": float(average_precision_score(y, values)),
        "brierScore": float(brier_score_loss(y, values)),
        "logLoss": float(log_loss(y, values, labels=[0, 1])),
        "confusionMatrix": {
            "order": [["actual_simple_predicted_simple", "actual_simple_predicted_complex"],
                      ["actual_complex_predicted_simple", "actual_complex_predicted_complex"]],
            "trueNegative": tn,
            "falsePositive": fp,
            "falseNegative": fn,
            "truePositive": tp,
        },
        "falseNegative": fn,
        "falsePositive": fp,
        "expectedDecisionLoss": {
            str(float(c_fn)): float((float(c_fn) * fn + C_FP * fp) / len(y))
            for c_fn in c_fn_scenarios
        },
    }
    if tn + fp + fn + tp != len(y):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "CONFUSION_MATRIX_INCONSISTENT",
        )
    return result


def aggregate_category_and_slice_metrics(
    *,
    labels: Any,
    probability: Any,
    threshold: float,
    family_ids: Sequence[str],
    categories: Sequence[str],
    slice_membership: Sequence[Sequence[str]],
    champion_prediction: Any,
) -> dict[str, Any]:
    values = _probability(probability, reason_code="SLICE_PROBABILITY_INVALID")
    y = _labels(labels, expected_count=len(values))
    families = np.asarray(family_ids, dtype=object)
    category_values = np.asarray(categories, dtype=object)
    champion = np.asarray(champion_prediction, dtype=np.int8)
    if any(len(item) != len(values) for item in (families, category_values, champion, slice_membership)):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SLICE_ROW_ALIGNMENT_MISMATCH",
        )
    if any(
        not isinstance(memberships, Sequence) or isinstance(memberships, (str, bytes))
        for memberships in slice_membership
    ):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SLICE_MEMBERSHIP_INVALID",
        )
    prediction = (values >= threshold).astype(np.int8)

    def summary(index: np.ndarray) -> dict[str, Any]:
        labels_at = y[index]
        prediction_at = prediction[index]
        champion_at = champion[index]
        simple = int(np.sum(labels_at == 0))
        complex_count = int(np.sum(labels_at == 1))
        fn = int(np.sum((labels_at == 1) & (prediction_at == 0)))
        fp = int(np.sum((labels_at == 0) & (prediction_at == 1)))
        champion_fn = int(np.sum((labels_at == 1) & (champion_at == 0)))
        return {
            "records": int(index.size),
            "families": len(set(families[index].tolist())),
            "simpleSupport": simple,
            "complexSupport": complex_count,
            "accuracy": (
                float(np.mean(labels_at == prediction_at)) if index.size else "not_computable"
            ),
            "complexRecall": (
                float((complex_count - fn) / complex_count)
                if complex_count
                else "not_computable"
            ),
            "falseNegative": fn,
            "falsePositive": fp,
            "championFalseNegative": champion_fn,
            "safetyPassed": fn <= champion_fn if complex_count else "insufficient",
            "evidence": "sufficient" if simple and complex_count else "insufficient",
        }

    category_result = {
        category: summary(np.flatnonzero(category_values == category)) for category in CATEGORIES
    }
    membership_sets = [set(str(value) for value in memberships) for memberships in slice_membership]
    if any(not values.issubset(REQUIRED_SLICES) for values in membership_sets):
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "SLICE_NAME_INVALID",
        )
    slice_result = {
        slice_name: summary(
            np.asarray(
                [index for index, values in enumerate(membership_sets) if slice_name in values],
                dtype=np.int64,
            )
        )
        for slice_name in REQUIRED_SLICES
    }
    return {"categories": category_result, "slices": slice_result}


def family_group_metric_bootstrap(
    *,
    labels: Any,
    probability: Any,
    threshold: float,
    family_ids: Sequence[str],
    repeats: int = 1000,
    seed: int = EXPERIMENT_SEED,
) -> dict[str, Any]:
    values = _probability(probability, reason_code="METRIC_BOOTSTRAP_PROBABILITY_INVALID")
    y = _labels(labels, expected_count=len(values))
    families = np.asarray(family_ids, dtype=object)
    if len(families) != len(values) or not 1 <= repeats <= 100000:
        raise ExperimentError(
            ExperimentStatus.INVALID_PROTOCOL_DEVIATION,
            "METRIC_BOOTSTRAP_CONFIGURATION_INVALID",
        )
    unique = np.asarray(sorted(set(str(value) for value in families)), dtype=object)
    indices_by_family = {family: np.flatnonzero(families == family) for family in unique.tolist()}
    rng = np.random.default_rng(seed)
    metrics: dict[str, list[float]] = {
        "accuracy": [],
        "macroF1": [],
        "complexRecall": [],
        "falseNegative": [],
        "falsePositive": [],
        "averagePrecision": [],
        "brierScore": [],
    }
    invalid = 0
    for _ in range(repeats):
        sampled = rng.choice(unique, size=len(unique), replace=True)
        index = np.concatenate([indices_by_family[str(family)] for family in sampled.tolist()])
        if set(y[index].tolist()) != {0, 1}:
            invalid += 1
            continue
        aggregate = classification_metrics(
            labels=y[index],
            probability=values[index],
            threshold=threshold,
        )
        for field in metrics:
            if field == "complexRecall":
                value = aggregate["complex"]["recall"]
            else:
                value = aggregate[field]
            metrics[field].append(float(value))
    return {
        "method": "family_group_percentile",
        "seed": seed,
        "repeats": repeats,
        "validReplicates": repeats - invalid,
        "invalidReplicates": invalid,
        "intervals": {field: _quantile(values) for field, values in metrics.items()},
        "containsPerSampleResult": False,
    }
