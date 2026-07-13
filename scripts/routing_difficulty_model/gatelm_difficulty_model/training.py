from __future__ import annotations

import hashlib
import math
import struct
from collections import defaultdict
from typing import Any, Callable


ARTIFACT_SCHEMA_VERSION = "gatelm.difficulty-model-artifact.v1"
CONTENT_HASH_ALGORITHM = "difficulty-model-inference-material.v1"
THRESHOLD_POLICY_VERSION = "difficulty-threshold-v1"
CALIBRATOR_CANDIDATES = ("platt", "isotonic")


def _float_bits(value: float) -> str:
    if not math.isfinite(float(value)):
        raise ValueError("artifact numeric material must be finite")
    return struct.pack(">d", float(value)).hex()


def artifact_content_hash(artifact: dict[str, Any]) -> str:
    calibrator = artifact["calibrator"]
    parts = [
        artifact["schemaVersion"],
        artifact["modelVersion"],
        artifact["featureVersion"],
        _float_bits(artifact["bias"]),
        *artifact["featureNames"],
        *(_float_bits(value) for value in artifact["weights"]),
        artifact["calibrationVersion"],
        calibrator["type"],
        calibrator["input"],
    ]
    if "coefficient" in calibrator:
        parts.append(_float_bits(calibrator["coefficient"]))
    if "intercept" in calibrator:
        parts.append(_float_bits(calibrator["intercept"]))
    parts.extend(_float_bits(value) for value in calibrator.get("xThresholds", []))
    parts.extend(_float_bits(value) for value in calibrator.get("yThresholds", []))
    parts.extend(
        [
            artifact["thresholdPolicyVersion"],
            _float_bits(artifact["threshold"]),
            artifact["contentHashAlgorithm"],
        ]
    )
    material = "".join(f"{len(part.encode('utf-8'))}:{part}\n" for part in parts)
    return "sha256:" + hashlib.sha256(material.encode("utf-8")).hexdigest()


def _metrics(labels: Any, probabilities: Any) -> dict[str, float]:
    import numpy as np

    y = np.asarray(labels, dtype=float)
    p = np.clip(np.asarray(probabilities, dtype=float), 1e-15, 1 - 1e-15)
    return {
        "logLoss": float(np.mean(-(y * np.log(p) + (1 - y) * np.log1p(-p)))),
        "brierScore": float(np.mean(np.square(p - y))),
    }


def _candidate_better(
    candidate: dict[str, float],
    selected: dict[str, float] | None,
    tolerance: float,
    final_tie: tuple[Any, ...],
    selected_final_tie: tuple[Any, ...] | None,
) -> bool:
    if selected is None:
        return True
    if candidate["logLoss"] < selected["logLoss"] - tolerance:
        return True
    if abs(candidate["logLoss"] - selected["logLoss"]) > tolerance:
        return False
    if candidate["brierScore"] < selected["brierScore"] - tolerance:
        return True
    if abs(candidate["brierScore"] - selected["brierScore"]) > tolerance:
        return False
    return selected_final_tie is None or final_tie < selected_final_tie


def _group_folds(groups: Any, requested: int) -> Any:
    import numpy as np
    from sklearn.model_selection import GroupKFold

    unique_groups = np.unique(groups)
    if len(unique_groups) < requested:
        raise ValueError(f"need at least {requested} family groups, got {len(unique_groups)}")
    return GroupKFold(n_splits=requested)


def _fit_logistic(x: Any, y: Any, c_value: float, config: dict[str, Any]) -> Any:
    from sklearn.linear_model import LogisticRegression

    if config["penalty"] != "l2":
        raise ValueError("difficulty-logistic-v1 supports only L2 regularization")
    model = LogisticRegression(
        solver=config["solver"],
        C=c_value,
        max_iter=config["maxIterations"],
        random_state=config["randomSeed"],
    )
    return model.fit(x, y)


def _select_regularization(x: Any, y: Any, groups: Any, config: dict[str, Any]) -> tuple[float, list[dict[str, float]]]:
    import numpy as np

    splitter = _group_folds(groups, config["groupFolds"])
    evaluations: list[dict[str, float]] = []
    selected_c: float | None = None
    selected_metrics: dict[str, float] | None = None
    selected_tie: tuple[Any, ...] | None = None
    for c_value in config["cCandidates"]:
        fold_metrics = []
        for fit_indices, validation_indices in splitter.split(x, y, groups):
            model = _fit_logistic(x[fit_indices], y[fit_indices], float(c_value), config)
            probabilities = model.predict_proba(x[validation_indices])[:, 1]
            fold_metrics.append(_metrics(y[validation_indices], probabilities))
        candidate = {
            "c": float(c_value),
            "logLoss": float(np.mean([item["logLoss"] for item in fold_metrics])),
            "brierScore": float(np.mean([item["brierScore"] for item in fold_metrics])),
        }
        evaluations.append(candidate)
        score = {"logLoss": candidate["logLoss"], "brierScore": candidate["brierScore"]}
        tie = (float(c_value),)
        if _candidate_better(score, selected_metrics, config["tieTolerance"], tie, selected_tie):
            selected_c = float(c_value)
            selected_metrics = score
            selected_tie = tie
    if selected_c is None:
        raise ValueError("regularization selection produced no candidate")
    return selected_c, evaluations


def _fit_calibrator(
    kind: str,
    raw_probabilities: Any,
    labels: Any,
    config: dict[str, Any],
) -> tuple[Callable[[Any], Any], dict[str, Any], dict[str, Any]]:
    import numpy as np

    raw, y = _calibration_arrays(raw_probabilities, labels)
    if kind == "platt":
        from sklearn.linear_model import LogisticRegression

        platt = LogisticRegression(
            solver=config["platt"]["solver"],
            C=config["platt"]["c"],
            max_iter=config["platt"]["maxIterations"],
        ).fit(raw.reshape(-1, 1), y)
        material = {
            "type": "platt",
            "input": "raw_probability",
            "coefficient": float(platt.coef_[0][0]),
            "intercept": float(platt.intercept_[0]),
        }
        return (
            lambda values: _apply_platt(
                values,
                material["coefficient"],
                material["intercept"],
            ),
            material,
            {},
        )
    if kind == "isotonic":
        x_thresholds, y_thresholds, block_sample_counts = _fit_isotonic_pava(raw, y)
        material = {
            "type": "isotonic",
            "input": "raw_probability",
            "xThresholds": x_thresholds,
            "yThresholds": y_thresholds,
        }
        diagnostics = {
            "blockCount": len(block_sample_counts),
            "blockSampleCounts": block_sample_counts,
            "minBlockSampleCount": min(block_sample_counts),
        }
        return (
            lambda values: _apply_isotonic_blocks(values, x_thresholds, y_thresholds),
            material,
            diagnostics,
        )
    raise ValueError(f"unsupported calibrator candidate {kind!r}")


def _calibration_arrays(raw_probabilities: Any, labels: Any) -> tuple[Any, Any]:
    import numpy as np

    raw = np.asarray(raw_probabilities, dtype=float)
    label_values = np.asarray(labels)
    if raw.ndim != 1 or label_values.ndim != 1 or len(raw) == 0 or len(raw) != len(label_values):
        raise ValueError("calibrator fit requires non-empty aligned one-dimensional inputs")
    if not np.all(np.isfinite(raw)) or np.any(raw < 0) or np.any(raw > 1):
        raise ValueError("calibrator raw probabilities must be finite inclusive probabilities")
    if not np.all(np.isin(label_values, (0, 1))):
        raise ValueError("calibrator labels must be binary")
    return raw, label_values.astype(int)


def _apply_platt(values: Any, coefficient: float, intercept: float) -> Any:
    import numpy as np

    raw = np.asarray(values, dtype=float)
    if not np.all(np.isfinite(raw)) or not math.isfinite(coefficient) or not math.isfinite(intercept):
        raise ValueError("Platt lookup requires finite input and parameters")
    logits = coefficient * raw + intercept
    calibrated = np.empty_like(logits, dtype=float)
    non_negative = logits >= 0
    calibrated[non_negative] = 1 / (1 + np.exp(-logits[non_negative]))
    exponential = np.exp(logits[~non_negative])
    calibrated[~non_negative] = exponential / (1 + exponential)
    return calibrated


def _fit_isotonic_pava(raw_probabilities: Any, labels: Any) -> tuple[list[float], list[float], list[int]]:
    import numpy as np

    raw, y = _calibration_arrays(raw_probabilities, labels)
    order = np.argsort(raw, kind="stable")
    grouped: list[dict[str, float | int]] = []
    for index in order:
        raw_value = float(raw[index])
        label = int(y[index])
        if grouped and raw_value == grouped[-1]["lowerBound"]:
            grouped[-1]["sampleCount"] = int(grouped[-1]["sampleCount"]) + 1
            grouped[-1]["positiveCount"] = int(grouped[-1]["positiveCount"]) + label
            continue
        grouped.append(
            {
                "lowerBound": raw_value,
                "sampleCount": 1,
                "positiveCount": label,
            }
        )

    blocks: list[dict[str, float | int]] = []
    for group in grouped:
        blocks.append(dict(group))
        while len(blocks) >= 2:
            left = blocks[-2]
            right = blocks[-1]
            left_rate = int(left["positiveCount"]) / int(left["sampleCount"])
            right_rate = int(right["positiveCount"]) / int(right["sampleCount"])
            if left_rate <= right_rate:
                break
            blocks[-2:] = [
                {
                    "lowerBound": float(left["lowerBound"]),
                    "sampleCount": int(left["sampleCount"]) + int(right["sampleCount"]),
                    "positiveCount": int(left["positiveCount"]) + int(right["positiveCount"]),
                }
            ]

    x_thresholds = [float(block["lowerBound"]) for block in blocks]
    block_sample_counts = [int(block["sampleCount"]) for block in blocks]
    y_thresholds = [
        int(block["positiveCount"]) / int(block["sampleCount"])
        for block in blocks
    ]
    return x_thresholds, y_thresholds, block_sample_counts


def _apply_isotonic_blocks(values: Any, x_thresholds: list[float], y_thresholds: list[float]) -> Any:
    import numpy as np

    if len(x_thresholds) == 0 or len(x_thresholds) != len(y_thresholds):
        raise ValueError("isotonic lookup requires aligned non-empty thresholds")
    raw = np.asarray(values, dtype=float)
    if not np.all(np.isfinite(raw)):
        raise ValueError("isotonic lookup values must be finite")
    x = np.asarray(x_thresholds, dtype=float)
    y = np.asarray(y_thresholds, dtype=float)
    indices = np.searchsorted(x, raw, side="right") - 1
    return y[np.clip(indices, 0, len(x) - 1)]


def _validate_calibration_config(config: dict[str, Any]) -> None:
    expected = list(CALIBRATOR_CANDIDATES)
    if config.get("candidates") != expected:
        raise ValueError("calibration candidates must be exactly platt then isotonic")
    if config.get("simplicityOrder") != expected:
        raise ValueError("calibration simplicity order must prefer platt then isotonic")
    isotonic = config.get("isotonic", {})
    expected_isotonic = {
        "algorithm": "pava",
        "tieGrouping": "exact_float64",
        "weighting": "sample_count",
        "lookup": "inclusive_lower_floor",
        "outOfBounds": "clip",
        "smallBlockMerge": "disabled",
    }
    if isotonic != expected_isotonic:
        raise ValueError("isotonic policy must use exact sample-weighted PAVA floor lookup without small-block merging")


def _select_calibrator(raw: Any, y: Any, groups: Any, config: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    import numpy as np

    _validate_calibration_config(config)
    splitter = _group_folds(groups, config["groupFolds"])
    simplicity = {name: index for index, name in enumerate(config["simplicityOrder"])}
    evaluations: list[dict[str, Any]] = []
    selected_kind: str | None = None
    selected_metrics: dict[str, float] | None = None
    selected_tie: tuple[Any, ...] | None = None
    for kind in config["candidates"]:
        try:
            fold_metrics = []
            fold_diagnostics = []
            for fit_indices, validation_indices in splitter.split(raw, y, groups):
                apply, _, diagnostics = _fit_calibrator(kind, raw[fit_indices], y[fit_indices], config)
                metrics = _metrics(y[validation_indices], apply(raw[validation_indices]))
                if not all(math.isfinite(value) for value in metrics.values()):
                    raise ValueError("calibrator validation metrics must be finite")
                fold_metrics.append(metrics)
                if kind == "isotonic":
                    fold_diagnostics.append(
                        {
                            "blockCount": diagnostics["blockCount"],
                            "minBlockSampleCount": diagnostics["minBlockSampleCount"],
                        }
                    )
        except (ValueError, ArithmeticError):
            evaluations.append({"type": kind, "status": "failed"})
            continue
        candidate = {
            "type": kind,
            "status": "valid",
            "logLoss": float(np.mean([item["logLoss"] for item in fold_metrics])),
            "brierScore": float(np.mean([item["brierScore"] for item in fold_metrics])),
        }
        if kind == "isotonic":
            candidate["foldDiagnostics"] = fold_diagnostics
        evaluations.append(candidate)
        score = {"logLoss": candidate["logLoss"], "brierScore": candidate["brierScore"]}
        tie = (simplicity[kind],)
        if _candidate_better(score, selected_metrics, config["tieTolerance"], tie, selected_tie):
            selected_kind = kind
            selected_metrics = score
            selected_tie = tie
    if selected_kind is None:
        raise ValueError("all configured calibrator candidates failed validation")
    return selected_kind, evaluations


def _fit_selected_calibrator(
    selected_kind: str,
    evaluations: list[dict[str, Any]],
    raw: Any,
    y: Any,
    config: dict[str, Any],
) -> tuple[str, Callable[[Any], Any], dict[str, Any], dict[str, Any]]:
    valid_fallbacks = [
        evaluation["type"]
        for evaluation in evaluations
        if evaluation.get("status") == "valid" and evaluation["type"] != selected_kind
    ]
    for kind in [selected_kind, *valid_fallbacks]:
        try:
            apply, material, diagnostics = _fit_calibrator(kind, raw, y, config)
        except (ValueError, ArithmeticError):
            evaluation = next(item for item in evaluations if item["type"] == kind)
            evaluation["status"] = "failed"
            evaluation["failureStage"] = "final_fit"
            continue
        return kind, apply, material, diagnostics
    raise ValueError("all configured calibrator candidates failed final fit")


def _validate_vector_export(export: dict[str, Any], policy: dict[str, Any]) -> None:
    if export.get("schemaVersion") != "gatelm.difficulty-training-vector-export.v1":
        raise ValueError("unsupported vector export schema")
    if export.get("categorySource") != "actual":
        raise ValueError("training requires vectors built from the actual category classifier result")
    if export.get("featureVersion") != policy["featureVersion"]:
        raise ValueError("vector export feature version does not match training policy")
    if export.get("splitPolicyVersion") != policy["splitPolicyVersion"]:
        raise ValueError("vector export split policy does not match training policy")
    feature_names = export.get("featureNames", [])
    if len(feature_names) != 42 or len(set(feature_names)) != 42:
        raise ValueError("vector export must contain exactly 42 unique feature names")
    family_splits: dict[str, set[str]] = defaultdict(set)
    for sample in export.get("samples", []):
        if sample.get("label") not in (0, 1) or len(sample.get("vector", [])) != 42:
            raise ValueError("vector export sample has invalid label or vector dimension")
        if not isinstance(sample.get("modelPath"), bool):
            raise ValueError("vector export sample must declare boolean modelPath")
        family_splits[sample["familyId"]].add(sample["split"])
    if not family_splits or any(len(splits) != 1 for splits in family_splits.values()):
        raise ValueError("contrast family leaked across dataset splits")


def train_from_vector_export(
    export: dict[str, Any],
    policy: dict[str, Any],
    artifact_version: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    import numpy as np

    _validate_vector_export(export, policy)
    _validate_calibration_config(policy["calibration"])
    samples_by_split = {
        split: [sample for sample in export["samples"] if sample["split"] == split]
        for split in ("train", "calibration", "holdout")
    }
    if any(not samples for samples in samples_by_split.values()):
        raise ValueError("train, calibration and holdout splits must all be non-empty")
    model_samples_by_split = {
        split: [sample for sample in samples if sample["modelPath"]]
        for split, samples in samples_by_split.items()
    }
    if any(not samples for samples in model_samples_by_split.values()):
        raise ValueError("model path must contain train, calibration and holdout samples")

    def arrays(samples: list[dict[str, Any]]) -> tuple[Any, Any, Any]:
        return (
            np.asarray([sample["vector"] for sample in samples], dtype=float),
            np.asarray([sample["label"] for sample in samples], dtype=int),
            np.asarray([sample["familyId"] for sample in samples], dtype=object),
        )

    train_x, train_y, train_groups = arrays(model_samples_by_split["train"])
    selected_c, regularization_evaluations = _select_regularization(
        train_x, train_y, train_groups, policy["regularization"]
    )
    model = _fit_logistic(train_x, train_y, selected_c, policy["regularization"])

    calibration_x, calibration_y, calibration_groups = arrays(model_samples_by_split["calibration"])
    calibration_raw = model.predict_proba(calibration_x)[:, 1]
    calibrator_kind, calibration_evaluations = _select_calibrator(
        calibration_raw, calibration_y, calibration_groups, policy["calibration"]
    )
    calibrator_kind, apply_calibrator, calibrator_material, calibrator_diagnostics = _fit_selected_calibrator(
        calibrator_kind,
        calibration_evaluations,
        calibration_raw,
        calibration_y,
        policy["calibration"],
    )

    artifact = {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "artifactVersion": artifact_version,
        "modelVersion": policy["modelVersion"],
        "featureVersion": export["featureVersion"],
        "trainingDatasetVersion": export["datasetVersion"],
        "trainingDatasetSha256": export["datasetSha256"],
        "splitPolicyVersion": export["splitPolicyVersion"],
        "regularization": {
            "policyVersion": policy["policyVersion"],
            "penalty": policy["regularization"]["penalty"],
            "solver": policy["regularization"]["solver"],
            "selectedC": selected_c,
            "groupFolds": policy["regularization"]["groupFolds"],
            "randomSeed": policy["regularization"]["randomSeed"],
        },
        "bias": float(model.intercept_[0]),
        "featureNames": list(export["featureNames"]),
        "weights": [float(value) for value in model.coef_[0]],
        "calibrationVersion": policy["calibration"]["policyVersion"],
        "calibrator": calibrator_material,
        "thresholdPolicyVersion": policy["threshold"]["policyVersion"],
        "threshold": policy["threshold"]["value"],
        "contentHashAlgorithm": CONTENT_HASH_ALGORITHM,
    }
    artifact["contentHash"] = artifact_content_hash(artifact)

    holdout_samples = model_samples_by_split["holdout"]
    holdout_x, holdout_y, _ = arrays(holdout_samples)
    holdout_scores = apply_calibrator(model.predict_proba(holdout_x)[:, 1])
    by_category: dict[str, dict[str, Any]] = {}
    for category in sorted({sample["expectedCategory"] for sample in holdout_samples}):
        indices = [index for index, sample in enumerate(holdout_samples) if sample["expectedCategory"] == category]
        by_category[category] = {
            "samples": len(indices),
            **_metrics(holdout_y[indices], holdout_scores[indices]),
        }
    calibration_selection = {
        "selectedType": calibrator_kind,
        "candidates": calibration_evaluations,
    }
    if calibrator_kind == "isotonic":
        calibration_selection["selectedFit"] = {
            "blockCount": calibrator_diagnostics["blockCount"],
            "blockSampleCounts": calibrator_diagnostics["blockSampleCounts"],
        }

    report = {
        "schemaVersion": "gatelm.difficulty-training-report.v1",
        "artifactVersion": artifact_version,
        "datasetVersion": export["datasetVersion"],
        "splitCounts": {
            split: {
                "samples": len(samples),
                "families": len({sample["familyId"] for sample in samples}),
            }
            for split, samples in samples_by_split.items()
        },
        "modelPathSplitCounts": {
            split: {
                "samples": len(samples),
                "families": len({sample["familyId"] for sample in samples}),
            }
            for split, samples in model_samples_by_split.items()
        },
        "regularizationSelection": {
            "selectedC": selected_c,
            "candidates": regularization_evaluations,
        },
        "calibrationSelection": calibration_selection,
        "holdout": {
            "overall": {"samples": len(holdout_samples), **_metrics(holdout_y, holdout_scores)},
            "byExpectedCategory": by_category,
        },
        "runtimePromotionEvaluated": False,
        "notes": [
            "This report contains aggregate calibrated results only.",
            "Runtime promotion and rule-based directional-error gates require a separate approved evidence run.",
        ],
    }
    return artifact, report
