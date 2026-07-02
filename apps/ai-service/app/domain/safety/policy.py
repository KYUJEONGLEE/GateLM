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
DEFAULT_MERGEABLE_INFIX_CHARS = frozenset()
MERGEABLE_INFIX_CHARS_BY_DETECTOR_TYPE = {
    "email": frozenset("._-+@"),
    "private_url": frozenset(":/?=&%#._-+"),
    "webhook_url": frozenset(":/?=&%#._-+"),
    "database_url": frozenset(":/?=&%#._-+"),
    "phone_number": frozenset(" -.()"),
    "account_number": frozenset("-_"),
    "account_id": frozenset("-_"),
    "customer_id": frozenset("-_"),
    "employee_id": frozenset("-_"),
    "secret": frozenset("-_./+"),
    "api_key": frozenset("-_./+"),
    "provider_api_key": frozenset("-_./+"),
    "cloud_access_key": frozenset("-_./+"),
    "github_token": frozenset("-_./+"),
    "slack_token": frozenset("-_./+"),
    "jwt": frozenset(".-_"),
    "person_name": frozenset("-'"),
}
LEADING_BOUNDARY_CHARS = frozenset("\"'([{<")
TRAILING_BOUNDARY_CHARS_BY_DETECTOR_TYPE = {
    "private_url": frozenset("\"')]}>,;."),
    "webhook_url": frozenset("\"')]}>,;."),
    "database_url": frozenset("\"')]}>,;."),
}
DEFAULT_TRAILING_BOUNDARY_CHARS = frozenset("\"')]}>,;:.")


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
    selected = _signals_from_overlap_clusters(candidates)
    selected.sort(key=lambda signal: (signal.start, signal.end))
    if prompt_text is None:
        return selected
    return _merge_adjacent_similar_signals(selected, prompt_text)


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


def _confidence_rank(confidence: float) -> float:
    if not math.isfinite(confidence):
        return 0
    if confidence < 0:
        return 0
    if confidence > 1:
        return 1
    return confidence


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
    trailing_boundary_chars = _trailing_boundary_chars_for_detector_type(signal.detector_type)
    while start < end:
        char = prompt_text[start]
        if char.isspace() or char in LEADING_BOUNDARY_CHARS:
            start += 1
            continue
        break
    while end > start:
        char = prompt_text[end - 1]
        if char.isspace() or char in trailing_boundary_chars:
            end -= 1
            continue
        break
    if end <= start:
        return None
    if start == signal.start and end == signal.end:
        return signal
    return replace(signal, start=start, end=end)


def _signals_from_overlap_clusters(signals: list[SafetySignal]) -> list[SafetySignal]:
    if not signals:
        return []

    ordered = sorted(signals, key=lambda signal: (signal.start, signal.end))
    clusters: list[list[SafetySignal]] = []
    current_cluster: list[SafetySignal] = []
    current_end = -1

    for signal in ordered:
        if not current_cluster or signal.start < current_end:
            current_cluster.append(signal)
            current_end = max(current_end, signal.end)
            continue

        clusters.append(current_cluster)
        current_cluster = [signal]
        current_end = signal.end

    if current_cluster:
        clusters.append(current_cluster)

    return [_signal_from_overlap_cluster(cluster) for cluster in clusters]


def _signal_from_overlap_cluster(cluster: list[SafetySignal]) -> SafetySignal:
    if len(cluster) == 1:
        return cluster[0]

    action = "block" if any(signal.action == "block" for signal in cluster) else "redact"
    action_candidates = [signal for signal in cluster if signal.action == action]
    representative = min(
        action_candidates,
        key=lambda signal: (
            signal.priority,
            -signal.length,
            -_confidence_rank(signal.confidence),
            signal.start,
        ),
    )
    return replace(
        representative,
        start=min(signal.start for signal in cluster),
        end=max(signal.end for signal in cluster),
        confidence=max(_confidence_rank(signal.confidence) for signal in cluster),
    )


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
    mergeable_chars = _mergeable_infix_chars_for_detector_type(previous.detector_type)
    return gap == "" or all(char in mergeable_chars for char in gap)


def _mergeable_infix_chars_for_detector_type(detector_type: str) -> frozenset[str]:
    return MERGEABLE_INFIX_CHARS_BY_DETECTOR_TYPE.get(
        detector_type,
        DEFAULT_MERGEABLE_INFIX_CHARS,
    )


def _trailing_boundary_chars_for_detector_type(detector_type: str) -> frozenset[str]:
    return TRAILING_BOUNDARY_CHARS_BY_DETECTOR_TYPE.get(
        detector_type,
        DEFAULT_TRAILING_BOUNDARY_CHARS,
    )
