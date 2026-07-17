from __future__ import annotations

from pathlib import Path

from app.core.config import Settings
from app.domain.rag_extraction.chunker import (
    CHUNKER_VERSION,
    ChunkingConfig,
    RagChunker,
)
from app.domain.rag_extraction.errors import (
    ERROR_EMPTY_TEXT,
    ERROR_UNSUPPORTED_MEDIA_TYPE,
    RagExtractionError,
)
from app.domain.rag_extraction.models import ExtractionResult
from app.domain.rag_extraction.normalization import normalize_txt
from app.domain.rag_extraction.parsers import (
    PDF_PARSER_VERSION,
    TXT_PARSER_VERSION,
    PdfParseConfig,
    parse_pdf,
)


CONTENT_TYPE_TXT = "text/plain"
CONTENT_TYPE_PDF = "application/pdf"


class RagExtractionService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._chunker = RagChunker(
            ChunkingConfig(
                target_tokens=settings.rag_chunk_target_tokens,
                overlap_tokens=settings.rag_chunk_overlap_tokens,
                max_tokens=settings.rag_chunk_max_tokens,
                max_chunks=settings.rag_max_chunks,
            )
        )

    def extract(self, path: Path, content_type: str) -> ExtractionResult:
        if content_type == CONTENT_TYPE_TXT:
            segments = normalize_txt(path.read_bytes())
            parser_version = TXT_PARSER_VERSION
        elif content_type == CONTENT_TYPE_PDF:
            with path.open("rb") as handle:
                if handle.read(5) != b"%PDF-":
                    from app.domain.rag_extraction.errors import ERROR_INVALID_PDF

                    raise RagExtractionError(
                        ERROR_INVALID_PDF,
                        "The PDF document is invalid or damaged.",
                    )
            segments = parse_pdf(
                path,
                PdfParseConfig(
                    max_pages=self._settings.rag_max_pdf_pages,
                    max_extracted_chars=self._settings.rag_max_extracted_chars,
                    min_text_chars=self._settings.rag_min_pdf_text_chars,
                    timeout_seconds=self._settings.rag_pdf_parse_timeout_seconds,
                    memory_limit_bytes=self._settings.rag_pdf_memory_limit_bytes,
                    cpu_limit_seconds=self._settings.rag_pdf_cpu_limit_seconds,
                ),
            )
            parser_version = PDF_PARSER_VERSION
        else:
            raise RagExtractionError(
                ERROR_UNSUPPORTED_MEDIA_TYPE,
                "Only UTF-8 TXT and text-layer PDF documents are supported.",
                status_code=415,
            )

        if not segments:
            raise RagExtractionError(
                ERROR_EMPTY_TEXT,
                "The document has no extractable text.",
            )
        chunks = self._chunker.chunk(segments, parser_version)
        if not chunks:
            raise RagExtractionError(
                ERROR_EMPTY_TEXT,
                "The document has no extractable text.",
            )
        return ExtractionResult(
            chunks=tuple(chunks),
            parser_version=parser_version,
            chunker_version=CHUNKER_VERSION,
        )
