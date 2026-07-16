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
EXECUTION_SUMMARY_FIELDS = {
    "executionMode",
    "modelInvocationCount",
    "acceptedModelDetectionCount",
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
            target_latency_ms = elapsed_ms(started)
        except httpx.TimeoutException:
            return TargetResult(
                target_kind="direct_sidecar_http",
                target_latency_ms=elapsed_ms(started),
                target_outcome="timeout",
                sidecar_latency_ms=None,
                sidecar_outcome="timeout",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="timeout",
            )
        except httpx.HTTPError:
            return TargetResult(
                target_kind="direct_sidecar_http",
                target_latency_ms=elapsed_ms(started),
                target_outcome="error",
                sidecar_latency_ms=None,
                sidecar_outcome="error",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="http_error",
            )

        if response.status_code != 200:
            return TargetResult(
                target_kind="direct_sidecar_http",
                target_latency_ms=target_latency_ms,
                target_outcome="error",
                sidecar_latency_ms=None,
                sidecar_outcome="error",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code=f"http_{response.status_code}",
            )

        try:
            body = response.json()
        except ValueError:
            return TargetResult(
                target_kind="direct_sidecar_http",
                target_latency_ms=target_latency_ms,
                target_outcome="invalid_response",
                sidecar_latency_ms=None,
                sidecar_outcome="invalid_response",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="invalid_json",
            )
        return result_from_response_body(
            body,
            target_kind="direct_sidecar_http",
            target_latency_ms=target_latency_ms,
            timeout_ms=timeout_ms,
        )


@dataclass
class InProcessBenchmarkTarget:
    service: object
    model_id: str = MODEL_ID

    @classmethod
    def create(cls, *, model_id: str = MODEL_ID) -> InProcessBenchmarkTarget:
        from app.core.config import load_settings
        from app.services.ai_safety_detector import AiSafetyDetectorService

        settings = load_settings()
        service = AiSafetyDetectorService(
            model_id=model_id,
            additional_model_ids=settings.ai_safety_additional_detector_model_ids,
            detector_runtime=settings.ai_safety_detector_runtime,
            ml_allowed_detector_types=settings.ai_safety_ml_allowed_detector_types,
        )
        service.warmup()
        return cls(
            service=service,
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
                target_kind="in_process_sidecar",
                target_latency_ms=elapsed_ms(started),
                target_outcome="error",
                sidecar_latency_ms=None,
                sidecar_outcome="error",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="in_process_error",
            )
        target_latency_ms = elapsed_ms(started)
        if target_latency_ms > timeout_ms:
            return TargetResult(
                target_kind="in_process_sidecar",
                target_latency_ms=target_latency_ms,
                target_outcome="timeout",
                sidecar_latency_ms=None,
                sidecar_outcome="timeout",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="timeout",
            )
        body = response.model_dump(by_alias=True)
        return result_from_response_body(
            body,
            target_kind="in_process_sidecar",
            target_latency_ms=target_latency_ms,
            timeout_ms=timeout_ms,
        )


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
            target_latency_ms = elapsed_ms(started)
        except httpx.TimeoutException:
            return TargetResult(
                target_kind="gateway_http",
                target_latency_ms=elapsed_ms(started),
                target_outcome="timeout",
                sidecar_latency_ms=None,
                sidecar_outcome="unobserved",
                sidecar_observation="not_observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="gateway_timeout",
            )
        except httpx.HTTPError:
            return TargetResult(
                target_kind="gateway_http",
                target_latency_ms=elapsed_ms(started),
                target_outcome="error",
                sidecar_latency_ms=None,
                sidecar_outcome="unobserved",
                sidecar_observation="not_observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="gateway_http_error",
            )

        if response.status_code not in {200, 403}:
            return TargetResult(
                target_kind="gateway_http",
                target_latency_ms=target_latency_ms,
                target_outcome="error",
                sidecar_latency_ms=None,
                sidecar_outcome="unobserved",
                sidecar_observation="not_observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="gateway_non_terminal_status",
            )
        return TargetResult(
            target_kind="gateway_http",
            target_latency_ms=target_latency_ms,
            target_outcome="success" if response.status_code == 200 else "blocked",
            sidecar_latency_ms=None,
            sidecar_outcome="unobserved",
            sidecar_observation="not_observed",
            fallback_mode="not_observed",
            fallback_observation="not_observed",
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


def result_from_response_body(
    body: Any,
    *,
    target_kind: str,
    target_latency_ms: int,
    timeout_ms: int,
) -> TargetResult:
    if not isinstance(body, dict):
        return TargetResult(
            target_kind=target_kind,
            target_latency_ms=target_latency_ms,
            target_outcome="invalid_response",
            sidecar_latency_ms=None,
            sidecar_outcome="invalid_response",
            sidecar_observation="observed",
            fallback_mode="not_observed",
            fallback_observation="not_observed",
            sanitized_error_code="non_object_response",
        )
    forbidden_field = first_forbidden_response_field(body)
    if forbidden_field is not None:
        return TargetResult(
            target_kind=target_kind,
            target_latency_ms=target_latency_ms,
            target_outcome="invalid_response",
            sidecar_latency_ms=None,
            sidecar_outcome="invalid_response",
            sidecar_observation="observed",
            fallback_mode="not_observed",
            fallback_observation="not_observed",
            sanitized_error_code="forbidden_response_field",
        )
    latency_ms = body.get("latencyMs")
    if not isinstance(latency_ms, int) or latency_ms < 0:
        return TargetResult(
            target_kind=target_kind,
            target_latency_ms=target_latency_ms,
            target_outcome="invalid_response",
            sidecar_latency_ms=None,
            sidecar_outcome="invalid_response",
            sidecar_observation="observed",
            fallback_mode="not_observed",
            fallback_observation="not_observed",
            sanitized_error_code="missing_latency",
        )
    execution_summary = execution_summary_from_response_body(body)
    if execution_summary is None:
        return TargetResult(
            target_kind=target_kind,
            target_latency_ms=target_latency_ms,
            target_outcome="invalid_response",
            sidecar_latency_ms=None,
            sidecar_outcome="invalid_response",
            sidecar_observation="observed",
            fallback_mode="not_observed",
            fallback_observation="not_observed",
            sanitized_error_code="invalid_execution_summary",
        )
    if target_latency_ms > timeout_ms:
        return TargetResult(
            target_kind=target_kind,
            target_latency_ms=target_latency_ms,
            target_outcome="timeout",
            sidecar_latency_ms=None,
            sidecar_outcome="timeout",
            sidecar_observation="observed",
            fallback_mode="not_observed",
            fallback_observation="not_observed",
            sanitized_error_code="timeout",
        )
    execution_mode, model_invocation_count, accepted_model_detection_count = execution_summary
    return TargetResult(
        target_kind=target_kind,
        target_latency_ms=target_latency_ms,
        target_outcome="success",
        sidecar_latency_ms=latency_ms,
        sidecar_outcome="success",
        sidecar_observation="observed",
        fallback_mode="none",
        fallback_observation="not_applicable",
        sanitized_error_code=None,
        execution_mode=execution_mode,
        model_invocation_count=model_invocation_count,
        accepted_model_detection_count=accepted_model_detection_count,
    )


def execution_summary_from_response_body(body: dict[str, Any]) -> tuple[str, int, int] | None:
    summary = body.get("executionSummary")
    if not isinstance(summary, dict) or set(summary) != EXECUTION_SUMMARY_FIELDS:
        return None

    execution_mode = summary.get("executionMode")
    model_invocation_count = summary.get("modelInvocationCount")
    accepted_model_detection_count = summary.get("acceptedModelDetectionCount")
    if execution_mode not in {"rules_only", "hybrid"}:
        return None
    if not _is_non_negative_int(model_invocation_count):
        return None
    if not _is_non_negative_int(accepted_model_detection_count):
        return None
    if execution_mode == "rules_only" and (
        model_invocation_count != 0 or accepted_model_detection_count != 0
    ):
        return None
    if execution_mode == "hybrid" and model_invocation_count < 1:
        return None
    return execution_mode, model_invocation_count, accepted_model_detection_count


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


def _is_non_negative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def elapsed_ms(started: float) -> int:
    return max(0, round((perf_counter() - started) * 1000))


def env_first(*keys: str) -> str | None:
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return None
