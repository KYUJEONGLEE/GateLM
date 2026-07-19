from __future__ import annotations

import hmac

from fastapi import Depends, Header, HTTPException, status

from app.api.dependencies import get_settings
from app.core.config import Settings


ROUTING_DIFFICULTY_SERVICE_TOKEN_HEADER = "X-GateLM-AI-Service-Token"


def require_routing_difficulty_service_auth(
    provided_token: str | None = Header(
        default=None,
        alias=ROUTING_DIFFICULTY_SERVICE_TOKEN_HEADER,
    ),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.routing_difficulty_service_token
    if (
        not settings.routing_difficulty_enabled
        or not expected
        or not provided_token
        or not hmac.compare_digest(expected, provided_token.strip())
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "routing_difficulty_auth_required"},
        )
