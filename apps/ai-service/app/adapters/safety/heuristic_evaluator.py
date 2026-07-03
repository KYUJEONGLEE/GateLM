from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from re import Match, Pattern
from typing import Protocol

from app.domain.safety.detections import Detection, safety_signals_from_detections
from app.domain.safety.decision import SafetyDecision
from app.domain.safety.policy import build_safety_decision, enabled_detector_map
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput, SafetyDetector


IP_ADDRESS_CANDIDATE_PATTERN = re.compile(
    r"(?<![A-Za-z0-9_.:-])"
    r"(?:"
    r"(?:\d{1,3}\.){3}\d{1,3}"
    r"|"
    r"(?:[A-Fa-f0-9]{0,4}:){2,7}[A-Fa-f0-9]{0,4}"
    r")"
    r"(?![A-Za-z0-9_.:-])",
    re.ASCII,
)
CREDIT_CARD_CANDIDATE_PATTERN = re.compile(r"(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)", re.ASCII)


class PromptDetector(Protocol):
    detector_type: str
    priority: int

    def detect(self, prompt_text: str, config: SafetyDetector) -> list[SafetySignal]:
        ...


class DetectionAdapter(Protocol):
    def detect(self, text: str) -> list[Detection]:
        ...


@dataclass(frozen=True)
class RegexDetector:
    detector_type: str
    pattern: Pattern[str]
    priority: int

    def detect(self, prompt_text: str, config: SafetyDetector) -> list[SafetySignal]:
        signals: list[SafetySignal] = []
        for match in self.pattern.finditer(prompt_text):
            start, end = _match_value_span(match)
            signals.append(
                SafetySignal(
                    detector_type=self.detector_type,
                    start=start,
                    end=end,
                    action=config.action,
                    placeholder=config.placeholder,
                    priority=self.priority,
                )
            )
        return signals


@dataclass(frozen=True)
class PublicIPAddressDetector:
    detector_type: str
    pattern: Pattern[str]
    priority: int

    def detect(self, prompt_text: str, config: SafetyDetector) -> list[SafetySignal]:
        signals: list[SafetySignal] = []
        for match in self.pattern.finditer(prompt_text):
            try:
                address = ipaddress.ip_address(match.group(0))
            except ValueError:
                continue
            if not address.is_global:
                continue
            signals.append(
                SafetySignal(
                    detector_type=self.detector_type,
                    start=match.start(),
                    end=match.end(),
                    action=config.action,
                    placeholder=config.placeholder,
                    priority=self.priority,
                )
            )
        return signals


@dataclass(frozen=True)
class CreditCardDetector:
    detector_type: str
    pattern: Pattern[str]
    priority: int

    def detect(self, prompt_text: str, config: SafetyDetector) -> list[SafetySignal]:
        signals: list[SafetySignal] = []
        for match in self.pattern.finditer(prompt_text):
            digits = re.sub(r"\D", "", match.group(0))
            if not 13 <= len(digits) <= 19:
                continue
            if not passes_luhn_check(digits):
                continue
            signals.append(
                SafetySignal(
                    detector_type=self.detector_type,
                    start=match.start(),
                    end=match.end(),
                    action=config.action,
                    placeholder=config.placeholder,
                    priority=self.priority,
                )
            )
        return signals


class HeuristicSafetyEvaluator:
    def __init__(
        self,
        detectors: list[PromptDetector] | None = None,
        detection_adapters: list[DetectionAdapter] | None = None,
    ) -> None:
        self.detectors = detectors or default_detectors()
        self.detection_adapters = detection_adapters or []

    def evaluate(self, ctx: RemoteSafetyContext, input: RemoteSafetyInput) -> SafetyDecision:
        detector_config = enabled_detector_map(input.detectors)
        signals: list[SafetySignal] = []
        for detector in self.detectors:
            config = detector_config.get(detector.detector_type)
            if config is None:
                continue
            signals.extend(detector.detect(input.prompt_text, config))
        for adapter in self.detection_adapters:
            signals.extend(
                safety_signals_from_detections(
                    adapter.detect(input.prompt_text),
                    detector_config,
                )
            )
        return build_safety_decision(
            prompt_text=input.prompt_text,
            signals=signals,
            security_policy_hash=ctx.security_policy_hash,
        )


def default_detectors() -> list[PromptDetector]:
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
        CreditCardDetector(
            "credit_card",
            CREDIT_CARD_CANDIDATE_PATTERN,
            13,
        ),
        RegexDetector(
            "bank_account",
            re.compile(
                r"\b(?:bank[_ -]?account|bank[_ -]?account[_ -]?number|account[_ -]?number|계좌번호|은행계좌)\b"
                r"\s*[:=]?\s*['\"]?"
                r"(?:\d{2,6}[- ]?){2,5}\d{2,6}",
                re.IGNORECASE,
            ),
            14,
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
            "passport_number",
            re.compile(
                r"\b(?:passport[_ -]?(?:no|number)|passport[_ -]?id)\s*[:=]\s*['\"]?[A-Z][A-Z0-9]{7,8}\b"
                r"|"
                r"(?:여권번호)\s*[:=]?\s*['\"]?[A-Z][A-Z0-9]{7,8}\b",
                re.IGNORECASE,
            ),
            16,
        ),
        RegexDetector(
            "driver_license",
            re.compile(
                r"\b(?:driver[_ -]?license(?:[_ -]?(?:no|number))?)\s*[:=]\s*['\"]?"
                r"(?:\d{2}[- ]?\d{2}[- ]?\d{6}[- ]?\d{2}|\d{12})\b"
                r"|"
                r"(?:운전면허번호)\s*[:=]?\s*['\"]?(?:\d{2}[- ]?\d{2}[- ]?\d{6}[- ]?\d{2}|\d{12})\b",
                re.IGNORECASE,
            ),
            17,
        ),
        RegexDetector(
            "date_of_birth",
            re.compile(
                r"\b(?:date[_ -]?of[_ -]?birth|birth[_ -]?date|birthday|dob|생년월일|출생일)\b"
                r"\s*[:=]?\s*['\"]?"
                r"(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)",
                re.IGNORECASE,
            ),
            30,
        ),
        RegexDetector(
            "person_name",
            re.compile(
                r"\b(?:name|customer[_ -]?name|contact[_ -]?name|manager|이름|성명|고객명|담당자)\b"
                r"\s*[:=]\s*['\"]?"
                r"(?P<value>[가-힣]{2,5}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})",
                re.IGNORECASE,
            ),
            31,
        ),
        RegexDetector(
            "customer_id",
            re.compile(
                r"\b(?:customer[_ -]?id|customer[_ -]?no|고객id|고객번호|회원번호)\b"
                r"\s*[:=]?\s*['\"]?"
                r"(?:cus_[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{6,})",
                re.IGNORECASE,
            ),
            32,
        ),
        RegexDetector(
            "employee_id",
            re.compile(
                r"\b(?:employee[_ -]?id|employee[_ -]?no|사번|직원번호)\b"
                r"\s*[:=]?\s*['\"]?"
                r"(?:E\d{5,}|[A-Z]{1,3}\d{5,}|\d{6,})",
                re.IGNORECASE,
            ),
            33,
        ),
        RegexDetector(
            "account_id",
            re.compile(
                r"\b(?:account[_ -]?id|account[_ -]?no|acct[_ -]?id|계정id|계정번호)\b"
                r"\s*[:=]?\s*['\"]?"
                r"(?:acct_[A-Za-z0-9_-]{6,}|[A-Za-z0-9_-]{8,})",
                re.IGNORECASE,
            ),
            34,
        ),
        RegexDetector(
            "postal_address",
            re.compile(
                r"(?:주소|배송지|도로명주소|지번주소|address|shipping[_ -]?address|postal[_ -]?address)"
                r"\s*[:=]\s*['\"]?"
                r"(?:[가-힣A-Za-z0-9\s,.-]{6,80}(?:로|길|동|읍|면|리|번길|street|st\.|road|rd\.|avenue|ave\.|blvd|drive|dr\.)\s*\d{0,5}(?:-\d{1,5})?)"
                r"|"
                r"(?:우편번호|postal[_ -]?code|zip)\s*[:=]\s*\d{5}",
                re.IGNORECASE,
            ),
            35,
        ),
        PublicIPAddressDetector(
            "ip_address",
            IP_ADDRESS_CANDIDATE_PATTERN,
            45,
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


def passes_luhn_check(digits: str) -> bool:
    total = 0
    double_next = False
    for char in reversed(digits):
        value = int(char)
        if double_next:
            value *= 2
            if value > 9:
                value -= 9
        total += value
        double_next = not double_next
    return total % 10 == 0


def _match_value_span(match: Match[str]) -> tuple[int, int]:
    if "value" in match.re.groupindex:
        return match.start("value"), match.end("value")
    return match.start(), match.end()
