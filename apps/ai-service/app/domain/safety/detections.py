from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import SafetyDetector


DEFAULT_ML_MIN_CONFIDENCE = 0.70
DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_TYPE: Mapping[str, float] = {
    "account_number": 0.50,
    "api_key": 0.55,
    "authorization_header": 0.50,
    "bank_account": 0.97,
    "cloud_access_key": 0.50,
    "database_url": 0.50,
    "email": 0.90,
    "github_token": 0.50,
    "jwt": 0.50,
    "password_assignment": 0.97,
    "phone_number": 0.55,
    "private_key": 0.50,
    "private_date": 0.65,
    "private_url": 0.65,
    "provider_api_key": 0.50,
    "resident_registration_number": 0.50,
    "secret": 0.65,
    "session_cookie": 0.50,
    "slack_token": 0.50,
    "webhook_url": 0.50,
    "organization_name": 0.85,
    "person_name": 0.97,
    "postal_address": 0.90,
}
DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_ACTION: Mapping[tuple[str, str], float] = {
    ("account_number", "block"): 0.50,
    ("api_key", "block"): 0.55,
    ("authorization_header", "block"): 0.50,
    ("bank_account", "block"): 0.97,
    ("cloud_access_key", "block"): 0.50,
    ("database_url", "block"): 0.50,
    ("github_token", "block"): 0.50,
    ("jwt", "block"): 0.50,
    ("password_assignment", "block"): 0.97,
    ("private_key", "block"): 0.50,
    ("provider_api_key", "block"): 0.50,
    ("resident_registration_number", "block"): 0.50,
    ("secret", "block"): 0.65,
    ("session_cookie", "block"): 0.50,
    ("slack_token", "block"): 0.50,
    ("webhook_url", "block"): 0.50,
    ("organization_name", "redact"): 0.85,
    ("person_name", "redact"): 0.97,
    ("postal_address", "redact"): 0.90,
}

DEFAULT_DETECTION_PRIORITIES: Mapping[str, int] = {
    "private_key": 5,
    "session_cookie": 7,
    "provider_api_key": 8,
    "cloud_access_key": 9,
    "github_token": 9,
    "slack_token": 9,
    "database_url": 9,
    "webhook_url": 10,
    "api_key": 10,
    "secret": 10,
    "authorization_header": 11,
    "jwt": 12,
    "credit_card": 13,
    "account_number": 13,
    "bank_account": 14,
    "password_assignment": 15,
    "passport_number": 16,
    "driver_license": 17,
    "resident_registration_number": 20,
    "date_of_birth": 30,
    "private_date": 30,
    "private_url": 30,
    "person_name": 31,
    "customer_id": 32,
    "employee_id": 33,
    "account_id": 34,
    "postal_address": 35,
    "organization_name": 36,
    "phone_number": 40,
    "ip_address": 45,
    "email": 50,
}


@dataclass(frozen=True)
class Detection:
    detector_type: str
    source: str
    start: int
    end: int
    confidence: float

    @property
    def length(self) -> int:
        return self.end - self.start


def safety_signals_from_detections(
    detections: list[Detection],
    detector_config: Mapping[str, SafetyDetector],
    *,
    min_confidence_by_type: Mapping[str, float] | None = None,
    min_confidence_by_type_action: Mapping[tuple[str, str], float] | None = None,
    priority_by_type: Mapping[str, int] | None = None,
    default_min_confidence: float = DEFAULT_ML_MIN_CONFIDENCE,
) -> list[SafetySignal]:
    priorities = priority_by_type or DEFAULT_DETECTION_PRIORITIES
    signals: list[SafetySignal] = []

    for detection in detections:
        detector_type = detection.detector_type.strip()
        if detector_type not in ALLOWED_DETECTOR_TYPES:
            continue
        config = detector_config.get(detector_type)
        if config is None or not config.enabled:
            continue
        if detection.start < 0 or detection.end <= detection.start:
            continue

        confidence = normalized_confidence(detection.confidence)
        threshold = confidence_threshold_for_detection(
            detector_type,
            config.action,
            min_confidence_by_type=min_confidence_by_type,
            min_confidence_by_type_action=min_confidence_by_type_action,
            default_min_confidence=default_min_confidence,
        )
        if confidence < threshold:
            continue

        signals.append(
            SafetySignal(
                detector_type=detector_type,
                start=detection.start,
                end=detection.end,
                action=config.action,
                placeholder=config.placeholder,
                priority=priorities.get(detector_type, 100),
                source=detection.source.strip() or "unknown_detector",
                confidence=confidence,
            )
        )

    return signals


def confidence_threshold_for_detection(
    detector_type: str,
    action: str | None = None,
    *,
    min_confidence_by_type: Mapping[str, float] | None = None,
    min_confidence_by_type_action: Mapping[tuple[str, str], float] | None = None,
    default_min_confidence: float = DEFAULT_ML_MIN_CONFIDENCE,
) -> float:
    by_type = (
        DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_TYPE
        if min_confidence_by_type is None
        else min_confidence_by_type
    )
    by_type_action = (
        DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_ACTION
        if min_confidence_by_type_action is None
        else min_confidence_by_type_action
    )
    normalized_type = detector_type.strip()
    normalized_action = action.strip() if isinstance(action, str) else ""
    threshold = by_type_action.get(
        (normalized_type, normalized_action),
        by_type.get(normalized_type, default_min_confidence),
    )
    return normalized_confidence(threshold)


def normalized_confidence(value: float) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(confidence):
        return 0.0
    if confidence < 0:
        return 0.0
    if confidence > 1:
        return 1.0
    return confidence
