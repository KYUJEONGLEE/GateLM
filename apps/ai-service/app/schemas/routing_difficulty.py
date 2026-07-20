from __future__ import annotations

import math
from typing import Literal

from pydantic import Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.safety import CamelModel


CONTRACT_VERSION = "gatelm.internal.routing-difficulty-inference.v1"
RULE_VECTOR_VERSION = "difficulty-feature-vector.v1"
MODEL_VERSION = (
    "difficulty-offline.model-path-5000.2026-07-16."
    "42d-rule-vector-v1-plus-projection.shadow.v1"
)
MODEL_CONTENT_HASH = (
    "sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d"
)
RULE_VECTOR_DIMENSION = 42
RULE_VECTOR_FEATURE_NAMES = (
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


class RoutingDifficultyClassifyRequest(CamelModel):
    contract_version: str = Field(alias="contractVersion")
    model_content_hash: str = Field(alias="modelContentHash")
    rule_vector_version: str = Field(alias="ruleVectorVersion")
    instruction_text: str = Field(
        alias="instructionText",
        min_length=1,
        max_length=4096,
        repr=False,
    )
    rule_vector: list[float] = Field(
        alias="ruleVector",
        min_length=RULE_VECTOR_DIMENSION,
        max_length=RULE_VECTOR_DIMENSION,
        repr=False,
    )

    @field_validator("contract_version")
    @classmethod
    def validate_contract_version(cls, value: str) -> str:
        if value != CONTRACT_VERSION:
            raise PydanticCustomError(
                "invalid_contract_version", "Invalid contract version."
            )
        return value

    @field_validator("model_content_hash")
    @classmethod
    def validate_model_content_hash(cls, value: str) -> str:
        if value != MODEL_CONTENT_HASH:
            raise PydanticCustomError(
                "invalid_model_content_hash", "Invalid model content hash."
            )
        return value

    @field_validator("rule_vector_version")
    @classmethod
    def validate_rule_vector_version(cls, value: str) -> str:
        if value != RULE_VECTOR_VERSION:
            raise PydanticCustomError(
                "invalid_rule_vector_version", "Invalid rule vector version."
            )
        return value

    @field_validator("instruction_text")
    @classmethod
    def validate_instruction_text(cls, value: str) -> str:
        if not value.strip():
            raise PydanticCustomError(
                "empty_instruction_text", "Instruction text must not be empty."
            )
        return value

    @field_validator("rule_vector")
    @classmethod
    def validate_rule_vector(cls, value: list[float]) -> list[float]:
        if any(not math.isfinite(item) for item in value):
            raise PydanticCustomError(
                "non_finite_rule_vector", "Rule vector values must be finite."
            )
        return value


class RoutingDifficultyClassifyResponse(CamelModel):
    contract_version: str = Field(alias="contractVersion", default=CONTRACT_VERSION)
    status: Literal["ready"] = "ready"
    difficulty: Literal["simple", "complex"]
    model_version: str = Field(alias="modelVersion", default=MODEL_VERSION)
    model_content_hash: str = Field(
        alias="modelContentHash", default=MODEL_CONTENT_HASH
    )
