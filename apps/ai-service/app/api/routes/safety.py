from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_remote_safety_service
from app.schemas.safety import RemoteSafetyEvaluateRequest, RemoteSafetyEvaluateResponse
from app.services.safety_evaluator import RemoteSafetyEvaluationService


router = APIRouter()


@router.post(
    "/internal/v1/safety/evaluate",
    response_model=RemoteSafetyEvaluateResponse,
    response_model_by_alias=True,
)
def evaluate_safety(
    request_body: RemoteSafetyEvaluateRequest,
    service: RemoteSafetyEvaluationService = Depends(get_remote_safety_service),
) -> RemoteSafetyEvaluateResponse:
    return service.evaluate(request_body)
