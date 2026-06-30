from __future__ import annotations

import math
from collections import Counter
from dataclasses import replace

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
MERGEABLE_INFIX_CHARS = frozenset("._-+@:/?=&%#")


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
    effective = effective_signals(signals, prompt_text=prompt_text)
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


def effective_signals(
    signals: list[SafetySignal],
    *,
    prompt_text: str | None = None,
) -> list[SafetySignal]:
    candidates = [
        normalized
        for signal in signals
        if (normalized := _normalize_signal_span(signal, prompt_text)) is not None
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
    if prompt_text is None:
        return selected
    return _merge_adjacent_similar_signals(selected, prompt_text)


def redact_prompt(prompt_text: str, signals: list[SafetySignal]) -> str:
    if not signals:
        return prompt_text
    redaction_signals = effective_signals(signals, prompt_text=prompt_text)
    chunks: list[str] = []
    offset = 0
    for signal in redaction_signals:
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


def _normalize_signal_span(
    signal: SafetySignal,
    prompt_text: str | None,
) -> SafetySignal | None:
    if signal.start < 0 or signal.end <= signal.start:
        return None
    if prompt_text is None:
        return signal
    if signal.end > len(prompt_text):
        return None

    start = signal.start
    end = signal.end
    while start < end and prompt_text[start].isspace():
        start += 1
    while end > start and prompt_text[end - 1].isspace():
        end -= 1
    if end <= start:
        return None
    if start == signal.start and end == signal.end:
        return signal
    return replace(signal, start=start, end=end)


def _merge_adjacent_similar_signals(
    signals: list[SafetySignal],
    prompt_text: str,
) -> list[SafetySignal]:
    merged: list[SafetySignal] = []
    for signal in signals:
        if not merged:
            merged.append(signal)
            continue

        previous = merged[-1]
        gap = prompt_text[previous.end : signal.start]
        if _should_merge_adjacent_signal(previous, signal, gap):
            merged[-1] = replace(
                previous,
                end=signal.end,
                confidence=max(previous.confidence, signal.confidence),
            )
            continue
        merged.append(signal)
    return merged


def _should_merge_adjacent_signal(
    previous: SafetySignal,
    current: SafetySignal,
    gap: str,
) -> bool:
    if previous.detector_type != current.detector_type:
        return False
    if previous.action != current.action or previous.placeholder != current.placeholder:
        return False
    if current.start < previous.end:
        return False
    return gap == "" or all(char in MERGEABLE_INFIX_CHARS for char in gap)
