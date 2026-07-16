from __future__ import annotations

import os
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
    EntityMaskingScope,
    effective_signals,
    preview_redacted_prompt,
    redact_prompt,
)
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION,
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AI_SAFETY_DETECTOR_MODEL_ID,
    AI_SAFETY_DETECTOR_RUNTIME,
    AiSafetyBatchDetectRequest,
    AiSafetyBatchDetectResponse,
    AiSafetyBatchResult,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
    AiSafetyDetection,
    AiSafetyDetectorModel,
    AiSafetyDetectorPolicy,
    AiSafetyDetectorSummary,
    AiSafetyExecutionSummary,
    SafetyDetector,
)


FAST_RULE_DETECTOR_TYPES = frozenset(
    {
        "account_id",
        "account_number",
        "api_key",
        "authorization_header",
        "bank_account",
        "cloud_access_key",
        "confidential_business_context",
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
        "organization_name",
        "passport_number",
        "password_assignment",
        "phone_number",
        "postal_address",
        "private_date",
        "private_key",
        "private_url",
        "provider_api_key",
        "resident_registration_number",
        "secret",
        "sensitive_health_context",
        "session_cookie",
        "slack_token",
        "webhook_url",
    }
)
CHEAP_RULE_DETECTOR_TYPES = FAST_RULE_DETECTOR_TYPES | {"person_name"}
ML_WINDOW_CONTEXT_CHARS = 240
ML_WINDOW_MAX_CHARS = ML_WINDOW_CONTEXT_CHARS * 2
ML_MAX_CANDIDATES_PER_REQUEST = 128
ML_MAX_WINDOWS_PER_REQUEST = 64
ML_WORK_LIMIT_ERROR = "AI safety model work limit exceeded."
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
ML_TYPED_CANDIDATE_PATTERNS = (
    (frozenset({"account_number"}), re.compile(r"\baccount(?:[_ -]?number)?\b", re.IGNORECASE)),
    (frozenset({"postal_address"}), re.compile(r"\b(?:address|postal|shipping)\b", re.IGNORECASE)),
    (frozenset({"private_date"}), re.compile(r"\b(?:birthday|date|dob)\b", re.IGNORECASE)),
    (frozenset({"private_url"}), re.compile(r"\burl\b", re.IGNORECASE)),
    (frozenset({"secret"}), re.compile(r"\bsecret\b", re.IGNORECASE)),
    (
        frozenset({"resident_registration_number"}),
        re.compile(r"\bresident(?:[_ -]?registration)?(?:[_ -]?number)?\b", re.IGNORECASE),
    ),
    (frozenset({"email"}), re.compile(r"\b(?:email|e-mail)\b", re.IGNORECASE)),
    (frozenset({"phone_number"}), re.compile(r"\b(?:phone|telephone|mobile)\b", re.IGNORECASE)),
    (
        frozenset({"organization_name"}),
        re.compile(r"\b(?:company|employer|organization|organisation)\b", re.IGNORECASE),
    ),
    (
        frozenset({"person_name"}),
        re.compile(r"\b(?:applicant|candidate|doctor|interviewer|manager|name|patient)\b", re.IGNORECASE),
    ),
    (frozenset({"person_name"}), ROLE_CONTEXT_PATTERN),
    (frozenset({"person_name"}), TITLE_CASE_PERSON_CANDIDATE_PATTERN),
    (frozenset({"person_name"}), KOREAN_PERSON_CANDIDATE_PATTERN),
)
NON_REAL_CONTEXT_CHARS = 80
NON_REAL_ALLOW_DETECTOR_TYPES = frozenset(
    {
        "account_id",
        "account_number",
        "api_key",
        "authorization_header",
        "bank_account",
        "cloud_access_key",
        "confidential_business_context",
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
        "organization_name",
        "passport_number",
        "password_assignment",
        "person_name",
        "phone_number",
        "postal_address",
        "private_date",
        "private_key",
        "private_url",
        "provider_api_key",
        "resident_registration_number",
        "secret",
        "sensitive_health_context",
        "session_cookie",
        "slack_token",
        "webhook_url",
    }
)
NON_REAL_DATA_CONTEXT_PATTERN = re.compile(
    r"(?<![@.])\b(?:example|sample|dummy|mock|fake|placeholder|fixture|template|"
    r"format(?:\s+only|\s+example)?|docs?|documentation|catalog|training|"
    r"synthetic|non[-\s]?real|unit\s+test)\b(?!\.[A-Za-z])|"
    r"(?:\uc608\uc2dc|\uc0d8\ud50c\s*(?:\uac12|\ub370\uc774\ud130|\ubb38\uc11c|\uce74\ud0c8\ub85c\uadf8|\uc608\uc2dc)|\ub354\ubbf8|\uac00\uc9dc|"
    r"\ud50c\ub808\uc774\uc2a4\ud640\ub354|\ubb38\uc11c|\ubb38\uc11c\ud654|"
    r"\ud15c\ud50c\ub9bf|\ud615\uc2dd|\ud3ec\ub9f7|\uad50\uc721\uc790\ub8cc|"
    r"\ud14c\uc2a4\ud2b8\uc6a9|\uc720\ub2db\s*\ud14c\uc2a4\ud2b8)",
    re.IGNORECASE,
)
REAL_DATA_CONTEXT_PATTERN = re.compile(
    r"(?<!non-)(?<!non\s)\b(?:real|actual|production|prod|live|raw|unmasked|external|"
    r"customer\s+data|user\s+data)\b|"
    r"(?:\uc2e4\uc81c|\uc6b4\uc601|\ud504\ub85c\ub355\uc158|\uc6d0\ubcf8|"
    r"\ubbf8\ub9c8\uc2a4\ud0b9|\uc678\ubd80|\ubc18\ucd9c)",
    re.IGNORECASE,
)
NEGATED_REAL_DATA_CONTEXT_PATTERN = re.compile(
    r"\b(?:no|not|without)\s+"
    r"(?:real|actual|production|prod|live|raw|unmasked|customer\s+data|user\s+data)"
    r"(?:\s+(?:data|value|values|exposure|record|records))?\b|"
    r"\bnon[-\s](?:real|production|prod|live)\b|"
    r"(?:\uc2e4\uc81c\s*\ub370\uc774\ud130\s*\uc5c6|\uc6b4\uc601\s*\ub370\uc774\ud130\s*\uc5c6|"
    r"\uac00\uc9dc\s*\ub370\uc774\ud130|\ube44\uc2e4\s*\ub370\uc774\ud130)",
    re.IGNORECASE,
)
ACTION_BLOCK_CONTEXT_PATTERN = re.compile(
    r"\b(?:external(?:ly)?|external\s+share|share\s+externally|outside|"
    r"third[-\s]?party|contractor|bulk\s+export|export|download|"
    r"unauthorized|copy|incident|paste|exfiltrat(?:e|ion))\b|"
    r"(?:\uc678\ubd80|\ubc18\ucd9c|\uc720\ucd9c|\ub300\ub7c9|\ub0b4\ubcf4\ub0b4\uae30|"
    r"\ubb34\ub2e8|\ubd99\uc5ec\ub123|\uc0ac\uace0|\ubcf4\uc548\s*\uc0ac\uace0)",
    re.IGNORECASE,
)
ACTION_REDACT_CONTEXT_PATTERN = re.compile(
    r"\b(?:support|legal\s+review|hr\s+record|hr|analytics|"
    r"minimi[sz]e|data\s+minimi[sz]ation|policy\s+review|ops\s+note|"
    r"internal\s+review|review\s+note|redact|mask(?:ed|ing)?|"
    r"pseudonymi[sz]e)\b|"
    r"(?:\ub0b4\ubd80|\uac80\ud1a0|\uc815\ucc45|\ub9c8\uc2a4\ud0b9|"
    r"\ube44\uc2dd\ubcc4|\ucd5c\uc18c\ud654|\ubc95\ubb34|\uc778\uc0ac|"
    r"\uc0c1\ub2f4|\uc9c0\uc6d0)",
    re.IGNORECASE,
)
MICRO_BATCH_SIZE_ENV = "AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE"


@dataclass(frozen=True)
class MlWindow:
    start: int
    end: int
    text: str


@dataclass(frozen=True)
class MlCandidate:
    start: int
    end: int
    detector_types: frozenset[str]


@dataclass
class BatchWorkItem:
    item_index: int
    prompt_text: str
    rule_signals: list[SafetySignal]
    model_detections: list[Detection]


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
    SafetyDetector(
        type="confidential_business_context",
        enabled=True,
        action="block",
        placeholder="[CONFIDENTIAL_BUSINESS_CONTEXT_REDACTED]",
    ),
    SafetyDetector(
        type="sensitive_health_context",
        enabled=True,
        action="block",
        placeholder="[SENSITIVE_HEALTH_CONTEXT_REDACTED]",
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
        detector_runtime: str = "onnx",
        ml_allowed_detector_types: tuple[str, ...] | None = None,
    ) -> None:
        allowed_detector_types = (
            frozenset(ml_allowed_detector_types)
            if ml_allowed_detector_types is not None
            else None
        )
        if allowed_detector_types is not None and not allowed_detector_types:
            raise ValueError("AI safety ML detector type allowlist must not be empty.")
        self.adapters = _resolve_adapters(
            adapter=adapter,
            adapters=adapters,
            model_id=model_id,
            additional_model_ids=additional_model_ids,
            detector_runtime=detector_runtime,
            allowed_detector_types=allowed_detector_types,
        )
        supported_detector_types = frozenset().union(
            *(adapter.supported_detector_types for adapter in self.adapters)
        )
        if allowed_detector_types is not None:
            unsupported_detector_types = allowed_detector_types - supported_detector_types
            if unsupported_detector_types:
                raise ValueError(
                    "AI safety model does not support every configured ML detector type."
                )
        self._ml_allowed_detector_types = allowed_detector_types or supported_detector_types
        self.adapter = self.adapters[0]
        self.model_id = public_model_id_for_model(self.adapter.model_name)
        self.detectors = detectors
        self.fast_rule_detectors = _default_fast_rule_detectors()

    def detector_model_states(self) -> list[dict[str, str]]:
        return [
            {
                "modelId": public_model_id_for_model(adapter.model_name),
                "source": adapter.source,
                "runtime": adapter.runtime,
                "loadState": adapter.load_state,
            }
            for adapter in self.adapters
        ]

    def configured_ml_detector_types(self) -> list[str]:
        return sorted(self._ml_allowed_detector_types)

    def warmup(self) -> None:
        for adapter in self.adapters:
            adapter.warmup()

    def detect(self, request: AiSafetyDetectRequest) -> AiSafetyDetectResponse:
        started = perf_counter()
        detector_config = _detector_config_with_policy_overrides(
            self.detectors,
            request.detector_config.detector_policies,
        )
        work_items, model_invocation_count = self._detect_work_items(
            [(0, request.input.prompt_text)],
            detector_config,
        )
        latency_ms = max(0, round((perf_counter() - started) * 1000))
        result, accepted_model_detection_count = self._build_batch_result(
            work_items[0],
            mode=request.mode,
            policies=request.detector_config.detector_policies,
            return_confidence=request.detector_config.return_confidence,
        )

        return AiSafetyDetectResponse(
            contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
            model=AiSafetyDetectorModel(
                modelId=self.model_id,
                runtime=AI_SAFETY_DETECTOR_RUNTIME,
            ),
            outcome=result.outcome,
            mode=request.mode,
            redactedPrompt=result.redacted_prompt,
            logSafePrompt=result.log_safe_prompt,
            redactedPromptPreview=result.redacted_prompt_preview,
            detectorSummary=result.detector_summary,
            detections=result.detections,
            executionSummary=AiSafetyExecutionSummary(
                executionMode="hybrid" if model_invocation_count > 0 else "rules_only",
                modelInvocationCount=model_invocation_count,
                acceptedModelDetectionCount=accepted_model_detection_count,
            ),
            latencyMs=latency_ms,
        )

    def detect_batch(self, request: AiSafetyBatchDetectRequest) -> AiSafetyBatchDetectResponse:
        started = perf_counter()
        detector_config = _detector_config_with_policy_overrides(
            self.detectors,
            request.detector_config.detector_policies,
        )
        work_items, model_invocation_count = self._detect_work_items(
            [(item.item_index, item.prompt_text) for item in request.inputs],
            detector_config,
        )
        entity_scope = EntityMaskingScope()
        entity_scope.seed_placeholder_counters(request.placeholder_counters)
        results: list[AiSafetyBatchResult] = []
        accepted_model_detection_count = 0
        for work_item in work_items:
            result, accepted_count = self._build_batch_result(
                work_item,
                mode=request.mode,
                policies=request.detector_config.detector_policies,
                return_confidence=request.detector_config.return_confidence,
                entity_scope=entity_scope,
            )
            results.append(result)
            accepted_model_detection_count += accepted_count
        total_latency_ms = max(0, round((perf_counter() - started) * 1000))
        return AiSafetyBatchDetectResponse(
            contractVersion=AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION,
            model=AiSafetyDetectorModel(
                modelId=self.model_id,
                runtime=AI_SAFETY_DETECTOR_RUNTIME,
            ),
            mode=request.mode,
            results=results,
            executionSummary=AiSafetyExecutionSummary(
                executionMode="hybrid" if model_invocation_count > 0 else "rules_only",
                modelInvocationCount=model_invocation_count,
                acceptedModelDetectionCount=accepted_model_detection_count,
            ),
            latencyMs=total_latency_ms,
        )

    def _detect_work_items(
        self,
        inputs: list[tuple[int, str]],
        detector_config: dict[str, SafetyDetector],
    ) -> tuple[list[BatchWorkItem], int]:
        work_items = [
            BatchWorkItem(
                item_index=item_index,
                prompt_text=prompt_text,
                rule_signals=_fast_rule_signals(
                    prompt_text,
                    detector_config,
                    self.fast_rule_detectors,
                ),
                model_detections=[],
            )
            for item_index, prompt_text in inputs
        ]
        model_invocation_count = 0
        model_plans: list[tuple[PrivacyFilterAdapter, list[tuple[int, MlWindow]]]] = []
        total_model_candidates = 0
        total_model_windows = 0
        for adapter in self.adapters:
            supported_types = adapter.supported_detector_types.intersection(
                detector_config,
                self._ml_allowed_detector_types,
            )
            if not supported_types:
                continue
            window_refs: list[tuple[int, MlWindow]] = []
            for work_index, work_item in enumerate(work_items):
                candidates = _ml_context_candidates(work_item.prompt_text, supported_types)
                uncovered_candidates = _uncovered_ml_candidates(
                    work_item.prompt_text, work_item.rule_signals, candidates
                )
                if not uncovered_candidates:
                    continue
                total_model_candidates += len(uncovered_candidates)
                if total_model_candidates > ML_MAX_CANDIDATES_PER_REQUEST:
                    raise RuntimeError(ML_WORK_LIMIT_ERROR)
                item_windows = _ml_windows_for_prompt(
                    work_item.prompt_text,
                    uncovered_candidates,
                )
                total_model_windows += len(item_windows)
                if total_model_windows > ML_MAX_WINDOWS_PER_REQUEST:
                    raise RuntimeError(ML_WORK_LIMIT_ERROR)
                window_refs.extend((work_index, window) for window in item_windows)
            if not window_refs:
                continue
            model_plans.append((adapter, window_refs))

        for adapter, window_refs in model_plans:
            adapter_result = adapter.detect_many(
                [window.text for _, window in window_refs],
                batch_size=_micro_batch_size(),
            )
            model_invocation_count += adapter_result.model_invocation_count
            for (work_index, window), detections in zip(
                window_refs,
                adapter_result.detections,
                strict=True,
            ):
                prompt_length = len(work_items[work_index].prompt_text)
                for detection in detections:
                    if detection.detector_type not in self._ml_allowed_detector_types:
                        continue
                    offset_detection = _offset_detection(detection, window.start, prompt_length)
                    if offset_detection is not None:
                        work_items[work_index].model_detections.append(offset_detection)
        return work_items, model_invocation_count

    def _build_batch_result(
        self,
        work_item: BatchWorkItem,
        *,
        mode: str,
        policies: list[AiSafetyDetectorPolicy],
        return_confidence: bool,
        entity_scope: EntityMaskingScope | None = None,
    ) -> tuple[AiSafetyBatchResult, int]:
        detector_config = _detector_config_with_policy_overrides(self.detectors, policies)
        ml_signals = safety_signals_from_detections(
            work_item.model_detections,
            detector_config,
        )
        rule_signals = _rule_signals_not_covered_by_ml(work_item.rule_signals, ml_signals)
        signals = effective_signals(
            [*rule_signals, *ml_signals],
            prompt_text=work_item.prompt_text,
        )
        signals = _apply_non_real_data_allow_guard(work_item.prompt_text, signals)
        signals = _apply_contextual_action_policy(work_item.prompt_text, signals)
        signals = _apply_request_policy_actions(signals, policies)
        enforcement_signals = _enforcement_signals(signals)
        masking_scope = entity_scope or EntityMaskingScope()
        redacted_prompt = redact_prompt(
            work_item.prompt_text,
            enforcement_signals,
            entity_scope=masking_scope,
        )
        log_safe_prompt = redact_prompt(
            work_item.prompt_text,
            _log_safe_signals(signals),
            entity_scope=masking_scope,
        )
        type_counts = Counter(signal.detector_type for signal in signals)
        model_sources = {adapter.source for adapter in self.adapters}
        accepted_count = sum(1 for signal in signals if signal.source in model_sources)
        return (
            AiSafetyBatchResult(
                itemIndex=work_item.item_index,
                outcome=_outcome_from_signals(enforcement_signals),
                redactedPrompt=redacted_prompt,
                logSafePrompt=log_safe_prompt,
                redactedPromptPreview=preview_redacted_prompt(log_safe_prompt),
                detectorSummary=AiSafetyDetectorSummary(
                    detectedCount=len(signals),
                    detectorCategories=sorted(type_counts),
                ),
                detections=[
                    AiSafetyDetection(
                        detectorType=signal.detector_type,
                        source=signal.source,
                        confidence=signal.confidence if return_confidence else None,
                        action=signal.action,
                        mode=mode,
                    )
                    for signal in signals
                ],
            ),
            accepted_count,
        )


def _detector_config_with_policy_overrides(
    detectors: tuple[SafetyDetector, ...],
    overrides: list[AiSafetyDetectorPolicy],
) -> dict[str, SafetyDetector]:
    detector_config = {detector.type: detector for detector in detectors}
    for override in overrides:
        detector = detector_config.get(override.detector_type)
        if detector is None:
            continue
        detector_config[override.detector_type] = detector.model_copy(
            update={"action": override.action}
        )
    return detector_config


def _apply_request_policy_actions(
    signals: list[SafetySignal],
    policies: list[AiSafetyDetectorPolicy],
) -> list[SafetySignal]:
    actions = {policy.detector_type: policy.action for policy in policies}
    return [
        replace(signal, action=action)
        if (action := actions.get(signal.detector_type)) is not None
        else signal
        for signal in signals
    ]


def _outcome_from_signals(signals: list[SafetySignal]) -> str:
    if any(signal.action == "block" for signal in signals):
        return "blocked"
    if signals:
        return "redacted"
    return "passed"


def _enforcement_signals(signals: list[SafetySignal]) -> list[SafetySignal]:
    return [signal for signal in signals if signal.action != "allow"]


def _log_safe_signals(signals: list[SafetySignal]) -> list[SafetySignal]:
    return [replace(signal, action="redact") for signal in signals]


def _apply_contextual_action_policy(
    prompt_text: str,
    signals: list[SafetySignal],
) -> list[SafetySignal]:
    block_context = ACTION_BLOCK_CONTEXT_PATTERN.search(prompt_text) is not None
    redact_context = ACTION_REDACT_CONTEXT_PATTERN.search(prompt_text) is not None
    if not block_context and not redact_context:
        return signals

    action = "block" if block_context else "redact"
    return [
        signal
        if signal.action == "allow"
        else replace(signal, action=action)
        for signal in signals
    ]


def _apply_non_real_data_allow_guard(
    prompt_text: str,
    signals: list[SafetySignal],
) -> list[SafetySignal]:
    return [
        replace(signal, action="allow")
        if _should_allow_non_real_data_signal(prompt_text, signal)
        else signal
        for signal in signals
    ]


def _should_allow_non_real_data_signal(prompt_text: str, signal: SafetySignal) -> bool:
    if signal.detector_type not in NON_REAL_ALLOW_DETECTOR_TYPES:
        return False
    context = _signal_surrounding_context(prompt_text, signal)
    if _has_blocking_real_data_context(context):
        return False
    return NON_REAL_DATA_CONTEXT_PATTERN.search(context) is not None


def _has_blocking_real_data_context(context: str) -> bool:
    sanitized = NEGATED_REAL_DATA_CONTEXT_PATTERN.sub(" ", context)
    return REAL_DATA_CONTEXT_PATTERN.search(sanitized) is not None


def _signal_surrounding_context(prompt_text: str, signal: SafetySignal) -> str:
    excluded_start = _token_context_start(prompt_text, signal.start)
    excluded_end = _token_context_end(prompt_text, signal.end)
    before_start = max(0, excluded_start - NON_REAL_CONTEXT_CHARS)
    after_end = min(len(prompt_text), excluded_end + NON_REAL_CONTEXT_CHARS)
    before = _same_sentence_before_context(prompt_text[before_start:excluded_start])
    after = _same_sentence_after_context(prompt_text[excluded_end:after_end])
    return f"{before} {after}"


def _token_context_start(prompt_text: str, start: int) -> int:
    while start > 0 and _is_token_context_char(prompt_text[start - 1]):
        start -= 1
    return start


def _token_context_end(prompt_text: str, end: int) -> int:
    while end < len(prompt_text) and _is_token_context_char(prompt_text[end]):
        end += 1
    return end


def _is_token_context_char(char: str) -> bool:
    return char.isalnum() or char in "_-.:/?=&%#+"


def _same_sentence_before_context(value: str) -> str:
    boundary = max(value.rfind("."), value.rfind("!"), value.rfind("?"), value.rfind("\n"))
    if boundary == -1:
        return value
    return value[boundary + 1 :]


def _same_sentence_after_context(value: str) -> str:
    boundaries = [index for marker in (".", "!", "?", "\n") if (index := value.find(marker)) != -1]
    if not boundaries:
        return value
    return value[: min(boundaries)]


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


def _uncovered_ml_candidates(
    prompt_text: str,
    rule_signals: list[SafetySignal],
    candidates: list[MlCandidate],
) -> list[MlCandidate]:
    return [
        candidate
        for candidate in candidates
        if not _ml_candidate_covered_by_rule(prompt_text, candidate, rule_signals)
    ]


def _ml_windows_for_prompt(
    prompt_text: str,
    candidates: list[MlCandidate],
) -> tuple[MlWindow, ...]:
    if len(prompt_text) <= ML_WINDOW_MAX_CHARS:
        return (MlWindow(0, len(prompt_text), prompt_text),)

    windows = []
    for start, end in _ml_candidate_spans(candidates):
        if not 0 <= start < end <= len(prompt_text):
            continue
        candidate_chars = end - start
        if candidate_chars > ML_WINDOW_MAX_CHARS:
            raise RuntimeError(ML_WORK_LIMIT_ERROR)
        context_chars = ML_WINDOW_MAX_CHARS - candidate_chars
        left_context = min(ML_WINDOW_CONTEXT_CHARS, context_chars // 2)
        right_context = context_chars - left_context
        window_start = max(0, start - left_context)
        window_end = min(len(prompt_text), end + right_context)
        missing_chars = ML_WINDOW_MAX_CHARS - (window_end - window_start)
        if missing_chars > 0:
            window_start = max(0, window_start - missing_chars)
            missing_chars = ML_WINDOW_MAX_CHARS - (window_end - window_start)
            window_end = min(len(prompt_text), window_end + missing_chars)
        windows.append((window_start, window_end))
    if not windows:
        return ()

    merged: list[tuple[int, int]] = []
    for start, end in sorted(set(windows)):
        if (
            not merged
            or start > merged[-1][1]
            or max(merged[-1][1], end) - merged[-1][0] > ML_WINDOW_MAX_CHARS
        ):
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
    candidates: list[MlCandidate],
) -> list[tuple[int, int]]:
    return [(candidate.start, candidate.end) for candidate in candidates]


def _ml_context_candidates(
    prompt_text: str,
    supported_types: frozenset[str] | set[str],
) -> list[MlCandidate]:
    candidates: list[MlCandidate] = []
    for detector_types, pattern in ML_TYPED_CANDIDATE_PATTERNS:
        effective_types = frozenset(detector_types.intersection(supported_types))
        if not effective_types:
            continue
        candidates.extend(
            MlCandidate(
                start=match.start(),
                end=match.end(),
                detector_types=effective_types,
            )
            for match in pattern.finditer(prompt_text)
        )
    return candidates


def _ml_candidate_covered_by_rule(
    prompt_text: str,
    candidate: MlCandidate,
    rule_signals: list[SafetySignal],
) -> bool:
    return any(
        signal.detector_type in candidate.detector_types
        and _ml_candidate_covered_by_rule_signal(
            prompt_text,
            candidate.start,
            candidate.end,
            signal,
        )
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
    if end > signal.start:
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
    allowed_detector_types: frozenset[str] | None,
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
            allowed_detector_types=allowed_detector_types,
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


def _micro_batch_size() -> int:
    raw_value = os.environ.get(MICRO_BATCH_SIZE_ENV, "4").strip()
    try:
        parsed = int(raw_value)
    except ValueError:
        return 4
    return max(1, min(parsed, 64))
