"""Offline-only fixed four-head semantic classifier tooling.

Request-derived embeddings and probabilities are intentionally kept in memory.
Only immutable model parameters and aggregate evaluation material are returned.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from math import isfinite
from typing import Any

from .encoder_runtime import canonical_hash
from .semantic_features import (
    PROBABILITY_SUM_TOLERANCE,
    SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1,
    SEMANTIC_HEAD_SPECS_V1,
)


SEMANTIC_HEADS_ARTIFACT_SCHEMA = "gatelm.difficulty-semantic-heads-artifact.v1"
SEMANTIC_HEAD_EVALUATION_SCHEMA = "gatelm.difficulty-semantic-head-evaluation.v1"
SEMANTIC_HEAD_RANDOM_SEED = 20260714
LANGUAGE_BUCKETS = ("ko", "en", "mixed", "unknown")
EVALUATION_SLICES = (
    "negation",
    "indirect_expression",
    "synonym",
    "short_complex",
    "long_simple",
    "payload_contamination",
    "korean",
    "english",
    "mixed_language",
    "category_confusion",
    "ood_terminology",
)
HEAD_LABEL_FIELDS = {
    "semanticTaskBucket": "taskBucket",
    "semanticConstraintBucket": "constraintBucket",
    "semanticScopeBucket": "scopeBucket",
    "semanticDependencyBucket": "dependencyBucket",
}


def _artifact_hash(artifact: Mapping[str, Any]) -> str:
    material = deepcopy(dict(artifact))
    material.pop("artifactContentHash", None)
    return canonical_hash(material)


def _fixed_head_names() -> tuple[str, ...]:
    return tuple(spec.name for spec in SEMANTIC_HEAD_SPECS_V1)


def _validate_exact_head_keys(value: Mapping[str, Any], material_name: str) -> None:
    expected = set(_fixed_head_names())
    actual = set(value)
    if actual != expected:
        missing = sorted(expected.difference(actual))
        extra = sorted(actual.difference(expected))
        raise ValueError(
            f"{material_name} does not match the fixed four-head label contract: "
            f"missing={missing}, extra={extra}"
        )


def _finite_matrix(values: Any, name: str, columns: int | None = None) -> Any:
    import numpy as np

    matrix = np.asarray(values, dtype=np.float64)
    if matrix.ndim != 2 or not np.all(np.isfinite(matrix)):
        raise ValueError(f"{name} must be a finite two-dimensional matrix")
    if columns is not None and matrix.shape[1] != columns:
        raise ValueError(f"{name} dimension does not match the artifact")
    return matrix


def train_semantic_heads(
    train_embeddings: Any,
    train_labels: Mapping[str, Sequence[str]],
    *,
    artifact_version: str,
    encoder_version: str,
    encoder_hash: str,
    pooling_version: str,
    c_value: float = 1.0,
    max_iterations: int = 1000,
) -> dict[str, Any]:
    """Fit the fixed four heads without accepting encoder parameters."""

    import numpy as np
    from sklearn.linear_model import LogisticRegression

    embeddings = _finite_matrix(train_embeddings, "semantic head training embeddings")
    if embeddings.shape[0] == 0 or embeddings.shape[1] == 0:
        raise ValueError("semantic head training embeddings must not be empty")
    _validate_exact_head_keys(train_labels, "semantic head training labels")
    if not artifact_version.strip() or artifact_version.lower().endswith("latest"):
        raise ValueError("semantic head artifact version must be immutable")
    if not encoder_version.strip() or not pooling_version.strip():
        raise ValueError("encoder and pooling versions must be immutable non-empty identifiers")
    if len(encoder_hash) != 64 or any(character not in "0123456789abcdef" for character in encoder_hash):
        raise ValueError("encoder hash must be lowercase SHA-256")
    if isinstance(c_value, bool) or not isfinite(float(c_value)) or float(c_value) <= 0:
        raise ValueError("semantic head regularization C must be finite and positive")
    if isinstance(max_iterations, bool) or max_iterations <= 0:
        raise ValueError("semantic head max iterations must be positive")

    heads: list[dict[str, Any]] = []
    for spec in SEMANTIC_HEAD_SPECS_V1:
        labels = list(train_labels[spec.name])
        if len(labels) != embeddings.shape[0]:
            raise ValueError(f"semantic head {spec.name!r} labels do not align with embeddings")
        unknown = sorted(set(labels).difference(spec.classes))
        if unknown:
            raise ValueError(f"semantic head {spec.name!r} contains unsupported labels: {unknown}")
        if set(labels) != set(spec.classes):
            raise ValueError(f"semantic head {spec.name!r} training requires all three classes")
        encoded = np.asarray([spec.classes.index(label) for label in labels], dtype=np.int64)
        classifier = LogisticRegression(
            solver="lbfgs",
            penalty="l2",
            C=float(c_value),
            max_iter=int(max_iterations),
            random_state=SEMANTIC_HEAD_RANDOM_SEED,
        )
        classifier.fit(embeddings, encoded)
        if tuple(int(value) for value in classifier.classes_) != (0, 1, 2):
            raise ValueError(f"semantic head {spec.name!r} fit changed the fixed class order")
        coefficient = np.asarray(classifier.coef_, dtype=np.float64)
        intercept = np.asarray(classifier.intercept_, dtype=np.float64)
        if coefficient.shape != (3, embeddings.shape[1]) or intercept.shape != (3,):
            raise ValueError(f"semantic head {spec.name!r} fit returned an invalid parameter shape")
        heads.append(
            {
                "name": spec.name,
                "classes": list(spec.classes),
                "coefficient": coefficient.tolist(),
                "intercept": intercept.tolist(),
            }
        )

    artifact: dict[str, Any] = {
        "schemaVersion": SEMANTIC_HEADS_ARTIFACT_SCHEMA,
        "version": artifact_version,
        "encoderVersion": encoder_version,
        "encoderHash": encoder_hash,
        "encoderFrozen": True,
        "poolingVersion": pooling_version,
        "inputDimension": int(embeddings.shape[1]),
        "headOrder": list(_fixed_head_names()),
        "semanticHeadProbabilityDimension": SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1,
        "probabilityRule": "multinomial_linear_softmax.v1",
        "optimizerParameterScope": "semantic_heads_only",
        "trainingObjective": "fixed_unweighted_sum_multinomial_cross_entropy.v1",
        "headLossWeights": {spec.name: 1.0 for spec in SEMANTIC_HEAD_SPECS_V1},
        "training": {
            "fitSplit": "train",
            "solver": "lbfgs",
            "penalty": "l2",
            "c": float(c_value),
            "maxIterations": int(max_iterations),
            "randomSeed": SEMANTIC_HEAD_RANDOM_SEED,
        },
        "heads": heads,
    }
    artifact["artifactContentHash"] = _artifact_hash(artifact)
    validate_semantic_heads_artifact(artifact)
    return artifact


def validate_semantic_heads_artifact(artifact: Mapping[str, Any]) -> None:
    """Reject artifacts that do not exactly implement the fixed 4x3 contract."""

    import numpy as np

    if artifact.get("schemaVersion") != SEMANTIC_HEADS_ARTIFACT_SCHEMA:
        raise ValueError("unsupported semantic heads artifact schema")
    version = artifact.get("version")
    if not isinstance(version, str) or not version.strip() or version.lower().endswith("latest"):
        raise ValueError("semantic heads artifact version must be immutable")
    if not isinstance(artifact.get("encoderVersion"), str) or not artifact["encoderVersion"].strip():
        raise ValueError("semantic heads artifact encoder version is invalid")
    encoder_hash = artifact.get("encoderHash")
    if (
        not isinstance(encoder_hash, str)
        or len(encoder_hash) != 64
        or any(character not in "0123456789abcdef" for character in encoder_hash)
    ):
        raise ValueError("semantic heads artifact encoder hash must be lowercase SHA-256")
    if not isinstance(artifact.get("poolingVersion"), str) or not artifact["poolingVersion"].strip():
        raise ValueError("semantic heads artifact pooling version is invalid")
    if artifact.get("encoderFrozen") is not True:
        raise ValueError("semantic heads artifact must pin a frozen encoder")
    if artifact.get("optimizerParameterScope") != "semantic_heads_only":
        raise ValueError("semantic heads artifact optimizer scope is invalid")
    if artifact.get("headOrder") != list(_fixed_head_names()):
        raise ValueError("semantic heads artifact violates the fixed four-head contract")
    if artifact.get("semanticHeadProbabilityDimension") != SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1:
        raise ValueError("semantic heads artifact violates the fixed four-head contract")
    if artifact.get("probabilityRule") != "multinomial_linear_softmax.v1":
        raise ValueError("semantic heads artifact probability rule is invalid")
    if artifact.get("trainingObjective") != "fixed_unweighted_sum_multinomial_cross_entropy.v1":
        raise ValueError("semantic heads artifact training objective is invalid")
    if artifact.get("headLossWeights") != {
        spec.name: 1.0 for spec in SEMANTIC_HEAD_SPECS_V1
    }:
        raise ValueError("semantic heads artifact loss weights are invalid")
    input_dimension = artifact.get("inputDimension")
    if isinstance(input_dimension, bool) or not isinstance(input_dimension, int) or input_dimension <= 0:
        raise ValueError("semantic heads artifact input dimension is invalid")
    heads = artifact.get("heads")
    if not isinstance(heads, list) or len(heads) != len(SEMANTIC_HEAD_SPECS_V1):
        raise ValueError("semantic heads artifact violates the fixed four-head contract")
    for actual, spec in zip(heads, SEMANTIC_HEAD_SPECS_V1):
        if not isinstance(actual, Mapping) or actual.get("name") != spec.name:
            raise ValueError("semantic heads artifact violates the fixed four-head contract")
        if actual.get("classes") != list(spec.classes):
            raise ValueError("semantic heads artifact violates the fixed four-head contract")
        coefficient = np.asarray(actual.get("coefficient"), dtype=np.float64)
        intercept = np.asarray(actual.get("intercept"), dtype=np.float64)
        if coefficient.shape != (3, input_dimension) or intercept.shape != (3,):
            raise ValueError("semantic heads artifact parameter dimension is invalid")
        if not np.all(np.isfinite(coefficient)) or not np.all(np.isfinite(intercept)):
            raise ValueError("semantic heads artifact parameters must be finite")
    expected_hash = artifact.get("artifactContentHash")
    if not isinstance(expected_hash, str) or expected_hash != _artifact_hash(artifact):
        raise ValueError("semantic heads artifact content hash does not match")


def predict_semantic_head_probabilities(
    artifact: Mapping[str, Any], embeddings: Any
) -> dict[str, Any]:
    """Return process-local probability matrices in the fixed head order."""

    import numpy as np

    validate_semantic_heads_artifact(artifact)
    values = _finite_matrix(embeddings, "semantic head inference embeddings", artifact["inputDimension"])
    result: dict[str, Any] = {}
    for head in artifact["heads"]:
        coefficient = np.asarray(head["coefficient"], dtype=np.float64)
        intercept = np.asarray(head["intercept"], dtype=np.float64)
        logits = values @ coefficient.T + intercept
        logits -= np.max(logits, axis=1, keepdims=True)
        exponentials = np.exp(logits)
        probabilities = exponentials / exponentials.sum(axis=1, keepdims=True)
        result[head["name"]] = probabilities
    _validate_probability_matrices(result)
    return result


def _validate_probability_matrices(probabilities: Mapping[str, Any]) -> int:
    import numpy as np

    _validate_exact_head_keys(probabilities, "semantic head probability material")
    sample_count: int | None = None
    for spec in SEMANTIC_HEAD_SPECS_V1:
        matrix = np.asarray(probabilities[spec.name], dtype=np.float64)
        if matrix.ndim != 2 or matrix.shape[1] != len(spec.classes):
            raise ValueError(f"semantic head {spec.name!r} probability dimension is invalid")
        if sample_count is None:
            sample_count = int(matrix.shape[0])
        elif matrix.shape[0] != sample_count:
            raise ValueError("semantic head probability sample counts do not align")
        if not np.all(np.isfinite(matrix)):
            raise ValueError(f"semantic head {spec.name!r} probabilities must be finite")
        if np.any(matrix < 0.0) or np.any(matrix > 1.0):
            raise ValueError(f"semantic head {spec.name!r} probabilities must be within [0, 1]")
        if np.any(np.abs(matrix.sum(axis=1) - 1.0) > PROBABILITY_SUM_TOLERANCE):
            raise ValueError(f"semantic head {spec.name!r} probabilities must sum to one")
    if sample_count is None or sample_count <= 0:
        raise ValueError("semantic head probability material must not be empty")
    return sample_count


def flatten_semantic_head_probabilities(
    probabilities: Mapping[str, Any], *, sample_index: int
) -> tuple[float, ...]:
    """Flatten one in-memory sample to the canonical 12D head order."""

    import numpy as np

    sample_count = _validate_probability_matrices(probabilities)
    if isinstance(sample_index, bool) or not 0 <= sample_index < sample_count:
        raise ValueError("semantic head sample index is out of range")
    flattened: tuple[float, ...] = ()
    for spec in SEMANTIC_HEAD_SPECS_V1:
        row = np.asarray(probabilities[spec.name], dtype=np.float64)[sample_index]
        flattened += tuple(float(value) for value in row)
    if len(flattened) != SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1:
        raise ValueError("semantic head probability material did not produce exactly 12 dimensions")
    return flattened


def _validate_targets(
    targets: Mapping[str, Sequence[str]], sample_count: int
) -> dict[str, list[int]]:
    _validate_exact_head_keys(targets, "semantic head evaluation labels")
    encoded: dict[str, list[int]] = {}
    for spec in SEMANTIC_HEAD_SPECS_V1:
        values = list(targets[spec.name])
        if len(values) != sample_count:
            raise ValueError(f"semantic head {spec.name!r} evaluation labels do not align")
        unknown = sorted(set(values).difference(spec.classes))
        if unknown:
            raise ValueError(f"semantic head {spec.name!r} contains unsupported labels: {unknown}")
        encoded[spec.name] = [spec.classes.index(value) for value in values]
    return encoded


def _rounded(value: float) -> float:
    return round(float(value), 12)


def _metric_block(
    probabilities: Any,
    target_indices: Sequence[int],
    classes: Sequence[str],
    calibration_bins: int,
) -> dict[str, Any]:
    import numpy as np

    matrix = np.asarray(probabilities, dtype=np.float64)
    targets = np.asarray(target_indices, dtype=np.int64)
    predictions = np.argmax(matrix, axis=1)
    confusion = np.zeros((len(classes), len(classes)), dtype=np.int64)
    for expected, actual in zip(targets, predictions):
        confusion[int(expected), int(actual)] += 1
    class_metrics: list[dict[str, Any]] = []
    f1_values: list[float] = []
    for index, class_name in enumerate(classes):
        true_positive = int(confusion[index, index])
        support = int(confusion[index, :].sum())
        predicted = int(confusion[:, index].sum())
        precision = true_positive / predicted if predicted else 0.0
        recall = true_positive / support if support else 0.0
        f1 = 2.0 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1_values.append(f1)
        class_metrics.append(
            {
                "class": class_name,
                "support": support,
                "precision": _rounded(precision),
                "recall": _rounded(recall),
                "f1": _rounded(f1),
            }
        )
    one_hot = np.eye(len(classes), dtype=np.float64)[targets]
    brier = float(np.mean(np.sum((matrix - one_hot) ** 2, axis=1)))
    confidence = np.max(matrix, axis=1)
    correct = predictions == targets
    calibration: list[dict[str, Any]] = []
    ece = 0.0
    for bin_index in range(calibration_bins):
        lower = bin_index / calibration_bins
        upper = (bin_index + 1) / calibration_bins
        in_bin = (confidence >= lower) & (
            confidence <= upper if bin_index == calibration_bins - 1 else confidence < upper
        )
        support = int(np.sum(in_bin))
        if support == 0:
            calibration.append(
                {
                    "lowerInclusive": _rounded(lower),
                    "upperInclusive": _rounded(upper),
                    "support": 0,
                    "status": "empty",
                }
            )
            continue
        mean_confidence = float(np.mean(confidence[in_bin]))
        observed_accuracy = float(np.mean(correct[in_bin]))
        ece += support / len(targets) * abs(observed_accuracy - mean_confidence)
        calibration.append(
            {
                "lowerInclusive": _rounded(lower),
                "upperInclusive": _rounded(upper),
                "support": support,
                "meanConfidence": _rounded(mean_confidence),
                "observedAccuracy": _rounded(observed_accuracy),
            }
        )
    return {
        "support": int(len(targets)),
        "accuracy": _rounded(float(np.mean(correct))),
        "macroF1": _rounded(sum(f1_values) / len(f1_values)),
        "classes": class_metrics,
        "confusionMatrix": confusion.tolist(),
        "multiclassBrierScore": _rounded(brier),
        "expectedCalibrationError": _rounded(ece),
        "calibrationBins": calibration,
    }


def _slice_metrics(
    probabilities: Mapping[str, Any],
    encoded_targets: Mapping[str, Sequence[int]],
    indices: Sequence[int],
    calibration_bins: int,
) -> dict[str, Any]:
    import numpy as np

    if not indices:
        return {"status": "empty", "support": 0}
    index_array = np.asarray(indices, dtype=np.int64)
    return {
        "status": "measured",
        "support": len(indices),
        "headMetrics": {
            spec.name: _metric_block(
                np.asarray(probabilities[spec.name], dtype=np.float64)[index_array],
                [encoded_targets[spec.name][index] for index in indices],
                spec.classes,
                calibration_bins,
            )
            for spec in SEMANTIC_HEAD_SPECS_V1
        },
    }


def evaluate_semantic_head_probabilities(
    probabilities: Mapping[str, Any],
    targets: Mapping[str, Sequence[str]],
    metadata: Sequence[Mapping[str, Any]],
    *,
    calibration_bins: int = 10,
) -> dict[str, Any]:
    """Build a safe aggregate-only report for the fixed four heads."""

    if isinstance(calibration_bins, bool) or calibration_bins < 2 or calibration_bins > 100:
        raise ValueError("calibration bin count must be between 2 and 100")
    sample_count = _validate_probability_matrices(probabilities)
    encoded_targets = _validate_targets(targets, sample_count)
    if len(metadata) != sample_count:
        raise ValueError("semantic head evaluation metadata does not align")
    for item in metadata:
        if item.get("language") not in LANGUAGE_BUCKETS:
            raise ValueError("semantic head evaluation language bucket is invalid")
        slices = item.get("evaluationSlices")
        if not isinstance(slices, Sequence) or isinstance(slices, (str, bytes)):
            raise ValueError("semantic head evaluation slices must be a sequence")
        if set(slices).difference(EVALUATION_SLICES):
            raise ValueError("semantic head evaluation contains an unsupported slice")

    all_indices = list(range(sample_count))
    report = {
        "schemaVersion": SEMANTIC_HEAD_EVALUATION_SCHEMA,
        "headContractVersion": "difficulty-semantic-heads.v1",
        "semanticHeadProbabilityDimension": SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1,
        "sampleCount": sample_count,
        "calibrationStatus": "uncalibrated_probability_diagnostics",
        "headMetrics": {
            spec.name: _metric_block(
                probabilities[spec.name],
                encoded_targets[spec.name],
                spec.classes,
                calibration_bins,
            )
            for spec in SEMANTIC_HEAD_SPECS_V1
        },
        "byLanguage": {},
        "bySlice": {},
    }
    for language in LANGUAGE_BUCKETS:
        indices = [index for index, item in enumerate(metadata) if item["language"] == language]
        report["byLanguage"][language] = _slice_metrics(
            probabilities, encoded_targets, indices, calibration_bins
        )
    for slice_name in EVALUATION_SLICES:
        indices = [
            index
            for index, item in enumerate(metadata)
            if slice_name in item["evaluationSlices"]
        ]
        report["bySlice"][slice_name] = _slice_metrics(
            probabilities, encoded_targets, indices, calibration_bins
        )
    return report


def train_and_evaluate_semantic_heads(
    exported_input: Mapping[str, Any],
    encode_instruction: Any,
    *,
    artifact_version: str,
    encoder_version: str,
    encoder_hash: str,
    pooling_version: str,
    calibration_bins: int = 10,
    evaluation_splits: Sequence[str] = ("calibration", "holdout"),
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run the approved offline workflow without serializing derived sample material."""

    import numpy as np

    if exported_input.get("schemaVersion") != "gatelm.difficulty-semantic-head-training-input.v1":
        raise ValueError("unsupported semantic head training input schema")
    expected_specs = [
        {"name": spec.name, "classes": list(spec.classes)} for spec in SEMANTIC_HEAD_SPECS_V1
    ]
    if exported_input.get("semanticHeads") != expected_specs:
        raise ValueError("semantic head training input violates the fixed four-head contract")
    dataset_version = exported_input.get("datasetVersion")
    dataset_hash = exported_input.get("datasetSha256")
    family_policy_version = exported_input.get("familyPolicyVersion")
    family_policy = exported_input.get("familyPolicy")
    if not all(
        isinstance(value, str) and value.strip()
        for value in (dataset_version, family_policy_version, family_policy)
    ):
        raise ValueError("semantic head training input is missing immutable dataset policy material")
    if (
        not isinstance(dataset_hash, str)
        or len(dataset_hash) != 64
        or any(character not in "0123456789abcdef" for character in dataset_hash)
    ):
        raise ValueError("semantic head training dataset hash must be lowercase SHA-256")
    samples = exported_input.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ValueError("semantic head training input contains no eligible samples")

    family_partitions: dict[str, str] = {}
    split_indices: dict[str, list[int]] = {
        "train": [],
        "calibration": [],
        "holdout": [],
    }
    labels: dict[str, list[str]] = {spec.name: [] for spec in SEMANTIC_HEAD_SPECS_V1}
    metadata: list[dict[str, Any]] = []
    embeddings: list[Any] = []
    for index, sample in enumerate(samples):
        if not isinstance(sample, Mapping):
            raise ValueError("semantic head training sample must be an object")
        split = sample.get("split")
        family_id = sample.get("familyId")
        instruction = sample.get("instructionText")
        if split not in split_indices or not isinstance(family_id, str) or not family_id:
            raise ValueError("semantic head training sample has invalid split metadata")
        previous = family_partitions.setdefault(family_id, split)
        if previous != split:
            raise ValueError("semantic head training input is not family-disjoint")
        if not isinstance(instruction, str) or not instruction.strip():
            raise ValueError("semantic head training sample has no eligible instruction")
        encoded = np.asarray(encode_instruction(instruction), dtype=np.float32)
        if encoded.ndim != 1 or encoded.size == 0 or not np.all(np.isfinite(encoded)):
            raise ValueError("frozen encoder returned invalid semantic material")
        if embeddings and encoded.shape != embeddings[0].shape:
            raise ValueError("frozen encoder output dimension changed within one run")
        embeddings.append(encoded)
        split_indices[split].append(index)
        for spec in SEMANTIC_HEAD_SPECS_V1:
            value = sample.get(HEAD_LABEL_FIELDS[spec.name])
            if value not in spec.classes:
                raise ValueError(f"semantic head {spec.name!r} received an unsupported label")
            labels[spec.name].append(value)
        language = sample.get("language")
        slices = sample.get("evaluationSlices")
        if language not in LANGUAGE_BUCKETS or not isinstance(slices, list):
            raise ValueError("semantic head training sample has invalid evaluation metadata")
        metadata.append({"language": language, "evaluationSlices": list(slices)})

    if any(not indices for indices in split_indices.values()):
        raise ValueError("semantic head workflow requires non-empty train, calibration, and holdout splits")
    matrix = np.asarray(embeddings, dtype=np.float32)
    train_indices = np.asarray(split_indices["train"], dtype=np.int64)
    train_labels = {
        spec.name: [labels[spec.name][index] for index in split_indices["train"]]
        for spec in SEMANTIC_HEAD_SPECS_V1
    }
    artifact = train_semantic_heads(
        matrix[train_indices],
        train_labels,
        artifact_version=artifact_version,
        encoder_version=encoder_version,
        encoder_hash=encoder_hash,
        pooling_version=pooling_version,
    )
    train_families = {
        samples[index]["familyId"] for index in split_indices["train"]
    }
    artifact["training"].update(
        {
            "datasetVersion": dataset_version,
            "datasetHash": dataset_hash,
            "familyPolicyVersion": family_policy_version,
            "familyPolicy": family_policy,
            "trainSamples": len(split_indices["train"]),
            "trainFamilies": len(train_families),
        }
    )
    artifact["artifactContentHash"] = _artifact_hash(artifact)
    validate_semantic_heads_artifact(artifact)

    requested_evaluation_splits = tuple(evaluation_splits)
    if (
        not requested_evaluation_splits
        or len(set(requested_evaluation_splits)) != len(requested_evaluation_splits)
        or any(split not in {"calibration", "holdout"} for split in requested_evaluation_splits)
    ):
        raise ValueError("semantic head evaluation splits must be unique calibration/holdout values")
    split_reports: dict[str, Any] = {}
    for split in requested_evaluation_splits:
        indices = split_indices[split]
        index_array = np.asarray(indices, dtype=np.int64)
        probabilities = predict_semantic_head_probabilities(artifact, matrix[index_array])
        split_targets = {
            spec.name: [labels[spec.name][index] for index in indices]
            for spec in SEMANTIC_HEAD_SPECS_V1
        }
        split_metadata = [metadata[index] for index in indices]
        split_report = evaluate_semantic_head_probabilities(
            probabilities,
            split_targets,
            split_metadata,
            calibration_bins=calibration_bins,
        )
        split_report["familyCount"] = len({samples[index]["familyId"] for index in indices})
        split_reports[split] = split_report

    report = {
        "schemaVersion": "gatelm.difficulty-semantic-head-training-report.v1",
        "status": "offline_candidate_only",
        "promotionEligible": False,
        "datasetVersion": dataset_version,
        "datasetHash": dataset_hash,
        "familyPolicyVersion": family_policy_version,
        "semanticHeadsVersion": artifact["version"],
        "semanticHeadsArtifactHash": artifact["artifactContentHash"],
        "semanticHeadProbabilityDimension": SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1,
        "encoderVersion": encoder_version,
        "encoderHash": encoder_hash,
        "poolingVersion": pooling_version,
        "excludedEmptyInstructionCount": int(
            exported_input.get("excludedEmptyInstructionCount", 0)
        ),
        "train": {
            "sampleCount": len(split_indices["train"]),
            "familyCount": len(train_families),
        },
        "splits": split_reports,
    }
    return artifact, report
