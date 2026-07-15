"""Import and verify the pinned Tenant Chat PII ONNX model bundle.

Only model runtime artifacts declared by the bundle manifest are extracted.
Bundled source snapshots, reports, bytecode, and any other files are ignored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import zipfile
from pathlib import Path, PurePosixPath
from typing import BinaryIO


MANIFEST_SUFFIX = "docs/pii-model-manifest-20260715.json"
COPY_CHUNK_BYTES = 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(COPY_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_archive_name(name: str) -> str:
    normalized = name.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe bundle member path: {name!r}")
    return str(path)


def archive_index(bundle: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    indexed: dict[str, zipfile.ZipInfo] = {}
    for info in bundle.infolist():
        name = normalized_archive_name(info.filename)
        if name in indexed:
            raise ValueError(f"duplicate normalized bundle member: {name}")
        indexed[name] = info
    return indexed


def load_manifest(
    bundle: zipfile.ZipFile,
    indexed: dict[str, zipfile.ZipInfo],
) -> tuple[str, dict[str, object]]:
    candidates = [name for name in indexed if name.endswith(MANIFEST_SUFFIX)]
    if len(candidates) != 1:
        raise ValueError(f"expected one PII model manifest, found {len(candidates)}")
    manifest_name = candidates[0]
    manifest = json.loads(bundle.read(indexed[manifest_name]).decode("utf-8"))
    if manifest.get("manifestVersion") != "tenant-chat-pii-models.v1":
        raise ValueError("unsupported PII model manifest version")
    return manifest_name[: -len(MANIFEST_SUFFIX)], manifest


def runtime_directory(value: object) -> PurePosixPath:
    path = PurePosixPath(str(value).replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe runtime directory: {value!r}")
    if len(path.parts) != 2 or path.parts[0] != "models":
        raise ValueError(f"unexpected runtime directory: {value!r}")
    return PurePosixPath(path.parts[1])


def model_file_path(value: object) -> PurePosixPath:
    path = PurePosixPath(str(value).replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError(f"unsafe model file path: {value!r}")
    return path


def copy_and_hash(source: BinaryIO, destination: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    written = 0
    with destination.open("wb") as output:
        for chunk in iter(lambda: source.read(COPY_CHUNK_BYTES), b""):
            output.write(chunk)
            digest.update(chunk)
            written += len(chunk)
    return written, digest.hexdigest()


def extract_verified(
    bundle: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    destination: Path,
    *,
    expected_bytes: int,
    expected_sha256: str,
) -> str:
    if destination.is_file() and destination.stat().st_size == expected_bytes:
        if sha256(destination) == expected_sha256:
            return "verified"

    destination.parent.mkdir(parents=True, exist_ok=True)
    partial = destination.with_name(f".{destination.name}.part")
    try:
        with bundle.open(info, "r") as source:
            actual_bytes, actual_sha256 = copy_and_hash(source, partial)
        if actual_bytes != expected_bytes:
            raise ValueError(
                f"size mismatch for {destination.name}: "
                f"expected {expected_bytes}, got {actual_bytes}"
            )
        if actual_sha256 != expected_sha256:
            raise ValueError(f"SHA-256 mismatch for {destination.name}")
        os.replace(partial, destination)
    finally:
        partial.unlink(missing_ok=True)
    return "imported"


def import_models(bundle_path: Path, runtime_root: Path) -> None:
    with zipfile.ZipFile(bundle_path) as bundle:
        indexed = archive_index(bundle)
        prefix, manifest = load_manifest(bundle, indexed)
        models = manifest.get("models")
        if not isinstance(models, list) or not models:
            raise ValueError("manifest models must be a non-empty array")

        imported = 0
        verified = 0
        for model in models:
            if not isinstance(model, dict):
                raise ValueError("manifest model entry must be an object")
            source_directory = PurePosixPath(str(model["runtimeDirectory"]))
            target_directory = runtime_root / runtime_directory(model["runtimeDirectory"])
            files = model.get("files")
            if not isinstance(files, list) or not files:
                raise ValueError("manifest model files must be a non-empty array")
            for item in files:
                if not isinstance(item, dict):
                    raise ValueError("manifest model file entry must be an object")
                relative = model_file_path(item["path"])
                member_name = str(PurePosixPath(prefix) / source_directory / relative)
                info = indexed.get(member_name)
                if info is None:
                    raise FileNotFoundError(f"bundle model member is missing: {member_name}")
                expected_bytes = int(item["bytes"])
                expected_sha256 = str(item["sha256"]).lower()
                if info.file_size != expected_bytes:
                    raise ValueError(f"manifest/archive size mismatch: {member_name}")
                status = extract_verified(
                    bundle,
                    info,
                    target_directory.joinpath(*relative.parts),
                    expected_bytes=expected_bytes,
                    expected_sha256=expected_sha256,
                )
                imported += status == "imported"
                verified += status == "verified"

    print(
        "PII model artifacts ready: "
        f"imported={imported} already_verified={verified} runtime_root={runtime_root}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import only manifest-pinned ONNX models from the Tenant Chat PII bundle."
    )
    parser.add_argument("bundle", type=Path, help="Path to tenant-chat-pii-model-bundle-*.zip")
    parser.add_argument(
        "--runtime-root",
        type=Path,
        default=Path("apps/ai-service/.cache/onnx"),
    )
    args = parser.parse_args()
    import_models(args.bundle.resolve(), args.runtime_root.resolve())


if __name__ == "__main__":
    main()
