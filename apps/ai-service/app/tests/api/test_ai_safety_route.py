from __future__ import annotations

import json
import unittest

from fastapi.testclient import TestClient

from app.adapters.safety import PrivacyFilterAdapter
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
) -> AiSafetyDetectorService:
    return service_with_classifiers((model_name, classifier))


def service_with_classifiers(*model_classifiers: tuple[str, object]) -> AiSafetyDetectorService:
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


if __name__ == "__main__":
    unittest.main()
