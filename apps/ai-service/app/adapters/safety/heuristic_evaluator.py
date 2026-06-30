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
            "session_cookie",
            re.compile(
                r"\b(?:cookie|set-cookie)\s*:\s*"
                r"(?=[^\r\n]*(?:session(?:id)?|sid|auth(?:_token)?|access_token|refresh_token)=)"
                r"(?:[^\r\n;]*;\s*)*"
                r"(?:session(?:id)?|sid|auth(?:_token)?|access_token|refresh_token)=[A-Za-z0-9._~+/=-]{16,}",
                re.IGNORECASE,
            ),
            7,
        ),
        RegexDetector(
            "provider_api_key",
            re.compile(
                r"(?<![A-Za-z0-9_-])"
                r"(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,})"
                r"(?![A-Za-z0-9_-])"
            ),
            8,
        ),
        RegexDetector(
            "cloud_access_key",
            re.compile(
                r"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])"
                r"|"
                r"\b(?:cloud[_-]?access[_-]?key|aws[_-]?access[_-]?key[_-]?id|azure[_-]?client[_-]?secret|gcp[_-]?private[_-]?key)"
                r"\s*[:=]\s*['\"]?"
                r"(?=[A-Za-z0-9_.-]{32,}(?:['\"\s,;}]|$))"
                r"(?=[A-Za-z0-9_.-]*[A-Za-z])"
                r"(?=[A-Za-z0-9_.-]*\d)"
                r"[A-Za-z0-9_.-]+",
                re.IGNORECASE,
            ),
            9,
        ),
        RegexDetector(
            "github_token",
            re.compile(r"(?<![A-Za-z0-9_])(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})(?![A-Za-z0-9_])"),
            9,
        ),
        RegexDetector(
            "slack_token",
            re.compile(r"(?<![A-Za-z0-9-])xox[abp]-[A-Za-z0-9-]{20,}(?![A-Za-z0-9-])"),
            9,
        ),
        RegexDetector(
            "database_url",
            re.compile(r"\b(?:postgres(?:ql)?|mysql|mariadb)://[^:\s/@]+:[^@\s/]{6,}@[^\s'\")<>]+", re.IGNORECASE),
            9,
        ),
        RegexDetector(
            "webhook_url",
            re.compile(
                r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}"
                r"|"
                r"https://discord(?:app)?\.com/api/webhooks/\d{8,}/[A-Za-z0-9_-]{20,}"
                r"|"
                r"https://api\.github\.com/[^\s'\")<>]*(?:token|secret)=[A-Za-z0-9_-]{20,}",
                re.IGNORECASE,
            ),
            10,
        ),
        RegexDetector(
            "api_key",
            re.compile(
                r"\b(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|secret[_-]?key|client[_-]?secret|provider[_-]?key)"
                r"\s*[:=]\s*['\"]?"
                r"(?=[A-Za-z0-9_.-]{32,}(?:['\"\s,;}]|$))"
                r"(?=[A-Za-z0-9_.-]*[A-Za-z])"
                r"(?=[A-Za-z0-9_.-]*\d)"
                r"[A-Za-z0-9_.-]+",
                re.IGNORECASE,
            ),
            10,
        ),
        RegexDetector(
            "authorization_header",
            re.compile(r"\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/\-=]{8,}", re.IGNORECASE),
            11,
        ),
        RegexDetector(
            "jwt",
            re.compile(r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])"),
            12,
        ),
        RegexDetector(
            "password_assignment",
            re.compile(
                r"\b(?:password|passwd)\s*[:=]\s*['\"]?"
                r"(?=[^\s'\";,}]{12,}(?:['\"\s,;}]|$))"
                r"(?=[^\s'\";,}]*[A-Za-z])"
                r"(?=[^\s'\";,}]*\d)"
                r"[^\s'\";,}]+",
                re.IGNORECASE,
            ),
            15,
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
