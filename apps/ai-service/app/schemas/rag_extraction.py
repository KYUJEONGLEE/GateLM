from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class RagExtractionChunkResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda value: _to_camel(value), populate_by_name=True
    )

    ordinal: int = Field(ge=0)
    text: str = Field(min_length=1)
    token_count: int = Field(gt=0)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    line_start: int | None = Field(default=None, ge=1)
    line_end: int | None = Field(default=None, ge=1)
    source_metadata: dict[str, str | int]
    parser_version: str
    chunker_version: str


class RagExtractionResponse(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda value: _to_camel(value), populate_by_name=True
    )

    chunks: list[RagExtractionChunkResponse]
    parser_version: str
    chunker_version: str
