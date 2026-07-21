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
E5_BASE_PROFILE_VERSION = "difficulty-lightgbm-shadow.e5-base-768.v1"
E5_SMALL_PCA_PROFILE_VERSION = (
    "difficulty-lightgbm-shadow.rule42-e5-small-pca64.v1"
)
E5_SMALL_SEMANTIC_HEADS_PROFILE_VERSION = (
    "difficulty-lightgbm-shadow.rule42-semantic-heads12.v1"
)
PROFILE_VERSION = E5_BASE_PROFILE_VERSION

E5_BASE_MODE = "e5_base"
E5_BASE_MODEL_ID = "intfloat/multilingual-e5-base"
E5_BASE_SOURCE_REVISION = "d13f1b27baf31030b7fd040960d60d909913633f"
E5_BASE_NATIVE_DIMENSION = 768

E5_SMALL_MODE = "e5_small"
E5_SMALL_MODEL_ID = "intfloat/multilingual-e5-small"
E5_SMALL_SOURCE_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
E5_SMALL_NATIVE_DIMENSION = 384
E5_SMALL_BUNDLE_VERSION = (
    "difficulty-e5-encoder-pca64-single-request.2026-07-15.v2"
)
E5_SMALL_BUNDLE_SHA256 = (
    "0f828d6a93f5600dff529e4194736fe79d43c04fa4ec9257374f1e092126f76e"
)
E5_SMALL_MANIFEST_SCHEMA = "gatelm.difficulty-e5-encoder-manifest.v2"
E5_SMALL_MANIFEST_SHA256 = (
    "94c4cdf6cc6caf9d9a640f56b88219a94956750152d14ac4ef21b52140766380"
)
E5_SMALL_POOLING_VERSION = "difficulty-attention-masked-mean.v2"

E5_SMALL_PCA_VERSION = "difficulty-e5-pca-full-svd-64.single-request.v2"
E5_SMALL_PCA_FILE_SHA256 = (
    "fc2ae71057650884e88ace7a9a6ca1465219527558ab534746374d3632690eb9"
)
E5_SMALL_PCA_PARAMETER_SHA256 = (
    "a9a2258d9d68724af3a1edc4b063d671e42d4d2e68c430e4aa3f668371aadafa"
)

SEMANTIC_HEADS_SCHEMA = "gatelm.difficulty-semantic-heads-artifact.v1"
SEMANTIC_HEADS_VERSION = (
    "difficulty-semantic-heads.owner-approved-500.single-request.2026-07-15.v2"
)
SEMANTIC_HEADS_CONTENT_HASH = (
    "531bb72d1d22f134a11da76649cfde9102af5c116cf46765e03b8f2550d27386"
)
SEMANTIC_HEADS_FILE_SHA256 = (
    "e13d7a4c066861bbdd310341bc85fc611d5ad7e28c3ac0d54b203e130ce052b5"
)
SEMANTIC_HEAD_SPECS_V1 = (
    ("semanticTaskBucket", ("count_1", "count_2", "count_3_plus")),
    (
        "semanticConstraintBucket",
        ("count_0_to_1", "count_2", "count_3_plus"),
    ),
    ("semanticScopeBucket", ("count_1", "count_2_to_3", "count_4_plus")),
    ("semanticDependencyBucket", ("depth_0_to_1", "depth_2", "depth_3_plus")),
)
SEMANTIC_HEAD_DIMENSION = 12

# Backward-compatible symbol used by existing E5-base tests.
NATIVE_DIMENSION = E5_BASE_NATIVE_DIMENSION
ALLOWED_RULE_DIMENSIONS = frozenset({0, RULE_VECTOR_DIMENSION})
ALLOWED_TRAINING_CANDIDATE_SETS = {
    (
        "tabular_only",
        "embedding_only_768",
        "raw_768",
        "pca_128",
        "pca_256",
    ),
    (
        "rule_42_plus_e5_small_pca_64",
        "rule_42_plus_semantic_heads_12",
        "e5_base_raw_768",
        "rule_42_plus_e5_base_raw_768",
    ),
}
MAXIMUM_MANIFEST_BYTES = 128 * 1024
MAXIMUM_ENCODER_MANIFEST_BYTES = 64 * 1024
MAXIMUM_PROJECTION_BYTES = 8 * 1024 * 1024
MAXIMUM_SEMANTIC_HEADS_BYTES = 2 * 1024 * 1024
MAXIMUM_MODEL_BYTES = 64 * 1024 * 1024

_PROFILE_VERSIONS = {
    (E5_BASE_MODE, "raw_768"): E5_BASE_PROFILE_VERSION,
    (E5_BASE_MODE, "pca_128"): E5_BASE_PROFILE_VERSION,
    (E5_BASE_MODE, "pca_256"): E5_BASE_PROFILE_VERSION,
    (E5_SMALL_MODE, "pca_64"): E5_SMALL_PCA_PROFILE_VERSION,
    (
        E5_SMALL_MODE,
        "semantic_heads_12",
    ): E5_SMALL_SEMANTIC_HEADS_PROFILE_VERSION,
}
_FEATURE_SHAPES = {
    (E5_BASE_MODE, "raw_768", 0): (
        768,
        768,
        ("raw_embedding_768",),
    ),
    (E5_BASE_MODE, "raw_768", RULE_VECTOR_DIMENSION): (
        768,
        810,
        ("rule_vector_v1", "raw_embedding_768"),
    ),
    (E5_BASE_MODE, "pca_128", RULE_VECTOR_DIMENSION): (
        128,
        170,
        ("rule_vector_v1", "e5_base_pca_128"),
    ),
    (E5_BASE_MODE, "pca_256", RULE_VECTOR_DIMENSION): (
        256,
        298,
        ("rule_vector_v1", "e5_base_pca_256"),
    ),
    (E5_SMALL_MODE, "pca_64", RULE_VECTOR_DIMENSION): (
        64,
        106,
        ("rule_vector_v1", "e5_small_pca_64"),
    ),
    (E5_SMALL_MODE, "semantic_heads_12", RULE_VECTOR_DIMENSION): (
        12,
        54,
        ("rule_vector_v1", "semantic_heads_12"),
    ),
}


class RoutingLightGBMShadowRuntimeError(RuntimeError):
    """Sanitized failure that never includes request-derived material."""


@dataclass(frozen=True)
class RoutingLightGBMShadowIdentity:
    profile_version: str
    model_version: str
    model_content_hash: str
    encoder_mode: str
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
    input_dimension: int
    output_dimension: int

    def apply(self, pooled: Any) -> Any:
        import numpy as np

        pooled_array = np.asarray(pooled, dtype=np.float32)
        if (
            pooled_array.ndim != 2
            or pooled_array.shape[1] != self.input_dimension
            or not np.all(np.isfinite(pooled_array))
        ):
            raise RoutingLightGBMShadowRuntimeError("projection input is invalid")
        centered = np.asarray(pooled_array - self.mean, dtype=np.float32)
        projected = np.asarray(centered @ self.components.T, dtype=np.float32)
        if projected.shape != (pooled_array.shape[0], self.output_dimension):
            raise RoutingLightGBMShadowRuntimeError("projection output is invalid")
        if not np.all(np.isfinite(projected)):
            raise RoutingLightGBMShadowRuntimeError("projection output is non-finite")
        norm = np.linalg.norm(projected, axis=1, keepdims=True)
        if not np.all(np.isfinite(norm)) or np.any(norm <= self.l2_epsilon):
            raise RoutingLightGBMShadowRuntimeError("projection norm is invalid")
        return np.ascontiguousarray(projected / norm, dtype=np.float32)


@dataclass(frozen=True)
class _SemanticHead:
    name: str
    classes: tuple[str, ...]
    coefficient: Any
    intercept: Any


@dataclass(frozen=True)
class _SemanticHeads:
    heads: tuple[_SemanticHead, ...]

    def apply(self, projection: Any) -> Any:
        import numpy as np

        values = np.asarray(projection, dtype=np.float32)
        if (
            values.ndim != 2
            or values.shape[1] != 64
            or not np.all(np.isfinite(values))
        ):
            raise RoutingLightGBMShadowRuntimeError(
                "semantic head input is invalid"
            )
        matrices: list[Any] = []
        for head in self.heads:
            logits = (
                values.astype(np.float64, copy=False) @ head.coefficient.T
                + head.intercept
            )
            logits -= np.max(logits, axis=1, keepdims=True)
            exponentials = np.exp(logits)
            probabilities = exponentials / exponentials.sum(axis=1, keepdims=True)
            if (
                probabilities.shape != (values.shape[0], len(head.classes))
                or not np.all(np.isfinite(probabilities))
                or np.any(probabilities < 0)
                or np.any(probabilities > 1)
                or not np.allclose(
                    probabilities.sum(axis=1), 1.0, atol=1e-6, rtol=0
                )
            ):
                raise RoutingLightGBMShadowRuntimeError(
                    "semantic head probability output is invalid"
                )
            matrices.append(probabilities)
        flattened = np.ascontiguousarray(
            np.concatenate(matrices, axis=1), dtype=np.float32
        )
        if flattened.shape != (values.shape[0], SEMANTIC_HEAD_DIMENSION):
            raise RoutingLightGBMShadowRuntimeError(
                "semantic head feature shape is invalid"
            )
        return flattened


@dataclass(frozen=True)
class _ModelMaterial:
    booster: Any
    threshold: float
    encoder_dimension: int
    rule_dimension: int
    semantic_mode: str
    semantic_dimension: int
    total_dimension: int
    projection: _Projection | None
    semantic_heads: _SemanticHeads | None = None

    def build_features(
        self,
        pooled: Any,
        rule_vectors: Sequence[Sequence[float]],
    ) -> Any:
        import numpy as np

        pooled_array = np.asarray(pooled, dtype=np.float32)
        if (
            pooled_array.ndim != 2
            or pooled_array.shape != (len(rule_vectors), self.encoder_dimension)
            or not np.all(np.isfinite(pooled_array))
        ):
            raise RoutingLightGBMShadowRuntimeError(
                "pooled encoder output is invalid"
            )
        rules = np.asarray(rule_vectors, dtype=np.float32)
        if (
            rules.shape != (len(rule_vectors), RULE_VECTOR_DIMENSION)
            or not np.all(np.isfinite(rules))
            or np.any(rules < 0)
            or np.any(rules > 1)
        ):
            raise RoutingLightGBMShadowRuntimeError("rule vector is invalid")

        semantic = pooled_array
        if self.semantic_mode.startswith("pca_"):
            if self.projection is None or self.semantic_heads is not None:
                raise RoutingLightGBMShadowRuntimeError(
                    "projection material is invalid"
                )
            semantic = self.projection.apply(pooled_array)
        elif self.semantic_mode == "semantic_heads_12":
            if self.projection is None or self.semantic_heads is None:
                raise RoutingLightGBMShadowRuntimeError(
                    "semantic head material is missing"
                )
            semantic = self.semantic_heads.apply(self.projection.apply(pooled_array))
        elif self.semantic_mode != "raw_768":
            raise RoutingLightGBMShadowRuntimeError("semantic mode is invalid")

        semantic_features = np.ascontiguousarray(semantic, dtype=np.float32)
        if semantic_features.shape != (
            len(rule_vectors),
            self.semantic_dimension,
        ):
            raise RoutingLightGBMShadowRuntimeError(
                "semantic feature shape is invalid"
            )
        combined = (
            semantic_features
            if self.rule_dimension == 0
            else np.concatenate((rules, semantic_features), axis=1)
        )
        features = np.ascontiguousarray(combined, dtype=np.float32)
        if features.shape != (len(rule_vectors), self.total_dimension):
            raise RoutingLightGBMShadowRuntimeError(
                "combined feature shape is invalid"
            )
        return features

    def classify_many(
        self,
        pooled: Any,
        rule_vectors: Sequence[Sequence[float]],
    ) -> list[RoutingLightGBMShadowPrediction]:
        import numpy as np

        features = self.build_features(pooled, rule_vectors)
        scores = np.asarray(
            self.booster.predict(
                features,
                raw_score=False,
                pred_leaf=False,
                pred_contrib=False,
            ),
            dtype=np.float64,
        )
        if scores.shape != (len(rule_vectors),) or not np.all(np.isfinite(scores)):
            raise RoutingLightGBMShadowRuntimeError("LightGBM output is invalid")
        if np.any(scores < 0) or np.any(scores > 1):
            raise RoutingLightGBMShadowRuntimeError(
                "LightGBM probability is invalid"
            )
        return [
            RoutingLightGBMShadowPrediction(
                difficulty=(
                    "complex" if float(score) >= self.threshold else "simple"
                ),
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
        if identity.encoder_mode == E5_SMALL_MODE:
            _validate_small_encoder_manifest(
                artifact_root,
                encoder,
                feature_shape,
            )
        model_directory = _safe_artifact_path(
            artifact_root, str(encoder["artifactDirectory"])
        )
        runtime_artifacts = encoder["runtimeArtifacts"]
        _validate_runtime_artifacts(model_directory, runtime_artifacts)

        self._identity = identity
        self._encoder_dimension = int(encoder["outputDimension"])
        self._material = _load_model_material(
            artifact_root,
            feature_shape,
            model,
            encoder_dimension=self._encoder_dimension,
        )
        self._input_prefix = str(encoder["inputPrefix"])
        self._maximum_token_length = int(encoder["maximumTokenLength"])
        self._tokenizer = AutoTokenizer.from_pretrained(
            model_directory,
            revision=str(encoder["sourceRevision"]),
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
            raise RoutingLightGBMShadowRuntimeError(
                "encoder inputs are incompatible"
            )
        outputs = self._session.get_outputs()
        if len(outputs) != 1 or outputs[0].name != "last_hidden_state":
            raise RoutingLightGBMShadowRuntimeError(
                "encoder output is incompatible"
            )
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
        pooled = self._encode_many(instruction_texts, rule_vectors)
        return self._material.classify_many(pooled, rule_vectors)

    def _encode_many(
        self,
        instruction_texts: Sequence[str],
        rule_vectors: Sequence[Sequence[float]],
    ) -> Any:
        if (
            isinstance(instruction_texts, (str, bytes))
            or len(instruction_texts) != 1
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
            raise RoutingLightGBMShadowRuntimeError(
                "tokenizer output is incompatible"
            )
        inputs = {
            name: {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
                "token_type_ids": token_type_ids,
            }[name]
            for name in self._input_names
        }
        hidden = self._session.run(["last_hidden_state"], inputs)[0]
        return _masked_mean(
            hidden,
            attention_mask,
            expected_dimension=self._encoder_dimension,
        )

    def warmup(self) -> None:
        vector = [0.0] * RULE_VECTOR_DIMENSION
        vector[1] = 1.0
        vector[8] = 1.0
        self.classify("explain one bounded workflow step.", vector)


def _masked_mean(
    last_hidden_state: Any,
    attention_mask: Any,
    *,
    expected_dimension: int = NATIVE_DIMENSION,
) -> Any:
    import numpy as np

    hidden = np.asarray(last_hidden_state, dtype=np.float32)
    mask = np.asarray(attention_mask, dtype=np.float32)
    if (
        hidden.ndim != 3
        or mask.ndim != 2
        or hidden.shape[:2] != mask.shape
        or hidden.shape[2] != expected_dimension
        or not np.all(np.isfinite(hidden))
        or not np.all(np.isfinite(mask))
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "encoder output shape is incompatible"
        )
    denominator = np.sum(mask, axis=1, keepdims=True, dtype=np.float32)
    if np.any(denominator <= 0):
        raise RoutingLightGBMShadowRuntimeError("encoder attention mask is empty")
    pooled = np.sum(
        hidden * mask[:, :, None], axis=1, dtype=np.float32
    ) / denominator
    if not np.all(np.isfinite(pooled)):
        raise RoutingLightGBMShadowRuntimeError(
            "encoder pooled output is invalid"
        )
    return np.ascontiguousarray(pooled, dtype=np.float32)


def _validate_manifest(
    manifest: dict[str, Any],
) -> tuple[
    RoutingLightGBMShadowIdentity,
    dict[str, Any],
    dict[str, Any],
    dict[str, Any],
]:
    encoder_mode = str(manifest.get("encoderMode", ""))
    profile_version = str(manifest.get("profileVersion", ""))
    encoder = manifest.get("encoder")
    feature_shape = manifest.get("featureShape")
    model = manifest.get("model")
    execution = manifest.get("executionShape")
    training = manifest.get("trainingProvenance")
    split_counts = (
        training.get("splitCounts") if isinstance(training, dict) else None
    )
    if (
        manifest.get("schemaVersion") != MANIFEST_SCHEMA
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
        or tuple(training.get("selectedFrom", ()))
        not in ALLOWED_TRAINING_CANDIDATE_SETS
        or not isinstance(split_counts, dict)
        or not isinstance(split_counts.get("train"), int)
        or split_counts["train"] < 256
        or not isinstance(split_counts.get("validation"), int)
        or split_counts["validation"] < 1
        or not isinstance(split_counts.get("test"), int)
        or split_counts["test"] < 1
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "profile manifest identity mismatch"
        )

    encoder_dimension = _validate_encoder_descriptor(encoder_mode, encoder)
    semantic_mode = str(feature_shape.get("semanticMode", ""))
    rule_dimension = feature_shape.get("ruleDimension")
    shape = _FEATURE_SHAPES.get((encoder_mode, semantic_mode, rule_dimension))
    if shape is None:
        raise RoutingLightGBMShadowRuntimeError("feature pipeline is invalid")
    semantic_dimension, total_dimension, feature_order = shape
    if profile_version != _PROFILE_VERSIONS[(encoder_mode, semantic_mode)]:
        raise RoutingLightGBMShadowRuntimeError(
            "profile manifest identity mismatch"
        )
    expected_feature_names = (
        []
        if rule_dimension == 0
        else [f"ruleVectorV1.{name}" for name in RULE_VECTOR_FEATURE_NAMES]
    )
    projection_descriptor = feature_shape.get("projection")
    semantic_heads_descriptor = feature_shape.get("semanticHeads")
    if (
        feature_shape.get("ruleVectorVersion") != RULE_VECTOR_VERSION
        or feature_shape.get("semanticDimension") != semantic_dimension
        or feature_shape.get("totalDimension") != total_dimension
        or feature_shape.get("tabularFeatureNames") != expected_feature_names
        or tuple(feature_shape.get("featureOrder", ())) != feature_order
    ):
        raise RoutingLightGBMShadowRuntimeError("feature shape is invalid")

    requires_projection = semantic_mode.startswith("pca_") or (
        semantic_mode == "semantic_heads_12"
    )
    if requires_projection:
        if (
            not isinstance(projection_descriptor, dict)
            or projection_descriptor.get("fitSplit") != "train"
            or projection_descriptor.get("fitRecordCount")
            != split_counts["train"]
        ):
            raise RoutingLightGBMShadowRuntimeError(
                "projection provenance is invalid"
            )
    elif projection_descriptor is not None:
        raise RoutingLightGBMShadowRuntimeError(
            "raw semantic mode has projection"
        )
    if semantic_mode == "semantic_heads_12":
        _validate_semantic_heads_descriptor(semantic_heads_descriptor)
    elif semantic_heads_descriptor is not None:
        raise RoutingLightGBMShadowRuntimeError(
            "semantic head descriptor is unexpected"
        )

    model_version = str(model.get("version", ""))
    content_hash = str(model.get("contentHash", ""))
    if (
        not _valid_model_version(model_version)
        or model.get("format") != "lightgbm_text"
        or model.get("objective") != "binary"
        or model.get("numFeatures") != total_dimension
        or not isinstance(model.get("threshold"), (int, float))
        or isinstance(model.get("threshold"), bool)
        or not 0 <= float(model["threshold"]) <= 1
        or not _valid_prefixed_sha256(content_hash)
        or content_hash != f"sha256:{model.get('sha256', '')}"
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "LightGBM model identity is invalid"
        )
    return (
        RoutingLightGBMShadowIdentity(
            profile_version=profile_version,
            model_version=model_version,
            model_content_hash=content_hash,
            encoder_mode=encoder_mode,
            semantic_mode=semantic_mode,
            semantic_dimension=semantic_dimension,
            total_dimension=total_dimension,
        ),
        encoder,
        feature_shape,
        model,
    )


def _validate_encoder_descriptor(
    encoder_mode: str,
    encoder: dict[str, Any],
) -> int:
    runtime_artifacts = encoder.get("runtimeArtifacts")
    common_valid = (
        encoder.get("pooling")
        == "attention_mask_weighted_mean_excluding_padding"
        and encoder.get("inputPrefix") == "query: "
        and isinstance(encoder.get("maximumTokenLength"), int)
        and not isinstance(encoder.get("maximumTokenLength"), bool)
        and 1 <= int(encoder["maximumTokenLength"]) <= 512
        and isinstance(encoder.get("artifactDirectory"), str)
        and isinstance(runtime_artifacts, list)
    )
    if not common_valid:
        raise RoutingLightGBMShadowRuntimeError("encoder profile is invalid")
    if encoder_mode == E5_BASE_MODE:
        if (
            encoder.get("modelId") != E5_BASE_MODEL_ID
            or encoder.get("sourceRevision") != E5_BASE_SOURCE_REVISION
            or encoder.get("outputDimension") != E5_BASE_NATIVE_DIMENSION
        ):
            raise RoutingLightGBMShadowRuntimeError("encoder profile is invalid")
        return E5_BASE_NATIVE_DIMENSION
    if encoder_mode == E5_SMALL_MODE:
        manifest_descriptor = encoder.get("manifest")
        if (
            encoder.get("modelId") != E5_SMALL_MODEL_ID
            or encoder.get("sourceRevision") != E5_SMALL_SOURCE_REVISION
            or encoder.get("outputDimension") != E5_SMALL_NATIVE_DIMENSION
            or encoder.get("bundleVersion") != E5_SMALL_BUNDLE_VERSION
            or encoder.get("bundleSha256") != E5_SMALL_BUNDLE_SHA256
            or encoder.get("poolingVersion") != E5_SMALL_POOLING_VERSION
            or not isinstance(manifest_descriptor, dict)
            or manifest_descriptor.get("sha256") != E5_SMALL_MANIFEST_SHA256
        ):
            raise RoutingLightGBMShadowRuntimeError("encoder profile is invalid")
        return E5_SMALL_NATIVE_DIMENSION
    raise RoutingLightGBMShadowRuntimeError("encoder mode is invalid")


def _validate_small_encoder_manifest(
    artifact_root: Path,
    encoder: dict[str, Any],
    feature_shape: dict[str, Any],
) -> None:
    descriptor = encoder.get("manifest")
    if not isinstance(descriptor, dict):
        raise RoutingLightGBMShadowRuntimeError(
            "encoder manifest descriptor is missing"
        )
    path = _validate_file_entry(
        artifact_root,
        descriptor,
        maximum_bytes=MAXIMUM_ENCODER_MANIFEST_BYTES,
    )
    manifest = _load_pinned_json(
        path,
        maximum_bytes=MAXIMUM_ENCODER_MANIFEST_BYTES,
        expected_sha256=E5_SMALL_MANIFEST_SHA256,
    )
    material = dict(manifest)
    bundle_hash = material.pop("bundleSha256", None)
    preprocessing = manifest.get("preprocessing")
    pooling = manifest.get("pooling")
    projection = manifest.get("projection")
    if (
        manifest.get("schemaVersion") != E5_SMALL_MANIFEST_SCHEMA
        or manifest.get("bundleVersion") != E5_SMALL_BUNDLE_VERSION
        or bundle_hash != E5_SMALL_BUNDLE_SHA256
        or _canonical_hash(material) != E5_SMALL_BUNDLE_SHA256
        or manifest.get("modelId") != encoder.get("modelId")
        or manifest.get("sourceRevision") != encoder.get("sourceRevision")
        or manifest.get("artifactDirectory") != encoder.get("artifactDirectory")
        or manifest.get("runtimeArtifacts") != encoder.get("runtimeArtifacts")
        or not isinstance(preprocessing, dict)
        or preprocessing.get("inputPrefix") != encoder.get("inputPrefix")
        or preprocessing.get("maximumTokenLength")
        != encoder.get("maximumTokenLength")
        or not isinstance(pooling, dict)
        or pooling.get("version") != E5_SMALL_POOLING_VERSION
        or pooling.get("rule") != encoder.get("pooling")
        or pooling.get("outputDimension") != E5_SMALL_NATIVE_DIMENSION
        or not isinstance(projection, dict)
        or projection.get("version") != E5_SMALL_PCA_VERSION
        or projection.get("fileSha256") != E5_SMALL_PCA_FILE_SHA256
        or projection.get("parameterSha256")
        != E5_SMALL_PCA_PARAMETER_SHA256
        or projection.get("inputDimension") != E5_SMALL_NATIVE_DIMENSION
        or projection.get("outputDimension") != 64
        or projection.get("fitRecordCount") != 300
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "encoder manifest identity mismatch"
        )
    profile_projection = feature_shape.get("projection")
    if (
        not isinstance(profile_projection, dict)
        or profile_projection.get("version") != projection.get("version")
        or profile_projection.get("sha256") != projection.get("fileSha256")
        or profile_projection.get("parameterSha256")
        != projection.get("parameterSha256")
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "projection manifest identity mismatch"
        )


def _validate_semantic_heads_descriptor(descriptor: object) -> None:
    expected_class_order = [
        {"name": name, "classes": list(classes)}
        for name, classes in SEMANTIC_HEAD_SPECS_V1
    ]
    if (
        not isinstance(descriptor, dict)
        or descriptor.get("version") != SEMANTIC_HEADS_VERSION
        or descriptor.get("contentHash")
        != f"sha256:{SEMANTIC_HEADS_CONTENT_HASH}"
        or descriptor.get("sha256") != SEMANTIC_HEADS_FILE_SHA256
        or descriptor.get("inputDimension") != 64
        or descriptor.get("outputDimension") != SEMANTIC_HEAD_DIMENSION
        or descriptor.get("probabilityRule") != "multinomial_linear_softmax.v1"
        or descriptor.get("headOrder")
        != [name for name, _classes in SEMANTIC_HEAD_SPECS_V1]
        or descriptor.get("classOrder") != expected_class_order
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "semantic head descriptor identity mismatch"
        )


def _load_model_material(
    artifact_root: Path,
    feature_shape: dict[str, Any],
    model: dict[str, Any],
    *,
    encoder_dimension: int,
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
        raise RoutingLightGBMShadowRuntimeError(
            "LightGBM model is invalid"
        ) from exc
    if (
        booster.num_feature() != int(model["numFeatures"])
        or booster.num_feature() != total_dimension
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "LightGBM feature dimension mismatch"
        )

    projection = None
    semantic_heads = None
    if semantic_mode.startswith("pca_") or semantic_mode == "semantic_heads_12":
        raw_projection = feature_shape.get("projection")
        if not isinstance(raw_projection, dict):
            raise RoutingLightGBMShadowRuntimeError(
                "projection descriptor is missing"
            )
        projection_output_dimension = (
            64 if semantic_mode == "semantic_heads_12" else semantic_dimension
        )
        projection = _load_projection(
            artifact_root,
            raw_projection,
            input_dimension=encoder_dimension,
            output_dimension=projection_output_dimension,
            require_small_identity=encoder_dimension == E5_SMALL_NATIVE_DIMENSION,
        )
    elif feature_shape.get("projection") is not None:
        raise RoutingLightGBMShadowRuntimeError(
            "raw semantic mode has projection"
        )
    if semantic_mode == "semantic_heads_12":
        raw_semantic_heads = feature_shape.get("semanticHeads")
        if not isinstance(raw_semantic_heads, dict):
            raise RoutingLightGBMShadowRuntimeError(
                "semantic head descriptor is missing"
            )
        semantic_heads = _load_semantic_heads(artifact_root, raw_semantic_heads)
    return _ModelMaterial(
        booster=booster,
        threshold=float(model["threshold"]),
        encoder_dimension=encoder_dimension,
        rule_dimension=int(feature_shape["ruleDimension"]),
        semantic_mode=semantic_mode,
        semantic_dimension=semantic_dimension,
        total_dimension=total_dimension,
        projection=projection,
        semantic_heads=semantic_heads,
    )


def _load_projection(
    artifact_root: Path,
    descriptor: dict[str, Any],
    *,
    input_dimension: int,
    output_dimension: int,
    require_small_identity: bool,
) -> _Projection:
    import numpy as np

    if (
        descriptor.get("kind") != "sklearn_pca_full_svd"
        or descriptor.get("inputDimension") != input_dimension
        or descriptor.get("outputDimension") != output_dimension
        or descriptor.get("fitSplit") != "train"
        or not isinstance(descriptor.get("fitRecordCount"), int)
        or descriptor["fitRecordCount"] < 256
        or descriptor.get("l2Normalize") is not True
        or not isinstance(descriptor.get("l2Epsilon"), (int, float))
        or isinstance(descriptor.get("l2Epsilon"), bool)
        or float(descriptor["l2Epsilon"]) <= 0
    ):
        raise RoutingLightGBMShadowRuntimeError("projection identity is invalid")
    if require_small_identity and (
        descriptor.get("version") != E5_SMALL_PCA_VERSION
        or descriptor.get("sha256") != E5_SMALL_PCA_FILE_SHA256
        or descriptor.get("parameterSha256")
        != E5_SMALL_PCA_PARAMETER_SHA256
        or input_dimension != E5_SMALL_NATIVE_DIMENSION
        or output_dimension != 64
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
                raise RoutingLightGBMShadowRuntimeError(
                    "projection fields are invalid"
                )
            mean = np.asarray(payload["mean"], dtype=np.float32)
            components = np.asarray(payload["components"], dtype=np.float32)
    except (OSError, ValueError) as exc:
        raise RoutingLightGBMShadowRuntimeError(
            "projection artifact is invalid"
        ) from exc
    if (
        mean.shape != (input_dimension,)
        or components.shape != (output_dimension, input_dimension)
        or not np.all(np.isfinite(mean))
        or not np.all(np.isfinite(components))
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "projection material is invalid"
        )
    if require_small_identity and (
        _projection_parameter_hash(mean, components)
        != E5_SMALL_PCA_PARAMETER_SHA256
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "projection parameter identity mismatch"
        )
    return _Projection(
        mean=mean,
        components=components,
        l2_epsilon=float(descriptor["l2Epsilon"]),
        input_dimension=input_dimension,
        output_dimension=output_dimension,
    )


def _load_semantic_heads(
    artifact_root: Path,
    descriptor: dict[str, Any],
) -> _SemanticHeads:
    import numpy as np

    _validate_semantic_heads_descriptor(descriptor)
    path = _validate_file_entry(
        artifact_root,
        descriptor,
        maximum_bytes=MAXIMUM_SEMANTIC_HEADS_BYTES,
    )
    artifact = _load_pinned_json(
        path,
        maximum_bytes=MAXIMUM_SEMANTIC_HEADS_BYTES,
        expected_sha256=SEMANTIC_HEADS_FILE_SHA256,
    )
    content_material = dict(artifact)
    content_hash = content_material.pop("artifactContentHash", None)
    if (
        artifact.get("schemaVersion") != SEMANTIC_HEADS_SCHEMA
        or artifact.get("version") != SEMANTIC_HEADS_VERSION
        or artifact.get("encoderVersion") != E5_SMALL_BUNDLE_VERSION
        or artifact.get("encoderHash") != E5_SMALL_BUNDLE_SHA256
        or artifact.get("poolingVersion") != E5_SMALL_POOLING_VERSION
        or artifact.get("encoderFrozen") is not True
        or artifact.get("inputDimension") != 64
        or artifact.get("semanticHeadProbabilityDimension")
        != SEMANTIC_HEAD_DIMENSION
        or artifact.get("probabilityRule") != "multinomial_linear_softmax.v1"
        or content_hash != SEMANTIC_HEADS_CONTENT_HASH
        or _canonical_hash(content_material) != SEMANTIC_HEADS_CONTENT_HASH
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "semantic head artifact identity mismatch"
        )
    raw_heads = artifact.get("heads")
    if not isinstance(raw_heads, list) or len(raw_heads) != len(
        SEMANTIC_HEAD_SPECS_V1
    ):
        raise RoutingLightGBMShadowRuntimeError(
            "semantic head artifact shape is invalid"
        )
    heads: list[_SemanticHead] = []
    for raw_head, (expected_name, expected_classes) in zip(
        raw_heads, SEMANTIC_HEAD_SPECS_V1, strict=True
    ):
        if (
            not isinstance(raw_head, dict)
            or raw_head.get("name") != expected_name
            or raw_head.get("classes") != list(expected_classes)
        ):
            raise RoutingLightGBMShadowRuntimeError(
                "semantic head class order is invalid"
            )
        coefficient = np.asarray(raw_head.get("coefficient"), dtype=np.float64)
        intercept = np.asarray(raw_head.get("intercept"), dtype=np.float64)
        if (
            coefficient.shape != (len(expected_classes), 64)
            or intercept.shape != (len(expected_classes),)
            or not np.all(np.isfinite(coefficient))
            or not np.all(np.isfinite(intercept))
        ):
            raise RoutingLightGBMShadowRuntimeError(
                "semantic head parameters are invalid"
            )
        heads.append(
            _SemanticHead(
                name=expected_name,
                classes=expected_classes,
                coefficient=coefficient,
                intercept=intercept,
            )
        )
    return _SemanticHeads(tuple(heads))


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
            raise RoutingLightGBMShadowRuntimeError(
                "encoder artifact entry is invalid"
            )
        role = str(raw_entry.get("role", ""))
        if role not in required_roles or role in seen:
            raise RoutingLightGBMShadowRuntimeError(
                "encoder artifact roles are invalid"
            )
        seen.add(role)
        _validate_file_entry(
            root, raw_entry, maximum_bytes=2 * 1024 * 1024 * 1024
        )
    if seen != required_roles:
        raise RoutingLightGBMShadowRuntimeError(
            "encoder artifacts are incomplete"
        )


def _runtime_artifact_path(
    root: Path,
    entries: list[object],
    role: str,
) -> Path:
    for entry in entries:
        if isinstance(entry, dict) and entry.get("role") == role:
            return _safe_artifact_path(
                root, str(entry.get("relativePath", ""))
            )
    raise RoutingLightGBMShadowRuntimeError(
        "encoder artifact role is missing"
    )


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
        or isinstance(expected_size, bool)
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
        raise RoutingLightGBMShadowRuntimeError(
            "artifact path escapes root"
        ) from exc
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
            raise RoutingLightGBMShadowRuntimeError(
                "manifest size is invalid"
            )
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


def _canonical_hash(value: Any) -> str:
    try:
        payload = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise RoutingLightGBMShadowRuntimeError(
            "artifact canonical identity is invalid"
        ) from exc
    return hashlib.sha256(payload).hexdigest()


def _projection_parameter_hash(mean: Any, components: Any) -> str:
    import numpy as np

    mean_array = np.asarray(mean, dtype="<f4")
    component_array = np.asarray(components, dtype="<f4")
    return hashlib.sha256(
        mean_array.tobytes(order="C") + component_array.tobytes(order="C")
    ).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _valid_bare_sha256(value: str) -> bool:
    return len(value) == 64 and all(
        char in "0123456789abcdef" for char in value
    )


def _valid_prefixed_sha256(value: str) -> bool:
    return value.startswith("sha256:") and _valid_bare_sha256(value[7:])


def _valid_model_version(value: str) -> bool:
    return (
        1 <= len(value) <= 160
        and value[0].isalnum()
        and all(
            character.islower()
            or character.isdigit()
            or character in "._-"
            for character in value
        )
    )


def _bare_sha256(value: str) -> str:
    normalized = value[7:] if value.startswith("sha256:") else value
    if not _valid_bare_sha256(normalized):
        raise RoutingLightGBMShadowRuntimeError("manifest hash is invalid")
    return normalized
