from __future__ import annotations

import math
from collections import Counter

from app.domain.safety.decision import (
    ACTION_BLOCKED,
    ACTION_NONE,
    ACTION_REDACTED,
    BLOCK_REASON_SENSITIVE_DATA_BLOCKED,
    SafetyDecision,
)
from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import SafetyDetector


PREVIEW_MAX_CHARS = 120


def enabled_detector_map(detectors: list[SafetyDetector]) -> dict[str, SafetyDetector]:
    enabled: dict[str, SafetyDetector] = {}
    for detector in detectors:
        if detector.type not in ALLOWED_DETECTOR_TYPES:
            raise ValueError("unsupported_detector_type")
        if detector.enabled:
            enabled[detector.type] = detector
    return enabled


def build_safety_decision(
    *,
    prompt_text: str,
    signals: list[SafetySignal],
    security_policy_hash: str,
) -> SafetyDecision:
    effective = effective_signals(signals)
    if not effective:
        return SafetyDecision(
            action=ACTION_NONE,
            detected_types=(),
            detected_count=0,
            redacted_prompt_preview=None,
            block_reason=None,
            security_policy_hash=security_policy_hash,
        )

    action = ACTION_REDACTED
    if any(signal.action == "block" for signal in effective):
        action = ACTION_BLOCKED

    type_counts = dict(Counter(signal.detector_type for signal in effective))
    redacted_prompt = redact_prompt(prompt_text, effective)
    return SafetyDecision(
        action=action,
        detected_types=tuple(sorted(type_counts)),
        detected_count=len(effective),
        redacted_prompt_preview=preview_redacted_prompt(redacted_prompt),
        block_reason=BLOCK_REASON_SENSITIVE_DATA_BLOCKED if action == ACTION_BLOCKED else None,
        security_policy_hash=security_policy_hash,
        detected_type_counts=type_counts,
    )


def effective_signals(signals: list[SafetySignal]) -> list[SafetySignal]:
    candidates = [
        signal
        for signal in signals
        if signal.start >= 0 and signal.end > signal.start
    ]
    candidates.sort(
        key=lambda signal: (
            -_action_rank(signal.action),
            signal.priority,
            -_confidence_rank(signal.confidence),
            -signal.length,
            signal.start,
        )
    )

    selected: list[SafetySignal] = []
    for candidate in candidates:
        if any(_overlaps(candidate, existing) for existing in selected):
            continue
        selected.append(candidate)

    selected.sort(key=lambda signal: (signal.start, signal.end))
    return selected


def redact_prompt(prompt_text: str, signals: list[SafetySignal]) -> str:
    if not signals:
        return prompt_text
    chunks: list[str] = []
    offset = 0
    for signal in signals:
        if signal.start < offset or signal.end > len(prompt_text):
            continue
        chunks.append(prompt_text[offset:signal.start])
        chunks.append(signal.placeholder)
        offset = signal.end
    chunks.append(prompt_text[offset:])
    return "".join(chunks)


def preview_redacted_prompt(redacted_prompt: str) -> str:
    normalized = " ".join(redacted_prompt.strip().split())
    if len(normalized) <= PREVIEW_MAX_CHARS:
        return normalized
    return normalized[:PREVIEW_MAX_CHARS] + "..."


def _action_rank(action: str) -> int:
    if action == "block":
        return 2
    if action == "redact":
        return 1
    return 0


def _confidence_rank(confidence: float) -> float:
    if not math.isfinite(confidence):
        return 0
    if confidence < 0:
        return 0
    if confidence > 1:
        return 1
    return confidence


def _overlaps(left: SafetySignal, right: SafetySignal) -> bool:
    return left.start < right.end and right.start < left.end
