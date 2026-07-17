from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SourceSegment:
    text: str
    page_start: int | None = None
    page_end: int | None = None
    line_start: int | None = None
    line_end: int | None = None
    metadata: dict[str, str | int] = field(default_factory=dict)


@dataclass(frozen=True)
class ExtractedChunk:
    ordinal: int
    text: str
    token_count: int
    page_start: int | None
    page_end: int | None
    line_start: int | None
    line_end: int | None
    source_metadata: dict[str, str | int]
    parser_version: str
    chunker_version: str


@dataclass(frozen=True)
class ExtractionResult:
    chunks: tuple[ExtractedChunk, ...]
    parser_version: str
    chunker_version: str
