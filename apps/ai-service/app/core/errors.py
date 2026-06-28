from __future__ import annotations

import logging
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


ERROR_INVALID_REMOTE_SAFETY_REQUEST = "invalid_remote_safety_request"
ERROR_REMOTE_SAFETY_UNAVAILABLE = "remote_safety_unavailable"

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ErrorField:
    path: str
    code: str


@dataclass
class RemoteSafetyHTTPError(Exception):
    status_code: int
    code: str
    message: str
    request_id: str
    retryable: bool
    fields: list[ErrorField] = field(default_factory=list)


def generated_request_id() -> str:
    return f"remote_safety_{uuid4().hex}"


def build_error_payload(
    *,
    code: str,
    message: str,
    request_id: str,
    retryable: bool,
    fields: list[ErrorField] | None = None,
) -> dict[str, object]:
    return {
        "error": {
            "code": code,
            "message": message,
            "requestId": request_id,
            "retryable": retryable,
            "fields": [
                {
                    "path": field.path,
                    "code": field.code,
                }
                for field in fields or []
            ],
        }
    }


async def remote_safety_http_error_handler(_request: Request, exc: RemoteSafetyHTTPError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=build_error_payload(
            code=exc.code,
            message=exc.message,
            request_id=exc.request_id,
            retryable=exc.retryable,
            fields=exc.fields,
        ),
    )


async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content=build_error_payload(
            code=ERROR_INVALID_REMOTE_SAFETY_REQUEST,
            message="Invalid remote safety request.",
            request_id=request_id_from_validation_error(exc),
            retryable=False,
            fields=sanitize_validation_errors(exc),
        ),
    )


async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Remote safety service failed with sanitized internal error. "
        "exception_class=%s traceback_locations=%s",
        type(exc).__name__,
        _sanitized_traceback_locations(exc),
        extra={"error_code": ERROR_REMOTE_SAFETY_UNAVAILABLE},
    )
    return JSONResponse(
        status_code=500,
        content=build_error_payload(
            code=ERROR_REMOTE_SAFETY_UNAVAILABLE,
            message="Remote safety service is unavailable.",
            request_id=generated_request_id(),
            retryable=True,
            fields=[],
        ),
    )


def _sanitized_traceback_locations(exc: Exception) -> str:
    if exc.__traceback__ is None:
        return "none"

    frames = traceback.extract_tb(exc.__traceback__)
    if not frames:
        return "none"

    return ", ".join(
        f"{Path(frame.filename).name}:{frame.lineno} in {frame.name}"
        for frame in frames
    )


def request_id_from_validation_error(exc: RequestValidationError) -> str:
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        ctx = body.get("ctx")
        if isinstance(ctx, dict):
            request_id = ctx.get("requestId")
            if isinstance(request_id, str) and request_id.strip():
                return request_id.strip()
    return generated_request_id()


def sanitize_validation_errors(exc: RequestValidationError) -> list[ErrorField]:
    fields: list[ErrorField] = []
    for error in exc.errors():
        path = _sanitize_error_path(error.get("loc", ()))
        code = _sanitize_error_code(str(error.get("type", "invalid")))
        fields.append(ErrorField(path=path, code=code))
    return fields


def _sanitize_error_path(loc: object) -> str:
    if not isinstance(loc, (list, tuple)):
        return "body"
    parts = [str(part) for part in loc if part != "body"]
    if not parts:
        return "body"
    return ".".join(parts)


def _sanitize_error_code(code: str) -> str:
    normalized = code.replace("value_error.", "").replace("type_error.", "")
    if not normalized:
        return "invalid"
    return normalized.split(".")[-1]
