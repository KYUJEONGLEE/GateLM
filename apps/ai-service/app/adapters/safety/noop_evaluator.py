from __future__ import annotations

from app.domain.safety.decision import ACTION_NONE, SafetyDecision
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput


class NoopSafetyEvaluator:
    def evaluate(self, ctx: RemoteSafetyContext, input: RemoteSafetyInput) -> SafetyDecision:
        return SafetyDecision(
            action=ACTION_NONE,
            detected_types=(),
            detected_count=0,
            redacted_prompt_preview=None,
            block_reason=None,
            security_policy_hash=ctx.security_policy_hash,
        )
