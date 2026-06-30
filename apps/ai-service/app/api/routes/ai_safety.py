from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import get_ai_safety_detector_service
from app.schemas.safety import AiSafetyDetectRequest, AiSafetyDetectResponse
from app.services.ai_safety_detector import AiSafetyDetectorService


router = APIRouter()


@router.post(
    "/internal/ai-safety/v1/detect",
    response_model=AiSafetyDetectResponse,
    response_model_by_alias=True,
)
def detect_ai_safety(
    request_body: AiSafetyDetectRequest,
    service: AiSafetyDetectorService = Depends(get_ai_safety_detector_service),
) -> AiSafetyDetectResponse:
    return service.detect(request_body)
