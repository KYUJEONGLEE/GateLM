from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES


CONTRACT_VERSION = "remote-safety.v1"
ENGINE_VERSION = "safety-lab-local"
AI_SAFETY_DETECTOR_CONTRACT_VERSION = "ai-safety-detector.v1"
AI_SAFETY_DETECTOR_MODEL_ID = "openai/privacy-filter"
AI_SAFETY_DETECTOR_RUNTIME = "cpu_only"


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class RemoteSafetyContext(CamelModel):
    request_id: str = Field(alias="requestId", min_length=1)
    trace_id: str = Field(alias="traceId", min_length=1)
    tenant_id: str = Field(alias="tenantId", min_length=1)
    project_id: str = Field(alias="projectId", min_length=1)
    application_id: str = Field(alias="applicationId", min_length=1)
    config_hash: str = Field(alias="configHash", min_length=1)
    security_policy_hash: str = Field(alias="securityPolicyHash", min_length=1)
    routing_policy_hash: str | None = Field(alias="routingPolicyHash")
    policy_mode: Literal["rule_based"] = Field(alias="policyMode")
    remote_safety_mode: Literal["shadow"] = Field(alias="remoteSafetyMode")


class SafetyDetector(CamelModel):
    type: str = Field(min_length=1)
    enabled: bool
    action: Literal["redact", "block"]
    placeholder: str = Field(min_length=1)

    @field_validator("type")
    @classmethod
    def validate_detector_type(cls, value: str) -> str:
        if value not in ALLOWED_DETECTOR_TYPES:
            raise PydanticCustomError("unsupported_detector_type", "Unsupported detector type.")
        return value


class RemoteSafetyInput(CamelModel):
    prompt_text: str = Field(alias="promptText", min_length=1, repr=False)
    request_body_hash: str = Field(alias="requestBodyHash", min_length=1)
    requested_model: str = Field(alias="requestedModel", min_length=1)
    detectors: list[SafetyDetector] = Field(min_length=1)


class RemoteSafetyEvaluateRequest(CamelModel):
    contract_version: str = Field(alias="contractVersion")
    ctx: RemoteSafetyContext
    input: RemoteSafetyInput

    @field_validator("contract_version")
    @classmethod
    def validate_contract_version(cls, value: str) -> str:
        if value != CONTRACT_VERSION:
            raise PydanticCustomError("invalid_contract_version", "Invalid contract version.")
        return value


class SafetyDecisionResponse(CamelModel):
    action: Literal["none", "redacted", "blocked"]
    detected_types: list[str] = Field(alias="detectedTypes")
    detected_count: int = Field(alias="detectedCount", ge=0)
    redacted_prompt_preview: str | None = Field(alias="redactedPromptPreview")
    block_reason: str | None = Field(alias="blockReason")
    security_policy_hash: str = Field(alias="securityPolicyHash")


class RemoteSafetyMetadata(CamelModel):
    contract_version: str = Field(alias="contractVersion", default=CONTRACT_VERSION)
    engine_version: str = Field(alias="engineVersion", default=ENGINE_VERSION)
    latency_ms: int = Field(alias="latencyMs", ge=0)
    detected_type_counts: dict[str, int] = Field(alias="detectedTypeCounts", default_factory=dict)


class RemoteSafetyEvaluateResponse(CamelModel):
    decision: SafetyDecisionResponse
    metadata: RemoteSafetyMetadata


class AiSafetyDetectorModel(CamelModel):
    model_id: str = Field(alias="modelId", default=AI_SAFETY_DETECTOR_MODEL_ID)
    runtime: Literal["cpu_only"] = AI_SAFETY_DETECTOR_RUNTIME


class AiSafetyDetectorInput(CamelModel):
    prompt_text: str = Field(alias="promptText", min_length=1, repr=False)
    locale: str | None = Field(default=None)


class AiSafetyDetectorConfig(CamelModel):
    detector_set: str = Field(alias="detectorSet", default="privacy-filter-default", min_length=1)
    return_confidence: bool = Field(alias="returnConfidence", default=True)


class AiSafetyDetectRequest(CamelModel):
    contract_version: str = Field(alias="contractVersion")
    mode: Literal["shadow"] = "shadow"
    model: AiSafetyDetectorModel = Field(default_factory=AiSafetyDetectorModel)
    input: AiSafetyDetectorInput
    detector_config: AiSafetyDetectorConfig = Field(
        alias="detectorConfig",
        default_factory=AiSafetyDetectorConfig,
    )

    @field_validator("contract_version")
    @classmethod
    def validate_ai_safety_contract_version(cls, value: str) -> str:
        if value != AI_SAFETY_DETECTOR_CONTRACT_VERSION:
            raise PydanticCustomError("invalid_contract_version", "Invalid contract version.")
        return value


class AiSafetyDetectorSummary(CamelModel):
    detected_count: int = Field(alias="detectedCount", ge=0)
    detector_categories: list[str] = Field(alias="detectorCategories")


class AiSafetyDetection(CamelModel):
    detector_type: str = Field(alias="detectorType", min_length=1)
    source: str = Field(min_length=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    action: Literal["allow", "redact", "block"]
    mode: Literal["shadow"] = "shadow"


class AiSafetyDetectResponse(CamelModel):
    contract_version: str = Field(
        alias="contractVersion",
        default=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    )
    model: AiSafetyDetectorModel
    outcome: Literal["passed", "redacted", "blocked"]
    mode: Literal["shadow"] = "shadow"
    redacted_prompt: str = Field(alias="redactedPrompt")
    redacted_prompt_preview: str | None = Field(alias="redactedPromptPreview")
    detector_summary: AiSafetyDetectorSummary = Field(alias="detectorSummary")
    detections: list[AiSafetyDetection]
    latency_ms: int = Field(alias="latencyMs", ge=0)
