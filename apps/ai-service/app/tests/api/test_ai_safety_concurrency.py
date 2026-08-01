from __future__ import annotations

import asyncio
import threading
import time
import unittest
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.privacy_filter_adapter import source_for_model
from app.api.dependencies import (
    AiSafetyConcurrencyGate,
    get_ai_safety_detector_service,
)
from app.api.routes.ai_safety import (
    _try_acquire_while_connected,
    detect_ai_safety,
    detect_ai_safety_batch,
)
from app.core.config import Settings
from app.main import create_app
from app.schemas.safety import (
    AiSafetyBatchDetectRequest,
    AiSafetyBatchDetectResponse,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
)
from app.services.ai_safety_detector import AiSafetyDetectorService


class AiSafetyConcurrencyGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_gate_rejects_work_above_capacity_without_queueing(self) -> None:
        gate = AiSafetyConcurrencyGate(
            2,
            waiting_capacity=0,
            wait_timeout_ms=50,
        )

        acquired = await asyncio.gather(
            *(gate.try_acquire() for _ in range(8))
        )

        self.assertEqual(acquired, [True, True, False, False, False, False, False, False])
        await gate.release()
        await gate.release()
        self.assertTrue(await gate.try_acquire())
        await gate.release()

    async def test_wait_timeout_zero_preserves_immediate_rejection(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=0,
        )

        self.assertTrue(await gate.try_acquire())
        self.assertFalse(await gate.try_acquire())
        await gate.release()

    async def test_gate_admits_bounded_waiter_after_release(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )
        self.assertTrue(await gate.try_acquire())
        waiter = asyncio.create_task(gate.try_acquire())
        await asyncio.sleep(0)
        self.assertFalse(waiter.done())

        await gate.release()

        self.assertTrue(await asyncio.wait_for(waiter, timeout=0.2))
        await gate.release()

    async def test_gate_rejects_when_waiting_capacity_is_full(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )
        self.assertTrue(await gate.try_acquire())
        waiter = asyncio.create_task(gate.try_acquire())
        await asyncio.sleep(0)
        self.assertFalse(waiter.done())

        self.assertFalse(await gate.try_acquire())

        await gate.release()
        self.assertTrue(await asyncio.wait_for(waiter, timeout=0.2))
        await gate.release()

    async def test_gate_timeout_releases_waiting_capacity(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=100,
        )
        self.assertTrue(await gate.try_acquire())

        self.assertFalse(await gate.try_acquire())

        replacement = asyncio.create_task(gate.try_acquire())
        await asyncio.sleep(0)
        self.assertFalse(replacement.done())
        await gate.release()
        self.assertTrue(await asyncio.wait_for(replacement, timeout=0.2))
        await gate.release()

    async def test_waiting_cancellation_releases_waiting_capacity(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )
        self.assertTrue(await gate.try_acquire())
        cancelled_waiter = asyncio.create_task(gate.try_acquire())
        await asyncio.sleep(0)
        self.assertFalse(cancelled_waiter.done())

        cancelled_waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await cancelled_waiter

        replacement = asyncio.create_task(gate.try_acquire())
        await asyncio.sleep(0)
        self.assertFalse(replacement.done())
        await gate.release()
        self.assertTrue(await asyncio.wait_for(replacement, timeout=0.2))
        await gate.release()

    async def test_timeout_cleanup_survives_external_cancellation(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=20,
        )
        self.assertTrue(await gate.try_acquire())
        timed_out = asyncio.create_task(gate.try_acquire())
        await asyncio.sleep(0)

        await gate._lock.acquire()
        try:
            await asyncio.sleep(0.05)
            timed_out.cancel()
        finally:
            gate._lock.release()

        with self.assertRaises(asyncio.CancelledError):
            await timed_out
        await gate.release()
        await wait_for_gate_idle(gate)

        self.assertTrue(await gate.try_acquire())
        await gate.release()

    async def test_gate_hands_off_permits_to_waiters_in_fifo_order(self) -> None:
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=3,
            wait_timeout_ms=500,
        )
        self.assertTrue(await gate.try_acquire())
        order: list[str] = []

        async def wait_for_slot(name: str) -> bool:
            acquired = await gate.try_acquire()
            if acquired:
                order.append(name)
            return acquired

        first = asyncio.create_task(wait_for_slot("first"))
        await asyncio.sleep(0)
        second = asyncio.create_task(wait_for_slot("second"))
        await asyncio.sleep(0)

        await gate.release()
        newcomer = asyncio.create_task(wait_for_slot("newcomer"))

        self.assertTrue(await asyncio.wait_for(first, timeout=0.2))
        self.assertFalse(second.done())
        self.assertFalse(newcomer.done())
        await gate.release()
        self.assertTrue(await asyncio.wait_for(second, timeout=0.2))
        self.assertFalse(newcomer.done())
        await gate.release()
        self.assertTrue(await asyncio.wait_for(newcomer, timeout=0.2))
        self.assertEqual(order, ["first", "second", "newcomer"])
        await gate.release()

    async def test_disconnected_request_withdraws_queued_waiter(self) -> None:
        class DisconnectedRequest:
            async def is_disconnected(self) -> bool:
                return True

        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )
        self.assertTrue(await gate.try_acquire())

        acquired = await _try_acquire_while_connected(  # type: ignore[arg-type]
            DisconnectedRequest(), gate
        )

        self.assertFalse(acquired)
        await gate.release()
        self.assertTrue(await gate.try_acquire())
        await gate.release()

    async def test_disconnect_wins_when_permit_is_immediately_available(
        self,
    ) -> None:
        class DisconnectedRequest:
            async def is_disconnected(self) -> bool:
                return True

        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )

        acquired = await _try_acquire_while_connected(  # type: ignore[arg-type]
            DisconnectedRequest(),
            gate,
        )
        if acquired:
            await gate.release()

        self.assertFalse(acquired)
        self.assertTrue(await gate.try_acquire())
        await gate.release()

    async def test_helper_cancellation_after_acquire_does_not_leak_permit(
        self,
    ) -> None:
        class ConnectedRequest:
            async def is_disconnected(self) -> bool:
                return False

        class CancelHelperOnAcquireGate(AiSafetyConcurrencyGate):
            helper_task: asyncio.Task[bool] | None = None

            async def try_acquire(self) -> bool:
                acquired = await super().try_acquire()
                if acquired and self.helper_task is not None:
                    asyncio.get_running_loop().call_soon(
                        self.helper_task.cancel
                    )
                return acquired

        gate = CancelHelperOnAcquireGate(
            1,
            waiting_capacity=0,
            wait_timeout_ms=50,
        )
        helper = asyncio.create_task(
            _try_acquire_while_connected(  # type: ignore[arg-type]
                ConnectedRequest(),
                gate,
            )
        )
        gate.helper_task = helper

        with self.assertRaises(asyncio.CancelledError):
            await helper
        await wait_for_gate_idle(gate)

        self.assertTrue(await gate.try_acquire())
        await gate.release()

    async def test_single_and_batch_routes_share_non_blocking_limit(self) -> None:
        single_request = detect_request()
        batch_request = batch_detect_request()
        reference_service = fake_detector_service()
        service = TrackingService(
            single_response=reference_service.detect(single_request),
            batch_response=reference_service.detect_batch(batch_request),
            delay_seconds=0.03,
        )
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=0,
            wait_timeout_ms=50,
        )

        results = await asyncio.gather(
            detect_ai_safety(single_request, service, gate),  # type: ignore[arg-type]
            detect_ai_safety_batch(batch_request, service, gate),  # type: ignore[arg-type]
            return_exceptions=True,
        )

        successful = [
            result
            for result in results
            if isinstance(result, (AiSafetyDetectResponse, AiSafetyBatchDetectResponse))
        ]
        rejected = [
            result for result in results if isinstance(result, JSONResponse)
        ]
        self.assertEqual(len(successful), 1)
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0].status_code, 503)
        self.assertIn(
            b'"code":"sidecar_unavailable"',
            rejected[0].body,
        )
        self.assertEqual(service.peak_active, 1)
        self.assertEqual(service.active, 0)
        self.assertGreaterEqual(len(service.worker_thread_ids), 1)
        self.assertNotIn(threading.get_ident(), service.worker_thread_ids)

    async def test_single_and_batch_routes_share_bounded_wait(self) -> None:
        single_request = detect_request()
        batch_request = batch_detect_request()
        reference_service = fake_detector_service()
        service = TrackingService(
            single_response=reference_service.detect(single_request),
            batch_response=reference_service.detect_batch(batch_request),
            delay_seconds=0.03,
        )
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )

        results = await asyncio.gather(
            detect_ai_safety(single_request, service, gate),  # type: ignore[arg-type]
            detect_ai_safety_batch(batch_request, service, gate),  # type: ignore[arg-type]
        )

        self.assertTrue(
            any(isinstance(result, AiSafetyDetectResponse) for result in results)
        )
        self.assertTrue(
            any(
                isinstance(result, AiSafetyBatchDetectResponse)
                for result in results
            )
        )
        self.assertEqual(service.peak_active, 1)
        self.assertEqual(service.active, 0)

    async def test_route_exception_releases_shared_limit(self) -> None:
        request = detect_request()
        gate = AiSafetyConcurrencyGate(1)

        with self.assertRaisesRegex(RuntimeError, "synthetic inference failure"):
            await detect_ai_safety(  # type: ignore[arg-type]
                request,
                ExplodingService(),
                gate,
            )

        reference_response = fake_detector_service().detect(request)
        service = TrackingService(single_response=reference_response)
        response = await asyncio.wait_for(
            detect_ai_safety(request, service, gate),  # type: ignore[arg-type]
            timeout=0.5,
        )

        self.assertEqual(response.contract_version, "ai-safety-detector.v1")
        self.assertEqual(service.peak_active, 1)

    async def test_route_cancellation_releases_shared_limit(self) -> None:
        request = detect_request()
        reference_response = fake_detector_service().detect(request)
        service = TrackingService(
            single_response=reference_response,
            delay_seconds=0.05,
        )
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=1,
            wait_timeout_ms=200,
        )

        task = asyncio.create_task(
            detect_ai_safety(request, service, gate)  # type: ignore[arg-type]
        )
        started = await asyncio.to_thread(service.started.wait, 0.5)
        self.assertTrue(started)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

        response = await asyncio.wait_for(
            detect_ai_safety(request, service, gate),  # type: ignore[arg-type]
            timeout=0.5,
        )
        self.assertEqual(response.contract_version, "ai-safety-detector.v1")
        self.assertEqual(service.active, 0)

    async def test_route_cancellation_holds_permit_until_worker_finishes(
        self,
    ) -> None:
        request = detect_request()
        reference_response = fake_detector_service().detect(request)
        service = BlockingService(reference_response)
        gate = AiSafetyConcurrencyGate(
            1,
            waiting_capacity=0,
            wait_timeout_ms=50,
        )

        task = asyncio.create_task(
            detect_ai_safety(request, service, gate)  # type: ignore[arg-type]
        )
        started = await asyncio.to_thread(service.started.wait, 0.5)
        self.assertTrue(started)

        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

        probe = await gate.try_acquire()
        if probe:
            await gate.release()
        self.assertFalse(probe)
        self.assertEqual(service.peak_active, 1)

        service.unblock.set()
        finished = await asyncio.to_thread(service.finished.wait, 0.5)
        self.assertTrue(finished)
        await wait_for_gate_idle(gate)

        self.assertTrue(await gate.try_acquire())
        await gate.release()


class AiSafetyConcurrencyHttpTests(unittest.TestCase):
    def test_app_state_gate_times_out_concurrent_single_and_batch_requests(self) -> None:
        single_request = detect_request()
        batch_request = batch_detect_request()
        reference_service = fake_detector_service()
        service = TrackingService(
            single_response=reference_service.detect(single_request),
            batch_response=reference_service.detect_batch(batch_request),
            delay_seconds=0.08,
        )
        app = create_app(
            Settings(
                ai_safety_max_concurrent=1,
                ai_safety_max_pending=1,
                ai_safety_wait_timeout_ms=10,
            )
        )
        app.dependency_overrides[get_ai_safety_detector_service] = lambda: service

        with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(
                client.post,
                "/internal/ai-safety/v1/detect",
                json=single_request.model_dump(by_alias=True),
            )
            self.assertTrue(service.started.wait(timeout=0.5))
            busy = client.post(
                "/internal/ai-safety/v1/detect/batch",
                json=batch_request.model_dump(by_alias=True),
            )
            completed = first.result(timeout=1)
            recovered = client.post(
                "/internal/ai-safety/v1/detect",
                json=single_request.model_dump(by_alias=True),
            )

        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(busy.status_code, 503, busy.text)
        self.assertEqual(
            busy.json()["contractVersion"],
            "ai-safety-detector-batch.v1",
        )
        self.assertEqual(
            busy.json()["error"]["code"],
            "sidecar_unavailable",
        )
        self.assertTrue(busy.json()["error"]["retryable"])
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(service.peak_active, 1)

    def test_app_state_gate_waits_for_bounded_pending_request(self) -> None:
        single_request = detect_request()
        batch_request = batch_detect_request()
        reference_service = fake_detector_service()
        service = TrackingService(
            single_response=reference_service.detect(single_request),
            batch_response=reference_service.detect_batch(batch_request),
            delay_seconds=0.04,
        )
        app = create_app(
            Settings(
                ai_safety_max_concurrent=1,
                ai_safety_max_pending=1,
                ai_safety_wait_timeout_ms=200,
            )
        )
        app.dependency_overrides[get_ai_safety_detector_service] = lambda: service

        with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
            first = executor.submit(
                client.post,
                "/internal/ai-safety/v1/detect",
                json=single_request.model_dump(by_alias=True),
            )
            self.assertTrue(service.started.wait(timeout=0.5))
            waited = client.post(
                "/internal/ai-safety/v1/detect/batch",
                json=batch_request.model_dump(by_alias=True),
            )
            completed = first.result(timeout=1)

        self.assertEqual(completed.status_code, 200, completed.text)
        self.assertEqual(waited.status_code, 200, waited.text)
        self.assertEqual(service.peak_active, 1)
        self.assertEqual(service.active, 0)


class BlockingService:
    def __init__(self, response: AiSafetyDetectResponse) -> None:
        self._response = response
        self._lock = threading.Lock()
        self.active = 0
        self.peak_active = 0
        self.started = threading.Event()
        self.unblock = threading.Event()
        self.finished = threading.Event()

    def detect(
        self,
        _request: AiSafetyDetectRequest,
    ) -> AiSafetyDetectResponse:
        with self._lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
            self.started.set()
        try:
            if not self.unblock.wait(timeout=1):
                raise AssertionError("blocking detector was not released")
            return self._response
        finally:
            with self._lock:
                self.active -= 1
            self.finished.set()


class TrackingService:
    def __init__(
        self,
        *,
        single_response: AiSafetyDetectResponse | None = None,
        batch_response: AiSafetyBatchDetectResponse | None = None,
        delay_seconds: float = 0.0,
    ) -> None:
        self._single_response = single_response
        self._batch_response = batch_response
        self._delay_seconds = delay_seconds
        self._lock = threading.Lock()
        self.active = 0
        self.peak_active = 0
        self.worker_thread_ids: set[int] = set()
        self.started = threading.Event()

    def detect(self, _request: AiSafetyDetectRequest) -> AiSafetyDetectResponse:
        if self._single_response is None:
            raise AssertionError("single response was not configured")
        return self._run(lambda: self._single_response)

    def detect_batch(
        self,
        _request: AiSafetyBatchDetectRequest,
    ) -> AiSafetyBatchDetectResponse:
        if self._batch_response is None:
            raise AssertionError("batch response was not configured")
        return self._run(lambda: self._batch_response)

    def _run(self, result: Callable[[], Any]) -> Any:
        with self._lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
            self.worker_thread_ids.add(threading.get_ident())
            self.started.set()
        try:
            if self._delay_seconds:
                time.sleep(self._delay_seconds)
            return result()
        finally:
            with self._lock:
                self.active -= 1


class ExplodingService:
    def detect(self, _request: AiSafetyDetectRequest) -> AiSafetyDetectResponse:
        raise RuntimeError("synthetic inference failure")


async def wait_for_gate_idle(
    gate: AiSafetyConcurrencyGate,
    *,
    timeout: float = 0.5,
) -> None:
    async with asyncio.timeout(timeout):
        while gate._active != 0 or gate._waiters:
            await asyncio.sleep(0.005)


def fake_detector_service() -> AiSafetyDetectorService:
    model_name = "openai/privacy-filter"
    return AiSafetyDetectorService(
        adapters=(
            PrivacyFilterAdapter(  # type: ignore[arg-type]
                classifier=lambda _text: [],
                model_name=model_name,
                source=source_for_model(model_name),
            ),
        ),
    )


def detect_request() -> AiSafetyDetectRequest:
    return AiSafetyDetectRequest.model_validate(
        {
            "contractVersion": "ai-safety-detector.v1",
            "mode": "shadow",
            "input": {
                "promptText": "Write a safe synthetic handoff.",
                "locale": "en-US",
            },
            "detectorConfig": {
                "detectorSet": "privacy-filter-default",
                "returnConfidence": False,
            },
        }
    )


def batch_detect_request() -> AiSafetyBatchDetectRequest:
    return AiSafetyBatchDetectRequest.model_validate(
        {
            "contractVersion": "ai-safety-detector-batch.v1",
            "mode": "shadow",
            "inputs": [
                {
                    "itemIndex": 0,
                    "promptText": "Write a safe synthetic handoff.",
                    "locale": "en-US",
                }
            ],
            "detectorConfig": {
                "detectorSet": "privacy-filter-default",
                "returnConfidence": False,
            },
        }
    )
