#!/usr/bin/env python3
"""Generate one pinned dynamic-QInt8 ONNX artifact without network access."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Sequence


SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_artifact(path: Path, expected_size: int, expected_sha256: str) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"regular file required: {path}")
    if path.stat().st_size != expected_size:
        raise ValueError(f"file size mismatch: {path}")
    if sha256_file(path) != expected_sha256:
        raise ValueError(f"file checksum mismatch: {path}")


def sha256_argument(value: str) -> str:
    normalized = value.strip().lower()
    if not SHA256_PATTERN.fullmatch(normalized):
        raise argparse.ArgumentTypeError("a lowercase 64-character SHA-256 is required")
    return normalized


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate and verify the pinned GateLM E5 dynamic-QInt8 ONNX artifact."
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-size", type=int, required=True)
    parser.add_argument("--source-sha256", type=sha256_argument, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--output-size", type=int, required=True)
    parser.add_argument("--output-sha256", type=sha256_argument, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    source = args.source.resolve(strict=True)
    output = args.output.resolve(strict=False)

    if source == output:
        raise ValueError("source and output paths must differ")
    assert_artifact(source, args.source_size, args.source_sha256)

    if output.exists() or output.is_symlink():
        assert_artifact(output, args.output_size, args.output_sha256)
        print(f"verified existing pinned QInt8 artifact: {output}")
        return 0

    output.parent.mkdir(parents=True, exist_ok=True)
    partial_output = output.with_name(f"{output.name}.partial.{os.getpid()}")
    if partial_output.exists() or partial_output.is_symlink():
        raise ValueError(f"refusing to replace existing partial output: {partial_output}")

    from onnxruntime.quantization import QuantType, quantize_dynamic

    try:
        with tempfile.TemporaryDirectory(prefix="gatelm-e5-quantize-") as work_directory:
            working_source = Path(work_directory) / "model.onnx"
            shutil.copyfile(args.source, working_source)
            assert_artifact(working_source, args.source_size, args.source_sha256)
            quantize_dynamic(
                model_input=str(working_source),
                model_output=str(partial_output),
                op_types_to_quantize=["MatMul"],
                per_channel=False,
                reduce_range=False,
                weight_type=QuantType.QInt8,
            )
        assert_artifact(partial_output, args.output_size, args.output_sha256)
        os.replace(partial_output, output)
    finally:
        if partial_output.exists() or partial_output.is_symlink():
            partial_output.unlink()

    print(f"generated verified pinned QInt8 artifact: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
