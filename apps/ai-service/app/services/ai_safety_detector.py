from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, replace
from time import perf_counter

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.heuristic_evaluator import PromptDetector, default_detectors
from app.adapters.safety.privacy_filter_adapter import public_model_id_for_model, source_for_model
from app.domain.safety.detections import Detection, safety_signals_from_detections
from app.domain.safety.policy import (
    BUSINESS_ROLE_LABELS,
    effective_signals,
    preview_redacted_prompt,
    redact_prompt,
)
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AI_SAFETY_DETECTOR_MODEL_ID,
    AI_SAFETY_DETECTOR_RUNTIME,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
    AiSafetyDetection,
    AiSafetyDetectorModel,
    AiSafetyDetectorSummary,
    SafetyDetector,
)


FAST_RULE_DETECTOR_TYPES = frozenset(
    {
        "account_id",
        "api_key",
        "authorization_header",
        "bank_account",
        "cloud_access_key",
        "credit_card",
        "customer_id",
        "database_url",
        "date_of_birth",
        "driver_license",
        "email",
        "employee_id",
        "github_token",
        "ip_address",
        "jwt",
        "passport_number",
        "password_assignment",
        "phone_number",
        "postal_address",
        "private_key",
        "private_url",
        "provider_api_key",
        "resident_registration_number",
        "session_cookie",
        "slack_token",
        "webhook_url",
    }
)
CHEAP_RULE_DETECTOR_TYPES = FAST_RULE_DETECTOR_TYPES | {"person_name"}
ML_WINDOWING_MIN_CHARS = 1000
ML_WINDOW_CONTEXT_CHARS = 240
ML_CONTEXT_PATTERN = re.compile(
    r"\b(?:"
    r"account(?:[_ -]?(?:id|number))?|address|applicant|birthday|candidate|"
    r"company|date|doctor|dob|employer|interviewer|manager|"
    r"name|organization|organisation|patient|postal|resident(?:[_ -]?registration)?"
    r"(?:[_ -]?number)?|secret|shipping|url"
    r")\b",
    re.IGNORECASE,
)
TITLE_CASE_PERSON_CANDIDATE_PATTERN = re.compile(
    r"(?<![A-Za-z])"
    r"[A-Z][a-z]{1,24}(?:\s+[A-Z][a-z]{1,24}){1,2}"
    r"(?![A-Za-z])"
)
KOREAN_PERSON_CANDIDATE_PATTERN = re.compile(
    r"[\uac00-\ud7a3]{2,4}"
    r"(?:\ub2d8|\uc528|\uc5d0\uac8c|\uaed8|\uc740|\ub294|\uc774|\uac00|\uc744|\ub97c|\uc758)"
)
CONTEXT_LABEL_PREFIX_BOUNDARY = r"(?<![A-Za-z0-9_\uac00-\ud7a3])"
CONTEXT_LABEL_SUFFIX_BOUNDARY = r"(?=$|[\s\"')\]}>,;:.!?]|[\uac00-\ud7a3])"
ROLE_CONTEXT_PATTERN = re.compile(
    "|".join(
        CONTEXT_LABEL_PREFIX_BOUNDARY
        + re.escape(role).replace(r"\ ", r"\s+")
        + CONTEXT_LABEL_SUFFIX_BOUNDARY
        for role in sorted(BUSINESS_ROLE_LABELS, key=len, reverse=True)
    ),
    re.IGNORECASE,
)
ML_CANDIDATE_PATTERNS = (
    ML_CONTEXT_PATTERN,
    TITLE_CASE_PERSON_CANDIDATE_PATTERN,
    KOREAN_PERSON_CANDIDATE_PATTERN,
    ROLE_CONTEXT_PATTERN,
)


@dataclass(frozen=True)
class MlWindow:
    start: int
    end: int
    text: str


DEFAULT_PRIVACY_FILTER_DETECTORS = (
    SafetyDetector(type="email", enabled=True, action="redact", placeholder="[EMAIL_REDACTED]"),
    SafetyDetector(
        type="phone_number",
        enabled=True,
        action="redact",
        placeholder="[PHONE_NUMBER_REDACTED]",
    ),
    SafetyDetector(
        type="person_name",
        enabled=True,
        action="redact",
        placeholder="[PERSON_NAME_REDACTED]",
    ),
    SafetyDetector(
        type="postal_address",
        enabled=True,
        action="redact",
        placeholder="[ADDRESS_REDACTED]",
    ),
    SafetyDetector(
        type="organization_name",
        enabled=True,
        action="redact",
        placeholder="[ORGANIZATION_NAME_REDACTED]",
    ),
    SafetyDetector(
        type="authorization_header",
        enabled=True,
        action="block",
        placeholder="[AUTHORIZATION_HEADER_REDACTED]",
    ),
    SafetyDetector(
        type="account_id",
        enabled=True,
        action="redact",
        placeholder="[ACCOUNT_ID_REDACTED]",
    ),
    SafetyDetector(
        type="private_date",
        enabled=True,
        action="redact",
        placeholder="[PRIVATE_DATE_REDACTED]",
    ),
    SafetyDetector(
        type="private_url",
        enabled=True,
        action="redact",
        placeholder="[PRIVATE_URL_REDACTED]",
    ),
    SafetyDetector(
        type="account_number",
        enabled=True,
        action="block",
        placeholder="[ACCOUNT_NUMBER_REDACTED]",
    ),
    SafetyDetector(
        type="resident_registration_number",
        enabled=True,
        action="block",
        placeholder="[RESIDENT_REGISTRATION_NUMBER_REDACTED]",
    ),
    SafetyDetector(
        type="password_assignment",
        enabled=True,
        action="block",
        placeholder="[PASSWORD_REDACTED]",
    ),
    SafetyDetector(
        type="credit_card",
        enabled=True,
        action="block",
        placeholder="[CREDIT_CARD_REDACTED]",
    ),
    SafetyDetector(
        type="passport_number",
        enabled=True,
        action="block",
        placeholder="[PASSPORT_NUMBER_REDACTED]",
    ),
    SafetyDetector(
        type="driver_license",
        enabled=True,
        action="block",
        placeholder="[DRIVER_LICENSE_REDACTED]",
    ),
    SafetyDetector(
        type="secret",
        enabled=True,
        action="block",
        placeholder="[SECRET_REDACTED]",
    ),
)


class AiSafetyDetectorService:
    def __init__(
        self,
        *,
        adapter: PrivacyFilterAdapter | None = None,
        adapters: tuple[PrivacyFilterAdapter, ...] | None = None,
        model_id: str = AI_SAFETY_DETECTOR_MODEL_ID,
        additional_model_ids: tuple[str, ...] = (),
        detectors: tuple[SafetyDetector, ...] = DEFAULT_PRIVACY_FILTER_DETECTORS,
        detector_runtime: str = "transformers",
    ) -> None:
        self.adapters = _resolve_adapters(
            adapter=adapter,
            adapters=adapters,
            model_id=model_id,
            additional_model_ids=additional_model_ids,
            detector_runtime=detector_runtime,
        )
        self.adapter = self.adapters[0]
        self.model_id = public_model_id_for_model(self.adapter.model_name)
        self.detectors = detectors
        self.fast_rule_detectors = _default_fast_rule_detectors()

    def detect(self, request: AiSafetyDetectRequest) -> AiSafetyDetectResponse:
        started = perf_counter()
        prompt_text = request.input.prompt_text
        detector_config = {detector.type: detector for detector in self.detectors}
        rule_signals = _fast_rule_signals(prompt_text, detector_config, self.fast_rule_detectors)
        ml_signals: list[SafetySignal] = []
        if _should_run_ml_adapters(prompt_text, detector_config, rule_signals):
            detections = _ml_detections(prompt_text, rule_signals, self.adapters)
            ml_signals = safety_signals_from_detections(
                detections,
                detector_config,
            )
            rule_signals = _rule_signals_not_covered_by_ml(rule_signals, ml_signals)
        signals = effective_signals(
            [*rule_signals, *ml_signals],
            prompt_text=prompt_text,
        )
        redacted_prompt = redact_prompt(prompt_text, signals)
        type_counts = Counter(
            signal.detector_type for signal in signals
        )
        outcome = _outcome_from_signals(signals)
        latency_ms = max(0, round((perf_counter() - started) * 1000))

        return AiSafetyDetectResponse(
            contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
            model=AiSafetyDetectorModel(
                modelId=self.model_id,
                runtime=AI_SAFETY_DETECTOR_RUNTIME,
            ),
            outcome=outcome,
            mode="shadow",
            redactedPrompt=redacted_prompt,
            redactedPromptPreview=preview_redacted_prompt(redacted_prompt),
            detectorSummary=AiSafetyDetectorSummary(
                detectedCount=len(signals),
                detectorCategories=sorted(type_counts),
            ),
            detections=[
                AiSafetyDetection(
                    detectorType=signal.detector_type,
                    source=signal.source,
                    confidence=signal.confidence if request.detector_config.return_confidence else None,
                    action=signal.action,
                    mode="shadow",
                )
                for signal in signals
            ],
            latencyMs=latency_ms,
        )


def _outcome_from_signals(signals: list[SafetySignal]) -> str:
    if any(signal.action == "block" for signal in signals):
        return "blocked"
    if signals:
        return "redacted"
    return "passed"


def _default_fast_rule_detectors() -> tuple[PromptDetector, ...]:
    return tuple(
        detector
        for detector in default_detectors()
        if detector.detector_type in CHEAP_RULE_DETECTOR_TYPES
    )


def _fast_rule_signals(
    prompt_text: str,
    detector_config: dict[str, SafetyDetector],
    detectors: tuple[PromptDetector, ...],
) -> list[SafetySignal]:
    signals: list[SafetySignal] = []
    for detector in detectors:
        config = detector_config.get(detector.detector_type)
        if config is None:
            continue
        signals.extend(detector.detect(prompt_text, config))
    return signals


def _should_run_ml_adapters(
    prompt_text: str,
    detector_config: dict[str, SafetyDetector],
    rule_signals: list[SafetySignal],
) -> bool:
    ml_enabled = any(
        detector_type not in FAST_RULE_DETECTOR_TYPES
        for detector_type in detector_config
    )
    if not ml_enabled:
        return False
    return any(
        not _ml_candidate_covered_by_rule(prompt_text, start, end, rule_signals)
        for start, end in _ml_context_candidate_spans(prompt_text)
    )


def _ml_detections(
    prompt_text: str,
    rule_signals: list[SafetySignal],
    adapters: tuple[PrivacyFilterAdapter, ...],
) -> list[Detection]:
    detections: list[Detection] = []
    for window in _ml_windows_for_prompt(prompt_text, rule_signals):
        for adapter in adapters:
            for detection in adapter.detect(window.text):
                offset_detection = _offset_detection(detection, window.start, len(prompt_text))
                if offset_detection is not None:
                    detections.append(offset_detection)
    return detections


def _ml_windows_for_prompt(
    prompt_text: str,
    rule_signals: list[SafetySignal],
) -> tuple[MlWindow, ...]:
    if len(prompt_text) <= ML_WINDOWING_MIN_CHARS:
        return (MlWindow(0, len(prompt_text), prompt_text),)

    windows = [
        (
            max(0, start - ML_WINDOW_CONTEXT_CHARS),
            min(len(prompt_text), end + ML_WINDOW_CONTEXT_CHARS),
        )
        for start, end in _ml_candidate_spans(prompt_text, rule_signals)
        if 0 <= start < end <= len(prompt_text)
    ]
    if not windows:
        return ()

    merged: list[tuple[int, int]] = []
    for start, end in sorted(windows):
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
            continue
        previous_start, previous_end = merged[-1]
        merged[-1] = (previous_start, max(previous_end, end))

    return tuple(
        MlWindow(start, end, prompt_text[start:end])
        for start, end in merged
        if start < end
    )


def _ml_candidate_spans(
    prompt_text: str,
    rule_signals: list[SafetySignal],
) -> list[tuple[int, int]]:
    spans = [(signal.start, signal.end) for signal in rule_signals]
    for pattern in ML_CANDIDATE_PATTERNS:
        spans.extend(match.span() for match in pattern.finditer(prompt_text))
    return spans


def _ml_context_candidate_spans(prompt_text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for pattern in ML_CANDIDATE_PATTERNS:
        spans.extend(match.span() for match in pattern.finditer(prompt_text))
    return spans


def _ml_candidate_covered_by_rule(
    prompt_text: str,
    start: int,
    end: int,
    rule_signals: list[SafetySignal],
) -> bool:
    return any(
        _ml_candidate_covered_by_rule_signal(prompt_text, start, end, signal)
        for signal in rule_signals
    )


def _ml_candidate_covered_by_rule_signal(
    prompt_text: str,
    start: int,
    end: int,
    signal: SafetySignal,
) -> bool:
    if start < signal.end and signal.start < end:
        return True
    if signal.detector_type != "person_name" or end > signal.start:
        return False
    gap = prompt_text[end : signal.start]
    return re.fullmatch(r"[\s:=\"'-]*", gap) is not None


def _offset_detection(
    detection: Detection,
    offset: int,
    prompt_length: int,
) -> Detection | None:
    start = detection.start + offset
    end = detection.end + offset
    if start < 0 or end <= start or end > prompt_length:
        return None
    return replace(detection, start=start, end=end)


def _rule_signals_not_covered_by_ml(
    rule_signals: list[SafetySignal],
    ml_signals: list[SafetySignal],
) -> list[SafetySignal]:
    return [
        rule_signal
        for rule_signal in rule_signals
        if not any(_same_type_overlap(rule_signal, ml_signal) for ml_signal in ml_signals)
    ]


def _same_type_overlap(left: SafetySignal, right: SafetySignal) -> bool:
    return (
        left.detector_type == right.detector_type
        and left.start < right.end
        and right.start < left.end
    )


def _resolve_adapters(
    *,
    adapter: PrivacyFilterAdapter | None,
    adapters: tuple[PrivacyFilterAdapter, ...] | None,
    model_id: str,
    additional_model_ids: tuple[str, ...],
    detector_runtime: str,
) -> tuple[PrivacyFilterAdapter, ...]:
    if adapters:
        return adapters
    if adapter is not None:
        return (adapter,)

    model_ids = _model_ids(model_id, additional_model_ids)
    return tuple(
        PrivacyFilterAdapter(
            model_name=detector_model_id,
            source=source_for_model(detector_model_id),
            runtime=detector_runtime,
        )
        for detector_model_id in model_ids
    )


def _model_ids(model_id: str, additional_model_ids: tuple[str, ...]) -> tuple[str, ...]:
    ordered: list[str] = []
    seen: set[str] = set()
    for candidate in (model_id, *additional_model_ids):
        normalized = candidate.strip()
        if normalized == "" or any(char.isspace() for char in normalized):
            continue
        if normalized in seen:
            continue
        ordered.append(normalized)
        seen.add(normalized)
    if not ordered:
        return (AI_SAFETY_DETECTOR_MODEL_ID,)
    return tuple(ordered)


def _positive_int(value: int, fallback: int) -> int:
    return value if value > 0 else fallback
