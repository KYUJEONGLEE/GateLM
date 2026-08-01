from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Any, Protocol

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.schemas.safety import (
    AiSafetyBatchDetectRequest,
    AiSafetyBatchDetectResponse,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
)
from app.services.ai_safety_detector import AiSafetyDetectorService


PII_SHADOW_CAPTURE_HEADER = "X-GateLM-PII-Shadow-Capture"
PII_SHADOW_ENVELOPE_VERSION = "gatelm.pii-shadow-envelope.v1"
PII_SHADOW_AGGREGATE_VERSION = "gatelm.pii-shadow-aggregate.v1"
_PII_SHADOW_AAD = PII_SHADOW_ENVELOPE_VERSION.encode("ascii")
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, repr=False)
class _EncryptedShadowItem:
    nonce: bytes
    ciphertext: bytes
    captured_at: float
    stored_bytes: int


class EncryptedPiiShadowBuffer:
    """Process-local, bounded and encrypted storage for transient evaluation input."""

    def __init__(
        self,
        *,
        maximum_items: int,
        maximum_bytes: int,
        ttl_seconds: int,
        clock: Callable[[], float] = time.monotonic,
        key: bytes | None = None,
    ) -> None:
        if maximum_items < 1 or maximum_bytes < 1 or ttl_seconds < 1:
            raise ValueError("PII Shadow buffer bounds must be positive.")
        self._maximum_items = maximum_items
        self._maximum_bytes = maximum_bytes
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._aead = AESGCM(key or AESGCM.generate_key(bit_length=256))
        self._items: deque[_EncryptedShadowItem] = deque()
        self._stored_bytes = 0
        self._captured = 0
        self._expired = 0
        self._evicted = 0
        self._oversized = 0
        self._decrypt_errors = 0
        self._lock = threading.Lock()

    def capture(self, envelope: dict[str, Any]) -> bool:
        plaintext = bytearray(
            json.dumps(
                envelope,
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        )
        try:
            nonce = os.urandom(12)
            ciphertext = self._aead.encrypt(nonce, bytes(plaintext), _PII_SHADOW_AAD)
        finally:
            plaintext[:] = b"\x00" * len(plaintext)

        stored_bytes = len(nonce) + len(ciphertext)
        with self._lock:
            now = self._clock()
            self._evict_expired_locked(now)
            if stored_bytes > self._maximum_bytes:
                self._oversized += 1
                return False
            while self._items and (
                len(self._items) >= self._maximum_items
                or self._stored_bytes + stored_bytes > self._maximum_bytes
            ):
                self._discard_left_locked()
                self._evicted += 1
            self._items.append(
                _EncryptedShadowItem(
                    nonce=nonce,
                    ciphertext=ciphertext,
                    captured_at=now,
                    stored_bytes=stored_bytes,
                )
            )
            self._stored_bytes += stored_bytes
            self._captured += 1
        return True

    def pop(self) -> dict[str, Any] | None:
        with self._lock:
            self._evict_expired_locked(self._clock())
            if not self._items:
                return None
            item = self._items.popleft()
            self._stored_bytes -= item.stored_bytes

        plaintext: bytearray | None = None
        try:
            plaintext = bytearray(
                self._aead.decrypt(item.nonce, item.ciphertext, _PII_SHADOW_AAD)
            )
            decoded = json.loads(plaintext.decode("utf-8"))
            if not isinstance(decoded, dict):
                raise ValueError("PII Shadow envelope must be an object.")
            return decoded
        except Exception:
            with self._lock:
                self._decrypt_errors += 1
            return None
        finally:
            if plaintext is not None:
                plaintext[:] = b"\x00" * len(plaintext)

    def has_pending(self) -> bool:
        with self._lock:
            self._evict_expired_locked(self._clock())
            return bool(self._items)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._stored_bytes = 0

    def safe_snapshot(self) -> dict[str, int]:
        with self._lock:
            self._evict_expired_locked(self._clock())
            return {
                "pendingItems": len(self._items),
                "storedBytes": self._stored_bytes,
                "capturedItems": self._captured,
                "expiredItems": self._expired,
                "evictedItems": self._evicted,
                "oversizedItems": self._oversized,
                "decryptErrors": self._decrypt_errors,
            }

    def _evict_expired_locked(self, now: float) -> None:
        while self._items and now - self._items[0].captured_at >= self._ttl_seconds:
            self._discard_left_locked()
            self._expired += 1

    def _discard_left_locked(self) -> None:
        item = self._items.popleft()
        self._stored_bytes -= item.stored_bytes


class PiiShadowEvaluator:
    def __init__(
        self,
        *,
        buffer: EncryptedPiiShadowBuffer,
        candidate_service_factory: Callable[[], AiSafetyDetectorService],
        candidate_model_id: str,
        candidate_model_version: str,
        maximum_latency_samples: int = 5_000,
    ) -> None:
        if not 1 <= maximum_latency_samples <= 5_000:
            raise ValueError("PII Shadow latency sample bound must be 1..5000.")
        self._buffer = buffer
        self._candidate_service_factory = candidate_service_factory
        self._candidate_service: AiSafetyDetectorService | None = None
        self._candidate_model_id = candidate_model_id
        self._candidate_model_version = candidate_model_version
        self._compared = 0
        self._matches = 0
        self._mismatches = 0
        self._inference_errors = 0
        self._capture_errors = 0
        self._paused_for_live = 0
        self._baseline_latencies: deque[int] = deque(maxlen=maximum_latency_samples)
        self._candidate_latencies: deque[int] = deque(maxlen=maximum_latency_samples)
        self._lock = threading.Lock()

    def capture_single(
        self,
        request: AiSafetyDetectRequest,
        response: AiSafetyDetectResponse,
    ) -> bool:
        return self._capture(
            {
                "schemaVersion": PII_SHADOW_ENVELOPE_VERSION,
                "kind": "single",
                "request": request.model_dump(by_alias=True),
                "baseline": _single_comparison(response),
                "baselineLatencyMs": response.latency_ms,
            }
        )

    def capture_batch(
        self,
        request: AiSafetyBatchDetectRequest,
        response: AiSafetyBatchDetectResponse,
    ) -> bool:
        return self._capture(
            {
                "schemaVersion": PII_SHADOW_ENVELOPE_VERSION,
                "kind": "batch",
                "request": request.model_dump(by_alias=True),
                "baseline": _batch_comparison(response),
                "baselineLatencyMs": response.latency_ms,
            }
        )

    def process_next(self) -> bool:
        envelope = self._buffer.pop()
        if envelope is None:
            return False
        try:
            if envelope.get("schemaVersion") != PII_SHADOW_ENVELOPE_VERSION:
                raise ValueError("Unsupported PII Shadow envelope.")
            kind = envelope.get("kind")
            candidate = self._candidate()
            if kind == "single":
                request = AiSafetyDetectRequest.model_validate(envelope["request"])
                response = candidate.detect(request)
                comparison = _single_comparison(response)
            elif kind == "batch":
                request = AiSafetyBatchDetectRequest.model_validate(envelope["request"])
                response = candidate.detect_batch(request)
                comparison = _batch_comparison(response)
            else:
                raise ValueError("Unsupported PII Shadow request kind.")

            baseline_latency = _safe_latency(envelope.get("baselineLatencyMs"))
            candidate_latency = _safe_latency(response.latency_ms)
            matched = comparison == envelope.get("baseline")
            with self._lock:
                self._compared += 1
                self._matches += int(matched)
                self._mismatches += int(not matched)
                self._baseline_latencies.append(baseline_latency)
                self._candidate_latencies.append(candidate_latency)
        except Exception:
            with self._lock:
                self._inference_errors += 1
        return True

    def has_pending(self) -> bool:
        return self._buffer.has_pending()

    def record_live_pause(self) -> None:
        with self._lock:
            self._paused_for_live += 1

    def safe_snapshot(self) -> dict[str, Any]:
        with self._lock:
            compared = self._compared
            matches = self._matches
            comparison = {
                "comparedItems": compared,
                "matchedItems": matches,
                "mismatchedItems": self._mismatches,
                "inferenceErrors": self._inference_errors,
                "captureErrors": self._capture_errors,
                "pausedForLiveRequests": self._paused_for_live,
                "agreementPercent": (
                    round(matches * 100 / compared, 3) if compared else None
                ),
            }
            baseline_latencies = list(self._baseline_latencies)
            candidate_latencies = list(self._candidate_latencies)
        return {
            "schemaVersion": PII_SHADOW_AGGREGATE_VERSION,
            "candidate": {
                "modelId": self._candidate_model_id,
                "version": self._candidate_model_version,
            },
            "buffer": self._buffer.safe_snapshot(),
            "comparison": comparison,
            "latencyMs": {
                "baseline": _latency_summary(baseline_latencies),
                "candidate": _latency_summary(candidate_latencies),
            },
        }

    def close(self) -> None:
        self._buffer.clear()
        self._candidate_service = None

    def _capture(self, envelope: dict[str, Any]) -> bool:
        try:
            return self._buffer.capture(envelope)
        except Exception:
            with self._lock:
                self._capture_errors += 1
            return False

    def _candidate(self) -> AiSafetyDetectorService:
        candidate = self._candidate_service
        if candidate is None:
            candidate = self._candidate_service_factory()
            candidate.warmup()
            self._candidate_service = candidate
        return candidate


class LiveInferenceGate(Protocol):
    async def is_idle(self) -> bool: ...


class PiiShadowWorker:
    def __init__(
        self,
        *,
        evaluator: PiiShadowEvaluator,
        live_gate: LiveInferenceGate,
        timezone_name: str,
        window_start_hour: int,
        window_end_hour: int,
        poll_interval_seconds: float,
        now: Callable[[tzinfo], datetime] = datetime.now,
    ) -> None:
        self._evaluator = evaluator
        self._live_gate = live_gate
        self._timezone = _shadow_timezone(timezone_name)
        self._window_start_hour = window_start_hour
        self._window_end_hour = window_end_hour
        self._poll_interval_seconds = poll_interval_seconds
        self._now = now
        self._stop = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        if self._task is None:
            self._stop.clear()
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        task = self._task
        self._task = None
        if task is not None:
            await task
        self._evaluator.close()

    async def process_available(
        self,
        *,
        maximum_items: int | None = None,
        ignore_window: bool = False,
    ) -> int:
        processed = 0
        while self._evaluator.has_pending():
            if maximum_items is not None and processed >= maximum_items:
                break
            if not ignore_window and not self._inside_window():
                break
            if not await self._live_gate.is_idle():
                self._evaluator.record_live_pause()
                break
            if not await asyncio.to_thread(self._evaluator.process_next):
                break
            processed += 1
            await asyncio.sleep(0)
        return processed

    async def _run(self) -> None:
        while not self._stop.is_set():
            processed = await self.process_available()
            if processed:
                _LOGGER.info(
                    "PII Shadow aggregate %s",
                    json.dumps(
                        self._evaluator.safe_snapshot(),
                        ensure_ascii=True,
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                )
            try:
                await asyncio.wait_for(
                    self._stop.wait(), timeout=self._poll_interval_seconds
                )
            except TimeoutError:
                continue

    def _inside_window(self) -> bool:
        hour = self._now(self._timezone).hour
        if self._window_start_hour < self._window_end_hour:
            return self._window_start_hour <= hour < self._window_end_hour
        return hour >= self._window_start_hour or hour < self._window_end_hour


def is_shadow_capture_requested(header_value: str | None) -> bool:
    return header_value == "1"


def _single_comparison(response: AiSafetyDetectResponse) -> dict[str, Any]:
    return {
        "outcome": response.outcome,
        "redactedPrompt": response.redacted_prompt,
        "logSafePrompt": response.log_safe_prompt,
        "redactedPromptPreview": response.redacted_prompt_preview,
        "detectorSummary": response.detector_summary.model_dump(by_alias=True),
        "detections": _comparable_detections(response.detections),
        "executionSummary": response.execution_summary.model_dump(by_alias=True),
    }


def _batch_comparison(response: AiSafetyBatchDetectResponse) -> dict[str, Any]:
    return {
        "results": [
            {
                "itemIndex": item.item_index,
                "outcome": item.outcome,
                "redactedPrompt": item.redacted_prompt,
                "logSafePrompt": item.log_safe_prompt,
                "redactedPromptPreview": item.redacted_prompt_preview,
                "detectorSummary": item.detector_summary.model_dump(by_alias=True),
                "detections": _comparable_detections(item.detections),
            }
            for item in response.results
        ],
        "executionSummary": response.execution_summary.model_dump(by_alias=True),
    }


def _comparable_detections(detections: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "detectorType": detection.detector_type,
            "action": detection.action,
            "mode": detection.mode,
        }
        for detection in detections
    ]


def _safe_latency(value: object) -> int:
    if isinstance(value, bool):
        return 0
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def _latency_summary(values: list[int]) -> dict[str, int | None]:
    if not values:
        return {"count": 0, "p50": None, "p95": None, "p99": None, "max": None}
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "p50": _nearest_rank(ordered, 0.50),
        "p95": _nearest_rank(ordered, 0.95),
        "p99": _nearest_rank(ordered, 0.99),
        "max": ordered[-1],
    }


def _nearest_rank(ordered: list[int], percentile: float) -> int:
    index = max(0, min(len(ordered) - 1, int(len(ordered) * percentile + 0.999999) - 1))
    return ordered[index]


def _shadow_timezone(timezone_name: str) -> tzinfo:
    if timezone_name == "UTC":
        return timezone.utc
    if timezone_name == "Asia/Seoul":
        return timezone(timedelta(hours=9), name="Asia/Seoul")
    raise ValueError("Unsupported PII Shadow timezone.")
