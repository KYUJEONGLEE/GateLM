from __future__ import annotations

from collections import Counter
from time import perf_counter

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.privacy_filter_adapter import public_model_id_for_model, source_for_model
from app.domain.safety.policy import effective_signals, preview_redacted_prompt, redact_prompt
from app.domain.safety.detections import safety_signals_from_detections
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
    ) -> None:
        self.adapters = _resolve_adapters(
            adapter=adapter,
            adapters=adapters,
            model_id=model_id,
            additional_model_ids=additional_model_ids,
        )
        self.adapter = self.adapters[0]
        self.model_id = public_model_id_for_model(self.adapter.model_name)
        self.detectors = detectors

    def detect(self, request: AiSafetyDetectRequest) -> AiSafetyDetectResponse:
        started = perf_counter()
        prompt_text = request.input.prompt_text
        detector_config = {detector.type: detector for detector in self.detectors}
        detections = [
            detection
            for adapter in self.adapters
            for detection in adapter.detect(prompt_text)
        ]
        signals = effective_signals(
            safety_signals_from_detections(
                detections,
                detector_config,
            ),
            prompt_text=prompt_text,
        )
        redacted_prompt = redact_prompt(prompt_text, signals)
        type_counts = Counter(signal.detector_type for signal in signals)
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


def _resolve_adapters(
    *,
    adapter: PrivacyFilterAdapter | None,
    adapters: tuple[PrivacyFilterAdapter, ...] | None,
    model_id: str,
    additional_model_ids: tuple[str, ...],
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
