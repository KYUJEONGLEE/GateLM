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
    "artifact_content_hash",
    "train_from_vector_export",
]
