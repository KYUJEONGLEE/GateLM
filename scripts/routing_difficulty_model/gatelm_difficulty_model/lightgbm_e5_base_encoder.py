"""Pinned multilingual-E5-base runtime for isolated LightGBM experiments.

The large ONNX bundle is hydrated below ``.tmp`` and is never committed.  A
small lock file with the exact revision, sizes, and SHA-256 digests is safe to
commit beside the derived LightGBM heads.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping


MODEL_ID = "intfloat/multilingual-e5-base"
SOURCE_REVISION = "d13f1b27baf31030b7fd040960d60d909913633f"
NATIVE_DIMENSION = 768
INPUT_PREFIX = "query: "
MAXIMUM_TOKEN_LENGTH = 128
POOLING = "attention_mask_weighted_mean_excluding_padding"
LOCK_SCHEMA = "gatelm.routing-difficulty-e5-base-runtime-lock.v1"
ARTIFACT_DIRECTORY = f"multilingual-e5-base/{SOURCE_REVISION}"
SOURCE_ONNX_PATH = "onnx/model.onnx"
QINT8_ONNX_PATH = "generated/model.dynamic-qint8-matmul.onnx"
SOURCE_FILES = (
    ("model_config", "config.json"),
    ("sentence_transformer_config", "sentence_bert_config.json"),
    ("pooling_config", "1_Pooling/config.json"),
    ("special_tokens", "special_tokens_map.json"),
    ("tokenizer_json", "tokenizer.json"),
    ("tokenizer_config", "tokenizer_config.json"),
    ("tokenizer_model", "sentencepiece.bpe.model"),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _identity(path: Path, *, role: str, relative_path: str) -> dict[str, Any]:
    return {
        "role": role,
        "relativePath": relative_path,
        "sizeBytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def prepare_artifacts(*, artifact_root: Path, lock_path: Path) -> dict[str, Any]:
    """Download the pinned source once, quantize it, and write an immutable lock."""

    from huggingface_hub import hf_hub_download
    from onnxruntime.quantization import QuantType, quantize_dynamic

    directory = artifact_root / ARTIFACT_DIRECTORY
    directory.mkdir(parents=True, exist_ok=True)
    required = [relative for _, relative in SOURCE_FILES] + [SOURCE_ONNX_PATH]
    for relative_path in required:
        target = directory / relative_path
        if target.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        hf_hub_download(
            repo_id=MODEL_ID,
            filename=relative_path,
            revision=SOURCE_REVISION,
            local_dir=directory,
            local_dir_use_symlinks=False,
        )

    source_onnx = directory / SOURCE_ONNX_PATH
    qint8_onnx = directory / QINT8_ONNX_PATH
    if not qint8_onnx.is_file():
        qint8_onnx.parent.mkdir(parents=True, exist_ok=True)
        quantize_dynamic(
            model_input=str(source_onnx),
            model_output=str(qint8_onnx),
            op_types_to_quantize=["MatMul"],
            per_channel=False,
            reduce_range=False,
            weight_type=QuantType.QInt8,
        )

    runtime_artifacts = [
        _identity(directory / relative, role=role, relative_path=relative)
        for role, relative in SOURCE_FILES
    ]
    runtime_artifacts.append(
        _identity(
            qint8_onnx,
            role="encoder_onnx_dynamic_qint8",
            relative_path=QINT8_ONNX_PATH,
        )
    )
    lock = {
        "schemaVersion": LOCK_SCHEMA,
        "encoder": {
            "modelId": MODEL_ID,
            "sourceRevision": SOURCE_REVISION,
            "artifactDirectory": ARTIFACT_DIRECTORY,
            "runtimeArtifacts": runtime_artifacts,
            "inputPrefix": INPUT_PREFIX,
            "maximumTokenLength": MAXIMUM_TOKEN_LENGTH,
            "outputDimension": NATIVE_DIMENSION,
            "pooling": POOLING,
        },
        "sourceOnnx": _identity(
            source_onnx,
            role="encoder_onnx_source",
            relative_path=SOURCE_ONNX_PATH,
        ),
        "quantization": {
            "algorithm": "onnxruntime.quantize_dynamic",
            "opTypes": ["MatMul"],
            "weightType": "QInt8",
            "perChannel": False,
            "reduceRange": False,
        },
    }
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(
        json.dumps(lock, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    validate_lock(lock, artifact_root=artifact_root)
    return lock


def load_lock(path: Path, *, artifact_root: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("E5-base runtime lock must be a JSON object")
    validate_lock(value, artifact_root=artifact_root)
    return value


def validate_lock(lock: Mapping[str, Any], *, artifact_root: Path) -> None:
    encoder = lock.get("encoder")
    if (
        lock.get("schemaVersion") != LOCK_SCHEMA
        or not isinstance(encoder, Mapping)
        or encoder.get("modelId") != MODEL_ID
        or encoder.get("sourceRevision") != SOURCE_REVISION
        or encoder.get("artifactDirectory") != ARTIFACT_DIRECTORY
        or encoder.get("inputPrefix") != INPUT_PREFIX
        or encoder.get("maximumTokenLength") != MAXIMUM_TOKEN_LENGTH
        or encoder.get("outputDimension") != NATIVE_DIMENSION
        or encoder.get("pooling") != POOLING
    ):
        raise ValueError("E5-base runtime lock identity is invalid")
    entries = encoder.get("runtimeArtifacts")
    expected_roles = {role for role, _ in SOURCE_FILES} | {
        "encoder_onnx_dynamic_qint8"
    }
    if not isinstance(entries, list) or {entry.get("role") for entry in entries} != expected_roles:
        raise ValueError("E5-base runtime lock artifact roles are invalid")
    directory = (artifact_root / ARTIFACT_DIRECTORY).resolve()
    root = artifact_root.resolve()
    directory.relative_to(root)
    for entry in entries:
        relative = str(entry.get("relativePath", ""))
        path = (directory / relative).resolve()
        path.relative_to(directory)
        if (
            not path.is_file()
            or path.stat().st_size != entry.get("sizeBytes")
            or sha256_file(path) != entry.get("sha256")
        ):
            raise ValueError("E5-base runtime artifact integrity mismatch")


class E5BaseEncoderRuntime:
    def __init__(self, *, artifact_root: Path, lock: Mapping[str, Any]) -> None:
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        validate_lock(lock, artifact_root=artifact_root)
        encoder = lock["encoder"]
        directory = artifact_root / str(encoder["artifactDirectory"])
        entries = {entry["role"]: entry for entry in encoder["runtimeArtifacts"]}
        self._tokenizer = AutoTokenizer.from_pretrained(
            directory,
            revision=SOURCE_REVISION,
            local_files_only=True,
            trust_remote_code=False,
            use_fast=True,
        )
        self._tokenizer.truncation_side = "right"
        self._tokenizer.padding_side = "right"
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self._session = ort.InferenceSession(
            str(directory / entries["encoder_onnx_dynamic_qint8"]["relativePath"]),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self._input_names = {value.name for value in self._session.get_inputs()}
        self._np = np

    def encode_one(self, instruction_text: str) -> Any:
        if not isinstance(instruction_text, str) or not instruction_text.strip():
            raise ValueError("E5-base instruction text is not applicable")
        encoded = self._tokenizer(
            [INPUT_PREFIX + instruction_text],
            add_special_tokens=True,
            padding=True,
            truncation=True,
            max_length=MAXIMUM_TOKEN_LENGTH,
            return_attention_mask=True,
            return_token_type_ids=True,
            return_tensors="np",
        )
        input_ids = self._np.asarray(encoded["input_ids"], dtype=self._np.int64)
        attention_mask = self._np.asarray(
            encoded["attention_mask"], dtype=self._np.int64
        )
        token_type_ids = self._np.asarray(
            encoded.get("token_type_ids", self._np.zeros_like(input_ids)),
            dtype=self._np.int64,
        )
        available = {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "token_type_ids": token_type_ids,
        }
        hidden = self._session.run(
            ["last_hidden_state"],
            {name: available[name] for name in self._input_names},
        )[0]
        hidden = self._np.asarray(hidden, dtype=self._np.float32)
        if hidden.ndim != 3 or hidden.shape[0] != 1 or hidden.shape[2] != NATIVE_DIMENSION:
            raise ValueError("E5-base encoder output shape is invalid")
        mask = self._np.asarray(attention_mask, dtype=self._np.float32)
        denominator = mask.sum(axis=1, keepdims=True, dtype=self._np.float32)
        pooled = (hidden * mask[:, :, None]).sum(
            axis=1, dtype=self._np.float32
        ) / denominator
        row = self._np.asarray(pooled[0], dtype=self._np.float32)
        if row.shape != (NATIVE_DIMENSION,) or not self._np.all(self._np.isfinite(row)):
            raise ValueError("E5-base pooled output is invalid")
        return row
