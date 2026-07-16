from __future__ import annotations

import hmac

from fastapi import Depends, Header

from app.api.dependencies import get_settings
from app.core.config import Settings
from app.domain.rag_extraction.errors import ERROR_AUTH_REQUIRED, RagExtractionError


RAG_SERVICE_TOKEN_HEADER = "X-GateLM-AI-Service-Token"


def require_rag_service_auth(
    provided_token: str | None = Header(default=None, alias=RAG_SERVICE_TOKEN_HEADER),
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.rag_service_token
    if (
        not expected
        or not provided_token
        or not hmac.compare_digest(expected, provided_token.strip())
    ):
        raise RagExtractionError(
            ERROR_AUTH_REQUIRED,
            "RAG extraction service authentication is required.",
            status_code=401,
        )
