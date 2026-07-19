from __future__ import annotations

import unittest

import app.main  # noqa: F401 - initialize the service import graph used in production
from app.domain.routing_difficulty.runtime import RoutingDifficultyPrediction
from app.services.routing_difficulty import RoutingDifficultyService
from app.services.routing_difficulty_batcher import RoutingDifficultyBatcher


class RoutingDifficultyBatcherTests(unittest.TestCase):
    def test_rapid_submissions_share_one_runtime_batch(self) -> None:
        runtime = _RecordingBatchRuntime()
        batcher = RoutingDifficultyBatcher(
            RoutingDifficultyService(runtime),  # type: ignore[arg-type]
            maximum_batch_size=4,
            maximum_wait_ms=50,
            queue_capacity=8,
            worker_count=1,
        )
        self.addCleanup(batcher.close)

        futures = [
            batcher.submit(f"safe instruction {index}", [float(index)] * 42)
            for index in range(4)
        ]

        self.assertEqual(
            [future.result(timeout=1).difficulty for future in futures],
            ["simple", "complex", "simple", "complex"],
        )
        self.assertEqual(runtime.batch_sizes, [4])
        snapshot = batcher.snapshot()
        self.assertEqual(snapshot.batch_count, 1)
        self.assertEqual(snapshot.item_count, 4)
        self.assertEqual(snapshot.batch_size_histogram, ((4, 1),))

    def test_partial_batch_flushes_after_bounded_wait(self) -> None:
        runtime = _RecordingBatchRuntime()
        batcher = RoutingDifficultyBatcher(
            RoutingDifficultyService(runtime),  # type: ignore[arg-type]
            maximum_batch_size=4,
            maximum_wait_ms=5,
            queue_capacity=8,
            worker_count=1,
        )
        self.addCleanup(batcher.close)

        first = batcher.submit("safe instruction 0", [0.0] * 42)
        second = batcher.submit("safe instruction 1", [1.0] * 42)

        self.assertEqual(first.result(timeout=1).difficulty, "simple")
        self.assertEqual(second.result(timeout=1).difficulty, "complex")
        self.assertEqual(runtime.batch_sizes, [2])

    def test_batch_failure_is_returned_to_every_item(self) -> None:
        batcher = RoutingDifficultyBatcher(
            RoutingDifficultyService(_FailingBatchRuntime()),  # type: ignore[arg-type]
            maximum_batch_size=2,
            maximum_wait_ms=20,
            queue_capacity=2,
            worker_count=1,
        )
        self.addCleanup(batcher.close)

        futures = [
            batcher.submit(f"safe instruction {index}", [0.0] * 42)
            for index in range(2)
        ]

        for future in futures:
            with self.assertRaisesRegex(RuntimeError, "synthetic batch failure"):
                future.result(timeout=1)
        self.assertEqual(batcher.snapshot().failed_item_count, 2)


class _RecordingBatchRuntime:
    def __init__(self) -> None:
        self.batch_sizes: list[int] = []

    def warmup(self) -> None:
        return None

    def classify(self, _instruction: str, rule_vector: object) -> RoutingDifficultyPrediction:
        vector = list(rule_vector)  # type: ignore[arg-type]
        return _prediction(int(vector[0]))

    def classify_many(
        self,
        instructions: object,
        rule_vectors: object,
    ) -> list[RoutingDifficultyPrediction]:
        instruction_list = list(instructions)  # type: ignore[arg-type]
        vector_list = list(rule_vectors)  # type: ignore[arg-type]
        self.batch_sizes.append(len(instruction_list))
        return [_prediction(int(vector[0])) for vector in vector_list]


class _FailingBatchRuntime(_RecordingBatchRuntime):
    def classify_many(
        self,
        instructions: object,
        rule_vectors: object,
    ) -> list[RoutingDifficultyPrediction]:
        raise RuntimeError("synthetic batch failure")


def _prediction(index: int) -> RoutingDifficultyPrediction:
    return RoutingDifficultyPrediction(
        difficulty="simple" if index % 2 == 0 else "complex",
        calibrated_score=0.25 if index % 2 == 0 else 0.75,
    )


if __name__ == "__main__":
    unittest.main()
