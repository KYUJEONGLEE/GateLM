from __future__ import annotations

import asyncio

from fastapi import Request

from app.core.config import Settings, load_settings
from app.services.ai_safety_detector import AiSafetyDetectorService
from app.services.rag_extraction import RagExtractionService
from app.services.safety_evaluator import RemoteSafetyEvaluationService


class RagExtractionConcurrencyGate:
    def __init__(self, maximum_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(maximum_concurrency)

    async def __aenter__(self) -> None:
        await self._semaphore.acquire()

    async def __aexit__(self, *_: object) -> None:
        self._semaphore.release()


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
    return AiSafetyDetectorService(
        model_id=settings.ai_safety_detector_model_id,
        additional_model_ids=settings.ai_safety_additional_detector_model_ids,
        detector_runtime=settings.ai_safety_detector_runtime,
        ml_allowed_detector_types=settings.ai_safety_ml_allowed_detector_types,
        ml_min_confidence_by_detector_type=dict(
            settings.ai_safety_ml_detector_thresholds
        ),
    )
    request.app.state.ai_safety_detector_service = service
    return service


def get_rag_extraction_service(request: Request) -> RagExtractionService:
    service = getattr(request.app.state, "rag_extraction_service", None)
    if isinstance(service, RagExtractionService):
        return service
    service = RagExtractionService(get_settings(request))
    request.app.state.rag_extraction_service = service
    return service


def get_rag_extraction_concurrency_gate(
    request: Request,
) -> RagExtractionConcurrencyGate:
    gate = getattr(request.app.state, "rag_extraction_concurrency_gate", None)
    if isinstance(gate, RagExtractionConcurrencyGate):
        return gate
    gate = RagExtractionConcurrencyGate(
        get_settings(request).rag_max_concurrent_extractions
    )
    request.app.state.rag_extraction_concurrency_gate = gate
    return gate
