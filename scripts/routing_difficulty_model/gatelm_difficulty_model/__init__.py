"""Offline-only GateLM routing difficulty model tooling."""

from .semantic_features import (
    OFFLINE_FEATURE_SHAPE_VERSION,
    RULE_VECTOR_V1_DIMENSION,
    SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1,
    FeatureShapeDescriptor,
    FeatureSegment,
    OfflineFeatureCandidate,
    OfflineFeatureShape,
    OfflineFeatureValues,
    SemanticHeadSpec,
)
from .semantic_heads import (
    evaluate_semantic_head_probabilities,
    flatten_semantic_head_probabilities,
    predict_semantic_head_probabilities,
    train_and_evaluate_semantic_heads,
    train_semantic_heads,
    validate_semantic_heads_artifact,
)
from .training import artifact_content_hash, train_from_vector_export

__all__ = [
    "OFFLINE_FEATURE_SHAPE_VERSION",
    "RULE_VECTOR_V1_DIMENSION",
    "SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1",
    "FeatureShapeDescriptor",
    "FeatureSegment",
    "OfflineFeatureCandidate",
    "OfflineFeatureShape",
    "OfflineFeatureValues",
    "SemanticHeadSpec",
    "evaluate_semantic_head_probabilities",
    "flatten_semantic_head_probabilities",
    "predict_semantic_head_probabilities",
    "train_and_evaluate_semantic_heads",
    "train_semantic_heads",
    "validate_semantic_heads_artifact",
    "artifact_content_hash",
    "train_from_vector_export",
]
