from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Sequence

from .calibration_feasibility import (
    evaluate_threshold_feasibility,
    family_grouped_oof_calibrated_scores,
)
from .candidate_training import assemble_candidate_samples, validate_candidate_training_input
from .encoder_runtime import (
    DEFAULT_ARTIFACT_ROOT,
    REPO_ROOT,
    encode_pooled_single_requests,
    install_network_guard,
    load_runtime,
    write_json,
)
from .semantic_features import OfflineFeatureCandidate, OfflineFeatureShape
from .semantic_heads import predict_semantic_head_probabilities
from .semantic_heads_cli import load_training_input
from .canonical_dataset import (
    CANONICAL_DATASET,
    CANONICAL_ENCODER_MANIFEST,
    CANONICAL_MANIFEST,
)


TOOL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = CANONICAL_DATASET
DEFAULT_DATASET_MANIFEST = CANONICAL_MANIFEST
DEFAULT_POLICY = TOOL_DIR / "training-policy.owner-approved-15000.v1.json"
DEFAULT_ARTIFACT = (
    TOOL_DIR
    / "artifacts/candidates/difficulty-candidate-c-118d.owner-approved-15000.v1.json"
)
DEFAULT_SEMANTIC_HEADS = (
    TOOL_DIR
    / "artifacts/candidates/difficulty-semantic-heads.owner-approved-15000.v1.json"
)
DEFAULT_OUTPUT = REPO_ROOT / "docs/testing/difficulty-15000-calibration-threshold-feasibility.json"
V3_TRAINING_DECISION_BOUNDARY_VERSION = (
    "difficulty-decision-boundary.payload-empty-separate-score-3.2026-07-15.v1"
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate threshold feasibility from family-grouped calibration OOF scores."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--semantic-heads", type=Path, default=DEFAULT_SEMANTIC_HEADS)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--encoder-manifest", type=Path, default=CANONICAL_ENCODER_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--batch-size", type=int, choices=[1], default=1)
    parser.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _validate_frozen_material(
    artifact: dict[str, Any],
    semantic_heads: dict[str, Any],
    policy: dict[str, Any],
    runtime_manifest: dict[str, Any],
    exported_input: dict[str, Any],
) -> None:
    if (
        exported_input.get("decisionBoundaryVersion")
        != V3_TRAINING_DECISION_BOUNDARY_VERSION
    ):
        raise ValueError(
            "calibration feasibility decision boundary differs from the frozen v3 artifact"
        )
    if artifact.get("totalDimension") != 118 or len(artifact.get("weights", ())) != 118:
        raise ValueError("calibration feasibility requires the frozen 118D artifact")
    if artifact.get("candidateName") != OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS:
        raise ValueError("calibration feasibility artifact has the wrong candidate shape")
    if artifact.get("trainingDatasetVersion") != exported_input.get("datasetVersion"):
        raise ValueError("calibration feasibility dataset differs from artifact training provenance")
    if artifact.get("trainingDatasetSha256") != exported_input.get("datasetSha256"):
        raise ValueError("calibration feasibility dataset hash differs from artifact provenance")
    if artifact.get("trainingPolicyVersion") != policy.get("policyVersion"):
        raise ValueError("calibration feasibility policy differs from artifact provenance")
    if artifact.get("calibrator", {}).get("type") not in {"platt", "isotonic"}:
        raise ValueError("calibration feasibility requires a supported frozen calibrator")
    if artifact.get("componentHashes", {}).get("semanticHeads") != (
        "sha256:" + str(semantic_heads.get("artifactContentHash"))
    ):
        raise ValueError("calibration feasibility semantic-head identity drifted")
    if artifact.get("projectionVersion") != runtime_manifest.get("projection", {}).get("version"):
        raise ValueError("calibration feasibility projection identity drifted")
    execution_shape = runtime_manifest.get("executionShape")
    if (
        not isinstance(execution_shape, dict)
        or execution_shape.get("unit") != "single_request"
        or execution_shape.get("batchSize") != 1
        or execution_shape.get("paddingScope") != "within_request_only"
    ):
        raise ValueError("calibration feasibility requires runtime-equivalent single-request shape")


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.batch_size != 1:
        raise ValueError("calibration feasibility requires runtime-equivalent batch size 1")
    exported_input = load_training_input(args.dataset, args.manifest, args.go)
    samples = validate_candidate_training_input(exported_input)
    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    semantic_heads = json.loads(args.semantic_heads.read_text(encoding="utf-8"))

    install_network_guard()
    runtime, runtime_manifest = load_runtime(
        manifest_path=args.encoder_manifest,
        artifact_root=args.artifact_root,
    )
    _validate_frozen_material(
        artifact,
        semantic_heads,
        policy,
        runtime_manifest,
        exported_input,
    )
    instruction_texts = [str(sample["instructionText"]) for sample in samples]
    pooled = encode_pooled_single_requests(runtime, instruction_texts)
    if runtime.projection is None:
        raise ValueError("calibration feasibility requires the frozen PCA projection")
    projected = runtime.projection.transform(pooled)
    semantic_probabilities = predict_semantic_head_probabilities(semantic_heads, projected)
    shape = OfflineFeatureShape(
        projection_dimension=int(artifact["projectionDimension"]),
        projection_version=str(artifact["projectionVersion"]),
        semantic_heads_version=str(artifact["semanticHeadsVersion"]),
    )
    candidates = assemble_candidate_samples(
        samples,
        projected,
        semantic_probabilities,
        shape,
    )[OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS]
    calibration_indices = [
        index for index, sample in enumerate(samples) if sample["split"] == "calibration"
    ]
    calibration_samples = [samples[index] for index in calibration_indices]
    calibration_vectors = [candidates[index]["vector"] for index in calibration_indices]
    oof_scores = family_grouped_oof_calibrated_scores(
        calibration_samples,
        calibration_vectors,
        artifact,
        policy["calibration"],
    )
    report = evaluate_threshold_feasibility(
        calibration_samples,
        oof_scores,
        reference_threshold=float(artifact["threshold"]),
        threshold_step=0.01,
        minimum_accuracy=0.91,
        maximum_complex_to_simple_count=1,
    )
    report.update(
        {
            "evaluatedOn": "2026-07-15",
            "source": {
                "datasetVersion": exported_input["datasetVersion"],
                "datasetSha256": exported_input["datasetSha256"],
                "manifestSha256": exported_input["manifestSha256"],
                "splitPolicyVersion": exported_input["splitPolicyVersion"],
                "calibrationRecords": len(calibration_samples),
                "calibrationFamilies": len(
                    {sample["familyId"] for sample in calibration_samples}
                ),
                "holdoutOutcomeAccessed": False,
            },
            "artifact": {
                "artifactVersion": artifact["artifactVersion"],
                "bundleHash": artifact["bundleHash"],
                "contentHash": artifact["contentHash"],
                "artifactFileSha256": _sha256(args.artifact),
                "calibratorType": artifact["calibrator"]["type"],
                "referenceThresholdPolicyVersion": artifact["thresholdPolicyVersion"],
                "referenceThreshold": artifact["threshold"],
                "totalDimension": artifact["totalDimension"],
            },
            "executionShape": dict(runtime_manifest["executionShape"]),
            "thresholdCandidatePolicy": {
                "policyVersion": "difficulty-threshold-calibration-feasibility.2026-07-15.v1",
                "promotionPolicyVersionIfFeasible": "difficulty-threshold-v2",
                "selectionOrder": [
                    "maximum_accuracy",
                    "minimum_complex_to_simple_count",
                    "minimum_simple_to_complex_count",
                    "closest_to_reference_threshold",
                    "lower_threshold",
                ],
                "runtimePolicyChanged": False,
            },
        }
    )
    write_json(args.output, report)
    return report


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    report = run(args)
    print(
        "calibration threshold feasibility: "
        f"{report['status']} (selected={report['selectedOperatingPoint'] is not None})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
