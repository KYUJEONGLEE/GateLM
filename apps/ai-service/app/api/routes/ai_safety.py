from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import (
    AiSafetyConcurrencyGate,
    get_ai_safety_concurrency_gate,
    get_ai_safety_detector_service,
)
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION,
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AiSafetyBatchDetectRequest,
    AiSafetyBatchDetectResponse,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
)
from app.services.ai_safety_detector import AiSafetyDetectorService


router = APIRouter()

_RequestT = TypeVar("_RequestT")
_ResponseT = TypeVar("_ResponseT")
_AI_SAFETY_BACKGROUND_TASKS: set[asyncio.Task[Any]] = set()


@router.post(
    "/internal/ai-safety/v1/detect",
    response_model=AiSafetyDetectResponse,
    response_model_by_alias=True,
)
async def detect_ai_safety(
    request_body: AiSafetyDetectRequest,
    service: AiSafetyDetectorService = Depends(get_ai_safety_detector_service),
    concurrency_gate: AiSafetyConcurrencyGate = Depends(
        get_ai_safety_concurrency_gate
    ),
    request: Request = None,  # type: ignore[assignment]
) -> AiSafetyDetectResponse | JSONResponse:
    if not await _try_acquire_while_connected(request, concurrency_gate):
        return _ai_safety_busy_response(AI_SAFETY_DETECTOR_CONTRACT_VERSION)
    return await _run_detector_with_permit(
        service.detect,
        request_body,
        concurrency_gate,
    )


@router.post(
    "/internal/ai-safety/v1/detect/batch",
    response_model=AiSafetyBatchDetectResponse,
    response_model_by_alias=True,
)
async def detect_ai_safety_batch(
    request_body: AiSafetyBatchDetectRequest,
    service: AiSafetyDetectorService = Depends(get_ai_safety_detector_service),
    concurrency_gate: AiSafetyConcurrencyGate = Depends(
        get_ai_safety_concurrency_gate
    ),
    request: Request = None,  # type: ignore[assignment]
) -> AiSafetyBatchDetectResponse | JSONResponse:
    if not await _try_acquire_while_connected(request, concurrency_gate):
        return _ai_safety_busy_response(
            AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION
        )
    return await _run_detector_with_permit(
        service.detect_batch,
        request_body,
        concurrency_gate,
    )


async def _run_detector_with_permit(
    detector: Callable[[_RequestT], _ResponseT],
    request_body: _RequestT,
    concurrency_gate: AiSafetyConcurrencyGate,
) -> _ResponseT:
    owner_task = _track_background_task(
        asyncio.create_task(
            _execute_detector_and_release(
                detector,
                request_body,
                concurrency_gate,
            )
        )
    )
    return await asyncio.shield(owner_task)


async def _execute_detector_and_release(
    detector: Callable[[_RequestT], _ResponseT],
    request_body: _RequestT,
    concurrency_gate: AiSafetyConcurrencyGate,
) -> _ResponseT:
    try:
        return await run_in_threadpool(detector, request_body)
    finally:
        await concurrency_gate.release()


async def _try_acquire_while_connected(
    request: Request | None,
    concurrency_gate: AiSafetyConcurrencyGate,
) -> bool:
    if request is None:
        return await concurrency_gate.try_acquire()

    acquire_task = asyncio.create_task(concurrency_gate.try_acquire())
    disconnect_stop = asyncio.Event()
    disconnect_task = asyncio.create_task(
        _wait_for_disconnect(request, disconnect_stop)
    )
    cleanup_task: asyncio.Task[None] | None = None

    try:
        done, _ = await asyncio.wait(
            {acquire_task, disconnect_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        if disconnect_task in done and disconnect_task.result():
            cleanup_task = _start_failed_admission_cleanup(
                acquire_task,
                disconnect_task,
                disconnect_stop,
                concurrency_gate,
            )
            await asyncio.shield(cleanup_task)
            return False

        acquired = acquire_task.result()
        disconnect_stop.set()
        disconnected = await disconnect_task

        if not acquired:
            return False
        if disconnected:
            cleanup_task = _start_failed_admission_cleanup(
                acquire_task,
                disconnect_task,
                disconnect_stop,
                concurrency_gate,
            )
            await asyncio.shield(cleanup_task)
            return False
        return True
    except BaseException:
        if cleanup_task is None:
            _start_failed_admission_cleanup(
                acquire_task,
                disconnect_task,
                disconnect_stop,
                concurrency_gate,
            )
        raise


def _start_failed_admission_cleanup(
    acquire_task: asyncio.Task[bool],
    disconnect_task: asyncio.Task[bool],
    disconnect_stop: asyncio.Event,
    concurrency_gate: AiSafetyConcurrencyGate,
) -> asyncio.Task[None]:
    return _track_background_task(
        asyncio.create_task(
            _cleanup_failed_admission(
                acquire_task,
                disconnect_task,
                disconnect_stop,
                concurrency_gate,
            )
        )
    )


async def _cleanup_failed_admission(
    acquire_task: asyncio.Task[bool],
    disconnect_task: asyncio.Task[bool],
    disconnect_stop: asyncio.Event,
    concurrency_gate: AiSafetyConcurrencyGate,
) -> None:
    disconnect_stop.set()
    if not acquire_task.done():
        acquire_task.cancel()

    acquired = False
    try:
        acquired = await acquire_task
    except asyncio.CancelledError:
        pass
    except Exception:
        pass

    try:
        await disconnect_task
    except asyncio.CancelledError:
        pass
    except Exception:
        pass

    if acquired:
        await concurrency_gate.release()


async def _wait_for_disconnect(
    request: Request,
    stop_event: asyncio.Event,
) -> bool:
    while True:
        if await request.is_disconnected():
            return True
        if stop_event.is_set():
            return await request.is_disconnected()
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=0.005)
        except TimeoutError:
            continue
        return await request.is_disconnected()


def _track_background_task(
    task: asyncio.Task[_ResponseT],
) -> asyncio.Task[_ResponseT]:
    _AI_SAFETY_BACKGROUND_TASKS.add(task)
    task.add_done_callback(_background_task_finished)
    return task


def _background_task_finished(task: asyncio.Task[Any]) -> None:
    _AI_SAFETY_BACKGROUND_TASKS.discard(task)
    if not task.cancelled():
        task.exception()


def _ai_safety_busy_response(contract_version: str) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "contractVersion": contract_version,
            "error": {
                "code": "sidecar_unavailable",
                "message": "AI safety detector sidecar is unavailable.",
                "retryable": True,
            },
        },
    )
