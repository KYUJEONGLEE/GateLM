from __future__ import annotations

import socket
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from .encoder_artifacts import canonical_json_bytes, sha256_bytes


L2_EPSILON = 1e-12
PROJECTION_MAGIC = b"GATELM_DIFFICULTY_PCA_V1\n"


def install_network_guard() -> None:
    """Deny outbound socket connects for the offline inference phase."""

    def denied(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("network access disabled for semantic encoder benchmark")

    socket.socket.connect = denied  # type: ignore[method-assign]
    socket.socket.connect_ex = denied  # type: ignore[method-assign]
    socket.create_connection = denied  # type: ignore[assignment]


@dataclass(frozen=True)
class TokenizedInput:
    input_ids: tuple[int, ...]
    attention_mask: tuple[int, ...]
    token_type_ids: tuple[int, ...]
    content_token_count: int
    truncated: bool


class HeadTailTokenizer:
    def __init__(self, tokenizer: Any, maximum_length: int = 128) -> None:
        self.tokenizer = tokenizer
        self.maximum_length = maximum_length
        self.special_token_budget = int(tokenizer.num_special_tokens_to_add(pair=False))
        if self.maximum_length != 128 or self.special_token_budget != 2:
            raise ValueError("v1 tokenizer contract requires 128 total tokens and exactly two special tokens")
        self.usable_tokens = self.maximum_length - self.special_token_budget
        self.head_tokens = (self.usable_tokens + 1) // 2
        self.tail_tokens = self.usable_tokens // 2

    def content_ids(self, text: str) -> tuple[int, ...]:
        if not text.strip():
            return ()
        ids = self.tokenizer.encode(
            text,
            add_special_tokens=False,
            truncation=False,
            padding=False,
        )
        return tuple(int(value) for value in ids)

    def tokenize(self, text: str) -> TokenizedInput | None:
        content = self.content_ids(text)
        if not content:
            return None
        truncated = len(content) > self.usable_tokens
        bounded = content
        if truncated:
            bounded = content[: self.head_tokens] + content[-self.tail_tokens :]
        input_ids = tuple(
            int(value) for value in self.tokenizer.build_inputs_with_special_tokens(list(bounded))
        )
        if len(input_ids) > self.maximum_length or len(input_ids) != len(bounded) + 2:
            raise ValueError("tokenizer special token construction violated the fixed v1 budget")
        token_types = tuple(
            int(value)
            for value in self.tokenizer.create_token_type_ids_from_sequences(list(bounded))
        )
        if len(token_types) != len(input_ids):
            token_types = (0,) * len(input_ids)
        return TokenizedInput(
            input_ids=input_ids,
            attention_mask=(1,) * len(input_ids),
            token_type_ids=token_types,
            content_token_count=len(content),
            truncated=truncated,
        )


def masked_mean(hidden_states: Any, attention_mask: Any) -> Any:
    import numpy as np

    hidden = np.asarray(hidden_states, dtype=np.float32)
    mask = np.asarray(attention_mask, dtype=np.float32)
    if hidden.ndim == 2:
        hidden = hidden[None, :, :]
    if mask.ndim == 1:
        mask = mask[None, :]
    if hidden.ndim != 3 or mask.ndim != 2 or hidden.shape[:2] != mask.shape:
        raise ValueError("pooling requires aligned [batch, sequence, hidden] and [batch, sequence] arrays")
    denominator = mask.sum(axis=1, keepdims=True)
    pooled = (hidden * mask[:, :, None]).sum(axis=1)
    valid = denominator[:, 0] > 0
    result = np.zeros((hidden.shape[0], hidden.shape[2]), dtype=np.float32)
    if np.any(valid):
        result[valid] = pooled[valid] / denominator[valid]
    return result


def l2_normalize(values: Any, epsilon: float = L2_EPSILON) -> Any:
    import numpy as np

    array = np.asarray(values, dtype=np.float32)
    if array.ndim == 1:
        array = array[None, :]
    if array.ndim != 2 or not np.all(np.isfinite(array)):
        raise ValueError("L2 normalization requires a finite two-dimensional array")
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    result = np.zeros_like(array, dtype=np.float32)
    valid = norms[:, 0] > epsilon
    if np.any(valid):
        result[valid] = array[valid] / norms[valid]
    return result


@dataclass(frozen=True)
class ProjectionArtifact:
    version: str
    input_dimension: int
    output_dimension: int
    mean: Any | None
    components: Any | None

    @property
    def kind(self) -> str:
        return "identity" if self.components is None else "pca_full_svd"

    def transform(self, values: Any) -> Any:
        import numpy as np

        array = np.asarray(values, dtype=np.float32)
        if array.ndim == 1:
            array = array[None, :]
        if array.ndim != 2 or array.shape[1] != self.input_dimension:
            raise ValueError("projection input dimension does not match its artifact")
        if self.components is None:
            projected = array
        else:
            mean = np.asarray(self.mean, dtype=np.float32)
            components = np.asarray(self.components, dtype=np.float32)
            if mean.shape != (self.input_dimension,) or components.shape != (
                self.output_dimension,
                self.input_dimension,
            ):
                raise ValueError("projection artifact shape does not match its declared dimensions")
            projected = (array - mean) @ components.T
        return l2_normalize(projected)

    def serialize(self) -> bytes:
        import numpy as np

        header = {
            "schemaVersion": "gatelm.difficulty-pca-projection-artifact.v1",
            "version": self.version,
            "kind": self.kind,
            "inputDimension": self.input_dimension,
            "outputDimension": self.output_dimension,
            "dtype": "float32_le",
            "fitSplit": "train",
            "randomSeed": 20260714,
            "whiten": False,
            "l2Position": "after_projection",
            "l2Epsilon": L2_EPSILON,
        }
        header_bytes = canonical_json_bytes(header)
        payload = b""
        if self.components is not None:
            mean = np.asarray(self.mean, dtype="<f4")
            components = np.asarray(self.components, dtype="<f4")
            payload = mean.tobytes(order="C") + components.tobytes(order="C")
        return PROJECTION_MAGIC + struct.pack(">Q", len(header_bytes)) + header_bytes + payload

    @property
    def sha256(self) -> str:
        return sha256_bytes(self.serialize())


def fit_projection(train_values: Any, output_dimension: int) -> ProjectionArtifact:
    import numpy as np

    train = np.asarray(train_values, dtype=np.float32)
    if train.ndim != 2 or not np.all(np.isfinite(train)):
        raise ValueError("projection fitting requires a finite two-dimensional training matrix")
    native = int(train.shape[1])
    if output_dimension <= 0 or output_dimension > native:
        raise ValueError("projection output dimension must be positive and no larger than native")
    if output_dimension == native:
        return ProjectionArtifact(
            version="difficulty-projection.identity.v1",
            input_dimension=native,
            output_dimension=native,
            mean=None,
            components=None,
        )
    if output_dimension > train.shape[0]:
        raise ValueError("PCA output dimension cannot exceed the number of training samples")
    from sklearn.decomposition import PCA

    pca = PCA(n_components=output_dimension, svd_solver="full", whiten=False)
    pca.fit(train)
    return ProjectionArtifact(
        version="difficulty-projection.pca-full-svd.v1",
        input_dimension=native,
        output_dimension=output_dimension,
        mean=np.asarray(pca.mean_, dtype=np.float32),
        components=np.asarray(pca.components_, dtype=np.float32),
    )


class LocalEncoderRuntime:
    def __init__(
        self,
        candidate: dict[str, Any],
        directory: Path,
        model_path: Path,
        intra_op_threads: int,
        inter_op_threads: int,
    ) -> None:
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.candidate = candidate
        self.directory = directory
        self.native_dimension = int(candidate["nativeDimension"])
        tokenizer = AutoTokenizer.from_pretrained(
            directory,
            local_files_only=True,
            trust_remote_code=False,
            use_fast=True,
        )
        self.tokenizer = HeadTailTokenizer(tokenizer, maximum_length=128)
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
        self.input_names = {item.name for item in self.session.get_inputs()}
        self.dense_weight: Any | None = None
        self.dense_bias: Any | None = None
        dense = candidate.get("dense")
        if dense is not None:
            from safetensors.numpy import load_file

            tensors = load_file(str(directory / dense["weightsPath"]))
            weight_keys = [key for key in tensors if key.endswith("weight")]
            bias_keys = [key for key in tensors if key.endswith("bias")]
            if len(weight_keys) != 1 or len(bias_keys) != 1:
                raise ValueError("dense safetensors artifact must contain exactly one weight and bias")
            self.dense_weight = np.asarray(tensors[weight_keys[0]], dtype=np.float32)
            self.dense_bias = np.asarray(tensors[bias_keys[0]], dtype=np.float32)
            expected = (int(dense["outputDimension"]), int(dense["inputDimension"]))
            if self.dense_weight.shape != expected or self.dense_bias.shape != (expected[0],):
                raise ValueError("dense safetensors shape does not match candidate config")

    def content_token_count(self, text: str) -> int:
        return len(self.tokenizer.content_ids(text))

    def encode_raw(self, text: str) -> Any:
        import numpy as np

        tokenized = self.tokenizer.tokenize(text)
        if tokenized is None:
            return np.zeros((self.native_dimension,), dtype=np.float32)
        inputs: dict[str, Any] = {}
        if "input_ids" in self.input_names:
            inputs["input_ids"] = np.asarray([tokenized.input_ids], dtype=np.int64)
        if "attention_mask" in self.input_names:
            inputs["attention_mask"] = np.asarray([tokenized.attention_mask], dtype=np.int64)
        if "token_type_ids" in self.input_names:
            inputs["token_type_ids"] = np.asarray([tokenized.token_type_ids], dtype=np.int64)
        outputs = self.session.run(None, inputs)
        sequence = next((value for value in outputs if getattr(value, "ndim", 0) == 3), None)
        if sequence is None:
            raise ValueError("ONNX encoder did not return a sequence hidden-state output")
        pooled = masked_mean(sequence, np.asarray([tokenized.attention_mask], dtype=np.float32))[0]
        if self.dense_weight is not None:
            pooled = np.tanh(pooled @ self.dense_weight.T + self.dense_bias).astype(np.float32)
        pooled = np.asarray(pooled, dtype=np.float32)
        if pooled.shape != (self.native_dimension,) or not np.all(np.isfinite(pooled)):
            raise ValueError("encoder output shape or numeric material is invalid")
        return pooled

    def encode(self, text: str, projection: ProjectionArtifact) -> Any:
        return projection.transform(self.encode_raw(text))[0]


def latency_bucket_texts(runtime: LocalEncoderRuntime) -> list[tuple[str, str, int, bool]]:
    targets = (
        ("short", 8),
        ("medium", 48),
        ("near_max", 120),
        ("over_max_head_tail_truncated", 190),
    )
    seed = "Review the requirement and summarize the next step. 요구사항을 확인하고 다음 단계를 요약하세요. "
    result: list[tuple[str, str, int, bool]] = []
    for name, target in targets:
        text = seed
        while runtime.content_token_count(text) < target:
            text += seed
        tokenized = runtime.tokenizer.tokenize(text)
        if tokenized is None:
            raise ValueError("latency corpus unexpectedly produced an empty semantic input")
        result.append((name, text, tokenized.content_token_count, tokenized.truncated))
    return result

