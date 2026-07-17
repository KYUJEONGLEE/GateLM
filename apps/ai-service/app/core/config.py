from __future__ import annotations

import math
import os
from dataclasses import dataclass

from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES


REMOTE_SAFETY_MODE_DISABLED = "disabled"
REMOTE_SAFETY_MODE_SHADOW = "shadow"
REMOTE_SAFETY_MODES = {REMOTE_SAFETY_MODE_DISABLED, REMOTE_SAFETY_MODE_SHADOW}
DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID = "openai/privacy-filter"
DEFAULT_AI_SAFETY_DETECTOR_RUNTIME = "onnx"
DEFAULT_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES = ("phone_number", "secret")
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
    ai_safety_ml_detector_thresholds: tuple[tuple[str, float], ...] = ()
    ai_safety_detector_runtime: str = DEFAULT_AI_SAFETY_DETECTOR_RUNTIME
    ai_safety_preload_enabled: bool = False


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
        ai_safety_ml_allowed_detector_types=_env_ml_allowed_detector_types(),
        ai_safety_ml_detector_thresholds=_env_ml_detector_thresholds(),
        ai_safety_detector_runtime=_env_ai_safety_detector_runtime(),
        ai_safety_preload_enabled=_env_bool(
            "AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED",
            False,
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


def _env_ml_detector_thresholds() -> tuple[tuple[str, float], ...]:
    key = 'AI_SERVICE_AI_SAFETY_ML_DETECTOR_THRESHOLDS'
    value = os.environ.get(key)
    if value is None or value.strip() == '':
        return ()

    thresholds: list[tuple[str, float]] = []
    seen: set[str] = set()
    for raw_item in value.split(','):
        detector_type, separator, raw_threshold = raw_item.partition('=')
        detector_type = detector_type.strip()
        raw_threshold = raw_threshold.strip()
        if (
            separator == ''
            or detector_type not in ALLOWED_DETECTOR_TYPES
            or detector_type in seen
        ):
            raise ValueError(f'{key} contains an invalid detector threshold')
        try:
            threshold = float(raw_threshold)
        except ValueError as exc:
            raise ValueError(f'{key} contains an invalid detector threshold') from exc
        if not math.isfinite(threshold) or not 0 <= threshold <= 1:
            raise ValueError(f'{key} threshold must be between 0 and 1')
        thresholds.append((detector_type, round(threshold, 6)))
        seen.add(detector_type)
    return tuple(thresholds)


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
