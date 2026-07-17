from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.dependencies import RagExtractionConcurrencyGate
from app.core.config import Settings
from app.domain.rag_extraction.temp_files import (
    RAG_TEMP_FILE_PREFIX,
    RAG_TEMP_FILE_SUFFIX,
)
from app.main import create_app
from app.services.rag_extraction import RagExtractionService


SERVICE_TOKEN = "unit-rag-service-token-1234567890abcdef"
SENSITIVE_TEXT = "private-document-content-never-log"


class RagExtractionRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_directory.cleanup)
        self.settings = Settings(
            rag_service_token=SERVICE_TOKEN,
            rag_chunk_target_tokens=40,
            rag_chunk_overlap_tokens=8,
            rag_chunk_max_tokens=60,
            rag_max_input_bytes=4096,
            rag_temp_dir=self.temp_directory.name,
        )

    def test_authentication_is_required_and_response_does_not_echo_input(self) -> None:
        client = TestClient(create_app(self.settings))
        for headers in (
            {"content-type": "text/plain"},
            {
                "content-type": "text/plain",
                "x-gatelm-ai-service-token": "wrong-service-token",
            },
        ):
            with self.subTest(headers=headers):
                response = client.post(
                    "/internal/v1/rag/extract",
                    content=SENSITIVE_TEXT,
                    headers=headers,
                )

                self.assertEqual(response.status_code, 401, response.text)
                self.assertEqual(
                    response.json()["error"]["code"],
                    "RAG_EXTRACTION_AUTH_REQUIRED",
                )
                self.assertNotIn(SENSITIVE_TEXT, response.text)

    def test_authenticated_txt_returns_chunks_and_line_locations(self) -> None:
        client = TestClient(create_app(self.settings))

        response = client.post(
            "/internal/v1/rag/extract",
            content=b"\xef\xbb\xbfFirst paragraph.\r\n\r\nSecond paragraph.",
            headers=self._headers("text/plain; charset=utf-8"),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["parserVersion"], "utf8-nfc-text-v1")
        self.assertEqual(body["chunkerVersion"], "cl100k-base-chunker-v1")
        self.assertEqual(body["chunks"][0]["lineStart"], 1)
        self.assertEqual(body["chunks"][-1]["lineEnd"], 3)
        self.assertTrue(all(chunk["tokenCount"] <= 60 for chunk in body["chunks"]))

    def test_empty_invalid_encoding_unsupported_type_and_size_are_rejected(
        self,
    ) -> None:
        client = TestClient(create_app(self.settings))
        cases = [
            (b"", "text/plain", 400, "RAG_EXTRACTION_EMPTY_TEXT"),
            (b" \n\t\x00", "text/plain", 400, "RAG_EXTRACTION_EMPTY_TEXT"),
            (b"prefix\xffsuffix", "text/plain", 400, "RAG_EXTRACTION_INVALID_ENCODING"),
            (b"data", "text/html", 415, "RAG_EXTRACTION_UNSUPPORTED_MEDIA_TYPE"),
            (b"x" * 4097, "text/plain", 413, "RAG_EXTRACTION_INPUT_TOO_LARGE"),
        ]

        for content, content_type, status, code in cases:
            with self.subTest(code=code):
                response = client.post(
                    "/internal/v1/rag/extract",
                    content=content,
                    headers=self._headers(content_type),
                )
                self.assertEqual(response.status_code, status, response.text)
                self.assertEqual(response.json()["error"]["code"], code)
                self.assertNotIn("prefix", json.dumps(response.json()))

    def test_temporary_file_is_deleted_after_success_and_failure(self) -> None:
        temp_dir = Path(self.settings.rag_temp_dir)
        before = set(temp_dir.glob(f"{RAG_TEMP_FILE_PREFIX}*{RAG_TEMP_FILE_SUFFIX}"))
        client = TestClient(create_app(self.settings))

        success = client.post(
            "/internal/v1/rag/extract",
            content=b"temporary content",
            headers=self._headers("text/plain"),
        )
        failure = client.post(
            "/internal/v1/rag/extract",
            content=b"invalid\xff",
            headers=self._headers("text/plain"),
        )

        self.assertEqual(success.status_code, 200, success.text)
        self.assertEqual(failure.status_code, 400, failure.text)
        after = set(temp_dir.glob(f"{RAG_TEMP_FILE_PREFIX}*{RAG_TEMP_FILE_SUFFIX}"))
        self.assertEqual(after, before)

    def test_startup_removes_only_stale_rag_source_files(self) -> None:
        temp_dir = Path(self.settings.rag_temp_dir)
        stale = temp_dir / f"{RAG_TEMP_FILE_PREFIX}stale{RAG_TEMP_FILE_SUFFIX}"
        unrelated = temp_dir / "keep.txt"
        stale.write_text(SENSITIVE_TEXT, encoding="utf-8")
        unrelated.write_text("keep", encoding="utf-8")

        create_app(self.settings)

        self.assertFalse(stale.exists())
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep")

    def test_non_local_startup_requires_a_pre_mounted_temp_directory(self) -> None:
        missing = Path(self.temp_directory.name) / "missing-rag-tmpfs"
        settings = Settings(
            deployment_mode="production",
            rag_service_token=SERVICE_TOKEN,
            rag_temp_dir=str(missing),
        )

        with self.assertRaisesRegex(ValueError, "pre-mounted directory"):
            create_app(settings)

    def test_concurrency_gate_bounds_parallel_extractions(self) -> None:
        async def scenario() -> int:
            gate = RagExtractionConcurrencyGate(1)
            active = 0
            maximum = 0

            async def use_slot() -> None:
                nonlocal active, maximum
                async with gate:
                    active += 1
                    maximum = max(maximum, active)
                    await asyncio.sleep(0.01)
                    active -= 1

            await asyncio.gather(use_slot(), use_slot(), use_slot())
            return maximum

        self.assertEqual(asyncio.run(scenario()), 1)

    def test_unexpected_error_is_sanitized_in_response_and_log(self) -> None:
        app = create_app(self.settings)
        app.state.rag_extraction_service = ExplodingRagExtractionService(self.settings)
        client = TestClient(app, raise_server_exceptions=False)

        with self.assertLogs("app.api.routes.rag_extraction", level="ERROR") as logs:
            response = client.post(
                "/internal/v1/rag/extract",
                content=SENSITIVE_TEXT,
                headers=self._headers("text/plain"),
            )

        combined = response.text + "\n" + "\n".join(logs.output)
        self.assertEqual(response.status_code, 500, response.text)
        self.assertEqual(response.json()["error"]["code"], "RAG_EXTRACTION_UNAVAILABLE")
        self.assertNotIn(SENSITIVE_TEXT, combined)
        self.assertNotIn("exploded", combined)

    @staticmethod
    def _headers(content_type: str) -> dict[str, str]:
        return {
            "content-type": content_type,
            "x-gatelm-ai-service-token": SERVICE_TOKEN,
        }


class ExplodingRagExtractionService(RagExtractionService):
    def extract(self, path: Path, content_type: str):  # type: ignore[no-untyped-def]
        del path, content_type
        raise RuntimeError(f"exploded with {SENSITIVE_TEXT}")


if __name__ == "__main__":
    unittest.main()
