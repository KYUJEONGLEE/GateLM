from __future__ import annotations

from dataclasses import dataclass
import os
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
        from app.core.config import load_settings
        from app.services.ai_safety_detector import AiSafetyDetectorService

        settings = load_settings()
        return cls(
            service=AiSafetyDetectorService(
                model_id=model_id,
                additional_model_ids=settings.ai_safety_additional_detector_model_ids,
                detector_runtime=settings.ai_safety_detector_runtime,
            ),
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


@dataclass
class GatewayHttpBenchmarkTarget:
    endpoint_url: str
    model: str = "auto"
    api_key: str | None = None
    app_token: str | None = None

    def detect(self, prompt_text: str, *, locale: str | None, timeout_ms: int) -> TargetResult:
        try:
            import httpx  # type: ignore[import-not-found]
        except Exception as exc:
            raise BenchmarkError("gateway target requires the benchmark or test extra with httpx installed") from exc

        started = perf_counter()
        try:
            response = httpx.post(
                self.endpoint_url,
                json=build_gateway_chat_payload(prompt_text, model=self.model),
                headers=self._headers(locale=locale),
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

        if response.status_code not in {200, 403}:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=full_latency_ms,
                sidecar_outcome="error",
                fallback_mode="regex_only",
                sanitized_error_code=f"http_{response.status_code}",
            )

        reported_latency_ms = gateway_reported_latency_ms(response, fallback_latency_ms=full_latency_ms)
        if full_latency_ms > timeout_ms:
            return TargetResult(
                sidecar_latency_ms=None,
                full_safety_latency_ms=full_latency_ms,
                sidecar_outcome="timeout",
                fallback_mode="regex_only",
                sanitized_error_code="timeout",
            )
        return TargetResult(
            sidecar_latency_ms=reported_latency_ms,
            full_safety_latency_ms=full_latency_ms,
            sidecar_outcome="success",
            fallback_mode="none",
        )

    def _headers(self, *, locale: str | None) -> dict[str, str]:
        api_key = self.api_key or env_first("GATELM_DEMO_API_KEY", "GATELM_API_KEY") or "glm_api_test_redacted"
        app_token = (
            self.app_token
            or env_first("GATELM_DEMO_APP_TOKEN", "GATELM_APP_TOKEN")
            or "glm_app_token_test_redacted"
        )
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-GateLM-App-Token": app_token,
            "X-GateLM-End-User-Id": "ai_safety_benchmark_user",
            "X-GateLM-Feature-Id": "ai_safety_benchmark",
        }
        if locale:
            headers["X-GateLM-Locale"] = locale
        return headers


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


def build_gateway_chat_payload(prompt_text: str, *, model: str = "auto") -> dict[str, object]:
    return {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": prompt_text,
            }
        ],
        "stream": False,
    }


def gateway_reported_latency_ms(response: Any, *, fallback_latency_ms: int) -> int:
    try:
        body = response.json()
    except ValueError:
        return fallback_latency_ms
    if not isinstance(body, dict):
        return fallback_latency_ms
    gate_lm = body.get("gate_lm")
    if not isinstance(gate_lm, dict):
        return fallback_latency_ms
    latency_ms = gate_lm.get("latencyMs")
    if isinstance(latency_ms, int) and latency_ms >= 0:
        return latency_ms
    return fallback_latency_ms


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


def env_first(*keys: str) -> str | None:
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return None
