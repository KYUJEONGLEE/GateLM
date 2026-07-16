from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Sequence

from .encoder_runtime import (
    ARTIFACT_DIRECTORY,
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_MANIFEST_PATH,
    DEFAULT_PCA_PATH,
    MODEL_ID,
    PINNED_SOURCE_HASHES,
    QINT8_MODEL_PATH,
    QINT8_ONNX_SHA256,
    SOURCE_ONNX_PATH,
    SOURCE_REVISION,
    E5EncoderRuntime,
    build_manifest,
    encode_pooled_single_requests,
    fit_pca,
    install_network_guard,
    load_runtime,
    read_json,
    sha256_file,
    validate_manifest,
    write_json,
)
from .semantic_heads_cli import load_training_input


TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
DEFAULT_DATASET = (
    REPO_ROOT / "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl"
)
DEFAULT_DATASET_MANIFEST = (
    REPO_ROOT
    / "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json"
)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare and verify the canonical offline E5 encoder.")
    parser.add_argument("--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST_PATH)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("prepare")
    fit = subcommands.add_parser("fit-pca")
    fit.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    fit.add_argument("--dataset-manifest", type=Path, default=DEFAULT_DATASET_MANIFEST)
    fit.add_argument("--pca-output", type=Path, default=DEFAULT_PCA_PATH)
    fit.add_argument("--batch-size", type=int, choices=[1], default=1)
    fit.add_argument("--go", default="go")
    subcommands.add_parser("verify")
    return parser.parse_args(argv)


def prepare(artifact_root: Path) -> Path:
    from huggingface_hub import hf_hub_download
    from onnxruntime.quantization import QuantType, quantize_dynamic

    directory = artifact_root / ARTIFACT_DIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    for relative_path, expected_hash in PINNED_SOURCE_HASHES.items():
        target = directory / relative_path
        if not target.is_file() or sha256_file(target) != expected_hash:
            # huggingface_hub writes download state below local_dir/.cache.
            # Create the nested parent here because Windows does not create it
            # reliably for artifact paths such as onnx/model.onnx.
            (directory / ".cache" / "huggingface" / "download" / relative_path).parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            target = Path(
                hf_hub_download(
                    repo_id=MODEL_ID,
                    filename=relative_path,
                    revision=SOURCE_REVISION,
                    local_dir=directory,
                    local_dir_use_symlinks=False,
                )
            )
        if sha256_file(target) != expected_hash:
            raise ValueError(f"downloaded E5 artifact hash mismatch: {relative_path}")
    qint8 = directory / QINT8_MODEL_PATH
    if not qint8.is_file() or sha256_file(qint8) != QINT8_ONNX_SHA256:
        qint8.parent.mkdir(parents=True, exist_ok=True)
        quantize_dynamic(
            model_input=str(directory / SOURCE_ONNX_PATH),
            model_output=str(qint8),
            op_types_to_quantize=["MatMul"],
            per_channel=False,
            reduce_range=False,
            weight_type=QuantType.QInt8,
        )
    if sha256_file(qint8) != QINT8_ONNX_SHA256:
        raise ValueError("generated QInt8 E5 artifact does not match the pinned hash")
    return directory


def _encode_pooled_batches(
    runtime: E5EncoderRuntime,
    instruction_texts: Sequence[str],
    batch_size: int,
) -> Any:
    if batch_size != 1:
        raise ValueError("PCA fit requires runtime-equivalent single-request batch size 1")
    return encode_pooled_single_requests(runtime, instruction_texts)


def fit_and_write(args: argparse.Namespace) -> dict[str, Any]:
    dataset_manifest = read_json(args.dataset_manifest)
    exported = load_training_input(args.dataset, args.dataset_manifest, args.go)
    train_samples = [sample for sample in exported["samples"] if sample["split"] == "train"]
    if len(train_samples) != 300:
        raise ValueError("PCA fit requires exactly 300 eligible train samples")
    if len({sample["familyId"] for sample in train_samples}) != int(
        dataset_manifest["splitCounts"]["train"]["families"]
    ):
        raise ValueError("PCA train family count does not match the dataset manifest")

    directory = args.artifact_root / ARTIFACT_DIRECTORY
    qint8 = directory / QINT8_MODEL_PATH
    if not qint8.is_file() or sha256_file(qint8) != QINT8_ONNX_SHA256:
        raise ValueError("pinned QInt8 E5 artifact is missing; run prepare explicitly")
    install_network_guard()
    runtime = E5EncoderRuntime(directory, qint8, projection=None)
    pooled = _encode_pooled_batches(
        runtime,
        [sample["instructionText"] for sample in train_samples],
        args.batch_size,
    )
    projection = fit_pca(pooled)
    projection.save(args.pca_output)
    manifest = build_manifest(
        artifact_root=args.artifact_root,
        pca_path=args.pca_output,
        projection=projection,
        dataset_manifest=dataset_manifest,
    )
    write_json(args.manifest, manifest)
    validate_manifest(manifest, artifact_root=args.artifact_root, verify_files=True)
    return manifest


def verify(args: argparse.Namespace) -> None:
    runtime, manifest = load_runtime(manifest_path=args.manifest, artifact_root=args.artifact_root)
    instructions = [
        "회의록의 결정 사항과 후속 작업을 요약해줘",
        "Summarize the decision and list the next steps.",
        "한국어와 English 요구사항을 비교해서 설명해줘",
    ]
    pooled = encode_pooled_single_requests(runtime, instructions)
    if runtime.projection is None:
        raise ValueError("canonical E5 verification requires PCA projection")
    values = runtime.projection.transform(pooled)
    if values.shape != (3, 64) or str(values.dtype) != "float32":
        raise ValueError("canonical E5 integration output must be stacked single-request float32[n,64]")
    validate_manifest(manifest, artifact_root=args.artifact_root, verify_files=True)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "prepare":
        directory = prepare(args.artifact_root)
        print(f"prepared pinned E5 artifacts at {directory}")
        return 0
    if args.command == "fit-pca":
        manifest = fit_and_write(args)
        print(f"wrote PCA artifact and manifest bundle {manifest['bundleSha256']}")
        return 0
    verify(args)
    print("canonical offline E5 encoder verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
