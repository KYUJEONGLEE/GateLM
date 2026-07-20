"""Freeze the 42D Logistic+Isotonic baseline used by semantic experiments.

The B1 inference artifact consumes only the canonical 42D rule vector.  The
six-dimensional projection and C=10 semantic-head setting are frozen in the
experiment baseline manifest, because neither belongs in a 42D inference
hash.  Raw prompts, vectors, logits, probabilities, and per-record scores stay
in process-local memory.
"""

from __future__ import annotations

import argparse
import subprocess
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .candidate_training import _classification_summary
from .encoder_runtime import canonical_hash, sha256_file
from .model_path_5000 import (
    DEFAULT_DATASET,
    DEFAULT_MANIFEST,
    DEFAULT_ROLES,
    REPO_ROOT,
    build_exporter,
    calibration_metrics,
    classification_metrics,
    export_phase,
    oof_calibrated_probabilities,
    read_json,
    role_index,
    validate_selection_export,
    write_json,
)
from .semantic_features import (
    RULE_VECTOR_V1_DIMENSION,
    RULE_VECTOR_V1_FEATURE_NAMES,
    RULE_VECTOR_V1_VERSION,
    OfflineFeatureCandidate,
)
from .training import (
    ARTIFACT_SCHEMA_VERSION,
    CONTENT_HASH_ALGORITHM,
    _fit_calibrator,
    _fit_logistic,
    artifact_content_hash,
)


TOOL_ROOT = REPO_ROOT / "scripts/routing_difficulty_model"
DEFAULT_POLICY = TOOL_ROOT / "training-policy.semantic-b1.v1.json"
DEFAULT_ARTIFACT_OUTPUT = (
    TOOL_ROOT / "artifacts/difficulty-logistic.semantic-b1.model-path-5000.v1.json"
)
DEFAULT_REPORT_ROOT = REPO_ROOT / "reports/routing-difficulty-model"
ARTIFACT_VERSION = "difficulty-logistic.semantic-b1.model-path-5000.2026-07-19.v1"
RUN_SCHEMA_VERSION = "gatelm.difficulty-semantic-b1-run.v1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_fixed_policy(policy: Mapping[str, Any]) -> None:
    expected = {
        "candidate": OfflineFeatureCandidate.RULE_VECTOR_V1.value,
        "projection": 6,
        "headC": 10.0,
        "logisticC": [10.0],
        "calibrator": "isotonic",
        "threshold": 0.5,
    }
    actual = {
        "candidate": policy.get("baselineCandidate"),
        "projection": policy.get("projection", {}).get("outputDimension"),
        "headC": policy.get("semanticHeads", {}).get("c"),
        "logisticC": policy.get("regularization", {}).get("cCandidates"),
        "calibrator": policy.get("calibration", {}).get("fixedCalibrator"),
        "threshold": policy.get("threshold", {}).get("value"),
    }
    if actual != expected:
        raise ValueError(f"semantic B1 policy drifted: {actual!r}")
    if policy.get("modelVersion") != "difficulty-logistic-v1":
        raise ValueError("semantic B1 must use difficulty-logistic-v1")
    projection = policy["projection"]
    if projection != {
        "kind": "pca_full_svd",
        "inputDimension": 384,
        "outputDimension": 6,
        "fitSplit": "train",
        "whiten": False,
        "l2Position": "after_projection",
        "l2Epsilon": 1e-12,
        "randomSeed": 20260719,
    }:
        raise ValueError("semantic B1 projection policy drifted")
    if policy.get("calibration", {}).get("policyVersion") != "difficulty-calibration-v1":
        raise ValueError("semantic B1 must retain the active calibration family")


def build_artifact(
    *,
    policy: Mapping[str, Any],
    role_manifest: Mapping[str, Any],
    model: Any,
    calibrator_material: Mapping[str, Any],
) -> dict[str, Any]:
    artifact: dict[str, Any] = {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "artifactVersion": ARTIFACT_VERSION,
        "modelVersion": str(policy["modelVersion"]),
        "featureVersion": RULE_VECTOR_V1_VERSION,
        "trainingDatasetVersion": str(role_manifest["datasetVersion"]),
        "trainingDatasetSha256": str(role_manifest["datasetSha256"]),
        "splitPolicyVersion": str(role_manifest["rolePolicyVersion"]),
        "regularization": {
            "policyVersion": str(policy["policyVersion"]),
            "penalty": "l2",
            "solver": "liblinear",
            "selectedC": 10.0,
            "groupFolds": int(policy["regularization"]["groupFolds"]),
            "randomSeed": int(policy["regularization"]["randomSeed"]),
        },
        "bias": float(model.intercept_[0]),
        "featureNames": list(RULE_VECTOR_V1_FEATURE_NAMES),
        "weights": [float(value) for value in model.coef_[0]],
        "calibrationVersion": str(policy["calibration"]["policyVersion"]),
        "calibrator": dict(calibrator_material),
        "thresholdPolicyVersion": str(policy["threshold"]["policyVersion"]),
        "threshold": float(policy["threshold"]["value"]),
        "contentHashAlgorithm": CONTENT_HASH_ALGORITHM,
    }
    if len(artifact["weights"]) != RULE_VECTOR_V1_DIMENSION:
        raise ValueError("semantic B1 artifact must consume exactly 42 features")
    if artifact["calibrator"].get("type") != "isotonic":
        raise ValueError("semantic B1 artifact must use isotonic calibration")
    artifact["contentHash"] = artifact_content_hash(artifact)
    return artifact


def safe_git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unavailable"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--roles", type=Path, default=DEFAULT_ROLES)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--artifact-output", type=Path, default=DEFAULT_ARTIFACT_OUTPUT)
    parser.add_argument("--report-root", type=Path, default=DEFAULT_REPORT_ROOT)
    parser.add_argument("--run-id", default="20260719-semantic-b1")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    import numpy as np

    args = parse_args(argv)
    policy = read_json(args.policy)
    validate_fixed_policy(policy)
    role_manifest = read_json(args.roles)
    if role_manifest.get("datasetSha256") != sha256_file(args.dataset):
        raise ValueError("dataset hash does not match the role manifest")
    if policy.get("splitPolicyVersion") != role_manifest.get("rolePolicyVersion"):
        raise ValueError("semantic B1 policy does not match the frozen role policy")
    roles = role_index(role_manifest)
    exporter = REPO_ROOT / ".tmp/difficulty-semantic-b1/difficulty-export.exe"
    build_exporter(exporter)
    selection_export, export_seconds = export_phase(
        exporter, args.dataset, args.manifest, "selection"
    )
    samples, integrity = validate_selection_export(selection_export, roles)
    train_samples = [sample for sample in samples if sample["split"] == "train"]
    validation_samples = [
        sample for sample in samples if sample["split"] == "calibration"
    ]
    train_x = np.asarray([sample["ruleVectorV1"] for sample in train_samples], dtype=float)
    validation_x = np.asarray(
        [sample["ruleVectorV1"] for sample in validation_samples], dtype=float
    )
    train_y = np.asarray([sample["label"] for sample in train_samples], dtype=int)
    validation_y = np.asarray(
        [sample["label"] for sample in validation_samples], dtype=int
    )
    validation_groups = np.asarray(
        [sample["familyId"] for sample in validation_samples], dtype=object
    )
    if train_x.shape != (3000, 42) or validation_x.shape != (1000, 42):
        raise ValueError("semantic B1 export did not produce the frozen 42D population")

    model = _fit_logistic(train_x, train_y, 10.0, dict(policy["regularization"]))
    raw_validation = model.predict_proba(validation_x)[:, 1]
    apply_calibrator, calibrator_material, calibrator_diagnostics = _fit_calibrator(
        "isotonic", raw_validation, validation_y, dict(policy["calibration"])
    )
    calibrated_validation = apply_calibrator(raw_validation)
    oof_validation, oof_diagnostics = oof_calibrated_probabilities(
        "isotonic",
        raw_validation,
        validation_y,
        validation_groups,
        dict(policy["calibration"]),
    )
    threshold = float(policy["threshold"]["value"])
    validation_metrics = classification_metrics(
        validation_samples, calibrated_validation, threshold
    )
    validation_oof_metrics = classification_metrics(
        validation_samples, oof_validation, threshold
    )
    rule_correct = sum(
        sample["ruleDifficulty"] == sample["expectedDifficulty"]
        for sample in validation_samples
    )
    rule_predictions = [sample["ruleDifficulty"] for sample in validation_samples]
    b1_predictions = [
        "complex" if float(score) >= threshold else "simple"
        for score in calibrated_validation
    ]

    artifact = build_artifact(
        policy=policy,
        role_manifest=role_manifest,
        model=model,
        calibrator_material=calibrator_material,
    )
    write_json(args.artifact_output, artifact)
    experiment_baseline = {
        "artifactContentHash": artifact["contentHash"],
        "projectionDimension": 6,
        "semanticHeadC": 10.0,
        "logisticInputDimension": 42,
        "logisticC": 10.0,
        "calibrator": "isotonic",
        "threshold": 0.5,
    }
    experiment_baseline_hash = "sha256:" + canonical_hash(experiment_baseline)
    run_dir = args.report_root / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    configuration = {
        "baselineCandidate": OfflineFeatureCandidate.RULE_VECTOR_V1.value,
        "logisticInputDimension": 42,
        "projectionDimension": 6,
        "projectionUsedByBaselineInference": False,
        "semanticHeadsUsedByBaselineInference": False,
        "semanticHeadC": 10.0,
        "logisticC": 10.0,
        "calibrator": "isotonic",
        "threshold": threshold,
        "thresholdEquality": "score >= threshold",
    }
    report = {
        "schemaVersion": RUN_SCHEMA_VERSION,
        "status": "baseline_frozen_not_promotion_evidence",
        "runId": args.run_id,
        "completedAt": utc_now(),
        "gitCommit": safe_git_commit(),
        "dataset": {
            "version": role_manifest["datasetVersion"],
            "sha256": role_manifest["datasetSha256"],
            "manifestSha256": sha256_file(args.manifest),
            "roleManifestSha256": sha256_file(args.roles),
            "trainRecords": len(train_samples),
            "trainFamilies": len({sample["familyId"] for sample in train_samples}),
            "validationRecords": len(validation_samples),
            "validationFamilies": len(
                {sample["familyId"] for sample in validation_samples}
            ),
            "holdoutOutcomeAccessed": False,
            "integrity": integrity,
        },
        "configuration": configuration,
        "artifact": {
            "path": str(args.artifact_output.relative_to(REPO_ROOT)).replace("\\", "/"),
            "artifactVersion": artifact["artifactVersion"],
            "contentHash": artifact["contentHash"],
            "experimentBaselineHash": experiment_baseline_hash,
        },
        "training": {
            "exportSeconds": export_seconds,
            "logisticIterations": int(np.asarray(model.n_iter_).max()),
            "isotonicDiagnostics": calibrator_diagnostics,
            "isotonicOofDiagnostics": oof_diagnostics,
        },
        "validation": {
            "ruleBaselineAccuracy": rule_correct / len(validation_samples),
            "ruleBaseline": _classification_summary(validation_samples, rule_predictions),
            "b1FixedThreshold": _classification_summary(validation_samples, b1_predictions),
            "fixedArtifactInSampleCalibration": validation_metrics,
            "isotonicOofDiagnostic": validation_oof_metrics,
            "calibrationOof": calibration_metrics(validation_y, oof_validation),
        },
        "guards": {
            "rawPromptPersisted": False,
            "embeddingPersisted": False,
            "featureVectorPersisted": False,
            "perSampleScorePersisted": False,
            "testOutcomeAccessed": False,
            "runtimePromotionEligible": False,
        },
    }
    write_json(run_dir / "baseline-report.json", report)
    write_json(
        run_dir / "baseline-manifest.json",
        {
            "schemaVersion": "gatelm.difficulty-semantic-b1-baseline-manifest.v1",
            "runId": args.run_id,
            "status": "frozen_for_experiment_baseline",
            "artifactVersion": artifact["artifactVersion"],
            "artifactContentHash": artifact["contentHash"],
            "experimentBaselineHash": experiment_baseline_hash,
            "trainingPolicyVersion": policy["policyVersion"],
            "trainingPolicySha256": sha256_file(args.policy),
            "datasetSha256": role_manifest["datasetSha256"],
            "roleManifestSha256": sha256_file(args.roles),
            "configuration": configuration,
            "holdoutOutcomeAccessed": False,
        },
    )
    print(run_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
