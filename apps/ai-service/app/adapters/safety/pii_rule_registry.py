from __future__ import annotations

import ipaddress
import re
import unicodedata
from dataclasses import dataclass
from re import Match, Pattern
from typing import Protocol

from app.domain.safety.detections import Detection, safety_signals_from_detections
from app.domain.safety.decision import SafetyDecision
from app.domain.safety.policy import (
    BUSINESS_ROLE_LABELS,
    build_safety_decision,
    enabled_detector_map,
)
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

PERSON_NAME_LABEL_COMPOUND_PREFIXES = ("\uc774\ub984", "\uace0\uac1d")
PERSON_NAME_NON_ENTITY_VALUES = frozenset({"\uc774\ub984", "\uace0\uac1d", "\ubb38\uc758"})
COMPATIBILITY_JAMO_PATTERN = re.compile(
    r"[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\ud7b0-\ud7ff]"
)
KOREAN_PERSON_VALUE_PATTERN = re.compile(r"[\uac00-\ud7a3]{2,5}")
LATIN_PERSON_VALUE_PATTERN = re.compile(
    r"[A-Za-z][A-Za-z'\u2019-]{1,24}"
    r"(?:\s+[A-Za-z][A-Za-z'\u2019-]{1,24}){0,2}"
)

GATELM_ADDRESS_FRAGMENT_TYPES = frozenset(
    {"organization_name", "postal_address"}
)
GATELM_ADDRESS_ORGANIZATION_SUFFIX_EXCLUSIONS = (
    "회사",
    "법인",
    "공사",
    "공단",
    "재단",
    "협회",
    "연구원",
    "대학교",
    "병원",
    "은행",
    "그룹",
    "주식회사",
    "유한회사",
    "기술원",
    "사업단",
)
_GATELM_ADDRESS_ADMIN_TOKEN = (
    r"[가-힣]{1,10}(?:특별자치시|특별자치도|특별시|광역시|시|군|구|도)"
)
GATELM_ADDRESS_ADMIN_SUFFIX_PATTERN = re.compile(
    r"(?<![가-힣])(?P<prefix>"
    + _GATELM_ADDRESS_ADMIN_TOKEN
    + r"(?:\s+"
    + _GATELM_ADDRESS_ADMIN_TOKEN
    + r"){0,2})\s*$"
)


def is_plausible_model_person_name(text: str, start: int, end: int) -> bool:
    """Reject structurally impossible or label-compound model name spans."""

    value = text[start:end]
    normalized = unicodedata.normalize("NFC", value.strip())
    if normalized == "" or COMPATIBILITY_JAMO_PATTERN.search(normalized):
        return False
    compact = "".join(normalized.split())
    if compact in PERSON_NAME_NON_ENTITY_VALUES:
        return False
    if any(
        compact.startswith(prefix) and len(compact) > len(prefix)
        for prefix in PERSON_NAME_LABEL_COMPOUND_PREFIXES
    ):
        return False
    prefix_context = unicodedata.normalize("NFC", text[:start])
    if any(prefix_context.endswith(prefix) for prefix in PERSON_NAME_LABEL_COMPOUND_PREFIXES):
        return False
    return (
        KOREAN_PERSON_VALUE_PATTERN.fullmatch(compact) is not None
        or LATIN_PERSON_VALUE_PATTERN.fullmatch(normalized) is not None
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
TITLE_CASE_PERSON_CANDIDATE_PATTERN = re.compile(
    r"(?<![A-Za-z])"
    r"[A-Z][a-z]{1,24}(?:\s+[A-Z][a-z]{1,24}){1,2}"
    r"(?![A-Za-z])"
)
KOREAN_PERSON_CANDIDATE_PATTERN = re.compile(
    r"(?<![\uac00-\ud7a3])"
    r"(?!\uc774\ub984|\uace0\uac1d)"
    r"[\uac00-\ud7a3]{2,4}"
    r"(?:\ub2d8|\uc528|\uc5d0\uac8c|\uaed8|\uc740|\ub294|\uc774|\uac00|\uc744|\ub97c|\uc758)"
    r"(?=$|[\s\"')\]}>,;:.!?])"
)
CONTEXT_LABEL_PREFIX_BOUNDARY = r"(?<![A-Za-z0-9_\uac00-\ud7a3])"
CONTEXT_LABEL_SUFFIX_BOUNDARY = (
    r"(?:"
    r"(?=$|[\s\"')\]}>,;:.!?])"
    r"|(?=(?:(?:\ub2d8|\uc528)(?:\uaed8\uc11c\ub294|\uc5d0\uac8c|\uaed8|\uc740|\ub294|\uc774|\uac00|\uc744|\ub97c|\uc758|\ub3c4|\ub9cc)?|\uaed8\uc11c\ub294|\uc5d0\uac8c|\uaed8|\uc740|\ub294|\uc774|\uac00|\uc744|\ub97c|\uc758|\ub3c4|\ub9cc)(?:$|[\s\"')\]}>,;:.!?]))"
    r")"
)
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


ENGLISH_PERSON_CONTEXT_LABEL_PATTERN = (
    r"name|customer[_ -]?name|contact[_ -]?name|applicant|candidate|"
    r"customer|client|patient|manager|interviewer|doctor|agent|support[_ -]?agent"
)
ENGLISH_PERSON_CONTEXT_VALUE_PATTERN = r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}"
KOREAN_EXPLICIT_PERSON_LABEL_PATTERN = (
    r"\uc774\ub984|\uc131\uba85|\uace0\uac1d\uba85|\ub2f4\ub2f9\uc790\uba85|\ud658\uc790\uba85|"
    r"\uc9c0\uc6d0\uc790\uba85|\uba74\uc811\uad00\uba85|\uc694\uccad\uc790\uba85|\uc2b9\uc778\uc790\uba85|"
    r"\uac80\ud1a0\uc790\uba85|\uad00\ub9ac\uc790\uba85|\uc0c1\ub2f4\uc6d0\uba85|\uc0c1\ub2f4\uc0ac\uba85|\ud300\uc7a5\uba85"
)
KOREAN_ROLE_PERSON_LABEL_PATTERN = (
    r"\uace0\uac1d|\ub2f4\ub2f9\uc790|\ud658\uc790|\uc9c0\uc6d0\uc790|\uba74\uc811\uad00|"
    r"\uc694\uccad\uc790|\uc2b9\uc778\uc790|\uac80\ud1a0\uc790|\uad00\ub9ac\uc790|"
    r"\uc0c1\ub2f4\uc6d0|\uc0c1\ub2f4\uc0ac|\ud300\uc7a5"
)
KOREAN_STRONG_PERSON_SUFFIX_PATTERN = r"\ub2d8|\uc528|\uc5d0\uac8c|\uaed8|\uc758"
KOREAN_PERSON_ROLE_SUFFIX_PARTICLE_PATTERN = (
    r"\uaed8\uc11c\ub294|\uc5d0\uac8c|\uaed8|\uc740|\ub294|\uc774|\uac00|"
    r"\uc744|\ub97c|\uc758|\ub3c4|\ub9cc|\uc73c\ub85c|\ub85c"
)


def _business_role_suffix_pattern() -> str:
    return "|".join(
        re.escape(role)
        for role in sorted(BUSINESS_ROLE_LABELS, key=len, reverse=True)
        if any("\uac00" <= char <= "\ud7a3" for char in role)
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
            "secret",
            re.compile(
                r"\b(?:secret|secret[_-]?key|client[_-]?secret)\b"
                r"\s*[:=]\s*['\"]?"
                r"(?P<value>"
                r"(?=[A-Za-z0-9_.-]{12,}(?:['\"\s,;}]|$))"
                r"(?=[A-Za-z0-9_.-]*[A-Za-z])"
                r"(?=[A-Za-z0-9_.-]*\d)"
                r"[A-Za-z0-9_.-]+"
                r")",
                re.IGNORECASE,
            ),
            10,
        ),
        RegexDetector(
            "api_key",
            re.compile(
                r"\b(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|provider[_-]?key)"
                r"\s*[:=]\s*['\"]?"
                r"(?P<value>"
                r"(?=[A-Za-z0-9_.-]{32,}(?:['\"\s,;}]|$))"
                r"(?=[A-Za-z0-9_.-]*[A-Za-z])"
                r"(?=[A-Za-z0-9_.-]*\d)"
                r"[A-Za-z0-9_.-]+"
                r")",
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
                r"\b(?:bank[_ -]?account|bank[_ -]?account[_ -]?number|bank-account|bank[_ -]?account[_ -]?candidate)\b"
                r"\s*(?:candidate|value|number)?\s*[:=]?\s*['\"]?"
                r"(?P<value>(?:\d{2,6}[- ]?){2,5}\d{2,6})",
                re.IGNORECASE,
            ),
            12,
        ),
        RegexDetector(
            "account_number",
            re.compile(
                r"(?<!bank )(?<!bank-)(?<!bank_)\b(?:"
                r"account[_ -]?number|account[_ -]?no|acct[_ -]?number|"
                r"account-number|account[_ -]?number[_ -]?candidate|"
                r"\uacc4\uc88c(?:\ubc88\ud638)?|\uc785\uae08\s*\uacc4\uc88c|"
                r"\ud658\ubd88\s*\ubc1b\uc744\s*\uacc4\uc88c|\uae09\uc5ec\s*\uacc4\uc88c"
                r")\b"
                r"\s*[:=]?\s*['\"]?"
                r"(?P<value>(?:\d{2,6}[- ]?){2,5}\d{2,6})",
                re.IGNORECASE,
            ),
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
                r"\b(?:passport[_ -]?(?:no|number)|passport[_ -]?id)\s*(?::|=)?\s*['\"]?[A-Z][A-Z0-9]{7,8}(?![A-Z0-9])"
                r"|"
                r"(?:여권번호)\s*[:=]?\s*['\"]?[A-Z][A-Z0-9]{7,8}\b",
                re.IGNORECASE,
            ),
            16,
        ),
        RegexDetector(
            "driver_license",
            re.compile(
                r"\b(?:driver[_ -]?license(?:[_ -]?(?:no|number))?)\s*(?::|=)?\s*['\"]?"
                r"(?:\d{2}[- ]?\d{2}[- ]?\d{6}[- ]?\d{2}|\d{12})(?!\d)"
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
            "private_date",
            re.compile(
                r"\b(?:private[_ -]?date|event[_ -]?date|appointment[_ -]?date|"
                r"meeting[_ -]?date|date|"
                r"\uc0dd\ub144\uc6d4\uc77c|\uc0dd\uc77c|\ub0a0\uc9dc|\ud68c\uc758\s*\ub0a0\uc9dc)"
                r"\b\s*[:=]?\s*['\"]?"
                r"(?P<value>\d{4}[-./]\d{1,2}[-./]\d{1,2})",
                re.IGNORECASE,
            ),
            30,
        ),
        RegexDetector(
            "private_url",
            re.compile(
                r"\b(?:private[_ -]?url|reset[_ -]?url|invite[_ -]?url|callback[_ -]?url|url|link)"
                r"\b\s*[:=]?\s*['\"]?"
                r"(?P<value>https?://[^\s'\"<>]+)",
                re.IGNORECASE,
            ),
            30,
        ),
        RegexDetector(
            "person_name",
            re.compile(
                rf"\b(?i:(?:{ENGLISH_PERSON_CONTEXT_LABEL_PATTERN}))\b"
                rf"\s*(?::|=|(?i:\bis\b|\bwas\b|\bnamed\b))?\s*['\"]?"
                rf"(?P<value>{ENGLISH_PERSON_CONTEXT_VALUE_PATTERN})",
            ),
            31,
        ),
        RegexDetector(
            "person_name",
            re.compile(
                rf"(?:{KOREAN_EXPLICIT_PERSON_LABEL_PATTERN})"
                r"\s*(?::|=|(?:\uc740|\ub294)\s+)\s*['\"]?"
                r"(?P<value>[가-힣]{2,5})",
            ),
            31,
        ),
        RegexDetector(
            "person_name",
            re.compile(
                rf"(?:{KOREAN_ROLE_PERSON_LABEL_PATTERN})\s+"
                rf"(?P<value>[\uac00-\ud7a3]{{2,5}})"
                rf"(?=\s*(?:{KOREAN_STRONG_PERSON_SUFFIX_PATTERN}))",
            ),
            31,
        ),
        RegexDetector(
            "person_name",
            re.compile(
                rf"(?P<value>[\uac00-\ud7a3]{{2,5}}"
                rf"(?<![\uc740\ub294\uc774\uac00\uc744\ub97c\uc758\uc5d0\uaed8])\s*"
                rf"(?:{_business_role_suffix_pattern()})(?:\ub2d8)?"
                rf"(?:{KOREAN_PERSON_ROLE_SUFFIX_PARTICLE_PATTERN})?)"
            ),
            31,
        ),
        RegexDetector(
            "organization_name",
            re.compile(
                r"\b(?i:(?:organization(?:[_ -]?name|-name)?|org(?:anization)?[_ -]?name|"
                r"company(?:[_ -]?name)?|employer|vendor|tenant|workspace|"
                r"\ud68c\uc0ac\uba85|\uac70\ub798\ucc98|\uc870\uc9c1\uba85))"
                r"\b\s*(?:(?i:(?:candidate|value|marker|field|slot|placeholder))\s+)?"
                r"(?::|=|(?i:\bis\b|\bwas\b|\bnamed\b))?\s*['\"]?"
                r"(?P<value>[A-Z][A-Za-z0-9&.,'-]*(?:\s+[A-Z][A-Za-z0-9&.,'-]*){0,4})",
            ),
            36,
        ),
        RegexDetector(
            "confidential_business_context",
            re.compile(
                r"\bSYNTHETIC_CONFIDENTIAL_BUSINESS_CONTEXT\b|"
                r"\bSYNTHETIC_CONFIDENTIAL_METRIC_VALUE\b|"
                r"\b(?:unreleased|confidential|internal)\s+"
                r"(?:revenue|pricing|roadmap|policy|metric|forecast)\b",
                re.IGNORECASE,
            ),
            18,
        ),
        RegexDetector(
            "sensitive_health_context",
            re.compile(
                r"\bSYNTHETIC_SENSITIVE_HEALTH_CONTEXT\b|"
                r"\bSYNTHETIC_HEALTH_CONTEXT\b|"
                r"\b(?:patient|medical|health|diagnosis|medicine|mental\s+health)\s+"
                r"(?:record|condition|context|history|note)\b",
                re.IGNORECASE,
            ),
            18,
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
            re.compile(r"(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)"),
            20,
        ),
        RegexDetector(
            "phone_number",
            re.compile(r"\b(?:\+82[-.\s]?)?(?:0?1[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b"),
            40,
        ),
        RegexDetector(
            "email",
            re.compile(
                r"(?<![A-Z0-9._%+\-])"
                r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}"
                r"(?![A-Z0-9_%+\-]|\.[A-Z0-9])",
                re.IGNORECASE,
            ),
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
