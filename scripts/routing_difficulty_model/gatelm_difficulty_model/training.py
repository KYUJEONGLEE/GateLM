from __future__ import annotations

import hashlib
import math
import re
import struct
import warnings
from collections.abc import Mapping, Sequence
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Callable

from .semantic_features import (
    OFFLINE_FEATURE_SHAPE_VERSION,
    RULE_VECTOR_V1_DIMENSION,
    RULE_VECTOR_V1_FEATURE_NAMES,
    RULE_VECTOR_V1_VERSION,
    SEMANTIC_HEAD_SPECS_V1,
    FeatureShapeDescriptor,
    OfflineFeatureCandidate,
)


ARTIFACT_SCHEMA_VERSION = "gatelm.difficulty-model-artifact.v1"
OFFLINE_ARTIFACT_SCHEMA_VERSION = "gatelm.difficulty-offline-model-artifact.v1"
CONTENT_HASH_ALGORITHM = "difficulty-model-inference-material.v1"
OFFLINE_BUNDLE_HASH_ALGORITHM = "difficulty-feature-bundle-material.v1"
OFFLINE_CONTENT_HASH_ALGORITHM = "difficulty-offline-model-inference-material.v1"
OFFLINE_THRESHOLD_EQUALITY = "greater_than_or_equal"
OFFLINE_HEAD_PROBABILITY_RULE = "multinomial_linear_softmax.v1"
THRESHOLD_POLICY_VERSION = "difficulty-threshold-v1"
CALIBRATOR_CANDIDATES = ("platt", "isotonic")
SHA256_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
DATASET_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class _LogisticConvergenceError(ValueError):
    def __init__(self, max_iterations: int, observed_iterations: int) -> None:
        super().__init__(
            "Logistic Regression failed to converge within the configured iteration limit"
        )
        self.max_iterations = int(max_iterations)
        self.observed_iterations = int(observed_iterations)


@dataclass(frozen=True)
class OfflineArtifactProvenance:
    preprocessing_version: str
    tokenizer_version: str
    encoder_version: str
    pooling_version: str
    projection_parameters: Mapping[str, Any]
    semantic_head_input_dimension: int
    semantic_head_parameters: Sequence[Mapping[str, Any]]
    training_dataset_version: str
    training_dataset_sha256: str
    split_policy_version: str
    split_manifest_sha256: str
    training_policy_version: str
    threshold_policy_version: str
    threshold: float
    component_hashes: Mapping[str, str]
    bundle_version: str

    def __post_init__(self) -> None:
        version_fields = {
            "preprocessing version": self.preprocessing_version,
            "tokenizer version": self.tokenizer_version,
            "encoder version": self.encoder_version,
            "pooling version": self.pooling_version,
            "training dataset version": self.training_dataset_version,
            "split policy version": self.split_policy_version,
            "training policy version": self.training_policy_version,
            "threshold policy version": self.threshold_policy_version,
            "bundle version": self.bundle_version,
        }
        for name, value in version_fields.items():
            if not value.strip() or value.strip().lower() == "latest":
                raise ValueError(f"offline {name} must be immutable and non-empty")
        if not DATASET_SHA256_PATTERN.fullmatch(self.training_dataset_sha256):
            raise ValueError("offline training dataset hash must be a lowercase sha256 digest")
        if not DATASET_SHA256_PATTERN.fullmatch(self.split_manifest_sha256):
            raise ValueError("offline split manifest hash must be a lowercase sha256 digest")
        if not math.isfinite(float(self.threshold)) or not 0.0 <= float(self.threshold) <= 1.0:
            raise ValueError("offline threshold must be a finite inclusive probability")
        expected_components = {"ruleVector", "tokenizer", "encoder", "projection", "semanticHeads"}
        if set(self.component_hashes) != expected_components or any(
            not SHA256_PATTERN.fullmatch(value)
            for value in self.component_hashes.values()
        ):
            raise ValueError("offline component hashes must contain exact sha256 provenance")
        _validate_projection_parameters(self.projection_parameters)
        _validate_semantic_head_parameters(
            self.semantic_head_input_dimension,
            self.semantic_head_parameters,
        )


def _float_bits(value: float) -> str:
    if not math.isfinite(float(value)):
        raise ValueError("artifact numeric material must be finite")
    return struct.pack(">d", float(value)).hex()


def _immutable_version(value: Any) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    lowered = value.strip().lower()
    return lowered != "latest" and not lowered.endswith((".latest", "-latest"))


def _validate_projection_parameters(parameters: Mapping[str, Any]) -> None:
    if not isinstance(parameters, Mapping):
        raise ValueError("offline projection parameters must be a mapping")
    expected_keys = {
        "kind",
        "inputDimension",
        "outputDimension",
        "dtype",
        "fitSplit",
        "randomSeed",
        "whiten",
        "l2Position",
        "l2Epsilon",
        "mean",
        "components",
    }
    if set(parameters) != expected_keys:
        raise ValueError("offline projection parameters must use the closed parameter contract")
    input_dimension = parameters["inputDimension"]
    output_dimension = parameters["outputDimension"]
    if (
        isinstance(input_dimension, bool)
        or not isinstance(input_dimension, int)
        or input_dimension <= 0
        or isinstance(output_dimension, bool)
        or not isinstance(output_dimension, int)
        or output_dimension <= 0
    ):
        raise ValueError("offline projection parameter dimensions are invalid")
    if (
        parameters["dtype"] != "float32_le"
        or parameters["fitSplit"] != "train"
        or parameters["whiten"] is not False
        or parameters["l2Position"] != "after_projection"
        or isinstance(parameters["randomSeed"], bool)
        or not isinstance(parameters["randomSeed"], int)
        or not math.isfinite(float(parameters["l2Epsilon"]))
        or float(parameters["l2Epsilon"]) <= 0
    ):
        raise ValueError("offline projection numeric policy is invalid")
    mean = parameters["mean"]
    components = parameters["components"]
    if isinstance(mean, (str, bytes)) or not isinstance(mean, Sequence):
        raise ValueError("offline projection mean must be a sequence")
    if isinstance(components, (str, bytes)) or not isinstance(components, Sequence):
        raise ValueError("offline projection components must be a sequence")
    if parameters["kind"] == "identity":
        if input_dimension != output_dimension or len(mean) != 0 or len(components) != 0:
            raise ValueError("offline identity projection parameters are invalid")
        return
    if parameters["kind"] != "pca_full_svd":
        raise ValueError("offline projection kind is unsupported")
    if len(mean) != input_dimension or len(components) != output_dimension:
        raise ValueError("offline PCA projection parameter shape is invalid")
    if any(not math.isfinite(float(value)) for value in mean):
        raise ValueError("offline projection parameters must be finite")
    for row in components:
        if isinstance(row, (str, bytes)) or not isinstance(row, Sequence) or len(row) != input_dimension:
            raise ValueError("offline PCA projection parameter shape is invalid")
        if any(not math.isfinite(float(value)) for value in row):
            raise ValueError("offline projection parameters must be finite")


def _validate_semantic_head_parameters(
    input_dimension: int,
    parameters: Sequence[Mapping[str, Any]],
) -> None:
    if isinstance(input_dimension, bool) or not isinstance(input_dimension, int) or input_dimension <= 0:
        raise ValueError("offline semantic head input dimension is invalid")
    if isinstance(parameters, (str, bytes)) or not isinstance(parameters, Sequence):
        raise ValueError("offline semantic head parameters must be a sequence")
    if len(parameters) != len(SEMANTIC_HEAD_SPECS_V1):
        raise ValueError("offline semantic head parameters violate the fixed four-head contract")
    for actual, expected in zip(parameters, SEMANTIC_HEAD_SPECS_V1):
        if not isinstance(actual, Mapping) or set(actual) != {"name", "classes", "coefficient", "intercept"}:
            raise ValueError("offline semantic head parameters must use the closed parameter contract")
        if actual["name"] != expected.name or actual["classes"] != list(expected.classes):
            raise ValueError("offline semantic head parameters violate the fixed class order")
        coefficient = actual["coefficient"]
        intercept = actual["intercept"]
        if (
            not isinstance(coefficient, Sequence)
            or len(coefficient) != 3
            or not isinstance(intercept, Sequence)
            or len(intercept) != 3
        ):
            raise ValueError("offline semantic head parameter shape is invalid")
        for row in coefficient:
            if not isinstance(row, Sequence) or len(row) != input_dimension:
                raise ValueError("offline semantic head parameter shape is invalid")
            if any(not math.isfinite(float(value)) for value in row):
                raise ValueError("offline semantic head parameters must be finite")
        if any(not math.isfinite(float(value)) for value in intercept):
            raise ValueError("offline semantic head parameters must be finite")


def artifact_content_hash(artifact: dict[str, Any]) -> str:
    if artifact.get("schemaVersion") == OFFLINE_ARTIFACT_SCHEMA_VERSION:
        return _offline_artifact_content_hash(artifact)
    if artifact.get("schemaVersion") != ARTIFACT_SCHEMA_VERSION:
        raise ValueError("unsupported difficulty model artifact schema")
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
    return _length_prefixed_content_hash(parts)


def offline_bundle_hash(artifact: Mapping[str, Any]) -> str:
    projection = artifact["projectionParameters"]
    parts = [
        artifact["bundleHashAlgorithm"],
        artifact["bundleVersion"],
        artifact["offlineFeatureShapeVersion"],
        artifact["candidateName"],
        artifact["ruleVectorVersion"],
        artifact["preprocessingVersion"],
        artifact["tokenizerVersion"],
        artifact["encoderVersion"],
        artifact["poolingVersion"],
        artifact["projectionVersion"],
        str(artifact["projectionDimension"]),
        projection["kind"],
        str(projection["inputDimension"]),
        str(projection["outputDimension"]),
        projection["dtype"],
        projection["fitSplit"],
        str(projection["randomSeed"]),
        str(projection["whiten"]).lower(),
        projection["l2Position"],
        _float_bits(projection["l2Epsilon"]),
        artifact["semanticHeadsVersion"],
        str(artifact["semanticHeadInputDimension"]),
        artifact["semanticHeadProbabilityRule"],
    ]
    parts.extend(_float_bits(value) for value in projection["mean"])
    for row in projection["components"]:
        parts.append(str(len(row)))
        parts.extend(_float_bits(value) for value in row)
    for head in artifact["semanticHeadClassOrder"]:
        parts.append(head["name"])
        parts.extend(head["classes"])
    for head in artifact["semanticHeadParameters"]:
        parts.append(head["name"])
        parts.extend(head["classes"])
        for row in head["coefficient"]:
            parts.append(str(len(row)))
            parts.extend(_float_bits(value) for value in row)
        parts.extend(_float_bits(value) for value in head["intercept"])
    parts.append(str(artifact["totalDimension"]))
    parts.extend(artifact["featureNames"])
    parts.extend(
        [
            artifact["componentHashes"]["ruleVector"],
            artifact["componentHashes"]["tokenizer"],
            artifact["componentHashes"]["encoder"],
            artifact["componentHashes"]["projection"],
            artifact["componentHashes"]["semanticHeads"],
        ]
    )
    return _length_prefixed_content_hash(parts)


def _offline_artifact_content_hash(artifact: dict[str, Any]) -> str:
    calibrator = artifact["calibrator"]
    parts = [
        artifact["schemaVersion"],
        artifact["artifactVersion"],
        artifact["modelVersion"],
        artifact["bundleVersion"],
        artifact["bundleHashAlgorithm"],
        artifact["bundleHash"],
    ]
    parts.extend(_float_bits(value) for value in artifact["weights"])
    parts.extend([_float_bits(artifact["bias"]), artifact["calibrationVersion"]])
    parts.extend([calibrator["type"], calibrator["input"]])
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
            artifact["thresholdEquality"],
            artifact["trainingDatasetVersion"],
            artifact["trainingDatasetSha256"],
            artifact["splitPolicyVersion"],
            artifact["splitManifestSha256"],
            artifact["trainingPolicyVersion"],
            artifact["regularization"]["policyVersion"],
            artifact["regularization"]["penalty"],
            artifact["regularization"]["solver"],
            _float_bits(artifact["regularization"]["selectedC"]),
            str(artifact["regularization"]["groupFolds"]),
            str(artifact["regularization"]["randomSeed"]),
            artifact["contentHashAlgorithm"],
        ]
    )
    return _length_prefixed_content_hash(parts)


def _length_prefixed_content_hash(parts: Sequence[str]) -> str:
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


def _validate_regularization_config(config: Mapping[str, Any]) -> list[float]:
    if config.get("penalty") != "l2":
        raise ValueError("difficulty-logistic-v1 supports only L2 regularization")
    if config.get("solver") != "liblinear":
        raise ValueError("difficulty-logistic-v1 supports only the liblinear solver")
    if config.get("selectionMetric") != "mean_log_loss":
        raise ValueError("regularization selection metric must be mean_log_loss")
    if config.get("tieBreakers") != ["mean_brier_score", "stronger_regularization"]:
        raise ValueError(
            "regularization tie breakers must be mean_brier_score then stronger_regularization"
        )

    raw_candidates = config.get("cCandidates")
    if (
        isinstance(raw_candidates, (str, bytes))
        or not isinstance(raw_candidates, Sequence)
        or not raw_candidates
    ):
        raise ValueError("regularization C candidates must be a non-empty sequence")
    candidates: list[float] = []
    for value in raw_candidates:
        if isinstance(value, bool):
            raise ValueError("regularization C candidates must be finite positive numbers")
        try:
            candidate = float(value)
        except (TypeError, ValueError) as error:
            raise ValueError(
                "regularization C candidates must be finite positive numbers"
            ) from error
        if not math.isfinite(candidate) or candidate <= 0:
            raise ValueError("regularization C candidates must be finite positive numbers")
        candidates.append(candidate)
    if len(set(candidates)) != len(candidates) or candidates != sorted(candidates):
        raise ValueError("regularization C candidates must be unique and ordered ascending")

    group_folds = config.get("groupFolds")
    if isinstance(group_folds, bool) or not isinstance(group_folds, int) or group_folds < 2:
        raise ValueError("regularization groupFolds must be an integer of at least 2")
    tie_tolerance = config.get("tieTolerance")
    if isinstance(tie_tolerance, bool):
        raise ValueError("regularization tieTolerance must be a finite non-negative number")
    try:
        tolerance = float(tie_tolerance)
    except (TypeError, ValueError) as error:
        raise ValueError(
            "regularization tieTolerance must be a finite non-negative number"
        ) from error
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError("regularization tieTolerance must be a finite non-negative number")
    max_iterations = config.get("maxIterations")
    if (
        isinstance(max_iterations, bool)
        or not isinstance(max_iterations, int)
        or max_iterations <= 0
    ):
        raise ValueError("regularization maxIterations must be a positive integer")
    random_seed = config.get("randomSeed")
    if isinstance(random_seed, bool) or not isinstance(random_seed, int):
        raise ValueError("regularization randomSeed must be an integer")
    return candidates


def _group_folds(groups: Any, requested: int) -> Any:
    import numpy as np
    from sklearn.model_selection import GroupKFold

    unique_groups = np.unique(groups)
    if len(unique_groups) < requested:
        raise ValueError(f"need at least {requested} family groups, got {len(unique_groups)}")
    return GroupKFold(n_splits=requested)


def _logistic_iteration_count(model: Any) -> int:
    raw_iterations = getattr(model, "n_iter_", ())
    if hasattr(raw_iterations, "tolist"):
        raw_iterations = raw_iterations.tolist()
    if isinstance(raw_iterations, (int, float)):
        return int(raw_iterations)
    return max((int(value) for value in raw_iterations), default=0)


def _fit_with_convergence_gate(model: Any, x: Any, y: Any, max_iterations: int) -> Any:
    from sklearn.exceptions import ConvergenceWarning

    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always", ConvergenceWarning)
        fitted = model.fit(x, y)
    convergence_warnings = [
        item for item in captured if issubclass(item.category, ConvergenceWarning)
    ]
    for item in captured:
        if item not in convergence_warnings:
            warnings.warn_explicit(
                str(item.message),
                item.category,
                item.filename,
                item.lineno,
            )
    if convergence_warnings:
        raise _LogisticConvergenceError(
            max_iterations=max_iterations,
            observed_iterations=_logistic_iteration_count(fitted),
        )
    return fitted


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
    return _fit_with_convergence_gate(model, x, y, config["maxIterations"])


def _select_regularization(x: Any, y: Any, groups: Any, config: dict[str, Any]) -> tuple[float, list[dict[str, Any]]]:
    import numpy as np

    c_candidates = _validate_regularization_config(config)
    splitter = _group_folds(groups, config["groupFolds"])
    evaluations: list[dict[str, Any]] = []
    selected_c: float | None = None
    selected_metrics: dict[str, float] | None = None
    selected_tie: tuple[Any, ...] | None = None
    for c_value in c_candidates:
        fold_metrics = []
        fold_iterations = []
        convergence_failure: dict[str, Any] | None = None
        for fold, (fit_indices, validation_indices) in enumerate(
            splitter.split(x, y, groups),
            start=1,
        ):
            try:
                model = _fit_logistic(x[fit_indices], y[fit_indices], float(c_value), config)
            except _LogisticConvergenceError as error:
                convergence_failure = {
                    "c": float(c_value),
                    "status": "failed",
                    "failureReason": "failed_to_converge",
                    "failedFold": fold,
                    "maxIterations": error.max_iterations,
                    "observedIterations": error.observed_iterations,
                    "foldIterations": fold_iterations,
                    "foldMetrics": fold_metrics,
                }
                break
            fold_iterations.append(
                {
                    "fold": fold,
                    "iterations": _logistic_iteration_count(model),
                }
            )
            probabilities = model.predict_proba(x[validation_indices])[:, 1]
            fold_metrics.append(
                {
                    "fold": fold,
                    **_metrics(y[validation_indices], probabilities),
                }
            )
        if convergence_failure is not None:
            evaluations.append(convergence_failure)
            continue
        candidate = {
            "c": float(c_value),
            "status": "valid",
            "logLoss": float(np.mean([item["logLoss"] for item in fold_metrics])),
            "brierScore": float(np.mean([item["brierScore"] for item in fold_metrics])),
            "foldIterations": fold_iterations,
            "foldMetrics": fold_metrics,
        }
        evaluations.append(candidate)
        score = {"logLoss": candidate["logLoss"], "brierScore": candidate["brierScore"]}
        tie = (float(c_value),)
        if _candidate_better(score, selected_metrics, config["tieTolerance"], tie, selected_tie):
            selected_c = float(c_value)
            selected_metrics = score
            selected_tie = tie
    if selected_c is None:
        raise ValueError("all regularization candidates failed to converge")
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

        platt_model = LogisticRegression(
            solver=config["platt"]["solver"],
            C=config["platt"]["c"],
            max_iter=config["platt"]["maxIterations"],
        )
        platt = _fit_with_convergence_gate(
            platt_model,
            raw.reshape(-1, 1),
            y,
            config["platt"]["maxIterations"],
        )
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
            left_positive_count = int(left["positiveCount"])
            left_sample_count = int(left["sampleCount"])
            right_positive_count = int(right["positiveCount"])
            right_sample_count = int(right["sampleCount"])
            # Merge violations and exact-equal fitted rates so emitted blocks are maximal constants.
            rate_comparison = (
                left_positive_count * right_sample_count
                - right_positive_count * left_sample_count
            )
            if rate_comparison < 0:
                break
            blocks[-2:] = [
                {
                    "lowerBound": float(left["lowerBound"]),
                    "sampleCount": left_sample_count + right_sample_count,
                    "positiveCount": left_positive_count + right_positive_count,
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
        "blockCanonicalization": "maximal_constant",
        "lookup": "inclusive_lower_floor",
        "outOfBounds": "clip",
        "smallBlockMerge": "disabled",
    }
    if isotonic != expected_isotonic:
        raise ValueError(
            "isotonic policy must use exact sample-weighted maximal-constant PAVA floor lookup "
            "without small-block merging"
        )


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
        except (ValueError, ArithmeticError) as error:
            failure = {"type": kind, "status": "failed"}
            if isinstance(error, _LogisticConvergenceError):
                failure.update(
                    {
                        "failureReason": "failed_to_converge",
                        "maxIterations": error.max_iterations,
                        "observedIterations": error.observed_iterations,
                    }
                )
            evaluations.append(failure)
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
        except (ValueError, ArithmeticError) as error:
            evaluation = next(item for item in evaluations if item["type"] == kind)
            evaluation["status"] = "failed"
            evaluation["failureStage"] = "final_fit"
            if isinstance(error, _LogisticConvergenceError):
                evaluation.update(
                    {
                        "failureReason": "failed_to_converge",
                        "maxIterations": error.max_iterations,
                        "observedIterations": error.observed_iterations,
                    }
                )
            continue
        return kind, apply, material, diagnostics
    raise ValueError("all configured calibrator candidates failed final fit")


def validate_v1_vector_export(export: dict[str, Any], policy: dict[str, Any]) -> None:
    if export.get("schemaVersion") != "gatelm.difficulty-training-vector-export.v1":
        raise ValueError("unsupported vector export schema")
    if export.get("categorySource") != "actual":
        raise ValueError("training requires vectors built from the actual category classifier result")
    if export.get("featureVersion") != policy["featureVersion"]:
        raise ValueError("vector export feature version does not match training policy")
    if export.get("splitPolicyVersion") != policy["splitPolicyVersion"]:
        raise ValueError("vector export split policy does not match training policy")
    feature_names = export.get("featureNames", [])
    if tuple(feature_names) != RULE_VECTOR_V1_FEATURE_NAMES:
        raise ValueError("vector export must contain the exact 42 v1 feature names")
    _validate_sample_matrix(
        export.get("samples", []),
        RULE_VECTOR_V1_DIMENSION,
        require_unit_interval=True,
    )


def _validate_vector_export(export: dict[str, Any], policy: dict[str, Any]) -> None:
    """Compatibility alias retained for callers that used the private v1 helper."""

    validate_v1_vector_export(export, policy)


def validate_offline_feature_matrix(
    descriptor: FeatureShapeDescriptor,
    samples: Sequence[Mapping[str, Any]],
) -> None:
    if descriptor.shape_version != OFFLINE_FEATURE_SHAPE_VERSION:
        raise ValueError("unsupported offline feature shape version")
    if descriptor.rule_vector_version != RULE_VECTOR_V1_VERSION:
        raise ValueError("offline matrix must preserve the exact v1 rule vector version")
    if descriptor.semantic_head_specs != SEMANTIC_HEAD_SPECS_V1:
        raise ValueError("offline matrix semantic head order does not match the fixed contract")

    expected_names = [f"ruleVectorV1.{name}" for name in RULE_VECTOR_V1_FEATURE_NAMES]
    if descriptor.candidate is not OfflineFeatureCandidate.RULE_VECTOR_V1:
        expected_names.extend(
            f"semanticProjection[{index}]"
            for index in range(descriptor.projection_dimension)
        )
    if descriptor.candidate is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS:
        for spec in SEMANTIC_HEAD_SPECS_V1:
            expected_names.extend(
                f"semanticHeads.{spec.name}.{class_name}.probability"
                for class_name in spec.classes
            )
    if tuple(expected_names) != descriptor.feature_names:
        raise ValueError("offline descriptor feature names do not match its candidate shape")
    if len(expected_names) != descriptor.total_dimension:
        raise ValueError("offline descriptor total dimension does not match feature names")

    _validate_sample_matrix(samples, descriptor.total_dimension)
    head_offset = RULE_VECTOR_V1_DIMENSION + (
        0
        if descriptor.candidate is OfflineFeatureCandidate.RULE_VECTOR_V1
        else descriptor.projection_dimension
    )
    for sample in samples:
        values = [float(value) for value in sample["vector"]]
        if any(value < 0.0 or value > 1.0 for value in values[:RULE_VECTOR_V1_DIMENSION]):
            raise ValueError("offline ruleVectorV1 prefix must remain within [0, 1]")
        if descriptor.candidate is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS:
            for index in range(head_offset, descriptor.total_dimension, 3):
                head = values[index : index + 3]
                if any(value < 0.0 or value > 1.0 for value in head) or abs(math.fsum(head) - 1.0) > 1e-6:
                    raise ValueError("offline semantic head probabilities must be finite distributions")


def _validate_sample_matrix(
    samples: Sequence[Mapping[str, Any]],
    total_dimension: int,
    *,
    require_unit_interval: bool = False,
) -> None:
    if isinstance(samples, (str, bytes)) or not isinstance(samples, Sequence) or not samples:
        raise ValueError("training samples must be a non-empty sequence")
    allowed_splits = {"train", "calibration", "holdout"}
    forbidden_material = {
        "rawPrompt",
        "instructionText",
        "payloadText",
        "rawEmbedding",
        "projectedEmbedding",
        "semanticHeadProbabilities",
        "rawProbability",
        "logit",
        "featureContributions",
    }
    family_splits: dict[str, set[str]] = defaultdict(set)
    for index, sample in enumerate(samples):
        if not isinstance(sample, Mapping):
            raise ValueError(f"training sample {index} must be a mapping")
        leaked_fields = sorted(forbidden_material.intersection(sample))
        if leaked_fields:
            raise ValueError(f"training sample {index} contains forbidden sensitive material")
        label = sample.get("label")
        if isinstance(label, bool) or label not in (0, 1):
            raise ValueError(f"training sample {index} label must be binary")
        split = sample.get("split")
        if split not in allowed_splits:
            raise ValueError(f"training sample {index} has an unsupported split")
        family_id = sample.get("familyId")
        if not isinstance(family_id, str) or not family_id.strip():
            raise ValueError(f"training sample {index} familyId is required")
        if not isinstance(sample.get("modelPath"), bool):
            raise ValueError("vector export sample must declare boolean modelPath")
        if not isinstance(sample.get("expectedCategory"), str) or not sample["expectedCategory"].strip():
            raise ValueError(f"training sample {index} expectedCategory is required")
        vector = sample.get("vector")
        if isinstance(vector, (str, bytes)) or not isinstance(vector, Sequence) or len(vector) != total_dimension:
            raise ValueError(
                f"training sample {index} vector dimension must be exactly {total_dimension}"
            )
        if any(isinstance(value, (bool, str, bytes)) for value in vector):
            raise ValueError(f"training sample {index} vector must contain numeric values")
        try:
            values = [float(value) for value in vector]
        except (TypeError, ValueError) as error:
            raise ValueError(f"training sample {index} vector must contain numeric values") from error
        if any(not math.isfinite(value) for value in values):
            raise ValueError(f"training sample {index} vector must contain finite values")
        if require_unit_interval and any(value < 0.0 or value > 1.0 for value in values):
            raise ValueError(f"training sample {index} v1 vector values must be within [0, 1]")
        family_splits[family_id].add(split)
    if any(len(splits) != 1 for splits in family_splits.values()):
        raise ValueError("contrast family leaked across dataset splits")


def train_from_vector_export(
    export: dict[str, Any],
    policy: dict[str, Any],
    artifact_version: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    validate_v1_vector_export(export, policy)
    fitted, report = _fit_candidate(
        export["samples"],
        policy,
        artifact_version,
        export["datasetVersion"],
        "gatelm.difficulty-training-report.v1",
    )
    artifact = {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "artifactVersion": artifact_version,
        "modelVersion": policy["modelVersion"],
        "featureVersion": export["featureVersion"],
        "trainingDatasetVersion": export["datasetVersion"],
        "trainingDatasetSha256": export["datasetSha256"],
        "splitPolicyVersion": export["splitPolicyVersion"],
        "regularization": fitted["regularization"],
        "bias": fitted["bias"],
        "featureNames": list(export["featureNames"]),
        "weights": fitted["weights"],
        "calibrationVersion": policy["calibration"]["policyVersion"],
        "calibrator": fitted["calibrator"],
        "thresholdPolicyVersion": policy["threshold"]["policyVersion"],
        "threshold": policy["threshold"]["value"],
        "contentHashAlgorithm": CONTENT_HASH_ALGORITHM,
    }
    if len(artifact["weights"]) != RULE_VECTOR_V1_DIMENSION:
        raise ValueError("trained v1 weights do not match the exact 42D contract")
    artifact["contentHash"] = artifact_content_hash(artifact)
    return artifact, report


def train_from_offline_feature_matrix(
    samples: Sequence[Mapping[str, Any]],
    descriptor: FeatureShapeDescriptor,
    policy: dict[str, Any],
    artifact_version: str,
    provenance: OfflineArtifactProvenance,
) -> tuple[dict[str, Any], dict[str, Any]]:
    validate_offline_feature_matrix(descriptor, samples)
    if policy.get("modelVersion") != "difficulty-logistic-v1":
        raise ValueError("offline candidates must reuse the difficulty-logistic-v1 policy")
    if provenance.training_policy_version != policy.get("policyVersion"):
        raise ValueError("offline training policy provenance does not match the fit policy")
    if provenance.split_policy_version != policy.get("splitPolicyVersion"):
        raise ValueError("offline split policy provenance does not match the fit policy")
    if provenance.projection_parameters["outputDimension"] != descriptor.projection_dimension:
        raise ValueError("offline projection parameters do not match descriptor P")
    if provenance.projection_parameters["outputDimension"] != provenance.semantic_head_input_dimension:
        raise ValueError("offline semantic heads must consume the canonical projected dimension")
    fitted, report = _fit_candidate(
        samples,
        policy,
        artifact_version,
        provenance.training_dataset_version,
        "gatelm.difficulty-offline-training-report.v1",
    )
    artifact = {
        "schemaVersion": OFFLINE_ARTIFACT_SCHEMA_VERSION,
        "artifactVersion": artifact_version,
        "modelVersion": policy["modelVersion"],
        "offlineFeatureShapeVersion": descriptor.shape_version,
        "candidateName": descriptor.candidate.value,
        "ruleVectorVersion": descriptor.rule_vector_version,
        "preprocessingVersion": provenance.preprocessing_version,
        "tokenizerVersion": provenance.tokenizer_version,
        "encoderVersion": provenance.encoder_version,
        "poolingVersion": provenance.pooling_version,
        "projectionVersion": descriptor.projection_version,
        "projectionDimension": descriptor.projection_dimension,
        "projectionParameters": dict(provenance.projection_parameters),
        "semanticHeadsVersion": descriptor.semantic_heads_version,
        "semanticHeadClassOrder": [
            {"name": spec.name, "classes": list(spec.classes)}
            for spec in descriptor.semantic_head_specs
        ],
        "semanticHeadInputDimension": provenance.semantic_head_input_dimension,
        "semanticHeadParameters": [dict(head) for head in provenance.semantic_head_parameters],
        "semanticHeadProbabilityRule": OFFLINE_HEAD_PROBABILITY_RULE,
        "totalDimension": descriptor.total_dimension,
        "featureNames": list(descriptor.feature_names),
        "weights": fitted["weights"],
        "bias": fitted["bias"],
        "calibrationVersion": policy["calibration"]["policyVersion"],
        "calibrator": fitted["calibrator"],
        "thresholdPolicyVersion": provenance.threshold_policy_version,
        "threshold": float(provenance.threshold),
        "thresholdEquality": OFFLINE_THRESHOLD_EQUALITY,
        "trainingDatasetVersion": provenance.training_dataset_version,
        "trainingDatasetSha256": provenance.training_dataset_sha256,
        "splitPolicyVersion": provenance.split_policy_version,
        "splitManifestSha256": provenance.split_manifest_sha256,
        "trainingPolicyVersion": provenance.training_policy_version,
        "regularization": fitted["regularization"],
        "componentHashes": dict(provenance.component_hashes),
        "bundleVersion": provenance.bundle_version,
        "bundleHashAlgorithm": OFFLINE_BUNDLE_HASH_ALGORITHM,
        "contentHashAlgorithm": OFFLINE_CONTENT_HASH_ALGORITHM,
    }
    if len(artifact["weights"]) != descriptor.total_dimension:
        raise ValueError("trained offline weights do not match descriptor totalDimension")
    artifact["bundleHash"] = offline_bundle_hash(artifact)
    artifact["contentHash"] = artifact_content_hash(artifact)
    report["offlineCandidate"] = {
        "offlineFeatureShapeVersion": descriptor.shape_version,
        "candidateName": descriptor.candidate.value,
        "totalDimension": descriptor.total_dimension,
        "contentHash": artifact["contentHash"],
    }
    return artifact, report


def _fit_candidate(
    samples: Sequence[Mapping[str, Any]],
    policy: dict[str, Any],
    artifact_version: str,
    dataset_version: str,
    report_schema_version: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    import numpy as np

    _validate_calibration_config(policy["calibration"])
    samples_by_split = {
        split: [sample for sample in samples if sample["split"] == split]
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
    try:
        model = _fit_logistic(train_x, train_y, selected_c, policy["regularization"])
    except _LogisticConvergenceError as error:
        raise ValueError(
            "selected regularization candidate failed to converge during final fit"
        ) from error
    final_fit_iterations = _logistic_iteration_count(model)
    weights = np.asarray(model.coef_[0], dtype=float)
    bias = float(model.intercept_[0])
    if (
        weights.shape != (train_x.shape[1],)
        or not np.all(np.isfinite(weights))
        or not math.isfinite(bias)
    ):
        raise ValueError("selected Logistic Regression produced invalid weights or bias")

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

    fitted = {
        "regularization": {
            "policyVersion": policy["policyVersion"],
            "penalty": policy["regularization"]["penalty"],
            "solver": policy["regularization"]["solver"],
            "selectedC": selected_c,
            "groupFolds": policy["regularization"]["groupFolds"],
            "randomSeed": policy["regularization"]["randomSeed"],
        },
        "bias": bias,
        "weights": [float(value) for value in weights],
        "calibrator": calibrator_material,
    }

    calibration_selection = {
        "selectedType": calibrator_kind,
        "candidates": calibration_evaluations,
    }
    if calibrator_kind == "isotonic":
        calibration_selection["selectedFit"] = {
            "blockCount": calibrator_diagnostics["blockCount"],
            "blockSampleCounts": calibrator_diagnostics["blockSampleCounts"],
            "minBlockSampleCount": calibrator_diagnostics["minBlockSampleCount"],
        }

    report = {
        "schemaVersion": report_schema_version,
        "artifactVersion": artifact_version,
        "datasetVersion": dataset_version,
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
            "finalFitIterations": final_fit_iterations,
            "maxIterations": policy["regularization"]["maxIterations"],
        },
        "calibrationSelection": calibration_selection,
        "holdoutEvaluationDeferred": True,
        "runtimePromotionEvaluated": False,
        "notes": [
            "Model and calibrator fitting do not read holdout labels or holdout outcome metrics.",
            (
                f"The train partition contains {len(samples_by_split['train'])} records; "
                "Logistic Regression fits only the "
                f"{len(model_samples_by_split['train'])} modelPath=true records."
            ),
            "The selected frozen candidate is evaluated on holdout by the outer candidate suite.",
        ],
    }
    return fitted, report
