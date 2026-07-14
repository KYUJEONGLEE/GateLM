from __future__ import annotations

import hashlib
import importlib.metadata
import json
import re
from pathlib import Path
from typing import Any


TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
DEFAULT_CONFIG = TOOL_DIR / "encoder-candidates.v1.json"
DEFAULT_ARTIFACT_ROOT = REPO_ROOT / ".tmp/difficulty-semantic-encoder-artifacts"
IMMUTABLE_REVISION = re.compile(r"^[0-9a-f]{40}$")
DEPENDENCY_PACKAGES = (
    "huggingface-hub",
    "numpy",
    "onnx",
    "onnxruntime",
    "psutil",
    "safetensors",
    "scikit-learn",
    "scipy",
    "tokenizers",
    "transformers",
)


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def dependency_versions() -> dict[str, str]:
    return {name: importlib.metadata.version(name) for name in DEPENDENCY_PACKAGES}


def load_candidate_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    config = read_json(path)
    if config.get("schemaVersion") != "gatelm.difficulty-semantic-encoder-candidates.v1":
        raise ValueError("unsupported semantic encoder candidate config schema")
    if config.get("status") != "provisional_offline_only":
        raise ValueError("semantic encoder candidates must remain provisional offline only")
    protocol = config.get("benchmarkProtocol", {})
    if protocol.get("batchSize") != 1:
        raise ValueError("semantic encoder benchmark batch size must be exactly 1")
    truncation = protocol.get("truncation", {})
    maximum = protocol.get("maximumTokenLength")
    special = protocol.get("specialTokenBudget")
    usable = protocol.get("usableContentTokens")
    if maximum != 128 or special != 2 or usable != maximum - special:
        raise ValueError("v1 token budget must be pinned to 128 total and 126 content tokens")
    if truncation.get("headTokens") + truncation.get("tailTokens") != usable:
        raise ValueError("head and tail token budgets must consume the exact usable token count")
    if truncation.get("callerOverride") is not False:
        raise ValueError("head-tail truncation cannot be caller configurable")
    if truncation.get("emptyOrSpecialTokenOnly") != "reject_before_encoder_call":
        raise ValueError("empty semantic input must be rejected before encoder call")
    if (
        truncation.get("specialTokenTreatment")
        != "prepend_declared_cls_or_bos_id_and_append_declared_sep_or_eos_id"
    ):
        raise ValueError("semantic encoder special-token treatment does not match v1")
    candidate_ids: set[str] = set()
    candidates = config.get("candidates")
    if not isinstance(candidates, list) or len(candidates) < 3:
        raise ValueError("at least three semantic encoder candidates are required")
    for candidate in candidates:
        candidate_id = candidate.get("candidateId", "")
        revision = candidate.get("sourceRevision", "")
        if not candidate_id or candidate_id in candidate_ids:
            raise ValueError("candidate ids must be non-empty and unique")
        candidate_ids.add(candidate_id)
        if not IMMUTABLE_REVISION.fullmatch(revision):
            raise ValueError(f"candidate {candidate_id!r} uses a mutable or invalid revision")
        if candidate.get("nativeDimension", 0) <= 0:
            raise ValueError(f"candidate {candidate_id!r} has an invalid native dimension")
        paths: set[str] = set()
        for item in candidate.get("sourceFiles", []):
            relative = item.get("path", "")
            if not relative or relative in paths or Path(relative).is_absolute() or ".." in Path(relative).parts:
                raise ValueError(f"candidate {candidate_id!r} has an unsafe or duplicate artifact path")
            paths.add(relative)
            expected = item.get("expectedSha256")
            if expected is not None and not re.fullmatch(r"[0-9a-f]{64}", expected):
                raise ValueError(f"candidate {candidate_id!r} has an invalid expected SHA-256")
        if "onnx/model.onnx" not in paths:
            raise ValueError(f"candidate {candidate_id!r} must pin a local ONNX encoder")
    return config


def candidate_by_id(config: dict[str, Any], candidate_id: str) -> dict[str, Any]:
    for candidate in config["candidates"]:
        if candidate["candidateId"] == candidate_id:
            return candidate
    raise ValueError(f"unknown semantic encoder candidate {candidate_id!r}")


def candidate_directory(artifact_root: Path, candidate: dict[str, Any]) -> Path:
    return artifact_root / candidate["candidateId"] / candidate["sourceRevision"]


def _download_source_files(candidate: dict[str, Any], directory: Path) -> list[dict[str, Any]]:
    from huggingface_hub import hf_hub_download

    artifacts: list[dict[str, Any]] = []
    for item in candidate["sourceFiles"]:
        downloaded = Path(
            hf_hub_download(
                repo_id=candidate["sourceModelId"],
                filename=item["path"],
                revision=candidate["sourceRevision"],
                local_dir=directory,
                local_dir_use_symlinks=False,
            )
        )
        actual = sha256_file(downloaded)
        expected = item.get("expectedSha256")
        if expected is not None and actual != "sha256:" + expected:
            raise ValueError(
                f"downloaded artifact hash mismatch for {candidate['candidateId']}:{item['path']}"
            )
        artifacts.append(
            {
                "role": item["role"],
                "relativePath": item["path"],
                "sha256": actual,
                "sizeBytes": downloaded.stat().st_size,
                "source": "huggingface_immutable_revision",
            }
        )
    return artifacts


def _quantize_encoder(candidate: dict[str, Any], directory: Path) -> dict[str, Any]:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    source = directory / "onnx/model.onnx"
    relative = "generated/model.dynamic-qint8-matmul.onnx"
    output = directory / relative
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    quantize_dynamic(
        model_input=str(source),
        model_output=str(output),
        op_types_to_quantize=["MatMul"],
        per_channel=False,
        reduce_range=False,
        weight_type=QuantType.QInt8,
    )
    if not output.is_file() or output.stat().st_size == 0:
        raise ValueError(f"quantization produced no artifact for {candidate['candidateId']}")
    return {
        "role": "encoder_onnx_dynamic_qint8",
        "relativePath": relative,
        "sha256": sha256_file(output),
        "sizeBytes": output.stat().st_size,
        "source": "generated_onnxruntime_dynamic_quantization",
    }


def prepare_candidate(
    candidate: dict[str, Any], artifact_root: Path, config_hash: str
) -> dict[str, Any]:
    directory = candidate_directory(artifact_root, candidate)
    directory.mkdir(parents=True, exist_ok=True)
    artifacts = _download_source_files(candidate, directory)
    artifacts.append(_quantize_encoder(candidate, directory))
    artifacts.sort(key=lambda item: (item["role"], item["relativePath"]))
    manifest: dict[str, Any] = {
        "schemaVersion": "gatelm.difficulty-semantic-encoder-artifact-manifest.v1",
        "candidateId": candidate["candidateId"],
        "sourceModelId": candidate["sourceModelId"],
        "sourceRevision": candidate["sourceRevision"],
        "tokenizerVersion": candidate["tokenizerVersion"],
        "encoderVersion": candidate["encoderVersion"],
        "architecture": candidate["architecture"],
        "nativeDimension": candidate["nativeDimension"],
        "license": candidate["license"],
        "weightProvenance": candidate["weightProvenance"],
        "candidateConfigSha256": config_hash,
        "dependencyVersions": dependency_versions(),
        "artifacts": artifacts,
        "artifactSetSha256": canonical_hash(artifacts),
    }
    manifest["manifestSha256"] = canonical_hash(manifest)
    write_json(directory / "artifact-manifest.json", manifest)
    return manifest


def prepare_all(config_path: Path, artifact_root: Path) -> list[dict[str, Any]]:
    config = load_candidate_config(config_path)
    config_hash = sha256_file(config_path)
    return [
        prepare_candidate(candidate, artifact_root, config_hash)
        for candidate in config["candidates"]
    ]


def load_and_verify_manifest(
    candidate: dict[str, Any], artifact_root: Path, config_path: Path = DEFAULT_CONFIG
) -> tuple[dict[str, Any], Path]:
    directory = candidate_directory(artifact_root, candidate)
    manifest_path = directory / "artifact-manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"prepared artifact manifest is missing for {candidate['candidateId']}")
    manifest = read_json(manifest_path)
    expected_manifest_hash = manifest.pop("manifestSha256", None)
    actual_manifest_hash = canonical_hash(manifest)
    manifest["manifestSha256"] = expected_manifest_hash
    if expected_manifest_hash != actual_manifest_hash:
        raise ValueError(f"artifact manifest hash mismatch for {candidate['candidateId']}")
    if manifest.get("candidateConfigSha256") != sha256_file(config_path):
        raise ValueError(f"candidate config hash mismatch for {candidate['candidateId']}")
    if manifest.get("sourceRevision") != candidate["sourceRevision"]:
        raise ValueError(f"artifact revision mismatch for {candidate['candidateId']}")
    actual_artifacts: list[dict[str, Any]] = []
    for item in manifest.get("artifacts", []):
        relative = item.get("relativePath", "")
        path = directory / relative
        if not relative or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise ValueError("artifact manifest contains an unsafe path")
        if not path.is_file():
            raise ValueError(f"artifact file is missing: {candidate['candidateId']}:{relative}")
        actual = sha256_file(path)
        if actual != item.get("sha256") or path.stat().st_size != item.get("sizeBytes"):
            raise ValueError(f"artifact hash or size mismatch: {candidate['candidateId']}:{relative}")
        actual_artifacts.append(item)
    if canonical_hash(actual_artifacts) != manifest.get("artifactSetSha256"):
        raise ValueError(f"artifact set hash mismatch for {candidate['candidateId']}")
    return manifest, directory


def artifact_for_role(manifest: dict[str, Any], directory: Path, role: str) -> Path:
    matches = [item for item in manifest["artifacts"] if item["role"] == role]
    if len(matches) != 1:
        raise ValueError(f"artifact role {role!r} must resolve exactly once")
    return directory / matches[0]["relativePath"]
