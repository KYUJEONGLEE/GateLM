from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import SafetyDetector


DEFAULT_ML_MIN_CONFIDENCE = 0.70

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
    "bank_account": 14,
    "account_number": 14,
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
    priority_by_type: Mapping[str, int] | None = None,
    default_min_confidence: float = DEFAULT_ML_MIN_CONFIDENCE,
) -> list[SafetySignal]:
    thresholds = min_confidence_by_type or {}
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
        threshold = thresholds.get(detector_type, default_min_confidence)
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
