from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Mapping
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from app.adapters.safety.privacy_filter_adapter import AdapterBatchResult
from app.domain.safety.detections import (
    DEFAULT_ML_MIN_CONFIDENCE,
    DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_TYPE,
    Detection,
    confidence_threshold_for_detection,
    normalized_confidence,
)
from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES


AZURE_PII_MODEL = "microsoft/azure-ai-language-pii"
AZURE_PII_SOURCE = "azure_ai_language_pii"
AZURE_PII_RUNTIME = "azure_container"
DEFAULT_AZURE_PII_API_VERSION = "2024-11-01"
DEFAULT_AZURE_PII_LANGUAGE = "ko"
DEFAULT_AZURE_PII_TIMEOUT_MS = 750
AZURE_PII_MAX_DOCUMENTS = 10
AZURE_PII_MAX_DOCUMENT_CHARS = 5120
AZURE_PII_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
AZURE_PII_REQUEST_ERROR = "Azure PII detector request failed."
_API_VERSION_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-preview)?$")
_LANGUAGE_PATTERN = re.compile(r"^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$")

AZURE_PII_LABEL_MAP: Mapping[str, str] = {
    "Address": "postal_address",
    "BankAccountNumber": "account_number",
    "CreditCardNumber": "credit_card",
    "DateOfBirth": "private_date",
    "DriversLicenseNumber": "driver_license",
    "Email": "email",
    "InternationalBankingAccountNumber": "account_number",
    "IPAddress": "ip_address",
    "KRDriversLicenseNumber": "driver_license",
    "KRPassportNumber": "passport_number",
    "KRResidentRegistrationNumber": "resident_registration_number",
    "KRSocialSecurityNumber": "resident_registration_number",
    "Organization": "organization_name",
    "PassportNumber": "passport_number",
    "Password": "password_assignment",
    "Person": "person_name",
    "PhoneNumber": "phone_number",
    "URL": "private_url",
}

AzurePiiRequester = Callable[
    [str, Mapping[str, Any], Mapping[str, str], float],
    object,
]


class AzurePiiAdapter:
    """Call an Azure AI Language PII container without retaining response text."""

    scan_full_text = True
    max_document_chars = AZURE_PII_MAX_DOCUMENT_CHARS

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str = "",
        api_version: str = DEFAULT_AZURE_PII_API_VERSION,
        language: str = DEFAULT_AZURE_PII_LANGUAGE,
        timeout_ms: int = DEFAULT_AZURE_PII_TIMEOUT_MS,
        allowed_detector_types: frozenset[str] | None = None,
        requester: AzurePiiRequester | None = None,
        label_map: Mapping[str, str] | None = None,
        min_confidence: float = DEFAULT_ML_MIN_CONFIDENCE,
        min_confidence_by_detector_type: Mapping[str, float] | None = None,
    ) -> None:
        self.endpoint = _normalized_endpoint(endpoint)
        self.api_key = _validated_api_key(api_key)
        self.api_version = _validated_api_version(api_version)
        self.language = _validated_language(language)
        self.timeout_seconds = _validated_timeout_seconds(timeout_ms)
        configured_label_map = dict(label_map or AZURE_PII_LABEL_MAP)
        if allowed_detector_types is not None:
            configured_label_map = {
                category: detector_type
                for category, detector_type in configured_label_map.items()
                if detector_type in allowed_detector_types
            }
        if not configured_label_map:
            raise ValueError("Azure PII detector type allowlist must not be empty.")
        unsupported = set(configured_label_map.values()) - set(ALLOWED_DETECTOR_TYPES)
        if unsupported:
            raise ValueError("Azure PII label map contains an unsupported detector type.")
        self.label_map = configured_label_map
        self.min_confidence = min_confidence
        self.min_confidence_by_detector_type = (
            dict(DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_TYPE)
            if min_confidence_by_detector_type is None
            else dict(min_confidence_by_detector_type)
        )
        self.model_name = AZURE_PII_MODEL
        self.source = AZURE_PII_SOURCE
        self.runtime = AZURE_PII_RUNTIME
        self._requester = requester or _request_json
        self._state_lock = threading.Lock()
        self._loaded = False

    @property
    def supported_detector_types(self) -> frozenset[str]:
        return frozenset(self.label_map.values())

    @property
    def load_state(self) -> str:
        with self._state_lock:
            return "loaded" if self._loaded else "configured"

    def warmup(self) -> None:
        self.detect("GateLM synthetic privacy detector warmup.")

    def detect(self, text: str) -> list[Detection]:
        return self.detect_many([text], batch_size=1).detections[0]

    def detect_many(self, texts: list[str], *, batch_size: int = 4) -> AdapterBatchResult:
        if not texts:
            return AdapterBatchResult(detections=[], model_invocation_count=0)

        detections: list[list[Detection]] = [[] for _ in texts]
        non_empty: list[tuple[int, str]] = []
        for index, text in enumerate(texts):
            if text == "":
                continue
            if len(text) > self.max_document_chars:
                raise RuntimeError("Azure PII detector document limit exceeded.")
            non_empty.append((index, text))
        if not non_empty:
            return AdapterBatchResult(detections=detections, model_invocation_count=0)

        bounded_batch_size = max(1, min(int(batch_size), AZURE_PII_MAX_DOCUMENTS))
        invocation_count = 0
        for chunk_start in range(0, len(non_empty), bounded_batch_size):
            chunk = non_empty[chunk_start : chunk_start + bounded_batch_size]
            response = self._requester(
                self._request_url(),
                self._payload(chunk),
                self._headers(),
                self.timeout_seconds,
            )
            parsed = self._parse_response(response, chunk)
            invocation_count += 1
            for original_index, item_detections in parsed.items():
                detections[original_index].extend(item_detections)
            with self._state_lock:
                self._loaded = True

        return AdapterBatchResult(
            detections=detections,
            model_invocation_count=invocation_count,
        )

    def _request_url(self) -> str:
        query = urlencode({"api-version": self.api_version})
        return f"{self.endpoint}/language/:analyze-text?{query}"

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "GateLM-ai-service/azure-pii",
        }
        if self.api_key:
            headers["Ocp-Apim-Subscription-Key"] = self.api_key
        return headers

    def _payload(self, chunk: list[tuple[int, str]]) -> dict[str, object]:
        return {
            "kind": "PiiEntityRecognition",
            "parameters": {
                "modelVersion": "latest",
                "stringIndexType": "UnicodeCodePoint",
            },
            "analysisInput": {
                "documents": [
                    {
                        "id": str(original_index),
                        "language": self.language,
                        "text": text,
                    }
                    for original_index, text in chunk
                ]
            },
        }

    def _parse_response(
        self,
        response: object,
        chunk: list[tuple[int, str]],
    ) -> dict[int, list[Detection]]:
        if not isinstance(response, Mapping):
            raise RuntimeError(AZURE_PII_REQUEST_ERROR)
        results = response.get("results")
        if not isinstance(results, Mapping):
            raise RuntimeError(AZURE_PII_REQUEST_ERROR)
        errors = results.get("errors", [])
        if not isinstance(errors, list) or errors:
            raise RuntimeError(AZURE_PII_REQUEST_ERROR)
        documents = results.get("documents")
        if not isinstance(documents, list):
            raise RuntimeError(AZURE_PII_REQUEST_ERROR)

        expected = {str(index): (index, text) for index, text in chunk}
        parsed: dict[int, list[Detection]] = {}
        seen_document_ids: set[str] = set()
        for document in documents:
            if not isinstance(document, Mapping):
                raise RuntimeError(AZURE_PII_REQUEST_ERROR)
            document_id = document.get("id")
            if (
                not isinstance(document_id, str)
                or document_id not in expected
                or document_id in seen_document_ids
            ):
                raise RuntimeError(AZURE_PII_REQUEST_ERROR)
            seen_document_ids.add(document_id)
            original_index, text = expected[document_id]
            entities = document.get("entities")
            if not isinstance(entities, list):
                raise RuntimeError(AZURE_PII_REQUEST_ERROR)
            item_detections: list[Detection] = []
            for entity in entities:
                if not isinstance(entity, Mapping):
                    continue
                detection = self._detection_from_entity(entity, len(text))
                if detection is not None:
                    item_detections.append(detection)
            parsed[original_index] = item_detections

        if set(parsed) != {index for index, _ in chunk}:
            raise RuntimeError(AZURE_PII_REQUEST_ERROR)
        return parsed

    def _detection_from_entity(
        self,
        entity: Mapping[str, Any],
        text_length: int,
    ) -> Detection | None:
        category = entity.get("category")
        if not isinstance(category, str):
            category = entity.get("type")
        if not isinstance(category, str):
            return None
        detector_type = self._detector_type_for_category(category)
        if detector_type is None:
            return None

        start = entity.get("offset")
        length = entity.get("length")
        confidence = entity.get("confidenceScore")
        if (
            not isinstance(start, int)
            or isinstance(start, bool)
            or not isinstance(length, int)
            or isinstance(length, bool)
            or start < 0
            or length <= 0
            or start + length > text_length
            or not isinstance(confidence, (int, float))
            or isinstance(confidence, bool)
        ):
            return None
        normalized_score = normalized_confidence(float(confidence))
        threshold = confidence_threshold_for_detection(
            detector_type,
            min_confidence_by_type=self.min_confidence_by_detector_type,
            default_min_confidence=self.min_confidence,
        )
        if normalized_score < threshold:
            return None

        return Detection(
            detector_type=detector_type,
            source=self.source,
            start=start,
            end=start + length,
            confidence=normalized_score,
        )

    def _detector_type_for_category(self, category: str) -> str | None:
        normalized = _normalized_category(category)
        for configured_category, detector_type in self.label_map.items():
            if _normalized_category(configured_category) == normalized:
                return detector_type
        if normalized.endswith("bankaccountnumber"):
            return self._allowed_fallback("account_number")
        if normalized.endswith("creditcardnumber"):
            return self._allowed_fallback("credit_card")
        if normalized.endswith("driverslicensenumber"):
            return self._allowed_fallback("driver_license")
        if normalized.endswith("passportnumber"):
            return self._allowed_fallback("passport_number")
        return None

    def _allowed_fallback(self, detector_type: str) -> str | None:
        return detector_type if detector_type in self.supported_detector_types else None


def _request_json(
    url: str,
    payload: Mapping[str, Any],
    headers: Mapping[str, str],
    timeout_seconds: float,
) -> object:
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers=dict(headers),
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            if getattr(response, "status", 200) != 200:
                raise RuntimeError(AZURE_PII_REQUEST_ERROR)
            raw = response.read(AZURE_PII_MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, TimeoutError, OSError):
        raise RuntimeError(AZURE_PII_REQUEST_ERROR) from None
    if len(raw) > AZURE_PII_MAX_RESPONSE_BYTES:
        raise RuntimeError(AZURE_PII_REQUEST_ERROR)
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise RuntimeError(AZURE_PII_REQUEST_ERROR) from None


def _normalized_endpoint(value: str) -> str:
    normalized = value.strip()
    parsed = urlsplit(normalized)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.netloc == ""
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query != ""
        or parsed.fragment != ""
    ):
        raise ValueError("Azure PII endpoint is invalid.")
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", "")).rstrip("/")


def _validated_api_key(value: str) -> str:
    normalized = value.strip()
    if any(char in normalized for char in ("\r", "\n")):
        raise ValueError("Azure PII API key is invalid.")
    return normalized


def _validated_api_version(value: str) -> str:
    normalized = value.strip()
    if _API_VERSION_PATTERN.fullmatch(normalized) is None:
        raise ValueError("Azure PII API version is invalid.")
    return normalized


def _validated_language(value: str) -> str:
    normalized = value.strip()
    if _LANGUAGE_PATTERN.fullmatch(normalized) is None:
        raise ValueError("Azure PII language is invalid.")
    return normalized.lower()


def _validated_timeout_seconds(timeout_ms: int) -> float:
    if isinstance(timeout_ms, bool) or not 50 <= int(timeout_ms) <= 30_000:
        raise ValueError("Azure PII timeout must be between 50 and 30000 milliseconds.")
    return int(timeout_ms) / 1000


def _normalized_category(value: str) -> str:
    return "".join(char.lower() for char in value if char.isalnum())
