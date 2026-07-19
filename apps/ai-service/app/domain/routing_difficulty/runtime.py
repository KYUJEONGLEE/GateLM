from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from app.schemas.routing_difficulty import (
    MODEL_CONTENT_HASH,
    MODEL_VERSION,
    RULE_VECTOR_DIMENSION,
    RULE_VECTOR_VERSION,
)


MANIFEST_SCHEMA = "gatelm.difficulty-e5-encoder-manifest.v2"
ENCODER_BUNDLE_VERSION = (
    "difficulty-e5-encoder-pca64-single-request.2026-07-15.v2"
)
MODEL_ARTIFACT_SCHEMA = "gatelm.difficulty-offline-model-artifact.v1"
MODEL_ARTIFACT_FILE_SHA256 = (
    "c060fd984ca2d5c86e1e84346c9ec7b73dd312f465137e48ef08ead1e2ff8607"
)
MODEL_ID = "intfloat/multilingual-e5-small"
MODEL_SOURCE_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
INPUT_PREFIX = "query: "
MAXIMUM_TOKEN_LENGTH = 128
NATIVE_DIMENSION = 384
PROJECTION_DIMENSION = 64
TOTAL_DIMENSION = RULE_VECTOR_DIMENSION + PROJECTION_DIMENSION
MAXIMUM_MANIFEST_BYTES = 64 * 1024
MAXIMUM_MODEL_ARTIFACT_BYTES = 2 * 1024 * 1024


class RoutingDifficultyRuntimeError(RuntimeError):
    """Sanitized runtime failure that never embeds request-derived material."""


@dataclass(frozen=True)
class RoutingDifficultyPrediction:
    difficulty: str
    calibrated_score: float


@dataclass(frozen=True)
class _ModelMaterial:
    mean: Any
    components: Any
    l2_epsilon: float
    weights: tuple[float, ...]
    bias: float
    platt_coefficient: float
    platt_intercept: float
    threshold: float

    def classify(
        self,
        pooled: Any,
        rule_vector: Sequence[float],
    ) -> RoutingDifficultyPrediction:
        import numpy as np

        pooled_array = np.asarray(pooled, dtype=np.float32)
        if pooled_array.shape != (NATIVE_DIMENSION,) or not np.all(
            np.isfinite(pooled_array)
        ):
            raise RoutingDifficultyRuntimeError("invalid pooled encoder output")
        if len(rule_vector) != RULE_VECTOR_DIMENSION or any(
            not math.isfinite(float(value)) for value in rule_vector
        ):
            raise RoutingDifficultyRuntimeError("invalid rule vector")

        centered = np.asarray(pooled_array - self.mean, dtype=np.float32)
        projection = np.asarray(self.components @ centered, dtype=np.float32)
        if projection.shape != (PROJECTION_DIMENSION,) or not np.all(
            np.isfinite(projection)
        ):
            raise RoutingDifficultyRuntimeError("invalid semantic projection")
        norm_squared = np.sum(projection * projection, dtype=np.float32)
        norm = np.float32(math.sqrt(float(norm_squared)))
        if not np.isfinite(norm) or float(norm) <= self.l2_epsilon:
            raise RoutingDifficultyRuntimeError("degenerate semantic projection")
        projection = np.asarray(projection / norm, dtype=np.float32)

        vector = [float(value) for value in rule_vector]
        vector.extend(float(value) for value in projection)
        logit = self.bias
        for value, weight in zip(vector, self.weights, strict=True):
            logit += value * weight
            if not math.isfinite(logit):
                raise RoutingDifficultyRuntimeError("invalid difficulty score")
        raw_probability = _stable_sigmoid(logit)
        calibrated_score = _stable_sigmoid(
            self.platt_coefficient * raw_probability + self.platt_intercept
        )
        if not math.isfinite(calibrated_score) or not 0 <= calibrated_score <= 1:
            raise RoutingDifficultyRuntimeError("invalid calibrated difficulty score")
        return RoutingDifficultyPrediction(
            difficulty=(
                "complex" if calibrated_score >= self.threshold else "simple"
            ),
            calibrated_score=calibrated_score,
        )


class RoutingDifficultyRuntime:
    def __init__(
        self,
        *,
        artifact_root: Path,
        encoder_manifest_path: Path,
        model_artifact_path: Path,
        intra_op_threads: int,
        inter_op_threads: int,
    ) -> None:
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        manifest = _load_pinned_json(
            encoder_manifest_path,
            maximum_bytes=MAXIMUM_MANIFEST_BYTES,
        )
        if (
            manifest.get("schemaVersion") != MANIFEST_SCHEMA
            or manifest.get("bundleVersion") != ENCODER_BUNDLE_VERSION
            or manifest.get("modelId") != MODEL_ID
            or manifest.get("sourceRevision") != MODEL_SOURCE_REVISION
        ):
            raise RoutingDifficultyRuntimeError("encoder manifest identity mismatch")
        model_directory = artifact_root / str(manifest.get("artifactDirectory", ""))
        runtime_artifacts = manifest.get("runtimeArtifacts")
        if not isinstance(runtime_artifacts, list):
            raise RoutingDifficultyRuntimeError("encoder artifact manifest is invalid")
        _validate_runtime_artifacts(model_directory, runtime_artifacts)

        self._material = _load_model_material(model_artifact_path)
        self._tokenizer = AutoTokenizer.from_pretrained(
            model_directory,
            local_files_only=True,
            trust_remote_code=False,
            use_fast=True,
        )
        self._tokenizer.truncation_side = "right"
        self._tokenizer.padding_side = "right"

        model_path = _runtime_artifact_path(
            model_directory,
            runtime_artifacts,
            "encoder_onnx_dynamic_qint8",
        )
        options = ort.SessionOptions()
        options.intra_op_num_threads = intra_op_threads
        options.inter_op_num_threads = inter_op_threads
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self._session = ort.InferenceSession(
            str(model_path),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self._input_names = {value.name for value in self._session.get_inputs()}
        if not {"input_ids", "attention_mask"}.issubset(self._input_names):
            raise RoutingDifficultyRuntimeError("encoder inputs are incompatible")
        outputs = self._session.get_outputs()
        if len(outputs) != 1 or outputs[0].name != "last_hidden_state":
            raise RoutingDifficultyRuntimeError("encoder output is incompatible")
        self._np = np

    def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingDifficultyPrediction:
        if not isinstance(instruction_text, str) or not instruction_text.strip():
            raise RoutingDifficultyRuntimeError("instruction is not applicable")
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
        if (
            input_ids.ndim != 2
            or input_ids.shape != attention_mask.shape
            or token_type_ids.shape != input_ids.shape
            or input_ids.shape[0] != 1
            or input_ids.shape[1] > MAXIMUM_TOKEN_LENGTH
        ):
            raise RoutingDifficultyRuntimeError("tokenizer output is incompatible")
        inputs = {
            name: {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "token_type_ids": token_type_ids,
            }[name]
            for name in self._input_names
        }
        hidden = self._session.run(["last_hidden_state"], inputs)[0]
        pooled = _masked_mean(hidden, attention_mask)[0]
        return self._material.classify(pooled, rule_vector)

    def warmup(self) -> None:
        rule_vector = [0.0] * RULE_VECTOR_DIMENSION
        rule_vector[1] = 1.0
        rule_vector[4] = 0.2
        rule_vector[8] = 1.0
        rule_vector[13] = 0.2
        self.classify("explain one bounded workflow step.", rule_vector)


def _masked_mean(last_hidden_state: Any, attention_mask: Any) -> Any:
    import numpy as np

    hidden = np.asarray(last_hidden_state, dtype=np.float32)
    mask = np.asarray(attention_mask, dtype=np.float32)
    if (
        hidden.ndim != 3
        or mask.ndim != 2
        or hidden.shape[:2] != mask.shape
        or hidden.shape[2] != NATIVE_DIMENSION
    ):
        raise RoutingDifficultyRuntimeError("encoder output shape is incompatible")
    denominator = np.sum(mask, axis=1, keepdims=True, dtype=np.float32)
    if np.any(denominator <= 0):
        raise RoutingDifficultyRuntimeError("encoder attention mask is empty")
    pooled = np.sum(
        hidden * mask[:, :, None], axis=1, dtype=np.float32
    ) / denominator
    if not np.all(np.isfinite(pooled)):
        raise RoutingDifficultyRuntimeError("encoder pooled output is invalid")
    return np.asarray(pooled, dtype=np.float32)


def _load_model_material(path: Path) -> _ModelMaterial:
    import numpy as np

    artifact = _load_pinned_json(
        path,
        maximum_bytes=MAXIMUM_MODEL_ARTIFACT_BYTES,
        expected_sha256=MODEL_ARTIFACT_FILE_SHA256,
    )
    projection = artifact.get("projectionParameters")
    calibrator = artifact.get("calibrator")
    if (
        artifact.get("schemaVersion") != MODEL_ARTIFACT_SCHEMA
        or artifact.get("artifactVersion") != MODEL_VERSION
        or artifact.get("ruleVectorVersion") != RULE_VECTOR_VERSION
        or artifact.get("totalDimension") != TOTAL_DIMENSION
        or artifact.get("contentHash") != MODEL_CONTENT_HASH
        or artifact.get("thresholdEquality") != "greater_than_or_equal"
        or not isinstance(projection, dict)
        or not isinstance(calibrator, dict)
        or calibrator.get("type") != "platt"
        or calibrator.get("input") != "raw_probability"
    ):
        raise RoutingDifficultyRuntimeError("difficulty model identity mismatch")
    mean = np.asarray(projection.get("mean"), dtype=np.float32)
    components = np.asarray(projection.get("components"), dtype=np.float32)
    weights = tuple(float(value) for value in artifact.get("weights", ()))
    numeric = (
        float(projection.get("l2Epsilon", math.nan)),
        float(artifact.get("bias", math.nan)),
        float(calibrator.get("coefficient", math.nan)),
        float(calibrator.get("intercept", math.nan)),
        float(artifact.get("threshold", math.nan)),
    )
    if (
        mean.shape != (NATIVE_DIMENSION,)
        or components.shape != (PROJECTION_DIMENSION, NATIVE_DIMENSION)
        or len(weights) != TOTAL_DIMENSION
        or not np.all(np.isfinite(mean))
        or not np.all(np.isfinite(components))
        or any(not math.isfinite(value) for value in (*weights, *numeric))
        or numeric[0] <= 0
        or not 0 <= numeric[4] <= 1
    ):
        raise RoutingDifficultyRuntimeError("difficulty model material is invalid")
    return _ModelMaterial(
        mean=mean,
        components=components,
        l2_epsilon=numeric[0],
        weights=weights,
        bias=numeric[1],
        platt_coefficient=numeric[2],
        platt_intercept=numeric[3],
        threshold=numeric[4],
    )


def _validate_runtime_artifacts(
    model_directory: Path,
    entries: list[object],
) -> None:
    required_roles = {
        "model_config",
        "sentence_transformer_config",
        "pooling_config",
        "special_tokens",
        "tokenizer_json",
        "tokenizer_config",
        "tokenizer_model",
        "encoder_onnx_dynamic_qint8",
    }
    seen: set[str] = set()
    for raw_entry in entries:
        if not isinstance(raw_entry, dict):
            raise RoutingDifficultyRuntimeError("encoder artifact entry is invalid")
        role = str(raw_entry.get("role", ""))
        if role not in required_roles or role in seen:
            raise RoutingDifficultyRuntimeError("encoder artifact roles are invalid")
        seen.add(role)
        path = _safe_artifact_path(model_directory, str(raw_entry.get("relativePath", "")))
        expected_size = raw_entry.get("sizeBytes")
        expected_sha = str(raw_entry.get("sha256", ""))
        if (
            not path.is_file()
            or not isinstance(expected_size, int)
            or path.stat().st_size != expected_size
            or _sha256_file(path) != expected_sha
        ):
            raise RoutingDifficultyRuntimeError("encoder artifact integrity mismatch")
    if seen != required_roles:
        raise RoutingDifficultyRuntimeError("encoder artifacts are incomplete")


def _runtime_artifact_path(
    model_directory: Path,
    entries: list[object],
    role: str,
) -> Path:
    for raw_entry in entries:
        if isinstance(raw_entry, dict) and raw_entry.get("role") == role:
            return _safe_artifact_path(
                model_directory,
                str(raw_entry.get("relativePath", "")),
            )
    raise RoutingDifficultyRuntimeError("encoder artifact role is missing")


def _safe_artifact_path(root: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts or not relative:
        raise RoutingDifficultyRuntimeError("encoder artifact path is invalid")
    resolved_root = root.resolve(strict=False)
    resolved_path = (root / relative_path).resolve(strict=False)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise RoutingDifficultyRuntimeError("encoder artifact path escapes root") from exc
    return resolved_path


def _load_pinned_json(
    path: Path,
    *,
    maximum_bytes: int,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    try:
        size = path.stat().st_size
        if size <= 0 or size > maximum_bytes or not path.is_file():
            raise RoutingDifficultyRuntimeError("pinned JSON artifact size is invalid")
        payload = path.read_bytes()
    except OSError as exc:
        raise RoutingDifficultyRuntimeError("pinned JSON artifact is unavailable") from exc
    if expected_sha256 is not None and hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise RoutingDifficultyRuntimeError("pinned JSON artifact hash mismatch")
    try:
        decoded = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RoutingDifficultyRuntimeError("pinned JSON artifact is invalid") from exc
    if not isinstance(decoded, dict):
        raise RoutingDifficultyRuntimeError("pinned JSON artifact root is invalid")
    return decoded


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _stable_sigmoid(value: float) -> float:
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    exponential = math.exp(value)
    return exponential / (1 + exponential)
