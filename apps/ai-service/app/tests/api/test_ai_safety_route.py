from __future__ import annotations

import json
import unittest

from fastapi.testclient import TestClient

from app.adapters.safety import PrivacyFilterAdapter
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
        self.assertEqual(body["redactedPrompt"], "Contact [EMAIL_REDACTED] for the demo.")
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


def service_with_classifier(classifier: object) -> AiSafetyDetectorService:
    return AiSafetyDetectorService(
        adapter=PrivacyFilterAdapter(classifier=classifier),  # type: ignore[arg-type]
    )


def payload(prompt_text: str) -> dict[str, object]:
    return {
        "contractVersion": "ai-safety-detector.v1",
        "mode": "shadow",
        "input": {
            "promptText": prompt_text,
            "locale": "en-US",
        },
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": True,
        },
    }


if __name__ == "__main__":
    unittest.main()
