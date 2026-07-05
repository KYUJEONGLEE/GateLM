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
    KOELECTRA_PRIVACY_NER_MODEL,
    KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME,
    KOELECTRA_PRIVACY_NER_SOURCE,
    PrivacyFilterAdapter,
    _decode_openai_privacy_filter_spans,
    aggregation_strategy_for_model,
    normalize_label,
    public_model_id_for_model,
    runtime_for_value,
    source_for_model,
)
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput, SafetyDetector


class PrivacyFilterAdapterTests(unittest.TestCase):
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
        with mock.patch.dict(sys.modules, {"optimum.onnxruntime": None}):
            adapter = PrivacyFilterAdapter(
                model_name=f"C:/models/onnx/{KOELECTRA_PRIVACY_NER_LOCAL_DIR_NAME}",
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
