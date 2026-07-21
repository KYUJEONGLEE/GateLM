"""CLI for the fixed LightGBM E1-E4 input representation experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Sequence

import numpy as np

from .lightgbm_e5_base_encoder import E5BaseEncoderRuntime, load_lock
from .lightgbm_input_ablation import (
    HEAD_LABEL_FIELDS,
    prepare_inputs,
    run_experiment,
    sha256_file,
)
from .semantic_heads_cli import load_training_input


TOOL_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = TOOL_ROOT.parents[1]
DEFAULT_DATASET = REPOSITORY_ROOT / (
    "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl"
)
DEFAULT_MANIFEST = REPOSITORY_ROOT / (
    "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json"
)
DEFAULT_BASE_ARTIFACT_ROOT = REPOSITORY_ROOT / ".tmp/difficulty-lightgbm-e5-base-artifacts"
DEFAULT_BASE_LOCK = TOOL_ROOT / (
    "artifacts/lightgbm-four-way-owner-approved-500/e5-base-runtime-lock.v1.json"
)
DEFAULT_OUTPUT = TOOL_ROOT / "artifacts/lightgbm-input-ablation-owner-approved-500"
DEFAULT_DESIGN = REPOSITORY_ROOT / (
    "docs/testing/routing/difficulty/lightgbm-input-ablation-experiment-design.md"
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--dataset-manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--base-artifact-root", type=Path, default=DEFAULT_BASE_ARTIFACT_ROOT)
    parser.add_argument("--base-lock", type=Path, default=DEFAULT_BASE_LOCK)
    parser.add_argument("--output-directory", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--design", type=Path, default=DEFAULT_DESIGN)
    parser.add_argument("--go", default="go")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    manifest = json.loads(args.dataset_manifest.read_text(encoding="utf-8"))
    if manifest.get("trainingEligible") is not True or manifest.get("labelCoverageStatus") != "complete":
        raise ValueError("input ablation requires the approved training-eligible dataset")
    exported = load_training_input(args.dataset, args.dataset_manifest, args.go)
    samples = exported.get("samples")
    if not isinstance(samples, list) or len(samples) != 500:
        raise ValueError("semantic exporter must return the approved 500 aligned records")

    base_lock = load_lock(args.base_lock, artifact_root=args.base_artifact_root)
    runtime = E5BaseEncoderRuntime(artifact_root=args.base_artifact_root, lock=base_lock)
    rows: list[np.ndarray] = []
    for index, sample in enumerate(samples, start=1):
        rows.append(runtime.encode_one(str(sample["instructionText"])))
        if index % 50 == 0 or index == len(samples):
            print(f"E5-base encoded {index}/{len(samples)} records")
    embeddings = np.ascontiguousarray(np.stack(rows), dtype=np.float32)

    encoder_provenance = {
        "modelId": base_lock["encoder"]["modelId"],
        "sourceRevision": base_lock["encoder"]["sourceRevision"],
        "inputPrefix": base_lock["encoder"]["inputPrefix"],
        "maximumTokenLength": base_lock["encoder"]["maximumTokenLength"],
        "pooling": base_lock["encoder"]["pooling"],
        "outputDtype": "float32",
        "outputDimension": base_lock["encoder"]["outputDimension"],
        "qInt8Sha256": next(
            entry["sha256"]
            for entry in base_lock["encoder"]["runtimeArtifacts"]
            if entry["role"] == "encoder_onnx_dynamic_qint8"
        ),
        "runtimeLockSha256": sha256_file(args.base_lock),
    }
    targets = {
        head: [str(sample[field]) for sample in samples]
        for head, field in HEAD_LABEL_FIELDS.items()
    }
    metadata = [
        {
            "language": str(sample["language"]),
            "evaluationSlices": list(sample["evaluationSlices"]),
        }
        for sample in samples
    ]
    prepared = prepare_inputs(
        rule_vectors=[sample["ruleVectorV1"] for sample in samples],
        e5_base_embeddings=embeddings,
        labels=[int(sample["label"]) for sample in samples],
        splits=[str(sample["split"]) for sample in samples],
        family_ids=[str(sample["familyId"]) for sample in samples],
        semantic_targets=targets,
        metadata=metadata,
        encoder_provenance=encoder_provenance,
    )
    report = run_experiment(
        prepared=prepared,
        labels=[int(sample["label"]) for sample in samples],
        splits=[str(sample["split"]) for sample in samples],
        family_ids=[str(sample["familyId"]) for sample in samples],
        categories=[str(sample["expectedCategory"]) for sample in samples],
        evaluation_slices=[list(sample["evaluationSlices"]) for sample in samples],
        output_directory=args.output_directory,
        dataset_provenance={
            "datasetVersion": manifest["datasetVersion"],
            "datasetPath": manifest["datasetPath"],
            "datasetSha256": manifest["datasetSha256"],
            "manifestSha256": exported["manifestSha256"],
            "splitPolicyVersion": manifest["splitPolicyVersion"],
            "trainingEligible": True,
            "humanReviewedFamilies": manifest["counts"]["humanReviewedFamilies"],
        },
        encoder_provenance=encoder_provenance,
        design_provenance={
            "relativePath": args.design.relative_to(REPOSITORY_ROOT).as_posix(),
            "sha256": hashlib.sha256(args.design.read_bytes()).hexdigest(),
        },
    )
    print(f"wrote aggregate input ablation evidence to {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
