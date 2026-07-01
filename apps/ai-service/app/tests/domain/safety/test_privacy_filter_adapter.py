from __future__ import annotations

import threading
import time
import unittest
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

from app.adapters.safety.heuristic_evaluator import HeuristicSafetyEvaluator
from app.adapters.safety.privacy_filter_adapter import PrivacyFilterAdapter, normalize_label
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
                    "entity_group": "organization_name",
                    "score": 0.99,
                    "start": 20,
                    "end": 29,
                    "word": "Acme Demo",
                },
            ]
        )

        self.assertEqual(adapter.detect(prompt), [])

    def test_adapter_can_feed_shadow_evaluator(self) -> None:
        raw_name = "Alex Kim"
        prompt = f"Draft a support reply for {raw_name}."
        adapter = PrivacyFilterAdapter(
            classifier=lambda _text: [
                {
                    "entity_group": "private_person",
                    "score": 0.94,
                    "start": prompt.index(raw_name),
                    "end": prompt.index(raw_name) + len(raw_name),
                    "word": raw_name,
                }
            ]
        )
        evaluator = HeuristicSafetyEvaluator(detectors=[], detection_adapters=[adapter])

        decision = evaluator.evaluate(
            remote_context(),
            remote_input(prompt, [detector("person_name", "redact", "[PERSON_NAME_REDACTED]")]),
        )

        self.assertEqual(decision.action, "redacted")
        self.assertEqual(decision.detected_types, ("person_name",))
        self.assertEqual(decision.detected_count, 1)
        self.assertIn("[PERSON_NAME_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_name, decision.redacted_prompt_preview or "")

    def test_label_normalization_strips_bio_prefix(self) -> None:
        self.assertEqual(normalize_label("B-PER"), "person_name")
        self.assertEqual(normalize_label("I-private_phone"), "phone_number")
        self.assertEqual(normalize_label("private_date"), "private_date")
        self.assertEqual(normalize_label("private_url"), "private_url")
        self.assertEqual(normalize_label("secret"), "secret")
        self.assertEqual(normalize_label("account_number"), "account_number")
        self.assertIsNone(normalize_label("ORG"))

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
