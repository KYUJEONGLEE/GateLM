from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any

import httpx


LLM_CLASSIFIER_SOURCE = "llm_classifier"
DEFAULT_LLM_CLASSIFIER_MODEL = "kakaocorp/kanana-1.5-8b-instruct-2505"
DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS = 1000
DEFAULT_LLM_CLASSIFIER_TEMPERATURE = 0.0
DEFAULT_LLM_CLASSIFIER_MAX_TOKENS = 192

ALLOWED_LLM_CLASSIFIER_DETECTOR_TYPES = frozenset(
    {
        "account_id",
        "account_number",
        "confidential_business_context",
        "person_name",
        "postal_address",
        "private_date",
        "private_url",
        "resident_registration_number",
        "secret",
        "sensitive_health_context",
        "unknown_pii",
    }
)
ALLOWED_LLM_CLASSIFIER_ACTIONS = frozenset({"allow", "redact", "block"})
ALLOWED_LLM_CLASSIFIER_REASON_CODES = frozenset(
    {
        "account_number_context",
        "api_key_example_context",
        "birthdate_context",
        "business_address_context",
        "confidential_business_context",
        "delivery_address_context",
        "health_context",
        "order_id_context",
        "partial_rrn_context",
        "personal_list_context",
        "schedule_date_context",
        "secret_assignment_context",
        "single_person_name_context",
        "synthetic_test_data_context",
        "tokenized_url_context",
    }
)


@dataclass(frozen=True)
class LLMClassification:
    detector_type: str
    action: str
    confidence: float
    reason_code: str
    source: str = LLM_CLASSIFIER_SOURCE


class LocalVllmLLMClassifier:
    def __init__(
        self,
        *,
        base_url: str,
        model: str = DEFAULT_LLM_CLASSIFIER_MODEL,
        timeout_ms: int = DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS,
        temperature: float = DEFAULT_LLM_CLASSIFIER_TEMPERATURE,
        max_tokens: int = DEFAULT_LLM_CLASSIFIER_MAX_TOKENS,
    ) -> None:
        self.base_url = base_url.strip().rstrip("/")
        self.model = model.strip() or DEFAULT_LLM_CLASSIFIER_MODEL
        self.timeout_ms = timeout_ms if timeout_ms > 0 else DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS
        self.temperature = temperature
        self.max_tokens = max_tokens if max_tokens > 0 else DEFAULT_LLM_CLASSIFIER_MAX_TOKENS

    def classify(self, window_text: str) -> tuple[LLMClassification, ...]:
        if self.base_url == "" or window_text.strip() == "":
            return ()

        try:
            response = httpx.post(
                _chat_completions_url(self.base_url),
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "system",
                            "content": _system_prompt(),
                        },
                        {
                            "role": "user",
                            "content": json.dumps(
                                {
                                    "candidateWindow": window_text,
                                },
                                ensure_ascii=False,
                            ),
                        },
                    ],
                    "temperature": self.temperature,
                    "max_tokens": self.max_tokens,
                    "response_format": {"type": "json_object"},
                },
                timeout=self.timeout_ms / 1000,
            )
            response.raise_for_status()
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
            return ()
        if not isinstance(content, str):
            return ()
        return parse_llm_classifier_content(content)


def parse_llm_classifier_content(content: str) -> tuple[LLMClassification, ...]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        return ()
    if not isinstance(payload, dict):
        return ()
    detections = payload.get("detections")
    if not isinstance(detections, list):
        return ()

    parsed: list[LLMClassification] = []
    for item in detections:
        if not isinstance(item, dict):
            continue
        detection = _parse_detection(item)
        if detection is not None:
            parsed.append(detection)
    return tuple(parsed)


def _parse_detection(item: dict[str, Any]) -> LLMClassification | None:
    detector_type = _normalized_string(item.get("detectorType"))
    action = _normalized_string(item.get("action"))
    reason_code = _normalized_string(item.get("reasonCode"))
    if detector_type not in ALLOWED_LLM_CLASSIFIER_DETECTOR_TYPES:
        return None
    if action not in ALLOWED_LLM_CLASSIFIER_ACTIONS:
        return None
    if reason_code not in ALLOWED_LLM_CLASSIFIER_REASON_CODES:
        return None

    confidence = _normalized_confidence(item.get("confidence"))
    if confidence is None:
        return None

    return LLMClassification(
        detector_type=detector_type,
        action=action,
        confidence=confidence,
        reason_code=reason_code,
    )


def _normalized_string(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()


def _normalized_confidence(value: object) -> float | None:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(confidence):
        return None
    if confidence < 0 or confidence > 1:
        return None
    return confidence


def _chat_completions_url(base_url: str) -> str:
    if base_url.endswith("/chat/completions"):
        return base_url
    return f"{base_url}/chat/completions"


def _system_prompt() -> str:
    return (
        "Classify the provided candidate window for GateLM AI safety shadow evidence. "
        "Return exactly one JSON object with a detections array. "
        "Each detection must use detectorType, action, confidence, and reasonCode. "
        "Do not include source text, spans, offsets, explanations, or raw values."
    )
