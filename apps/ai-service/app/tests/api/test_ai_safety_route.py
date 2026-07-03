from __future__ import annotations

import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from fastapi.testclient import TestClient

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.llm_classifier import LocalVllmLLMClassifier
from app.adapters.safety.privacy_filter_adapter import (
    KOELECTRA_PRIVACY_NER_MODEL,
    source_for_model,
)
from app.main import create_app
from app.services.ai_safety_detector import AiSafetyDetectorService


SYNTHETIC_EMAIL = "alex@example.test"
SYNTHETIC_SECRET = "syntheticSecretValue1234567890abcdef"
SYNTHETIC_ACCOUNT_NUMBER = "syntheticAccountNumber123456"


class AiSafetyRouteTests(unittest.TestCase):
    def test_detect_merges_llm_shadow_evidence_without_changing_rule_outcome(self) -> None:
        prompt = "\ubcf8\uc0ac \uc8fc\uc18c\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c 123\uc785\ub2c8\ub2e4."
        with FakeVllmServer(
            {
                "detections": [
                    {
                        "detectorType": "postal_address",
                        "action": "allow",
                        "confidence": 0.78,
                        "reasonCode": "business_address_context",
                    }
                ]
            }
        ) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                    temperature=0,
                    max_tokens=192,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectedCount"], 1)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["postal_address"])
        self.assertEqual(len(body["detections"]), 1)
        self.assertEqual(body["detections"][0]["detectorType"], "postal_address")
        self.assertEqual(body["detections"][0]["source"], "llm_classifier")
        self.assertEqual(body["detections"][0]["action"], "allow")
        self.assertEqual(body["detections"][0]["mode"], "shadow")
        self.assertEqual(body["detections"][0]["confidence"], 0.78)
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(fake_vllm.requests[0]["path"], "/v1/chat/completions")
        self.assertEqual(fake_vllm.requests[0]["body"]["model"], "kakaocorp/kanana-1.5-8b-instruct-2505")
        self.assertEqual(fake_vllm.requests[0]["body"]["temperature"], 0)
        self.assertEqual(fake_vllm.requests[0]["body"]["max_tokens"], 192)

    def test_detect_discards_invalid_llm_classifier_json(self) -> None:
        prompt = "\ubcf8\uc0ac \uc8fc\uc18c\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c 123\uc785\ub2c8\ub2e4."
        with FakeVllmServer({}, raw_content="not json") as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectedCount"], 0)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], [])
        self.assertEqual(body["detections"], [])

    def test_detect_discards_llm_classifier_values_outside_allowed_enums(self) -> None:
        prompt = "\ubcf8\uc0ac \uc8fc\uc18c\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c 123\uc785\ub2c8\ub2e4."
        with FakeVllmServer(
            {
                "detections": [
                    {
                        "detectorType": "raw_customer_sentence",
                        "action": "redact",
                        "confidence": 0.92,
                        "reasonCode": "business_address_context",
                    },
                    {
                        "detectorType": "postal_address",
                        "action": "quarantine",
                        "confidence": 0.91,
                        "reasonCode": "business_address_context",
                    },
                    {
                        "detectorType": "postal_address",
                        "action": "allow",
                        "confidence": 0.90,
                        "reasonCode": "raw_reason_text",
                    },
                ]
            }
        ) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["detectorSummary"]["detectedCount"], 0)
        self.assertEqual(body["detections"], [])

    def test_detect_discards_llm_classifier_unknown_pii(self) -> None:
        prompt = "\ud14c\uc2a4\ud2b8 \uba54\ubaa8\uc5d0 \uc560\ub9e4\ud55c \uac1c\uc778\uc815\ubcf4 \ud45c\ud604\uc774 \uc788\uc2b5\ub2c8\ub2e4."
        with FakeVllmServer(
            {
                "detections": [
                    {
                        "detectorType": "unknown_pii",
                        "action": "redact",
                        "confidence": 0.72,
                        "reasonCode": "personal_list_context",
                    }
                ]
            }
        ) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["detectorSummary"]["detectedCount"], 0)
        self.assertEqual(body["detections"], [])

    def test_detect_discards_llm_classifier_output_with_extra_fields(self) -> None:
        prompt = "\ubcf8\uc0ac \uc8fc\uc18c\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c 123\uc785\ub2c8\ub2e4."
        with FakeVllmServer(
            {
                "detections": [
                    {
                        "detectorType": "postal_address",
                        "action": "allow",
                        "confidence": 0.78,
                        "reasonCode": "business_address_context",
                        "explanation": "public address context",
                    }
                ]
            }
        ) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["detectorSummary"]["detectedCount"], 0)
        self.assertEqual(body["detections"], [])

    def test_detect_discards_llm_classifier_output_with_non_numeric_confidence(self) -> None:
        prompt = "\ubcf8\uc0ac \uc8fc\uc18c\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c 123\uc785\ub2c8\ub2e4."
        with FakeVllmServer(
            {
                "detections": [
                    {
                        "detectorType": "postal_address",
                        "action": "allow",
                        "confidence": "0.78",
                        "reasonCode": "business_address_context",
                    }
                ]
            }
        ) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["detectorSummary"]["detectedCount"], 0)
        self.assertEqual(body["detections"], [])

    def test_detect_skips_llm_classifier_for_deterministic_regex_pii(self) -> None:
        email = "llm-skip@example.test"
        phone = "010-1234-5678"
        prompt = f"Contact {email} or {phone}."
        with FakeVllmServer({"detections": []}) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(fake_vllm.requests, [])
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(body["redactedPrompt"], "Contact [EMAIL_1] or [PHONE_NUMBER_1].")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["email", "phone_number"])
        self.assertNotIn(email, body_text)
        self.assertNotIn(phone, body_text)

    def test_detect_limits_llm_classifier_candidate_windows(self) -> None:
        repeated_segments = [
            f"\ubcf8\uc0ac \uc8fc\uc18c {index}\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c {index}\uc785\ub2c8\ub2e4."
            for index in range(5)
        ]
        prompt = (" \uc77c\ubc18 \uc6b4\uc601 \uba54\ubaa8\ub9cc \ub4e4\uc5b4\uc788\ub294 \uae34 \ubb38\ub2e8. " * 12).join(repeated_segments)
        with FakeVllmServer({"detections": []}) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
                llm_window_max_chars=120,
                llm_window_max_count=3,
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(fake_vllm.requests), 3)
        for request in fake_vllm.requests:
            window = classifier_window_from_request(request["body"])
            self.assertLessEqual(len(window), 120)
            self.assertNotEqual(window, prompt)

    def test_detect_sends_llm_classifier_sentence_boundary_window(self) -> None:
        prefix = "This ordinary release coordination sentence has no safety marker and is intentionally long. "
        candidate_sentence = "The office address candidate is for context review."
        suffix = " This routine follow-up sentence has no safety marker and is intentionally long."
        prompt = f"{prefix}{candidate_sentence}{suffix}"
        with FakeVllmServer({"detections": []}) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
                llm_window_max_chars=80,
                llm_window_max_count=3,
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(fake_vllm.requests), 1)
        window = classifier_window_from_request(fake_vllm.requests[0]["body"])
        self.assertEqual(window, candidate_sentence)
        self.assertLessEqual(len(window), 80)

    def test_detect_prioritizes_high_risk_llm_classifier_windows(self) -> None:
        low_risk_sentences = [
            f"Office address candidate {index} is public context only."
            for index in range(4)
        ]
        high_risk_sentence = "Account number candidate requires risky context review."
        prompt = " ".join([*low_risk_sentences, high_risk_sentence])
        with FakeVllmServer({"detections": []}) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=1000,
                ),
                llm_window_max_chars=90,
                llm_window_max_count=3,
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(fake_vllm.requests), 3)
        windows = [
            classifier_window_from_request(request["body"])
            for request in fake_vllm.requests
        ]
        self.assertIn(high_risk_sentence, windows[0])
        self.assertIn(low_risk_sentences[0], windows[1])
        self.assertIn(low_risk_sentences[1], windows[2])

    def test_detect_keeps_existing_result_when_llm_classifier_times_out(self) -> None:
        prompt = "\ubcf8\uc0ac \uc8fc\uc18c\ub294 \ud14c\uc2a4\ud2b8\uc2dc \ud14c\uc2a4\ud2b8\uad6c \ud14c\uc2a4\ud2b8\ub85c 123\uc785\ub2c8\ub2e4."
        with FakeVllmServer(
            {
                "detections": [
                    {
                        "detectorType": "postal_address",
                        "action": "allow",
                        "confidence": 0.78,
                        "reasonCode": "business_address_context",
                    }
                ]
            },
            delay_seconds=0.08,
        ) as fake_vllm:
            app = create_app()
            app.state.ai_safety_detector_service = service_with_classifier(
                lambda _text: [],
                llm_classifier=LocalVllmLLMClassifier(
                    base_url=fake_vllm.base_url,
                    model="kakaocorp/kanana-1.5-8b-instruct-2505",
                    timeout_ms=5,
                ),
            )
            client = TestClient(app)

            response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(fake_vllm.requests), 1)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectedCount"], 0)
        self.assertEqual(body["detections"], [])

    def test_detect_returns_sanitized_redacted_prompt(self) -> None:
        prompt = f"Contact {SYNTHETIC_EMAIL} for the demo."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "private_email",
                    "score": 0.98,
                    "start": prompt.index(SYNTHETIC_EMAIL),
                    "end": prompt.index(SYNTHETIC_EMAIL) + len(SYNTHETIC_EMAIL),
                    "word": SYNTHETIC_EMAIL,
                }
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["contractVersion"], "ai-safety-detector.v1")
        self.assertEqual(body["model"]["modelId"], "openai/privacy-filter")
        self.assertEqual(body["model"]["runtime"], "cpu_only")
        self.assertEqual(body["mode"], "shadow")
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(body["redactedPrompt"], "Contact [EMAIL_1] for the demo.")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["email"])
        self.assertEqual(body["detections"][0]["detectorType"], "email")
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_marks_privacy_filter_secret_as_shadow_block_candidate(self) -> None:
        prompt = f"Review secret {SYNTHETIC_SECRET}."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "secret",
                    "score": 0.99,
                    "start": prompt.index(SYNTHETIC_SECRET),
                    "end": prompt.index(SYNTHETIC_SECRET) + len(SYNTHETIC_SECRET),
                    "word": SYNTHETIC_SECRET,
                }
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(body["mode"], "shadow")
        self.assertEqual(body["redactedPrompt"], "Review secret [SECRET_REDACTED].")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["secret"])
        self.assertEqual(body["detections"][0]["detectorType"], "secret")
        self.assertEqual(body["detections"][0]["action"], "block")
        self.assertNotIn(SYNTHETIC_SECRET, body_text)

    def test_detect_maps_privacy_filter_account_number_to_account_number(self) -> None:
        prompt = f"Review account number {SYNTHETIC_ACCOUNT_NUMBER}."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "account_number",
                    "score": 0.97,
                    "start": prompt.index(SYNTHETIC_ACCOUNT_NUMBER),
                    "end": prompt.index(SYNTHETIC_ACCOUNT_NUMBER) + len(SYNTHETIC_ACCOUNT_NUMBER),
                    "word": SYNTHETIC_ACCOUNT_NUMBER,
                }
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(body["redactedPrompt"], "Review account number [ACCOUNT_NUMBER_REDACTED].")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["account_number"])
        self.assertEqual(body["detections"][0]["detectorType"], "account_number")
        self.assertEqual(body["detections"][0]["action"], "block")
        self.assertNotIn(SYNTHETIC_ACCOUNT_NUMBER, body_text)

    def test_detect_keeps_public_model_id_for_local_privacy_filter_path(self) -> None:
        prompt = "Write a safe synthetic demo reply."
        local_model_path = ".cache/huggingface/models/openai--privacy-filter"
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [],
            model_name=local_model_path,
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["model"]["modelId"], "openai/privacy-filter")
        self.assertEqual(body["outcome"], "passed")

    def test_detect_runs_default_and_koelectra_detectors_together(self) -> None:
        synthetic_email = "koelectra-sidecar@example.test"
        synthetic_org = "SyntheticOrgToken"
        synthetic_resident_number = "syntheticResidentNumberToken"
        prompt = (
            f"Contact {synthetic_email} for {synthetic_org} and validate resident "
            f"registration number {synthetic_resident_number}."
        )
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifiers(
            (
                "openai/privacy-filter",
                lambda _text: [
                    {
                        "entity_group": "private_email",
                        "score": 0.98,
                        "start": prompt.index(synthetic_email),
                        "end": prompt.index(synthetic_email) + len(synthetic_email),
                        "word": synthetic_email,
                    }
                ],
            ),
            (
                KOELECTRA_PRIVACY_NER_MODEL,
                lambda _text: [
                    {
                        "entity_group": "ORG-B",
                        "score": 0.95,
                        "start": prompt.index(synthetic_org),
                        "end": prompt.index(synthetic_org) + len(synthetic_org),
                        "word": synthetic_org,
                    },
                    {
                        "entity_group": "RRN-B",
                        "score": 0.97,
                        "start": prompt.index(synthetic_resident_number),
                        "end": prompt.index(synthetic_resident_number) + len(synthetic_resident_number),
                        "word": synthetic_resident_number,
                    }
                ],
            ),
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["model"]["modelId"], "openai/privacy-filter")
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(
            body["redactedPrompt"],
            (
                "Contact [EMAIL_1] for [ORGANIZATION_1] "
                "and validate resident registration "
                "number [RESIDENT_REGISTRATION_NUMBER_REDACTED]."
            ),
        )
        self.assertEqual(
            body["detectorSummary"]["detectorCategories"],
            ["email", "organization_name", "resident_registration_number"],
        )
        detection_sources = {detection["source"] for detection in body["detections"]}
        self.assertEqual(detection_sources, {"openai_privacy_filter", "koelectra_privacy_ner"})
        self.assertNotIn(synthetic_email, body_text)
        self.assertNotIn(synthetic_org, body_text)
        self.assertNotIn(synthetic_resident_number, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_returns_role_aware_person_placeholders(self) -> None:
        customer_name = "Alex Kim"
        agent_name = "Jamie Park"
        prompt = f"customer {customer_name} asked agent {agent_name} for help."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(customer_name),
                    "end": prompt.index(customer_name) + len(customer_name),
                    "word": customer_name,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": prompt.index(agent_name),
                    "end": prompt.index(agent_name) + len(agent_name),
                    "word": agent_name,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[CUSTOMER_1] asked [AGENT_1] for help.",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(customer_name, body_text)
        self.assertNotIn(agent_name, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_returns_semantic_person_placeholders_for_recruiting_context(self) -> None:
        applicant_name = "Alex Kim"
        interviewer_name = "Jamie Park"
        prompt = f"applicant {applicant_name} sent resume to interviewer {interviewer_name}."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(applicant_name),
                    "end": prompt.index(applicant_name) + len(applicant_name),
                    "word": applicant_name,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": prompt.index(interviewer_name),
                    "end": prompt.index(interviewer_name) + len(interviewer_name),
                    "word": interviewer_name,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[APPLICANT_1] sent resume to [INTERVIEWER_1].",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(applicant_name, body_text)
        self.assertNotIn(interviewer_name, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_returns_relationship_preserving_role_placeholders(self) -> None:
        owner_name = "\uae40\ubbfc\uc218"
        approver_name = "\uc774\uc724\uc9c0"
        prompt = f"{owner_name}\uc758 \ud300\uc7a5 {approver_name}\uac00 \uc2b9\uc778\ud588\ub2e4."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(owner_name),
                    "end": prompt.index(owner_name) + len(owner_name),
                    "word": owner_name,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": prompt.index(approver_name),
                    "end": prompt.index(approver_name) + len(approver_name),
                    "word": approver_name,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[PERSON_1]\uc758 [ROLE:\ud300\uc7a5] [PERSON_2]\uac00 \uc2b9\uc778\ud588\ub2e4.",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(owner_name, body_text)
        self.assertNotIn(approver_name, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_links_korean_person_aliases(self) -> None:
        full_name = "\uc774\uc724\uc9c0"
        alias = "\uc724\uc9c0"
        prompt = (
            f"{full_name}\ub294 \ud68c\uc758\uc5d0 \ucc38\uc11d\ud588\ub2e4. "
            f"{alias}\ub2d8\uc740 \ubc1c\ud45c\ub97c \ub9e1\uc558\ub2e4."
        )
        alias_start = prompt.index(f"{alias}\ub2d8")
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(full_name),
                    "end": prompt.index(full_name) + len(full_name),
                    "word": full_name,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": alias_start,
                    "end": alias_start + len(alias),
                    "word": alias,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            (
                "[PERSON_1]\ub294 \ud68c\uc758\uc5d0 \ucc38\uc11d\ud588\ub2e4. "
                "[PERSON_1]\ub2d8\uc740 \ubc1c\ud45c\ub97c \ub9e1\uc558\ub2e4."
            ),
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(full_name, body_text)
        self.assertNotIn(f"{alias}\ub2d8", body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_preserves_korean_coreference_for_previous_unique_subject(self) -> None:
        sender_name = "\uc774\uc724\uc9c0"
        recipient_name = "\uae40\ubbfc\uc218"
        prompt = (
            f"{sender_name}\uac00 {recipient_name}\uc5d0\uac8c \uba54\uc77c\uc744 \ubcf4\ub0c8\ub2e4. "
            "\uadf8\ub140\ub294 \ub2f5\uc7a5\uc744 \uae30\ub2e4\ub838\ub2e4."
        )
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(sender_name),
                    "end": prompt.index(sender_name) + len(sender_name),
                    "word": sender_name,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": prompt.index(recipient_name),
                    "end": prompt.index(recipient_name) + len(recipient_name),
                    "word": recipient_name,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            (
                "[PERSON_1]\uac00 [PERSON_2]\uc5d0\uac8c \uba54\uc77c\uc744 \ubcf4\ub0c8\ub2e4. "
                "[PERSON_1]\ub294 \ub2f5\uc7a5\uc744 \uae30\ub2e4\ub838\ub2e4."
            ),
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(sender_name, body_text)
        self.assertNotIn(recipient_name, body_text)
        self.assertNotIn("\uadf8\ub140", body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_preserves_structure_around_overextended_pii_spans(self) -> None:
        name_with_honorific = "\uc774\uc724\uc9c0\ub2d8"
        email_with_copula = "yoonji@example.com\uc785\ub2c8\ub2e4"
        prompt = f"{name_with_honorific}\uc758 \uc774\uba54\uc77c \uc8fc\uc18c\ub294 {email_with_copula}."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(name_with_honorific),
                    "end": prompt.index(name_with_honorific) + len(name_with_honorific),
                    "word": name_with_honorific,
                },
                {
                    "entity_group": "private_email",
                    "score": 0.97,
                    "start": prompt.index(email_with_copula),
                    "end": prompt.index(email_with_copula) + len(email_with_copula),
                    "word": email_with_copula,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[PERSON_1]\ub2d8\uc758 \uc774\uba54\uc77c \uc8fc\uc18c\ub294 [EMAIL_1]\uc785\ub2c8\ub2e4.",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["email", "person_name"])
        self.assertNotIn("\uc774\uc724\uc9c0", body_text)
        self.assertNotIn("yoonji@example.com", body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_preserves_korean_particles_around_person_names(self) -> None:
        first_name = "\uc774\uc724\uc9c0"
        second_name = "\uae40\ubbfc\uc218"
        first_span = f"{first_name}\ub294"
        second_span = f"{second_name}\ub97c"
        prompt = f"{first_span} {second_span} \ub9cc\ub0ac\ub2e4."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(first_span),
                    "end": prompt.index(first_span) + len(first_span),
                    "word": first_span,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": prompt.index(second_span),
                    "end": prompt.index(second_span) + len(second_span),
                    "word": second_span,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(body["redactedPrompt"], "[PERSON_1]\ub294 [PERSON_2]\ub97c \ub9cc\ub0ac\ub2e4.")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(first_name, body_text)
        self.assertNotIn(second_name, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_preserves_honorific_and_role_markers_around_person_names(self) -> None:
        raw_span = "\uae40\ubbfc\uc218 \ud300\uc7a5\ub2d8\uaed8"
        prompt = f"{raw_span} \uc5f0\ub77d\ud588\ub2e4."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(raw_span),
                    "end": prompt.index(raw_span) + len(raw_span),
                    "word": raw_span,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(body["redactedPrompt"], "[PERSON_1] \ud300\uc7a5\ub2d8\uaed8 \uc5f0\ub77d\ud588\ub2e4.")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn("\uae40\ubbfc\uc218", body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_preserves_boundaries_after_overextended_korean_person_names(self) -> None:
        first_span = "\uc774\uc724\uc9c0\ub2d8\uaed8\uc11c\ub294"
        second_span = "\uae40\ubbfc\uc218\ud300\uc7a5\ub2d8"
        prompt = f"{first_span} \uc624\ub298 \ucc38\uc11d\ud569\ub2c8\ub2e4. {second_span}\ub3c4 \ucc38\uc11d\ud569\ub2c8\ub2e4."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(
            lambda _text: [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(first_span),
                    "end": prompt.index(first_span) + len(first_span),
                    "word": first_span,
                },
                {
                    "entity_group": "person_name",
                    "score": 0.97,
                    "start": prompt.index(second_span),
                    "end": prompt.index(second_span) + len(second_span),
                    "word": second_span,
                },
            ]
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[PERSON_1]\ub2d8\uaed8\uc11c\ub294 \uc624\ub298 \ucc38\uc11d\ud569\ub2c8\ub2e4. "
            "[PERSON_2]\ud300\uc7a5\ub2d8\ub3c4 \ucc38\uc11d\ud569\ub2c8\ub2e4.",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn("\uc774\uc724\uc9c0", body_text)
        self.assertNotIn("\uae40\ubbfc\uc218", body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_applies_role_coreference_from_rule_person_name_without_calling_ml_classifier(self) -> None:
        raw_name = "Alex Kim"
        prompt = f"customer_name={raw_name}. He waited for support."
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return []

        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(classifier)
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(classifier_calls, 0)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[CUSTOMER_1]. [CUSTOMER_1] waited for support.",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(raw_name, body_text)
        self.assertNotIn("word", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_detect_redacts_deterministic_pii_without_calling_ml_classifier(self) -> None:
        email = "latency-fast@example.test"
        phone = "010-1234-5678"
        bearer_token = "syntheticBearerToken1234567890"
        prompt = f"Contact {email} or {phone}. Authorization: Bearer {bearer_token}"
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return []

        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(classifier)
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(classifier_calls, 0)
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(
            body["redactedPrompt"],
            "Contact [EMAIL_1] or [PHONE_NUMBER_1]. [AUTHORIZATION_HEADER_REDACTED]",
        )
        self.assertEqual(
            body["detectorSummary"]["detectorCategories"],
            ["authorization_header", "email", "phone_number"],
        )
        self.assertNotIn(email, body_text)
        self.assertNotIn(phone, body_text)
        self.assertNotIn(bearer_token, body_text)

    def test_detect_skips_ml_classifier_for_long_safe_prompt_without_pii_candidates(self) -> None:
        prompt = (
            "This synthetic operations note covers rollout checklists, service readiness, "
            "documentation review, and routine release coordination. "
        ) * 16
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return []

        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(classifier)
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(classifier_calls, 0)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], [])

    def test_detect_calls_ml_classifier_for_person_candidate_context(self) -> None:
        raw_name = "Alex Benchmark"
        prompt = f"Please review {raw_name} before the support handoff."
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": prompt.index(raw_name),
                    "end": prompt.index(raw_name) + len(raw_name),
                    "word": raw_name,
                }
            ]

        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(classifier)
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(classifier_calls, 1)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "Please review [PERSON_1] before the support handoff.",
        )
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["person_name"])
        self.assertNotIn(raw_name, body_text)

    def test_detect_sends_only_candidate_windows_to_ml_for_long_prompt(self) -> None:
        raw_name = "Alex Benchmark"
        prefix = "Routine release coordination and service readiness notes. " * 18
        suffix = " Documentation review and rollout checklist follow-up. " * 18
        prompt = f"{prefix}Applicant {raw_name} needs review before handoff.{suffix}"
        classifier_inputs: list[str] = []

        def classifier(text: str) -> list[object]:
            classifier_inputs.append(text)
            local_start = text.index(raw_name)
            return [
                {
                    "entity_group": "person_name",
                    "score": 0.98,
                    "start": local_start,
                    "end": local_start + len(raw_name),
                    "word": raw_name,
                }
            ]

        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(classifier)
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(len(classifier_inputs), 1)
        self.assertLess(len(classifier_inputs[0]), len(prompt))
        self.assertIn(raw_name, classifier_inputs[0])
        self.assertNotEqual(classifier_inputs[0], prompt)
        self.assertEqual(body["outcome"], "redacted")
        self.assertIn("[APPLICANT_1] needs review before handoff.", body["redactedPrompt"])
        self.assertNotIn(raw_name, body_text)

    def test_validation_error_does_not_echo_prompt(self) -> None:
        prompt = f"Contact {SYNTHETIC_EMAIL}."
        client = TestClient(create_app())
        body = payload(prompt)
        body["contractVersion"] = "wrong"

        response = client.post("/internal/ai-safety/v1/detect", json=body)

        self.assertEqual(response.status_code, 400, response.text)
        response_text = json.dumps(response.json(), sort_keys=True)
        self.assertIn("invalid_remote_safety_request", response_text)
        self.assertNotIn(SYNTHETIC_EMAIL, response_text)
        self.assertNotIn(prompt, response_text)


def service_with_classifier(
    classifier: object,
    *,
    model_name: str = "openai/privacy-filter",
    llm_classifier: object | None = None,
    llm_window_max_chars: int = 1000,
    llm_window_max_count: int = 3,
) -> AiSafetyDetectorService:
    return service_with_classifiers(
        (model_name, classifier),
        llm_classifier=llm_classifier,
        llm_window_max_chars=llm_window_max_chars,
        llm_window_max_count=llm_window_max_count,
    )


def service_with_classifiers(
    *model_classifiers: tuple[str, object],
    llm_classifier: object | None = None,
    llm_window_max_chars: int = 1000,
    llm_window_max_count: int = 3,
) -> AiSafetyDetectorService:
    return AiSafetyDetectorService(
        adapters=tuple(
            PrivacyFilterAdapter(  # type: ignore[arg-type]
                classifier=classifier,
                model_name=model_name,
                source=source_for_model(model_name),
            )
            for model_name, classifier in model_classifiers
        ),
        llm_classifier=llm_classifier,  # type: ignore[arg-type]
        llm_window_max_chars=llm_window_max_chars,
        llm_window_max_count=llm_window_max_count,
    )


def payload(prompt_text: str, *, locale: str = "en-US") -> dict[str, object]:
    return {
        "contractVersion": "ai-safety-detector.v1",
        "mode": "shadow",
        "input": {
            "promptText": prompt_text,
            "locale": locale,
        },
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": True,
        },
    }


def classifier_window_from_request(body: dict[str, Any]) -> str:
    messages = body["messages"]
    user_message = messages[-1]
    content = json.loads(user_message["content"])
    return content["candidateWindow"]


class FakeVllmServer:
    def __init__(
        self,
        classifier_payload: dict[str, object],
        *,
        status_code: int = 200,
        raw_content: str | None = None,
        delay_seconds: float = 0,
    ) -> None:
        self.classifier_payload = classifier_payload
        self.status_code = status_code
        self.raw_content = raw_content
        self.delay_seconds = delay_seconds
        self.requests: list[dict[str, Any]] = []
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        if self._server is None:
            raise RuntimeError("fake vLLM server is not running")
        host, port = self._server.server_address
        return f"http://{host}:{port}/v1"

    def __enter__(self) -> "FakeVllmServer":
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                if owner.delay_seconds > 0:
                    time.sleep(owner.delay_seconds)
                length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(length)
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                owner.requests.append(
                    {
                        "path": urlparse(self.path).path,
                        "body": body,
                    }
                )
                response_body = {
                    "choices": [
                        {
                            "message": {
                                "content": owner.raw_content
                                if owner.raw_content is not None
                                else json.dumps(owner.classifier_payload),
                            }
                        }
                    ]
                }
                encoded = json.dumps(response_body).encode("utf-8")
                try:
                    self.send_response(owner.status_code)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(encoded)))
                    self.end_headers()
                    self.wfile.write(encoded)
                except OSError:
                    return

            def log_message(self, _format: str, *_args: object) -> None:
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
