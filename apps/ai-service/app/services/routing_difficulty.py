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

    def classify_many(
        self,
        instruction_texts: Sequence[str],
        rule_vectors: Sequence[Sequence[float]],
    ) -> list[RoutingDifficultyPrediction]:
        classify_many = getattr(self._runtime, "classify_many", None)
        if callable(classify_many):
            predictions = classify_many(instruction_texts, rule_vectors)
            if len(predictions) != len(instruction_texts):
                raise RuntimeError("routing difficulty batch output is invalid")
            return list(predictions)
        if len(instruction_texts) != len(rule_vectors):
            raise RuntimeError("routing difficulty batch input is invalid")
        return [
            self._runtime.classify(instruction_text, rule_vector)
            for instruction_text, rule_vector in zip(
                instruction_texts,
                rule_vectors,
                strict=True,
            )
        ]
