from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_MODEL,
    PrivacyFilterAdapter,
)
from app.core.config import Settings
from app.main import create_app
from app.schemas.safety import AiSafetyDetectRequest
from app.services.ai_safety_detector import AiSafetyDetectorService
from app.services.pii_shadow import (
    EncryptedPiiShadowBuffer,
    PII_SHADOW_CAPTURE_HEADER,
    PiiShadowEvaluator,
    PiiShadowWorker,
)


class EncryptedPiiShadowBufferTests(unittest.TestCase):
    def test_capture_encrypts_plaintext_and_pop_removes_item(self) -> None:
        buffer = EncryptedPiiShadowBuffer(
            maximum_items=5,
            maximum_bytes=10_000,
            ttl_seconds=60,
        )
        marker = "SYNTHETIC_SECRET_MARKER"

        self.assertTrue(buffer.capture({"promptText": marker}))
        item = buffer._items[0]  # encrypted-state assertion only
        self.assertNotIn(marker.encode("utf-8"), item.ciphertext)
        self.assertNotIn(marker, repr(item))
        self.assertEqual(buffer.pop(), {"promptText": marker})
        self.assertFalse(buffer.has_pending())

    def test_buffer_evicts_oldest_and_expires_by_ttl(self) -> None:
        now = [0.0]
        buffer = EncryptedPiiShadowBuffer(
            maximum_items=2,
            maximum_bytes=10_000,
            ttl_seconds=10,
            clock=lambda: now[0],
        )
        buffer.capture({"item": 1})
        buffer.capture({"item": 2})
        buffer.capture({"item": 3})

        snapshot = buffer.safe_snapshot()
        self.assertEqual(snapshot["pendingItems"], 2)
        self.assertEqual(snapshot["evictedItems"], 1)
        self.assertEqual(buffer.pop(), {"item": 2})

        now[0] = 11.0
        self.assertFalse(buffer.has_pending())
        self.assertEqual(buffer.safe_snapshot()["expiredItems"], 1)


class PiiShadowEvaluatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_identical_candidate_matches_and_live_request_pauses_drain(self) -> None:
        baseline = detector_service()
        candidate = detector_service()
        request = detect_request()
        response = baseline.detect(request)
        evaluator = PiiShadowEvaluator(
            buffer=EncryptedPiiShadowBuffer(
                maximum_items=5,
                maximum_bytes=100_000,
                ttl_seconds=60,
            ),
            candidate_service_factory=lambda: candidate,
            candidate_model_id="gatelm/koelectra-small-v3-pii-ner",
            candidate_model_version="v0.1.1",
        )
        evaluator.capture_single(request, response)
        gate = ToggleGate(idle=False)
        worker = PiiShadowWorker(
            evaluator=evaluator,
            live_gate=gate,
            timezone_name="UTC",
            window_start_hour=2,
            window_end_hour=5,
            poll_interval_seconds=0.05,
            now=lambda _tz: datetime(2026, 8, 1, 3, tzinfo=timezone.utc),
        )

        self.assertEqual(
            await worker.process_available(ignore_window=True),
            0,
        )
        self.assertTrue(evaluator.has_pending())
        gate.idle = True
        self.assertEqual(
            await worker.process_available(ignore_window=True),
            1,
        )

        snapshot = evaluator.safe_snapshot()
        self.assertEqual(snapshot["buffer"]["pendingItems"], 0)
        self.assertEqual(snapshot["comparison"]["comparedItems"], 1)
        self.assertEqual(snapshot["comparison"]["matchedItems"], 1)
        self.assertEqual(snapshot["comparison"]["mismatchedItems"], 0)
        self.assertEqual(snapshot["comparison"]["pausedForLiveRequests"], 1)
        self.assertEqual(snapshot["comparison"]["agreementPercent"], 100.0)
        self.assertEqual(snapshot["comparison"]["modelActiveComparedItems"], 1)
        self.assertEqual(snapshot["comparison"]["baselineModelInvocations"], 1)
        self.assertEqual(snapshot["comparison"]["candidateModelInvocations"], 1)

    async def test_latency_samples_remain_bounded_while_totals_continue(self) -> None:
        service = detector_service()
        evaluator = PiiShadowEvaluator(
            buffer=EncryptedPiiShadowBuffer(
                maximum_items=5, maximum_bytes=100_000, ttl_seconds=60
            ),
            candidate_service_factory=lambda: service,
            candidate_model_id="gatelm/koelectra-small-v3-pii-ner",
            candidate_model_version="v0.1.1",
            maximum_latency_samples=2,
        )
        for _ in range(3):
            request = detect_request()
            evaluator.capture_single(request, service.detect(request))
            self.assertTrue(evaluator.process_next())

        snapshot = evaluator.safe_snapshot()
        self.assertEqual(snapshot["comparison"]["comparedItems"], 3)
        self.assertEqual(snapshot["latencyMs"]["baseline"]["count"], 2)
        self.assertEqual(snapshot["latencyMs"]["candidate"]["count"], 2)


class PiiShadowHttpE2ETests(unittest.TestCase):
    def test_sampled_http_request_is_captured_and_compared_without_raw_report(self) -> None:
        settings = Settings(
            ai_safety_detector_model_id=GATELM_KOELECTRA_PII_NER_MODEL,
            ai_safety_ml_allowed_detector_types=("person_name",),
            ai_safety_person_name_model_only=True,
        )
        app = create_app(settings)
        primary = detector_service()
        candidate = detector_service()
        evaluator = PiiShadowEvaluator(
            buffer=EncryptedPiiShadowBuffer(
                maximum_items=5,
                maximum_bytes=100_000,
                ttl_seconds=60,
            ),
            candidate_service_factory=lambda: candidate,
            candidate_model_id="gatelm/koelectra-small-v3-pii-ner",
            candidate_model_version="v0.1.1",
        )
        app.state.ai_safety_detector_service = primary
        app.state.pii_shadow_evaluator = evaluator

        with TestClient(app) as client:
            response = client.post(
                "/internal/ai-safety/v1/detect",
                headers={PII_SHADOW_CAPTURE_HEADER: "1"},
                json=detect_request().model_dump(by_alias=True),
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(evaluator.has_pending())

        worker = PiiShadowWorker(
            evaluator=evaluator,
            live_gate=app.state.ai_safety_concurrency_gate,
            timezone_name="UTC",
            window_start_hour=2,
            window_end_hour=5,
            poll_interval_seconds=0.05,
        )
        self.assertEqual(
            asyncio.run(worker.process_available(ignore_window=True)),
            1,
        )
        report = evaluator.safe_snapshot()
        serialized = str(report)
        self.assertEqual(report["comparison"]["agreementPercent"], 100.0)
        self.assertNotIn("김민수", serialized)
        self.assertNotIn("promptText", serialized)
        self.assertNotIn("redactedPrompt", serialized)


class ToggleGate:
    def __init__(self, *, idle: bool) -> None:
        self.idle = idle

    async def is_idle(self) -> bool:
        return self.idle


def detector_service() -> AiSafetyDetectorService:
    def classifier(text: str) -> list[dict[str, object]]:
        value = "김민수"
        start = text.find(value)
        if start < 0:
            return []
        return [
            {
                "entity_group": "PER",
                "start": start,
                "end": start + len(value),
                "score": 0.999,
            }
        ]

    adapter = PrivacyFilterAdapter(
        classifier=classifier,
        model_name=GATELM_KOELECTRA_PII_NER_MODEL,
        allowed_detector_types=frozenset({"person_name"}),
    )
    return AiSafetyDetectorService(
        adapter=adapter,
        ml_allowed_detector_types=("person_name",),
        person_name_model_only=True,
    )


def detect_request() -> AiSafetyDetectRequest:
    return AiSafetyDetectRequest.model_validate(
        {
            "contractVersion": "ai-safety-detector.v1",
            "mode": "enforce",
            "model": {
                "modelId": GATELM_KOELECTRA_PII_NER_MODEL,
                "runtime": "cpu_only",
            },
            "input": {"promptText": "이름: 김민수", "locale": "ko-KR"},
            "detectorConfig": {
                "detectorSet": "gatelm-koelectra-pii-ner-v1",
                "returnConfidence": False,
                "detectorPolicies": [],
            },
        }
    )


if __name__ == "__main__":
    unittest.main()
