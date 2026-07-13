from __future__ import annotations

import hashlib
import math
import struct
from collections import defaultdict
from typing import Any, Callable


ARTIFACT_SCHEMA_VERSION = "gatelm.difficulty-model-artifact.v1"
CONTENT_HASH_ALGORITHM = "difficulty-model-inference-material.v1"
THRESHOLD_POLICY_VERSION = "difficulty-threshold-v1"


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
) -> tuple[Callable[[Any], Any], dict[str, Any]]:
    import numpy as np

    raw = np.asarray(raw_probabilities, dtype=float)
    y = np.asarray(labels, dtype=int)
    if kind == "identity":
        return lambda values: np.asarray(values, dtype=float), {"type": "identity", "input": "raw_probability"}
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
        return lambda values: platt.predict_proba(np.asarray(values).reshape(-1, 1))[:, 1], material
    if kind == "isotonic":
        from sklearn.isotonic import IsotonicRegression

        isotonic = IsotonicRegression(out_of_bounds=config["isotonic"]["outOfBounds"]).fit(raw, y)
        material = {
            "type": "isotonic",
            "input": "raw_probability",
            "xThresholds": [float(value) for value in isotonic.X_thresholds_],
            "yThresholds": [float(value) for value in isotonic.y_thresholds_],
        }
        return lambda values: isotonic.predict(np.asarray(values, dtype=float)), material
    raise ValueError(f"unsupported calibrator candidate {kind!r}")


def _select_calibrator(raw: Any, y: Any, groups: Any, config: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    import numpy as np

    splitter = _group_folds(groups, config["groupFolds"])
    simplicity = {name: index for index, name in enumerate(config["simplicityOrder"])}
    evaluations: list[dict[str, Any]] = []
    selected_kind: str | None = None
    selected_metrics: dict[str, float] | None = None
    selected_tie: tuple[Any, ...] | None = None
    for kind in config["candidates"]:
        fold_metrics = []
        for fit_indices, validation_indices in splitter.split(raw, y, groups):
            apply, _ = _fit_calibrator(kind, raw[fit_indices], y[fit_indices], config)
            fold_metrics.append(_metrics(y[validation_indices], apply(raw[validation_indices])))
        candidate = {
            "type": kind,
            "logLoss": float(np.mean([item["logLoss"] for item in fold_metrics])),
            "brierScore": float(np.mean([item["brierScore"] for item in fold_metrics])),
        }
        evaluations.append(candidate)
        score = {"logLoss": candidate["logLoss"], "brierScore": candidate["brierScore"]}
        tie = (simplicity[kind],)
        if _candidate_better(score, selected_metrics, config["tieTolerance"], tie, selected_tie):
            selected_kind = kind
            selected_metrics = score
            selected_tie = tie
    if selected_kind is None:
        raise ValueError("calibrator selection produced no candidate")
    return selected_kind, evaluations


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
    apply_calibrator, calibrator_material = _fit_calibrator(
        calibrator_kind, calibration_raw, calibration_y, policy["calibration"]
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
        "calibrationSelection": {
            "selectedType": calibrator_kind,
            "candidates": calibration_evaluations,
        },
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
