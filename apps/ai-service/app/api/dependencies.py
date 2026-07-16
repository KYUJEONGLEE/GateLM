from __future__ import annotations

from fastapi import Request

from app.adapters.safety import AzurePiiAdapter, PrivacyFilterAdapter
from app.adapters.safety.privacy_filter_adapter import source_for_model
from app.core.config import Settings, load_settings
from app.services.ai_safety_detector import AiSafetyDetectorService
from app.services.safety_evaluator import RemoteSafetyEvaluationService


def get_settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    if isinstance(settings, Settings):
        return settings
    settings = load_settings()
    request.app.state.settings = settings
    return settings


def get_remote_safety_service(request: Request) -> RemoteSafetyEvaluationService:
    service = getattr(request.app.state, "remote_safety_service", None)
    if isinstance(service, RemoteSafetyEvaluationService):
        return service
    service = RemoteSafetyEvaluationService(get_settings(request))
    request.app.state.remote_safety_service = service
    return service


def get_ai_safety_detector_service(request: Request) -> AiSafetyDetectorService:
    service = getattr(request.app.state, "ai_safety_detector_service", None)
    if isinstance(service, AiSafetyDetectorService):
        return service
    settings = get_settings(request)
    service = create_ai_safety_detector_service(settings)
    request.app.state.ai_safety_detector_service = service
    return service


def create_ai_safety_detector_service(settings: Settings) -> AiSafetyDetectorService:
    adapters = []
    if settings.ai_safety_local_model_enabled:
        model_ids = _model_ids(
            settings.ai_safety_detector_model_id,
            settings.ai_safety_additional_detector_model_ids,
        )
        adapters.extend(
            PrivacyFilterAdapter(
                model_name=model_id,
                source=source_for_model(model_id),
                runtime=settings.ai_safety_detector_runtime,
                allowed_detector_types=frozenset(settings.ai_safety_ml_allowed_detector_types),
            )
            for model_id in model_ids
        )
    if settings.azure_pii_enabled:
        adapters.append(
            AzurePiiAdapter(
                endpoint=settings.azure_pii_endpoint,
                api_key=settings.azure_pii_api_key,
                api_version=settings.azure_pii_api_version,
                language=settings.azure_pii_language,
                timeout_ms=settings.azure_pii_timeout_ms,
                allowed_detector_types=frozenset(settings.azure_pii_allowed_detector_types),
            )
        )
    allowed_detector_types = set()
    if settings.ai_safety_local_model_enabled:
        allowed_detector_types.update(settings.ai_safety_ml_allowed_detector_types)
    if settings.azure_pii_enabled:
        allowed_detector_types.update(settings.azure_pii_allowed_detector_types)

    return AiSafetyDetectorService(
        adapters=tuple(adapters),
        ml_allowed_detector_types=tuple(sorted(allowed_detector_types)),
    )


def _model_ids(model_id: str, additional_model_ids: tuple[str, ...]) -> tuple[str, ...]:
    ordered: list[str] = []
    seen: set[str] = set()
    for candidate in (model_id, *additional_model_ids):
        normalized = candidate.strip()
        if normalized == "" or any(char.isspace() for char in normalized):
            continue
        if normalized in seen:
            continue
        ordered.append(normalized)
        seen.add(normalized)
    return tuple(ordered)
