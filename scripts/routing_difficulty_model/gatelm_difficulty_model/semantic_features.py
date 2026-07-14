"""Offline-only feature shapes for semantic difficulty experiments.

The values assembled here are sensitive, in-memory training material.  This
module deliberately provides no JSON/report serialization helper.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from math import fsum, isfinite


OFFLINE_FEATURE_SHAPE_VERSION = "difficulty-offline-feature-shape.v1"
RULE_VECTOR_V1_VERSION = "difficulty-feature-vector.v1"
RULE_VECTOR_V1_DIMENSION = 42
PROBABILITY_SUM_TOLERANCE = 1e-6

RULE_VECTOR_V1_FEATURE_NAMES = (
    "payloadEmpty",
    "payloadSmall",
    "payloadMedium",
    "payloadLarge",
    "taskCount",
    "constraintCount",
    "scopeCount",
    "dependencyDepth",
    "categoryGeneral",
    "categoryCode",
    "categoryTranslation",
    "categorySummarization",
    "categoryReasoning",
    "generalWorkflowDepth",
    "generalBranchOrExceptionCount",
    "generalExtractionBreadth",
    "generalHasCrossSourceSynthesis",
    "codeOperationUnknown",
    "codeOperationSyntax",
    "codeOperationExample",
    "codeOperationSmallEdit",
    "codeOperationDebug",
    "codeOperationRefactor",
    "codeOperationDesign",
    "codeOperationMigration",
    "codeOperationConcurrency",
    "codeOperationPerformance",
    "codeScopeBreadth",
    "codeCausalComplexity",
    "codeEngineeringConstraintCount",
    "translationScopeCount",
    "translationPreservationConstraintCount",
    "translationDomainTerminologyLevel",
    "translationLocalizationDegree",
    "summarizationSourceBreadth",
    "summarizationSynthesisLevel",
    "summarizationFacetCount",
    "summarizationHasTraceabilityConstraints",
    "reasoningAlternativeCount",
    "reasoningCriteriaAndConstraintCount",
    "reasoningDepth",
    "reasoningUncertaintyScenarioCount",
)


class OfflineFeatureCandidate(StrEnum):
    """Fixed candidate order for the first offline comparison."""

    RULE_VECTOR_V1 = "42d-rule-vector-v1"
    RULE_VECTOR_V1_PLUS_PROJECTION = "42d-rule-vector-v1-plus-projection"
    RULE_VECTOR_V1_PLUS_PROJECTION_AND_HEADS = (
        "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities"
    )


@dataclass(frozen=True)
class SemanticHeadSpec:
    name: str
    classes: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("semantic head name must not be empty")
        if not self.classes or any(not class_name.strip() for class_name in self.classes):
            raise ValueError(f"semantic head {self.name!r} must declare non-empty classes")
        if len(set(self.classes)) != len(self.classes):
            raise ValueError(f"semantic head {self.name!r} contains duplicate classes")


SEMANTIC_HEAD_SPECS_V1 = (
    SemanticHeadSpec(
        "semanticTaskBucket",
        ("count_1", "count_2", "count_3_plus"),
    ),
    SemanticHeadSpec(
        "semanticConstraintBucket",
        ("count_0_to_1", "count_2", "count_3_plus"),
    ),
    SemanticHeadSpec(
        "semanticScopeBucket",
        ("count_1", "count_2_to_3", "count_4_plus"),
    ),
    SemanticHeadSpec(
        "semanticDependencyBucket",
        ("depth_0_to_1", "depth_2", "depth_3_plus"),
    ),
)

SEMANTIC_HEAD_PROBABILITY_DIMENSION_V1 = sum(
    len(spec.classes) for spec in SEMANTIC_HEAD_SPECS_V1
)


@dataclass(frozen=True)
class FeatureSegment:
    name: str
    offset: int
    dimension: int

    @property
    def end(self) -> int:
        return self.offset + self.dimension


@dataclass(frozen=True)
class FeatureShapeDescriptor:
    shape_version: str
    candidate: OfflineFeatureCandidate
    rule_vector_version: str
    projection_version: str
    projection_dimension: int
    semantic_heads_version: str
    semantic_head_specs: tuple[SemanticHeadSpec, ...]
    segments: tuple[FeatureSegment, ...]
    total_dimension: int


@dataclass(frozen=True)
class OfflineFeatureValues:
    """Separated values used to assemble one offline candidate in memory."""

    rule_vector_v1: Sequence[float]
    semantic_projection: Sequence[float] | None = None
    semantic_head_probabilities: Mapping[str, Sequence[float]] | None = None


@dataclass(frozen=True)
class OfflineFeatureShape:
    """Validated layout for the three fixed, non-runtime candidates."""

    projection_dimension: int
    projection_version: str
    semantic_heads_version: str
    shape_version: str = OFFLINE_FEATURE_SHAPE_VERSION
    rule_vector_version: str = RULE_VECTOR_V1_VERSION
    semantic_head_specs: tuple[SemanticHeadSpec, ...] = SEMANTIC_HEAD_SPECS_V1

    def __post_init__(self) -> None:
        if (
            isinstance(self.projection_dimension, bool)
            or not isinstance(self.projection_dimension, int)
            or self.projection_dimension <= 0
        ):
            raise ValueError("projection dimension must be a positive integer")
        if not self.projection_version.strip():
            raise ValueError("projection version must not be empty")
        if not self.semantic_heads_version.strip():
            raise ValueError("semantic heads version must not be empty")
        if not self.shape_version.strip() or not self.rule_vector_version.strip():
            raise ValueError("shape and rule vector versions must not be empty")
        if self.semantic_head_specs != SEMANTIC_HEAD_SPECS_V1:
            raise ValueError(
                "semantic heads must use the fixed v1 name, class, and ordering contract"
            )

    @property
    def semantic_head_probability_dimension(self) -> int:
        return sum(len(spec.classes) for spec in self.semantic_head_specs)

    def descriptor(
        self, candidate: OfflineFeatureCandidate | str
    ) -> FeatureShapeDescriptor:
        canonical_candidate = OfflineFeatureCandidate(candidate)
        segments = self._segments(canonical_candidate)
        return FeatureShapeDescriptor(
            shape_version=self.shape_version,
            candidate=canonical_candidate,
            rule_vector_version=self.rule_vector_version,
            projection_version=self.projection_version,
            projection_dimension=self.projection_dimension,
            semantic_heads_version=self.semantic_heads_version,
            semantic_head_specs=self.semantic_head_specs,
            segments=segments,
            total_dimension=segments[-1].end,
        )

    def feature_names(self, candidate: OfflineFeatureCandidate | str) -> tuple[str, ...]:
        canonical_candidate = OfflineFeatureCandidate(candidate)
        names = tuple(f"ruleVectorV1.{name}" for name in RULE_VECTOR_V1_FEATURE_NAMES)
        if canonical_candidate is OfflineFeatureCandidate.RULE_VECTOR_V1:
            return names

        names += tuple(
            f"semanticProjection[{index}]" for index in range(self.projection_dimension)
        )
        if canonical_candidate is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION:
            return names

        for spec in self.semantic_head_specs:
            names += tuple(
                f"semanticHeads.{spec.name}.{class_name}.probability"
                for class_name in spec.classes
            )
        return names

    def assemble(
        self,
        candidate: OfflineFeatureCandidate | str,
        values: OfflineFeatureValues,
    ) -> tuple[float, ...]:
        canonical_candidate = OfflineFeatureCandidate(candidate)
        result = _finite_vector(
            "ruleVectorV1", values.rule_vector_v1, RULE_VECTOR_V1_DIMENSION
        )
        if any(value < 0.0 or value > 1.0 for value in result):
            raise ValueError("ruleVectorV1 values must be within [0, 1]")
        if canonical_candidate is OfflineFeatureCandidate.RULE_VECTOR_V1:
            return result

        if values.semantic_projection is None:
            raise ValueError("semanticProjection is required for the selected candidate")
        result += _finite_vector(
            "semanticProjection",
            values.semantic_projection,
            self.projection_dimension,
        )
        if canonical_candidate is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION:
            return result

        result += self._flatten_head_probabilities(values.semantic_head_probabilities)
        expected_dimension = self.descriptor(canonical_candidate).total_dimension
        if len(result) != expected_dimension:
            raise ValueError("assembled feature vector dimension does not match its descriptor")
        return result

    def _segments(self, candidate: OfflineFeatureCandidate) -> tuple[FeatureSegment, ...]:
        segments = [FeatureSegment("ruleVectorV1", 0, RULE_VECTOR_V1_DIMENSION)]
        if candidate is OfflineFeatureCandidate.RULE_VECTOR_V1:
            return tuple(segments)

        offset = segments[-1].end
        segments.append(
            FeatureSegment("semanticProjection", offset, self.projection_dimension)
        )
        if candidate is OfflineFeatureCandidate.RULE_VECTOR_V1_PLUS_PROJECTION:
            return tuple(segments)

        offset = segments[-1].end
        for spec in self.semantic_head_specs:
            segments.append(
                FeatureSegment(
                    f"semanticHeads.{spec.name}", offset, len(spec.classes)
                )
            )
            offset = segments[-1].end
        return tuple(segments)

    def _flatten_head_probabilities(
        self, probabilities: Mapping[str, Sequence[float]] | None
    ) -> tuple[float, ...]:
        if probabilities is None:
            raise ValueError("semantic head probabilities are required for the selected candidate")

        expected_names = tuple(spec.name for spec in self.semantic_head_specs)
        actual_names = set(probabilities)
        missing = [name for name in expected_names if name not in actual_names]
        extra = sorted(actual_names.difference(expected_names))
        if missing or extra:
            raise ValueError(
                "semantic head set does not match the fixed contract: "
                f"missing={missing}, extra={extra}"
            )

        result: tuple[float, ...] = ()
        for spec in self.semantic_head_specs:
            head = _finite_vector(
                f"semanticHeads.{spec.name}",
                probabilities[spec.name],
                len(spec.classes),
            )
            if any(value < 0.0 or value > 1.0 for value in head):
                raise ValueError(
                    f"semantic head {spec.name!r} probabilities must be within [0, 1]"
                )
            if abs(fsum(head) - 1.0) > PROBABILITY_SUM_TOLERANCE:
                raise ValueError(
                    f"semantic head {spec.name!r} probabilities must sum to 1"
                )
            result += head
        return result


def _finite_vector(name: str, values: Sequence[float], dimension: int) -> tuple[float, ...]:
    if len(values) != dimension:
        raise ValueError(f"{name} dimension is {len(values)}, expected {dimension}")
    try:
        result = tuple(float(value) for value in values)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must contain only numeric values") from error
    if any(not isfinite(value) for value in result):
        raise ValueError(f"{name} must contain only finite values")
    return result
