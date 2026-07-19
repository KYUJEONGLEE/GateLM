from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import Request

from app.core.config import Settings, load_settings
from app.domain.routing_difficulty.runtime import RoutingDifficultyRuntime
from app.services.ai_safety_detector import AiSafetyDetectorService
from app.services.rag_extraction import RagExtractionService
from app.services.routing_difficulty import RoutingDifficultyService
from app.services.safety_evaluator import RemoteSafetyEvaluationService


class RagExtractionConcurrencyGate:
    def __init__(self, maximum_concurrency: int) -> None:
        self._semaphore = asyncio.Semaphore(maximum_concurrency)

    async def __aenter__(self) -> None:
        await self._semaphore.acquire()

    async def __aexit__(self, *_: object) -> None:
        self._semaphore.release()


class RoutingDifficultyConcurrencyGate:
    def __init__(self, maximum_concurrency: int) -> None:
        self._maximum_concurrency = maximum_concurrency
        self._active = 0
        self._lock = asyncio.Lock()

    async def try_acquire(self) -> bool:
        async with self._lock:
            if self._active >= self._maximum_concurrency:
                return False
            self._active += 1
            return True

    async def release(self) -> None:
        async with self._lock:
            if self._active > 0:
                self._active -= 1


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
        person_name_model_only=settings.ai_safety_person_name_model_only,
    )


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


def create_routing_difficulty_service(
    settings: Settings,
) -> RoutingDifficultyService:
    runtime = RoutingDifficultyRuntime(
        artifact_root=Path(settings.routing_difficulty_artifact_root),
        encoder_manifest_path=Path(
            settings.routing_difficulty_encoder_manifest
        ),
        model_artifact_path=Path(settings.routing_difficulty_model_artifact),
        intra_op_threads=settings.routing_difficulty_onnx_intra_op_threads,
        inter_op_threads=settings.routing_difficulty_onnx_inter_op_threads,
    )
    return RoutingDifficultyService(runtime)


def get_routing_difficulty_service(
    request: Request,
) -> RoutingDifficultyService:
    service = getattr(request.app.state, "routing_difficulty_service", None)
    if isinstance(service, RoutingDifficultyService):
        return service
    settings = get_settings(request)
    if not settings.routing_difficulty_enabled:
        raise RuntimeError("routing difficulty service is disabled")
    service = create_routing_difficulty_service(settings)
    service.warmup()
    request.app.state.routing_difficulty_service = service
    return service


def get_routing_difficulty_concurrency_gate(
    request: Request,
) -> RoutingDifficultyConcurrencyGate:
    gate = getattr(request.app.state, "routing_difficulty_concurrency_gate", None)
    if isinstance(gate, RoutingDifficultyConcurrencyGate):
        return gate
    gate = RoutingDifficultyConcurrencyGate(
        get_settings(request).routing_difficulty_max_concurrent
    )
    request.app.state.routing_difficulty_concurrency_gate = gate
    return gate
