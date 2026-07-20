from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import (
    RoutingDifficultyConcurrencyGate,
    get_routing_lightgbm_shadow_batcher,
    get_routing_lightgbm_shadow_concurrency_gate,
    get_routing_lightgbm_shadow_service,
)
from app.api.routing_lightgbm_shadow_auth import (
    require_routing_lightgbm_shadow_service_auth,
)
from app.schemas.routing_lightgbm_shadow import (
    RoutingLightGBMShadowClassifyRequest,
    RoutingLightGBMShadowClassifyResponse,
)
from app.services.routing_difficulty_batcher import (
    RoutingDifficultyBatcher,
    RoutingDifficultyBatcherBusy,
)
from app.services.routing_lightgbm_shadow import RoutingLightGBMShadowService


router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/internal/routing/difficulty/lightgbm-shadow/v1/classify",
    response_model=RoutingLightGBMShadowClassifyResponse,
    response_model_by_alias=True,
    dependencies=[Depends(require_routing_lightgbm_shadow_service_auth)],
)
async def classify_routing_lightgbm_shadow(
    payload: RoutingLightGBMShadowClassifyRequest,
    service: RoutingLightGBMShadowService = Depends(
        get_routing_lightgbm_shadow_service
    ),
    batcher: RoutingDifficultyBatcher = Depends(
        get_routing_lightgbm_shadow_batcher
    ),
    concurrency_gate: RoutingDifficultyConcurrencyGate = Depends(
        get_routing_lightgbm_shadow_concurrency_gate
    ),
) -> RoutingLightGBMShadowClassifyResponse:
    identity = service.identity
    if (
        payload.model_version != identity.model_version
        or payload.model_content_hash != identity.model_content_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "routing_lightgbm_shadow_identity_mismatch"},
        )
    if not await concurrency_gate.try_acquire():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "routing_lightgbm_shadow_busy"},
        )
    try:
        prediction = await batcher.classify(
            payload.instruction_text,
            payload.rule_vector,
        )
    except RoutingDifficultyBatcherBusy:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "routing_lightgbm_shadow_busy"},
        ) from None
    except Exception as exc:
        logger.error(
            "Routing LightGBM shadow inference failed with sanitized internal error. "
            "exception_class=%s",
            type(exc).__name__,
            extra={"error_code": "ROUTING_LIGHTGBM_SHADOW_UNAVAILABLE"},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "routing_lightgbm_shadow_unavailable"},
        ) from None
    finally:
        await concurrency_gate.release()
    return RoutingLightGBMShadowClassifyResponse(
        difficulty=prediction.difficulty,
        modelVersion=identity.model_version,
        modelContentHash=identity.model_content_hash,
    )
