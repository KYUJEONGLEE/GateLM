from __future__ import annotations

import importlib
import multiprocessing
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    _resource: Any = importlib.import_module("resource")
except ImportError:  # Windows local/test compatibility.
    _resource = None

from pypdf import PdfReader

from app.domain.rag_extraction.errors import (
    ERROR_ENCRYPTED_PDF,
    ERROR_EXTRACTED_TEXT_LIMIT,
    ERROR_INVALID_PDF,
    ERROR_PDF_PAGE_LIMIT,
    ERROR_PDF_TIMEOUT,
    ERROR_SCANNED_PDF,
    RagExtractionError,
)
from app.domain.rag_extraction.models import SourceSegment
from app.domain.rag_extraction.normalization import normalize_pdf_page


TXT_PARSER_VERSION = "utf8-nfc-text-v1"
PDF_PARSER_VERSION = "pypdf-6.14.2-text-v1"


@dataclass(frozen=True)
class PdfParseConfig:
    max_pages: int
    max_extracted_chars: int
    min_text_chars: int
    timeout_seconds: float
    memory_limit_bytes: int
    cpu_limit_seconds: int


def parse_pdf(path: Path, config: PdfParseConfig) -> list[SourceSegment]:
    context = multiprocessing.get_context("spawn")
    parent, child = context.Pipe(duplex=False)
    process = context.Process(
        target=_pdf_worker,
        args=(
            str(path),
            config.max_pages,
            config.max_extracted_chars,
            config.memory_limit_bytes,
            config.cpu_limit_seconds,
            child,
        ),
        daemon=True,
    )
    process.start()
    child.close()
    try:
        if not parent.poll(config.timeout_seconds):
            process.terminate()
            process.join(timeout=1)
            if process.is_alive():
                process.kill()
                process.join(timeout=1)
            raise RagExtractionError(
                ERROR_PDF_TIMEOUT,
                "PDF parsing timed out.",
                status_code=408,
                retryable=True,
            )
        payload = parent.recv()
    except EOFError as exc:
        raise RagExtractionError(
            ERROR_INVALID_PDF,
            "The PDF document is invalid or damaged.",
        ) from exc
    finally:
        parent.close()
        if process.is_alive():
            process.join(timeout=1)
        if process.is_alive():
            process.terminate()
            process.join(timeout=1)

    if not isinstance(payload, dict) or payload.get("ok") is not True:
        code = payload.get("code") if isinstance(payload, dict) else ERROR_INVALID_PDF
        if code == ERROR_ENCRYPTED_PDF:
            raise RagExtractionError(code, "Encrypted PDF documents are not supported.")
        if code == ERROR_PDF_PAGE_LIMIT:
            raise RagExtractionError(
                code,
                "The PDF document exceeds the configured page limit.",
                status_code=413,
            )
        if code == ERROR_EXTRACTED_TEXT_LIMIT:
            raise RagExtractionError(
                code,
                "The extracted text exceeds the configured limit.",
                status_code=413,
            )
        raise RagExtractionError(
            ERROR_INVALID_PDF,
            "The PDF document is invalid or damaged.",
        )

    pages = payload.get("pages")
    if not isinstance(pages, list):
        raise RagExtractionError(
            ERROR_INVALID_PDF, "The PDF document is invalid or damaged."
        )

    segments: list[SourceSegment] = []
    visible_character_count = 0
    for page_number, page_text in enumerate(pages, start=1):
        if not isinstance(page_text, str):
            raise RagExtractionError(
                ERROR_INVALID_PDF, "The PDF document is invalid or damaged."
            )
        page_segments = normalize_pdf_page(page_text, page_number)
        visible_character_count += sum(
            1
            for segment in page_segments
            for char in segment.text
            if not char.isspace()
        )
        segments.extend(page_segments)

    if visible_character_count < config.min_text_chars:
        raise RagExtractionError(
            ERROR_SCANNED_PDF,
            "The PDF has no usable text layer; OCR is not supported.",
        )
    return segments


def _pdf_worker(
    path: str,
    max_pages: int,
    max_extracted_chars: int,
    memory_limit_bytes: int,
    cpu_limit_seconds: int,
    connection: Any,
) -> None:
    """Parse in an isolated process and return only stable codes or page text."""

    try:
        _apply_pdf_resource_limits(memory_limit_bytes, cpu_limit_seconds)
        reader = PdfReader(path, strict=True)
        if reader.is_encrypted:
            connection.send({"ok": False, "code": ERROR_ENCRYPTED_PDF})
            return
        if len(reader.pages) > max_pages:
            connection.send({"ok": False, "code": ERROR_PDF_PAGE_LIMIT})
            return
        pages: list[str] = []
        character_count = 0
        for page in reader.pages:
            text = page.extract_text() or ""
            character_count += len(text)
            if character_count > max_extracted_chars:
                connection.send({"ok": False, "code": ERROR_EXTRACTED_TEXT_LIMIT})
                return
            pages.append(text)
        connection.send({"ok": True, "pages": pages})
    except Exception:
        connection.send({"ok": False, "code": ERROR_INVALID_PDF})
    finally:
        connection.close()


def _apply_pdf_resource_limits(
    memory_limit_bytes: int,
    cpu_limit_seconds: int,
) -> None:
    if _resource is None:
        return
    _set_resource_limit(_resource.RLIMIT_AS, memory_limit_bytes)
    _set_resource_limit(_resource.RLIMIT_CPU, cpu_limit_seconds)


def _set_resource_limit(resource_kind: int, requested: int) -> None:
    if _resource is None:
        return
    _, inherited_hard = _resource.getrlimit(resource_kind)
    effective = requested
    if inherited_hard != _resource.RLIM_INFINITY:
        effective = min(effective, inherited_hard)
    if effective <= 0:
        raise OSError("PDF parser resource limit is unavailable")
    _resource.setrlimit(resource_kind, (effective, effective))
