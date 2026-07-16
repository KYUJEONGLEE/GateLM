from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create and verify the pinned GateLM E5 QInt8 ONNX artifact.",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-size", type=int, required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--output-size", type=int, required=True)
    parser.add_argument("--output-sha256", required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_artifact(path: Path, expected_size: int, expected_sha256: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"artifact is missing or is not a regular file: {path}")
    actual_size = path.stat().st_size
    if actual_size != expected_size:
        raise RuntimeError(
            f"artifact size mismatch for {path}: expected {expected_size}, got {actual_size}",
        )
    actual_sha256 = sha256(path)
    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            f"artifact checksum mismatch for {path}: expected {expected_sha256}, got {actual_sha256}",
        )


def main() -> None:
    args = parse_args()
    assert_artifact(args.source, args.source_size, args.source_sha256)

    if args.output.exists():
        assert_artifact(args.output, args.output_size, args.output_sha256)
        return

    from onnxruntime.quantization import QuantType, quantize_dynamic

    args.output.parent.mkdir(parents=True, exist_ok=True)
    partial_output = args.output.with_name(f"{args.output.name}.partial.{os.getpid()}")
    try:
        quantize_dynamic(
            model_input=str(args.source),
            model_output=str(partial_output),
            op_types_to_quantize=["MatMul"],
            per_channel=False,
            reduce_range=False,
            weight_type=QuantType.QInt8,
        )
        assert_artifact(partial_output, args.output_size, args.output_sha256)
        os.replace(partial_output, args.output)
    finally:
        partial_output.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
