"""Single approved dataset identity for every new routing experiment."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CANONICAL_DATASET_RELATIVE = Path(
    "docs/routing/datasets/difficulty/data/"
    "initial-routing-difficulty-15000.owner-approved.jsonl"
)
CANONICAL_MANIFEST_RELATIVE = Path(
    "docs/routing/datasets/difficulty/data/"
    "initial-routing-difficulty-15000.owner-approved.manifest.json"
)
CANONICAL_DATASET = REPOSITORY_ROOT / CANONICAL_DATASET_RELATIVE
CANONICAL_MANIFEST = REPOSITORY_ROOT / CANONICAL_MANIFEST_RELATIVE
CANONICAL_ENCODER_MANIFEST = (
    REPOSITORY_ROOT
    / "scripts/routing_difficulty_model/artifacts/"
    "difficulty-e5-encoder-owner-approved-15000-manifest.v1.json"
)
CANONICAL_PCA = (
    REPOSITORY_ROOT
    / "scripts/routing_difficulty_model/artifacts/"
    "difficulty-e5-pca-64.owner-approved-15000.v1.npz"
)
CANONICAL_RECORDS = 15_000
CANONICAL_SPLIT_COUNTS = {"train": 10_500, "validation": 2_250, "test": 2_250}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_canonical_dataset(dataset: Path, manifest: Path) -> dict[str, Any]:
    """Reject alternate, legacy, partial, or unapproved routing datasets."""

    if dataset.resolve() != CANONICAL_DATASET.resolve():
        raise ValueError(
            "routing experiments only accept the owner-approved canonical 15,000-record dataset"
        )
    if manifest.resolve() != CANONICAL_MANIFEST.resolve():
        raise ValueError(
            "routing experiments only accept the canonical 15,000-record manifest"
        )
    value = json.loads(CANONICAL_MANIFEST.read_text(encoding="utf-8"))
    if (
        value.get("schema_version")
        != "gatelm.routing-difficulty-dataset-manifest.v1"
        or value.get("dataset_path") != CANONICAL_DATASET_RELATIVE.as_posix()
        or value.get("dataset_sha256") != sha256_file(CANONICAL_DATASET)
        or value.get("counts", {}).get("records") != CANONICAL_RECORDS
        or value.get("scope", {}).get("training_eligible") is not True
        or value.get("scope", {}).get("training_blockers") != []
        or value.get("review", {}).get("human_reviewed") is not True
        or value.get("review", {}).get("production_gold") is not True
        or value.get("review", {}).get("training_eligible") is not True
        or value.get("distributions", {}).get("split") != CANONICAL_SPLIT_COUNTS
    ):
        raise ValueError("canonical routing dataset identity or approval gate is invalid")
    return value


def experiment_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    """Expose canonical manifest fields in the established experiment vocabulary."""

    return {
        "datasetVersion": manifest["dataset_version"],
        "datasetPath": manifest["dataset_path"],
        "datasetSha256": manifest["dataset_sha256"],
        "splitPolicyVersion": "routing-difficulty-group-split.2026-07-21.v1",
        "splitSeed": int(manifest["generation_seed"]),
        "trainingEligible": True,
        "labelCoverageStatus": "complete",
        "humanReviewedRecords": int(manifest["counts"]["human_reviewed_records"]),
        "records": int(manifest["counts"]["records"]),
    }
