from __future__ import annotations

import os
from dataclasses import dataclass


REMOTE_SAFETY_MODE_DISABLED = "disabled"
REMOTE_SAFETY_MODE_SHADOW = "shadow"
REMOTE_SAFETY_MODES = {REMOTE_SAFETY_MODE_DISABLED, REMOTE_SAFETY_MODE_SHADOW}
DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID = "openai/privacy-filter"
DEFAULT_AI_SAFETY_DETECTOR_RUNTIME = "transformers"
DEFAULT_LLM_CLASSIFIER_BASE_URL = "http://127.0.0.1:8002/v1"
DEFAULT_LLM_CLASSIFIER_MODEL = "kakaocorp/kanana-1.5-8b-instruct-2505"
DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS = 1000
DEFAULT_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS = 2000
DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_CHARS = 1000
DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_COUNT = 3
DEFAULT_LLM_CLASSIFIER_TEMPERATURE = 0.0
DEFAULT_LLM_CLASSIFIER_MAX_TOKENS = 192
AI_SAFETY_DETECTOR_RUNTIME_TRANSFORMERS = "transformers"
AI_SAFETY_DETECTOR_RUNTIME_ONNX = "onnx"
AI_SAFETY_DETECTOR_RUNTIMES = {
    AI_SAFETY_DETECTOR_RUNTIME_TRANSFORMERS,
    AI_SAFETY_DETECTOR_RUNTIME_ONNX,
}


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8001
    log_level: str = "INFO"
    remote_safety_mode: str = REMOTE_SAFETY_MODE_DISABLED
    access_log_enabled: bool = False
    ai_safety_detector_model_id: str = DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID
    ai_safety_additional_detector_model_ids: tuple[str, ...] = ()
    ai_safety_detector_runtime: str = DEFAULT_AI_SAFETY_DETECTOR_RUNTIME
    llm_classifier_enabled: bool = False
    llm_classifier_base_url: str = DEFAULT_LLM_CLASSIFIER_BASE_URL
    llm_classifier_model: str = DEFAULT_LLM_CLASSIFIER_MODEL
    llm_classifier_timeout_ms: int = DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS
    llm_classifier_total_timeout_ms: int = DEFAULT_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS
    llm_classifier_window_max_chars: int = DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_CHARS
    llm_classifier_window_max_count: int = DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_COUNT
    llm_classifier_temperature: float = DEFAULT_LLM_CLASSIFIER_TEMPERATURE
    llm_classifier_max_tokens: int = DEFAULT_LLM_CLASSIFIER_MAX_TOKENS


def load_settings() -> Settings:
    return Settings(
        host=_env_string("AI_SERVICE_HOST", "127.0.0.1"),
        port=_env_int("AI_SERVICE_PORT", 8001),
        log_level=_env_string("AI_SERVICE_LOG_LEVEL", "INFO"),
        remote_safety_mode=_env_remote_safety_mode(),
        access_log_enabled=_env_bool("AI_SERVICE_ACCESS_LOG_ENABLED", False),
        ai_safety_detector_model_id=_env_model_id(
            "AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID",
            DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID,
        ),
        ai_safety_additional_detector_model_ids=_env_model_ids(
            "AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS",
        ),
        ai_safety_detector_runtime=_env_ai_safety_detector_runtime(),
        llm_classifier_enabled=_env_bool("AI_SERVICE_LLM_CLASSIFIER_ENABLED", False),
        llm_classifier_base_url=_env_string(
            "AI_SERVICE_LLM_CLASSIFIER_BASE_URL",
            DEFAULT_LLM_CLASSIFIER_BASE_URL,
        ).strip(),
        llm_classifier_model=_env_model_id(
            "AI_SERVICE_LLM_CLASSIFIER_MODEL",
            DEFAULT_LLM_CLASSIFIER_MODEL,
        ),
        llm_classifier_timeout_ms=_env_int(
            "AI_SERVICE_LLM_CLASSIFIER_TIMEOUT_MS",
            DEFAULT_LLM_CLASSIFIER_TIMEOUT_MS,
        ),
        llm_classifier_total_timeout_ms=_env_int(
            "AI_SERVICE_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS",
            DEFAULT_LLM_CLASSIFIER_TOTAL_TIMEOUT_MS,
        ),
        llm_classifier_window_max_chars=_env_int(
            "AI_SERVICE_LLM_CLASSIFIER_WINDOW_MAX_CHARS",
            DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_CHARS,
        ),
        llm_classifier_window_max_count=_env_int(
            "AI_SERVICE_LLM_CLASSIFIER_WINDOW_MAX_COUNT",
            DEFAULT_LLM_CLASSIFIER_WINDOW_MAX_COUNT,
        ),
        llm_classifier_temperature=_env_float(
            "AI_SERVICE_LLM_CLASSIFIER_TEMPERATURE",
            DEFAULT_LLM_CLASSIFIER_TEMPERATURE,
        ),
        llm_classifier_max_tokens=_env_int(
            "AI_SERVICE_LLM_CLASSIFIER_MAX_TOKENS",
            DEFAULT_LLM_CLASSIFIER_MAX_TOKENS,
        ),
    )


def _env_remote_safety_mode() -> str:
    mode = _env_string("AI_SERVICE_REMOTE_SAFETY_MODE", REMOTE_SAFETY_MODE_DISABLED).strip().lower()
    if mode not in REMOTE_SAFETY_MODES:
        return REMOTE_SAFETY_MODE_DISABLED
    return mode


def _env_ai_safety_detector_runtime() -> str:
    runtime = _env_string(
        "AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME",
        DEFAULT_AI_SAFETY_DETECTOR_RUNTIME,
    ).strip().lower()
    if runtime not in AI_SAFETY_DETECTOR_RUNTIMES:
        return DEFAULT_AI_SAFETY_DETECTOR_RUNTIME
    return runtime


def _env_string(key: str, fallback: str) -> str:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    return value


def _env_int(key: str, fallback: int) -> int:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    try:
        parsed = int(value)
    except ValueError:
        return fallback
    if parsed <= 0:
        return fallback
    return parsed


def _env_bool(key: str, fallback: bool) -> bool:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return fallback


def _env_float(key: str, fallback: float) -> float:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    try:
        parsed = float(value)
    except ValueError:
        return fallback
    return parsed


def _env_model_id(key: str, fallback: str) -> str:
    value = _env_string(key, fallback).strip()
    if value == "" or any(char.isspace() for char in value):
        return fallback
    return value


def _env_model_ids(key: str) -> tuple[str, ...]:
    value = os.environ.get(key)
    if value is None or value.strip() == "":
        return ()
    model_ids: list[str] = []
    seen: set[str] = set()
    for raw_item in value.split(","):
        model_id = raw_item.strip()
        if model_id == "" or any(char.isspace() for char in model_id):
            continue
        if model_id in seen:
            continue
        model_ids.append(model_id)
        seen.add(model_id)
    return tuple(model_ids)
