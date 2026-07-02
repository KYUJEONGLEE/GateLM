from __future__ import annotations

import math
import re
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
ENTITY_PLACEHOLDER_PREFIX_BY_DETECTOR_TYPE = {
    "person_name": "PERSON",
    "organization_name": "ORGANIZATION",
    "postal_address": "ADDRESS",
    "email": "EMAIL",
    "phone_number": "PHONE_NUMBER",
}
PERSON_ROLE_PLACEHOLDER_PREFIXES = frozenset({"CUSTOMER", "AGENT", "DOCTOR", "PATIENT"})
PERSON_ROLE_CONTEXT_LABELS = (
    (
        "CUSTOMER",
        (
            "customer",
            "customer name",
            "client",
            "\uace0\uac1d",
            "\uace0\uac1d\uba85",
        ),
    ),
    (
        "AGENT",
        (
            "agent",
            "agent name",
            "support agent",
            "\uc0c1\ub2f4\uc6d0",
            "\uc0c1\ub2f4\uc0ac",
        ),
    ),
    (
        "DOCTOR",
        (
            "doctor",
            "doctor name",
            "physician",
            "\uc758\uc0ac",
            "\ub2f4\ub2f9 \uc758\uc0ac",
            "\uc8fc\uce58\uc758",
        ),
    ),
    (
        "PATIENT",
        (
            "patient",
            "patient name",
            "\ud658\uc790",
        ),
    ),
)
PERSON_ROLE_CONSUMABLE_CONTEXT_LABELS = (
    (
        "CUSTOMER",
        (
            "customer",
            "client",
            "\uace0\uac1d",
        ),
    ),
    (
        "AGENT",
        (
            "support agent",
            "agent",
            "\uc0c1\ub2f4\uc6d0",
            "\uc0c1\ub2f4\uc0ac",
        ),
    ),
    (
        "DOCTOR",
        (
            "doctor",
            "physician",
            "\ub2f4\ub2f9 \uc758\uc0ac",
            "\uc758\uc0ac",
            "\uc8fc\uce58\uc758",
        ),
    ),
    (
        "PATIENT",
        (
            "patient",
            "\ud658\uc790",
        ),
    ),
)
BUSINESS_ROLE_LABELS = (
    "\uc5d0\uc2a4\uceec\ub808\uc774\uc158 \ub2f4\ub2f9\uc790",
    "\ud504\ub85c\uc81d\ud2b8 \ub9e4\ub2c8\uc800",
    "\uad00\ub9ac\ucc45\uc784\uc790",
    "\ubc30\uc815\ub300\uc0c1\uc790",
    "\uc601\uc5c5\ub2f4\ub2f9\uc790",
    "\uacc4\uc815\ub2f4\ub2f9\uc790",
    "\ucc44\uc6a9\ub2f4\ub2f9\uc790",
    "\ubc95\ubb34\ub2f4\ub2f9\uc790",
    "\uacc4\uc57d\ub2f4\ub2f9\uc790",
    "\ud68c\uacc4\ub2f4\ub2f9\uc790",
    "\uc815\uc0b0\ub2f4\ub2f9\uc790",
    "\uc288\ud37c\ubc14\uc774\uc800",
    "\ub2f4\ub2f9\uc790",
    "\uc2b9\uc778\uc790",
    "\uac80\ud1a0\uc790",
    "\uc694\uccad\uc790",
    "\uacb0\uc7ac\uc790",
    "\uae30\uc548\uc790",
    "\ucc98\ub9ac\uc790",
    "\uc811\uc218\uc790",
    "\ucc38\uc870\uc790",
    "\uad00\ub9ac\uc790",
    "\ubcf8\ubd80\uc7a5",
    "\ucc45\uc784\uc790",
    "\uc6b4\uc601\uc790",
    "\uc2e4\ubb34\uc790",
    "\uc791\uc131\uc790",
    "\uc218\uc2e0\uc790",
    "\ubc1c\uc2e0\uc790",
    "\ubcf4\uace0\uc790",
    "\ud53c\ubcf4\uace0\uc790",
    "\ud611\uc5c5\uc790",
    "\uac80\uc218\uc790",
    "\ubc30\uc815\uc790",
    "\uc0c1\ub2f4\uc6d0",
    "\uc0c1\ub2f4\uc0ac",
    "\ud300\uc7a5",
    "\ub9e4\ub2c8\uc800",
    "\uc0c1\uc0ac",
    "\ubd80\ud558",
    "\ub9ac\ub354",
    "\ud30c\ud2b8\uc7a5",
    "\uc2e4\uc7a5",
    "\uac1c\ubc1c\uc790",
    "\ub514\uc790\uc774\ub108",
    "\uc9c0\uc6d0\uc790",
    "\uba74\uc811\uad00",
    "\ud3c9\uac00\uc790",
    "CSM",
    "PM",
    "PO",
    "PL",
    "QA",
    "AM",
    "AE",
)
KOREAN_PARTICLE_START_CHARS = frozenset("\uc740\ub294\uc774\uac00\uc744\ub97c\uc5d0\uaed8\uc640\uacfc\ub3c4\ub9cc\uc73c\ub85c")
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


class EntityMaskingScope:
    def __init__(self) -> None:
        self._placeholders: dict[str, dict[str, str]] = {}
        self._counters: dict[str, int] = {}

    def placeholder_for(
        self,
        detector_type: str,
        raw_value: str,
        fallback: str,
        *,
        role_prefix: str | None = None,
    ) -> str:
        prefix = ENTITY_PLACEHOLDER_PREFIX_BY_DETECTOR_TYPE.get(detector_type)
        if prefix is None:
            return fallback
        if detector_type == "person_name" and role_prefix in PERSON_ROLE_PLACEHOLDER_PREFIXES:
            prefix = role_prefix

        normalized = _normalize_entity_key(detector_type, raw_value)
        if normalized == "":
            return fallback

        placeholders = self._placeholders.setdefault(detector_type, {})
        existing = placeholders.get(normalized)
        if existing is not None:
            return existing

        next_index = self._counters.get(prefix, 0) + 1
        self._counters[prefix] = next_index
        placeholder = f"[{prefix}_{next_index}]"
        placeholders[normalized] = placeholder
        return placeholder


def redact_prompt(
    prompt_text: str,
    signals: list[SafetySignal],
    *,
    entity_scope: EntityMaskingScope | None = None,
) -> str:
    if not signals:
        return prompt_text
    scope = entity_scope or EntityMaskingScope()
    replacements: list[tuple[int, int, str]] = []
    for signal in signals:
        role_prefix, replacement_start = _person_role_context(prompt_text, signal)
        start = replacement_start if replacement_start is not None else signal.start
        if start < 0 or signal.end > len(prompt_text) or signal.end <= start:
            continue
        replacements.append(
            (
                start,
                signal.end,
                _placeholder_for_signal(prompt_text, signal, scope, role_prefix=role_prefix),
            )
        )
    replacements.extend(_business_role_replacements(prompt_text, replacements))
    return _apply_prompt_replacements(prompt_text, replacements)


def _business_role_replacements(
    prompt_text: str,
    protected_replacements: tuple[tuple[int, int, str], ...] | list[tuple[int, int, str]],
) -> list[tuple[int, int, str]]:
    replacements: list[tuple[int, int, str]] = []
    for role in BUSINESS_ROLE_LABELS:
        pattern = re.compile(_role_pattern(role), re.IGNORECASE)
        for match in pattern.finditer(prompt_text):
            start, end = match.span()
            if not _has_business_role_boundary(prompt_text, start, end):
                continue
            if _overlaps_any_replacement(start, end, protected_replacements):
                continue
            if _overlaps_any_replacement(start, end, replacements):
                continue
            replacements.append((start, end, f"[ROLE:{role}]"))
    return replacements


def _role_pattern(role: str) -> str:
    return re.escape(role).replace(r"\ ", r"\s+")


def _has_business_role_boundary(prompt_text: str, start: int, end: int) -> bool:
    if start > 0:
        previous = prompt_text[start - 1]
        if previous.isalnum() or _is_korean_syllable(previous):
            return False
    if end >= len(prompt_text):
        return True

    next_char = prompt_text[end]
    if next_char.isspace() or next_char in "\"')]}>,;:.":
        return True
    if next_char in KOREAN_PARTICLE_START_CHARS:
        return True
    return False


def _is_korean_syllable(value: str) -> bool:
    return len(value) == 1 and "\uac00" <= value <= "\ud7a3"


def _overlaps_any_replacement(
    start: int,
    end: int,
    replacements: tuple[tuple[int, int, str], ...] | list[tuple[int, int, str]],
) -> bool:
    for existing_start, existing_end, _ in replacements:
        if start < existing_end and existing_start < end:
            return True
    return False


def _apply_prompt_replacements(
    prompt_text: str,
    replacements: list[tuple[int, int, str]],
) -> str:
    if not replacements:
        return prompt_text
    chunks: list[str] = []
    offset = 0
    for start, end, placeholder in sorted(replacements, key=lambda item: (item[0], item[1])):
        if start < offset or end > len(prompt_text) or end <= start:
            continue
        chunks.append(prompt_text[offset:start])
        chunks.append(placeholder)
        offset = end
    chunks.append(prompt_text[offset:])
    return "".join(chunks)


def preview_redacted_prompt(redacted_prompt: str) -> str:
    normalized = " ".join(redacted_prompt.strip().split())
    if len(normalized) <= PREVIEW_MAX_CHARS:
        return normalized
    return normalized[:PREVIEW_MAX_CHARS] + "..."


def _placeholder_for_signal(
    prompt_text: str,
    signal: SafetySignal,
    entity_scope: EntityMaskingScope,
    *,
    role_prefix: str | None = None,
) -> str:
    if signal.action != "redact":
        return signal.placeholder
    raw_value = prompt_text[signal.start : signal.end]
    return entity_scope.placeholder_for(
        signal.detector_type,
        raw_value,
        signal.placeholder,
        role_prefix=role_prefix,
    )


def _normalize_entity_key(detector_type: str, raw_value: str) -> str:
    if detector_type in {"person_name", "organization_name", "postal_address"}:
        return " ".join(raw_value.strip().split())
    if detector_type == "email":
        return raw_value.strip()
    if detector_type == "phone_number":
        return re.sub(r"\D", "", raw_value)
    return raw_value.strip()


def _person_role_prefix(prompt_text: str, signal: SafetySignal) -> str | None:
    return _person_role_context(prompt_text, signal)[0]


def _person_role_context(prompt_text: str, signal: SafetySignal) -> tuple[str | None, int | None]:
    if signal.detector_type != "person_name":
        return None, None
    if signal.start < 0 or signal.start > len(prompt_text):
        return None, None

    context = _normalize_person_role_context(prompt_text[: signal.start])
    if not context:
        return None, None

    for prefix, labels in PERSON_ROLE_CONTEXT_LABELS:
        for label in labels:
            if context == label or context.endswith(f" {label}"):
                if _is_possessive_business_role_context(context, label):
                    return None, None
                return prefix, _person_role_replacement_start(prompt_text[: signal.start], prefix)
    return None, None


def _normalize_person_role_context(value: str) -> str:
    normalized = value.strip()
    normalized = normalized.removesuffix(":")
    normalized = normalized.removesuffix("=")
    normalized = normalized.strip().lower()
    normalized = normalized.replace("_", " ").replace("-", " ")
    return " ".join(normalized.split())


def _person_role_replacement_start(context: str, role_prefix: str) -> int | None:
    trimmed = context.rstrip()
    lower = trimmed.lower()
    for prefix, labels in PERSON_ROLE_CONSUMABLE_CONTEXT_LABELS:
        if prefix != role_prefix:
            continue
        for label in labels:
            label_start = len(lower) - len(label)
            if label_start < 0 or not lower.endswith(label):
                continue
            if not _has_person_role_label_boundary(lower, label_start):
                continue
            return len(trimmed) - len(label)
    return None


def _has_person_role_label_boundary(value: str, label_start: int) -> bool:
    if label_start <= 0:
        return True
    return value[label_start - 1].isspace() or value[label_start - 1] in "([{,.;:"


def _is_possessive_business_role_context(context: str, label: str) -> bool:
    if label not in BUSINESS_ROLE_LABELS:
        return False
    role_start = len(context) - len(label)
    if role_start < 0:
        return False
    before_role = context[:role_start].rstrip()
    return before_role.endswith("\uc758")


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
