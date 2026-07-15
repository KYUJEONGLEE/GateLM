from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.dependencies import get_ai_safety_detector_service
from app.core.config import Settings


router = APIRouter()


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ai-service",
    }


@router.get("/readyz")
def readyz(request: Request, response: Response) -> dict[str, object]:
    settings = request.app.state.settings
    if not isinstance(settings, Settings):
        return {
            "status": "ready",
            "service": "ai-service",
            "dependencies": {},
        }
    detector_dependency = _ai_safety_detector_dependency(request, settings)
    detector_ready = (
        not detector_dependency["required"]
        or detector_dependency["status"] == "loaded"
    )
    if not detector_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ready" if detector_ready else "not_ready",
        "service": "ai-service",
        "dependencies": {
            "remoteSafety": {
                "status": settings.remote_safety_mode,
                "required": False,
                "mode": settings.remote_safety_mode,
            },
            "aiSafetyDetector": detector_dependency,
        },
    }


def _ai_safety_detector_dependency(request: Request, settings: Settings) -> dict[str, object]:
    model_states = get_ai_safety_detector_service(request).detector_model_states()
    return {
        "status": _aggregate_load_state(model_states),
        "required": settings.ai_safety_preload_enabled,
        "runtime": _primary_runtime(model_states, settings),
        "primaryModel": model_states[0] if model_states else {},
        "additionalModels": model_states[1:],
    }


def _aggregate_load_state(model_states: list[dict[str, str]]) -> str:
    if model_states and all(model.get("loadState") == "loaded" for model in model_states):
        return "loaded"
    return "configured"


def _primary_runtime(model_states: list[dict[str, str]], settings: Settings) -> str:
    if model_states:
        runtime = model_states[0].get("runtime", "").strip()
        if runtime:
            return runtime
    return settings.ai_safety_detector_runtime
