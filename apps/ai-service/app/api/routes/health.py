from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.config import Settings


router = APIRouter()


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "ai-service",
    }


@router.get("/readyz")
def readyz(request: Request) -> dict[str, object]:
    settings = request.app.state.settings
    if not isinstance(settings, Settings):
        return {
            "status": "ready",
            "service": "ai-service",
            "dependencies": {},
        }
    return {
        "status": "ready",
        "service": "ai-service",
        "dependencies": {
            "remoteSafety": {
                "status": settings.remote_safety_mode,
                "required": False,
                "mode": settings.remote_safety_mode,
            }
        },
    }
