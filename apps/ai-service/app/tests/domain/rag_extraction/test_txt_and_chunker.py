from __future__ import annotations

import unittest

from app.domain.rag_extraction.chunker import ChunkingConfig, RagChunker
from app.domain.rag_extraction.errors import ERROR_INVALID_ENCODING, RagExtractionError
from app.domain.rag_extraction.normalization import normalize_txt


class TxtNormalizationTests(unittest.TestCase):
    def test_normalizes_utf8_bom_nul_line_endings_and_nfc(self) -> None:
        segments = normalize_txt(
            b"\xef\xbb\xbfFirst\x00  line\r\nSecond\tline\r\n\r\nCafe\xcc\x81\n"
        )

        self.assertEqual(
            [segment.text for segment in segments],
            ["First line\nSecond line", "Caf\u00e9"],
        )
        self.assertEqual((segments[0].line_start, segments[0].line_end), (1, 2))
        self.assertEqual((segments[1].line_start, segments[1].line_end), (4, 4))

    def test_invalid_utf8_is_rejected_without_echoing_bytes(self) -> None:
        with self.assertRaises(RagExtractionError) as raised:
            normalize_txt(b"private-prefix-\xff-private-suffix")

        self.assertEqual(raised.exception.code, ERROR_INVALID_ENCODING)
        self.assertNotIn("private", raised.exception.message)

    def test_multiple_paragraphs_preserve_line_ranges(self) -> None:
        segments = normalize_txt(b"one\ncontinued\n\nsecond\n\nthird\n")

        self.assertEqual(
            [segment.text for segment in segments],
            ["one\ncontinued", "second", "third"],
        )
        self.assertEqual(
            [(segment.line_start, segment.line_end) for segment in segments],
            [(1, 2), (4, 4), (6, 6)],
        )


class RagChunkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.chunker = RagChunker(
            ChunkingConfig(
                target_tokens=40, overlap_tokens=8, max_tokens=60, max_chunks=100
            )
        )

    def test_long_single_paragraph_is_bounded_deterministic_and_overlapped(
        self,
    ) -> None:
        segments = normalize_txt(("token " * 240).encode("utf-8"))

        first = self.chunker.chunk(segments, "test-parser-v1")
        second = self.chunker.chunk(segments, "test-parser-v1")

        self.assertEqual(first, second)
        self.assertGreater(len(first), 1)
        self.assertTrue(all(0 < chunk.token_count <= 60 for chunk in first))
        encoding = self.chunker._encoding
        for previous, current in zip(first, first[1:]):
            previous_tail = encoding.encode(previous.text, disallowed_special=())[-8:]
            current_head = encoding.encode(current.text, disallowed_special=())[:8]
            self.assertEqual(previous_tail, current_head)

    def test_no_chunk_is_empty_and_ordinals_are_stable(self) -> None:
        chunks = self.chunker.chunk(
            normalize_txt(b"alpha\n\nbeta\n\ngamma"), "test-parser-v1"
        )

        self.assertEqual([chunk.ordinal for chunk in chunks], list(range(len(chunks))))
        self.assertTrue(all(chunk.text.strip() for chunk in chunks))
        self.assertEqual(chunks[0].line_start, 1)
        self.assertEqual(chunks[-1].line_end, 5)


if __name__ == "__main__":
    unittest.main()
