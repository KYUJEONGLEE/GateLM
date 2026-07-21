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


CANDIDATE_COMPARISON_SCHEMA = "gatelm.difficulty-offline-candidate-comparison.v2"
EXPECTED_SPLIT_RECORDS = {"train": 300, "calibration": 100, "holdout": 100}
EXPECTED_MODEL_PATH_SPLIT_RECORDS = {"train": 244, "calibration": 85, "holdout": 64}
EXPECTED_TOTAL_RECORDS = sum(EXPECTED_SPLIT_RECORDS.values())
CANONICAL_DATASET_VERSION = "routing_difficulty_initial_15000_owner_approved_2026_07_22"
CANONICAL_SPLIT_RECORDS = {"train": 10_500, "calibration": 2_250, "holdout": 2_250}
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


def _finite_metric(value: Any, name: str) -> float:
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or not math.isfinite(float(value))
        or float(value) < 0.0
    ):
        raise ValueError(f"{name} must be a finite non-negative number")
    return float(value)


def _selection_evidence(training_report: Mapping[str, Any]) -> dict[str, Any]:
    calibration = training_report.get("calibrationSelection")
    if not isinstance(calibration, Mapping):
        raise ValueError("candidate training report has no calibration selection evidence")
    selected_type = calibration.get("selectedType")
    candidates = calibration.get("candidates")
    if not isinstance(selected_type, str) or not isinstance(candidates, Sequence):
        raise ValueError("candidate calibration selection evidence is malformed")
    selected = next(
        (
            candidate
            for candidate in candidates
            if isinstance(candidate, Mapping)
            and candidate.get("type") == selected_type
            and candidate.get("status") == "valid"
        ),
        None,
    )
    if selected is None:
        raise ValueError("selected calibrator has no valid family-grouped CV evidence")
    return {
        "evidenceSplit": "calibration",
        "evaluationMethod": "selected_calibrator_family_grouped_cross_validation",
        "selectedCalibratorType": selected_type,
        "groupCvLogLoss": _finite_metric(selected.get("logLoss"), "calibration group-CV log loss"),
        "groupCvBrierScore": _finite_metric(
            selected.get("brierScore"), "calibration group-CV Brier score"
        ),
    }


def select_candidate_by_calibration_evidence(
    candidate_reports: Mapping[str, Mapping[str, Any]],
    selection_policy: Mapping[str, Any],
) -> str:
    """Select a candidate without reading holdout outcomes."""

    if not candidate_reports:
        raise ValueError("candidate selection requires at least one candidate report")
    selection_mode = selection_policy.get("selectionMode", "calibration_ranking")
    if (
        selection_policy.get("evidenceSplit") != "calibration"
        or selection_policy.get("selectionMetric")
        != "selected_calibrator_group_cv_log_loss"
        or selection_policy.get("tieBreakers")
        != ["selected_calibrator_group_cv_brier_score", "lower_dimension"]
        or selection_policy.get("holdoutUsage")
        not in {
            "final_evaluation_after_candidate_freeze_only",
            "diagnostic_only_after_candidate_freeze_new_untouched_holdout_required",
        }
    ):
        raise ValueError("candidate selection policy must keep holdout final and untouched")
    if selection_mode == "fixed_candidate_retrain":
        fixed_candidate = selection_policy.get("fixedCandidate")
        if not isinstance(fixed_candidate, str) or fixed_candidate not in candidate_reports:
            raise ValueError("fixed candidate retraining requires an existing candidate name")
        return fixed_candidate
    if selection_mode != "calibration_ranking":
        raise ValueError("unsupported candidate selection mode")
    tolerance = _finite_metric(selection_policy.get("tieTolerance"), "candidate tie tolerance")

    scored: list[tuple[str, float, float, int]] = []
    for candidate_name, report in candidate_reports.items():
        evidence = report.get("selectionEvidence")
        dimension = report.get("totalDimension")
        if not isinstance(evidence, Mapping) or evidence.get("evidenceSplit") != "calibration":
            raise ValueError(f"candidate {candidate_name} has no calibration selection evidence")
        if isinstance(dimension, bool) or not isinstance(dimension, int) or dimension <= 0:
            raise ValueError(f"candidate {candidate_name} has an invalid dimension")
        scored.append(
            (
                candidate_name,
                _finite_metric(evidence.get("groupCvLogLoss"), "candidate group-CV log loss"),
                _finite_metric(evidence.get("groupCvBrierScore"), "candidate group-CV Brier score"),
                dimension,
            )
        )

    best_log_loss = min(item[1] for item in scored)
    contenders = [item for item in scored if abs(item[1] - best_log_loss) <= tolerance]
    best_brier = min(item[2] for item in contenders)
    contenders = [item for item in contenders if abs(item[2] - best_brier) <= tolerance]
    best_dimension = min(item[3] for item in contenders)
    selected = [item[0] for item in contenders if item[3] == best_dimension]
    if len(selected) != 1:
        raise ValueError("candidate calibration selection tie could not be resolved")
    return selected[0]


def validate_candidate_training_input(exported_input: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """Validate the exact approved input shared by all candidates in one run."""

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
    expected_split_records = (
        CANONICAL_SPLIT_RECORDS
        if exported_input.get("datasetVersion") == CANONICAL_DATASET_VERSION
        else EXPECTED_SPLIT_RECORDS
    )
    for split, expected_records in expected_split_records.items():
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
    expected_total_records = sum(expected_split_records.values())
    if len(samples) != expected_total_records:
        raise ValueError(
            f"semantic candidate input must contain exactly {expected_total_records} records"
        )

    seen_sample_ids: set[str] = set()
    family_splits: dict[str, set[str]] = defaultdict(set)
    actual_split_records = {split: 0 for split in expected_split_records}
    actual_model_path_records = {split: 0 for split in expected_split_records}
    actual_split_families = {split: set() for split in expected_split_records}
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
        if sample["modelPath"]:
            actual_model_path_records[split] += 1
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
    if actual_split_records != expected_split_records:
        raise ValueError("semantic candidate actual split counts differ from the approved manifest")
    if (
        expected_split_records == EXPECTED_SPLIT_RECORDS
        and actual_model_path_records != EXPECTED_MODEL_PATH_SPLIT_RECORDS
    ):
        raise ValueError(
            "semantic candidate model-path counts must be exactly "
            "train=244 calibration=85 holdout=64 within the 300/100/100 partitions"
        )
    if expected_split_records == CANONICAL_SPLIT_RECORDS and any(
        actual_model_path_records[split] <= 0 for split in expected_split_records
    ):
        raise ValueError("canonical semantic candidate requires model-path coverage in every split")
    for split in expected_split_records:
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
        raise ValueError("semantic projection must be finite float material with shape [records,64]")

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


def _complex_to_simple_safety_gate(
    candidate: Mapping[str, Any], baseline: Mapping[str, Any]
) -> dict[str, Any]:
    def comparison(candidate_row: Mapping[str, Any], baseline_row: Mapping[str, Any]) -> dict[str, Any]:
        candidate_count = int(candidate_row["complexToSimpleCount"])
        baseline_count = int(baseline_row["complexToSimpleCount"])
        candidate_rate = float(candidate_row["complexToSimpleRate"])
        baseline_rate = float(baseline_row["complexToSimpleRate"])
        return {
            "candidateCount": candidate_count,
            "baselineCount": baseline_count,
            "candidateRate": candidate_rate,
            "baselineRate": baseline_rate,
            "passed": candidate_count <= baseline_count and candidate_rate <= baseline_rate,
        }

    overall = comparison(candidate, baseline)
    candidate_categories = candidate.get("byExpectedCategory")
    baseline_categories = baseline.get("byExpectedCategory")
    if not isinstance(candidate_categories, Mapping) or not isinstance(baseline_categories, Mapping):
        raise ValueError("holdout safety gate requires category-level directional errors")
    if set(candidate_categories) != set(baseline_categories):
        raise ValueError("candidate and baseline holdout categories do not match")
    by_category = {
        category: comparison(candidate_categories[category], baseline_categories[category])
        for category in sorted(candidate_categories)
    }
    return {
        "policy": "complex_to_simple_non_increase_overall_and_each_expected_category",
        "overall": overall,
        "byExpectedCategory": by_category,
        "passed": overall["passed"] and all(row["passed"] for row in by_category.values()),
    }


def _hybrid_predictions(
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
                "executionShape": encoder_manifest.get("executionShape"),
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
    execution_shape = encoder_manifest.get("executionShape")
    if not isinstance(execution_shape, Mapping) or execution_shape.get("batchSize") != 1:
        raise ValueError("semantic candidates require the canonical single-request execution shape")
    if policy.get("embeddingExecution") != {
        "policyVersion": execution_shape.get("policyVersion"),
        "unit": "single_request",
        "batchSize": 1,
        "paddingScope": "within_request_only",
        "appliesTo": [
            "pca_fit",
            "semantic_head_training",
            "difficulty_candidate_training",
            "calibration",
            "diagnostic_evaluation",
            "gateway_replay",
        ],
    }:
        raise ValueError("semantic candidate policy execution shape does not match the encoder")
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
    record_count = len(samples)
    if pooled.shape != (record_count, EXPECTED_POOLED_DIMENSION) or not np.all(np.isfinite(pooled)):
        raise ValueError("pooled semantic embeddings must have finite shape [records,384]")
    if projected.shape != (record_count, EXPECTED_PROJECTION_DIMENSION) or not np.all(np.isfinite(projected)):
        raise ValueError("projected semantic embeddings must have finite shape [records,64]")

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
        evaluation_splits=("calibration",),
    )
    if cursor != record_count:
        raise ValueError("semantic head workflow did not consume all canonical samples")
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

    artifacts: dict[str, dict[str, Any]] = {}
    candidate_reports: dict[str, Any] = {}
    for candidate in OfflineFeatureCandidate:
        descriptor = shape.descriptor(candidate)
        artifact_version = artifact_version_prefix + "." + candidate.value + ".v3"
        artifact, training_report = train_from_offline_feature_matrix(
            candidate_samples[candidate],
            descriptor,
            policy,
            artifact_version,
            provenance,
        )
        artifacts[candidate.value] = artifact
        candidate_reports[candidate.value] = {
            "candidateName": candidate.value,
            "totalDimension": descriptor.total_dimension,
            "membershipHash": membership_hash,
            "artifactVersion": artifact["artifactVersion"],
            "bundleHash": artifact["bundleHash"],
            "contentHash": artifact["contentHash"],
            "calibratorType": artifact["calibrator"]["type"],
            "training": training_report,
            "selectionEvidence": _selection_evidence(training_report),
        }

    selection_policy = policy.get("candidateSelection")
    if not isinstance(selection_policy, Mapping):
        raise ValueError("semantic candidate policy has no holdout-safe candidate selection policy")
    selected_candidate = select_candidate_by_calibration_evidence(
        candidate_reports, selection_policy
    )
    selected_kind = OfflineFeatureCandidate(selected_candidate)
    selected_artifact = artifacts[selected_candidate]
    selected_report = candidate_reports[selected_candidate]

    # Holdout outcomes are intentionally read only after candidate and calibrator freeze.
    holdout_source = [sample for sample in samples if sample["split"] == "holdout"]
    holdout_candidate_samples = [
        sample for sample in candidate_samples[selected_kind] if sample["split"] == "holdout"
    ]
    selected_predictions = _hybrid_predictions(selected_artifact, holdout_candidate_samples)
    selected_classification = _classification_summary(holdout_source, selected_predictions)
    baseline_predictions = [sample["ruleDifficulty"] for sample in holdout_source]
    baseline_summary = _classification_summary(holdout_source, baseline_predictions)
    promotion_safety_gate = _complex_to_simple_safety_gate(
        selected_classification, baseline_summary
    )
    final_holdout_evaluation = {
        "status": "diagnostic_replay_after_single_request_artifact_change",
        "accessPolicy": "previously_observed_holdout_diagnostic_only_not_promotion",
        "candidateName": selected_candidate,
        "artifactVersion": selected_artifact["artifactVersion"],
        "contentHash": selected_artifact["contentHash"],
        "bundleHash": selected_artifact["bundleHash"],
        "samples": len(holdout_source),
        "families": len({sample["familyId"] for sample in holdout_source}),
        "selectedCandidateClassification": selected_classification,
        "ruleBaselineClassification": baseline_summary,
        "promotionSafetyGate": promotion_safety_gate,
        "deltaVsRule": {
            "accuracy": selected_classification["accuracy"] - baseline_summary["accuracy"],
            "complexToSimpleCount": selected_classification["complexToSimpleCount"]
            - baseline_summary["complexToSimpleCount"],
        },
    }

    comparison_report = {
        "schemaVersion": CANDIDATE_COMPARISON_SCHEMA,
        "status": "offline_single_request_retraining_with_diagnostic_holdout_not_runtime_promotion",
        "datasetVersion": exported_input["datasetVersion"],
        "datasetSha256": exported_input["datasetSha256"],
        "splitPolicyVersion": exported_input["splitPolicyVersion"],
        "splitSeed": exported_input["splitSeed"],
        "splitCounts": exported_input["splitCounts"],
        "executionShape": dict(execution_shape),
        "membershipHash": membership_hash,
        "candidateDimensions": {
            candidate.value: EXPECTED_CANDIDATE_DIMENSIONS[candidate]
            for candidate in OfflineFeatureCandidate
        },
        "semanticHeads": semantic_heads_report,
        "selectionPolicy": dict(selection_policy),
        "candidates": candidate_reports,
        "selectedCandidate": selected_candidate,
        "selectedCandidateFreeze": {
            "candidateName": selected_candidate,
            "artifactVersion": selected_artifact["artifactVersion"],
            "contentHash": selected_artifact["contentHash"],
            "bundleHash": selected_artifact["bundleHash"],
            "calibratorType": selected_report["calibratorType"],
            "threshold": selected_artifact["threshold"],
        },
        "holdoutUsedForCandidateSelection": False,
        "finalHoldoutEvaluation": final_holdout_evaluation,
        "productRuntimeChanged": False,
        "finalPromotionHoldoutRequiredAfterSelection": True,
        "runtimePromotionEligible": False,
        "runtimePromotionBlockers": [
            "new_untouched_holdout_required_after_single_request_artifact_change",
            *(
                []
                if promotion_safety_gate["passed"]
                else ["holdout_per_category_complex_to_simple_regression"]
            ),
            "runtime_packaging_latency_failure_isolation_not_evaluated",
            "active_runtime_contract_not_approved",
        ],
    }
    return semantic_heads_artifact, artifacts, comparison_report
