from __future__ import annotations

import json
import unittest
from collections.abc import Mapping

from fastapi.testclient import TestClient

from app.adapters.safety import PrivacyFilterAdapter
from app.adapters.safety.privacy_filter_adapter import (
    KOELECTRA_PRIVACY_NER_MODEL,
    source_for_model,
)
from app.main import create_app
from app.services.ai_safety_detector import (
    ML_MAX_CANDIDATES_PER_REQUEST,
    AiSafetyDetectorService,
)


SYNTHETIC_EMAIL = "alex@example.test"
SYNTHETIC_SECRET = "syntheticSecretValue1234567890abcdef"
SYNTHETIC_ACCOUNT_NUMBER = "syntheticAccountNumber123456"
TEST_PERSON_LABEL_MAP = {"person_name": "person_name"}


class AiSafetyRouteTests(unittest.TestCase):
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
            ],
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
        self.assertEqual(body["executionSummary"]["executionMode"], "rules_only")
        self.assertEqual(body["executionSummary"]["modelInvocationCount"], 0)
        self.assertIn("latencyMs", body)
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
            ],
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

    def test_detect_runs_default_and_verified_koelectra_detectors_together(self) -> None:
        synthetic_email = "koelectra-sidecar@example.test"
        synthetic_phone = "010-1234-5678"
        synthetic_resident_number = "syntheticResidentNumberToken"
        prompt = (
            f"Contact {synthetic_email} or {synthetic_phone} and validate resident "
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
                        "entity_group": "PHN-B",
                        "score": 0.95,
                        "start": prompt.index(synthetic_phone),
                        "end": prompt.index(synthetic_phone) + len(synthetic_phone),
                        "word": synthetic_phone,
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
                "Contact [EMAIL_1] or [PHONE_NUMBER_1] "
                "and validate resident registration "
                "number [RESIDENT_REGISTRATION_NUMBER_REDACTED]."
            ),
        )
        self.assertEqual(
            body["detectorSummary"]["detectorCategories"],
            ["email", "phone_number", "resident_registration_number"],
        )
        detection_sources = {detection["source"] for detection in body["detections"]}
        self.assertEqual(detection_sources, {"local_rule", "koelectra_privacy_ner"})
        self.assertNotIn(synthetic_email, body_text)
        self.assertNotIn(synthetic_phone, body_text)
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
            ],
            label_map=TEST_PERSON_LABEL_MAP,
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
            ],
            label_map=TEST_PERSON_LABEL_MAP,
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
        prompt = f"\uace0\uac1d {owner_name}\uc758 \ud300\uc7a5 {approver_name}\uac00 \uc2b9\uc778\ud588\ub2e4."
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
            ],
            label_map=TEST_PERSON_LABEL_MAP,
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[CUSTOMER_1]\uc758 [ROLE:\ud300\uc7a5] [PERSON_1]\uac00 \uc2b9\uc778\ud588\ub2e4.",
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
            f"\uace0\uac1d {full_name}\ub294 \ud68c\uc758\uc5d0 \ucc38\uc11d\ud588\ub2e4. "
            f"\uace0\uac1d {alias}\ub2d8\uc740 \ubc1c\ud45c\ub97c \ub9e1\uc558\ub2e4."
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
            ],
            label_map=TEST_PERSON_LABEL_MAP,
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
                "[CUSTOMER_1]\ub294 \ud68c\uc758\uc5d0 \ucc38\uc11d\ud588\ub2e4. "
                "[CUSTOMER_1]\ub2d8\uc740 \ubc1c\ud45c\ub97c \ub9e1\uc558\ub2e4."
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
            f"\uace0\uac1d {sender_name}\uac00 \uace0\uac1d {recipient_name}\uc5d0\uac8c \uba54\uc77c\uc744 \ubcf4\ub0c8\ub2e4. "
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
            ],
            label_map=TEST_PERSON_LABEL_MAP,
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
                "[CUSTOMER_1]\uac00 [CUSTOMER_2]\uc5d0\uac8c \uba54\uc77c\uc744 \ubcf4\ub0c8\ub2e4. "
                "[CUSTOMER_1]\ub294 \ub2f5\uc7a5\uc744 \uae30\ub2e4\ub838\ub2e4."
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
        prompt = f"\uace0\uac1d {name_with_honorific}\uc758 \uc774\uba54\uc77c \uc8fc\uc18c\ub294 {email_with_copula}."
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
            ],
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(
            body["redactedPrompt"],
            "[CUSTOMER_1]\ub2d8\uc758 \uc774\uba54\uc77c \uc8fc\uc18c\ub294 [EMAIL_1]\uc785\ub2c8\ub2e4.",
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
        prompt = f"\uace0\uac1d {first_span} \uace0\uac1d {second_span} \ub9cc\ub0ac\ub2e4."
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
            ],
            label_map=TEST_PERSON_LABEL_MAP,
        )
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertEqual(body["redactedPrompt"], "[CUSTOMER_1]\ub294 [CUSTOMER_2]\ub97c \ub9cc\ub0ac\ub2e4.")
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
        prompt = f"\uace0\uac1d {first_span} \uc624\ub298 \ucc38\uc11d\ud569\ub2c8\ub2e4. {second_span}\ub3c4 \ucc38\uc11d\ud569\ub2c8\ub2e4."
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
            "[CUSTOMER_1]\ub2d8\uaed8\uc11c\ub294 \uc624\ub298 \ucc38\uc11d\ud569\ub2c8\ub2e4. "
            "[PERSON_1]\ud300\uc7a5\ub2d8\ub3c4 \ucc38\uc11d\ud569\ub2c8\ub2e4.",
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

    def test_detect_does_not_call_ml_classifier_for_bare_person_candidate(self) -> None:
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
        self.assertEqual(classifier_calls, 0)
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], [])
        self.assertIn(raw_name, body_text)

    def test_detect_uses_context_bound_person_rule_for_long_prompt_without_calling_ml(self) -> None:
        raw_name = "Alex Benchmark"
        prefix = "Routine release coordination and service readiness notes. " * 18
        suffix = " Documentation review and rollout checklist follow-up. " * 18
        prompt = f"{prefix}applicant {raw_name} needs review before handoff.{suffix}"
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
        self.assertEqual(classifier_inputs, [])
        self.assertEqual(body["outcome"], "redacted")
        self.assertIn("[APPLICANT_1] needs review before handoff.", body["redactedPrompt"])
        self.assertNotIn(raw_name, body_text)

    def test_detect_allows_non_real_example_secret_while_preserving_detection_summary(self) -> None:
        prompt = f"Example secret format for docs: secret_key={SYNTHETIC_SECRET}."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["secret"])
        self.assertEqual(body["detectorSummary"]["detectedCount"], 1)
        self.assertEqual(body["detections"][0]["detectorType"], "secret")
        self.assertEqual(body["detections"][0]["action"], "allow")

    def test_detect_allows_synthetic_placeholder_despite_negated_production_context(self) -> None:
        prompt = f"Unit test uses synthetic secret placeholder secret_key={SYNTHETIC_SECRET} with no production data exposure."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["secret"])
        self.assertEqual(body["detections"][0]["action"], "allow")

    def test_detect_only_allows_non_real_signal_and_keeps_real_email_redaction(self) -> None:
        prompt = (
            f"Example secret format for docs: secret_key={SYNTHETIC_SECRET}. "
            f"Contact {SYNTHETIC_EMAIL} for review."
        )
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertIn(f"secret_key={SYNTHETIC_SECRET}", body["redactedPrompt"])
        self.assertIn("[EMAIL_1]", body["redactedPrompt"])
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["email", "secret"])
        self.assertEqual(body["detectorSummary"]["detectedCount"], 2)
        actions_by_type = {detection["detectorType"]: detection["action"] for detection in body["detections"]}
        self.assertEqual(actions_by_type["secret"], "allow")
        self.assertEqual(actions_by_type["email"], "redact")
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)

    def test_detect_redacts_block_default_signal_in_internal_review_context(self) -> None:
        prompt = f"Support review note: redact secret_key={SYNTHETIC_SECRET} before filing."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "redacted")
        self.assertIn("[SECRET_REDACTED]", body["redactedPrompt"])
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["secret"])
        self.assertEqual(body["detections"][0]["action"], "redact")
        self.assertNotIn(SYNTHETIC_SECRET, body_text)

    def test_detect_blocks_redact_default_signal_in_external_share_context(self) -> None:
        prompt = f"External share request: send customer email {SYNTHETIC_EMAIL} to a contractor."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["email"])
        self.assertEqual(body["detections"][0]["action"], "block")
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)

    def test_detect_keeps_explicit_non_real_allow_ahead_of_action_context(self) -> None:
        prompt = f"Bulk export docs example only: secret_key={SYNTHETIC_SECRET}."
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "passed")
        self.assertEqual(body["redactedPrompt"], prompt)
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["secret"])
        self.assertEqual(body["detections"][0]["action"], "allow")

    def test_detect_does_not_treat_sample_inside_bank_name_as_non_real_context(self) -> None:
        prompt = "계좌는 account number 123-456-789012 샘플은행이야"
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["account_number"])
        self.assertEqual(body["detections"][0]["action"], "block")

    def test_detect_blocks_passport_number_without_colon_separator(self) -> None:
        prompt = "여권번호 필드는 passport number M12345678입니다"
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["passport_number"])
        self.assertEqual(body["detections"][0]["action"], "block")

    def test_detect_blocks_driver_license_without_colon_separator(self) -> None:
        prompt = "면허번호는 driver license 12-34-123456-78입니다"
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post("/internal/ai-safety/v1/detect", json=payload(prompt, locale="ko-KR"))

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["outcome"], "blocked")
        self.assertEqual(body["detectorSummary"]["detectorCategories"], ["driver_license"])
        self.assertEqual(body["detections"][0]["action"], "block")

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

    def test_batch_detect_preserves_order_and_returns_sanitized_execution_summary(self) -> None:
        prompts = [
            f"Contact {SYNTHETIC_EMAIL} for the demo.",
            "Write a safe synthetic handoff.",
        ]
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app)

        response = client.post(
            "/internal/ai-safety/v1/detect/batch",
            json=batch_payload(*prompts),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        body_text = json.dumps(body, sort_keys=True)
        self.assertEqual(body["contractVersion"], "ai-safety-detector-batch.v1")
        self.assertEqual([item["itemIndex"] for item in body["results"]], [0, 1])
        self.assertEqual(body["executionSummary"]["executionMode"], "rules_only")
        self.assertEqual(body["executionSummary"]["modelInvocationCount"], 0)
        self.assertIn("latencyMs", body)
        self.assertTrue(all("latencyMs" not in item for item in body["results"]))
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)
        self.assertNotIn("promptText", body_text)
        self.assertNotIn("start", body_text)
        self.assertNotIn("end", body_text)

    def test_batch_validation_rejects_more_than_64_without_echoing_prompt(self) -> None:
        private_marker = "private-batch-marker@example.test"
        body = batch_payload(*([f"Contact {private_marker}."] * 65))
        client = TestClient(create_app())

        response = client.post("/internal/ai-safety/v1/detect/batch", json=body)

        self.assertEqual(response.status_code, 400, response.text)
        self.assertNotIn(private_marker, json.dumps(response.json(), sort_keys=True))

    def test_batch_validation_rejects_non_contiguous_item_indexes(self) -> None:
        body = batch_payload("Safe one.", "Safe two.")
        inputs = body["inputs"]
        assert isinstance(inputs, list)
        inputs[1]["itemIndex"] = 3
        client = TestClient(create_app())

        response = client.post("/internal/ai-safety/v1/detect/batch", json=body)

        self.assertEqual(response.status_code, 400, response.text)

    def test_batch_model_work_limit_returns_sanitized_unavailable_error(self) -> None:
        private_marker = "private-window-marker"
        prompt = (
            f"Review private URL {private_marker}. "
            * (ML_MAX_CANDIDATES_PER_REQUEST + 1)
        )
        app = create_app()
        app.state.ai_safety_detector_service = service_with_classifier(lambda _text: [])
        client = TestClient(app, raise_server_exceptions=False)

        response = client.post(
            "/internal/ai-safety/v1/detect/batch",
            json=batch_payload(prompt),
        )

        self.assertEqual(response.status_code, 500, response.text)
        response_text = json.dumps(response.json(), sort_keys=True)
        self.assertIn("remote_safety_unavailable", response_text)
        self.assertNotIn(private_marker, response_text)


def service_with_classifier(
    classifier: object,
    *,
    model_name: str = "openai/privacy-filter",
    label_map: Mapping[str, str] | None = None,
) -> AiSafetyDetectorService:
    return AiSafetyDetectorService(
        adapters=(
            PrivacyFilterAdapter(  # type: ignore[arg-type]
                classifier=classifier,
                model_name=model_name,
                source=source_for_model(model_name),
                label_map=label_map,
            ),
        ),
    )


def service_with_classifiers(
    *model_classifiers: tuple[str, object],
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


def batch_payload(*prompt_texts: str, locale: str = "en-US") -> dict[str, object]:
    return {
        "contractVersion": "ai-safety-detector-batch.v1",
        "mode": "enforce",
        "inputs": [
            {
                "itemIndex": index,
                "promptText": prompt_text,
                "locale": locale,
            }
            for index, prompt_text in enumerate(prompt_texts)
        ],
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": False,
        },
    }
