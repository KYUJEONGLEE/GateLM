from __future__ import annotations

import re
from dataclasses import dataclass
from re import Pattern

from app.domain.safety.decision import SafetyDecision
from app.domain.safety.policy import build_safety_decision, enabled_detector_map
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput, SafetyDetector


@dataclass(frozen=True)
class RegexDetector:
    detector_type: str
    pattern: Pattern[str]
    priority: int

    def detect(self, prompt_text: str, config: SafetyDetector) -> list[SafetySignal]:
        return [
            SafetySignal(
                detector_type=self.detector_type,
                start=match.start(),
                end=match.end(),
                action=config.action,
                placeholder=config.placeholder,
                priority=self.priority,
            )
            for match in self.pattern.finditer(prompt_text)
        ]


class HeuristicSafetyEvaluator:
    def __init__(self, detectors: list[RegexDetector] | None = None) -> None:
        self.detectors = detectors or default_detectors()

    def evaluate(self, ctx: RemoteSafetyContext, input: RemoteSafetyInput) -> SafetyDecision:
        detector_config = enabled_detector_map(input.detectors)
        signals: list[SafetySignal] = []
        for detector in self.detectors:
            config = detector_config.get(detector.detector_type)
            if config is None:
                continue
            signals.extend(detector.detect(input.prompt_text, config))
        return build_safety_decision(
            prompt_text=input.prompt_text,
            signals=signals,
            security_policy_hash=ctx.security_policy_hash,
        )


def default_detectors() -> list[RegexDetector]:
    return [
        RegexDetector(
            "private_key",
            re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL),
            5,
        ),
        RegexDetector(
            "api_key",
            re.compile(r"\b(?:api[_-]?key|secret|token|access[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?[A-Za-z0-9_.-]{20,}", re.IGNORECASE),
            10,
        ),
        RegexDetector(
            "authorization_header",
            re.compile(r"\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/\-=]{8,}", re.IGNORECASE),
            11,
        ),
        RegexDetector(
            "jwt",
            re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"),
            12,
        ),
        RegexDetector(
            "resident_registration_number",
            re.compile(r"\b\d{6}[-\s]?[1-8]\d{6}\b"),
            20,
        ),
        RegexDetector(
            "phone_number",
            re.compile(r"\b(?:\+82[-.\s]?)?(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b"),
            40,
        ),
        RegexDetector(
            "email",
            re.compile(r"\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b", re.IGNORECASE),
            50,
        ),
    ]
