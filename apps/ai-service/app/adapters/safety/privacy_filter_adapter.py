from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from typing import Any

from app.domain.safety.detections import DEFAULT_ML_MIN_CONFIDENCE, Detection, normalized_confidence
from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES


DEFAULT_PRIVACY_FILTER_MODEL = "openai/privacy-filter"
DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME = "openai--privacy-filter"
DEFAULT_PRIVACY_FILTER_SOURCE = "openai_privacy_filter"
KOELECTRA_PRIVACY_NER_MODEL = "amoeba04/koelectra-small-v3-privacy-ner"
KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME = "amoeba04--koelectra-small-v3-privacy-ner"
KOELECTRA_PRIVACY_NER_SOURCE = "koelectra_privacy_ner"
PRIVACY_FILTER_RUNTIME_TRANSFORMERS = "transformers"
PRIVACY_FILTER_RUNTIME_ONNX = "onnx"
PRIVACY_FILTER_RUNTIMES = {
    PRIVACY_FILTER_RUNTIME_TRANSFORMERS,
    PRIVACY_FILTER_RUNTIME_ONNX,
}

DEFAULT_LABEL_MAP: Mapping[str, str] = {
    "acc": "account_number",
    "account": "account_id",
    "account_id": "account_id",
    "account_number": "account_number",
    "address": "postal_address",
    "api_key": "api_key",
    "authorization_header": "authorization_header",
    "bank_account": "bank_account",
    "card": "credit_card",
    "cloud_access_key": "cloud_access_key",
    "crd": "credit_card",
    "credit_card": "credit_card",
    "customer_id": "customer_id",
    "database_url": "database_url",
    "date_of_birth": "date_of_birth",
    "date": "private_date",
    "dln": "driver_license",
    "dob": "date_of_birth",
    "driver_license": "driver_license",
    "email": "email",
    "ema": "email",
    "github_token": "github_token",
    "id": "account_id",
    "ip": "ip_address",
    "ip_address": "ip_address",
    "jwt": "jwt",
    "loc": "postal_address",
    "location": "postal_address",
    "org": "organization_name",
    "organization": "organization_name",
    "organization_name": "organization_name",
    "passport_number": "passport_number",
    "per": "person_name",
    "person": "person_name",
    "person_name": "person_name",
    "phn": "phone_number",
    "phone": "phone_number",
    "phone_number": "phone_number",
    "private_address": "postal_address",
    "private_date": "private_date",
    "private_email": "email",
    "private_organization": "organization_name",
    "private_person": "person_name",
    "private_phone": "phone_number",
    "private_url": "private_url",
    "provider_api_key": "provider_api_key",
    "psp": "passport_number",
    "pwd": "password_assignment",
    "resident_registration_number": "resident_registration_number",
    "rrn": "resident_registration_number",
    "secret": "secret",
    "session_cookie": "session_cookie",
    "slack_token": "slack_token",
    "tel": "phone_number",
    "telephone": "phone_number",
    "url": "private_url",
    "webhook_url": "webhook_url",
}


class PrivacyFilterAdapter:
    def __init__(
        self,
        *,
        classifier: Callable[[str], object] | None = None,
        model_name: str = DEFAULT_PRIVACY_FILTER_MODEL,
        source: str = DEFAULT_PRIVACY_FILTER_SOURCE,
        label_map: Mapping[str, str] | None = None,
        min_confidence: float = DEFAULT_ML_MIN_CONFIDENCE,
        aggregation_strategy: str | None = None,
        runtime: str = PRIVACY_FILTER_RUNTIME_TRANSFORMERS,
    ) -> None:
        self._lock = threading.Lock()
        self._classifier = classifier
        self.model_name = model_name
        self.source = source
        self.label_map = label_map or DEFAULT_LABEL_MAP
        self.min_confidence = min_confidence
        self.aggregation_strategy = aggregation_strategy or aggregation_strategy_for_model(model_name)
        self.runtime = runtime_for_value(runtime)

    def detect(self, text: str) -> list[Detection]:
        if text == "":
            return []

        detections: list[Detection] = []
        for item in self._run_classifier(text):
            detection = self._detection_from_item(item, len(text))
            if detection is not None:
                detections.append(detection)
        return detections

    def _run_classifier(self, text: str) -> list[Mapping[str, Any]]:
        classifier = self._classifier
        if classifier is None:
            with self._lock:
                classifier = self._classifier
                if classifier is None:
                    classifier = self._load_classifier()
                    self._classifier = classifier

        result = classifier(text)
        if not isinstance(result, list):
            return []
        return [item for item in result if isinstance(item, Mapping)]

    def _load_classifier(self) -> Callable[[str], object]:
        if self.runtime == PRIVACY_FILTER_RUNTIME_ONNX:
            try:
                return self._load_onnx_classifier()
            except ImportError:
                return self._load_transformers_classifier()
        return self._load_transformers_classifier()

    def _load_transformers_classifier(self) -> Callable[[str], object]:
        try:
            from transformers import pipeline
        except ImportError as exc:
            raise RuntimeError(
                "PrivacyFilterAdapter requires the optional ai-service ml dependencies."
            ) from exc

        return pipeline(
            task="token-classification",
            model=self.model_name,
            aggregation_strategy=self.aggregation_strategy,
        )

    def _load_onnx_classifier(self) -> Callable[[str], object]:
        try:
            from optimum.onnxruntime import ORTModelForTokenClassification
            from transformers import AutoTokenizer, pipeline
        except ImportError:
            raise

        tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        model = ORTModelForTokenClassification.from_pretrained(self.model_name)
        return pipeline(
            task="token-classification",
            model=model,
            tokenizer=tokenizer,
            aggregation_strategy=self.aggregation_strategy,
        )

    def _detection_from_item(self, item: Mapping[str, Any], text_length: int) -> Detection | None:
        raw_label = str(item.get("entity_group") or item.get("entity") or "")
        detector_type = normalize_label(raw_label, self.label_map)
        if detector_type is None or detector_type not in ALLOWED_DETECTOR_TYPES:
            return None

        start = _coerce_int(item.get("start"))
        end = _coerce_int(item.get("end"))
        if start is None or end is None:
            return None
        if start < 0 or end <= start or end > text_length:
            return None

        confidence = normalized_confidence(_coerce_float(item.get("score")))
        if confidence < self.min_confidence:
            return None

        return Detection(
            detector_type=detector_type,
            source=self.source,
            start=start,
            end=end,
            confidence=confidence,
        )


def normalize_label(raw_label: str, label_map: Mapping[str, str] | None = None) -> str | None:
    key = raw_label.strip()
    if key == "":
        return None
    normalized = _strip_bio_marker(key).lower()
    mapped = (label_map or DEFAULT_LABEL_MAP).get(normalized)
    if mapped is None:
        return None
    return mapped.strip() or None


def runtime_for_value(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in PRIVACY_FILTER_RUNTIMES:
        return normalized
    return PRIVACY_FILTER_RUNTIME_TRANSFORMERS


def source_for_model(model_name: str) -> str:
    if _is_default_privacy_filter_model(model_name):
        return DEFAULT_PRIVACY_FILTER_SOURCE
    if _is_koelectra_privacy_ner_model(model_name):
        return KOELECTRA_PRIVACY_NER_SOURCE
    return "huggingface_token_classifier"


def aggregation_strategy_for_model(model_name: str) -> str:
    if _is_koelectra_privacy_ner_model(model_name):
        return "none"
    return "simple"


def public_model_id_for_model(model_name: str) -> str:
    if _is_default_privacy_filter_model(model_name):
        return DEFAULT_PRIVACY_FILTER_MODEL
    if _is_koelectra_privacy_ner_model(model_name):
        return KOELECTRA_PRIVACY_NER_MODEL
    return model_name


def _is_default_privacy_filter_model(model_name: str) -> bool:
    normalized = model_name.replace("\\", "/").rstrip("/")
    return normalized == DEFAULT_PRIVACY_FILTER_MODEL or normalized.endswith(
        f"/{DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME}"
    )


def _is_koelectra_privacy_ner_model(model_name: str) -> bool:
    normalized = model_name.replace("\\", "/").rstrip("/")
    return normalized == KOELECTRA_PRIVACY_NER_MODEL or normalized.endswith(
        f"/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}"
    )


def _strip_bio_marker(label: str) -> str:
    without_prefix = _strip_bio_prefix(label)
    return _strip_bio_suffix(without_prefix)


def _strip_bio_prefix(label: str) -> str:
    if len(label) > 2 and label[1] == "-" and label[0].upper() in {"B", "I", "E", "S", "U"}:
        return label[2:]
    return label


def _strip_bio_suffix(label: str) -> str:
    if len(label) > 2 and label[-2] == "-" and label[-1].upper() in {"B", "I", "E", "S", "U"}:
        return label[:-2]
    return label


def _coerce_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_float(value: object) -> float:
    if isinstance(value, bool):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
