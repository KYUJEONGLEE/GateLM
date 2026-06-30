from __future__ import annotations

import unittest

from app.domain.safety.decision import BLOCK_REASON_SENSITIVE_DATA_BLOCKED
from app.domain.safety.detections import Detection, safety_signals_from_detections
from app.domain.safety.policy import build_safety_decision
from app.schemas.safety import SafetyDetector


class DetectionPipelineTests(unittest.TestCase):
    def test_detection_to_decision_redacts_without_raw_value_fields(self) -> None:
        raw_email = "alex@example.test"
        prompt = f"Contact {raw_email} for the support demo."
        detections = [
            Detection(
                detector_type="email",
                source="koelectra_ner",
                start=prompt.index(raw_email),
                end=prompt.index(raw_email) + len(raw_email),
                confidence=0.91,
            )
        ]

        signals = safety_signals_from_detections(
            detections,
            {"email": detector("email", "redact", "[EMAIL_REDACTED]")},
        )
        decision = build_safety_decision(
            prompt_text=prompt,
            signals=signals,
            security_policy_hash="hash_security_policy_test",
        )

        self.assertEqual(decision.action, "redacted")
        self.assertEqual(decision.detected_types, ("email",))
        self.assertEqual(decision.detected_count, 1)
        self.assertIn("[EMAIL_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_email, decision.redacted_prompt_preview or "")
        self.assertFalse(hasattr(detections[0], "word"))
        self.assertFalse(hasattr(detections[0], "raw_value"))
        self.assertFalse(hasattr(signals[0], "raw_span"))

    def test_blocking_detection_wins_over_redaction(self) -> None:
        raw_email = "alex@example.test"
        raw_token = "test_secret_token_redacted_demo_1234567890abcdef"
        prompt = f"Email {raw_email} and inspect api_key={raw_token}."

        detections = [
            Detection(
                detector_type="email",
                source="privacy_filter",
                start=prompt.index(raw_email),
                end=prompt.index(raw_email) + len(raw_email),
                confidence=0.95,
            ),
            Detection(
                detector_type="api_key",
                source="regex_secret",
                start=prompt.index(raw_token),
                end=prompt.index(raw_token) + len(raw_token),
                confidence=1.0,
            ),
        ]

        signals = safety_signals_from_detections(
            detections,
            {
                "email": detector("email", "redact", "[EMAIL_REDACTED]"),
                "api_key": detector("api_key", "block", "[API_KEY_REDACTED]"),
            },
        )
        decision = build_safety_decision(
            prompt_text=prompt,
            signals=signals,
            security_policy_hash="hash_security_policy_test",
        )

        self.assertEqual(decision.action, "blocked")
        self.assertEqual(decision.detected_types, ("api_key", "email"))
        self.assertEqual(decision.detected_count, 2)
        self.assertEqual(decision.block_reason, BLOCK_REASON_SENSITIVE_DATA_BLOCKED)
        self.assertNotIn(raw_email, decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_token, decision.redacted_prompt_preview or "")

    def test_low_confidence_detection_is_shadow_dropped_by_default(self) -> None:
        raw_name = "Alex Kim"
        prompt = f"Draft a reply for {raw_name}."
        detections = [
            Detection(
                detector_type="person_name",
                source="koelectra_ner",
                start=prompt.index(raw_name),
                end=prompt.index(raw_name) + len(raw_name),
                confidence=0.42,
            )
        ]

        signals = safety_signals_from_detections(
            detections,
            {"person_name": detector("person_name", "redact", "[PERSON_NAME_REDACTED]")},
        )

        self.assertEqual(signals, [])

    def test_overlapping_block_span_keeps_structural_detection(self) -> None:
        raw_token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.synthetic_signature_1234567890"
        prompt = f"Authorization: Bearer {raw_token}"
        auth_start = prompt.index("Authorization")
        jwt_start = prompt.index(raw_token)

        detections = [
            Detection(
                detector_type="jwt",
                source="privacy_filter",
                start=jwt_start,
                end=jwt_start + len(raw_token),
                confidence=0.99,
            ),
            Detection(
                detector_type="authorization_header",
                source="regex_authorization_header",
                start=auth_start,
                end=len(prompt),
                confidence=0.90,
            ),
        ]

        signals = safety_signals_from_detections(
            detections,
            {
                "authorization_header": detector(
                    "authorization_header",
                    "block",
                    "[AUTHORIZATION_HEADER_REDACTED]",
                ),
                "jwt": detector("jwt", "block", "[JWT_REDACTED]"),
            },
        )
        decision = build_safety_decision(
            prompt_text=prompt,
            signals=signals,
            security_policy_hash="hash_security_policy_test",
        )

        self.assertEqual(decision.action, "blocked")
        self.assertEqual(decision.detected_types, ("authorization_header",))
        self.assertEqual(decision.detected_count, 1)
        self.assertIn("[AUTHORIZATION_HEADER_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_token, decision.redacted_prompt_preview or "")


def detector(detector_type: str, action: str, placeholder: str) -> SafetyDetector:
    return SafetyDetector(
        type=detector_type,
        enabled=True,
        action=action,
        placeholder=placeholder,
    )


if __name__ == "__main__":
    unittest.main()
