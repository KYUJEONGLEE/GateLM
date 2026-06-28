from __future__ import annotations

from time import perf_counter

from app.adapters.safety import HeuristicSafetyEvaluator
from app.core.config import REMOTE_SAFETY_MODE_SHADOW, Settings
from app.core.errors import ERROR_REMOTE_SAFETY_UNAVAILABLE, RemoteSafetyHTTPError
from app.domain.safety.decision import SafetyDecision
from app.domain.safety.evaluator import SafetyEvaluator
from app.schemas.safety import (
    CONTRACT_VERSION,
    ENGINE_VERSION,
    RemoteSafetyEvaluateRequest,
    RemoteSafetyEvaluateResponse,
    RemoteSafetyMetadata,
    SafetyDecisionResponse,
)


class RemoteSafetyEvaluationService:
    def __init__(
        self,
        settings: Settings,
        evaluator: SafetyEvaluator | None = None,
    ) -> None:
        self.settings = settings
        self.evaluator = evaluator or HeuristicSafetyEvaluator()

    def evaluate(self, request: RemoteSafetyEvaluateRequest) -> RemoteSafetyEvaluateResponse:
        if self.settings.remote_safety_mode != REMOTE_SAFETY_MODE_SHADOW:
            raise RemoteSafetyHTTPError(
                status_code=503,
                code=ERROR_REMOTE_SAFETY_UNAVAILABLE,
                message="Remote safety service is unavailable.",
                request_id=request.ctx.request_id,
                retryable=True,
            )

        started = perf_counter()
        decision = self.evaluator.evaluate(request.ctx, request.input)
        latency_ms = max(0, round((perf_counter() - started) * 1000))
        return RemoteSafetyEvaluateResponse(
            decision=_decision_response(decision),
            metadata=RemoteSafetyMetadata(
                contractVersion=CONTRACT_VERSION,
                engineVersion=ENGINE_VERSION,
                latencyMs=latency_ms,
                detectedTypeCounts=decision.detected_type_counts,
            ),
        )


def _decision_response(decision: SafetyDecision) -> SafetyDecisionResponse:
    return SafetyDecisionResponse(
        action=decision.action,
        detectedTypes=list(decision.detected_types),
        detectedCount=decision.detected_count,
        redactedPromptPreview=decision.redacted_prompt_preview,
        blockReason=decision.block_reason,
        securityPolicyHash=decision.security_policy_hash,
    )
