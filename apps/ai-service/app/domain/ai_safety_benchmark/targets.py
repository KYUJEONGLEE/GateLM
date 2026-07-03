from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any, Protocol

from app.domain.ai_safety_benchmark.types import (
    CONTRACT_VERSION,
    MODEL_ID,
    BenchmarkError,
    TargetResult,
)


FORBIDDEN_RESPONSE_FIELDS = {
    "rawPrompt",
    "rawValue",
    "rawDetectedValue",
    "detectedValue",
    "rawSpan",
    "span",
    "offset",
    "start",
    "end",
    "word",
    "rawErrorBody",
    "requestId",
    "traceId",
    "sampleHash",
    "promptHash",
}


class BenchmarkTarget(Protocol):
    def detect(self, prompt_text: str, *, locale: str | None, timeout_ms: int) -> TargetResult:
        ...


@dataclass
class HttpBenchmarkTarget:
    endpoint_url: str
    model_id: str = MODEL_ID

    def detect(self, prompt_text: str, *, locale: str | None, timeout_ms: int) -> TargetResult:
        try:
            import httpx  # type: ignore[import-not-found]
        except Exception as exc:
            raise BenchmarkError("http target requires the benchmark or test extra with httpx installed") from exc

        started = perf_counter()
        try:
            response = httpx.post(
                self.endpoint_url,
                json=build_request_payload(
                    prompt_text,
                    locale=locale,
                    model_id=self.model_id,
                ),
                timeout=timeout_ms / 1000,
            )
            full_latency_ms = elapsed_ms(started)
        except httpx.TimeoutException:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=elapsed_ms(started),
                sidecar_outcome="timeout",
                fallback_mode="regex_only",
                sanitized_error_code="timeout",
            )
        except httpx.HTTPError:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=elapsed_ms(started),
                sidecar_outcome="error",
                fallback_mode="regex_only",
                sanitized_error_code="http_error",
            )

        if response.status_code != 200:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=full_latency_ms,
                sidecar_outcome="error",
                fallback_mode="regex_only",
                sanitized_error_code=f"http_{response.status_code}",
            )

        try:
            body = response.json()
        except ValueError:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=full_latency_ms,
                sidecar_outcome="invalid_response",
                fallback_mode="regex_only",
                sanitized_error_code="invalid_json",
            )
        return result_from_response_body(body, full_latency_ms=full_latency_ms, timeout_ms=timeout_ms)


@dataclass
class InProcessBenchmarkTarget:
    service: object
    model_id: str = MODEL_ID

    @classmethod
    def create(cls, *, model_id: str = MODEL_ID) -> InProcessBenchmarkTarget:
        from app.services.ai_safety_detector import AiSafetyDetectorService

        return cls(
            service=AiSafetyDetectorService(model_id=model_id),
            model_id=model_id,
        )

    def detect(self, prompt_text: str, *, locale: str | None, timeout_ms: int) -> TargetResult:
        from app.schemas.safety import AiSafetyDetectRequest

        started = perf_counter()
        try:
            request = AiSafetyDetectRequest.model_validate(
                build_request_payload(prompt_text, locale=locale, model_id=self.model_id)
            )
            response = self.service.detect(request)
        except Exception:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=elapsed_ms(started),
                sidecar_outcome="error",
                fallback_mode="regex_only",
                sanitized_error_code="in_process_error",
            )
        full_latency_ms = elapsed_ms(started)
        if full_latency_ms > timeout_ms:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=full_latency_ms,
                sidecar_outcome="timeout",
                fallback_mode="regex_only",
                sanitized_error_code="timeout",
            )
        body = response.model_dump(by_alias=True)
        return result_from_response_body(body, full_latency_ms=full_latency_ms, timeout_ms=timeout_ms)


def build_request_payload(
    prompt_text: str,
    *,
    locale: str | None,
    model_id: str = MODEL_ID,
) -> dict[str, object]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "mode": "shadow",
        "model": {
            "modelId": model_id,
            "runtime": "cpu_only",
        },
        "input": {
            "promptText": prompt_text,
            "locale": locale,
        },
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": True,
        },
    }


def result_from_response_body(body: Any, *, full_latency_ms: int, timeout_ms: int) -> TargetResult:
    if not isinstance(body, dict):
        return TargetResult(
            sidecar_latency_ms=None,
            full_safety_latency_ms=full_latency_ms,
            sidecar_outcome="invalid_response",
            fallback_mode="regex_only",
            sanitized_error_code="non_object_response",
        )
    forbidden_field = first_forbidden_response_field(body)
    if forbidden_field is not None:
        return TargetResult(
            sidecar_latency_ms=None,
            full_safety_latency_ms=full_latency_ms,
            sidecar_outcome="invalid_response",
            fallback_mode="regex_only",
            sanitized_error_code="forbidden_response_field",
        )
    latency_ms = body.get("latencyMs")
    if not isinstance(latency_ms, int) or latency_ms < 0:
        return TargetResult(
            sidecar_latency_ms=None,
            full_safety_latency_ms=full_latency_ms,
            sidecar_outcome="invalid_response",
            fallback_mode="regex_only",
            sanitized_error_code="missing_latency",
        )
    if full_latency_ms > timeout_ms:
        return TargetResult(
            sidecar_latency_ms=None,
            full_safety_latency_ms=full_latency_ms,
            sidecar_outcome="timeout",
            fallback_mode="regex_only",
            sanitized_error_code="timeout",
        )
    return TargetResult(
        sidecar_latency_ms=latency_ms,
        full_safety_latency_ms=full_latency_ms,
        sidecar_outcome="success",
        fallback_mode="none",
        sanitized_error_code=None,
    )


def first_forbidden_response_field(value: Any) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in FORBIDDEN_RESPONSE_FIELDS:
                return str(key)
            nested = first_forbidden_response_field(child)
            if nested is not None:
                return nested
    elif isinstance(value, list):
        for child in value:
            nested = first_forbidden_response_field(child)
            if nested is not None:
                return nested
    return None


def elapsed_ms(started: float) -> int:
    return max(0, round((perf_counter() - started) * 1000))
