from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from concurrent.futures import Future
from dataclasses import dataclass
from typing import Sequence

from app.domain.routing_difficulty.runtime import RoutingDifficultyPrediction
from app.services.routing_difficulty import RoutingDifficultyService


logger = logging.getLogger(__name__)


class RoutingDifficultyBatcherBusy(RuntimeError):
    """The bounded inference queue cannot accept another request."""


class RoutingDifficultyBatcherClosed(RuntimeError):
    """The inference batcher is shutting down."""


@dataclass(frozen=True)
class RoutingDifficultyBatchSnapshot:
    batch_size_limit: int
    maximum_wait_ms: float
    worker_count: int
    batch_count: int
    item_count: int
    failed_item_count: int
    maximum_observed_batch_size: int
    batch_size_histogram: tuple[tuple[int, int], ...]
    average_queue_wait_ms: float
    average_batch_inference_ms: float


@dataclass(frozen=True)
class _BatchItem:
    instruction_text: str
    rule_vector: tuple[float, ...]
    submitted_at: float
    future: Future[RoutingDifficultyPrediction]


_STOP = object()


class RoutingDifficultyBatcher:
    def __init__(
        self,
        service: RoutingDifficultyService,
        *,
        maximum_batch_size: int,
        maximum_wait_ms: float,
        queue_capacity: int,
        worker_count: int = 1,
    ) -> None:
        if maximum_batch_size <= 0 or queue_capacity <= 0 or worker_count <= 0:
            raise ValueError("routing difficulty batch bounds must be positive")
        if worker_count > queue_capacity:
            raise ValueError("routing difficulty worker count exceeds queue capacity")
        if maximum_wait_ms < 0:
            raise ValueError("routing difficulty batch wait must not be negative")
        self._service = service
        self._maximum_batch_size = maximum_batch_size
        self._maximum_wait_seconds = maximum_wait_ms / 1000.0
        self._worker_count = worker_count
        self._queue: queue.Queue[_BatchItem | object] = queue.Queue(
            maxsize=queue_capacity
        )
        self._closed = threading.Event()
        self._stats_lock = threading.Lock()
        self._batch_count = 0
        self._item_count = 0
        self._failed_item_count = 0
        self._maximum_observed_batch_size = 0
        self._batch_size_histogram: dict[int, int] = {}
        self._queue_wait_seconds = 0.0
        self._batch_inference_seconds = 0.0
        self._workers = [
            threading.Thread(
                target=self._run,
                name=f"gatelm-routing-difficulty-batcher-{index}",
                daemon=True,
            )
            for index in range(worker_count)
        ]
        for worker in self._workers:
            worker.start()

    async def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingDifficultyPrediction:
        future = self.submit(instruction_text, rule_vector)
        return await asyncio.wrap_future(future)

    def submit(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> Future[RoutingDifficultyPrediction]:
        if self._closed.is_set():
            raise RoutingDifficultyBatcherClosed(
                "routing difficulty batcher is closed"
            )
        future: Future[RoutingDifficultyPrediction] = Future()
        item = _BatchItem(
            instruction_text=instruction_text,
            rule_vector=tuple(float(value) for value in rule_vector),
            submitted_at=time.perf_counter(),
            future=future,
        )
        try:
            self._queue.put_nowait(item)
        except queue.Full as exc:
            raise RoutingDifficultyBatcherBusy(
                "routing difficulty batch queue is full"
            ) from exc
        return future

    def snapshot(self) -> RoutingDifficultyBatchSnapshot:
        with self._stats_lock:
            item_count = self._item_count
            batch_count = self._batch_count
            return RoutingDifficultyBatchSnapshot(
                batch_size_limit=self._maximum_batch_size,
                maximum_wait_ms=self._maximum_wait_seconds * 1000.0,
                worker_count=self._worker_count,
                batch_count=batch_count,
                item_count=item_count,
                failed_item_count=self._failed_item_count,
                maximum_observed_batch_size=self._maximum_observed_batch_size,
                batch_size_histogram=tuple(
                    sorted(self._batch_size_histogram.items())
                ),
                average_queue_wait_ms=(
                    self._queue_wait_seconds * 1000.0 / item_count
                    if item_count
                    else 0.0
                ),
                average_batch_inference_ms=(
                    self._batch_inference_seconds * 1000.0 / batch_count
                    if batch_count
                    else 0.0
                ),
            )

    def close(self) -> None:
        if self._closed.is_set():
            return
        self._closed.set()
        for _ in self._workers:
            while True:
                try:
                    self._queue.put(_STOP, timeout=0.1)
                    break
                except queue.Full:
                    if not any(worker.is_alive() for worker in self._workers):
                        break
        for worker in self._workers:
            worker.join(timeout=10.0)
        self._fail_remaining(
            RoutingDifficultyBatcherClosed(
                "routing difficulty batcher closed before inference"
            )
        )
        snapshot = self.snapshot()
        histogram = ",".join(
            f"{size}:{count}" for size, count in snapshot.batch_size_histogram
        )
        logger.info(
            "Routing difficulty batcher stopped. batches=%d items=%d failed_items=%d "
            "batch_size_limit=%d worker_count=%d max_observed_batch_size=%d batch_histogram=%s "
            "average_queue_wait_ms=%.3f average_batch_inference_ms=%.3f",
            snapshot.batch_count,
            snapshot.item_count,
            snapshot.failed_item_count,
            snapshot.batch_size_limit,
            snapshot.worker_count,
            snapshot.maximum_observed_batch_size,
            histogram or "none",
            snapshot.average_queue_wait_ms,
            snapshot.average_batch_inference_ms,
        )

    def _run(self) -> None:
        stop_after_batch = False
        while not stop_after_batch:
            first = self._queue.get()
            if first is _STOP:
                self._queue.task_done()
                break
            if not isinstance(first, _BatchItem):
                self._queue.task_done()
                continue
            batch = [first]
            deadline = time.perf_counter() + self._maximum_wait_seconds
            while len(batch) < self._maximum_batch_size:
                remaining = deadline - time.perf_counter()
                if remaining <= 0:
                    break
                try:
                    item = self._queue.get(timeout=remaining)
                except queue.Empty:
                    break
                if item is _STOP:
                    self._queue.task_done()
                    stop_after_batch = True
                    break
                if isinstance(item, _BatchItem):
                    batch.append(item)
                else:
                    self._queue.task_done()
            self._execute(batch)

    def _execute(self, batch: list[_BatchItem]) -> None:
        started_at = time.perf_counter()
        queue_wait_seconds = sum(
            max(0.0, started_at - item.submitted_at) for item in batch
        )
        failure: BaseException | None = None
        predictions: list[RoutingDifficultyPrediction] = []
        try:
            predictions = self._service.classify_many(
                [item.instruction_text for item in batch],
                [item.rule_vector for item in batch],
            )
            if len(predictions) != len(batch):
                raise RuntimeError("routing difficulty batch output is invalid")
        except BaseException as exc:
            failure = exc
        inference_seconds = time.perf_counter() - started_at
        with self._stats_lock:
            self._batch_count += 1
            self._item_count += len(batch)
            self._queue_wait_seconds += queue_wait_seconds
            self._batch_inference_seconds += inference_seconds
            self._maximum_observed_batch_size = max(
                self._maximum_observed_batch_size,
                len(batch),
            )
            self._batch_size_histogram[len(batch)] = (
                self._batch_size_histogram.get(len(batch), 0) + 1
            )
            if failure is not None:
                self._failed_item_count += len(batch)
        for index, item in enumerate(batch):
            if failure is None:
                item.future.set_result(predictions[index])
            else:
                item.future.set_exception(failure)
            self._queue.task_done()

    def _fail_remaining(self, failure: BaseException) -> None:
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                return
            if isinstance(item, _BatchItem) and not item.future.done():
                item.future.set_exception(failure)
            self._queue.task_done()
