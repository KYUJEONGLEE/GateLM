from __future__ import annotations

import unittest
from collections.abc import Mapping
from typing import Any

from app.adapters.safety.azure_pii_adapter import AzurePiiAdapter


class AzurePiiAdapterTests(unittest.TestCase):
    def test_detect_many_posts_language_pii_payload_and_maps_categories(self) -> None:
        calls: list[tuple[str, Mapping[str, Any], Mapping[str, str], float]] = []

        def requester(
            url: str,
            payload: Mapping[str, Any],
            headers: Mapping[str, str],
            timeout_seconds: float,
        ) -> object:
            calls.append((url, payload, headers, timeout_seconds))
            return {
                "results": {
                    "documents": [
                        {
                            "id": "0",
                            "entities": [
                                {
                                    "text": "alex@example.test",
                                    "category": "Email",
                                    "offset": 8,
                                    "length": 17,
                                    "confidenceScore": 0.99,
                                }
                            ],
                        }
                    ],
                    "errors": [],
                }
            }

        adapter = AzurePiiAdapter(
            endpoint="http://localhost:5000/",
            api_key="secret-key",
            allowed_detector_types=frozenset({"email"}),
            requester=requester,
        )

        result = adapter.detect_many(["Contact alex@example.test"], batch_size=10)

        self.assertEqual(result.model_invocation_count, 1)
        self.assertEqual(result.detections[0][0].detector_type, "email")
        self.assertEqual(result.detections[0][0].source, "azure_ai_language_pii")
        self.assertEqual(result.detections[0][0].start, 8)
        self.assertEqual(result.detections[0][0].end, 25)
        url, payload, headers, timeout_seconds = calls[0]
        self.assertEqual(
            url,
            "http://localhost:5000/language/:analyze-text?api-version=2024-11-01",
        )
        self.assertEqual(payload["kind"], "PiiEntityRecognition")
        self.assertEqual(payload["parameters"]["stringIndexType"], "UnicodeCodePoint")
        self.assertEqual(payload["analysisInput"]["documents"][0]["language"], "ko")
        self.assertEqual(headers["Ocp-Apim-Subscription-Key"], "secret-key")
        self.assertEqual(timeout_seconds, 0.75)

    def test_detect_many_rejects_partial_response_without_leaking_text(self) -> None:
        def requester(
            _url: str,
            _payload: Mapping[str, Any],
            _headers: Mapping[str, str],
            _timeout_seconds: float,
        ) -> object:
            return {
                "results": {
                    "documents": [
                        {
                            "id": "0",
                            "entities": [],
                        }
                    ],
                    "errors": [],
                }
            }

        adapter = AzurePiiAdapter(
            endpoint="http://localhost:5000",
            requester=requester,
        )

        with self.assertRaisesRegex(RuntimeError, "Azure PII detector request failed"):
            adapter.detect_many(["secret one", "secret two"])

    def test_low_confidence_entities_are_discarded(self) -> None:
        def requester(
            _url: str,
            _payload: Mapping[str, Any],
            _headers: Mapping[str, str],
            _timeout_seconds: float,
        ) -> object:
            return {
                "results": {
                    "documents": [
                        {
                            "id": "0",
                            "entities": [
                                {
                                    "category": "Person",
                                    "offset": 0,
                                    "length": 3,
                                    "confidenceScore": 0.80,
                                }
                            ],
                        }
                    ],
                    "errors": [],
                }
            }

        adapter = AzurePiiAdapter(
            endpoint="http://localhost:5000",
            allowed_detector_types=frozenset({"person_name"}),
            requester=requester,
        )

        self.assertEqual(adapter.detect_many(["홍길동"]).detections, [[]])


if __name__ == "__main__":
    unittest.main()
