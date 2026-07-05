from __future__ import annotations

import json
import threading
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from app.domain.safety.detections import (
    DEFAULT_ML_MIN_CONFIDENCE,
    DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_TYPE,
    Detection,
    confidence_threshold_for_detection,
    normalized_confidence,
)
from app.domain.safety.detectors import ALLOWED_DETECTOR_TYPES


DEFAULT_PRIVACY_FILTER_MODEL = "openai/privacy-filter"
DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME = "openai--privacy-filter"
DEFAULT_PRIVACY_FILTER_SOURCE = "openai_privacy_filter"
KOELECTRA_PRIVACY_NER_MODEL = "amoeba04/koelectra-small-v3-privacy-ner"
KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME = "amoeba04--koelectra-small-v3-privacy-ner"
KOELECTRA_PRIVACY_NER_QUANTIZED_LOCAL_DIR_NAME = f"{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}-quantized"
KOELECTRA_PRIVACY_NER_SOURCE = "koelectra_privacy_ner"
PRIVACY_FILTER_RUNTIME_TRANSFORMERS = "transformers"
PRIVACY_FILTER_RUNTIME_ONNX = "onnx"
PRIVACY_FILTER_RUNTIMES = {
    PRIVACY_FILTER_RUNTIME_TRANSFORMERS,
    PRIVACY_FILTER_RUNTIME_ONNX,
}

OPENAI_PRIVACY_FILTER_LABEL_MAP: Mapping[str, str] = {
    "account_number": "account_number",
    "email": "email",
    "phone_number": "phone_number",
    "postal_address": "postal_address",
    "private_address": "postal_address",
    "private_date": "private_date",
    "private_email": "email",
    "private_phone": "phone_number",
    "private_url": "private_url",
    "secret": "secret",
}

KOELECTRA_PRIVACY_NER_LABEL_MAP: Mapping[str, str] = {
    "email": "email",
    "ema": "email",
    "phone": "phone_number",
    "phone_number": "phone_number",
    "phn": "phone_number",
    "resident_registration_number": "resident_registration_number",
    "rrn": "resident_registration_number",
    "tel": "phone_number",
    "telephone": "phone_number",
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
        source: str | None = None,
        label_map: Mapping[str, str] | None = None,
        min_confidence: float = DEFAULT_ML_MIN_CONFIDENCE,
        min_confidence_by_detector_type: Mapping[str, float] | None = None,
        aggregation_strategy: str | None = None,
        runtime: str = PRIVACY_FILTER_RUNTIME_ONNX,
    ) -> None:
        self._lock = threading.Lock()
        self._classifier = classifier
        self.model_name = model_name
        self.source = source or source_for_model(model_name)
        self.label_map = label_map if label_map is not None else label_map_for_model(model_name)
        self.min_confidence = min_confidence
        self.min_confidence_by_detector_type = (
            DEFAULT_ML_MIN_CONFIDENCE_BY_DETECTOR_TYPE
            if min_confidence_by_detector_type is None
            else min_confidence_by_detector_type
        )
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

    @property
    def load_state(self) -> str:
        return "loaded" if self._classifier is not None else "configured"

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
            return self._load_onnx_classifier()
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
        model_dir = _local_openai_privacy_filter_onnx_dir(self.model_name)
        if model_dir is not None:
            return _OpenAIPrivacyFilterOnnxClassifier(model_dir)

        try:
            from optimum.onnxruntime import ORTModelForTokenClassification
            from transformers import AutoTokenizer, pipeline
        except ImportError as exc:
            raise RuntimeError(
                "PrivacyFilterAdapter requires the optional ai-service onnx dependencies "
                "when AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx."
            ) from exc

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
        threshold = confidence_threshold_for_detection(
            detector_type,
            min_confidence_by_type=self.min_confidence_by_detector_type,
            default_min_confidence=self.min_confidence,
        )
        if confidence < threshold:
            return None

        return Detection(
            detector_type=detector_type,
            source=self.source,
            start=start,
            end=end,
            confidence=confidence,
        )


class _OpenAIPrivacyFilterOnnxClassifier:
    def __init__(self, model_dir: Path) -> None:
        self.model_dir = model_dir
        self._session: Any | None = None
        self._tokenizer: Any | None = None
        config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
        self._id_to_label = {int(index): str(label) for index, label in config["id2label"].items()}

    def __call__(self, text: str) -> list[Mapping[str, Any]]:
        if text == "":
            return []
        tokenizer = self._load_tokenizer()
        encoding = tokenizer.encode(text)
        if not encoding.ids:
            return []

        try:
            import numpy as np
        except ImportError as exc:
            raise RuntimeError("OpenAI privacy-filter ONNX runtime requires numpy.") from exc

        input_ids = np.asarray([encoding.ids], dtype=np.int64)
        attention_mask = np.ones_like(input_ids, dtype=np.int64)
        logits = self._load_session().run(
            None,
            {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
            },
        )[0][0]
        predicted_ids = logits.argmax(axis=-1)
        shifted_logits = logits - logits.max(axis=-1, keepdims=True)
        probabilities = np.exp(shifted_logits)
        probabilities = probabilities / probabilities.sum(axis=-1, keepdims=True)
        token_confidences = probabilities[np.arange(len(predicted_ids)), predicted_ids]
        return _decode_openai_privacy_filter_spans(
            id_to_label=self._id_to_label,
            predicted_ids=[int(predicted_id) for predicted_id in predicted_ids],
            confidences=[float(confidence) for confidence in token_confidences],
            offsets=[tuple(offset) for offset in encoding.offsets],
        )

    def _load_session(self) -> Any:
        session = self._session
        if session is None:
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError("OpenAI privacy-filter ONNX runtime requires onnxruntime.") from exc
            session = ort.InferenceSession(str(self.model_dir / "onnx" / "model_quantized.onnx"))
            self._session = session
        return session

    def _load_tokenizer(self) -> Any:
        tokenizer = self._tokenizer
        if tokenizer is None:
            try:
                from tokenizers import Tokenizer
            except ImportError as exc:
                raise RuntimeError("OpenAI privacy-filter ONNX runtime requires tokenizers.") from exc
            tokenizer = Tokenizer.from_file(str(self.model_dir / "tokenizer.json"))
            self._tokenizer = tokenizer
        return tokenizer


def _decode_openai_privacy_filter_spans(
    *,
    id_to_label: Mapping[int, str],
    predicted_ids: list[int],
    confidences: list[float],
    offsets: list[tuple[int, int]],
) -> list[Mapping[str, Any]]:
    items: list[Mapping[str, Any]] = []
    current_type: str | None = None
    current_start: int | None = None
    current_end: int | None = None
    current_scores: list[float] = []

    def flush() -> None:
        nonlocal current_type, current_start, current_end, current_scores
        if current_type is not None and current_start is not None and current_end is not None:
            score = sum(current_scores) / len(current_scores) if current_scores else 0.0
            items.append(
                {
                    "entity_group": current_type,
                    "score": score,
                    "start": current_start,
                    "end": current_end,
                }
            )
        current_type = None
        current_start = None
        current_end = None
        current_scores = []

    for predicted_id, confidence, offset in zip(predicted_ids, confidences, offsets):
        start, end = offset
        label = id_to_label.get(predicted_id, "O")
        if label == "O" or start < 0 or end <= start:
            flush()
            continue
        marker, entity_type = _split_bioes_label(label)
        if marker == "S":
            flush()
            current_type = entity_type
            current_start = start
            current_end = end
            current_scores = [confidence]
            flush()
            continue
        if marker == "B" or current_type != entity_type:
            flush()
            current_type = entity_type
            current_start = start
            current_scores = []
        current_end = end
        current_scores.append(confidence)
        if marker == "E":
            flush()
    flush()
    return items


def _split_bioes_label(label: str) -> tuple[str, str]:
    if len(label) > 2 and label[1] == "-" and label[0].upper() in {"B", "I", "E", "S", "U"}:
        return label[0].upper(), label[2:]
    return "S", label


def normalize_label(raw_label: str, label_map: Mapping[str, str] | None = None) -> str | None:
    key = raw_label.strip()
    if key == "":
        return None
    normalized = _strip_bio_marker(key).lower()
    mapped = (label_map or DEFAULT_LABEL_MAP).get(normalized)
    if mapped is None:
        return None
    return mapped.strip() or None


def label_map_for_model(model_name: str) -> Mapping[str, str]:
    if _is_default_privacy_filter_model(model_name):
        return OPENAI_PRIVACY_FILTER_LABEL_MAP
    if _is_koelectra_privacy_ner_model(model_name):
        return KOELECTRA_PRIVACY_NER_LABEL_MAP
    return {}


def runtime_for_value(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in PRIVACY_FILTER_RUNTIMES:
        return normalized
    return PRIVACY_FILTER_RUNTIME_ONNX


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


def _local_openai_privacy_filter_onnx_dir(model_name: str) -> Path | None:
    candidates = [Path(model_name)]
    if _is_default_privacy_filter_model(model_name):
        candidates.extend(
            [
                Path(".cache") / "onnx" / DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME,
                Path("apps") / "ai-service" / ".cache" / "onnx" / DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME,
            ]
        )
    for candidate in candidates:
        if (
            (candidate / "config.json").is_file()
            and (candidate / "tokenizer.json").is_file()
            and (candidate / "onnx" / "model_quantized.onnx").is_file()
        ):
            return candidate
    return None


def _is_koelectra_privacy_ner_model(model_name: str) -> bool:
    normalized = model_name.replace("\\", "/").rstrip("/")
    return (
        normalized == KOELECTRA_PRIVACY_NER_MODEL
        or normalized.endswith(f"/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}")
        or normalized.endswith(f"/{KOELECTRA_PRIVACY_NER_QUANTIZED_LOCAL_DIR_NAME}")
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
