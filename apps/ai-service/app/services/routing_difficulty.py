from __future__ import annotations

from typing import Protocol, Sequence

from app.domain.routing_difficulty.runtime import RoutingDifficultyPrediction


class RoutingDifficultyRuntimeProtocol(Protocol):
    def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingDifficultyPrediction: ...

    def warmup(self) -> None: ...


class RoutingDifficultyService:
    def __init__(self, runtime: RoutingDifficultyRuntimeProtocol) -> None:
        self._runtime = runtime

    def warmup(self) -> None:
        self._runtime.warmup()

    def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingDifficultyPrediction:
        return self._runtime.classify(instruction_text, rule_vector)
