from __future__ import annotations

import os
from dataclasses import dataclass, field

from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES


REMOTE_SAFETY_MODE_DISABLED = "disabled"
REMOTE_SAFETY_MODE_SHADOW = "shadow"
REMOTE_SAFETY_MODES = {REMOTE_SAFETY_MODE_DISABLED, REMOTE_SAFETY_MODE_SHADOW}
DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID = "openai/privacy-filter"
DEFAULT_AI_SAFETY_DETECTOR_RUNTIME = "onnx"
DEFAULT_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES = ("phone_number", "secret")
DEFAULT_AZURE_PII_ALLOWED_DETECTOR_TYPES = (
    "email",
    "organization_name",
    "person_name",
    "phone_number",
    "postal_address",
    "resident_registration_number",
)
DEFAULT_AZURE_PII_API_VERSION = "2024-11-01"
DEFAULT_AZURE_PII_LANGUAGE = "ko"
DEFAULT_AZURE_PII_TIMEOUT_MS = 750
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
    ai_safety_ml_allowed_detector_types: tuple[str, ...] = (
        DEFAULT_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES
    )
    ai_safety_detector_runtime: str = DEFAULT_AI_SAFETY_DETECTOR_RUNTIME
    ai_safety_preload_enabled: bool = False
    ai_safety_local_model_enabled: bool = True
    azure_pii_enabled: bool = False
    azure_pii_endpoint: str = ""
    azure_pii_api_key: str = field(default="", repr=False)
    azure_pii_api_version: str = DEFAULT_AZURE_PII_API_VERSION
    azure_pii_language: str = DEFAULT_AZURE_PII_LANGUAGE
    azure_pii_timeout_ms: int = DEFAULT_AZURE_PII_TIMEOUT_MS
    azure_pii_allowed_detector_types: tuple[str, ...] = DEFAULT_AZURE_PII_ALLOWED_DETECTOR_TYPES


def load_settings() -> Settings:
    settings = Settings(
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
        ai_safety_ml_allowed_detector_types=_env_ml_allowed_detector_types(),
        ai_safety_detector_runtime=_env_ai_safety_detector_runtime(),
        ai_safety_preload_enabled=_env_bool(
            "AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED",
            False,
        ),
        ai_safety_local_model_enabled=_env_bool(
            "AI_SERVICE_AI_SAFETY_LOCAL_MODEL_ENABLED",
            True,
        ),
        azure_pii_enabled=_env_bool("AI_SERVICE_AZURE_PII_ENABLED", False),
        azure_pii_endpoint=_env_string("AI_SERVICE_AZURE_PII_ENDPOINT", "").strip(),
        azure_pii_api_key=_env_string("AI_SERVICE_AZURE_PII_API_KEY", "").strip(),
        azure_pii_api_version=_env_string(
            "AI_SERVICE_AZURE_PII_API_VERSION",
            DEFAULT_AZURE_PII_API_VERSION,
        ).strip(),
        azure_pii_language=_env_string(
            "AI_SERVICE_AZURE_PII_LANGUAGE",
            DEFAULT_AZURE_PII_LANGUAGE,
        ).strip(),
        azure_pii_timeout_ms=_env_int(
            "AI_SERVICE_AZURE_PII_TIMEOUT_MS",
            DEFAULT_AZURE_PII_TIMEOUT_MS,
        ),
        azure_pii_allowed_detector_types=_env_detector_types(
            "AI_SERVICE_AZURE_PII_ALLOWED_DETECTOR_TYPES",
            DEFAULT_AZURE_PII_ALLOWED_DETECTOR_TYPES,
        ),
    )
    if settings.azure_pii_enabled and settings.azure_pii_endpoint == "":
        raise ValueError("AI_SERVICE_AZURE_PII_ENDPOINT must be set when Azure PII is enabled")
    if not settings.ai_safety_local_model_enabled and not settings.azure_pii_enabled:
        raise ValueError("At least one AI safety model backend must be enabled")
    return settings


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


def _env_ml_allowed_detector_types() -> tuple[str, ...]:
    key = "AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES"
    value = os.environ.get(key)
    if value is None:
        return DEFAULT_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES
    if value.strip() == "":
        raise ValueError(f"{key} must not be empty")

    detector_types: list[str] = []
    seen: set[str] = set()
    for raw_item in value.split(","):
        detector_type = raw_item.strip()
        if detector_type == "" or detector_type not in ALLOWED_DETECTOR_TYPES:
            raise ValueError(f"{key} contains an unsupported detector type")
        if detector_type in seen:
            continue
        detector_types.append(detector_type)
        seen.add(detector_type)
    if not detector_types:
        raise ValueError(f"{key} must select at least one detector type")
    return tuple(detector_types)


def _env_detector_types(key: str, fallback: tuple[str, ...]) -> tuple[str, ...]:
    value = os.environ.get(key)
    if value is None:
        return fallback
    if value.strip() == "":
        raise ValueError(f"{key} must not be empty")

    detector_types: list[str] = []
    seen: set[str] = set()
    for raw_item in value.split(","):
        detector_type = raw_item.strip()
        if detector_type == "" or detector_type not in ALLOWED_DETECTOR_TYPES:
            raise ValueError(f"{key} contains an unsupported detector type")
        if detector_type in seen:
            continue
        detector_types.append(detector_type)
        seen.add(detector_type)
    if not detector_types:
        raise ValueError(f"{key} must select at least one detector type")
    return tuple(detector_types)
