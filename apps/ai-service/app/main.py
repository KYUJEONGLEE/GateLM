from __future__ import annotations

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from app.api.dependencies import create_ai_safety_detector_service
from app.api.routes import ai_safety, health, rag_extraction, safety
from app.core.config import Settings, load_settings
from app.core.errors import (
    RemoteSafetyHTTPError,
    rag_extraction_error_handler,
    remote_safety_http_error_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from app.domain.rag_extraction.errors import RagExtractionError
from app.domain.rag_extraction.temp_files import prepare_rag_temp_directory
from app.core.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved_settings = settings or load_settings()
    prepare_rag_temp_directory(resolved_settings)
    configure_logging(resolved_settings.log_level)

    app = FastAPI(
        title="GateLM AI Service",
        version="0.0.0",
        docs_url=None,
        redoc_url=None,
    )
    app.state.settings = resolved_settings
    detector_service = create_ai_safety_detector_service(resolved_settings)
    if resolved_settings.ai_safety_preload_enabled:
        detector_service.warmup()
    app.state.ai_safety_detector_service = detector_service
    app.include_router(health.router)
    app.include_router(safety.router)
    app.include_router(ai_safety.router)
    app.include_router(rag_extraction.router)
    app.add_exception_handler(RemoteSafetyHTTPError, remote_safety_http_error_handler)
    app.add_exception_handler(RagExtractionError, rag_extraction_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)
    return app


app = create_app()


def run() -> None:
    import uvicorn

    settings = load_settings()
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
        access_log=settings.access_log_enabled,
    )


if __name__ == "__main__":
    run()
