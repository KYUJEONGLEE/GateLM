from __future__ import annotations

import argparse
import json
import math
import os
import statistics
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from .encoder_runtime import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_MANIFEST_PATH,
    REPO_ROOT,
    install_network_guard,
    load_runtime,
    write_json,
)
from .semantic_heads_cli import load_training_input


REFERENCE_SCHEMA = "gatelm.difficulty-gateway-holdout-reference.v1"
AGGREGATE_SCHEMA = "gatelm.difficulty-gateway-holdout-replay-evidence.v1"
EXPECTED_DATASET_VERSION = "difficulty_training_2026_07_15_owner_approved_500_v2"
EXPECTED_DATASET_SHA256 = "4f4b00a783ef6372a2d23baf77b0c793670a72f03f4636c6674c8e911662189f"
EXPECTED_SPLIT_POLICY_VERSION = "difficulty-family-constrained-split.2026-07-15.v1"
EXPECTED_SPLIT_SEED = 20260715
EXPECTED_ARTIFACT_VERSION = (
    "difficulty-offline.owner-approved-500.2026-07-15."
    "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities.v2"
)
EXPECTED_BUNDLE_HASH = "sha256:4835d722bba348416693eda83bc33ff0328d93bb4e806c762481df94f57ec5ed"
EXPECTED_CONTENT_HASH = "sha256:b41ed845c7b6931c7ad5738c7ef95e3013d5b1708ccd09440a86db5cd158efa0"
EXPECTED_THRESHOLD_POLICY_VERSION = "difficulty-threshold-v1"
EXPECTED_THRESHOLD = 0.45
EXPECTED_HOLDOUT_RECORDS = 100
EXPECTED_HOLDOUT_FAMILIES = 18
EXPECTED_MODEL_PATH_RECORDS = 64
EXPECTED_SELECTED_ACCURACY = 0.91
EXPECTED_SELECTED_CORRECT = 91
EXPECTED_SELECTED_COMPLEX_TO_SIMPLE = 1
EXPECTED_RULE_ACCURACY = 0.86
EXPECTED_RULE_CORRECT = 86
EXPECTED_RULE_COMPLEX_TO_SIMPLE = 10

DEFAULT_DATASET = (
    REPO_ROOT / "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl"
)
DEFAULT_DATASET_MANIFEST = (
    REPO_ROOT
    / "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json"
)
DEFAULT_ARTIFACT = (
    REPO_ROOT
    / "scripts/routing_difficulty_model/artifacts/candidates/"
    "difficulty-candidate-c-118d.owner-approved-500.v2.json"
)


def _stable_sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def _validate_identity(
    exported: Mapping[str, Any], artifact: Mapping[str, Any]
) -> None:
    expected_export = {
        "datasetVersion": EXPECTED_DATASET_VERSION,
        "datasetSha256": EXPECTED_DATASET_SHA256,
        "splitPolicyVersion": EXPECTED_SPLIT_POLICY_VERSION,
        "splitSeed": EXPECTED_SPLIT_SEED,
    }
    for field, expected in expected_export.items():
        if exported.get(field) != expected:
            raise ValueError(f"canonical Gateway holdout {field} identity mismatch")
    split_counts = exported.get("splitCounts")
    if not isinstance(split_counts, Mapping):
        raise ValueError("canonical Gateway holdout split counts are missing")
    holdout = split_counts.get("holdout")
    if not isinstance(holdout, Mapping) or holdout.get("records") != EXPECTED_HOLDOUT_RECORDS:
        raise ValueError("canonical Gateway holdout must contain exactly 100 records")
    if holdout.get("families") != EXPECTED_HOLDOUT_FAMILIES:
        raise ValueError("canonical Gateway holdout must contain exactly 18 families")

    expected_artifact = {
        "artifactVersion": EXPECTED_ARTIFACT_VERSION,
        "bundleHash": EXPECTED_BUNDLE_HASH,
        "contentHash": EXPECTED_CONTENT_HASH,
        "thresholdPolicyVersion": EXPECTED_THRESHOLD_POLICY_VERSION,
        "threshold": EXPECTED_THRESHOLD,
        "candidateName": "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities",
        "totalDimension": 118,
        "trainingDatasetVersion": EXPECTED_DATASET_VERSION,
        "trainingDatasetSha256": EXPECTED_DATASET_SHA256,
        "splitPolicyVersion": EXPECTED_SPLIT_POLICY_VERSION,
    }
    for field, expected in expected_artifact.items():
        if artifact.get(field) != expected:
            raise ValueError(f"canonical Gateway artifact {field} identity mismatch")
    calibrator = artifact.get("calibrator")
    if not isinstance(calibrator, Mapping) or calibrator.get("type") != "platt":
        raise ValueError("canonical Gateway artifact must use the frozen Platt calibrator")


def _head_probabilities(
    artifact: Mapping[str, Any], projection: np.ndarray
) -> list[float]:
    result: list[float] = []
    heads = artifact.get("semanticHeadParameters")
    if not isinstance(heads, list) or len(heads) != 4:
        raise ValueError("canonical Gateway artifact must contain four semantic heads")
    for head in heads:
        coefficient = np.asarray(head["coefficient"], dtype=np.float64)
        intercept = np.asarray(head["intercept"], dtype=np.float64)
        if coefficient.shape != (3, 64) or intercept.shape != (3,):
            raise ValueError("canonical Gateway semantic head shape mismatch")
        logits = projection.astype(np.float64, copy=False) @ coefficient.T + intercept
        logits -= np.max(logits)
        exponentials = np.exp(logits)
        probabilities = exponentials / exponentials.sum()
        if probabilities.shape != (3,) or not np.all(np.isfinite(probabilities)):
            raise ValueError("canonical Gateway semantic head produced invalid probabilities")
        result.extend(float(value) for value in probabilities)
    return result


def _model_score(
    artifact: Mapping[str, Any], rule_vector: Sequence[float], projection: np.ndarray
) -> float:
    heads = _head_probabilities(artifact, projection)
    vector = np.concatenate(
        [
            np.asarray(rule_vector, dtype=np.float64),
            projection.astype(np.float64, copy=False),
            np.asarray(heads, dtype=np.float64),
        ]
    )
    weights = np.asarray(artifact["weights"], dtype=np.float64)
    if vector.shape != (118,) or weights.shape != (118,):
        raise ValueError("canonical Gateway 118D material shape mismatch")
    raw_probability = _stable_sigmoid(float(vector @ weights + float(artifact["bias"])))
    calibrator = artifact["calibrator"]
    score = _stable_sigmoid(
        float(calibrator["coefficient"]) * raw_probability
        + float(calibrator["intercept"])
    )
    if not math.isfinite(score) or score < 0.0 or score > 1.0:
        raise ValueError("canonical Gateway artifact produced an invalid calibrated score")
    return score


def classification_summary(
    samples: Sequence[Mapping[str, Any]], prediction_field: str
) -> dict[str, Any]:
    total = len(samples)
    correct = sum(
        sample[prediction_field] == sample["expectedDifficulty"] for sample in samples
    )
    simple_expected = sum(sample["expectedDifficulty"] == "simple" for sample in samples)
    complex_expected = total - simple_expected
    simple_to_complex = sum(
        sample["expectedDifficulty"] == "simple"
        and sample[prediction_field] == "complex"
        for sample in samples
    )
    complex_to_simple = sum(
        sample["expectedDifficulty"] == "complex"
        and sample[prediction_field] == "simple"
        for sample in samples
    )
    return {
        "samples": total,
        "correct": correct,
        "accuracy": correct / total if total else 0.0,
        "simpleExpectedSamples": simple_expected,
        "simpleToComplexCount": simple_to_complex,
        "complexExpectedSamples": complex_expected,
        "complexToSimpleCount": complex_to_simple,
    }


def build_reference(
    *,
    dataset: Path,
    manifest: Path,
    artifact_path: Path,
    artifact_root: Path,
    encoder_manifest: Path,
    go_executable: str,
) -> dict[str, Any]:
    exported = load_training_input(dataset, manifest, go_executable)
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    _validate_identity(exported, artifact)

    holdout = [sample for sample in exported["samples"] if sample["split"] == "holdout"]
    if len(holdout) != EXPECTED_HOLDOUT_RECORDS:
        raise ValueError("canonical Gateway exporter did not return 100 holdout records")
    if len({sample["familyId"] for sample in holdout}) != EXPECTED_HOLDOUT_FAMILIES:
        raise ValueError("canonical Gateway exporter did not return 18 holdout families")
    if sum(bool(sample["modelPath"]) for sample in holdout) != EXPECTED_MODEL_PATH_RECORDS:
        raise ValueError("canonical Gateway holdout model-path membership drifted")

    install_network_guard()
    runtime, runtime_manifest = load_runtime(
        manifest_path=encoder_manifest,
        artifact_root=artifact_root,
    )
    dataset_identity = runtime_manifest.get("dataset", {})
    if (
        dataset_identity.get("version") != EXPECTED_DATASET_VERSION
        or dataset_identity.get("sha256") != EXPECTED_DATASET_SHA256
        or dataset_identity.get("splitPolicyVersion") != EXPECTED_SPLIT_POLICY_VERSION
        or dataset_identity.get("splitSeed") != EXPECTED_SPLIT_SEED
    ):
        raise ValueError("canonical Gateway encoder/PCA dataset identity mismatch")
    if runtime.projection is None:
        raise ValueError("canonical Gateway runtime is missing the frozen PCA projection")

    all_instruction_texts = [str(sample["instructionText"]) for sample in exported["samples"]]
    offline_batches = [
        runtime.encode_pooled(all_instruction_texts[index : index + 16])
        for index in range(0, len(all_instruction_texts), 16)
    ]
    offline_pooled = np.concatenate(offline_batches, axis=0)
    if offline_pooled.shape != (500, 384) or not np.all(np.isfinite(offline_pooled)):
        raise ValueError("canonical offline batch-16 E5 output shape drifted")
    offline_projected = runtime.projection.transform(offline_pooled)
    exported_index = {
        str(sample["sampleId"]): index for index, sample in enumerate(exported["samples"])
    }

    reference_samples: list[dict[str, Any]] = []
    for sample in holdout:
        rule_difficulty = str(sample["ruleDifficulty"])
        if sample["modelPath"]:
            offline_projection = offline_projected[exported_index[str(sample["sampleId"])]]
            offline_score = _model_score(
                artifact, sample["ruleVectorV1"], offline_projection
            )
            offline_prediction = (
                "complex" if offline_score >= EXPECTED_THRESHOLD else "simple"
            )

            gateway_pooled = runtime.encode_pooled_one(str(sample["instructionText"]))
            gateway_projection = runtime.projection.transform(
                np.asarray([gateway_pooled], dtype=np.float32)
            )[0]
            gateway_score = _model_score(
                artifact, sample["ruleVectorV1"], gateway_projection
            )
            gateway_prediction = (
                "complex" if gateway_score >= EXPECTED_THRESHOLD else "simple"
            )
            path = "model"
        else:
            offline_score = 1.0 if rule_difficulty == "complex" else 0.0
            gateway_score = offline_score
            offline_prediction = rule_difficulty
            gateway_prediction = rule_difficulty
            path = "sentinel"
        reference_samples.append(
            {
                "sampleId": sample["sampleId"],
                "expectedCategory": sample["expectedCategory"],
                "actualCategory": sample["actualCategory"],
                "expectedDifficulty": sample["expectedDifficulty"],
                "ruleDifficulty": rule_difficulty,
                "modelPath": bool(sample["modelPath"]),
                "scorePath": path,
                "pythonOfflineComplexityScore": offline_score,
                "pythonOfflineDifficulty": offline_prediction,
                "pythonGatewayComplexityScore": gateway_score,
                "pythonGatewayDifficulty": gateway_prediction,
            }
        )

    offline_selected = classification_summary(
        reference_samples, "pythonOfflineDifficulty"
    )
    gateway_selected = classification_summary(
        reference_samples, "pythonGatewayDifficulty"
    )
    baseline = classification_summary(reference_samples, "ruleDifficulty")
    if offline_selected != {
        "samples": 100,
        "correct": EXPECTED_SELECTED_CORRECT,
        "accuracy": EXPECTED_SELECTED_ACCURACY,
        "simpleExpectedSamples": 47,
        "simpleToComplexCount": 8,
        "complexExpectedSamples": 53,
        "complexToSimpleCount": EXPECTED_SELECTED_COMPLEX_TO_SIMPLE,
    }:
        raise ValueError("canonical batch-16 Python offline result no longer reproduces 0.91/1")
    if baseline["correct"] != EXPECTED_RULE_CORRECT or baseline["accuracy"] != EXPECTED_RULE_ACCURACY:
        raise ValueError("canonical Gateway rule baseline no longer reproduces accuracy 0.86")
    if baseline["complexToSimpleCount"] != EXPECTED_RULE_COMPLEX_TO_SIMPLE:
        raise ValueError("canonical Gateway rule baseline no longer reproduces complex-to-simple 10")

    return {
        "schemaVersion": REFERENCE_SCHEMA,
        "status": "ephemeral_implementation_parity_reference_not_promotion_evidence",
        "datasetVersion": EXPECTED_DATASET_VERSION,
        "datasetSha256": EXPECTED_DATASET_SHA256,
        "splitPolicyVersion": EXPECTED_SPLIT_POLICY_VERSION,
        "splitSeed": EXPECTED_SPLIT_SEED,
        "holdoutRecords": EXPECTED_HOLDOUT_RECORDS,
        "holdoutFamilies": EXPECTED_HOLDOUT_FAMILIES,
        "modelPathRecords": EXPECTED_MODEL_PATH_RECORDS,
        "artifactVersion": EXPECTED_ARTIFACT_VERSION,
        "bundleHash": EXPECTED_BUNDLE_HASH,
        "contentHash": EXPECTED_CONTENT_HASH,
        "thresholdPolicyVersion": EXPECTED_THRESHOLD_POLICY_VERSION,
        "threshold": EXPECTED_THRESHOLD,
        "scoreTolerance": {"relative": 0.0, "absolute": 1e-5},
        "offlineBatch16Classification": offline_selected,
        "gatewaySingleClassification": gateway_selected,
        "offlineBatchShape": 16,
        "gatewayBatchShape": 1,
        "ruleBaselineClassification": baseline,
        "samples": reference_samples,
    }


def _percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        raise ValueError("aggregate evidence cannot summarize an empty measurement")
    ordered = sorted(float(value) for value in values)
    position = (len(ordered) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] * (1.0 - fraction) + ordered[upper] * fraction


def aggregate_reports(report_paths: Sequence[Path]) -> dict[str, Any]:
    if len(report_paths) != 3:
        raise ValueError("Gateway replay evidence requires exactly three independent process runs")
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in report_paths]
    for report in reports:
        if report.get("schemaVersion") != "gatelm.difficulty-gateway-holdout-replay-run.v1":
            raise ValueError("Gateway replay run schema mismatch")
        parity = report.get("parity", {})
        routing = report.get("routingInvariance", {})
        selected = report.get("selectedClassification", {})
        baseline = report.get("ruleBaselineClassification", {})
        if (
            parity.get("labelMatches") != 100
            or parity.get("labelMismatches") != 0
            or float(parity.get("maxAbsoluteScoreDelta", math.inf)) > 1e-5
            or routing.get("matched") != 100
            or routing.get("mismatched") != 0
            or selected.get("complexToSimpleCount") != EXPECTED_SELECTED_COMPLEX_TO_SIMPLE
            or baseline.get("accuracy") != EXPECTED_RULE_ACCURACY
            or baseline.get("complexToSimpleCount") != EXPECTED_RULE_COMPLEX_TO_SIMPLE
            or int(report.get("busySaturation", {}).get("rejectedBusy", 0)) <= 0
        ):
            raise ValueError("Gateway replay run did not satisfy the frozen parity gates")

    latency_names = sorted(reports[0]["latencyMicros"])
    latency: dict[str, Any] = {}
    for name in latency_names:
        run_p95 = [float(report["latencyMicros"][name]["p95"]) for report in reports]
        run_p99 = [float(report["latencyMicros"][name]["p99"]) for report in reports]
        run_max = [float(report["latencyMicros"][name]["max"]) for report in reports]
        latency[name] = {
            "runP95": run_p95,
            "medianRunP95": statistics.median(run_p95),
            "maxRunP99": max(run_p99),
            "maxObserved": max(run_max),
        }

    memory_names = sorted(reports[0]["memoryBytes"])
    memory: dict[str, Any] = {}
    for name in memory_names:
        run_rss = [int(report["memoryBytes"][name].get("rss", 0)) for report in reports]
        run_cgroup = [
            int(report["memoryBytes"][name].get("cgroupCurrent", 0)) for report in reports
        ]
        memory[name] = {
            "runRss": run_rss,
            "medianRss": int(statistics.median(run_rss)),
            "maxRss": max(run_rss),
            "runCgroupCurrent": run_cgroup,
            "maxCgroupCurrent": max(run_cgroup),
        }

    timeout_statuses = [
        report.get("nativeTimeoutRecovery", {}).get("status", "not_proven")
        for report in reports
    ]
    return {
        "schemaVersion": AGGREGATE_SCHEMA,
        "status": "gateway_implementation_parity_and_runtime_measurement_not_promotion_evidence",
        "runCount": 3,
        "datasetVersion": EXPECTED_DATASET_VERSION,
        "datasetSha256": EXPECTED_DATASET_SHA256,
        "holdoutRecords": EXPECTED_HOLDOUT_RECORDS,
        "holdoutFamilies": EXPECTED_HOLDOUT_FAMILIES,
        "artifactVersion": EXPECTED_ARTIFACT_VERSION,
        "bundleHash": EXPECTED_BUNDLE_HASH,
        "contentHash": EXPECTED_CONTENT_HASH,
        "thresholdPolicyVersion": EXPECTED_THRESHOLD_POLICY_VERSION,
        "threshold": EXPECTED_THRESHOLD,
        "parity": {
            "labelMatches": 100,
            "labelMismatches": 0,
            "maxAbsoluteScoreDeltaAcrossRuns": max(
                float(report["parity"]["maxAbsoluteScoreDelta"]) for report in reports
            ),
            "absoluteTolerance": 1e-5,
            "relativeTolerance": 0.0,
        },
        "routingInvariance": {"matched": 100, "mismatched": 0},
        "selectedClassification": reports[0]["selectedClassification"],
        "offlineBatch16Classification": reports[0]["offlineBatch16Classification"],
        "offlineAggregateReproduced": reports[0]["offlineAggregateReproduced"],
        "ruleBaselineClassification": reports[0]["ruleBaselineClassification"],
        "promotionSafetyGate": {
            "passed": False,
            "reason": "existing_general_category_complex_to_simple_regression",
        },
        "latencyMicros": latency,
        "memoryBytes": memory,
        "nativeTimeoutRecovery": {
            "runStatuses": timeout_statuses,
            "status": "passed" if all(status == "passed" for status in timeout_statuses) else "not_proven",
            "interruptsInFlightONNXRun": "not_proven",
        },
        "failureIsolation": {
            "disabledOrUnsupportedBuild": "passed",
            "bundleMissingOrHashMismatch": "passed",
            "initializationFailureDegradesToRuleOnly": "passed",
            "inferenceErrorSanitized": "passed",
            "invalidEmbeddingSanitized": "passed",
            "boundedBusyQueue": "passed",
            "evaluatorPanicRecovered": "passed",
            "observerPanicIsolated": "passed",
            "closeTimeoutBounded": "passed",
            "nativeTimeoutPostRunRecovery": (
                "passed" if all(status == "passed" for status in timeout_statuses) else "not_proven"
            ),
            "nativeInFlightInterruption": "not_proven",
        },
        "runReports": [path.name for path in report_paths],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build or aggregate ephemeral Gateway holdout parity evidence."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    reference = subparsers.add_parser("reference")
    reference.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    reference.add_argument("--manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    reference.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    reference.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    reference.add_argument("--encoder-manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    reference.add_argument("--output", type=Path, required=True)
    reference.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))

    aggregate = subparsers.add_parser("aggregate")
    aggregate.add_argument("--report", type=Path, action="append", required=True)
    aggregate.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "reference":
        value = build_reference(
            dataset=args.dataset,
            manifest=args.manifest,
            artifact_path=args.artifact,
            artifact_root=args.artifact_root,
            encoder_manifest=args.encoder_manifest,
            go_executable=args.go,
        )
    else:
        value = aggregate_reports(args.report)
    write_json(args.output, value)
    print(f"wrote Gateway holdout {args.command} evidence to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
