from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import (
    RagExtractionConcurrencyGate,
    get_rag_extraction_concurrency_gate,
    get_rag_extraction_service,
    get_settings,
)
from app.api.rag_auth import require_rag_service_auth
from app.core.config import Settings
from app.domain.rag_extraction.errors import (
    ERROR_INPUT_TOO_LARGE,
    ERROR_UNAVAILABLE,
    ERROR_UNSUPPORTED_MEDIA_TYPE,
    RagExtractionError,
)
from app.domain.rag_extraction.temp_files import (
    RAG_TEMP_FILE_PREFIX,
    RAG_TEMP_FILE_SUFFIX,
)
from app.schemas.rag_extraction import RagExtractionChunkResponse, RagExtractionResponse
from app.services.rag_extraction import (
    CONTENT_TYPE_PDF,
    CONTENT_TYPE_TXT,
    RagExtractionService,
)


router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/internal/v1/rag/extract",
    response_model=RagExtractionResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_rag_service_auth)],
)
async def extract_rag_document(
    request: Request,
    settings: Settings = Depends(get_settings),
    service: RagExtractionService = Depends(get_rag_extraction_service),
    concurrency_gate: RagExtractionConcurrencyGate = Depends(
        get_rag_extraction_concurrency_gate
    ),
) -> RagExtractionResponse:
    async with concurrency_gate:
        return await _extract_rag_document(request, settings, service)


async def _extract_rag_document(
    request: Request,
    settings: Settings,
    service: RagExtractionService,
) -> RagExtractionResponse:
    content_type = _parse_content_type(request.headers.get("content-type", ""))
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=RAG_TEMP_FILE_PREFIX,
            suffix=RAG_TEMP_FILE_SUFFIX,
            dir=settings.rag_temp_dir,
            delete=False,
        ) as file:
            temporary_path = Path(file.name)
            byte_count = 0
            async for block in request.stream():
                byte_count += len(block)
                if byte_count > settings.rag_max_input_bytes:
                    raise RagExtractionError(
                        ERROR_INPUT_TOO_LARGE,
                        "The document exceeds the configured size limit.",
                        status_code=413,
                    )
                file.write(block)
        if byte_count == 0:
            from app.domain.rag_extraction.errors import ERROR_EMPTY_TEXT

            raise RagExtractionError(
                ERROR_EMPTY_TEXT, "The document has no extractable text."
            )
        result = await run_in_threadpool(service.extract, temporary_path, content_type)
        return RagExtractionResponse(
            chunks=[
                RagExtractionChunkResponse(
                    ordinal=chunk.ordinal,
                    text=chunk.text,
                    token_count=chunk.token_count,
                    page_start=chunk.page_start,
                    page_end=chunk.page_end,
                    line_start=chunk.line_start,
                    line_end=chunk.line_end,
                    source_metadata=chunk.source_metadata,
                    parser_version=chunk.parser_version,
                    chunker_version=chunk.chunker_version,
                )
                for chunk in result.chunks
            ],
            parser_version=result.parser_version,
            chunker_version=result.chunker_version,
        )
    except RagExtractionError:
        raise
    except Exception as exc:
        logger.error(
            "RAG extraction failed with sanitized internal error. exception_class=%s",
            type(exc).__name__,
            extra={"error_code": ERROR_UNAVAILABLE},
        )
        raise RagExtractionError(
            ERROR_UNAVAILABLE,
            "RAG extraction service is unavailable.",
            status_code=500,
            retryable=True,
        ) from None
    finally:
        if temporary_path is not None:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass
            except OSError:
                logger.error(
                    "RAG extraction temporary file cleanup failed.",
                    extra={"error_code": "RAG_EXTRACTION_TEMP_CLEANUP_FAILED"},
                )


def _parse_content_type(raw_content_type: str) -> str:
    parts = [part.strip().lower() for part in raw_content_type.split(";")]
    media_type = parts[0]
    parameters = {part for part in parts[1:] if part}
    if media_type == CONTENT_TYPE_TXT:
        if parameters and parameters != {"charset=utf-8"}:
            raise RagExtractionError(
                ERROR_UNSUPPORTED_MEDIA_TYPE,
                "TXT documents must declare UTF-8 when a charset is provided.",
                status_code=415,
            )
        return CONTENT_TYPE_TXT
    if media_type == CONTENT_TYPE_PDF and not parameters:
        return CONTENT_TYPE_PDF
    raise RagExtractionError(
        ERROR_UNSUPPORTED_MEDIA_TYPE,
        "Only UTF-8 TXT and text-layer PDF documents are supported.",
        status_code=415,
    )
