from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import (
    AiSafetyConcurrencyGate,
    get_ai_safety_concurrency_gate,
    get_ai_safety_detector_service,
)
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION,
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AiSafetyBatchDetectRequest,
    AiSafetyBatchDetectResponse,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
)
from app.services.ai_safety_detector import AiSafetyDetectorService


router = APIRouter()


@router.post(
    "/internal/ai-safety/v1/detect",
    response_model=AiSafetyDetectResponse,
    response_model_by_alias=True,
)
async def detect_ai_safety(
    request_body: AiSafetyDetectRequest,
    service: AiSafetyDetectorService = Depends(get_ai_safety_detector_service),
    concurrency_gate: AiSafetyConcurrencyGate = Depends(
        get_ai_safety_concurrency_gate
    ),
) -> AiSafetyDetectResponse | JSONResponse:
    if not await concurrency_gate.try_acquire():
        return _ai_safety_busy_response(AI_SAFETY_DETECTOR_CONTRACT_VERSION)
    try:
        return await run_in_threadpool(service.detect, request_body)
    finally:
        await concurrency_gate.release()


@router.post(
    "/internal/ai-safety/v1/detect/batch",
    response_model=AiSafetyBatchDetectResponse,
    response_model_by_alias=True,
)
async def detect_ai_safety_batch(
    request_body: AiSafetyBatchDetectRequest,
    service: AiSafetyDetectorService = Depends(get_ai_safety_detector_service),
    concurrency_gate: AiSafetyConcurrencyGate = Depends(
        get_ai_safety_concurrency_gate
    ),
) -> AiSafetyBatchDetectResponse | JSONResponse:
    if not await concurrency_gate.try_acquire():
        return _ai_safety_busy_response(
            AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION
        )
    try:
        return await run_in_threadpool(service.detect_batch, request_body)
    finally:
        await concurrency_gate.release()


def _ai_safety_busy_response(contract_version: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "contractVersion": contract_version,
            "error": {
                "code": "sidecar_unavailable",
                "message": "AI safety detector sidecar is unavailable.",
                "retryable": True,
            },
        },
    )
