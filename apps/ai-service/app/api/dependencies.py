from __future__ import annotations

from fastapi import Request

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
    service = AiSafetyDetectorService()
    request.app.state.ai_safety_detector_service = service
    return service
