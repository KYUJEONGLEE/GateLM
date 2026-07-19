from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import (
    RoutingDifficultyConcurrencyGate,
    get_routing_difficulty_concurrency_gate,
    get_routing_difficulty_service,
)
from app.api.routing_difficulty_auth import require_routing_difficulty_service_auth
from app.schemas.routing_difficulty import (
    RoutingDifficultyClassifyRequest,
    RoutingDifficultyClassifyResponse,
)
from app.services.routing_difficulty import RoutingDifficultyService


router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/internal/routing/difficulty/v1/classify",
    response_model=RoutingDifficultyClassifyResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_routing_difficulty_service_auth)],
)
async def classify_routing_difficulty(
    payload: RoutingDifficultyClassifyRequest,
    service: RoutingDifficultyService = Depends(get_routing_difficulty_service),
    concurrency_gate: RoutingDifficultyConcurrencyGate = Depends(
        get_routing_difficulty_concurrency_gate
    ),
) -> RoutingDifficultyClassifyResponse:
    if not await concurrency_gate.try_acquire():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "routing_difficulty_busy"},
        )
    try:
        prediction = await run_in_threadpool(
            service.classify,
            payload.instruction_text,
            payload.rule_vector,
        )
    except Exception as exc:
        logger.error(
            "Routing difficulty inference failed with sanitized internal error. "
            "exception_class=%s",
            type(exc).__name__,
            extra={"error_code": "ROUTING_DIFFICULTY_UNAVAILABLE"},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "routing_difficulty_unavailable"},
        ) from None
    finally:
        await concurrency_gate.release()
    return RoutingDifficultyClassifyResponse(difficulty=prediction.difficulty)
