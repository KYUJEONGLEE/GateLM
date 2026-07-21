from __future__ import annotations

# Frozen evidence replay only. New experiments are locked to canonical_dataset.py.
HISTORICAL_REPLAY_ONLY = True

import argparse
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np

from .encoder_runtime import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_MANIFEST_PATH,
    EXECUTION_SHAPE_POLICY_VERSION,
    REPO_ROOT,
    encode_pooled_single_requests,
    install_network_guard,
    load_runtime,
    write_json,
)
from .gateway_holdout_reference import _model_score


REPORT_SCHEMA = "gatelm.difficulty-promotion-holdout-evidence.v1"
EXPORT_SCHEMA = "gatelm.difficulty-promotion-holdout-input.v1"
DEFAULT_DATASET = (
    REPO_ROOT
    / "docs/v2.1.0/training/"
    "difficulty-training-candidate-expansion-2000.owner-approved.jsonl"
)
DEFAULT_DATASET_MANIFEST = (
    REPO_ROOT
    / "docs/v2.1.0/training/"
    "difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"
)
DEFAULT_FREEZE = (
    REPO_ROOT
    / "docs/v2.1.0/evaluation/difficulty-promotion-holdout-100.v1.json"
)
DEFAULT_ARTIFACT = (
    REPO_ROOT
    / "scripts/routing_difficulty_model/artifacts/candidates/"
    "difficulty-candidate-c-118d.owner-approved-500.v3.json"
)
DEFAULT_OUTPUT = (
    REPO_ROOT
    / "docs/testing/difficulty-promotion-holdout-100-result.json"
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_export(
    *, dataset: Path, manifest: Path, freeze: Path, go_executable: str
) -> dict[str, Any]:
    environment = dict(os.environ)
    environment.update(
        {
            "GOTELEMETRY": "off",
            "GOPROXY": "off",
            "GOSUMDB": "off",
        }
    )
    environment.setdefault("GOCACHE", str(REPO_ROOT / ".cache/go-build"))
    completed = subprocess.run(
        [
            go_executable,
            "run",
            "./apps/gateway-core/cmd/difficulty-promotion-holdout-export",
            "-dataset",
            str(dataset.resolve()),
            "-manifest",
            str(manifest.resolve()),
            "-freeze",
            str(freeze.resolve()),
        ],
        cwd=REPO_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=300,
    )
    if completed.returncode != 0:
        detail = [line.strip() for line in completed.stderr.splitlines() if line.strip()]
        reason = next(
            (line for line in detail if not line.startswith("exit status ")),
            detail[-1] if detail else "exporter failed without a diagnostic",
        )
        raise ValueError(f"promotion holdout exporter rejected the frozen input: {reason}")
    value = json.loads(completed.stdout)
    if value.get("schemaVersion") != EXPORT_SCHEMA:
        raise ValueError("promotion holdout exporter returned an unsupported schema")
    return value


def classification_summary(
    samples: Sequence[Mapping[str, Any]], predictions: Sequence[str]
) -> dict[str, Any]:
    if len(samples) != len(predictions) or not samples:
        raise ValueError("promotion predictions must align with a non-empty holdout")

    def summarize(rows: Sequence[tuple[Mapping[str, Any], str]]) -> dict[str, Any]:
        total = len(rows)
        correct = sum(prediction == sample["expectedDifficulty"] for sample, prediction in rows)
        simple_expected = sum(sample["expectedDifficulty"] == "simple" for sample, _ in rows)
        complex_expected = total - simple_expected
        simple_to_complex = sum(
            sample["expectedDifficulty"] == "simple" and prediction == "complex"
            for sample, prediction in rows
        )
        complex_to_simple = sum(
            sample["expectedDifficulty"] == "complex" and prediction == "simple"
            for sample, prediction in rows
        )
        return {
            "samples": total,
            "correct": correct,
            "accuracy": correct / total,
            "simpleExpectedSamples": simple_expected,
            "simpleToComplexCount": simple_to_complex,
            "simpleToComplexRate": simple_to_complex / simple_expected if simple_expected else 0.0,
            "complexExpectedSamples": complex_expected,
            "complexToSimpleCount": complex_to_simple,
            "complexToSimpleRate": complex_to_simple / complex_expected if complex_expected else 0.0,
        }

    aligned = list(zip(samples, predictions))
    result = summarize(aligned)
    categories = sorted({str(sample["expectedCategory"]) for sample in samples})
    result["byExpectedCategory"] = {
        category: summarize(
            [
                (sample, prediction)
                for sample, prediction in aligned
                if sample["expectedCategory"] == category
            ]
        )
        for category in categories
    }
    return result


def build_gate(
    candidate: Mapping[str, Any], baseline: Mapping[str, Any], frozen: Mapping[str, Any]
) -> dict[str, Any]:
    minimum_accuracy = float(frozen["minimumAccuracy"])
    maximum_complex_to_simple = int(frozen["maximumComplexToSimpleCount"])
    accuracy = {
        "minimum": minimum_accuracy,
        "observed": float(candidate["accuracy"]),
        "passed": float(candidate["accuracy"]) >= minimum_accuracy,
    }
    directional_count = {
        "maximum": maximum_complex_to_simple,
        "observed": int(candidate["complexToSimpleCount"]),
        "passed": int(candidate["complexToSimpleCount"]) <= maximum_complex_to_simple,
    }

    candidate_categories = candidate["byExpectedCategory"]
    baseline_categories = baseline["byExpectedCategory"]
    if set(candidate_categories) != set(baseline_categories):
        raise ValueError("promotion candidate and rule baseline category sets differ")
    by_category: dict[str, Any] = {}
    for category in sorted(candidate_categories):
        candidate_row = candidate_categories[category]
        baseline_row = baseline_categories[category]
        count_passed = int(candidate_row["complexToSimpleCount"]) <= int(
            baseline_row["complexToSimpleCount"]
        )
        rate_passed = float(candidate_row["complexToSimpleRate"]) <= float(
            baseline_row["complexToSimpleRate"]
        )
        by_category[category] = {
            "candidateCount": int(candidate_row["complexToSimpleCount"]),
            "ruleBaselineCount": int(baseline_row["complexToSimpleCount"]),
            "candidateRate": float(candidate_row["complexToSimpleRate"]),
            "ruleBaselineRate": float(baseline_row["complexToSimpleRate"]),
            "passed": count_passed and rate_passed,
        }
    category_gate = {
        "policy": frozen["categoryDirectionalErrorPolicy"],
        "byExpectedCategory": by_category,
        "passed": all(row["passed"] for row in by_category.values()),
    }
    return {
        "minimumAccuracy": accuracy,
        "maximumComplexToSimpleCount": directional_count,
        "categoryNonRegressionVsRule": category_gate,
        "passed": accuracy["passed"]
        and directional_count["passed"]
        and category_gate["passed"],
    }


def validate_frozen_runtime_material(
    exported: Mapping[str, Any], artifact: Mapping[str, Any], runtime_manifest: Mapping[str, Any]
) -> None:
    frozen_artifact = exported.get("artifact")
    if not isinstance(frozen_artifact, Mapping):
        raise ValueError("promotion freeze is missing the artifact identity")
    for field in (
        "artifactVersion",
        "bundleHash",
        "contentHash",
        "thresholdPolicyVersion",
        "threshold",
        "totalDimension",
    ):
        if artifact.get(field) != frozen_artifact.get(field):
            raise ValueError(f"promotion artifact {field} changed after holdout freeze")
    if "bundleVersion" in frozen_artifact and artifact.get("bundleVersion") != frozen_artifact.get(
        "bundleVersion"
    ):
        raise ValueError("promotion artifact bundleVersion changed after holdout freeze")
    threshold = artifact.get("threshold")
    if (
        artifact.get("totalDimension") != 118
        or isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not math.isfinite(float(threshold))
        or not 0.0 <= float(threshold) <= 1.0
        or artifact.get("thresholdPolicyVersion")
        not in {"difficulty-threshold-v1", "difficulty-threshold-v2"}
    ):
        raise ValueError("promotion artifact no longer has an approved frozen 118D threshold policy")
    calibrator = artifact.get("calibrator")
    if not isinstance(calibrator, Mapping) or calibrator.get("type") != "platt":
        raise ValueError("promotion artifact no longer uses the frozen Platt calibrator")
    execution_shape = runtime_manifest.get("executionShape")
    if not isinstance(execution_shape, Mapping) or execution_shape.get("policyVersion") != EXECUTION_SHAPE_POLICY_VERSION:
        raise ValueError("promotion runtime execution-shape policy drifted")
    if execution_shape.get("batchSize") != 1 or execution_shape.get("paddingScope") != "within_request_only":
        raise ValueError("promotion runtime must use single-request padding shape")
    dataset_identity = runtime_manifest.get("dataset")
    if not isinstance(dataset_identity, Mapping):
        raise ValueError("promotion runtime lacks PCA training provenance")
    if (
        artifact.get("trainingDatasetVersion") != dataset_identity.get("version")
        or artifact.get("trainingDatasetSha256") != dataset_identity.get("sha256")
        or artifact.get("splitPolicyVersion") != dataset_identity.get("splitPolicyVersion")
    ):
        raise ValueError("promotion artifact and frozen PCA training provenance differ")


def evaluate(
    *,
    dataset: Path,
    manifest: Path,
    freeze: Path,
    artifact_path: Path,
    artifact_root: Path,
    encoder_manifest: Path,
    go_executable: str,
) -> dict[str, Any]:
    exported = _load_export(
        dataset=dataset, manifest=manifest, freeze=freeze, go_executable=go_executable
    )
    if (
        exported.get("holdoutRecords") != 100
        or exported.get("holdoutFamilies") != 10
        or len(exported.get("samples", [])) != 100
    ):
        raise ValueError("promotion export does not contain the frozen 100-record holdout")

    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    install_network_guard()
    runtime, runtime_manifest = load_runtime(
        manifest_path=encoder_manifest, artifact_root=artifact_root
    )
    if runtime.projection is None:
        raise ValueError("promotion runtime is missing the frozen PCA projection")
    frozen_file_hash = exported.get("artifact", {}).get("artifactFileSha256")
    if frozen_file_hash and frozen_file_hash != _sha256(artifact_path):
        raise ValueError("promotion artifact file identity changed after holdout freeze")
    validate_frozen_runtime_material(exported, artifact, runtime_manifest)

    samples = exported["samples"]
    model_samples = [sample for sample in samples if sample["modelPath"]]
    pooled = encode_pooled_single_requests(
        runtime, [str(sample["instructionText"]) for sample in model_samples]
    )
    if pooled.shape != (len(model_samples), 384) or not np.all(np.isfinite(pooled)):
        raise ValueError("promotion single-request pooled embeddings are invalid")
    projected = runtime.projection.transform(pooled)
    if projected.shape != (len(model_samples), 64) or not np.all(np.isfinite(projected)):
        raise ValueError("promotion PCA output is invalid")

    candidate_predictions: list[str] = []
    projection_cursor = 0
    for sample in samples:
        if sample["modelPath"]:
            score = _model_score(
                artifact,
                sample["ruleVectorV1"],
                projected[projection_cursor],
            )
            projection_cursor += 1
            candidate_predictions.append(
                "complex" if score >= float(artifact["threshold"]) else "simple"
            )
        else:
            sentinel = str(sample.get("sentinelDifficulty", ""))
            if sentinel not in {"simple", "complex"}:
                raise ValueError("promotion sentinel sample lacks a valid frozen difficulty")
            candidate_predictions.append(sentinel)
    if projection_cursor != len(model_samples):
        raise ValueError("promotion model-path projection alignment drifted")

    rule_predictions = [str(sample["ruleDifficulty"]) for sample in samples]
    candidate = classification_summary(samples, candidate_predictions)
    baseline = classification_summary(samples, rule_predictions)
    gate = build_gate(candidate, baseline, exported["gatesFrozenBeforeEvaluation"])
    status = (
        "promotion_holdout_gate_passed_artifact_unchanged"
        if gate["passed"]
        else "promotion_holdout_gate_failed_artifact_unchanged"
    )
    return {
        "schemaVersion": REPORT_SCHEMA,
        "status": status,
        "evaluatedOn": "2026-07-15",
        "scoreAccessPolicy": "first_promotion_gate_access_after_score_independent_freeze",
        "source": {
            "datasetVersion": exported["datasetVersion"],
            "datasetSha256": exported["datasetSha256"],
            "manifestSha256": exported["manifestSha256"],
            "freezeSha256": exported["freezeSha256"],
            "selectionPolicyVersion": exported["selectionPolicyVersion"],
            "membershipHash": exported["membershipHash"],
        },
        "holdout": {
            "records": exported["holdoutRecords"],
            "families": exported["holdoutFamilies"],
            "modelPathRecords": exported["modelPathRecords"],
            "emptyInstructionRecords": exported["emptyInstructionRecords"],
            "recordsPerExpectedCategory": 20,
            "simplePerExpectedCategory": 10,
            "complexPerExpectedCategory": 10,
            "previouslyObservedFamilyOverlap": 0,
        },
        "artifact": {
            **dict(exported["artifact"]),
            "artifactFileSha256": _sha256(artifact_path),
            "changedAfterFreeze": False,
        },
        "executionShape": {
            "policyVersion": EXECUTION_SHAPE_POLICY_VERSION,
            "unit": "single_request",
            "batchSize": 1,
            "paddingScope": "within_request_only",
        },
        "selectedCandidateClassification": candidate,
        "ruleBaselineClassification": baseline,
        "gate": gate,
        "productRuntimeChanged": False,
        "runtimePromotionAutomatic": False,
        "reportMaterial": {
            "aggregateOnly": True,
            "containsRawPrompt": False,
            "containsEmbeddingOrVector": False,
            "containsWeights": False,
            "containsIndividualScores": False,
        },
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate the frozen 118D artifact once on the new promotion holdout."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    parser.add_argument("--freeze", type=Path, default=DEFAULT_FREEZE)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--encoder-manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.output.exists():
        raise ValueError(
            "promotion holdout result already exists; do not re-score or tune on the consumed holdout"
        )
    report = evaluate(
        dataset=args.dataset,
        manifest=args.manifest,
        freeze=args.freeze,
        artifact_path=args.artifact,
        artifact_root=args.artifact_root,
        encoder_manifest=args.encoder_manifest,
        go_executable=args.go,
    )
    write_json(args.output, report)
    print(f"wrote aggregate-only promotion holdout evidence to {args.output}")
    print(f"promotion holdout gate passed: {str(report['gate']['passed']).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
