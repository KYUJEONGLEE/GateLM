from __future__ import annotations

import re
import unicodedata

from app.domain.rag_extraction.models import SourceSegment


HORIZONTAL_WHITESPACE = re.compile(r"[^\S\n]+")


def normalize_line(line: str) -> str:
    """Apply NFC and collapse horizontal whitespace without removing paragraph breaks."""

    without_nul = line.replace("\x00", "")
    normalized = unicodedata.normalize("NFC", without_nul)
    return HORIZONTAL_WHITESPACE.sub(" ", normalized).strip()


def normalize_txt(raw: bytes) -> list[SourceSegment]:
    try:
        decoded = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as exc:
        from app.domain.rag_extraction.errors import (
            ERROR_INVALID_ENCODING,
            RagExtractionError,
        )

        raise RagExtractionError(
            ERROR_INVALID_ENCODING,
            "The TXT document must be valid UTF-8.",
        ) from exc

    decoded = decoded.replace("\r\n", "\n").replace("\r", "\n")
    segments: list[SourceSegment] = []
    paragraph_lines: list[str] = []
    paragraph_start = 0

    def flush(end_line: int) -> None:
        nonlocal paragraph_lines, paragraph_start
        if not paragraph_lines:
            return
        text = "\n".join(paragraph_lines).strip()
        if text:
            segments.append(
                SourceSegment(
                    text=text,
                    line_start=paragraph_start,
                    line_end=end_line,
                    metadata={"sourceType": "txt"},
                )
            )
        paragraph_lines = []
        paragraph_start = 0

    for line_number, raw_line in enumerate(decoded.split("\n"), start=1):
        line = normalize_line(raw_line)
        if not line:
            flush(line_number - 1)
            continue
        if not paragraph_lines:
            paragraph_start = line_number
        paragraph_lines.append(line)
    flush(max(1, len(decoded.split("\n"))))
    return segments


def normalize_pdf_page(text: str, page_number: int) -> list[SourceSegment]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    segments: list[SourceSegment] = []
    paragraph: list[str] = []

    def flush() -> None:
        nonlocal paragraph
        if not paragraph:
            return
        normalized = "\n".join(paragraph).strip()
        if normalized:
            segments.append(
                SourceSegment(
                    text=normalized,
                    page_start=page_number,
                    page_end=page_number,
                    metadata={"sourceType": "pdf", "pageNumber": page_number},
                )
            )
        paragraph = []

    for raw_line in text.split("\n"):
        line = normalize_line(raw_line)
        if not line:
            flush()
        else:
            paragraph.append(line)
    flush()
    return segments
