from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any, Sequence

from .candidate_training import train_candidate_suite
from .encoder_runtime import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_MANIFEST_PATH,
    REPO_ROOT,
    install_network_guard,
    load_runtime,
    write_json,
)
from .semantic_heads_cli import load_training_input


TOOL_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = (
    REPO_ROOT / "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl"
)
DEFAULT_DATASET_MANIFEST = (
    REPO_ROOT
    / "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json"
)
DEFAULT_POLICY = TOOL_DIR / "training-policy.semantic-candidates.v1.json"
DEFAULT_OUTPUT_DIRECTORY = TOOL_DIR / "artifacts/candidates"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the fixed offline 42D/106D/118D difficulty candidates."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--encoder-manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    parser.add_argument("--output-directory", type=Path, default=DEFAULT_OUTPUT_DIRECTORY)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument(
        "--semantic-heads-artifact-version",
        default="difficulty-semantic-heads.owner-approved-500.2026-07-15.v1",
    )
    parser.add_argument(
        "--artifact-version-prefix",
        default="difficulty-offline.owner-approved-500.2026-07-15",
    )
    parser.add_argument(
        "--bundle-version",
        default="difficulty-feature-bundle.owner-approved-500.2026-07-15.v1",
    )
    parser.add_argument("--go", default=os.environ.get("GATELM_GO_EXECUTABLE", "go"))
    return parser.parse_args(argv)


def _encode_pooled_batches(runtime: Any, instruction_texts: list[str], batch_size: int) -> Any:
    import numpy as np

    if batch_size <= 0:
        raise ValueError("candidate encoder batch size must be positive")
    batches = [
        runtime.encode_pooled(instruction_texts[index : index + batch_size])
        for index in range(0, len(instruction_texts), batch_size)
    ]
    if not batches:
        raise ValueError("candidate encoder input must not be empty")
    return np.concatenate(batches, axis=0)


def projection_parameters(runtime: Any, encoder_manifest: dict[str, Any]) -> dict[str, Any]:
    projection = runtime.projection
    if projection is None:
        raise ValueError("candidate training requires the canonical PCA projection")
    return {
        "kind": "pca_full_svd",
        "inputDimension": int(projection.mean.shape[0]),
        "outputDimension": int(projection.components.shape[0]),
        "dtype": "float32_le",
        "fitSplit": "train",
        "randomSeed": int(encoder_manifest["dataset"]["splitSeed"]),
        "whiten": False,
        "l2Position": "after_projection",
        "l2Epsilon": float(encoder_manifest["normalization"]["epsilon"]),
        "mean": projection.mean.astype("float32", copy=False).tolist(),
        "components": projection.components.astype("float32", copy=False).tolist(),
    }


def run(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if args.batch_size <= 0:
        raise ValueError("candidate encoder batch size must be positive")
    exported_input = load_training_input(args.dataset, args.manifest, args.go)
    policy = json.loads(args.policy.read_text(encoding="utf-8"))

    install_network_guard()
    runtime, encoder_manifest = load_runtime(
        manifest_path=args.encoder_manifest,
        artifact_root=args.artifact_root,
    )
    instruction_texts = [sample["instructionText"] for sample in exported_input["samples"]]
    pooled = _encode_pooled_batches(runtime, instruction_texts, args.batch_size)
    if runtime.projection is None:
        raise ValueError("candidate training requires the canonical PCA projection")
    projected = runtime.projection.transform(pooled)

    semantic_heads, artifacts, report = train_candidate_suite(
        exported_input,
        pooled,
        projected,
        policy=policy,
        encoder_manifest=encoder_manifest,
        projection_parameters=projection_parameters(runtime, encoder_manifest),
        semantic_heads_artifact_version=args.semantic_heads_artifact_version,
        artifact_version_prefix=args.artifact_version_prefix,
        bundle_version=args.bundle_version,
    )

    output_directory = args.output_directory
    output_directory.mkdir(parents=True, exist_ok=True)
    write_json(output_directory / "difficulty-semantic-heads.owner-approved-500.v1.json", semantic_heads)
    candidate_paths = {
        "42d-rule-vector-v1": "difficulty-candidate-a-42d.owner-approved-500.v1.json",
        "42d-rule-vector-v1-plus-projection": "difficulty-candidate-b-106d.owner-approved-500.v1.json",
        "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities": (
            "difficulty-candidate-c-118d.owner-approved-500.v1.json"
        ),
    }
    for candidate_name, artifact in artifacts.items():
        write_json(output_directory / candidate_paths[candidate_name], artifact)
    write_json(output_directory / "difficulty-candidate-comparison.owner-approved-500.v1.json", report)
    return semantic_heads, artifacts, report


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    _, artifacts, report = run(args)
    dimensions = report["candidateDimensions"]
    if sorted(dimensions.values()) != [42, 106, 118] or len(artifacts) != 3:
        raise ValueError("candidate training did not produce the fixed 42D/106D/118D set")
    print(f"wrote three offline difficulty candidates to {args.output_directory}")
    print("split counts: train=300 calibration=100 holdout=100")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
