from __future__ import annotations

from typing import TYPE_CHECKING, Any


if TYPE_CHECKING:
    from app.domain.safety.decision import SafetyDecision
    from app.domain.safety.evaluator import SafetyEvaluator

__all__ = ["SafetyDecision", "SafetyEvaluator"]


def __getattr__(name: str) -> Any:
    if name == "SafetyDecision":
        from app.domain.safety.decision import SafetyDecision

        return SafetyDecision
    if name == "SafetyEvaluator":
        from app.domain.safety.evaluator import SafetyEvaluator

        return SafetyEvaluator
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
