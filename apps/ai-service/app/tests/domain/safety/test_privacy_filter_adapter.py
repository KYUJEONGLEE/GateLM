from __future__ import annotations

import threading
import time
import sys
import tempfile
import types
import unittest
from unittest import mock
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.adapters.safety.heuristic_evaluator import HeuristicSafetyEvaluator
from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_MODEL,
    GATELM_KOELECTRA_PII_NER_SOURCE,
    DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME,
    KOELECTRA_PRIVACY_NER_MODEL,
    KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME,
    KOELECTRA_PRIVACY_NER_SOURCE,
    PrivacyFilterAdapter,
    _OpenAIPrivacyFilterOnnxClassifier,
    _decode_koelectra_privacy_ner_spans,
    _decode_openai_privacy_filter_spans,
    aggregation_strategy_for_model,
    normalize_label,
    public_model_id_for_model,
    runtime_for_value,
    source_for_model,
)
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput, SafetyDetector


class FakeBatchClassifier:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, text: str) -> list[object]:
        return self.classify_many([text])[0]

    def classify_many(self, texts: list[str]) -> list[list[object]]:
        self.calls += 1
        results: list[list[object]] = []
        for text in texts:
            marker = "alpha-value" if "alpha-value" in text else "beta-value"
            start = text.index(marker)
            results.append(
                [
                    {
                        "entity_group": "private_url",
                        "score": 0.99,
                        "start": start,
                        "end": start + len(marker),
                    }
                ]
            )
        return results


class MalformedBatchClassifier:
    def __call__(self, _text: str) -> list[object]:
        return []

    def classify_many(self, _texts: list[str]) -> list[list[object]]:
        return []


class MalformedSingleClassifier:
    def __call__(self, _text: str) -> object:
        return {"entity_group": "private_email"}


class SequentialOnlyBatchClassifier(FakeBatchClassifier):
    max_safe_batch_size = 1

    def __init__(self) -> None:
        super().__init__()
        self.batch_sizes: list[int] = []

    def classify_many(self, texts: list[str]) -> list[list[object]]:
        self.batch_sizes.append(len(texts))
        return super().classify_many(texts)


class PrivacyFilterAdapterTests(unittest.TestCase):
    def test_adapter_reports_model_supported_detector_types(self) -> None:
        openai_adapter = PrivacyFilterAdapter(classifier=lambda _text: [])
        koelectra_adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [],
            model_name=KOELECTRA_PRIVACY_NER_MODEL,
        )

        self.assertIn("private_url", openai_adapter.supported_detector_types)
        self.assertNotIn("person_name", openai_adapter.supported_detector_types)
        self.assertIn("resident_registration_number", koelectra_adapter.supported_detector_types)
        self.assertNotIn("organization_name", koelectra_adapter.supported_detector_types)

    def test_gatelm_koelectra_model_has_separate_identity_and_six_type_contract(self) -> None:
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [],
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
        )

        self.assertEqual(adapter.source, GATELM_KOELECTRA_PII_NER_SOURCE)
        self.assertEqual(
            public_model_id_for_model(adapter.model_name),
            GATELM_KOELECTRA_PII_NER_MODEL,
        )
        self.assertEqual(
            adapter.supported_detector_types,
            {
                "email",
                "organization_name",
                "person_name",
                "phone_number",
                "postal_address",
                "resident_registration_number",
            },
        )

    def test_gatelm_koelectra_rejects_single_korean_syllable_person_fragment(self) -> None:
        prompt = "\ub108\uc758\uc774\ub984\uc740?"
        fragment_start = prompt.index("\ub984")
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "PER",
                    "score": 0.99,
                    "start": fragment_start,
                    "end": fragment_start + 1,
                }
            ],
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
            allowed_detector_types=frozenset({"person_name"}),
        )

        self.assertEqual(adapter.detect(prompt), [])
        self.assertEqual(adapter.detect_many([prompt]).detections, [[]])

    def test_gatelm_koelectra_keeps_complete_korean_person_name(self) -> None:
        person_name = "\uae40\ubbfc\uc218"
        prompt = f"\uace0\uac1d {person_name}\uc5d0\uac8c \uc548\ub0b4\ud574 \uc8fc\uc138\uc694."
        person_start = prompt.index(person_name)
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "PER",
                    "score": 0.99,
                    "start": person_start,
                    "end": person_start + len(person_name),
                }
            ],
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
            allowed_detector_types=frozenset({"person_name"}),
        )

        detections = adapter.detect(prompt)

        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].detector_type, "person_name")
        self.assertEqual(
            detections[0].length,
            len(person_name),
        )

    def test_gatelm_koelectra_merges_adjacent_short_fragment_into_address(self) -> None:
        prefix = "서울특별시 강남구"
        address = "테헤란로 123"
        prompt = f"배송지는 {prefix}{address}입니다."
        prefix_start = prompt.index(prefix)
        address_start = prompt.index(address)
        raw_items = [
            {
                "entity_group": "ORG",
                "score": 0.99,
                "start": prefix_start,
                "end": address_start,
            },
            {
                "entity_group": "ADDR",
                "score": 0.99,
                "start": address_start,
                "end": address_start + len(address),
            },
        ]
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: raw_items,
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
        )

        detections = adapter.detect(prompt)
        batch_detections = adapter.detect_many([prompt]).detections[0]

        for result in (detections, batch_detections):
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0].detector_type, "postal_address")
            self.assertEqual(result[0].start, prefix_start)
            self.assertEqual(result[0].end, address_start + len(address))

    def test_gatelm_koelectra_expands_immediate_admin_suffix_address(self) -> None:
        prefix = "서울특별시 강남구"
        address = "테헤란로 123"
        prompt = f"주소는 {prefix} {address}입니다."
        prefix_start = prompt.index(prefix)
        address_start = prompt.index(address)
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "ADDR",
                    "score": 0.99,
                    "start": address_start,
                    "end": address_start + len(address),
                }
            ],
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
        )

        detections = adapter.detect(prompt)

        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].start, prefix_start)
        self.assertEqual(detections[0].end, address_start + len(address))

    def test_gatelm_koelectra_does_not_merge_organization_suffix(self) -> None:
        organization = "한빛대학교"
        address = "서울특별시 강남구 테헤란로 123"
        prompt = f"방문지는 {organization}{address}입니다."
        organization_start = prompt.index(organization)
        address_start = prompt.index(address)
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "ORG",
                    "score": 0.99,
                    "start": organization_start,
                    "end": address_start,
                },
                {
                    "entity_group": "ADDR",
                    "score": 0.99,
                    "start": address_start,
                    "end": address_start + len(address),
                },
            ],
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
        )

        detections = adapter.detect(prompt)

        self.assertEqual(
            [(item.detector_type, item.start) for item in detections],
            [
                ("organization_name", organization_start),
                ("postal_address", address_start),
            ],
        )

    def test_gatelm_koelectra_does_not_merge_punctuation_gap(self) -> None:
        organization = "고객센터"
        address = "서울특별시 강남구 테헤란로 123"
        prompt = f"문의처는 {organization}, {address}입니다."
        organization_start = prompt.index(organization)
        address_start = prompt.index(address)
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "ORG",
                    "score": 0.99,
                    "start": organization_start,
                    "end": organization_start + len(organization),
                },
                {
                    "entity_group": "ADDR",
                    "score": 0.99,
                    "start": address_start,
                    "end": address_start + len(address),
                },
            ],
            model_name=GATELM_KOELECTRA_PII_NER_MODEL,
        )

        detections = adapter.detect(prompt)

        self.assertEqual(
            [(item.detector_type, item.start) for item in detections],
            [
                ("organization_name", organization_start),
                ("postal_address", address_start),
            ],
        )

    def test_adapter_dynamic_batch_preserves_input_order_and_counts_one_invocation(self) -> None:
        classifier = FakeBatchClassifier()
        adapter = PrivacyFilterAdapter(classifier=classifier)
        texts = ["Review private URL alpha-value.", "Review private URL beta-value."]

        result = adapter.detect_many(texts, batch_size=4)

        self.assertEqual(classifier.calls, 1)
        self.assertEqual(result.model_invocation_count, 1)
        self.assertEqual(len(result.detections), 2)
        self.assertEqual(
            [detections[0].detector_type for detections in result.detections],
            ["private_url", "private_url"],
        )

    def test_adapter_rejects_malformed_batch_output(self) -> None:
        adapter = PrivacyFilterAdapter(classifier=MalformedBatchClassifier())

        with self.assertRaisesRegex(RuntimeError, "batch output is invalid"):
            adapter.detect_many(["Review private URL alpha-value."], batch_size=4)

    def test_adapter_rejects_malformed_single_output(self) -> None:
        adapter = PrivacyFilterAdapter(classifier=MalformedSingleClassifier())

        with self.assertRaisesRegex(RuntimeError, "output is invalid"):
            adapter.detect("Review synthetic input.")

    def test_adapter_respects_model_specific_safe_batch_limit(self) -> None:
        classifier = SequentialOnlyBatchClassifier()
        adapter = PrivacyFilterAdapter(classifier=classifier)

        result = adapter.detect_many(
            ["Review private URL alpha-value.", "Review private URL beta-value."],
            batch_size=4,
        )

        self.assertEqual(classifier.batch_sizes, [1, 1])
        self.assertEqual(result.model_invocation_count, 2)

    def test_adapter_normalizes_pipeline_labels_without_storing_word(self) -> None:
        raw_email = "alex@example.test"
        prompt = f"Contact {raw_email} for the synthetic demo."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "private_email",
                    "score": 0.91,
                    "start": prompt.index(raw_email),
                    "end": prompt.index(raw_email) + len(raw_email),
                    "word": raw_email,
                }
            ]
        )

        detections = adapter.detect(prompt)

        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].detector_type, "email")
        self.assertEqual(detections[0].source, "openai_privacy_filter")
        self.assertEqual(detections[0].confidence, 0.91)
        self.assertFalse(hasattr(detections[0], "word"))
        self.assertFalse(hasattr(detections[0], "raw_value"))
        self.assertNotIn(raw_email, repr(detections[0]))

    def test_adapter_filters_low_confidence_and_unknown_labels(self) -> None:
        prompt = "Contact Alex Kim for the synthetic demo."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "private_person",
                    "score": 0.69,
                    "start": 8,
                    "end": 16,
                    "word": "Alex Kim",
                },
                {
                    "entity_group": "unsupported_custom_label",
                    "score": 0.99,
                    "start": 20,
                    "end": 29,
                    "word": "Acme Demo",
                },
            ]
        )

        self.assertEqual(adapter.detect(prompt), [])

    def test_openai_adapter_rejects_unsupported_and_person_model_labels(self) -> None:
        organization_name = "Acme Synthetic"
        person_name = "Alex Kim"
        prompt = f"Review {organization_name} for the synthetic demo."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "ORG",
                    "score": 0.99,
                    "start": prompt.index(organization_name),
                    "end": prompt.index(organization_name) + len(organization_name),
                },
                {
                    "entity_group": "private_person",
                    "score": 0.99,
                    "start": 0,
                    "end": len(person_name),
                }
            ],
            model_name="openai/privacy-filter",
        )

        self.assertEqual(adapter.detect(prompt), [])

    def test_koelectra_adapter_rejects_unverified_org_model_label(self) -> None:
        organization_name = "Acme Synthetic"
        prompt = f"Review {organization_name} for the synthetic demo."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "ORG",
                    "score": 0.91,
                    "start": prompt.index(organization_name),
                    "end": prompt.index(organization_name) + len(organization_name),
                }
            ],
            model_name=KOELECTRA_PRIVACY_NER_MODEL,
        )

        self.assertEqual(adapter.detect(prompt), [])

    def test_koelectra_adapter_accepts_verified_identity_model_labels(self) -> None:
        marker = "900101-1234567"
        prompt = f"Validate resident registration number {marker}."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "RRN-B",
                    "score": 0.91,
                    "start": prompt.index(marker),
                    "end": prompt.index(marker) + len(marker),
                }
            ],
            model_name=KOELECTRA_PRIVACY_NER_MODEL,
        )

        detections = adapter.detect(prompt)

        self.assertEqual(
            [detection.detector_type for detection in detections],
            ["resident_registration_number"],
        )

    def test_adapter_uses_type_specific_confidence_thresholds(self) -> None:
        account_marker = "SYNTHETIC_ACCOUNT_0001"
        person_marker = "Alex Kim"
        prompt = f"Check {account_marker} and notify {person_marker}."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "account_number",
                    "score": 0.55,
                    "start": prompt.index(account_marker),
                    "end": prompt.index(account_marker) + len(account_marker),
                },
                {
                    "entity_group": "private_person",
                    "score": 0.80,
                    "start": prompt.index(person_marker),
                    "end": prompt.index(person_marker) + len(person_marker),
                },
            ]
        )

        detections = adapter.detect(prompt)

        self.assertEqual([detection.detector_type for detection in detections], ["account_number"])

    def test_adapter_can_feed_shadow_evaluator(self) -> None:
        raw_email = "alex@example.test"
        prompt = f"Draft a support reply for {raw_email}."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "private_email",
                    "score": 0.94,
                    "start": prompt.index(raw_email),
                    "end": prompt.index(raw_email) + len(raw_email),
                    "word": raw_email,
                }
            ]
        )
        evaluator = HeuristicSafetyEvaluator(detectors=[], detection_adapters=[adapter])

        decision = evaluator.evaluate(
            remote_context(),
            remote_input(prompt, [detector("email", "redact", "[EMAIL_REDACTED]")]),
        )

        self.assertEqual(decision.action, "redacted")
        self.assertEqual(decision.detected_types, ("email",))
        self.assertEqual(decision.detected_count, 1)
        self.assertIn("[EMAIL_1]", decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_email, decision.redacted_prompt_preview or "")

    def test_label_normalization_strips_bio_prefix(self) -> None:
        self.assertEqual(normalize_label("B-PER"), "person_name")
        self.assertEqual(normalize_label("I-private_phone"), "phone_number")
        self.assertEqual(normalize_label("private_date"), "private_date")
        self.assertEqual(normalize_label("private_url"), "private_url")
        self.assertEqual(normalize_label("secret"), "secret")
        self.assertEqual(normalize_label("account_number"), "account_number")
        self.assertEqual(normalize_label("ORG"), "organization_name")

    def test_label_normalization_supports_koelectra_privacy_ner_suffix_labels(self) -> None:
        self.assertEqual(normalize_label("PER-B"), "person_name")
        self.assertEqual(normalize_label("LOC-I"), "postal_address")
        self.assertEqual(normalize_label("RRN-B"), "resident_registration_number")
        self.assertEqual(normalize_label("EMA-I"), "email")
        self.assertEqual(normalize_label("ID-B"), "account_id")
        self.assertEqual(normalize_label("PWD-I"), "password_assignment")
        self.assertEqual(normalize_label("PHN-B"), "phone_number")
        self.assertEqual(normalize_label("CRD-I"), "credit_card")
        self.assertEqual(normalize_label("ACC-B"), "account_number")
        self.assertEqual(normalize_label("PSP-I"), "passport_number")
        self.assertEqual(normalize_label("DLN-B"), "driver_license")
        self.assertEqual(normalize_label("ORG-B"), "organization_name")

    def test_source_for_model_identifies_koelectra_privacy_ner(self) -> None:
        self.assertEqual(source_for_model(KOELECTRA_PRIVACY_NER_MODEL), KOELECTRA_PRIVACY_NER_SOURCE)
        self.assertEqual(
            source_for_model(f"C:/models/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}"),
            KOELECTRA_PRIVACY_NER_SOURCE,
        )
        self.assertEqual(source_for_model("custom/example-token-classifier"), "huggingface_token_classifier")

    def test_quantized_koelectra_onnx_path_keeps_public_detector_identity(self) -> None:
        local_path = f"C:/models/onnx/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}-quantized"

        self.assertEqual(source_for_model(local_path), KOELECTRA_PRIVACY_NER_SOURCE)
        self.assertEqual(public_model_id_for_model(local_path), KOELECTRA_PRIVACY_NER_MODEL)
        self.assertEqual(aggregation_strategy_for_model(local_path), "none")

    def test_local_openai_privacy_filter_keeps_public_model_identity(self) -> None:
        local_path = "C:/models/openai--privacy-filter"

        self.assertEqual(source_for_model(local_path), "openai_privacy_filter")
        self.assertEqual(public_model_id_for_model(local_path), "openai/privacy-filter")

    def test_aggregation_strategy_preserves_koelectra_suffix_labels(self) -> None:
        self.assertEqual(aggregation_strategy_for_model(KOELECTRA_PRIVACY_NER_MODEL), "none")
        self.assertEqual(
            aggregation_strategy_for_model(f"C:/models/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}"),
            "none",
        )
        self.assertEqual(aggregation_strategy_for_model("openai/privacy-filter"), "simple")

    def test_adapter_lazy_loads_classifier_once_across_threads(self) -> None:
        load_count = 0
        load_count_lock = threading.Lock()

        class LazyAdapter(PrivacyFilterAdapter):
            def _load_classifier(self) -> Callable[[str], object]:
                nonlocal load_count
                with load_count_lock:
                    load_count += 1
                time.sleep(0.01)
                return lambda _text: []

        adapter = LazyAdapter()

        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(adapter.detect, ["safe prompt"] * 8))

        self.assertEqual(load_count, 1)

    def test_adapter_loads_onnx_token_classification_pipeline_when_runtime_is_onnx(self) -> None:
        calls: dict[str, object] = {}

        class FakeORTModelForTokenClassification:
            @classmethod
            def from_pretrained(cls, model_name: str) -> object:
                calls["model_name"] = model_name
                return "fake_onnx_model"

        class FakeAutoTokenizer:
            @classmethod
            def from_pretrained(cls, model_name: str) -> object:
                calls["tokenizer_name"] = model_name
                return "fake_tokenizer"

        def fake_pipeline(**kwargs: object) -> Callable[[str], object]:
            calls["pipeline_kwargs"] = kwargs
            return lambda _text: []

        optimum_module = types.ModuleType("optimum")
        onnxruntime_module = types.ModuleType("optimum.onnxruntime")
        onnxruntime_module.ORTModelForTokenClassification = FakeORTModelForTokenClassification
        transformers_module = types.ModuleType("transformers")
        transformers_module.AutoTokenizer = FakeAutoTokenizer
        transformers_module.pipeline = fake_pipeline

        with mock.patch.dict(
            sys.modules,
            {
                "optimum": optimum_module,
                "optimum.onnxruntime": onnxruntime_module,
                "transformers": transformers_module,
            },
        ):
            adapter = PrivacyFilterAdapter(
                model_name="C:/models/onnx-openai--privacy-filter",
                runtime="onnx",
            )
            classifier = adapter._load_classifier()

        self.assertEqual(calls["model_name"], "C:/models/onnx-openai--privacy-filter")
        self.assertEqual(calls["tokenizer_name"], "C:/models/onnx-openai--privacy-filter")
        self.assertIsNotNone(classifier)
        self.assertEqual(
            calls["pipeline_kwargs"],
            {
                "task": "token-classification",
                "model": "fake_onnx_model",
                "tokenizer": "fake_tokenizer",
                "aggregation_strategy": "simple",
            },
        )

    def test_adapter_uses_direct_openai_privacy_filter_onnx_classifier_for_local_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "openai--privacy-filter"
            (model_dir / "onnx").mkdir(parents=True)
            (model_dir / "config.json").write_text('{"id2label": {"0": "O"}}', encoding="utf-8")
            (model_dir / "tokenizer.json").write_text("{}", encoding="utf-8")
            (model_dir / "onnx" / "model_quantized.onnx").write_bytes(b"")

            with mock.patch(
                "app.adapters.safety.privacy_filter_adapter._OpenAIPrivacyFilterOnnxClassifier",
                return_value="fake_openai_onnx_classifier",
            ) as classifier_cls:
                adapter = PrivacyFilterAdapter(model_name=str(model_dir), runtime="onnx")
                classifier = adapter._load_classifier()

        self.assertEqual(classifier, "fake_openai_onnx_classifier")
        classifier_cls.assert_called_once_with(model_dir)

    def test_openai_privacy_filter_onnx_decoder_merges_bioes_spans(self) -> None:
        decoded = _decode_openai_privacy_filter_spans(
            id_to_label={
                0: "O",
                1: "B-private_email",
                2: "I-private_email",
                3: "E-private_email",
                4: "S-secret",
            },
            predicted_ids=[0, 1, 2, 3, 0, 4],
            confidences=[1.0, 0.9, 0.8, 0.7, 1.0, 0.6],
            offsets=[(0, 4), (5, 10), (10, 15), (15, 20), (20, 21), (22, 28)],
        )

        self.assertEqual(len(decoded), 2)
        self.assertEqual(decoded[0]["entity_group"], "private_email")
        self.assertEqual(decoded[0]["start"], 5)
        self.assertEqual(decoded[0]["end"], 20)
        self.assertAlmostEqual(float(decoded[0]["score"]), 0.8)
        self.assertEqual(decoded[1], {"entity_group": "secret", "score": 0.6, "start": 22, "end": 28})

    def test_openai_privacy_filter_onnx_decoder_treats_unit_prefix_as_single_span(self) -> None:
        decoded = _decode_openai_privacy_filter_spans(
            id_to_label={
                0: "U-secret",
                1: "B-private_email",
                2: "E-private_email",
            },
            predicted_ids=[0, 1, 2],
            confidences=[0.95, 0.9, 0.8],
            offsets=[(0, 6), (7, 12), (12, 17)],
        )

        self.assertEqual(len(decoded), 2)
        self.assertEqual(decoded[0], {"entity_group": "secret", "score": 0.95, "start": 0, "end": 6})
        self.assertEqual(decoded[1]["entity_group"], "private_email")
        self.assertAlmostEqual(float(decoded[1]["score"]), 0.85)
        self.assertEqual(decoded[1]["start"], 7)
        self.assertEqual(decoded[1]["end"], 17)

    def test_koelectra_onnx_decoder_merges_wordpiece_offsets_into_one_span(self) -> None:
        decoded = _decode_koelectra_privacy_ner_spans(
            id_to_label={1: "EMA-B", 2: "EMA-I"},
            predicted_ids=[1, 2, 2, 2],
            confidences=[0.96, 0.92, 0.88, 0.84],
            offsets=[(8, 12), (12, 13), (13, 20), (20, 25)],
        )

        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0]["entity_group"], "EMA")
        self.assertEqual(decoded[0]["start"], 8)
        self.assertEqual(decoded[0]["end"], 25)
        self.assertAlmostEqual(float(decoded[0]["score"]), 0.9)

    def test_koelectra_onnx_decoder_merges_resident_number_suffix_bio_span(self) -> None:
        decoded = _decode_koelectra_privacy_ner_spans(
            id_to_label={1: "RRN-B", 2: "RRN-I"},
            predicted_ids=[1, 2, 2],
            confidences=[0.94, 0.9, 0.86],
            offsets=[(4, 10), (10, 11), (11, 18)],
        )

        self.assertEqual(
            decoded,
            [{"entity_group": "RRN", "score": 0.9, "start": 4, "end": 18}],
        )

    def test_koelectra_onnx_decoder_recovers_from_leading_inside_and_end_tokens(self) -> None:
        decoded = _decode_koelectra_privacy_ner_spans(
            id_to_label={1: "EMA-I", 2: "EMA-E", 3: "PHN-E"},
            predicted_ids=[1, 1, 2, 3],
            confidences=[0.9, 0.8, 0.7, 0.95],
            offsets=[(0, 4), (4, 8), (8, 12), (14, 18)],
        )

        self.assertEqual(len(decoded), 2)
        self.assertEqual(decoded[0]["entity_group"], "EMA")
        self.assertEqual(decoded[0]["start"], 0)
        self.assertEqual(decoded[0]["end"], 12)
        self.assertEqual(decoded[1], {"entity_group": "PHN", "score": 0.95, "start": 14, "end": 18})

    def test_koelectra_onnx_decoder_treats_single_and_unit_tokens_as_spans(self) -> None:
        decoded = _decode_koelectra_privacy_ner_spans(
            id_to_label={1: "S-EMA", 2: "PHN-U"},
            predicted_ids=[1, 2],
            confidences=[0.91, 0.87],
            offsets=[(0, 5), (6, 10)],
        )

        self.assertEqual(
            decoded,
            [
                {"entity_group": "EMA", "score": 0.91, "start": 0, "end": 5},
                {"entity_group": "PHN", "score": 0.87, "start": 6, "end": 10},
            ],
        )

    def test_koelectra_onnx_decoder_splits_when_entity_type_changes(self) -> None:
        decoded = _decode_koelectra_privacy_ner_spans(
            id_to_label={1: "EMA-B", 2: "EMA-I", 3: "PHN-I", 4: "PHN-E"},
            predicted_ids=[1, 2, 3, 4],
            confidences=[0.9, 0.8, 0.95, 0.85],
            offsets=[(0, 4), (4, 8), (9, 12), (12, 16)],
        )

        self.assertEqual(len(decoded), 2)
        self.assertEqual(decoded[0]["entity_group"], "EMA")
        self.assertEqual(decoded[0]["start"], 0)
        self.assertEqual(decoded[0]["end"], 8)
        self.assertEqual(decoded[1]["entity_group"], "PHN")
        self.assertEqual(decoded[1]["start"], 9)
        self.assertEqual(decoded[1]["end"], 16)

    def test_koelectra_onnx_decoder_ignores_special_offsets_without_bridging_spans(self) -> None:
        decoded = _decode_koelectra_privacy_ner_spans(
            id_to_label={1: "EMA-B", 2: "EMA-I"},
            predicted_ids=[1, 2, 2, 2],
            confidences=[0.99, 0.9, 0.99, 0.8],
            offsets=[(0, 0), (0, 4), (0, 0), (4, 8)],
        )

        self.assertEqual(
            decoded,
            [
                {"entity_group": "EMA", "score": 0.9, "start": 0, "end": 4},
                {"entity_group": "EMA", "score": 0.8, "start": 4, "end": 8},
            ],
        )

    def test_openai_privacy_filter_onnx_session_uses_cpu_execution_provider(self) -> None:
        captured: dict[str, object] = {}

        class FakeOnnxRuntime(types.SimpleNamespace):
            @staticmethod
            def InferenceSession(model_path: str, **kwargs: object) -> object:
                captured["model_path"] = model_path
                captured["kwargs"] = kwargs
                return object()

        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "openai--privacy-filter"
            (model_dir / "onnx").mkdir(parents=True)
            (model_dir / "config.json").write_text('{"id2label": {"0": "O"}}', encoding="utf-8")
            (model_dir / "onnx" / "model_quantized.onnx").write_bytes(b"")

            with mock.patch.dict(sys.modules, {"onnxruntime": FakeOnnxRuntime()}):
                classifier = _OpenAIPrivacyFilterOnnxClassifier(model_dir)
                session = classifier._load_session()

        self.assertIsNotNone(session)
        self.assertEqual(captured["model_path"], str(model_dir / "onnx" / "model_quantized.onnx"))
        self.assertEqual(captured["kwargs"], {"providers": ["CPUExecutionProvider"]})

    def test_runtime_for_value_defaults_to_onnx_for_unknown_values(self) -> None:
        self.assertEqual(runtime_for_value("onnx"), "onnx")
        self.assertEqual(runtime_for_value("TRANSFORMERS"), "transformers")
        self.assertEqual(runtime_for_value("bad-runtime"), "onnx")

    def test_adapter_derives_source_from_local_onnx_model_path(self) -> None:
        adapter = PrivacyFilterAdapter(
            model_name=f"C:/models/onnx/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}",
            runtime="onnx",
        )

        self.assertEqual(adapter.source, KOELECTRA_PRIVACY_NER_SOURCE)

    def test_onnx_runtime_requires_onnx_dependencies(self) -> None:
        local_dir_names = [
            DEFAULT_PRIVACY_FILTER_LOCAL_DIR_NAME,
            KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME,
        ]
        for local_dir_name in local_dir_names:
            with self.subTest(local_dir_name=local_dir_name):
                with mock.patch.dict(sys.modules, {"optimum.onnxruntime": None}):
                    adapter = PrivacyFilterAdapter(
                        model_name=f"C:/models/onnx/{local_dir_name}",
                        runtime="onnx",
                    )

                    with self.assertRaisesRegex(RuntimeError, "onnx dependencies"):
                        adapter._load_classifier()


def remote_context() -> RemoteSafetyContext:
    return RemoteSafetyContext(
        requestId="request_privacy_filter_adapter_test",
        traceId="trace_privacy_filter_adapter_test",
        tenantId="tenant_demo",
        projectId="project_demo",
        applicationId="app_demo",
        configHash="hash_runtime_config_v1_demo",
        securityPolicyHash="hash_security_policy_v1_demo",
        routingPolicyHash="hash_routing_policy_v1_demo",
        policyMode="rule_based",
        remoteSafetyMode="shadow",
    )


def remote_input(prompt_text: str, detectors: list[SafetyDetector]) -> RemoteSafetyInput:
    return RemoteSafetyInput(
        promptText=prompt_text,
        requestBodyHash="hash_request_body_v1_demo",
        requestedModel="auto",
        detectors=detectors,
    )


def detector(detector_type: str, action: str, placeholder: str) -> SafetyDetector:
    return SafetyDetector(
        type=detector_type,
        enabled=True,
        action=action,
        placeholder=placeholder,
    )


if __name__ == "__main__":
    unittest.main()
