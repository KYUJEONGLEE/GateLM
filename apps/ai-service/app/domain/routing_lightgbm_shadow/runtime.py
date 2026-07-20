from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from app.schemas.routing_difficulty import (
    RULE_VECTOR_DIMENSION,
    RULE_VECTOR_FEATURE_NAMES,
    RULE_VECTOR_VERSION,
)
from app.schemas.routing_lightgbm_shadow import CONTRACT_VERSION


MANIFEST_SCHEMA = "gatelm.routing-difficulty-lightgbm-shadow-profile.v1"
PROFILE_VERSION = "difficulty-lightgbm-shadow.e5-base-768.v1"
MODEL_ID = "intfloat/multilingual-e5-base"
MODEL_SOURCE_REVISION = "d13f1b27baf31030b7fd040960d60d909913633f"
NATIVE_DIMENSION = 768
ALLOWED_SEMANTIC_DIMENSIONS = frozenset({128, 256, 768})
ALLOWED_SEMANTIC_MODES = frozenset({"raw", "pca"})
MAXIMUM_MANIFEST_BYTES = 128 * 1024
MAXIMUM_PROJECTION_BYTES = 8 * 1024 * 1024
MAXIMUM_MODEL_BYTES = 64 * 1024 * 1024


class RoutingLightGBMShadowRuntimeError(RuntimeError):
    """Sanitized failure that never includes request-derived material."""


@dataclass(frozen=True)
class RoutingLightGBMShadowIdentity:
    profile_version: str
    model_version: str
    model_content_hash: str
    semantic_mode: str
    semantic_dimension: int
    total_dimension: int


@dataclass(frozen=True)
class RoutingLightGBMShadowPrediction:
    difficulty: str
    score: float


@dataclass(frozen=True)
class _Projection:
    mean: Any
    components: Any
    l2_epsilon: float

    def apply(self, pooled: Any) -> Any:
        import numpy as np

        centered = np.asarray(pooled - self.mean, dtype=np.float32)
        projected = np.asarray(centered @ self.components.T, dtype=np.float32)
        if projected.ndim != 2 or projected.shape[1] != self.components.shape[0]:
            raise RoutingLightGBMShadowRuntimeError("projection output is invalid")
        if not np.all(np.isfinite(projected)):
            raise RoutingLightGBMShadowRuntimeError("projection output is non-finite")
        norm = np.linalg.norm(projected, axis=1, keepdims=True)
        if not np.all(np.isfinite(norm)) or np.any(norm <= self.l2_epsilon):
            raise RoutingLightGBMShadowRuntimeError("projection norm is invalid")
        return np.asarray(projected / norm, dtype=np.float32)


@dataclass(frozen=True)
class _ModelMaterial:
    booster: Any
    threshold: float
    semantic_mode: str
    semantic_dimension: int
    total_dimension: int
    projection: _Projection | None

    def classify_many(
        self,
        pooled: Any,
        rule_vectors: Sequence[Sequence[float]],
    ) -> list[RoutingLightGBMShadowPrediction]:
        import numpy as np

        pooled_array = np.asarray(pooled, dtype=np.float32)
        if (
            pooled_array.ndim != 2
            or pooled_array.shape != (len(rule_vectors), NATIVE_DIMENSION)
            or not np.all(np.isfinite(pooled_array))
        ):
            raise RoutingLightGBMShadowRuntimeError("pooled encoder output is invalid")
        rules = np.asarray(rule_vectors, dtype=np.float64)
        if (
            rules.shape != (len(rule_vectors), RULE_VECTOR_DIMENSION)
            or not np.all(np.isfinite(rules))
            or np.any(rules < 0)
            or np.any(rules > 1)
        ):
            raise RoutingLightGBMShadowRuntimeError("rule vector is invalid")

        semantic = pooled_array
        if self.semantic_mode == "pca":
            if self.projection is None:
                raise RoutingLightGBMShadowRuntimeError("projection material is missing")
            semantic = self.projection.apply(pooled_array)
        if semantic.shape != (len(rule_vectors), self.semantic_dimension):
            raise RoutingLightGBMShadowRuntimeError("semantic feature shape is invalid")
        combined = np.concatenate(
            (rules, np.asarray(semantic, dtype=np.float64)), axis=1
        )
        if combined.shape != (len(rule_vectors), self.total_dimension):
            raise RoutingLightGBMShadowRuntimeError("combined feature shape is invalid")
        scores = np.asarray(
            self.booster.predict(
                combined,
                raw_score=False,
                pred_leaf=False,
                pred_contrib=False,
            ),
            dtype=np.float64,
        )
        if scores.shape != (len(rule_vectors),) or not np.all(np.isfinite(scores)):
            raise RoutingLightGBMShadowRuntimeError("LightGBM output is invalid")
        if np.any(scores < 0) or np.any(scores > 1):
            raise RoutingLightGBMShadowRuntimeError("LightGBM probability is invalid")
        return [
            RoutingLightGBMShadowPrediction(
                difficulty="complex" if float(score) >= self.threshold else "simple",
                score=float(score),
            )
            for score in scores
        ]


class RoutingLightGBMShadowRuntime:
    def __init__(
        self,
        *,
        artifact_root: Path,
        profile_manifest_path: Path,
        profile_manifest_sha256: str,
        intra_op_threads: int,
        inter_op_threads: int,
    ) -> None:
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        manifest = _load_pinned_json(
            profile_manifest_path,
            maximum_bytes=MAXIMUM_MANIFEST_BYTES,
            expected_sha256=_bare_sha256(profile_manifest_sha256),
        )
        identity, encoder, feature_shape, model = _validate_manifest(manifest)
        model_directory = _safe_artifact_path(
            artifact_root, str(encoder["artifactDirectory"])
        )
        runtime_artifacts = encoder["runtimeArtifacts"]
        _validate_runtime_artifacts(model_directory, runtime_artifacts)

        self._identity = identity
        self._material = _load_model_material(
            artifact_root,
            feature_shape,
            model,
        )
        self._input_prefix = str(encoder["inputPrefix"])
        self._maximum_token_length = int(encoder["maximumTokenLength"])
        self._tokenizer = AutoTokenizer.from_pretrained(
            model_directory,
            revision=MODEL_SOURCE_REVISION,
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
            raise RoutingLightGBMShadowRuntimeError("encoder inputs are incompatible")
        outputs = self._session.get_outputs()
        if len(outputs) != 1 or outputs[0].name != "last_hidden_state":
            raise RoutingLightGBMShadowRuntimeError("encoder output is incompatible")
        self._np = np

    @property
    def identity(self) -> RoutingLightGBMShadowIdentity:
        return self._identity

    def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingLightGBMShadowPrediction:
        return self.classify_many([instruction_text], [rule_vector])[0]

    def classify_many(
        self,
        instruction_texts: Sequence[str],
        rule_vectors: Sequence[Sequence[float]],
    ) -> list[RoutingLightGBMShadowPrediction]:
        if (
            isinstance(instruction_texts, (str, bytes))
            or not instruction_texts
            or len(instruction_texts) != len(rule_vectors)
        ):
            raise RoutingLightGBMShadowRuntimeError("shadow batch shape is invalid")
        if any(
            not isinstance(instruction_text, str) or not instruction_text.strip()
            for instruction_text in instruction_texts
        ):
            raise RoutingLightGBMShadowRuntimeError("instruction is not applicable")
        encoded = self._tokenizer(
            [self._input_prefix + value for value in instruction_texts],
            add_special_tokens=True,
            padding=True,
            truncation=True,
            max_length=self._maximum_token_length,
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
            or input_ids.shape[0] != len(instruction_texts)
            or input_ids.shape[1] > self._maximum_token_length
        ):
            raise RoutingLightGBMShadowRuntimeError("tokenizer output is incompatible")
        inputs = {
            name: {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "token_type_ids": token_type_ids,
            }[name]
            for name in self._input_names
        }
        hidden = self._session.run(["last_hidden_state"], inputs)[0]
        pooled = _masked_mean(hidden, attention_mask)
        return self._material.classify_many(pooled, rule_vectors)

    def warmup(self) -> None:
        vector = [0.0] * RULE_VECTOR_DIMENSION
        vector[1] = 1.0
        vector[8] = 1.0
        self.classify("explain one bounded workflow step.", vector)


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
        raise RoutingLightGBMShadowRuntimeError("encoder output shape is incompatible")
    denominator = np.sum(mask, axis=1, keepdims=True, dtype=np.float32)
    if np.any(denominator <= 0):
        raise RoutingLightGBMShadowRuntimeError("encoder attention mask is empty")
    pooled = np.sum(hidden * mask[:, :, None], axis=1, dtype=np.float32) / denominator
    if not np.all(np.isfinite(pooled)):
        raise RoutingLightGBMShadowRuntimeError("encoder pooled output is invalid")
    return np.asarray(pooled, dtype=np.float32)


def _validate_manifest(
    manifest: dict[str, Any],
) -> tuple[
    RoutingLightGBMShadowIdentity,
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
]:
    encoder = manifest.get("encoder")
    feature_shape = manifest.get("featureShape")
    model = manifest.get("model")
    execution = manifest.get("executionShape")
    training = manifest.get("trainingProvenance")
    split_counts = training.get("splitCounts") if isinstance(training, dict) else None
    if (
        manifest.get("schemaVersion") != MANIFEST_SCHEMA
        or manifest.get("profileVersion") != PROFILE_VERSION
        or manifest.get("contractVersion") != CONTRACT_VERSION
        or manifest.get("promotionState") != "offline_shadow_only"
        or not isinstance(encoder, dict)
        or not isinstance(feature_shape, dict)
        or not isinstance(model, dict)
        or not isinstance(execution, dict)
        or not isinstance(training, dict)
        or execution.get("unit") != "single_request"
        or execution.get("batchSize") != 1
        or execution.get("paddingScope") != "within_request_only"
        or not isinstance(training.get("datasetVersion"), str)
        or not _valid_prefixed_sha256(str(training.get("datasetSha256", "")))
        or not isinstance(training.get("splitPolicyVersion"), str)
        or training.get("familyDisjoint") is not True
        or training.get("selectionSplit") != "validation"
        or training.get("testAccess") != "after_selection_freeze"
        or training.get("seed") != 20260721
        or training.get("selectedFrom")
        != ["tabular_only", "raw_768", "pca_128", "pca_256"]
        or not isinstance(split_counts, dict)
        or not isinstance(split_counts.get("train"), int)
        or split_counts["train"] < 256
        or not isinstance(split_counts.get("validation"), int)
        or split_counts["validation"] < 1
        or not isinstance(split_counts.get("test"), int)
        or split_counts["test"] < 1
    ):
        raise RoutingLightGBMShadowRuntimeError("profile manifest identity mismatch")
    runtime_artifacts = encoder.get("runtimeArtifacts")
    if (
        encoder.get("modelId") != MODEL_ID
        or encoder.get("sourceRevision") != MODEL_SOURCE_REVISION
        or encoder.get("outputDimension") != NATIVE_DIMENSION
        or encoder.get("pooling") != "attention_mask_weighted_mean_excluding_padding"
        or encoder.get("inputPrefix") != "query: "
        or not isinstance(encoder.get("maximumTokenLength"), int)
        or not 1 <= int(encoder["maximumTokenLength"]) <= 512
        or not isinstance(encoder.get("artifactDirectory"), str)
        or not isinstance(runtime_artifacts, list)
    ):
        raise RoutingLightGBMShadowRuntimeError("encoder profile is invalid")
    semantic_mode = str(feature_shape.get("semanticMode", ""))
    semantic_dimension = feature_shape.get("semanticDimension")
    total_dimension = feature_shape.get("totalDimension")
    feature_names = feature_shape.get("tabularFeatureNames")
    projection_descriptor = feature_shape.get("projection")
    if (
        feature_shape.get("ruleVectorVersion") != RULE_VECTOR_VERSION
        or feature_shape.get("ruleDimension") != RULE_VECTOR_DIMENSION
        or semantic_mode not in ALLOWED_SEMANTIC_MODES
        or semantic_dimension not in ALLOWED_SEMANTIC_DIMENSIONS
        or semantic_mode == "raw" and semantic_dimension != NATIVE_DIMENSION
        or semantic_mode == "pca" and semantic_dimension not in {128, 256}
        or total_dimension != RULE_VECTOR_DIMENSION + int(semantic_dimension or 0)
        or feature_names
        != [f"ruleVectorV1.{name}" for name in RULE_VECTOR_FEATURE_NAMES]
    ):
        raise RoutingLightGBMShadowRuntimeError("feature shape is invalid")
    if semantic_mode == "raw" and projection_descriptor is not None:
        raise RoutingLightGBMShadowRuntimeError("raw semantic mode has projection")
    if semantic_mode == "pca" and (
        not isinstance(projection_descriptor, dict)
        or projection_descriptor.get("fitSplit") != "train"
        or projection_descriptor.get("fitRecordCount") != split_counts["train"]
    ):
        raise RoutingLightGBMShadowRuntimeError("projection provenance is invalid")
    model_version = str(model.get("version", ""))
    content_hash = str(model.get("contentHash", ""))
    if (
        not _valid_model_version(model_version)
        or model.get("format") != "lightgbm_text"
        or model.get("objective") != "binary"
        or model.get("numFeatures") != total_dimension
        or not isinstance(model.get("threshold"), (int, float))
        or not 0 <= float(model["threshold"]) <= 1
        or not _valid_prefixed_sha256(content_hash)
        or content_hash != f"sha256:{model.get('sha256', '')}"
    ):
        raise RoutingLightGBMShadowRuntimeError("LightGBM model identity is invalid")
    return (
        RoutingLightGBMShadowIdentity(
            profile_version=PROFILE_VERSION,
            model_version=model_version,
            model_content_hash=content_hash,
            semantic_mode=semantic_mode,
            semantic_dimension=int(semantic_dimension),
            total_dimension=int(total_dimension),
        ),
        encoder,
        feature_shape,
        model,
    )


def _load_model_material(
    artifact_root: Path,
    feature_shape: dict[str, Any],
    model: dict[str, Any],
) -> _ModelMaterial:
    import lightgbm as lgb

    semantic_mode = str(feature_shape["semanticMode"])
    semantic_dimension = int(feature_shape["semanticDimension"])
    total_dimension = int(feature_shape["totalDimension"])
    model_path = _validate_file_entry(
        artifact_root,
        model,
        maximum_bytes=MAXIMUM_MODEL_BYTES,
    )
    try:
        booster = lgb.Booster(model_file=str(model_path))
    except Exception as exc:
        raise RoutingLightGBMShadowRuntimeError("LightGBM model is invalid") from exc
    if booster.num_feature() != total_dimension:
        raise RoutingLightGBMShadowRuntimeError("LightGBM feature dimension mismatch")

    projection = None
    if semantic_mode == "pca":
        raw_projection = feature_shape.get("projection")
        if not isinstance(raw_projection, dict):
            raise RoutingLightGBMShadowRuntimeError("projection descriptor is missing")
        projection = _load_projection(
            artifact_root,
            raw_projection,
            semantic_dimension,
        )
    elif feature_shape.get("projection") is not None:
        raise RoutingLightGBMShadowRuntimeError("raw semantic mode has projection")
    return _ModelMaterial(
        booster=booster,
        threshold=float(model["threshold"]),
        semantic_mode=semantic_mode,
        semantic_dimension=semantic_dimension,
        total_dimension=total_dimension,
        projection=projection,
    )


def _load_projection(
    artifact_root: Path,
    descriptor: dict[str, Any],
    output_dimension: int,
) -> _Projection:
    import numpy as np

    if (
        descriptor.get("kind") != "sklearn_pca_full_svd"
        or descriptor.get("inputDimension") != NATIVE_DIMENSION
        or descriptor.get("outputDimension") != output_dimension
        or descriptor.get("fitSplit") != "train"
        or not isinstance(descriptor.get("fitRecordCount"), int)
        or descriptor["fitRecordCount"] < 256
        or descriptor.get("l2Normalize") is not True
        or not isinstance(descriptor.get("l2Epsilon"), (int, float))
        or float(descriptor["l2Epsilon"]) <= 0
    ):
        raise RoutingLightGBMShadowRuntimeError("projection identity is invalid")
    path = _validate_file_entry(
        artifact_root,
        descriptor,
        maximum_bytes=MAXIMUM_PROJECTION_BYTES,
    )
    try:
        with np.load(path, allow_pickle=False) as payload:
            if set(payload.files) != {"mean", "components"}:
                raise RoutingLightGBMShadowRuntimeError("projection fields are invalid")
            mean = np.asarray(payload["mean"], dtype=np.float32)
            components = np.asarray(payload["components"], dtype=np.float32)
    except (OSError, ValueError) as exc:
        raise RoutingLightGBMShadowRuntimeError("projection artifact is invalid") from exc
    if (
        mean.shape != (NATIVE_DIMENSION,)
        or components.shape != (output_dimension, NATIVE_DIMENSION)
        or not np.all(np.isfinite(mean))
        or not np.all(np.isfinite(components))
    ):
        raise RoutingLightGBMShadowRuntimeError("projection material is invalid")
    return _Projection(
        mean=mean,
        components=components,
        l2_epsilon=float(descriptor["l2Epsilon"]),
    )


def _validate_runtime_artifacts(root: Path, entries: list[object]) -> None:
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
            raise RoutingLightGBMShadowRuntimeError("encoder artifact entry is invalid")
        role = str(raw_entry.get("role", ""))
        if role not in required_roles or role in seen:
            raise RoutingLightGBMShadowRuntimeError("encoder artifact roles are invalid")
        seen.add(role)
        _validate_file_entry(root, raw_entry, maximum_bytes=2 * 1024 * 1024 * 1024)
    if seen != required_roles:
        raise RoutingLightGBMShadowRuntimeError("encoder artifacts are incomplete")


def _runtime_artifact_path(root: Path, entries: list[object], role: str) -> Path:
    for entry in entries:
        if isinstance(entry, dict) and entry.get("role") == role:
            return _safe_artifact_path(root, str(entry.get("relativePath", "")))
    raise RoutingLightGBMShadowRuntimeError("encoder artifact role is missing")


def _validate_file_entry(
    root: Path,
    entry: dict[str, Any],
    *,
    maximum_bytes: int,
) -> Path:
    path = _safe_artifact_path(root, str(entry.get("relativePath", "")))
    expected_size = entry.get("sizeBytes")
    expected_sha = str(entry.get("sha256", ""))
    if (
        not path.is_file()
        or not isinstance(expected_size, int)
        or expected_size <= 0
        or expected_size > maximum_bytes
        or path.stat().st_size != expected_size
        or not _valid_bare_sha256(expected_sha)
        or _sha256_file(path) != expected_sha
    ):
        raise RoutingLightGBMShadowRuntimeError("artifact integrity mismatch")
    return path


def _safe_artifact_path(root: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts or not relative:
        raise RoutingLightGBMShadowRuntimeError("artifact path is invalid")
    resolved_root = root.resolve(strict=False)
    resolved_path = (root / relative_path).resolve(strict=False)
    try:
        resolved_path.relative_to(resolved_root)
    except ValueError as exc:
        raise RoutingLightGBMShadowRuntimeError("artifact path escapes root") from exc
    return resolved_path


def _load_pinned_json(
    path: Path,
    *,
    maximum_bytes: int,
    expected_sha256: str,
) -> dict[str, Any]:
    try:
        size = path.stat().st_size
        if size <= 0 or size > maximum_bytes or not path.is_file():
            raise RoutingLightGBMShadowRuntimeError("manifest size is invalid")
        payload = path.read_bytes()
    except OSError as exc:
        raise RoutingLightGBMShadowRuntimeError("manifest is unavailable") from exc
    if hashlib.sha256(payload).hexdigest() != expected_sha256:
        raise RoutingLightGBMShadowRuntimeError("manifest hash mismatch")
    try:
        decoded = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RoutingLightGBMShadowRuntimeError("manifest is invalid") from exc
    if not isinstance(decoded, dict):
        raise RoutingLightGBMShadowRuntimeError("manifest root is invalid")
    return decoded


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _valid_bare_sha256(value: str) -> bool:
    return len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def _valid_prefixed_sha256(value: str) -> bool:
    return value.startswith("sha256:") and _valid_bare_sha256(value[7:])


def _valid_model_version(value: str) -> bool:
    return (
        1 <= len(value) <= 160
        and value[0].isalnum()
        and all(character.islower() or character.isdigit() or character in "._-" for character in value)
    )


def _bare_sha256(value: str) -> str:
    normalized = value[7:] if value.startswith("sha256:") else value
    if not _valid_bare_sha256(normalized):
        raise RoutingLightGBMShadowRuntimeError("manifest hash is invalid")
    return normalized
