"""Canonical offline multilingual-E5 QInt8 encoder.

Request-derived text, tokens, hidden states, and embeddings stay process-local.
Only the immutable PCA parameters and aggregate provenance are serializable.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import io
import json
import os
import socket
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
DEFAULT_ARTIFACT_ROOT = REPO_ROOT / ".tmp/difficulty-semantic-encoder-artifacts"
DEFAULT_PCA_PATH = TOOL_DIR / "artifacts/difficulty-e5-pca-64.v2.npz"
DEFAULT_MANIFEST_PATH = TOOL_DIR / "artifacts/difficulty-e5-encoder-manifest.v2.json"

MANIFEST_SCHEMA = "gatelm.difficulty-e5-encoder-manifest.v2"
BUNDLE_VERSION = "difficulty-e5-encoder-pca64-single-request.2026-07-15.v2"
MODEL_ID = "intfloat/multilingual-e5-small"
SOURCE_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
ARTIFACT_DIRECTORY = f"multilingual-e5-small/{SOURCE_REVISION}"
QINT8_MODEL_PATH = "generated/model.dynamic-qint8-matmul.onnx"
SOURCE_ONNX_PATH = "onnx/model.onnx"
SOURCE_ONNX_SHA256 = "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"
QINT8_ONNX_SHA256 = "a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94"
INPUT_PREFIX = "query: "
MAXIMUM_TOKEN_LENGTH = 128
NATIVE_DIMENSION = 384
PROJECTION_DIMENSION = 64
L2_EPSILON = 1e-12
POOLING_VERSION = "difficulty-attention-masked-mean.v2"
PROJECTION_VERSION = "difficulty-e5-pca-full-svd-64.single-request.v2"
PREPROCESSING_VERSION = "difficulty-e5-query-prefix-right-truncation-128.single-request.v2"
EXECUTION_SHAPE_POLICY_VERSION = "difficulty-e5-single-request-execution.2026-07-15.v1"
RUNTIME_REQUEST_BATCH_SIZE = 1

RUNTIME_ARTIFACT_ROLES = (
    ("model_config", "config.json"),
    ("sentence_transformer_config", "sentence_bert_config.json"),
    ("pooling_config", "1_Pooling/config.json"),
    ("special_tokens", "special_tokens_map.json"),
    ("tokenizer_json", "tokenizer.json"),
    ("tokenizer_config", "tokenizer_config.json"),
    ("tokenizer_model", "sentencepiece.bpe.model"),
    ("encoder_onnx_dynamic_qint8", QINT8_MODEL_PATH),
)
PINNED_SOURCE_HASHES = {
    "config.json": "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959",
    "sentence_bert_config.json": "948201d8329907aae938fa62f9ceeed53f5694dacc2b87b9f3b78b37ee986529",
    "1_Pooling/config.json": "987f7a67a38fa564c849bb5d277c52ab9088a84368fc0be31a354125aebb12a0",
    "special_tokens_map.json": "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    "tokenizer.json": "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    "tokenizer_config.json": "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    "sentencepiece.bpe.model": "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865",
    SOURCE_ONNX_PATH: SOURCE_ONNX_SHA256,
}
DEPENDENCY_PACKAGES = (
    "numpy",
    "onnxruntime",
    "scikit-learn",
    "tokenizers",
    "transformers",
)


class SemanticInputNotApplicable(ValueError):
    """The instruction is empty and must not be encoded or zero-filled."""


class InvalidEmbedding(ValueError):
    """The local encoder produced invalid, non-finite, or degenerate material."""


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value: Any) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"JSON object required: {path}")
    return value


def write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def install_network_guard() -> None:
    """Deny outbound connects after the explicit artifact preparation phase."""

    def denied(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("network access disabled for the offline E5 encoder")

    os.environ.update(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_DATASETS_OFFLINE": "1",
        }
    )
    socket.socket.connect = denied  # type: ignore[method-assign]
    socket.socket.connect_ex = denied  # type: ignore[method-assign]
    socket.create_connection = denied  # type: ignore[assignment]


def masked_mean(hidden_states: Any, attention_mask: Any) -> Any:
    import numpy as np

    hidden = np.asarray(hidden_states, dtype=np.float32)
    mask = np.asarray(attention_mask, dtype=np.float32)
    if hidden.ndim != 3 or mask.ndim != 2 or hidden.shape[:2] != mask.shape:
        raise InvalidEmbedding(
            "pooling requires aligned [batch, sequence, hidden] and [batch, sequence] arrays"
        )
    if hidden.shape[2] != NATIVE_DIMENSION:
        raise InvalidEmbedding("encoder hidden dimension is not 384")
    if not np.all(np.isfinite(hidden)) or not np.all(np.isfinite(mask)):
        raise InvalidEmbedding("pooling input must be finite")
    counts = mask.sum(axis=1, keepdims=True)
    if np.any(counts <= 0.0):
        raise InvalidEmbedding("attention mask must contain at least one readable token")
    pooled = (hidden * mask[:, :, None]).sum(axis=1) / counts
    pooled = np.asarray(pooled, dtype=np.float32)
    if pooled.shape != (hidden.shape[0], NATIVE_DIMENSION) or not np.all(np.isfinite(pooled)):
        raise InvalidEmbedding("masked mean returned invalid material")
    return pooled


def encode_pooled_single_requests(runtime: Any, instruction_texts: Sequence[str]) -> Any:
    """Encode every record with the exact online Gateway request shape.

    Dynamic-QInt8 output is shape-sensitive. Training, calibration and evaluation
    material must therefore never share an ONNX batch across requests.
    """

    import numpy as np

    if isinstance(instruction_texts, (str, bytes)) or not instruction_texts:
        raise SemanticInputNotApplicable("at least one single-request instruction is required")
    rows = [
        np.asarray(runtime.encode_pooled_one(instruction_text), dtype=np.float32)
        for instruction_text in instruction_texts
    ]
    values = np.stack(rows, axis=0).astype(np.float32, copy=False)
    if values.shape != (len(instruction_texts), NATIVE_DIMENSION) or not np.all(
        np.isfinite(values)
    ):
        raise InvalidEmbedding("single-request encoder returned invalid pooled material")
    return values


def _parameter_hash(mean: Any, components: Any) -> str:
    import numpy as np

    mean_array = np.asarray(mean, dtype="<f4")
    component_array = np.asarray(components, dtype="<f4")
    return sha256_bytes(mean_array.tobytes(order="C") + component_array.tobytes(order="C"))


@dataclass(frozen=True)
class PCAProjection:
    mean: Any
    components: Any

    def __post_init__(self) -> None:
        import numpy as np

        mean = np.asarray(self.mean, dtype=np.float32)
        components = np.asarray(self.components, dtype=np.float32)
        if mean.shape != (NATIVE_DIMENSION,) or components.shape != (
            PROJECTION_DIMENSION,
            NATIVE_DIMENSION,
        ):
            raise ValueError("PCA parameter shape must be mean[384] and components[64,384]")
        if not np.all(np.isfinite(mean)) or not np.all(np.isfinite(components)):
            raise ValueError("PCA parameters must be finite")
        object.__setattr__(self, "mean", mean)
        object.__setattr__(self, "components", components)

    @property
    def parameter_hash(self) -> str:
        return _parameter_hash(self.mean, self.components)

    def transform(self, values: Any) -> Any:
        import numpy as np

        array = np.asarray(values, dtype=np.float32)
        if array.ndim == 1:
            array = array[None, :]
        if array.ndim != 2 or array.shape[1] != NATIVE_DIMENSION:
            raise InvalidEmbedding("PCA input must have shape [batch,384]")
        if not np.all(np.isfinite(array)):
            raise InvalidEmbedding("PCA input must be finite")
        projected = np.asarray((array - self.mean) @ self.components.T, dtype=np.float32)
        norms = np.linalg.norm(projected, axis=1, keepdims=True)
        if not np.all(np.isfinite(norms)) or np.any(norms <= L2_EPSILON):
            raise InvalidEmbedding("PCA output is non-finite or has a degenerate L2 norm")
        normalized = np.asarray(projected / norms, dtype=np.float32)
        if normalized.shape != (array.shape[0], PROJECTION_DIMENSION):
            raise InvalidEmbedding("normalized PCA output has an invalid shape")
        return normalized

    def save(self, path: Path) -> None:
        import numpy as np

        path.parent.mkdir(parents=True, exist_ok=True)
        arrays = (("mean", self.mean), ("components", self.components))
        with zipfile.ZipFile(path, mode="w", compression=zipfile.ZIP_STORED) as archive:
            for name, array in arrays:
                payload = io.BytesIO()
                np.lib.format.write_array(
                    payload,
                    np.asarray(array, dtype=np.float32),
                    allow_pickle=False,
                )
                info = zipfile.ZipInfo(f"{name}.npy", date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.create_system = 0
                archive.writestr(info, payload.getvalue())

    @classmethod
    def load(cls, path: Path) -> "PCAProjection":
        import numpy as np

        if not path.is_file():
            raise ValueError(f"PCA artifact is missing: {path}")
        with np.load(path, allow_pickle=False) as artifact:
            if set(artifact.files) != {"mean", "components"}:
                raise ValueError("PCA NPZ must contain only mean and components")
            return cls(
                mean=np.asarray(artifact["mean"], dtype=np.float32),
                components=np.asarray(artifact["components"], dtype=np.float32),
            )


def fit_pca(train_embeddings: Any) -> PCAProjection:
    import numpy as np
    from sklearn.decomposition import PCA

    values = np.asarray(train_embeddings, dtype=np.float32)
    if values.shape != (300, NATIVE_DIMENSION) or not np.all(np.isfinite(values)):
        raise ValueError("PCA fit requires exactly 300 finite pooled E5 embeddings with 384 dimensions")
    pca = PCA(n_components=PROJECTION_DIMENSION, svd_solver="full", whiten=False)
    pca.fit(values)
    projection = PCAProjection(
        mean=np.asarray(pca.mean_, dtype=np.float32),
        components=np.asarray(pca.components_, dtype=np.float32),
    )
    expected = np.asarray(pca.transform(values), dtype=np.float32)
    actual = np.asarray((values - projection.mean) @ projection.components.T, dtype=np.float32)
    if not np.allclose(actual, expected, rtol=1e-5, atol=1e-5):
        raise ValueError("serialized PCA parameters do not reproduce sklearn.transform")
    return projection


class E5EncoderRuntime:
    def __init__(
        self,
        model_directory: Path,
        model_path: Path,
        *,
        projection: PCAProjection | None,
        intra_op_threads: int = 4,
        inter_op_threads: int = 1,
    ) -> None:
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.model_directory = model_directory
        self.model_path = model_path
        self.projection = projection
        self.tokenizer = AutoTokenizer.from_pretrained(
            model_directory,
            local_files_only=True,
            trust_remote_code=False,
            use_fast=True,
        )
        self.tokenizer.truncation_side = "right"
        self.tokenizer.padding_side = "right"
        options = ort.SessionOptions()
        options.intra_op_num_threads = intra_op_threads
        options.inter_op_num_threads = inter_op_threads
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            str(model_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.input_names = {value.name for value in self.session.get_inputs()}
        if not {"input_ids", "attention_mask"}.issubset(self.input_names):
            raise ValueError("E5 ONNX model is missing required inputs")
        outputs = self.session.get_outputs()
        if len(outputs) != 1 or outputs[0].name != "last_hidden_state":
            raise ValueError("E5 ONNX model must expose only last_hidden_state")

    def tokenize(self, instruction_texts: Sequence[str]) -> dict[str, Any]:
        import numpy as np

        if isinstance(instruction_texts, (str, bytes)) or not instruction_texts:
            raise SemanticInputNotApplicable("at least one non-empty instruction is required")
        if len(instruction_texts) != RUNTIME_REQUEST_BATCH_SIZE:
            raise ValueError("canonical E5 runtime accepts exactly one request per invocation")
        if any(not isinstance(text, str) or not text.strip() for text in instruction_texts):
            raise SemanticInputNotApplicable("empty instructionText is not applicable to E5 encoding")
        prefixed = [INPUT_PREFIX + text for text in instruction_texts]
        encoded = self.tokenizer(
            prefixed,
            add_special_tokens=True,
            padding=True,
            truncation=True,
            max_length=MAXIMUM_TOKEN_LENGTH,
            return_attention_mask=True,
            return_token_type_ids=True,
            return_tensors="np",
        )
        input_ids = np.asarray(encoded["input_ids"], dtype=np.int64)
        attention_mask = np.asarray(encoded["attention_mask"], dtype=np.int64)
        if input_ids.ndim != 2 or input_ids.shape != attention_mask.shape:
            raise ValueError("tokenizer input IDs and attention mask must have identical 2D shape")
        if input_ids.shape[0] != len(instruction_texts) or input_ids.shape[1] > MAXIMUM_TOKEN_LENGTH:
            raise ValueError("tokenizer violated the single-request or maximum-length contract")
        token_type_ids = np.asarray(
            encoded.get("token_type_ids", np.zeros_like(input_ids)),
            dtype=np.int64,
        )
        if token_type_ids.shape != input_ids.shape:
            raise ValueError("token type IDs must align with input IDs")
        return {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
            "token_type_ids": token_type_ids,
        }

    def encode_pooled(self, instruction_texts: Sequence[str]) -> Any:
        import numpy as np

        tokenized = self.tokenize(instruction_texts)
        inputs = {
            name: np.asarray(tokenized[name], dtype=np.int64)
            for name in self.input_names
            if name in tokenized
        }
        outputs = self.session.run(["last_hidden_state"], inputs)
        return masked_mean(outputs[0], tokenized["attention_mask"])

    def encode_pooled_one(self, instruction_text: str) -> Any:
        """Return the native 384D pooled representation without PCA projection."""

        return self.encode_pooled([instruction_text])[0]

    def encode(self, instruction_texts: Sequence[str]) -> Any:
        if self.projection is None:
            raise ValueError("PCA projection is required for canonical 64D encoding")
        return self.projection.transform(self.encode_pooled(instruction_texts))

    def encode_one(self, instruction_text: str) -> Any:
        return self.encode([instruction_text])[0]


def _artifact_entries(model_directory: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for role, relative_path in RUNTIME_ARTIFACT_ROLES:
        path = model_directory / relative_path
        if not path.is_file():
            raise ValueError(f"required local E5 artifact is missing: {relative_path}")
        entries.append(
            {
                "role": role,
                "relativePath": relative_path,
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    encoder = next(item for item in entries if item["role"] == "encoder_onnx_dynamic_qint8")
    if encoder["sha256"] != QINT8_ONNX_SHA256:
        raise ValueError("local QInt8 E5 artifact does not match the pinned encoder hash")
    return entries


def build_manifest(
    *,
    artifact_root: Path,
    pca_path: Path,
    projection: PCAProjection,
    dataset_manifest: Mapping[str, Any],
) -> dict[str, Any]:
    artifact_root = artifact_root.resolve()
    pca_path = pca_path.resolve()
    model_directory = artifact_root / ARTIFACT_DIRECTORY
    artifacts = _artifact_entries(model_directory)
    if not pca_path.is_file():
        raise ValueError("PCA NPZ must exist before its manifest is built")
    split_counts = dataset_manifest.get("splitCounts")
    if not isinstance(split_counts, Mapping) or {
        key: split_counts.get(key, {}).get("records") for key in ("train", "calibration", "holdout")
    } != {"train": 300, "calibration": 100, "holdout": 100}:
        raise ValueError("dataset manifest must declare exact 300/100/100 split counts")
    manifest: dict[str, Any] = {
        "schemaVersion": MANIFEST_SCHEMA,
        "bundleVersion": BUNDLE_VERSION,
        "status": "canonical_offline_only_not_runtime_active",
        "modelId": MODEL_ID,
        "sourceRevision": SOURCE_REVISION,
        "artifactDirectory": ARTIFACT_DIRECTORY,
        "runtimeArtifacts": artifacts,
        "preprocessing": {
            "version": PREPROCESSING_VERSION,
            "inputPrefix": INPUT_PREFIX,
            "maximumTokenLength": MAXIMUM_TOKEN_LENGTH,
            "truncation": "right",
            "padding": "batch_longest",
            "emptyInput": "not_applicable_before_tokenizer",
        },
        "executionShape": {
            "policyVersion": EXECUTION_SHAPE_POLICY_VERSION,
            "unit": "single_request",
            "batchSize": RUNTIME_REQUEST_BATCH_SIZE,
            "paddingScope": "within_request_only",
            "appliesTo": [
                "pca_fit",
                "semantic_head_training",
                "difficulty_candidate_training",
                "calibration",
                "diagnostic_evaluation",
                "gateway_replay",
            ],
        },
        "encoder": {
            "version": "difficulty-encoder.multilingual-e5-small-qint8.v1",
            "runtime": "onnxruntime_cpu",
            "inputDtype": "int64",
            "outputDtype": "float32",
            "outputDimension": NATIVE_DIMENSION,
            "intraOpThreads": 4,
            "interOpThreads": 1,
        },
        "pooling": {
            "version": POOLING_VERSION,
            "rule": "attention_mask_weighted_mean_excluding_padding",
            "outputDtype": "float32",
            "outputDimension": NATIVE_DIMENSION,
        },
        "projection": {
            "version": PROJECTION_VERSION,
            "kind": "sklearn_pca_full_svd",
            "relativePath": str(pca_path.relative_to(REPO_ROOT)).replace("\\", "/"),
            "fileSha256": sha256_file(pca_path),
            "parameterSha256": projection.parameter_hash,
            "inputDimension": NATIVE_DIMENSION,
            "outputDimension": PROJECTION_DIMENSION,
            "meanShape": [NATIVE_DIMENSION],
            "componentsShape": [PROJECTION_DIMENSION, NATIVE_DIMENSION],
            "dtype": "float32",
            "fitSplit": "train",
            "fitRecordCount": 300,
            "svdSolver": "full",
            "whiten": False,
        },
        "normalization": {
            "position": "after_projection",
            "kind": "l2",
            "epsilon": L2_EPSILON,
            "degenerate": "invalid_embedding_fail_closed",
        },
        "dataset": {
            "version": dataset_manifest["datasetVersion"],
            "sha256": dataset_manifest["datasetSha256"],
            "splitPolicyVersion": dataset_manifest["splitPolicyVersion"],
            "splitSeed": dataset_manifest["splitSeed"],
            "splitCounts": split_counts,
        },
        "output": {"shape": ["request", PROJECTION_DIMENSION], "dtype": "float32"},
        "dependencyVersions": {
            package: importlib.metadata.version(package) for package in DEPENDENCY_PACKAGES
        },
        "createdAt": "2026-07-15T00:00:00Z",
    }
    manifest["bundleSha256"] = canonical_hash(manifest)
    return manifest


def validate_manifest(
    manifest: Mapping[str, Any],
    *,
    artifact_root: Path,
    verify_files: bool = True,
) -> PCAProjection:
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA:
        raise ValueError("unsupported E5 encoder manifest schema")
    material = dict(manifest)
    expected_bundle = material.pop("bundleSha256", None)
    if expected_bundle != canonical_hash(material):
        raise ValueError("E5 encoder manifest bundle hash mismatch")
    if (
        manifest.get("modelId") != MODEL_ID
        or manifest.get("sourceRevision") != SOURCE_REVISION
        or manifest.get("bundleVersion") != BUNDLE_VERSION
    ):
        raise ValueError("E5 encoder manifest identity mismatch")
    preprocessing = manifest.get("preprocessing", {})
    if preprocessing != {
        "version": PREPROCESSING_VERSION,
        "inputPrefix": INPUT_PREFIX,
        "maximumTokenLength": MAXIMUM_TOKEN_LENGTH,
        "truncation": "right",
        "padding": "batch_longest",
        "emptyInput": "not_applicable_before_tokenizer",
    }:
        raise ValueError("E5 preprocessing contract mismatch")
    if manifest.get("executionShape") != {
        "policyVersion": EXECUTION_SHAPE_POLICY_VERSION,
        "unit": "single_request",
        "batchSize": RUNTIME_REQUEST_BATCH_SIZE,
        "paddingScope": "within_request_only",
        "appliesTo": [
            "pca_fit",
            "semantic_head_training",
            "difficulty_candidate_training",
            "calibration",
            "diagnostic_evaluation",
            "gateway_replay",
        ],
    }:
        raise ValueError("E5 execution shape contract mismatch")
    model_directory = artifact_root / str(manifest.get("artifactDirectory", ""))
    artifacts = manifest.get("runtimeArtifacts")
    if not isinstance(artifacts, list) or not all(isinstance(item, Mapping) for item in artifacts):
        raise ValueError("E5 runtime artifact manifest must contain objects")
    expected_paths = dict(RUNTIME_ARTIFACT_ROLES)
    expected_hashes = {
        role: (QINT8_ONNX_SHA256 if relative_path == QINT8_MODEL_PATH else PINNED_SOURCE_HASHES[relative_path])
        for role, relative_path in RUNTIME_ARTIFACT_ROLES
    }
    artifact_by_role = {str(item.get("role")): item for item in artifacts}
    if set(artifact_by_role) != set(expected_paths) or len(artifact_by_role) != len(artifacts):
        raise ValueError("E5 runtime artifact roles are incomplete")
    for role, expected_path in expected_paths.items():
        item = artifact_by_role[role]
        if (
            item.get("relativePath") != expected_path
            or item.get("sha256") != expected_hashes[role]
            or not isinstance(item.get("sizeBytes"), int)
            or int(item["sizeBytes"]) <= 0
        ):
            raise ValueError(f"E5 runtime artifact identity mismatch: {role}")
    if verify_files:
        for item in artifacts:
            path = model_directory / item["relativePath"]
            if (
                not path.is_file()
                or path.stat().st_size != item["sizeBytes"]
                or sha256_file(path) != item["sha256"]
            ):
                raise ValueError(f"E5 runtime artifact mismatch: {item['role']}")
    if manifest.get("encoder") != {
        "version": "difficulty-encoder.multilingual-e5-small-qint8.v1",
        "runtime": "onnxruntime_cpu",
        "inputDtype": "int64",
        "outputDtype": "float32",
        "outputDimension": NATIVE_DIMENSION,
        "intraOpThreads": 4,
        "interOpThreads": 1,
    }:
        raise ValueError("E5 encoder contract mismatch")
    if manifest.get("pooling") != {
        "version": POOLING_VERSION,
        "rule": "attention_mask_weighted_mean_excluding_padding",
        "outputDtype": "float32",
        "outputDimension": NATIVE_DIMENSION,
    }:
        raise ValueError("E5 pooling contract mismatch")
    projection_material = manifest.get("projection", {})
    expected_projection = {
        "version": PROJECTION_VERSION,
        "kind": "sklearn_pca_full_svd",
        "inputDimension": NATIVE_DIMENSION,
        "outputDimension": PROJECTION_DIMENSION,
        "meanShape": [NATIVE_DIMENSION],
        "componentsShape": [PROJECTION_DIMENSION, NATIVE_DIMENSION],
        "dtype": "float32",
        "fitSplit": "train",
        "fitRecordCount": 300,
        "svdSolver": "full",
        "whiten": False,
    }
    if not isinstance(projection_material, Mapping) or any(
        projection_material.get(key) != value for key, value in expected_projection.items()
    ):
        raise ValueError("E5 PCA projection contract mismatch")
    if manifest.get("normalization") != {
        "position": "after_projection",
        "kind": "l2",
        "epsilon": L2_EPSILON,
        "degenerate": "invalid_embedding_fail_closed",
    }:
        raise ValueError("E5 output normalization contract mismatch")
    dataset = manifest.get("dataset")
    if not isinstance(dataset, Mapping) or {
        split: dataset.get("splitCounts", {}).get(split, {}).get("records")
        for split in ("train", "calibration", "holdout")
    } != {"train": 300, "calibration": 100, "holdout": 100}:
        raise ValueError("E5 dataset split contract mismatch")
    if manifest.get("output") != {"shape": ["request", PROJECTION_DIMENSION], "dtype": "float32"}:
        raise ValueError("E5 output contract mismatch")
    pca_path = REPO_ROOT / str(projection_material.get("relativePath", ""))
    if not pca_path.is_file() or sha256_file(pca_path) != projection_material.get("fileSha256"):
        raise ValueError("PCA NPZ file hash mismatch")
    projection = PCAProjection.load(pca_path)
    if projection.parameter_hash != projection_material.get("parameterSha256"):
        raise ValueError("PCA parameter hash mismatch")
    return projection


def load_runtime(
    *,
    manifest_path: Path = DEFAULT_MANIFEST_PATH,
    artifact_root: Path = DEFAULT_ARTIFACT_ROOT,
) -> tuple[E5EncoderRuntime, dict[str, Any]]:
    manifest = read_json(manifest_path)
    projection = validate_manifest(manifest, artifact_root=artifact_root, verify_files=True)
    model_directory = artifact_root / manifest["artifactDirectory"]
    runtime = E5EncoderRuntime(
        model_directory,
        model_directory / QINT8_MODEL_PATH,
        projection=projection,
        intra_op_threads=int(manifest["encoder"]["intraOpThreads"]),
        inter_op_threads=int(manifest["encoder"]["interOpThreads"]),
    )
    return runtime, manifest
