from __future__ import annotations

from typing import Protocol

from app.domain.safety.decision import SafetyDecision
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput


class SafetyEvaluator(Protocol):
    def evaluate(self, ctx: RemoteSafetyContext, input: RemoteSafetyInput) -> SafetyDecision:
        """Return a non-authoritative safety decision for shadow/evaluation use."""
