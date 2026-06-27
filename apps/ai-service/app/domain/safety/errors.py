from __future__ import annotations


class RemoteSafetyEvaluationError(RuntimeError):
    """Raised when the remote safety evaluator cannot produce a safe decision."""
