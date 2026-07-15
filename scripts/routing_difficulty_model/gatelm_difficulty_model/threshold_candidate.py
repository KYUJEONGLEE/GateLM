"""Derive an immutable threshold-only candidate from calibration evidence."""

from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from .training import artifact_content_hash, offline_bundle_hash


EVIDENCE_SCHEMA = "gatelm.difficulty-threshold-candidate-evidence.v1"


def derive_threshold_candidate(
    source_artifact: Mapping[str, Any],
    feasibility_report: Mapping[str, Any],
    *,
    artifact_version: str,
    bundle_version: str,
    threshold_policy_version: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Freeze a new artifact without changing learned model components."""

    source = copy.deepcopy(dict(source_artifact))
    if source.get("bundleHash") != offline_bundle_hash(source):
        raise ValueError("source artifact bundle hash is invalid")
    if source.get("contentHash") != artifact_content_hash(source):
        raise ValueError("source artifact content hash is invalid")
    if source.get("totalDimension") != 118 or len(source.get("weights", ())) != 118:
        raise ValueError("threshold candidate requires the frozen 118D source artifact")
    if feasibility_report.get("status") != "calibration_threshold_feasible":
        raise ValueError("threshold candidate requires feasible calibration evidence")
    if feasibility_report.get("evidenceSplit") != "calibration":
        raise ValueError("threshold candidate evidence must come from calibration")
    selected = feasibility_report.get("selectedOperatingPoint")
    if not isinstance(selected, Mapping) or selected.get("gate", {}).get("passed") is not True:
        raise ValueError("threshold candidate requires a selected passing operating point")
    report_artifact = feasibility_report.get("artifact")
    if not isinstance(report_artifact, Mapping):
        raise ValueError("threshold feasibility report has no source artifact identity")
    identity_pairs = {
        "artifactVersion": source.get("artifactVersion"),
        "bundleHash": source.get("bundleHash"),
        "contentHash": source.get("contentHash"),
        "referenceThresholdPolicyVersion": source.get("thresholdPolicyVersion"),
        "referenceThreshold": source.get("threshold"),
        "totalDimension": source.get("totalDimension"),
    }
    for field, expected in identity_pairs.items():
        if report_artifact.get(field) != expected:
            raise ValueError(f"threshold feasibility source artifact {field} drifted")
    if feasibility_report.get("source", {}).get("holdoutOutcomeAccessed") is not False:
        raise ValueError("threshold candidate evidence must not access holdout outcomes")
    threshold = selected.get("threshold")
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not 0.0 <= float(threshold) <= 1.0
    ):
        raise ValueError("selected threshold must be within [0, 1]")
    if not artifact_version or artifact_version == source.get("artifactVersion"):
        raise ValueError("threshold candidate requires a new artifact version")
    if not bundle_version or bundle_version == source.get("bundleVersion"):
        raise ValueError("threshold candidate requires a new bundle version")
    if threshold_policy_version != "difficulty-threshold-v2":
        raise ValueError("threshold candidate requires difficulty-threshold-v2")

    candidate = copy.deepcopy(source)
    candidate["artifactVersion"] = artifact_version
    candidate["bundleVersion"] = bundle_version
    candidate["thresholdPolicyVersion"] = threshold_policy_version
    candidate["threshold"] = float(threshold)
    candidate["bundleHash"] = offline_bundle_hash(candidate)
    candidate["contentHash"] = artifact_content_hash(candidate)

    evidence = {
        "schemaVersion": EVIDENCE_SCHEMA,
        "status": "threshold_only_v4_candidate_frozen",
        "evaluatedOn": feasibility_report.get("evaluatedOn"),
        "sourceArtifact": {
            "artifactVersion": source["artifactVersion"],
            "bundleHash": source["bundleHash"],
            "contentHash": source["contentHash"],
            "thresholdPolicyVersion": source["thresholdPolicyVersion"],
            "threshold": source["threshold"],
        },
        "calibration": {
            "datasetVersion": feasibility_report.get("source", {}).get("datasetVersion"),
            "records": feasibility_report.get("source", {}).get("calibrationRecords"),
            "families": feasibility_report.get("source", {}).get("calibrationFamilies"),
            "scoreSource": feasibility_report.get("scoreSource"),
            "thresholdGrid": copy.deepcopy(feasibility_report.get("thresholdGrid")),
            "selectedOperatingPoint": copy.deepcopy(selected),
            "holdoutOutcomeAccessed": False,
        },
        "candidateArtifact": {
            "artifactVersion": candidate["artifactVersion"],
            "bundleVersion": candidate["bundleVersion"],
            "bundleHash": candidate["bundleHash"],
            "contentHash": candidate["contentHash"],
            "thresholdPolicyVersion": candidate["thresholdPolicyVersion"],
            "threshold": candidate["threshold"],
            "totalDimension": candidate["totalDimension"],
        },
        "componentIdentity": {
            "weightsUnchanged": True,
            "biasUnchanged": True,
            "calibratorUnchanged": True,
            "projectionUnchanged": True,
            "semanticHeadsUnchanged": True,
            "componentHashes": copy.deepcopy(candidate["componentHashes"]),
        },
        "productRuntimeChanged": False,
        "newUntouchedHoldoutRequired": True,
        "runtimePromotionEligible": False,
        "reportMaterial": {
            "aggregateOnly": True,
            "containsPromptOrResponse": False,
            "containsEmbeddingOrVector": False,
            "containsModelParameters": False,
            "containsIndividualScores": False,
        },
    }
    return candidate, evidence
