from __future__ import annotations

import math
import re
from typing import Literal

from pydantic import Field, field_validator
from pydantic_core import PydanticCustomError

from app.schemas.routing_difficulty import RULE_VECTOR_DIMENSION, RULE_VECTOR_VERSION
from app.schemas.safety import CamelModel


CONTRACT_VERSION = "gatelm.internal.routing-difficulty-lightgbm-shadow.v1"
MODEL_VERSION_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,159}$")
CONTENT_HASH_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")


class RoutingLightGBMShadowClassifyRequest(CamelModel):
    contract_version: str = Field(alias="contractVersion")
    model_version: str = Field(alias="modelVersion", min_length=1, max_length=160)
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

    @field_validator("model_version")
    @classmethod
    def validate_model_version(cls, value: str) -> str:
        if not MODEL_VERSION_PATTERN.fullmatch(value):
            raise PydanticCustomError("invalid_model_version", "Invalid model version.")
        return value

    @field_validator("model_content_hash")
    @classmethod
    def validate_model_content_hash(cls, value: str) -> str:
        if not CONTENT_HASH_PATTERN.fullmatch(value):
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
        if any(not math.isfinite(item) or item < 0 or item > 1 for item in value):
            raise PydanticCustomError(
                "invalid_rule_vector", "Rule vector values must be finite and within range."
            )
        return value


class RoutingLightGBMShadowClassifyResponse(CamelModel):
    contract_version: str = Field(alias="contractVersion", default=CONTRACT_VERSION)
    status: Literal["ready"] = "ready"
    difficulty: Literal["simple", "complex"]
    model_version: str = Field(alias="modelVersion")
    model_content_hash: str = Field(alias="modelContentHash")
