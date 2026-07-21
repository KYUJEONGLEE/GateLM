"""CLI for the isolated four-way LightGBM feature comparison."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Sequence

import numpy as np

from .encoder_runtime import encode_pooled_single_requests, load_runtime
from .lightgbm_e5_base_encoder import (
    E5BaseEncoderRuntime,
    load_lock,
    prepare_artifacts,
    sha256_file,
)
from .lightgbm_four_way import (
    SPLIT_ALIASES,
    build_four_way_matrices,
    train_four_way_candidates,
    write_e5_base_runtime_profiles,
)
from .semantic_heads import predict_semantic_head_probabilities
from .semantic_heads_cli import load_training_input


TOOL_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = TOOL_ROOT.parents[1]
DEFAULT_DATASET = REPOSITORY_ROOT / (
    "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl"
)
DEFAULT_DATASET_MANIFEST = REPOSITORY_ROOT / (
    "docs/v2.1.0/training/"
    "difficulty-training-candidate-500.owner-approved.manifest.json"
)
DEFAULT_SMALL_ARTIFACT_ROOT = (
    REPOSITORY_ROOT / ".tmp/difficulty-semantic-encoder-artifacts"
)
DEFAULT_SMALL_MANIFEST = (
    TOOL_ROOT / "artifacts/difficulty-e5-encoder-manifest.v2.json"
)
DEFAULT_SEMANTIC_HEADS = TOOL_ROOT / (
    "artifacts/candidates/difficulty-semantic-heads.owner-approved-500.v2.json"
)
DEFAULT_BASE_ARTIFACT_ROOT = (
    REPOSITORY_ROOT / ".tmp/difficulty-lightgbm-e5-base-artifacts"
)
DEFAULT_OUTPUT = TOOL_ROOT / "artifacts/lightgbm-four-way-owner-approved-500"
DEFAULT_BASE_LOCK = DEFAULT_OUTPUT / "e5-base-runtime-lock.v1.json"


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare or run the isolated four-way LightGBM comparison."
    )
    parser.add_argument("--base-artifact-root", type=Path, default=DEFAULT_BASE_ARTIFACT_ROOT)
    parser.add_argument("--base-lock", type=Path, default=DEFAULT_BASE_LOCK)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("prepare-e5-base")
    train = subcommands.add_parser("train")
    train.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    train.add_argument("--dataset-manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    train.add_argument("--small-artifact-root", type=Path, default=DEFAULT_SMALL_ARTIFACT_ROOT)
    train.add_argument("--small-manifest", type=Path, default=DEFAULT_SMALL_MANIFEST)
    train.add_argument("--semantic-heads", type=Path, default=DEFAULT_SEMANTIC_HEADS)
    train.add_argument("--output-directory", type=Path, default=DEFAULT_OUTPUT)
    train.add_argument("--go", default="go")
    return parser.parse_args(argv)


def run_train(args: argparse.Namespace) -> None:
    dataset_manifest = json.loads(args.dataset_manifest.read_text(encoding="utf-8"))
    if (
        dataset_manifest.get("trainingEligible") is not True
        or dataset_manifest.get("labelCoverageStatus") != "complete"
    ):
        raise ValueError("four-way training requires an approved training-eligible dataset")
    exported = load_training_input(args.dataset, args.dataset_manifest, args.go)
    samples = exported.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ValueError("semantic exporter returned no approved samples")
    instructions = [str(sample["instructionText"]) for sample in samples]
    rules = np.asarray([sample["ruleVectorV1"] for sample in samples], dtype=np.float32)
    labels = [int(sample["label"]) for sample in samples]
    splits = [str(sample["split"]) for sample in samples]
    families = [str(sample["familyId"]) for sample in samples]

    small_runtime, small_manifest = load_runtime(
        manifest_path=args.small_manifest,
        artifact_root=args.small_artifact_root,
    )
    if small_runtime.projection is None:
        raise ValueError("four-way comparison requires the frozen E5-small PCA64")
    small_pooled = encode_pooled_single_requests(small_runtime, instructions)
    small_pca = small_runtime.projection.transform(small_pooled)
    semantic_artifact = json.loads(args.semantic_heads.read_text(encoding="utf-8"))
    semantic_probabilities = predict_semantic_head_probabilities(
        semantic_artifact, small_pca
    )

    base_lock = load_lock(args.base_lock, artifact_root=args.base_artifact_root)
    base_runtime = E5BaseEncoderRuntime(
        artifact_root=args.base_artifact_root,
        lock=base_lock,
    )
    base_rows = []
    for index, instruction in enumerate(instructions, start=1):
        base_rows.append(base_runtime.encode_one(instruction))
        if index % 50 == 0 or index == len(instructions):
            print(f"E5-base encoded {index}/{len(instructions)} records")
    base_embeddings = np.ascontiguousarray(np.stack(base_rows), dtype=np.float32)
    matrices = build_four_way_matrices(
        rule_vectors=rules,
        e5_small_pca_64=small_pca,
        semantic_head_probabilities=semantic_probabilities,
        e5_base_raw_768=base_embeddings,
    )
    dataset_provenance = {
        "datasetVersion": dataset_manifest["datasetVersion"],
        "datasetSha256": dataset_manifest["datasetSha256"],
        "manifestSha256": exported["manifestSha256"],
        "splitPolicyVersion": dataset_manifest["splitPolicyVersion"],
    }
    encoder_provenance = {
        "e5SmallBundleVersion": small_manifest["bundleVersion"],
        "e5SmallBundleSha256": small_manifest["bundleSha256"],
        "semanticHeadsVersion": semantic_artifact["version"],
        "semanticHeadsSha256": semantic_artifact["artifactContentHash"],
        "e5BaseModelId": base_lock["encoder"]["modelId"],
        "e5BaseSourceRevision": base_lock["encoder"]["sourceRevision"],
        "e5BaseQInt8Sha256": next(
            entry["sha256"]
            for entry in base_lock["encoder"]["runtimeArtifacts"]
            if entry["role"] == "encoder_onnx_dynamic_qint8"
        ),
    }
    results = train_four_way_candidates(
        matrices=matrices,
        labels=labels,
        splits=splits,
        family_ids=families,
        output_directory=args.output_directory,
        dataset_provenance=dataset_provenance,
        encoder_provenance=encoder_provenance,
    )
    split_counts = {"train": 0, "validation": 0, "test": 0}
    for split in splits:
        split_counts[SPLIT_ALIASES[split]] += 1
    profiles = write_e5_base_runtime_profiles(
        output_directory=args.output_directory,
        results=results,
        encoder_descriptor=base_lock["encoder"],
        dataset_provenance=dataset_provenance,
        split_counts=split_counts,
    )
    runtime_candidates = {
        result.candidate: result
        for result in results
        if result.candidate in {
            "e5_base_raw_768",
            "rule_42_plus_e5_base_raw_768",
        }
    }
    bundle_entries = []
    for profile in profiles:
        candidate = profile.name.removesuffix(".shadow-profile.v1.json")
        model_path = runtime_candidates[candidate].model_path
        for source in (profile, model_path):
            target = args.base_artifact_root / source.name
            shutil.copy2(source, target)
        bundle_entries.append(
            {
                "candidate": candidate,
                "profile": {
                    "relativePath": profile.name,
                    "sizeBytes": profile.stat().st_size,
                    "sha256": sha256_file(profile),
                },
                "model": {
                    "relativePath": model_path.name,
                    "sizeBytes": model_path.stat().st_size,
                    "sha256": sha256_file(model_path),
                },
            }
        )
    bundle_lock = {
        "schemaVersion": "gatelm.routing-difficulty-lightgbm-runtime-bundles.v1",
        "promotionState": "offline_shadow_only",
        "encoderLock": {
            "relativePath": args.base_lock.name,
            "sizeBytes": args.base_lock.stat().st_size,
            "sha256": sha256_file(args.base_lock),
        },
        "profiles": bundle_entries,
    }
    bundle_lock_path = args.output_directory / "runtime-bundles.v1.json"
    bundle_lock_path.write_text(
        json.dumps(bundle_lock, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    shutil.copy2(bundle_lock_path, args.base_artifact_root / bundle_lock_path.name)
    print(f"wrote four-way artifacts to {args.output_directory}")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "prepare-e5-base":
        prepare_artifacts(
            artifact_root=args.base_artifact_root,
            lock_path=args.base_lock,
        )
        print(f"prepared E5-base artifacts and lock at {args.base_lock}")
        return 0
    run_train(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
