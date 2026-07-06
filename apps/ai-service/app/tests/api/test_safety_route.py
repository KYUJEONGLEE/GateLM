from __future__ import annotations

import json
import unittest

from fastapi.testclient import TestClient

from app.core.config import REMOTE_SAFETY_MODE_DISABLED, REMOTE_SAFETY_MODE_SHADOW, Settings
from app.main import create_app
from app.services.safety_evaluator import RemoteSafetyEvaluationService


SYNTHETIC_EMAIL = "alex@example.test"
SYNTHETIC_SECRET = "demoSecretDemoSecret1234567890abcdef"


class SafetyRouteTests(unittest.TestCase):
    def test_evaluate_redacts_email_in_shadow_mode(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_SHADOW)))

        response = client.post(
            "/internal/v1/safety/evaluate",
            json=remote_safety_payload(f"Send a short support reply to {SYNTHETIC_EMAIL}."),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["decision"]["action"], "redacted")
        self.assertEqual(body["decision"]["detectedTypes"], ["email"])
        self.assertEqual(body["decision"]["detectedCount"], 1)
        self.assertIn("[EMAIL_1]", body["decision"]["redactedPromptPreview"])
        self.assertNotIn(SYNTHETIC_EMAIL, response.text)
        self.assertEqual(body["metadata"]["contractVersion"], "remote-safety.v1")
        self.assertEqual(body["metadata"]["detectedTypeCounts"], {"email": 1})

    def test_evaluate_blocks_credential_like_value_in_shadow_mode(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_SHADOW)))

        response = client.post(
            "/internal/v1/safety/evaluate",
            json=remote_safety_payload(f"Debug api_key={SYNTHETIC_SECRET} for the demo."),
        )

        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["decision"]["action"], "blocked")
        self.assertEqual(body["decision"]["detectedTypes"], ["api_key"])
        self.assertEqual(body["decision"]["blockReason"], "sensitive_data_blocked")
        self.assertIn("[API_KEY_REDACTED]", body["decision"]["redactedPromptPreview"])
        self.assertNotIn(SYNTHETIC_SECRET, response.text)

    def test_evaluate_is_disabled_by_default(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_DISABLED)))

        response = client.post(
            "/internal/v1/safety/evaluate",
            json=remote_safety_payload(f"Send a short support reply to {SYNTHETIC_EMAIL}."),
        )

        self.assertEqual(response.status_code, 503, response.text)
        body = response.json()
        self.assertEqual(body["error"]["code"], "remote_safety_unavailable")
        self.assertTrue(body["error"]["retryable"])
        self.assertEqual(body["error"]["requestId"], "request_remote_safety_test")
        self.assertNotIn(SYNTHETIC_EMAIL, response.text)

    def test_validation_error_is_sanitized(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_SHADOW)))
        payload = remote_safety_payload(f"Send a short support reply to {SYNTHETIC_EMAIL}.")
        payload["input"]["detectors"][0]["action"] = SYNTHETIC_EMAIL

        response = client.post("/internal/v1/safety/evaluate", json=payload)

        self.assertEqual(response.status_code, 400, response.text)
        body_text = json.dumps(response.json(), sort_keys=True)
        self.assertIn("invalid_remote_safety_request", body_text)
        self.assertEqual(response.json()["error"]["requestId"], "request_remote_safety_test")
        self.assertIn("input.detectors.0.action", body_text)
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)
        self.assertNotIn("Input should be", body_text)

    def test_unknown_detector_type_is_rejected_without_echoing_input(self) -> None:
        client = TestClient(create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_SHADOW)))
        payload = remote_safety_payload(f"Send a short support reply to {SYNTHETIC_EMAIL}.")
        payload["input"]["detectors"][0]["type"] = "unknown_detector"

        response = client.post("/internal/v1/safety/evaluate", json=payload)

        self.assertEqual(response.status_code, 400, response.text)
        body_text = json.dumps(response.json(), sort_keys=True)
        self.assertIn("invalid_remote_safety_request", body_text)
        self.assertIn("input.detectors.0.type", body_text)
        self.assertIn("unsupported_detector_type", body_text)
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)
        self.assertNotIn("unknown_detector", body_text)

    def test_unexpected_evaluator_error_is_sanitized(self) -> None:
        app = create_app(Settings(remote_safety_mode=REMOTE_SAFETY_MODE_SHADOW))
        app.state.remote_safety_service = RemoteSafetyEvaluationService(
            Settings(remote_safety_mode=REMOTE_SAFETY_MODE_SHADOW),
            evaluator=ExplodingEvaluator(),
        )
        client = TestClient(app, raise_server_exceptions=False)

        with self.assertLogs("app.core.errors", level="ERROR") as logs:
            response = client.post(
                "/internal/v1/safety/evaluate",
                json=remote_safety_payload(f"Check {SYNTHETIC_EMAIL} with api_key={SYNTHETIC_SECRET}."),
            )

        self.assertEqual(response.status_code, 500, response.text)
        body_text = json.dumps(response.json(), sort_keys=True)
        log_text = "\n".join(logs.output)
        self.assertIn("remote_safety_unavailable", body_text)
        self.assertNotIn(SYNTHETIC_EMAIL, body_text)
        self.assertNotIn(SYNTHETIC_SECRET, body_text)
        self.assertNotIn("exploded", body_text)
        self.assertIn("sanitized internal error", log_text)
        self.assertIn("RuntimeError", log_text)
        self.assertIn("test_safety_route.py", log_text)
        self.assertIn("evaluate", log_text)
        self.assertNotIn(SYNTHETIC_EMAIL, log_text)
        self.assertNotIn(SYNTHETIC_SECRET, log_text)
        self.assertNotIn("exploded", log_text)
        self.assertNotIn("Traceback", log_text)


def remote_safety_payload(prompt_text: str) -> dict[str, object]:
    return {
        "contractVersion": "remote-safety.v1",
        "ctx": {
            "requestId": "request_remote_safety_test",
            "traceId": "trace_remote_safety_test",
            "tenantId": "tenant_demo",
            "projectId": "project_demo",
            "applicationId": "app_demo",
            "configHash": "hash_runtime_config_v1_demo",
            "securityPolicyHash": "hash_security_policy_v1_demo",
            "routingPolicyHash": "hash_routing_policy_v1_demo",
            "policyMode": "rule_based",
            "remoteSafetyMode": "shadow",
        },
        "input": {
            "promptText": prompt_text,
            "requestBodyHash": "hash_request_body_v1_demo",
            "requestedModel": "auto",
            "detectors": [
                {
                    "type": "email",
                    "enabled": True,
                    "action": "redact",
                    "placeholder": "[EMAIL_REDACTED]",
                },
                {
                    "type": "api_key",
                    "enabled": True,
                    "action": "block",
                    "placeholder": "[API_KEY_REDACTED]",
                },
            ],
        },
    }


class ExplodingEvaluator:
    def evaluate(self, _ctx: object, _input: object) -> object:
        raise RuntimeError(f"exploded with {SYNTHETIC_EMAIL} and {SYNTHETIC_SECRET}")


if __name__ == "__main__":
    unittest.main()
