"""Offline-only training orchestration for the fixed 42D/106D/118D candidates.

Request-derived text, embeddings, assembled vectors, probabilities, and scores
remain process-local. Only immutable parameter artifacts and aggregate reports
are returned by this module.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

from .encoder_runtime import canonical_hash
from .semantic_features import (
    RULE_VECTOR_V1_DIMENSION,
    RULE_VECTOR_V1_FEATURE_NAMES,
    RULE_VECTOR_V1_VERSION,
    SEMANTIC_HEAD_SPECS_V1,
    OfflineFeatureCandidate,
    OfflineFeatureShape,
    OfflineFeatureValues,
)
from .semantic_heads import (
    flatten_semantic_head_probabilities,
    predict_semantic_head_probabilities,
    train_and_evaluate_semantic_heads,
)
from .training import OfflineArtifactProvenance, train_from_offline_feature_matrix


CANDIDATE_COMPARISON_SCHEMA = "gatelm.difficulty-offline-candidate-comparison.v1"
EXPECTED_SPLIT_RECORDS = {"train": 300, "calibration": 100, "holdout": 100}
EXPECTED_TOTAL_RECORDS = sum(EXPECTED_SPLIT_RECORDS.values())
EXPECTED_PROJECTION_DIMENSION = 64
EXPECTED_POOLED_DIMENSION = 384
EXPECTED_CANDIDATE_DIMENSIONS = {
    OfflineFeatureCandidate.RULE_VECTOR_V1: 42,
    OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION: 106,
    OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS: 118,
}
ALLOWED_CATEGORIES = {"general", "code", "translation", "summarization", "reasoning"}
ALLOWED_DIFFICULTIES = {"simple", "complex"}
ALLOWED_SPLITS = set(EXPECTED_SPLIT_RECORDS)


def _sha256_identity(value: Any) -> str:
    return "sha256:" + canonical_hash(value)


def _require_hex_sha256(value: Any, name: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"{name} must be a lowercase SHA-256 digest")
    return value


def select_candidate_by_holdout_accuracy(
    candidate_reports: Mapping[str, Mapping[str, Any]],
) -> str:
    """Select the unique candidate with the highest holdout accuracy."""

    if not candidate_reports:
        raise ValueError("candidate selection requires at least one candidate report")

    accuracies: dict[str, float] = {}
    for candidate_name, report in candidate_reports.items():
        holdout = report.get("holdoutClassification")
        if not isinstance(holdout, Mapping):
            raise ValueError(f"candidate {candidate_name} has no holdout classification")
        accuracy = holdout.get("accuracy")
        if (
            not isinstance(accuracy, (int, float))
            or isinstance(accuracy, bool)
            or not math.isfinite(float(accuracy))
            or float(accuracy) < 0
            or float(accuracy) > 1
        ):
            raise ValueError(f"candidate {candidate_name} has an invalid holdout accuracy")
        accuracies[candidate_name] = float(accuracy)

    highest_accuracy = max(accuracies.values())
    selected = [
        candidate_name
        for candidate_name, accuracy in accuracies.items()
        if accuracy == highest_accuracy
    ]
    if len(selected) != 1:
        raise ValueError("candidate selection requires a unique highest holdout accuracy")
    return selected[0]


def validate_candidate_training_input(exported_input: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Validate the single canonical 500-record input shared by all candidates."""

    if exported_input.get("schemaVersion") != "gatelm.difficulty-semantic-head-training-input.v1":
        raise ValueError("unsupported semantic candidate training input schema")
    if exported_input.get("featureVersion") != RULE_VECTOR_V1_VERSION:
        raise ValueError("semantic candidate input must preserve difficulty-feature-vector.v1")
    if tuple(exported_input.get("featureNames", ())) != RULE_VECTOR_V1_FEATURE_NAMES:
        raise ValueError("semantic candidate input must contain the exact 42D v1 feature order")
    if exported_input.get("categorySource") != "actual":
        raise ValueError("semantic candidate vectors must use the actual category classifier result")
    _require_hex_sha256(exported_input.get("datasetSha256"), "dataset hash")
    _require_hex_sha256(exported_input.get("manifestSha256"), "manifest hash")
    if not isinstance(exported_input.get("datasetVersion"), str) or not exported_input["datasetVersion"]:
        raise ValueError("semantic candidate dataset version is required")
    if not isinstance(exported_input.get("splitPolicyVersion"), str) or not exported_input["splitPolicyVersion"]:
        raise ValueError("semantic candidate split policy version is required")
    if isinstance(exported_input.get("splitSeed"), bool) or not isinstance(exported_input.get("splitSeed"), int):
        raise ValueError("semantic candidate split seed must be an integer")
    if exported_input.get("excludedEmptyInstructionCount") != 0:
        raise ValueError("initial semantic candidates do not admit empty instruction samples")

    expected_heads = [
        {"name": spec.name, "classes": list(spec.classes)} for spec in SEMANTIC_HEAD_SPECS_V1
    ]
    if exported_input.get("semanticHeads") != expected_heads:
        raise ValueError("semantic candidate input violates the fixed four-head contract")

    declared_split_counts = exported_input.get("splitCounts")
    if not isinstance(declared_split_counts, Mapping) or set(declared_split_counts) != ALLOWED_SPLITS:
        raise ValueError("semantic candidate input must declare exact train/calibration/holdout counts")
    for split, expected_records in EXPECTED_SPLIT_RECORDS.items():
        declared = declared_split_counts[split]
        if (
            not isinstance(declared, Mapping)
            or declared.get("records") != expected_records
            or isinstance(declared.get("families"), bool)
            or not isinstance(declared.get("families"), int)
            or declared["families"] <= 0
        ):
            raise ValueError(f"semantic candidate {split} split must contain exactly {expected_records} records")

    samples = exported_input.get("samples")
    if isinstance(samples, (str, bytes)) or not isinstance(samples, Sequence):
        raise ValueError("semantic candidate samples must be a sequence")
    if len(samples) != EXPECTED_TOTAL_RECORDS:
        raise ValueError("semantic candidate input must contain exactly 500 records")

    seen_sample_ids: set[str] = set()
    family_splits: dict[str, set[str]] = defaultdict(set)
    actual_split_records = {split: 0 for split in EXPECTED_SPLIT_RECORDS}
    actual_split_families = {split: set() for split in EXPECTED_SPLIT_RECORDS}
    for index, sample in enumerate(samples):
        if not isinstance(sample, Mapping):
            raise ValueError(f"semantic candidate sample {index} must be an object")
        sample_id = sample.get("sampleId")
        family_id = sample.get("familyId")
        split = sample.get("split")
        if not isinstance(sample_id, str) or not sample_id or sample_id in seen_sample_ids:
            raise ValueError("semantic candidate sample IDs must be non-empty and unique")
        if not isinstance(family_id, str) or not family_id or split not in ALLOWED_SPLITS:
            raise ValueError(f"semantic candidate sample {index} has invalid family/split metadata")
        seen_sample_ids.add(sample_id)
        family_splits[family_id].add(split)
        actual_split_records[split] += 1
        actual_split_families[split].add(family_id)

        label = sample.get("label")
        expected_difficulty = sample.get("expectedDifficulty")
        if isinstance(label, bool) or label not in (0, 1):
            raise ValueError(f"semantic candidate sample {index} must have a binary label")
        if expected_difficulty not in ALLOWED_DIFFICULTIES or label != (1 if expected_difficulty == "complex" else 0):
            raise ValueError(f"semantic candidate sample {index} label does not match expected difficulty")
        if sample.get("expectedCategory") not in ALLOWED_CATEGORIES:
            raise ValueError(f"semantic candidate sample {index} has an invalid expected category")
        if sample.get("actualCategory") not in ALLOWED_CATEGORIES or sample.get("vectorCategory") != sample.get("actualCategory"):
            raise ValueError(f"semantic candidate sample {index} does not use the actual category")
        if sample.get("ruleDifficulty") not in ALLOWED_DIFFICULTIES or not isinstance(sample.get("modelPath"), bool):
            raise ValueError(f"semantic candidate sample {index} has invalid rule/model-path metadata")
        if not isinstance(sample.get("instructionText"), str) or not sample["instructionText"]:
            raise ValueError(f"semantic candidate sample {index} has no eligible instruction")

        vector = sample.get("ruleVectorV1")
        if isinstance(vector, (str, bytes)) or not isinstance(vector, Sequence) or len(vector) != RULE_VECTOR_V1_DIMENSION:
            raise ValueError(f"semantic candidate sample {index} must contain exact 42D ruleVectorV1")
        if any(
            isinstance(value, (bool, str, bytes))
            or not math.isfinite(float(value))
            or float(value) < 0.0
            or float(value) > 1.0
            for value in vector
        ):
            raise ValueError(f"semantic candidate sample {index} contains invalid ruleVectorV1 material")
        for spec in SEMANTIC_HEAD_SPECS_V1:
            field = {
                "semanticTaskBucket": "taskBucket",
                "semanticConstraintBucket": "constraintBucket",
                "semanticScopeBucket": "scopeBucket",
                "semanticDependencyBucket": "dependencyBucket",
            }[spec.name]
            if sample.get(field) not in spec.classes:
                raise ValueError(f"semantic candidate sample {index} has an invalid semantic head target")

    if any(len(splits) != 1 for splits in family_splits.values()):
        raise ValueError("semantic candidate prompt family leaked across splits")
    if actual_split_records != EXPECTED_SPLIT_RECORDS:
        raise ValueError("semantic candidate actual split counts are not exactly 300/100/100")
    for split in EXPECTED_SPLIT_RECORDS:
        if len(actual_split_families[split]) != declared_split_counts[split]["families"]:
            raise ValueError(f"semantic candidate {split} family count does not match the manifest")
    return list(samples)


def candidate_membership_hash(samples: Sequence[Mapping[str, Any]]) -> str:
    material = [
        {
            "sampleId": sample["sampleId"],
            "familyId": sample["familyId"],
            "split": sample["split"],
            "label": sample["label"],
            "modelPath": sample["modelPath"],
            "expectedCategory": sample["expectedCategory"],
        }
        for sample in samples
    ]
    return _sha256_identity(material)


def assemble_candidate_samples(
    samples: Sequence[Mapping[str, Any]],
    projected_embeddings: Any,
    semantic_head_probabilities: Mapping[str, Any],
    shape: OfflineFeatureShape,
) -> dict[OfflineFeatureCandidate, list[dict[str, Any]]]:
    """Assemble all three matrices from one sample sequence without serialization."""

    import numpy as np

    projected = np.asarray(projected_embeddings, dtype=np.float64)
    if projected.shape != (len(samples), EXPECTED_PROJECTION_DIMENSION) or not np.all(np.isfinite(projected)):
        raise ValueError("semantic projection must be finite float material with shape [500,64]")

    result = {candidate: [] for candidate in OfflineFeatureCandidate}
    for index, sample in enumerate(samples):
        rule = tuple(float(value) for value in sample["ruleVectorV1"])
        projection = tuple(float(value) for value in projected[index])
        heads = {
            spec.name: tuple(float(value) for value in semantic_head_probabilities[spec.name][index])
            for spec in SEMANTIC_HEAD_SPECS_V1
        }
        values_by_candidate = {
            OfflineFeatureCandidate.RULE_VECTOR_V1: OfflineFeatureValues(rule_vector_v1=rule),
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION: OfflineFeatureValues(
                rule_vector_v1=rule,
                semantic_projection=projection,
            ),
            OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS: OfflineFeatureValues(
                rule_vector_v1=rule,
                semantic_projection=projection,
                semantic_head_probabilities=heads,
            ),
        }
        for candidate, values in values_by_candidate.items():
            vector = shape.assemble(candidate, values)
            descriptor = shape.descriptor(candidate)
            if descriptor.total_dimension != EXPECTED_CANDIDATE_DIMENSIONS[candidate]:
                raise ValueError("semantic candidate descriptor dimension is not 42/106/118")
            result[candidate].append(
                {
                    "sampleId": sample["sampleId"],
                    "familyId": sample["familyId"],
                    "split": sample["split"],
                    "label": sample["label"],
                    "modelPath": sample["modelPath"],
                    "expectedCategory": sample["expectedCategory"],
                    "ruleDifficulty": sample["ruleDifficulty"],
                    "vector": vector,
                }
            )

        rule_vector = result[OfflineFeatureCandidate.RULE_VECTOR_V1][-1]["vector"]
        projection_vector = result[OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION][-1]["vector"]
        combined_vector = result[OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS][-1]["vector"]
        if projection_vector[:42] != rule_vector or combined_vector[:106] != projection_vector:
            raise ValueError("semantic candidate vectors do not share exact 42D/106D prefixes")

    expected_membership = candidate_membership_hash(samples)
    for candidate_samples in result.values():
        if candidate_membership_hash(candidate_samples) != expected_membership:
            raise ValueError("semantic candidates do not share the same sample membership and split")
    return result


def _stable_sigmoid(values: Any) -> Any:
    import numpy as np

    array = np.asarray(values, dtype=np.float64)
    result = np.empty_like(array)
    nonnegative = array >= 0
    result[nonnegative] = 1.0 / (1.0 + np.exp(-array[nonnegative]))
    exponent = np.exp(array[~nonnegative])
    result[~nonnegative] = exponent / (1.0 + exponent)
    return result


def _artifact_scores(artifact: Mapping[str, Any], vectors: Any) -> Any:
    import numpy as np

    matrix = np.asarray(vectors, dtype=np.float64)
    weights = np.asarray(artifact["weights"], dtype=np.float64)
    if matrix.ndim != 2 or matrix.shape[1] != weights.shape[0]:
        raise ValueError("candidate scoring matrix does not match artifact dimension")
    raw = _stable_sigmoid(matrix @ weights + float(artifact["bias"]))
    calibrator = artifact["calibrator"]
    if calibrator["type"] == "platt":
        calibrated = _stable_sigmoid(
            float(calibrator["coefficient"]) * raw + float(calibrator["intercept"])
        )
    elif calibrator["type"] == "isotonic":
        x = np.asarray(calibrator["xThresholds"], dtype=np.float64)
        y = np.asarray(calibrator["yThresholds"], dtype=np.float64)
        calibrated = y[np.clip(np.searchsorted(x, raw, side="right") - 1, 0, len(y) - 1)]
    else:
        raise ValueError("candidate artifact contains an unsupported calibrator")
    if not np.all(np.isfinite(calibrated)) or np.any(calibrated < 0.0) or np.any(calibrated > 1.0):
        raise ValueError("candidate artifact produced invalid calibrated scores")
    return calibrated


def _classification_summary(
    samples: Sequence[Mapping[str, Any]], predictions: Sequence[str]
) -> dict[str, Any]:
    if len(samples) != len(predictions):
        raise ValueError("classification predictions do not align with samples")
    total = len(samples)
    correct = sum(
        prediction == sample["expectedDifficulty"]
        for sample, prediction in zip(samples, predictions)
    )
    simple_expected = sum(sample["expectedDifficulty"] == "simple" for sample in samples)
    complex_expected = total - simple_expected
    simple_to_complex = sum(
        sample["expectedDifficulty"] == "simple" and prediction == "complex"
        for sample, prediction in zip(samples, predictions)
    )
    complex_to_simple = sum(
        sample["expectedDifficulty"] == "complex" and prediction == "simple"
        for sample, prediction in zip(samples, predictions)
    )
    by_category: dict[str, Any] = {}
    for category in sorted({sample["expectedCategory"] for sample in samples}):
        indices = [index for index, sample in enumerate(samples) if sample["expectedCategory"] == category]
        category_samples = [samples[index] for index in indices]
        category_predictions = [predictions[index] for index in indices]
        category_correct = sum(
            prediction == sample["expectedDifficulty"]
            for sample, prediction in zip(category_samples, category_predictions)
        )
        category_complex = sum(sample["expectedDifficulty"] == "complex" for sample in category_samples)
        category_complex_to_simple = sum(
            sample["expectedDifficulty"] == "complex" and prediction == "simple"
            for sample, prediction in zip(category_samples, category_predictions)
        )
        by_category[category] = {
            "samples": len(indices),
            "accuracy": category_correct / len(indices),
            "complexExpectedSamples": category_complex,
            "complexToSimpleCount": category_complex_to_simple,
            "complexToSimpleRate": (
                category_complex_to_simple / category_complex if category_complex else 0.0
            ),
        }
    return {
        "samples": total,
        "correct": correct,
        "accuracy": correct / total if total else 0.0,
        "simpleExpectedSamples": simple_expected,
        "simpleToComplexCount": simple_to_complex,
        "simpleToComplexRate": simple_to_complex / simple_expected if simple_expected else 0.0,
        "complexExpectedSamples": complex_expected,
        "complexToSimpleCount": complex_to_simple,
        "complexToSimpleRate": complex_to_simple / complex_expected if complex_expected else 0.0,
        "byExpectedCategory": by_category,
    }


def _holdout_predictions(
    artifact: Mapping[str, Any], candidate_samples: Sequence[Mapping[str, Any]]
) -> list[str]:
    import numpy as np

    predictions = [sample["ruleDifficulty"] for sample in candidate_samples]
    model_indices = [index for index, sample in enumerate(candidate_samples) if sample["modelPath"]]
    if model_indices:
        scores = _artifact_scores(
            artifact,
            np.asarray([candidate_samples[index]["vector"] for index in model_indices]),
        )
        for index, score in zip(model_indices, scores):
            predictions[index] = "complex" if float(score) >= float(artifact["threshold"]) else "simple"
    return predictions


def build_component_hashes(
    encoder_manifest: Mapping[str, Any], semantic_heads_artifact: Mapping[str, Any]
) -> dict[str, str]:
    runtime_artifacts = encoder_manifest.get("runtimeArtifacts", [])
    tokenizer_material = [
        item
        for item in runtime_artifacts
        if item.get("role")
        in {
            "special_tokens",
            "tokenizer_json",
            "tokenizer_config",
            "tokenizer_model",
        }
    ]
    encoder_entry = next(
        (item for item in runtime_artifacts if item.get("role") == "encoder_onnx_dynamic_qint8"),
        None,
    )
    if encoder_entry is None:
        raise ValueError("encoder manifest is missing the pinned QInt8 artifact")
    projection_hash = _require_hex_sha256(
        encoder_manifest.get("projection", {}).get("parameterSha256"),
        "projection parameter hash",
    )
    semantic_hash = _require_hex_sha256(
        semantic_heads_artifact.get("artifactContentHash"),
        "semantic heads artifact hash",
    )
    return {
        "ruleVector": _sha256_identity(
            {"version": RULE_VECTOR_V1_VERSION, "featureNames": list(RULE_VECTOR_V1_FEATURE_NAMES)}
        ),
        "tokenizer": _sha256_identity(
            {
                "preprocessing": encoder_manifest.get("preprocessing"),
                "artifacts": tokenizer_material,
            }
        ),
        "encoder": "sha256:"
        + _require_hex_sha256(encoder_entry.get("sha256"), "encoder artifact hash"),
        "projection": "sha256:" + projection_hash,
        "semanticHeads": "sha256:" + semantic_hash,
    }


def train_candidate_suite(
    exported_input: Mapping[str, Any],
    pooled_embeddings: Any,
    projected_embeddings: Any,
    *,
    policy: dict[str, Any],
    encoder_manifest: Mapping[str, Any],
    projection_parameters: Mapping[str, Any],
    semantic_heads_artifact_version: str,
    artifact_version_prefix: str,
    bundle_version: str,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, Any]]:
    """Train all candidates with one exact split and return aggregate-only evidence."""

    import numpy as np

    samples = validate_candidate_training_input(exported_input)
    if policy.get("splitPolicyVersion") != exported_input["splitPolicyVersion"]:
        raise ValueError("semantic candidate policy does not match the canonical split policy")
    dataset_manifest = encoder_manifest.get("dataset")
    if not isinstance(dataset_manifest, Mapping) or any(
        (
            dataset_manifest.get("version") != exported_input["datasetVersion"],
            dataset_manifest.get("sha256") != exported_input["datasetSha256"],
            dataset_manifest.get("splitPolicyVersion") != exported_input["splitPolicyVersion"],
            dataset_manifest.get("splitSeed") != exported_input["splitSeed"],
            dataset_manifest.get("splitCounts") != exported_input["splitCounts"],
        )
    ):
        raise ValueError("encoder/PCA dataset split does not match the candidate training input")

    pooled = np.asarray(pooled_embeddings, dtype=np.float32)
    projected = np.asarray(projected_embeddings, dtype=np.float32)
    if pooled.shape != (EXPECTED_TOTAL_RECORDS, EXPECTED_POOLED_DIMENSION) or not np.all(np.isfinite(pooled)):
        raise ValueError("pooled semantic embeddings must have finite shape [500,384]")
    if projected.shape != (EXPECTED_TOTAL_RECORDS, EXPECTED_PROJECTION_DIMENSION) or not np.all(np.isfinite(projected)):
        raise ValueError("projected semantic embeddings must have finite shape [500,64]")

    cursor = 0

    def replay_projected(instruction_text: str) -> Any:
        nonlocal cursor
        if cursor >= len(samples) or instruction_text != samples[cursor]["instructionText"]:
            raise ValueError("semantic head embedding replay does not match canonical sample order")
        value = projected[cursor]
        cursor += 1
        return value

    semantic_heads_artifact, semantic_heads_report = train_and_evaluate_semantic_heads(
        exported_input,
        replay_projected,
        artifact_version=semantic_heads_artifact_version,
        encoder_version=str(encoder_manifest["bundleVersion"]),
        encoder_hash=_require_hex_sha256(encoder_manifest.get("bundleSha256"), "encoder bundle hash"),
        pooling_version=str(encoder_manifest["pooling"]["version"]),
    )
    if cursor != EXPECTED_TOTAL_RECORDS:
        raise ValueError("semantic head workflow did not consume all 500 canonical samples")
    semantic_head_probabilities = predict_semantic_head_probabilities(
        semantic_heads_artifact, projected
    )

    shape = OfflineFeatureShape(
        projection_dimension=EXPECTED_PROJECTION_DIMENSION,
        projection_version=str(encoder_manifest["projection"]["version"]),
        semantic_heads_version=semantic_heads_artifact["version"],
    )
    candidate_samples = assemble_candidate_samples(
        samples,
        projected,
        semantic_head_probabilities,
        shape,
    )
    membership_hash = candidate_membership_hash(samples)

    tokenizer_version = (
        "difficulty-tokenizer.multilingual-e5-small."
        + str(encoder_manifest["sourceRevision"])
        + ".v1"
    )
    component_hashes = build_component_hashes(encoder_manifest, semantic_heads_artifact)
    provenance = OfflineArtifactProvenance(
        preprocessing_version=str(encoder_manifest["preprocessing"]["version"]),
        tokenizer_version=tokenizer_version,
        encoder_version=str(encoder_manifest["encoder"]["version"]),
        pooling_version=str(encoder_manifest["pooling"]["version"]),
        projection_parameters=projection_parameters,
        semantic_head_input_dimension=EXPECTED_PROJECTION_DIMENSION,
        semantic_head_parameters=semantic_heads_artifact["heads"],
        training_dataset_version=str(exported_input["datasetVersion"]),
        training_dataset_sha256=str(exported_input["datasetSha256"]),
        split_policy_version=str(exported_input["splitPolicyVersion"]),
        split_manifest_sha256=str(exported_input["manifestSha256"]),
        training_policy_version=str(policy["policyVersion"]),
        threshold_policy_version=str(policy["threshold"]["policyVersion"]),
        threshold=float(policy["threshold"]["value"]),
        component_hashes=component_hashes,
        bundle_version=bundle_version,
    )

    holdout_source = [sample for sample in samples if sample["split"] == "holdout"]
    baseline_predictions = [sample["ruleDifficulty"] for sample in holdout_source]
    baseline_summary = _classification_summary(holdout_source, baseline_predictions)
    artifacts: dict[str, dict[str, Any]] = {}
    candidate_reports: dict[str, Any] = {}
    for candidate in OfflineFeatureCandidate:
        descriptor = shape.descriptor(candidate)
        artifact_version = artifact_version_prefix + "." + candidate.value + ".v1"
        artifact, training_report = train_from_offline_feature_matrix(
            candidate_samples[candidate],
            descriptor,
            policy,
            artifact_version,
            provenance,
        )
        artifacts[candidate.value] = artifact
        holdout_candidate_samples = [
            sample for sample in candidate_samples[candidate] if sample["split"] == "holdout"
        ]
        predictions = _holdout_predictions(artifact, holdout_candidate_samples)
        classification = _classification_summary(holdout_source, predictions)
        candidate_reports[candidate.value] = {
            "candidateName": candidate.value,
            "totalDimension": descriptor.total_dimension,
            "membershipHash": membership_hash,
            "artifactVersion": artifact["artifactVersion"],
            "bundleHash": artifact["bundleHash"],
            "contentHash": artifact["contentHash"],
            "calibratorType": artifact["calibrator"]["type"],
            "training": training_report,
            "holdoutClassification": classification,
            "deltaVsRule": {
                "accuracy": classification["accuracy"] - baseline_summary["accuracy"],
                "complexToSimpleCount": classification["complexToSimpleCount"]
                - baseline_summary["complexToSimpleCount"],
            },
        }

    selected_candidate = select_candidate_by_holdout_accuracy(candidate_reports)

    comparison_report = {
        "schemaVersion": CANDIDATE_COMPARISON_SCHEMA,
        "status": "offline_selection_evidence_not_runtime_promotion",
        "datasetVersion": exported_input["datasetVersion"],
        "datasetSha256": exported_input["datasetSha256"],
        "splitPolicyVersion": exported_input["splitPolicyVersion"],
        "splitSeed": exported_input["splitSeed"],
        "splitCounts": exported_input["splitCounts"],
        "membershipHash": membership_hash,
        "candidateDimensions": {
            candidate.value: EXPECTED_CANDIDATE_DIMENSIONS[candidate]
            for candidate in OfflineFeatureCandidate
        },
        "ruleBaselineHoldout": baseline_summary,
        "semanticHeads": semantic_heads_report,
        "candidates": candidate_reports,
        "selectedCandidate": selected_candidate,
        "productRuntimeChanged": False,
        "finalPromotionHoldoutRequiredAfterSelection": True,
    }
    return semantic_heads_artifact, artifacts, comparison_report
