from __future__ import annotations

from typing import Protocol, Sequence

from app.domain.routing_lightgbm_shadow.runtime import (
    RoutingLightGBMShadowIdentity,
    RoutingLightGBMShadowPrediction,
)


class RoutingLightGBMShadowRuntimeProtocol(Protocol):
    @property
    def identity(self) -> RoutingLightGBMShadowIdentity: ...

    def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingLightGBMShadowPrediction: ...

    def classify_many(
        self,
        instruction_texts: Sequence[str],
        rule_vectors: Sequence[Sequence[float]],
    ) -> list[RoutingLightGBMShadowPrediction]: ...

    def warmup(self) -> None: ...


class RoutingLightGBMShadowService:
    def __init__(self, runtime: RoutingLightGBMShadowRuntimeProtocol) -> None:
        self._runtime = runtime

    @property
    def identity(self) -> RoutingLightGBMShadowIdentity:
        return self._runtime.identity

    def warmup(self) -> None:
        self._runtime.warmup()

    def classify(
        self,
        instruction_text: str,
        rule_vector: Sequence[float],
    ) -> RoutingLightGBMShadowPrediction:
        return self._runtime.classify(instruction_text, rule_vector)

    def classify_many(
        self,
        instruction_texts: Sequence[str],
        rule_vectors: Sequence[Sequence[float]],
    ) -> list[RoutingLightGBMShadowPrediction]:
        return self._runtime.classify_many(instruction_texts, rule_vectors)
