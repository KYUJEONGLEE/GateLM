from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
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
GATELM_KOELECTRA_PII_NER_MODEL = "gatelm/koelectra-small-v3-pii-ner"
GATELM_KOELECTRA_PII_NER_LOCAL_DIR_NAME = "gatelm--koelectra-small-v3-pii-ner"
GATELM_KOELECTRA_PII_NER_QUANTIZED_LOCAL_DIR_NAME = (
    f"{GATELM_KOELECTRA_PII_NER_LOCAL_DIR_NAME}-quantized"
)
GATELM_KOELECTRA_PII_NER_SOURCE = "gatelm_koelectra_pii_ner"
PRIVACY_FILTER_RUNTIME_TRANSFORMERS = "transformers"
PRIVACY_FILTER_RUNTIME_ONNX = "onnx"
PRIVACY_FILTER_RUNTIMES = {
    PRIVACY_FILTER_RUNTIME_TRANSFORMERS,
    PRIVACY_FILTER_RUNTIME_ONNX,
}
MODEL_WARMUP_TEXT = "GateLM synthetic PII detector warmup."
ONNX_INTRA_OP_THREADS_ENV = "AI_SERVICE_ONNX_INTRA_OP_THREADS"
ONNX_INTER_OP_THREADS_ENV = "AI_SERVICE_ONNX_INTER_OP_THREADS"
ONNX_ALLOW_SPINNING_ENV = "AI_SERVICE_ONNX_ALLOW_SPINNING"

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

GATELM_KOELECTRA_PII_NER_LABEL_MAP: Mapping[str, str] = {
    "addr": "postal_address",
    "address": "postal_address",
    "ema": "email",
    "email": "email",
    "org": "organization_name",
    "organization": "organization_name",
    "per": "person_name",
    "person": "person_name",
    "phn": "phone_number",
    "phone": "phone_number",
    "rrn": "resident_registration_number",
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


@dataclass(frozen=True)
class AdapterBatchResult:
    detections: list[list[Detection]]
    model_invocation_count: int


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
        allowed_detector_types: frozenset[str] | None = None,
    ) -> None:
        self._lock = threading.Lock()
        self._classifier = classifier
        self._classifier_was_injected = classifier is not None
        self.model_name = model_name
        self.source = source or source_for_model(model_name)
        configured_label_map = label_map if label_map is not None else label_map_for_model(model_name)
        if allowed_detector_types is not None:
            configured_label_map = {
                label: detector_type
                for label, detector_type in configured_label_map.items()
                if detector_type in allowed_detector_types
            }
            if not configured_label_map:
                raise ValueError(
                    "AI safety model does not support any configured ML detector type."
                )
        self.label_map = configured_label_map
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

    def detect_many(self, texts: list[str], *, batch_size: int = 4) -> AdapterBatchResult:
        if not texts:
            return AdapterBatchResult(detections=[], model_invocation_count=0)

        bounded_batch_size = max(1, min(batch_size, 64))
        detected: list[list[Detection]] = [[] for _ in texts]
        non_empty = [(index, text) for index, text in enumerate(texts) if text != ""]
        if not non_empty:
            return AdapterBatchResult(detections=detected, model_invocation_count=0)

        classifier = self._classifier_instance()
        classifier_batch_limit = getattr(classifier, "max_safe_batch_size", 64)
        if isinstance(classifier_batch_limit, int):
            bounded_batch_size = min(bounded_batch_size, max(1, classifier_batch_limit))
        invocation_count = 0
        for chunk_start in range(0, len(non_empty), bounded_batch_size):
            chunk = non_empty[chunk_start : chunk_start + bounded_batch_size]
            chunk_texts = [text for _, text in chunk]
            supports_batch = callable(getattr(classifier, "classify_many", None)) or not self._classifier_was_injected
            raw_results = self._run_classifier_many(classifier, chunk_texts)
            invocation_count += 1 if supports_batch else len(chunk_texts)
            for (original_index, text), raw_items in zip(chunk, raw_results, strict=True):
                for item in raw_items:
                    detection = self._detection_from_item(item, len(text))
                    if detection is not None:
                        detected[original_index].append(detection)
        return AdapterBatchResult(
            detections=detected,
            model_invocation_count=invocation_count,
        )

    @property
    def supported_detector_types(self) -> frozenset[str]:
        return frozenset(
            detector_type
            for detector_type in self.label_map.values()
            if detector_type in ALLOWED_DETECTOR_TYPES
        )

    @property
    def load_state(self) -> str:
        return "loaded" if self._classifier is not None else "configured"

    def warmup(self) -> None:
        self._run_classifier(MODEL_WARMUP_TEXT)

    def _run_classifier(self, text: str) -> list[Mapping[str, Any]]:
        classifier = self._classifier_instance()

        result = classifier(text)
        if not isinstance(result, list):
            raise RuntimeError("AI safety model output is invalid.")
        return [item for item in result if isinstance(item, Mapping)]

    def _classifier_instance(self) -> Callable[[str], object]:
        classifier = self._classifier
        if classifier is None:
            with self._lock:
                classifier = self._classifier
                if classifier is None:
                    classifier = self._load_classifier()
                    self._classifier = classifier
        return classifier

    def _run_classifier_many(
        self,
        classifier: Callable[[str], object],
        texts: list[str],
    ) -> list[list[Mapping[str, Any]]]:
        classify_many = getattr(classifier, "classify_many", None)
        if callable(classify_many):
            raw_results = classify_many(texts)
        elif self._classifier_was_injected:
            raw_results = [classifier(text) for text in texts]
        else:
            raw_results = classifier(texts, batch_size=len(texts))  # type: ignore[call-arg]

        if not isinstance(raw_results, list) or len(raw_results) != len(texts):
            raise RuntimeError("AI safety model batch output is invalid.")
        normalized: list[list[Mapping[str, Any]]] = []
        for raw_result in raw_results:
            if not isinstance(raw_result, list):
                raise RuntimeError("AI safety model batch output is invalid.")
            normalized.append(
                [item for item in raw_result if isinstance(item, Mapping)]
            )
        return normalized

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
        model_dir = _local_koelectra_privacy_ner_onnx_dir(self.model_name)
        if model_dir is not None:
            return _KoElectraPrivacyNerOnnxClassifier(model_dir)

        try:
            from optimum.onnxruntime import ORTModelForTokenClassification
            from transformers import AutoTokenizer, pipeline
        except ImportError as exc:
            raise RuntimeError(
                "PrivacyFilterAdapter requires the optional ai-service onnx dependencies "
                "when AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx."
            ) from exc

        tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        model_kwargs: dict[str, object] = {}
        session_options = _onnx_session_options()
        if session_options is not None:
            model_kwargs["session_options"] = session_options
        model = ORTModelForTokenClassification.from_pretrained(self.model_name, **model_kwargs)
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
        return self.classify_many([text])[0]

    def classify_many(self, texts: list[str]) -> list[list[Mapping[str, Any]]]:
        if not texts:
            return []
        tokenizer = self._load_tokenizer()
        encodings = tokenizer.encode_batch(texts)

        try:
            import numpy as np
        except ImportError as exc:
            raise RuntimeError("OpenAI privacy-filter ONNX runtime requires numpy.") from exc

        max_length = max((len(encoding.ids) for encoding in encodings), default=0)
        if max_length == 0:
            return [[] for _ in texts]
        input_ids = np.zeros((len(encodings), max_length), dtype=np.int64)
        attention_mask = np.zeros_like(input_ids, dtype=np.int64)
        for index, encoding in enumerate(encodings):
            length = len(encoding.ids)
            if length == 0:
                continue
            input_ids[index, :length] = np.asarray(encoding.ids, dtype=np.int64)
            attention_mask[index, :length] = 1
        logits = self._load_session().run(
            None,
            {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
            },
        )[0]
        results: list[list[Mapping[str, Any]]] = []
        for index, encoding in enumerate(encodings):
            length = len(encoding.ids)
            if length == 0:
                results.append([])
                continue
            item_logits = logits[index, :length]
            predicted_ids = item_logits.argmax(axis=-1)
            shifted_logits = item_logits - item_logits.max(axis=-1, keepdims=True)
            probabilities = np.exp(shifted_logits)
            probabilities = probabilities / probabilities.sum(axis=-1, keepdims=True)
            token_confidences = probabilities[np.arange(len(predicted_ids)), predicted_ids]
            results.append(
                _decode_openai_privacy_filter_spans(
                    id_to_label=self._id_to_label,
                    predicted_ids=[int(predicted_id) for predicted_id in predicted_ids],
                    confidences=[float(confidence) for confidence in token_confidences],
                    offsets=[tuple(offset) for offset in encoding.offsets],
                )
            )
        return results

    def _load_session(self) -> Any:
        session = self._session
        if session is None:
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError("OpenAI privacy-filter ONNX runtime requires onnxruntime.") from exc
            session_kwargs: dict[str, object] = {
                "providers": ["CPUExecutionProvider"],
            }
            session_options = _onnx_session_options()
            if session_options is not None:
                session_kwargs["sess_options"] = session_options
            session = ort.InferenceSession(
                str(self.model_dir / "onnx" / "model_quantized.onnx"),
                **session_kwargs,
            )
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


class _KoElectraPrivacyNerOnnxClassifier:
    # The supplied dynamic-QInt8 graph accepts a batch axis, but padded multi-item
    # inference changed accepted labels in the 2026-07-16 equivalence probe.
    # Keep item boundaries in one HTTP request while running this adapter one by one.
    max_safe_batch_size = 1

    def __init__(self, model_dir: Path) -> None:
        self.model_dir = model_dir
        self._session: Any | None = None
        self._tokenizer: Any | None = None
        config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
        self._id_to_label = {int(index): str(label) for index, label in config["id2label"].items()}

    def __call__(self, text: str) -> list[Mapping[str, Any]]:
        if text == "":
            return []
        return self.classify_many([text])[0]

    def classify_many(self, texts: list[str]) -> list[list[Mapping[str, Any]]]:
        if not texts:
            return []
        try:
            import numpy as np
        except ImportError as exc:
            raise RuntimeError("KoELECTRA privacy NER ONNX runtime requires numpy.") from exc

        encoded = self._load_tokenizer()(
            texts,
            padding=True,
            truncation=True,
            max_length=512,
            return_offsets_mapping=True,
            return_tensors="np",
        )
        offsets = encoded.pop("offset_mapping")
        session = self._load_session()
        input_names = {item.name for item in session.get_inputs()}
        feed = {
            key: value.astype(np.int64)
            for key, value in encoded.items()
            if key in input_names
        }
        logits = session.run(None, feed)[0]
        results: list[list[Mapping[str, Any]]] = []
        for item_index in range(len(texts)):
            length = int(encoded["attention_mask"][item_index].sum())
            item_logits = logits[item_index, :length]
            predicted_ids = item_logits.argmax(axis=-1)
            shifted_logits = item_logits - item_logits.max(axis=-1, keepdims=True)
            probabilities = np.exp(shifted_logits)
            probabilities = probabilities / probabilities.sum(axis=-1, keepdims=True)
            token_confidences = probabilities[np.arange(len(predicted_ids)), predicted_ids]
            results.append(
                _decode_koelectra_privacy_ner_spans(
                    id_to_label=self._id_to_label,
                    predicted_ids=[int(predicted_id) for predicted_id in predicted_ids],
                    confidences=[float(confidence) for confidence in token_confidences],
                    offsets=[
                        (int(offset[0]), int(offset[1]))
                        for offset in offsets[item_index, :length]
                    ],
                )
            )
        return results

    def _load_session(self) -> Any:
        session = self._session
        if session is None:
            try:
                import onnxruntime as ort
            except ImportError as exc:
                raise RuntimeError("KoELECTRA privacy NER ONNX runtime requires onnxruntime.") from exc
            session_kwargs: dict[str, object] = {"providers": ["CPUExecutionProvider"]}
            session_options = _onnx_session_options()
            if session_options is not None:
                session_kwargs["sess_options"] = session_options
            session = ort.InferenceSession(str(self.model_dir / "model.onnx"), **session_kwargs)
            self._session = session
        return session

    def _load_tokenizer(self) -> Any:
        tokenizer = self._tokenizer
        if tokenizer is None:
            try:
                from transformers import AutoTokenizer
            except ImportError as exc:
                raise RuntimeError("KoELECTRA privacy NER ONNX runtime requires transformers.") from exc
            tokenizer = AutoTokenizer.from_pretrained(
                self.model_dir,
                local_files_only=True,
                use_fast=True,
            )
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


def _decode_koelectra_privacy_ner_spans(
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
        label = id_to_label.get(predicted_id, "O").strip()
        if label.upper() == "O" or start < 0 or end <= start:
            flush()
            continue

        marker, entity_type = _split_koelectra_bioes_label(label)
        if entity_type == "":
            flush()
            continue
        if marker == "S":
            flush()
            current_type = entity_type
            current_start = start
            current_end = end
            current_scores = [confidence]
            flush()
            continue

        can_continue = (
            marker in {"I", "E"}
            and current_type == entity_type
            and current_start is not None
            and current_end is not None
            and start >= current_start
        )
        if marker == "B" or not can_continue:
            flush()
            current_type = entity_type
            current_start = start
            current_end = end
            current_scores = [confidence]
        else:
            current_end = max(current_end, end)
            current_scores.append(confidence)

        if marker == "E":
            flush()

    flush()
    return items


def _split_bioes_label(label: str) -> tuple[str, str]:
    if len(label) > 2 and label[1] == "-" and label[0].upper() in {"B", "I", "E", "S", "U"}:
        marker = label[0].upper()
        return ("S" if marker == "U" else marker), label[2:]
    return "S", label


def _split_koelectra_bioes_label(label: str) -> tuple[str, str]:
    marker, entity_type = _split_bioes_label(label)
    if marker != "S" or entity_type != label:
        return marker, entity_type
    if len(label) > 2 and label[-2] == "-" and label[-1].upper() in {"B", "I", "E", "S", "U"}:
        marker = label[-1].upper()
        return ("S" if marker == "U" else marker), label[:-2]
    return marker, entity_type


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
    if _is_gatelm_koelectra_pii_ner_model(model_name):
        return GATELM_KOELECTRA_PII_NER_LABEL_MAP
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
    if _is_gatelm_koelectra_pii_ner_model(model_name):
        return GATELM_KOELECTRA_PII_NER_SOURCE
    if _is_koelectra_privacy_ner_model(model_name):
        return KOELECTRA_PRIVACY_NER_SOURCE
    return "huggingface_token_classifier"


def aggregation_strategy_for_model(model_name: str) -> str:
    if _is_koelectra_privacy_ner_model(model_name) or _is_gatelm_koelectra_pii_ner_model(
        model_name
    ):
        return "none"
    return "simple"


def public_model_id_for_model(model_name: str) -> str:
    if _is_default_privacy_filter_model(model_name):
        return DEFAULT_PRIVACY_FILTER_MODEL
    if _is_gatelm_koelectra_pii_ner_model(model_name):
        return GATELM_KOELECTRA_PII_NER_MODEL
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
    normalized_model_name = model_name.replace("\\", "/").rstrip("/")
    if normalized_model_name == DEFAULT_PRIVACY_FILTER_MODEL:
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


def _local_koelectra_privacy_ner_onnx_dir(model_name: str) -> Path | None:
    candidates = [Path(model_name)]
    normalized_model_name = model_name.replace("\\", "/").rstrip("/")
    if normalized_model_name == KOELECTRA_PRIVACY_NER_MODEL:
        candidates.extend(
            [
                Path(".cache") / "onnx" / KOELECTRA_PRIVACY_NER_QUANTIZED_LOCAL_DIR_NAME,
                Path("apps")
                / "ai-service"
                / ".cache"
                / "onnx"
                / KOELECTRA_PRIVACY_NER_QUANTIZED_LOCAL_DIR_NAME,
            ]
        )
    elif normalized_model_name == GATELM_KOELECTRA_PII_NER_MODEL:
        candidates.extend(
            [
                Path(".cache")
                / "onnx"
                / GATELM_KOELECTRA_PII_NER_QUANTIZED_LOCAL_DIR_NAME,
                Path("apps")
                / "ai-service"
                / ".cache"
                / "onnx"
                / GATELM_KOELECTRA_PII_NER_QUANTIZED_LOCAL_DIR_NAME,
            ]
        )
    for candidate in candidates:
        if (
            (candidate / "config.json").is_file()
            and (candidate / "tokenizer.json").is_file()
            and (candidate / "model.onnx").is_file()
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


def _is_gatelm_koelectra_pii_ner_model(model_name: str) -> bool:
    normalized = model_name.replace("\\", "/").rstrip("/")
    return (
        normalized == GATELM_KOELECTRA_PII_NER_MODEL
        or normalized.endswith(f"/{GATELM_KOELECTRA_PII_NER_LOCAL_DIR_NAME}")
        or normalized.endswith(
            f"/{GATELM_KOELECTRA_PII_NER_QUANTIZED_LOCAL_DIR_NAME}"
        )
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


def _onnx_session_options() -> Any | None:
    intra_op_threads = _positive_env_int(ONNX_INTRA_OP_THREADS_ENV)
    inter_op_threads = _positive_env_int(ONNX_INTER_OP_THREADS_ENV)
    allow_spinning = _optional_env_bool(ONNX_ALLOW_SPINNING_ENV)
    if intra_op_threads is None and inter_op_threads is None and allow_spinning is None:
        return None

    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError("ONNX session tuning requires onnxruntime.") from exc

    options = ort.SessionOptions()
    if intra_op_threads is not None:
        options.intra_op_num_threads = intra_op_threads
    if inter_op_threads is not None:
        options.inter_op_num_threads = inter_op_threads
    if allow_spinning is not None:
        spinning = "1" if allow_spinning else "0"
        options.add_session_config_entry("session.intra_op.allow_spinning", spinning)
        options.add_session_config_entry("session.inter_op.allow_spinning", spinning)
    return options


def _positive_env_int(key: str) -> int | None:
    value = os.environ.get(key, "").strip()
    if value == "":
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    if parsed < 1 or parsed > 256:
        return None
    return parsed


def _optional_env_bool(key: str) -> bool | None:
    value = os.environ.get(key, "").strip().lower()
    if value == "":
        return None
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return None


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
