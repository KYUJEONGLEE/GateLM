"""Calibration-only threshold feasibility for an already frozen difficulty model.

Scores are process-local inputs.  The returned evidence contains aggregate
classification and gate material only.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from .promotion_holdout import build_gate, classification_summary


REPORT_SCHEMA = "gatelm.difficulty-calibration-threshold-feasibility.v1"


def family_grouped_oof_calibrated_scores(
    samples: Sequence[Mapping[str, Any]],
    vectors: Sequence[Sequence[float]],
    artifact: Mapping[str, Any],
    calibration_policy: dict[str, Any],
) -> list[float | None]:
    """Return aligned process-local OOF scores without reading a holdout split."""

    import numpy as np

    from .training import _fit_calibrator, _group_folds

    rows = list(samples)
    material = list(vectors)
    if not rows or len(rows) != len(material):
        raise ValueError("calibration samples and vectors must align")
    if any(sample.get("split") != "calibration" for sample in rows):
        raise ValueError("OOF calibration accepts calibration samples only")
    weights = np.asarray(artifact.get("weights"), dtype=np.float64)
    bias = artifact.get("bias")
    if weights.ndim != 1 or len(weights) == 0 or not np.all(np.isfinite(weights)):
        raise ValueError("frozen artifact weights must be a finite vector")
    if isinstance(bias, bool) or not isinstance(bias, (int, float)) or not math.isfinite(float(bias)):
        raise ValueError("frozen artifact bias must be finite")
    calibrator_kind = artifact.get("calibrator", {}).get("type")
    if calibrator_kind not in {"platt", "isotonic"}:
        raise ValueError("frozen artifact calibrator type is unsupported")
    group_folds = calibration_policy.get("groupFolds")
    if isinstance(group_folds, bool) or not isinstance(group_folds, int) or group_folds < 2:
        raise ValueError("calibration group folds must be an integer of at least two")

    model_indices = [index for index, sample in enumerate(rows) if sample.get("modelPath") is True]
    if not model_indices:
        raise ValueError("OOF calibration requires model-path samples")
    if any(not isinstance(sample.get("modelPath"), bool) for sample in rows):
        raise ValueError("calibration sample model-path metadata is invalid")
    matrix = np.asarray([material[index] for index in model_indices], dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[1] != len(weights) or not np.all(np.isfinite(matrix)):
        raise ValueError("calibration vectors do not match the frozen artifact dimension")
    labels = np.asarray(
        [1 if rows[index].get("expectedDifficulty") == "complex" else 0 for index in model_indices],
        dtype=np.int64,
    )
    if any(rows[index].get("expectedDifficulty") not in {"simple", "complex"} for index in model_indices):
        raise ValueError("calibration samples contain an invalid difficulty label")
    groups = np.asarray([rows[index].get("familyId") for index in model_indices], dtype=object)
    if any(not isinstance(group, str) or not group for group in groups):
        raise ValueError("calibration samples require non-empty family IDs")

    logits = matrix @ weights + float(bias)
    raw = np.empty_like(logits)
    nonnegative = logits >= 0
    raw[nonnegative] = 1.0 / (1.0 + np.exp(-logits[nonnegative]))
    exponential = np.exp(logits[~nonnegative])
    raw[~nonnegative] = exponential / (1.0 + exponential)

    splitter = _group_folds(groups, group_folds)
    oof = np.full(len(model_indices), np.nan, dtype=np.float64)
    for fit_indices, validation_indices in splitter.split(raw, labels, groups):
        apply, _, _ = _fit_calibrator(
            calibrator_kind,
            raw[fit_indices],
            labels[fit_indices],
            calibration_policy,
        )
        oof[validation_indices] = apply(raw[validation_indices])
    if not np.all(np.isfinite(oof)) or np.any(oof < 0.0) or np.any(oof > 1.0):
        raise ValueError("family-grouped calibration did not produce finite OOF scores")

    result: list[float | None] = [None] * len(rows)
    for source_index, score in zip(model_indices, oof):
        result[source_index] = float(score)
    return result


def _threshold_grid(step: float) -> list[float]:
    if isinstance(step, bool) or not isinstance(step, (int, float)):
        raise ValueError("threshold step must be numeric")
    value = float(step)
    if not math.isfinite(value) or value <= 0.0 or value > 1.0:
        raise ValueError("threshold step must be finite within (0, 1]")
    intervals = round(1.0 / value)
    if intervals <= 0 or intervals > 1000 or not math.isclose(
        intervals * value, 1.0, rel_tol=0.0, abs_tol=1e-12
    ):
        raise ValueError("threshold step must divide 1.0 exactly with at most 1000 intervals")
    return [round(index * value, 12) for index in range(intervals + 1)]


def evaluate_threshold_feasibility(
    samples: Sequence[Mapping[str, Any]],
    oof_scores: Sequence[float | None],
    *,
    reference_threshold: float,
    threshold_step: float,
    minimum_accuracy: float,
    maximum_complex_to_simple_count: int,
) -> dict[str, Any]:
    """Select a safety-constrained fixed-grid threshold from calibration OOF scores."""

    rows = list(samples)
    scores = list(oof_scores)
    if not rows or len(rows) != len(scores):
        raise ValueError("calibration samples and OOF scores must align")
    if any(sample.get("split") != "calibration" for sample in rows):
        raise ValueError("threshold feasibility accepts calibration samples only")
    if (
        isinstance(reference_threshold, bool)
        or not isinstance(reference_threshold, (int, float))
        or not 0.0 <= float(reference_threshold) <= 1.0
    ):
        raise ValueError("reference threshold must be within [0, 1]")
    if (
        isinstance(minimum_accuracy, bool)
        or not isinstance(minimum_accuracy, (int, float))
        or not 0.0 <= float(minimum_accuracy) <= 1.0
    ):
        raise ValueError("minimum accuracy must be within [0, 1]")
    if (
        isinstance(maximum_complex_to_simple_count, bool)
        or not isinstance(maximum_complex_to_simple_count, int)
        or maximum_complex_to_simple_count < 0
    ):
        raise ValueError("maximum complex-to-simple count must be a non-negative integer")

    for index, (sample, score) in enumerate(zip(rows, scores)):
        if sample.get("expectedDifficulty") not in {"simple", "complex"}:
            raise ValueError(f"calibration sample {index} has an invalid expected difficulty")
        if sample.get("ruleDifficulty") not in {"simple", "complex"}:
            raise ValueError(f"calibration sample {index} has an invalid rule difficulty")
        if not isinstance(sample.get("expectedCategory"), str) or not sample["expectedCategory"]:
            raise ValueError(f"calibration sample {index} has no expected category")
        if not isinstance(sample.get("modelPath"), bool):
            raise ValueError(f"calibration sample {index} has invalid model-path metadata")
        if sample["modelPath"]:
            if (
                isinstance(score, bool)
                or not isinstance(score, (int, float))
                or not math.isfinite(float(score))
                or not 0.0 <= float(score) <= 1.0
            ):
                raise ValueError(f"calibration model-path sample {index} has no finite OOF score")
        elif score is not None:
            raise ValueError(f"calibration bypass sample {index} must not carry an OOF score")

    grid = _threshold_grid(threshold_step)
    reference = round(float(reference_threshold), 12)
    if reference not in grid:
        raise ValueError("reference threshold must be present in the fixed threshold grid")
    frozen_gate = {
        "minimumAccuracy": float(minimum_accuracy),
        "maximumComplexToSimpleCount": maximum_complex_to_simple_count,
        "categoryDirectionalErrorPolicy": (
            "candidate_complex_to_simple_count_and_rate_must_not_exceed_"
            "rule_baseline_in_any_expected_category"
        ),
    }
    baseline_predictions = [str(sample["ruleDifficulty"]) for sample in rows]
    baseline = classification_summary(rows, baseline_predictions)

    operating_points: list[dict[str, Any]] = []
    for threshold in grid:
        predictions = [
            (
                "complex"
                if sample["modelPath"] and float(score) >= threshold
                else "simple"
                if sample["modelPath"]
                else str(sample["ruleDifficulty"])
            )
            for sample, score in zip(rows, scores)
        ]
        classification = classification_summary(rows, predictions)
        operating_points.append(
            {
                "threshold": threshold,
                "classification": classification,
                "gate": build_gate(classification, baseline, frozen_gate),
            }
        )

    def selection_rank(point: Mapping[str, Any]) -> tuple[float, int, int, float, float]:
        return (
            -float(point["classification"]["accuracy"]),
            int(point["classification"]["complexToSimpleCount"]),
            int(point["classification"]["simpleToComplexCount"]),
            abs(float(point["threshold"]) - reference),
            float(point["threshold"]),
        )

    safety_constrained = [
        point
        for point in operating_points
        if point["gate"]["maximumComplexToSimpleCount"]["passed"]
        and point["gate"]["categoryNonRegressionVsRule"]["passed"]
    ]
    best_safety_constrained = (
        min(safety_constrained, key=selection_rank) if safety_constrained else None
    )
    feasible = [point for point in safety_constrained if point["gate"]["passed"]]
    selected = min(feasible, key=selection_rank) if feasible else None

    reference_point = next(point for point in operating_points if point["threshold"] == reference)
    return {
        "schemaVersion": REPORT_SCHEMA,
        "status": (
            "calibration_threshold_feasible" if selected else "calibration_threshold_infeasible"
        ),
        "evidenceSplit": "calibration",
        "scoreSource": "family_grouped_out_of_fold_calibrated_probability",
        "thresholdGrid": {
            "start": 0.0,
            "end": 1.0,
            "step": float(threshold_step),
            "operatingPointCount": len(grid),
            "sampleScoreDerived": False,
        },
        "gatePolicy": frozen_gate,
        "referenceOperatingPoint": reference_point,
        "selectedOperatingPoint": selected,
        "bestSafetyConstrainedOperatingPoint": best_safety_constrained,
        "ruleBaselineClassification": baseline,
        "reportMaterial": {
            "aggregateOnly": True,
            "containsPromptOrResponse": False,
            "containsEmbeddingOrVector": False,
            "containsModelParameters": False,
            "containsIndividualScores": False,
        },
    }
