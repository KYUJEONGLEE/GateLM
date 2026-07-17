from __future__ import annotations

import re
from dataclasses import dataclass

import tiktoken

from app.core.config import RAG_TOKENIZER_ENCODING, RAG_TOKENIZER_MODEL
from app.domain.rag_extraction.errors import ERROR_CHUNK_LIMIT, RagExtractionError
from app.domain.rag_extraction.models import ExtractedChunk, SourceSegment


CHUNKER_VERSION = "cl100k-base-chunker-v1"
SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?。！？])\s+")


@dataclass(frozen=True)
class ChunkingConfig:
    target_tokens: int
    overlap_tokens: int
    max_tokens: int
    max_chunks: int


@dataclass(frozen=True)
class _Piece:
    text: str
    source: SourceSegment
    standalone: bool = False


class RagChunker:
    def __init__(self, config: ChunkingConfig) -> None:
        self._config = config
        self._encoding = tiktoken.get_encoding(RAG_TOKENIZER_ENCODING)
        model_encoding = tiktoken.encoding_for_model(RAG_TOKENIZER_MODEL)
        if model_encoding.name != self._encoding.name:
            raise RuntimeError(
                "Configured RAG tokenizer does not match the embedding model"
            )

    def token_count(self, text: str) -> int:
        return len(self._encoding.encode(text, disallowed_special=()))

    def chunk(
        self, segments: list[SourceSegment], parser_version: str
    ) -> list[ExtractedChunk]:
        pieces: list[_Piece] = []
        for segment in segments:
            pieces.extend(self._split_segment(segment))

        chunks: list[ExtractedChunk] = []
        current_text = ""
        current_sources: list[SourceSegment] = []

        def emit() -> None:
            nonlocal current_text, current_sources
            text = current_text.strip()
            if not text:
                current_text = ""
                current_sources = []
                return
            count = self.token_count(text)
            if count > self._config.max_tokens:
                raise RuntimeError(
                    "Chunker produced a chunk over the configured maximum"
                )
            chunks.append(
                self._build_chunk(
                    ordinal=len(chunks),
                    text=text,
                    token_count=count,
                    sources=current_sources,
                    parser_version=parser_version,
                )
            )
            if len(chunks) > self._config.max_chunks:
                raise RagExtractionError(
                    ERROR_CHUNK_LIMIT,
                    "The document produces too many chunks.",
                    status_code=413,
                )
            current_text = ""
            current_sources = []

        for piece in pieces:
            if piece.standalone:
                emit()
                text = piece.text
                chunks.append(
                    self._build_chunk(
                        ordinal=len(chunks),
                        text=text,
                        token_count=self.token_count(text),
                        sources=[piece.source],
                        parser_version=parser_version,
                    )
                )
                if len(chunks) > self._config.max_chunks:
                    raise RagExtractionError(
                        ERROR_CHUNK_LIMIT,
                        "The document produces too many chunks.",
                        status_code=413,
                    )
                continue
            if (
                current_sources
                and current_sources[-1].page_start is not None
                and piece.source.page_start != current_sources[-1].page_start
            ):
                emit()
            separator = self._separator(current_sources, piece.source)
            candidate = (
                f"{current_text}{separator}{piece.text}" if current_text else piece.text
            )
            candidate_count = self.token_count(candidate)
            if current_text and candidate_count > self._config.target_tokens:
                previous_text = current_text
                previous_sources = list(current_sources)
                emit()
                overlap = self._tail(previous_text, self._config.overlap_tokens)
                separator = self._separator(previous_sources, piece.source)
                candidate = (
                    f"{overlap}{separator}{piece.text}" if overlap else piece.text
                )
                if self.token_count(candidate) > self._config.max_tokens:
                    overlap_budget = max(
                        0,
                        self._config.max_tokens - self.token_count(piece.text),
                    )
                    overlap = self._tail(previous_text, overlap_budget)
                    candidate = (
                        f"{overlap}{separator}{piece.text}" if overlap else piece.text
                    )
                current_text = candidate
                current_sources = (
                    [previous_sources[-1]] if overlap and previous_sources else []
                ) + [piece.source]
            else:
                current_text = candidate
                current_sources.append(piece.source)
        emit()
        return chunks

    def _split_segment(self, segment: SourceSegment) -> list[_Piece]:
        if self.token_count(segment.text) <= self._config.target_tokens:
            return [_Piece(segment.text, segment)]

        sentences = [
            part.strip()
            for part in SENTENCE_BOUNDARY.split(segment.text)
            if part.strip()
        ]
        if len(sentences) <= 1:
            return self._split_by_tokens(segment.text, segment)

        pieces: list[_Piece] = []
        current = ""
        for sentence in sentences:
            if self.token_count(sentence) > self._config.target_tokens:
                if current:
                    pieces.append(_Piece(current, segment))
                    current = ""
                pieces.extend(self._split_by_tokens(sentence, segment))
                continue
            candidate = f"{current} {sentence}" if current else sentence
            if current and self.token_count(candidate) > self._config.target_tokens:
                pieces.append(_Piece(current, segment))
                current = sentence
            else:
                current = candidate
        if current:
            pieces.append(_Piece(current, segment))
        return pieces

    def _split_by_tokens(self, text: str, source: SourceSegment) -> list[_Piece]:
        tokens = self._encoding.encode(text, disallowed_special=())
        step = self._config.target_tokens - self._config.overlap_tokens
        pieces: list[_Piece] = []
        for start in range(0, len(tokens), step):
            token_slice = tokens[start : start + self._config.target_tokens]
            if not token_slice:
                break
            decoded = self._encoding.decode(token_slice)
            if decoded.strip():
                pieces.append(_Piece(decoded, source, standalone=True))
            if start + self._config.target_tokens >= len(tokens):
                break
        return pieces

    def _tail(self, text: str, token_count: int) -> str:
        if token_count <= 0:
            return ""
        tokens = self._encoding.encode(text, disallowed_special=())
        return self._encoding.decode(tokens[-token_count:]).strip()

    @staticmethod
    def _separator(existing: list[SourceSegment], incoming: SourceSegment) -> str:
        if not existing:
            return ""
        previous = existing[-1]
        if (
            previous.page_start is not None
            and previous.page_start != incoming.page_start
        ):
            return "\n\n"
        if previous is incoming:
            return " "
        return "\n\n"

    @staticmethod
    def _build_chunk(
        *,
        ordinal: int,
        text: str,
        token_count: int,
        sources: list[SourceSegment],
        parser_version: str,
    ) -> ExtractedChunk:
        pages = [
            source.page_start for source in sources if source.page_start is not None
        ]
        page_ends = [
            source.page_end for source in sources if source.page_end is not None
        ]
        lines = [
            source.line_start for source in sources if source.line_start is not None
        ]
        line_ends = [
            source.line_end for source in sources if source.line_end is not None
        ]
        source_type = next(
            (
                str(source.metadata["sourceType"])
                for source in sources
                if "sourceType" in source.metadata
            ),
            "unknown",
        )
        metadata: dict[str, str | int] = {"sourceType": source_type}
        if pages and page_ends and min(pages) == max(page_ends):
            metadata["pageNumber"] = min(pages)
        return ExtractedChunk(
            ordinal=ordinal,
            text=text,
            token_count=token_count,
            page_start=min(pages) if pages else None,
            page_end=max(page_ends) if page_ends else None,
            line_start=min(lines) if lines else None,
            line_end=max(line_ends) if line_ends else None,
            source_metadata=metadata,
            parser_version=parser_version,
            chunker_version=CHUNKER_VERSION,
        )
