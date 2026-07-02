from __future__ import annotations

import os
from dataclasses import dataclass


REMOTE_SAFETY_MODE_DISABLED = "disabled"
REMOTE_SAFETY_MODE_SHADOW = "shadow"
REMOTE_SAFETY_MODES = {REMOTE_SAFETY_MODE_DISABLED, REMOTE_SAFETY_MODE_SHADOW}


@dataclass(frozen=True)
class Settings:
    host: str = "127.0.0.1"
    port: int = 8001
    log_level: str = "INFO"
    remote_safety_mode: str = REMOTE_SAFETY_MODE_DISABLED
    access_log_enabled: bool = False


def load_settings() -> Settings:
    return Settings(
        host=_env_string("AI_SERVICE_HOST", "127.0.0.1"),
        port=_env_int("AI_SERVICE_PORT", 8001),
        log_level=_env_string("AI_SERVICE_LOG_LEVEL", "INFO"),
        remote_safety_mode=_env_remote_safety_mode(),
        access_log_enabled=_env_bool("AI_SERVICE_ACCESS_LOG_ENABLED", False),
    )


def _env_remote_safety_mode() -> str:
    mode = _env_string("AI_SERVICE_REMOTE_SAFETY_MODE", REMOTE_SAFETY_MODE_DISABLED).strip().lower()
    if mode not in REMOTE_SAFETY_MODES:
        return REMOTE_SAFETY_MODE_DISABLED
    return mode


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
