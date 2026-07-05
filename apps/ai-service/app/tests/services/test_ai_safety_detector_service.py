from __future__ import annotations

import unittest

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL, PrivacyFilterAdapter
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AiSafetyDetectRequest,
    AiSafetyDetectorConfig,
    AiSafetyDetectorInput,
    SafetyDetector,
)
from app.services.ai_safety_detector import AiSafetyDetectorService


class AiSafetyDetectorServiceTests(unittest.TestCase):
    def test_default_detector_runtime_uses_local_onnx_path(self) -> None:
        service = AiSafetyDetectorService()

        self.assertEqual(service.detector_model_states()[0]["runtime"], "onnx")

    def test_detector_model_states_report_sanitized_runtime_and_load_state(self) -> None:
        service = AiSafetyDetectorService(
            model_id=".cache/onnx/openai--privacy-filter",
            additional_model_ids=(
                ".cache/onnx/amoeba04--koelectra-small-v3-privacy-ner-quantized",
            ),
            detector_runtime="onnx",
        )

        self.assertEqual(
            service.detector_model_states(),
            [
                {
                    "modelId": "openai/privacy-filter",
                    "source": "openai_privacy_filter",
                    "runtime": "onnx",
                    "loadState": "configured",
                },
                {
                    "modelId": KOELECTRA_PRIVACY_NER_MODEL,
                    "source": "koelectra_privacy_ner",
                    "runtime": "onnx",
                    "loadState": "configured",
                },
            ],
        )

    def test_detector_model_states_report_loaded_when_classifier_is_ready(self) -> None:
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda _text: [],
                model_name=".cache/onnx/openai--privacy-filter",
                runtime="onnx",
            ),
        )

        self.assertEqual(service.detector_model_states()[0]["loadState"], "loaded")

    def test_detect_skips_ml_when_fast_rules_cover_deterministic_pii(self) -> None:
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return []

        service = AiSafetyDetectorService(adapter=PrivacyFilterAdapter(classifier=classifier))

        response = service.detect(
            detect_request("Contact latency-fast@example.test or 010-1234-5678.")
        )

        self.assertEqual(classifier_calls, 0)
        self.assertEqual(response.outcome, "redacted")
        self.assertEqual(
            response.detector_summary.detector_categories,
            ["email", "phone_number"],
        )

    def test_detect_skips_ml_when_fast_rules_cover_organization_context(self) -> None:
        classifier_calls = 0
        organization_name = "Acme Synthetic"
        prompt = f"Please review organization {organization_name} before handoff."

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return [
                {
                    "entity_group": "ORG",
                    "score": 0.91,
                    "start": prompt.index(organization_name),
                    "end": prompt.index(organization_name) + len(organization_name),
                }
            ]

        service = AiSafetyDetectorService(adapter=PrivacyFilterAdapter(classifier=classifier))

        response = service.detect(detect_request(prompt))

        self.assertEqual(classifier_calls, 0)
        self.assertEqual(response.outcome, "redacted")
        self.assertEqual(response.detector_summary.detector_categories, ["organization_name"])

    def test_detect_distinguishes_account_number_from_bank_account(self) -> None:
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
            detectors=(
                detector("account_number", "block", "[ACCOUNT_NUMBER_REDACTED]"),
                detector("bank_account", "block", "[BANK_ACCOUNT_REDACTED]"),
            ),
        )

        account_response = service.detect(
            detect_request("Refund account number 123-456-789012 after review.")
        )
        bank_response = service.detect(
            detect_request("Refund bank account number 123-456-789012 after review.")
        )

        self.assertEqual(account_response.outcome, "blocked")
        self.assertEqual(account_response.detector_summary.detector_categories, ["account_number"])
        self.assertEqual(bank_response.outcome, "blocked")
        self.assertEqual(bank_response.detector_summary.detector_categories, ["bank_account"])

    def test_detect_keeps_secret_assignment_out_of_api_key_bucket(self) -> None:
        secret_value = "syntheticSecret" + "1234567890abcdef"
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
            detectors=(
                detector("api_key", "block", "[API_KEY_REDACTED]"),
                detector("secret", "block", "[SECRET_REDACTED]"),
            ),
        )

        response = service.detect(detect_request(f"Rotate secret_key={secret_value}."))

        self.assertEqual(response.outcome, "blocked")
        self.assertEqual(response.detector_summary.detector_categories, ["secret"])

    def test_detect_context_rules_require_a_value_not_only_field_name(self) -> None:
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
            detectors=(
                detector(
                    "confidential_business_context",
                    "block",
                    "[CONFIDENTIAL_BUSINESS_CONTEXT_REDACTED]",
                ),
                detector(
                    "sensitive_health_context",
                    "block",
                    "[SENSITIVE_HEALTH_CONTEXT_REDACTED]",
                ),
            ),
        )

        safe_response = service.detect(
            detect_request("Explain what a sensitive-health-context field means in a schema.")
        )
        blocked_response = service.detect(
            detect_request("Ticket value: SYNTHETIC_SENSITIVE_HEALTH_CONTEXT.")
        )

        self.assertEqual(safe_response.outcome, "passed")
        self.assertEqual(safe_response.detector_summary.detector_categories, [])
        self.assertEqual(blocked_response.outcome, "blocked")
        self.assertEqual(
            blocked_response.detector_summary.detector_categories,
            ["sensitive_health_context"],
        )


def detect_request(prompt: str) -> AiSafetyDetectRequest:
    return AiSafetyDetectRequest(
        contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
        input=AiSafetyDetectorInput(promptText=prompt),
        detectorConfig=AiSafetyDetectorConfig(returnConfidence=False),
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
