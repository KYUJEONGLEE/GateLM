from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, replace

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
KOREAN_SUBJECT_PARTICLE_CHARS = frozenset("\uc740\ub294\uc774\uac00")
SENTENCE_TERMINATOR_CHARS = frozenset(".!?\u3002\uff01\uff1f")
SENTENCE_INITIAL_COREFERENCE_LABELS = (
    ("\ud574\ub2f9 \uc9c1\uc6d0", True),
    ("\uadf8 \uc0ac\ub78c", True),
    ("\uc704 \uc0ac\ub78c", True),
    ("\uadf8\ub140", True),
    ("\uadf8\ubd84", True),
    ("\uadf8", True),
    ("they", False),
    ("she", False),
    ("he", False),
)
PERSON_COREFERENCE_PLACEHOLDER_PREFIXES = (
    "[PERSON_",
    "[CUSTOMER_",
    "[AGENT_",
    "[DOCTOR_",
    "[PATIENT_",
)
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


@dataclass(frozen=True)
class PersonAliasAnchor:
    full_name: str
    family_name: str
    given_name: str
    placeholder: str


class EntityMaskingScope:
    def __init__(self) -> None:
        self._placeholders: dict[str, dict[str, str]] = {}
        self._counters: dict[str, int] = {}
        self._person_anchors: dict[str, PersonAliasAnchor] = {}

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
        if detector_type == "person_name":
            return self._person_placeholder_for(normalized, prefix)

        placeholders = self._placeholders.setdefault(detector_type, {})
        existing = placeholders.get(normalized)
        if existing is not None:
            return existing

        placeholder = self._next_placeholder(prefix)
        placeholders[normalized] = placeholder
        return placeholder

    def _person_placeholder_for(self, normalized: str, prefix: str) -> str:
        placeholders = self._placeholders.setdefault("person_name", {})
        existing = placeholders.get(normalized)
        if existing is not None:
            return existing

        alias_placeholder = self._resolve_person_alias(normalized)
        if alias_placeholder is not None:
            placeholders[normalized] = alias_placeholder
            return alias_placeholder

        placeholder = self._next_placeholder(prefix)
        placeholders[normalized] = placeholder
        anchor = _new_person_alias_anchor(normalized, placeholder)
        if anchor is not None:
            self._person_anchors[anchor.full_name] = anchor
        return placeholder

    def _resolve_person_alias(self, normalized: str) -> str | None:
        if not self._person_anchors or _is_korean_full_name_key(normalized) or not _is_korean_alias_key(normalized):
            return None

        matches = [
            anchor.placeholder
            for anchor in self._person_anchors.values()
            if _person_alias_matches_anchor(normalized, anchor)
        ]
        if len(matches) != 1:
            return None
        return matches[0]

    def _next_placeholder(self, prefix: str) -> str:
        next_index = self._counters.get(prefix, 0) + 1
        self._counters[prefix] = next_index
        return f"[{prefix}_{next_index}]"


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
    person_replacements: list[tuple[int, int, str]] = []
    for signal in signals:
        role_prefix, replacement_start = _person_role_context(prompt_text, signal)
        start = replacement_start if replacement_start is not None else signal.start
        if start < 0 or signal.end > len(prompt_text) or signal.end <= start:
            continue
        placeholder = _placeholder_for_signal(prompt_text, signal, scope, role_prefix=role_prefix)
        replacement = (start, signal.end, placeholder)
        replacements.append(replacement)
        if signal.detector_type == "person_name" and signal.action == "redact":
            person_replacements.append(replacement)
    replacements.extend(_business_role_replacements(prompt_text, replacements))
    replacements.extend(_coreference_replacements(prompt_text, person_replacements, replacements))
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


def _coreference_replacements(
    prompt_text: str,
    person_replacements: list[tuple[int, int, str]],
    protected_replacements: list[tuple[int, int, str]],
) -> list[tuple[int, int, str]]:
    sentences = _sentence_ranges(prompt_text)
    if len(sentences) < 2:
        return []

    replacements: list[tuple[int, int, str]] = []
    for sentence_index in range(1, len(sentences)):
        coreference_span = _sentence_initial_coreference_span(prompt_text, sentences[sentence_index])
        if coreference_span is None:
            continue

        placeholder = _previous_sentence_subject_placeholder(
            prompt_text,
            sentences[sentence_index - 1],
            person_replacements,
        )
        if placeholder is None:
            continue

        start, end = coreference_span
        if _overlaps_any_replacement(start, end, protected_replacements):
            continue
        if _overlaps_any_replacement(start, end, replacements):
            continue
        replacements.append((start, end, placeholder))
    return replacements


def _sentence_ranges(prompt_text: str) -> list[tuple[int, int]]:
    if prompt_text == "":
        return []

    ranges: list[tuple[int, int]] = []
    start = 0
    for index, char in enumerate(prompt_text):
        if char not in SENTENCE_TERMINATOR_CHARS:
            continue
        end = index + 1
        ranges.append((start, end))
        start = end
    if start < len(prompt_text):
        ranges.append((start, len(prompt_text)))
    return ranges


def _sentence_initial_coreference_span(
    prompt_text: str,
    sentence: tuple[int, int],
) -> tuple[int, int] | None:
    start = _first_non_space_index(prompt_text, sentence[0], sentence[1])
    if start is None:
        return None

    for label, is_korean in SENTENCE_INITIAL_COREFERENCE_LABELS:
        end = start + len(label)
        if end > sentence[1]:
            continue
        raw_value = prompt_text[start:end]
        if is_korean:
            if raw_value == label and _has_korean_coreference_boundary(prompt_text, end):
                return start, end
            continue
        if raw_value.lower() == label and _has_english_word_boundary(prompt_text, end):
            return start, end
    return None


def _first_non_space_index(prompt_text: str, start: int, end: int) -> int | None:
    for index in range(start, end):
        if not prompt_text[index].isspace():
            return index
    return None


def _has_korean_coreference_boundary(prompt_text: str, end: int) -> bool:
    if end >= len(prompt_text):
        return True
    return prompt_text[end] in KOREAN_SUBJECT_PARTICLE_CHARS


def _has_english_word_boundary(prompt_text: str, end: int) -> bool:
    if end >= len(prompt_text):
        return True
    next_char = prompt_text[end]
    return not (next_char.isalnum() or next_char == "_")


def _previous_sentence_subject_placeholder(
    prompt_text: str,
    sentence: tuple[int, int],
    person_replacements: list[tuple[int, int, str]],
) -> str | None:
    people = sorted(
        (
            replacement
            for replacement in person_replacements
            if sentence[0] <= replacement[0] and replacement[1] <= sentence[1] and replacement[1] > replacement[0]
        ),
        key=lambda replacement: (replacement[0], replacement[1]),
    )
    if not people or _has_person_group_conjunction(prompt_text, people):
        return None

    candidates: list[tuple[int, int, str]] = []
    for replacement in people:
        start, end, placeholder = replacement
        if not _is_person_coreference_placeholder(placeholder):
            continue
        if _is_korean_subject_candidate(prompt_text, end) or _is_english_subject_candidate(prompt_text, sentence, start, end):
            candidates.append(replacement)
    if len(candidates) != 1:
        return None
    return candidates[0][2]


def _has_person_group_conjunction(
    prompt_text: str,
    people: list[tuple[int, int, str]],
) -> bool:
    for index in range(len(people) - 1):
        between = prompt_text[people[index][1] : people[index + 1][0]].strip()
        if between in {"\uc640", "\uacfc", "\ub791", "\ud558\uace0", "&"}:
            return True
        if between.lower() == "and":
            return True
    return False


def _is_korean_subject_candidate(prompt_text: str, end: int) -> bool:
    if end >= len(prompt_text):
        return False
    return prompt_text[end] in KOREAN_SUBJECT_PARTICLE_CHARS


def _is_english_subject_candidate(
    prompt_text: str,
    sentence: tuple[int, int],
    start: int,
    end: int,
) -> bool:
    return _first_non_space_index(prompt_text, sentence[0], sentence[1]) == start and _has_ascii_letter(prompt_text[start:end])


def _has_ascii_letter(value: str) -> bool:
    return any("A" <= char <= "Z" or "a" <= char <= "z" for char in value)


def _is_person_coreference_placeholder(placeholder: str) -> bool:
    return placeholder.startswith(PERSON_COREFERENCE_PLACEHOLDER_PREFIXES)


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
    if detector_type == "person_name":
        return _normalize_person_alias_key(raw_value)
    if detector_type in {"organization_name", "postal_address"}:
        return " ".join(raw_value.strip().split())
    if detector_type == "email":
        return raw_value.strip()
    if detector_type == "phone_number":
        return re.sub(r"\D", "", raw_value)
    return raw_value.strip()


def _normalize_person_alias_key(raw_value: str) -> str:
    normalized = " ".join(raw_value.strip().split())
    normalized = _strip_person_honorific_suffix(normalized)
    normalized = _strip_person_business_role_suffix(normalized)
    normalized = _strip_person_honorific_suffix(normalized)
    korean_key = normalized.replace(" ", "")
    if _is_korean_alias_key(korean_key):
        return korean_key
    return normalized


def _strip_person_honorific_suffix(value: str) -> str:
    while True:
        trimmed = value.strip()
        without_honorific = trimmed.removesuffix("\ub2d8").removesuffix("\uc528").strip()
        if without_honorific == trimmed:
            return trimmed
        value = without_honorific


def _strip_person_business_role_suffix(value: str) -> str:
    trimmed = value.strip()
    for role in BUSINESS_ROLE_LABELS:
        if len(trimmed) <= len(role) or trimmed[-len(role) :].lower() != role.lower():
            continue
        before_role_with_space = trimmed[: -len(role)]
        before_role = before_role_with_space.rstrip()
        if before_role == "" or len(before_role) == len(before_role_with_space):
            continue
        return before_role
    return trimmed


def _new_person_alias_anchor(normalized: str, placeholder: str) -> PersonAliasAnchor | None:
    if not _is_korean_full_name_key(normalized):
        return None
    return PersonAliasAnchor(
        full_name=normalized,
        family_name=normalized[0],
        given_name=normalized[1:],
        placeholder=placeholder,
    )


def _person_alias_matches_anchor(alias: str, anchor: PersonAliasAnchor) -> bool:
    if len(alias) == 1:
        return alias == anchor.family_name
    if len(alias) >= 2:
        return alias == anchor.given_name or anchor.full_name.endswith(alias)
    return False


def _is_korean_full_name_key(value: str) -> bool:
    return len(value) in {3, 4} and _is_korean_alias_key(value)


def _is_korean_alias_key(value: str) -> bool:
    return value != "" and all(_is_korean_syllable(char) for char in value)


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
