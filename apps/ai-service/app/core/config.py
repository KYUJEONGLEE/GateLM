from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


REMOTE_SAFETY_MODE_DISABLED = "disabled"
REMOTE_SAFETY_MODE_SHADOW = "shadow"
REMOTE_SAFETY_MODES = {REMOTE_SAFETY_MODE_DISABLED, REMOTE_SAFETY_MODE_SHADOW}
DEFAULT_AI_SAFETY_DETECTOR_MODEL_ID = "openai/privacy-filter"
DEFAULT_AI_SAFETY_DETECTOR_RUNTIME = "onnx"
AI_SAFETY_DETECTOR_RUNTIME_TRANSFORMERS = "transformers"
AI_SAFETY_DETECTOR_RUNTIME_ONNX = "onnx"
AI_SAFETY_DETECTOR_RUNTIMES = {
    AI_SAFETY_DETECTOR_RUNTIME_TRANSFORMERS,
    AI_SAFETY_DETECTOR_RUNTIME_ONNX,
}
RAG_TOKENIZER_MODEL = "text-embedding-3-large"
RAG_TOKENIZER_ENCODING = "cl100k_base"
PRODUCTION_LIKE_DEPLOYMENT_MODES = {
    "aws",
    "aws-triage",
    "aws_triage",
    "prod",
    "production",
    "release",
    "selfhost",
    "self_host",
    "stage",
    "staging",
}
LOCAL_DEPLOYMENT_MODES = {"development", "local", "test"}
RAG_SERVICE_TOKEN_PLACEHOLDER_MARKERS = (
    "change-me",
    "demo",
    "example",
    "fake",
    "local",
    "replace-me",
    "test",
)


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
    deployment_mode: str = "local"
    rag_enabled: bool = False
    rag_service_token: str = field(default="", repr=False)
    rag_max_input_bytes: int = 20 * 1024 * 1024
    rag_max_pdf_pages: int = 300
    rag_max_extracted_chars: int = 2_000_000
    rag_pdf_parse_timeout_seconds: float = 30.0
    rag_min_pdf_text_chars: int = 20
    rag_max_chunks: int = 10_000
    rag_chunk_target_tokens: int = 600
    rag_chunk_overlap_tokens: int = 100
    rag_chunk_max_tokens: int = 900
    rag_temp_dir: str = field(default_factory=tempfile.gettempdir)
    rag_max_concurrent_extractions: int = 2
    rag_pdf_memory_limit_bytes: int = 512 * 1024 * 1024
    rag_pdf_cpu_limit_seconds: int = 30

    def __post_init__(self) -> None:
        _validate_rag_settings(self)


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
        deployment_mode=_env_string("DEPLOYMENT_MODE", "local").strip().lower(),
        rag_enabled=_env_strict_bool("TENANT_CHAT_RAG_ENABLED", False),
        rag_service_token=_env_string("AI_SERVICE_RAG_SERVICE_TOKEN", "").strip(),
        rag_max_input_bytes=_env_strict_int(
            "AI_SERVICE_RAG_MAX_INPUT_BYTES",
            20 * 1024 * 1024,
        ),
        rag_max_pdf_pages=_env_strict_int("AI_SERVICE_RAG_MAX_PDF_PAGES", 300),
        rag_max_extracted_chars=_env_strict_int(
            "AI_SERVICE_RAG_MAX_EXTRACTED_CHARS",
            2_000_000,
        ),
        rag_pdf_parse_timeout_seconds=_env_strict_float(
            "AI_SERVICE_RAG_PDF_PARSE_TIMEOUT_SECONDS",
            30.0,
        ),
        rag_min_pdf_text_chars=_env_strict_int(
            "AI_SERVICE_RAG_MIN_PDF_TEXT_CHARS",
            20,
        ),
        rag_max_chunks=_env_strict_int("AI_SERVICE_RAG_MAX_CHUNKS", 10_000),
        rag_chunk_target_tokens=_env_strict_int(
            "AI_SERVICE_RAG_CHUNK_TARGET_TOKENS",
            600,
        ),
        rag_chunk_overlap_tokens=_env_strict_int(
            "AI_SERVICE_RAG_CHUNK_OVERLAP_TOKENS",
            100,
            allow_zero=True,
        ),
        rag_chunk_max_tokens=_env_strict_int(
            "AI_SERVICE_RAG_CHUNK_MAX_TOKENS",
            900,
        ),
        rag_temp_dir=_env_string(
            "AI_SERVICE_RAG_TEMP_DIR",
            tempfile.gettempdir(),
        ).strip(),
        rag_max_concurrent_extractions=_env_strict_int(
            "AI_SERVICE_RAG_MAX_CONCURRENT_EXTRACTIONS",
            2,
        ),
        rag_pdf_memory_limit_bytes=_env_strict_int(
            "AI_SERVICE_RAG_PDF_MEMORY_LIMIT_BYTES",
            512 * 1024 * 1024,
        ),
        rag_pdf_cpu_limit_seconds=_env_strict_int(
            "AI_SERVICE_RAG_PDF_CPU_LIMIT_SECONDS",
            30,
        ),
    )


def _validate_rag_settings(settings: Settings) -> None:
    if settings.rag_min_pdf_text_chars > settings.rag_max_extracted_chars:
        raise ValueError(
            "RAG minimum PDF text must not exceed the extracted text limit"
        )
    if settings.rag_chunk_overlap_tokens >= settings.rag_chunk_target_tokens:
        raise ValueError("RAG chunk overlap must be smaller than the target")
    if settings.rag_chunk_target_tokens > settings.rag_chunk_max_tokens:
        raise ValueError("RAG chunk target must not exceed the maximum")
    if not 1 <= settings.rag_max_concurrent_extractions <= 16:
        raise ValueError(
            "AI_SERVICE_RAG_MAX_CONCURRENT_EXTRACTIONS must be between 1 and 16"
        )
    if (
        not 64 * 1024 * 1024
        <= settings.rag_pdf_memory_limit_bytes
        <= 2 * 1024 * 1024 * 1024
    ):
        raise ValueError(
            "AI_SERVICE_RAG_PDF_MEMORY_LIMIT_BYTES must be between 67108864 and 2147483648"
        )
    if not 1 <= settings.rag_pdf_cpu_limit_seconds <= 120:
        raise ValueError(
            "AI_SERVICE_RAG_PDF_CPU_LIMIT_SECONDS must be between 1 and 120"
        )
    temp_dir = Path(settings.rag_temp_dir)
    if settings.rag_enabled and (
        not settings.rag_temp_dir or not temp_dir.is_absolute()
    ):
        raise ValueError("AI_SERVICE_RAG_TEMP_DIR must be an absolute path")
    if settings.rag_enabled and settings.deployment_mode not in LOCAL_DEPLOYMENT_MODES:
        system_temp = Path(tempfile.gettempdir()).resolve(strict=False)
        if temp_dir.resolve(strict=False) == system_temp:
            raise ValueError(
                "AI_SERVICE_RAG_TEMP_DIR must be a dedicated directory outside the system temp root in non-local environments"
            )
    if (
        settings.rag_enabled
        and settings.deployment_mode in PRODUCTION_LIKE_DEPLOYMENT_MODES
    ):
        normalized_token = settings.rag_service_token.lower()
        if len(settings.rag_service_token) < 32 or any(
            marker in normalized_token
            for marker in RAG_SERVICE_TOKEN_PLACEHOLDER_MARKERS
        ):
            raise ValueError(
                "AI_SERVICE_RAG_SERVICE_TOKEN must be a non-placeholder value of at least "
                "32 characters in production-like environments"
            )


def _env_remote_safety_mode() -> str:
    mode = (
        _env_string("AI_SERVICE_REMOTE_SAFETY_MODE", REMOTE_SAFETY_MODE_DISABLED)
        .strip()
        .lower()
    )
    if mode not in REMOTE_SAFETY_MODES:
        return REMOTE_SAFETY_MODE_DISABLED
    return mode


def _env_ai_safety_detector_runtime() -> str:
    runtime = (
        _env_string(
            "AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME",
            DEFAULT_AI_SAFETY_DETECTOR_RUNTIME,
        )
        .strip()
        .lower()
    )
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


def _env_strict_int(key: str, fallback: int, *, allow_zero: bool = False) -> int:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer") from exc
    if parsed < 0 or (parsed == 0 and not allow_zero):
        qualifier = "non-negative" if allow_zero else "positive"
        raise ValueError(f"{key} must be {qualifier}")
    return parsed


def _env_strict_float(key: str, fallback: float) -> float:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    try:
        parsed = float(value)
    except ValueError as exc:
        raise ValueError(f"{key} must be numeric") from exc
    if parsed <= 0:
        raise ValueError(f"{key} must be positive")
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


def _env_strict_bool(key: str, fallback: bool) -> bool:
    value = os.environ.get(key)
    if value is None or value == "":
        return fallback
    normalized = value.strip().lower()
    if normalized == "true":
        return True
    if normalized == "false":
        return False
    raise ValueError(f"{key} must be true or false")


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
