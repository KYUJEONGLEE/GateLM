from __future__ import annotations

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError

from app.api.dependencies import (
    AiSafetyConcurrencyGate,
    RoutingDifficultyConcurrencyGate,
    create_ai_safety_detector_service,
    create_pii_shadow_evaluator,
    create_routing_difficulty_batcher,
    create_routing_difficulty_service,
)
from app.api.routes import ai_safety, health, rag_extraction, routing_difficulty, safety
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
from app.services.pii_shadow import PiiShadowWorker


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
    ai_safety_concurrency_gate = AiSafetyConcurrencyGate(
        resolved_settings.ai_safety_max_concurrent,
        waiting_capacity=resolved_settings.ai_safety_max_pending,
        wait_timeout_ms=resolved_settings.ai_safety_wait_timeout_ms,
    )
    app.state.ai_safety_concurrency_gate = ai_safety_concurrency_gate
    detector_service = create_ai_safety_detector_service(resolved_settings)
    if resolved_settings.ai_safety_preload_enabled:
        detector_service.warmup()
    app.state.ai_safety_detector_service = detector_service
    if resolved_settings.pii_shadow_enabled:
        pii_shadow_evaluator = create_pii_shadow_evaluator(resolved_settings)
        pii_shadow_worker = PiiShadowWorker(
            evaluator=pii_shadow_evaluator,
            live_gate=ai_safety_concurrency_gate,
            timezone_name=resolved_settings.pii_shadow_timezone,
            window_start_hour=resolved_settings.pii_shadow_window_start_hour,
            window_end_hour=resolved_settings.pii_shadow_window_end_hour,
            poll_interval_seconds=(
                resolved_settings.pii_shadow_poll_interval_ms / 1000
            ),
        )
        app.state.pii_shadow_evaluator = pii_shadow_evaluator
        app.state.pii_shadow_worker = pii_shadow_worker
        app.add_event_handler("startup", pii_shadow_worker.start)
        app.add_event_handler("shutdown", pii_shadow_worker.stop)
    if resolved_settings.routing_difficulty_enabled:
        routing_difficulty_service = create_routing_difficulty_service(
            resolved_settings
        )
        routing_difficulty_service.warmup()
        app.state.routing_difficulty_service = routing_difficulty_service
        routing_difficulty_batcher = create_routing_difficulty_batcher(
            resolved_settings,
            routing_difficulty_service,
        )
        app.state.routing_difficulty_batcher = routing_difficulty_batcher
        app.add_event_handler("shutdown", routing_difficulty_batcher.close)
        app.state.routing_difficulty_concurrency_gate = (
            RoutingDifficultyConcurrencyGate(
                resolved_settings.routing_difficulty_max_concurrent
            )
        )
    app.include_router(health.router)
    app.include_router(safety.router)
    app.include_router(ai_safety.router)
    app.include_router(rag_extraction.router)
    app.include_router(routing_difficulty.router)
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
