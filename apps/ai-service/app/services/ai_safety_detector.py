from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, replace
from time import perf_counter
from typing import Protocol

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.heuristic_evaluator import PromptDetector, default_detectors
from app.adapters.safety.llm_classifier import LLMClassification
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
LLM_WINDOW_CONTEXT_CHARS = 320
DEFAULT_LLM_WINDOW_MAX_CHARS = 1000
DEFAULT_LLM_WINDOW_MAX_COUNT = 3
DEFAULT_LLM_TOTAL_TIMEOUT_MS = 2000
LLM_DETERMINISTIC_RULE_DETECTOR_TYPES = frozenset(
    {
        "api_key",
        "authorization_header",
        "cloud_access_key",
        "credit_card",
        "database_url",
        "driver_license",
        "email",
        "github_token",
        "ip_address",
        "jwt",
        "passport_number",
        "phone_number",
        "private_key",
        "provider_api_key",
        "resident_registration_number",
        "session_cookie",
        "slack_token",
        "webhook_url",
    }
)
LLM_CONTEXT_PATTERN = re.compile(
    r"\b(?:"
    r"account|address|bank|birthdate|birthday|confidential|customer|"
    r"delivery|health|internal|medicine|order|password|policy|private|"
    r"reset|secret|token|url"
    r")\b"
    r"|(?:"
    r"\uac1c\uc778\uc815\ubcf4|\uacc4\uc57d\uc11c|\uacc4\uc88c|\uace0\uac1d|"
    r"\uacf5\uac1c\s*\uc804|\ub0b4\ubd80|\ubc30\uc1a1|\ubcf8\uc0ac|"
    r"\ube44\ubc00\ubc88\ud638|\ube44\ubc88|\uc0dd\ub144\uc6d4\uc77c|"
    r"\uc8fc\ubbfc\ubc88\ud638|\uc8fc\ubbfc\ub4f1\ub85d\ubc88\ud638|"
    r"\uc8fc\ubb38\ubc88\ud638|\uc8fc\uc18c|\ud1a0\ud070|\uc6b0\uc6b8\uc99d|"
    r"\uc57d"
    r")",
    re.IGNORECASE,
)
LLM_CANDIDATE_PATTERNS = (
    LLM_CONTEXT_PATTERN,
    TITLE_CASE_PERSON_CANDIDATE_PATTERN,
    KOREAN_PERSON_CANDIDATE_PATTERN,
    ROLE_CONTEXT_PATTERN,
)
LLM_WINDOW_BOUNDARY_CHARS = frozenset(".!?\n\r\u3002\uff01\uff1f")
LLM_ADJACENT_CONTEXT_MAX_CHARS = 240
LLM_PRIORITY_CRITICAL = 0
LLM_PRIORITY_CONTEXTUAL_SENSITIVE = 1
LLM_PRIORITY_AMBIGUOUS_PII = 2
LLM_PRIORITY_GENERAL_CONTEXT = 3
LLM_ML_SUFFICIENT_CONFIDENCE = 0.90
LLM_RULE_SUFFICIENT_SOURCES = frozenset({"local_rule"})
LLM_SIGNAL_PRIORITY_BY_DETECTOR_TYPE = {
    "account_number": LLM_PRIORITY_CRITICAL,
    "password_assignment": LLM_PRIORITY_CRITICAL,
    "private_url": LLM_PRIORITY_CRITICAL,
    "resident_registration_number": LLM_PRIORITY_CRITICAL,
    "secret": LLM_PRIORITY_CRITICAL,
    "sensitive_health_context": LLM_PRIORITY_CONTEXTUAL_SENSITIVE,
    "confidential_business_context": LLM_PRIORITY_CONTEXTUAL_SENSITIVE,
    "account_id": LLM_PRIORITY_AMBIGUOUS_PII,
    "person_name": LLM_PRIORITY_AMBIGUOUS_PII,
    "postal_address": LLM_PRIORITY_AMBIGUOUS_PII,
    "private_date": LLM_PRIORITY_AMBIGUOUS_PII,
}
LLM_CRITICAL_CONTEXT_KEYWORDS = (
    "accountnumber",
    "bank",
    "password",
    "reset",
    "secret",
    "token",
    "url",
    "\uacc4\uc88c",
    "\ube44\ubc00\ubc88\ud638",
    "\ube44\ubc88",
    "\uc8fc\ubbfc\ubc88\ud638",
    "\uc8fc\ubbfc\ub4f1\ub85d\ubc88\ud638",
    "\ud1a0\ud070",
)
LLM_CONTEXTUAL_SENSITIVE_KEYWORDS = (
    "confidential",
    "health",
    "internal",
    "medicine",
    "policy",
    "\uacf5\uac1c\uc804",
    "\ub0b4\ubd80",
    "\uc57d",
    "\uc6b0\uc6b8\uc99d",
)
LLM_CONTEXT_COVERING_DETECTOR_TYPES_BY_KEYWORD = {
    "account": frozenset({"account_id", "account_number", "bank_account"}),
    "accountnumber": frozenset({"account_number", "bank_account"}),
    "bank": frozenset({"account_number", "bank_account"}),
    "birthdate": frozenset({"date_of_birth", "private_date"}),
    "birthday": frozenset({"date_of_birth", "private_date"}),
    "customer": frozenset({"person_name", "customer_id"}),
    "delivery": frozenset({"postal_address"}),
    "medicine": frozenset({"sensitive_health_context"}),
    "order": frozenset({"account_id"}),
    "password": frozenset({"password_assignment", "secret"}),
    "reset": frozenset({"private_url", "secret"}),
    "secret": frozenset(
        {
            "api_key",
            "authorization_header",
            "cloud_access_key",
            "database_url",
            "github_token",
            "jwt",
            "password_assignment",
            "private_key",
            "provider_api_key",
            "secret",
            "session_cookie",
            "slack_token",
            "webhook_url",
        }
    ),
    "token": frozenset(
        {
            "api_key",
            "authorization_header",
            "cloud_access_key",
            "github_token",
            "jwt",
            "provider_api_key",
            "secret",
            "session_cookie",
            "slack_token",
        }
    ),
    "url": frozenset({"database_url", "private_url", "webhook_url"}),
    "\uacc4\uc88c": frozenset({"account_number", "bank_account"}),
    "\ube44\ubc00\ubc88\ud638": frozenset({"password_assignment", "secret"}),
    "\ube44\ubc88": frozenset({"password_assignment", "secret"}),
    "\uc0dd\ub144\uc6d4\uc77c": frozenset({"date_of_birth", "private_date"}),
    "\uc8fc\ubb38\ubc88\ud638": frozenset({"account_id"}),
    "\uc8fc\ubbfc\ubc88\ud638": frozenset({"resident_registration_number"}),
    "\uc8fc\ubbfc\ub4f1\ub85d\ubc88\ud638": frozenset({"resident_registration_number"}),
    "\uc8fc\uc18c": frozenset({"postal_address"}),
    "\ud1a0\ud070": frozenset(
        {
            "api_key",
            "authorization_header",
            "cloud_access_key",
            "github_token",
            "jwt",
            "provider_api_key",
            "secret",
            "session_cookie",
            "slack_token",
        }
    ),
    "\uc57d": frozenset({"sensitive_health_context"}),
    "\uc6b0\uc6b8\uc99d": frozenset({"sensitive_health_context"}),
}


@dataclass(frozen=True)
class MlWindow:
    start: int
    end: int
    text: str


@dataclass(frozen=True)
class LlmCandidateSpan:
    start: int
    end: int
    priority: int


@dataclass(frozen=True)
class LlmCandidateWindow:
    start: int
    end: int
    priority: int
    first_candidate_start: int


class LLMClassifier(Protocol):
    def classify(self, window_text: str) -> tuple[LLMClassification, ...]:
        ...


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
        llm_classifier: LLMClassifier | None = None,
        llm_window_max_chars: int = DEFAULT_LLM_WINDOW_MAX_CHARS,
        llm_window_max_count: int = DEFAULT_LLM_WINDOW_MAX_COUNT,
        llm_total_timeout_ms: int = DEFAULT_LLM_TOTAL_TIMEOUT_MS,
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
        self.llm_classifier = llm_classifier
        self.llm_window_max_chars = _positive_int(llm_window_max_chars, DEFAULT_LLM_WINDOW_MAX_CHARS)
        self.llm_window_max_count = _positive_int(llm_window_max_count, DEFAULT_LLM_WINDOW_MAX_COUNT)
        self.llm_total_timeout_ms = _positive_int(llm_total_timeout_ms, DEFAULT_LLM_TOTAL_TIMEOUT_MS)

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
        llm_classifications = _llm_shadow_classifications(
            prompt_text,
            [*rule_signals, *ml_signals],
            classifier=self.llm_classifier,
            window_max_chars=self.llm_window_max_chars,
            window_max_count=self.llm_window_max_count,
            total_timeout_ms=self.llm_total_timeout_ms,
        )
        redacted_prompt = redact_prompt(prompt_text, signals)
        type_counts = Counter(
            [
                *(signal.detector_type for signal in signals),
                *(classification.detector_type for classification in llm_classifications),
            ]
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
                detectedCount=len(signals) + len(llm_classifications),
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
            ]
            + [
                AiSafetyDetection(
                    detectorType=classification.detector_type,
                    source=classification.source,
                    confidence=classification.confidence if request.detector_config.return_confidence else None,
                    action=classification.action,
                    mode="shadow",
                )
                for classification in llm_classifications
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


def _llm_shadow_classifications(
    prompt_text: str,
    detector_signals: list[SafetySignal],
    *,
    classifier: LLMClassifier | None,
    window_max_chars: int,
    window_max_count: int,
    total_timeout_ms: int,
) -> tuple[LLMClassification, ...]:
    if classifier is None:
        return ()
    windows = _llm_candidate_windows(
        prompt_text,
        detector_signals,
        window_max_chars=window_max_chars,
        window_max_count=window_max_count,
    )
    if not windows:
        return ()

    started = perf_counter()
    classifications: list[LLMClassification] = []
    for window in windows:
        if (perf_counter() - started) * 1000 >= total_timeout_ms:
            break
        try:
            classifications.extend(classifier.classify(window.text))
        except Exception:
            continue
    return tuple(_dedupe_llm_classifications(classifications))


def _llm_candidate_windows(
    prompt_text: str,
    detector_signals: list[SafetySignal],
    *,
    window_max_chars: int,
    window_max_count: int,
) -> tuple[MlWindow, ...]:
    spans = _llm_candidate_spans(prompt_text, detector_signals)
    if not spans:
        return ()
    sufficient_signals = _llm_sufficient_signals(detector_signals)

    raw_windows: list[LlmCandidateWindow] = []
    for span in spans:
        if span.start < 0 or span.end <= span.start or span.end > len(prompt_text):
            continue
        window_start, window_end = _llm_window_range_for_span(
            prompt_text,
            span.start,
            span.end,
            window_max_chars,
        )
        if _llm_window_triggers_fully_covered(
            prompt_text,
            spans,
            sufficient_signals,
            window_start,
            window_end,
        ):
            continue
        raw_windows.append(
            LlmCandidateWindow(
                start=window_start,
                end=window_end,
                priority=span.priority,
                first_candidate_start=span.start,
            )
        )

    windows = sorted(
        _merged_limited_windows(raw_windows, window_max_chars),
        key=lambda window: (
            window.priority,
            window.first_candidate_start,
            window.start,
            window.end,
        ),
    )
    return tuple(
        MlWindow(window.start, window.end, prompt_text[window.start : window.end])
        for window in windows[:window_max_count]
        if window.start < window.end
    )


def _llm_candidate_spans(
    prompt_text: str,
    detector_signals: list[SafetySignal],
) -> list[LlmCandidateSpan]:
    spans = [
        LlmCandidateSpan(
            start=signal.start,
            end=signal.end,
            priority=_llm_signal_priority(signal.detector_type),
        )
        for signal in detector_signals
        if signal.detector_type not in LLM_DETERMINISTIC_RULE_DETECTOR_TYPES
    ]
    for match in LLM_CONTEXT_PATTERN.finditer(prompt_text):
        spans.append(
            LlmCandidateSpan(
                start=match.start(),
                end=match.end(),
                priority=_llm_context_priority(prompt_text, match.start(), match.end()),
            )
        )
    for pattern in (TITLE_CASE_PERSON_CANDIDATE_PATTERN, KOREAN_PERSON_CANDIDATE_PATTERN, ROLE_CONTEXT_PATTERN):
        spans.extend(
            LlmCandidateSpan(
                start=match.start(),
                end=match.end(),
                priority=LLM_PRIORITY_AMBIGUOUS_PII,
            )
            for match in pattern.finditer(prompt_text)
        )
    return spans


def _merged_limited_windows(
    windows: Iterable[LlmCandidateWindow],
    window_max_chars: int,
) -> list[LlmCandidateWindow]:
    merged: list[LlmCandidateWindow] = []
    for window in sorted(windows, key=lambda item: (item.start, item.end)):
        if not merged or window.start > merged[-1].end:
            merged.append(window)
            continue
        previous = merged[-1]
        candidate_end = max(previous.end, window.end)
        if candidate_end - previous.start <= window_max_chars:
            merged[-1] = LlmCandidateWindow(
                start=previous.start,
                end=candidate_end,
                priority=min(previous.priority, window.priority),
                first_candidate_start=min(previous.first_candidate_start, window.first_candidate_start),
            )
            continue
        merged.append(window)
    return merged


def _llm_sufficient_signals(
    detector_signals: list[SafetySignal],
) -> tuple[SafetySignal, ...]:
    return tuple(
        signal
        for signal in detector_signals
        if _is_llm_sufficient_signal(signal)
    )


def _is_llm_sufficient_signal(signal: SafetySignal) -> bool:
    if signal.start < 0 or signal.end <= signal.start:
        return False
    if signal.source in LLM_RULE_SUFFICIENT_SOURCES or signal.source.startswith("regex_"):
        return True
    return signal.confidence >= LLM_ML_SUFFICIENT_CONFIDENCE


def _llm_window_triggers_fully_covered(
    prompt_text: str,
    spans: list[LlmCandidateSpan],
    sufficient_signals: tuple[SafetySignal, ...],
    window_start: int,
    window_end: int,
) -> bool:
    triggers = [
        span
        for span in spans
        if span.start < window_end and window_start < span.end
    ]
    if not triggers:
        return False
    return all(
        _llm_trigger_covered_by_sufficient_signal(
            prompt_text,
            trigger,
            sufficient_signals,
        )
        for trigger in triggers
    )


def _llm_trigger_covered_by_sufficient_signal(
    prompt_text: str,
    trigger: LlmCandidateSpan,
    sufficient_signals: tuple[SafetySignal, ...],
) -> bool:
    for signal in sufficient_signals:
        if signal.start <= trigger.start and trigger.end <= signal.end:
            return True
        if _llm_context_trigger_covered_by_signal(prompt_text, trigger, signal):
            return True
    return False


def _llm_context_trigger_covered_by_signal(
    prompt_text: str,
    trigger: LlmCandidateSpan,
    signal: SafetySignal,
) -> bool:
    if not _same_llm_sentence_or_line(prompt_text, trigger.start, trigger.end, signal.start, signal.end):
        return False
    normalized_trigger = _normalized_llm_context(prompt_text[trigger.start : trigger.end])
    covering_types = LLM_CONTEXT_COVERING_DETECTOR_TYPES_BY_KEYWORD.get(normalized_trigger)
    if covering_types is None:
        return False
    return signal.detector_type in covering_types


def _same_llm_sentence_or_line(
    prompt_text: str,
    left_start: int,
    left_end: int,
    right_start: int,
    right_end: int,
) -> bool:
    left_range = _llm_sentence_or_line_range(prompt_text, left_start, left_end)
    right_range = _llm_sentence_or_line_range(prompt_text, right_start, right_end)
    return left_range == right_range


def _llm_window_range_for_span(
    prompt_text: str,
    start: int,
    end: int,
    window_max_chars: int,
) -> tuple[int, int]:
    sentence_start, sentence_end = _llm_sentence_or_line_range(prompt_text, start, end)
    if sentence_end - sentence_start > window_max_chars:
        return _centered_window_range(prompt_text, start, end, window_max_chars)
    return _expand_llm_context_range(prompt_text, sentence_start, sentence_end, window_max_chars)


def _llm_sentence_or_line_range(
    prompt_text: str,
    start: int,
    end: int,
) -> tuple[int, int]:
    window_start = 0
    for index in range(start - 1, -1, -1):
        if prompt_text[index] in LLM_WINDOW_BOUNDARY_CHARS:
            window_start = index + 1
            break

    window_end = len(prompt_text)
    for index in range(end, len(prompt_text)):
        if prompt_text[index] in LLM_WINDOW_BOUNDARY_CHARS:
            window_end = index + 1
            break

    return _trim_window_range(prompt_text, window_start, window_end)


def _expand_llm_context_range(
    prompt_text: str,
    start: int,
    end: int,
    window_max_chars: int,
) -> tuple[int, int]:
    window_start = start
    window_end = end

    previous_range = _previous_llm_context_range(prompt_text, window_start)
    if previous_range is not None:
        previous_start, previous_end = previous_range
        if (
            previous_end - previous_start <= LLM_ADJACENT_CONTEXT_MAX_CHARS
            and window_end - previous_start <= window_max_chars
        ):
            window_start = previous_start

    next_range = _next_llm_context_range(prompt_text, window_end)
    if next_range is not None:
        next_start, next_end = next_range
        if (
            next_end - next_start <= LLM_ADJACENT_CONTEXT_MAX_CHARS
            and next_end - window_start <= window_max_chars
        ):
            window_end = next_end

    return window_start, window_end


def _previous_llm_context_range(prompt_text: str, start: int) -> tuple[int, int] | None:
    end = start
    while end > 0 and prompt_text[end - 1].isspace():
        end -= 1
    if end <= 0:
        return None

    previous_start = 0
    for index in range(end - 2, -1, -1):
        if prompt_text[index] in LLM_WINDOW_BOUNDARY_CHARS:
            previous_start = index + 1
            break
    previous_start, previous_end = _trim_window_range(prompt_text, previous_start, end)
    if previous_start >= previous_end:
        return None
    return previous_start, previous_end


def _next_llm_context_range(prompt_text: str, end: int) -> tuple[int, int] | None:
    start = end
    while start < len(prompt_text) and prompt_text[start].isspace():
        start += 1
    if start >= len(prompt_text):
        return None

    next_end = len(prompt_text)
    for index in range(start + 1, len(prompt_text)):
        if prompt_text[index] in LLM_WINDOW_BOUNDARY_CHARS:
            next_end = index + 1
            break
    next_start, next_end = _trim_window_range(prompt_text, start, next_end)
    if next_start >= next_end:
        return None
    return next_start, next_end


def _centered_window_range(
    prompt_text: str,
    start: int,
    end: int,
    window_max_chars: int,
) -> tuple[int, int]:
    half_window = max(1, window_max_chars // 2)
    center = start + ((end - start) // 2)
    window_start = max(0, center - half_window)
    window_end = min(len(prompt_text), window_start + window_max_chars)
    window_start = max(0, window_end - window_max_chars)
    return window_start, window_end


def _trim_window_range(prompt_text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and prompt_text[start].isspace():
        start += 1
    while end > start and prompt_text[end - 1].isspace():
        end -= 1
    return start, end


def _llm_signal_priority(detector_type: str) -> int:
    return LLM_SIGNAL_PRIORITY_BY_DETECTOR_TYPE.get(
        detector_type,
        LLM_PRIORITY_GENERAL_CONTEXT,
    )


def _llm_context_priority(prompt_text: str, start: int, end: int) -> int:
    sentence_start, sentence_end = _llm_sentence_or_line_range(prompt_text, start, end)
    normalized_context = _normalized_llm_context(prompt_text[sentence_start:sentence_end])
    if any(keyword in normalized_context for keyword in LLM_CRITICAL_CONTEXT_KEYWORDS):
        return LLM_PRIORITY_CRITICAL
    if any(keyword in normalized_context for keyword in LLM_CONTEXTUAL_SENSITIVE_KEYWORDS):
        return LLM_PRIORITY_CONTEXTUAL_SENSITIVE
    return LLM_PRIORITY_GENERAL_CONTEXT


def _normalized_llm_context(value: str) -> str:
    lowered = value.lower()
    return "".join(char for char in lowered if not char.isspace() and char not in "_-")


def _dedupe_llm_classifications(
    classifications: list[LLMClassification],
) -> list[LLMClassification]:
    deduped: dict[tuple[str, str, str], LLMClassification] = {}
    for classification in classifications:
        key = (
            classification.detector_type,
            classification.action,
            classification.reason_code,
        )
        existing = deduped.get(key)
        if existing is None or classification.confidence > existing.confidence:
            deduped[key] = classification
    return sorted(
        deduped.values(),
        key=lambda item: (item.detector_type, item.action, item.reason_code),
    )


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
