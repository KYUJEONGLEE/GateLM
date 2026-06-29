from __future__ import annotations

import re
import unittest

from pydantic import ValidationError

from app.adapters.safety.noop_evaluator import NoopSafetyEvaluator
from app.adapters.safety.heuristic_evaluator import HeuristicSafetyEvaluator, RegexDetector
from app.domain.safety.policy import PREVIEW_MAX_CHARS
from app.schemas.safety import (
    RemoteSafetyContext,
    RemoteSafetyInput,
    SafetyDetector,
    SafetyDomainOutcome,
)


class RemoteSafetyPolicyTests(unittest.TestCase):
    def test_block_takes_precedence_over_redaction(self) -> None:
        evaluator = HeuristicSafetyEvaluator()
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(
                "Contact alex@example.test and inspect api_key=DEMOSECRETDEMOSECRET12345.",
                [
                    detector("email", "redact", "[EMAIL_REDACTED]"),
                    detector("api_key", "block", "[API_KEY_REDACTED]"),
                ],
            ),
        )

        self.assertEqual(decision.action, "blocked")
        self.assertEqual(decision.detected_types, ("api_key", "email"))
        self.assertEqual(decision.detected_count, 2)
        self.assertEqual(decision.block_reason, "sensitive_data_blocked")
        self.assertIn("[EMAIL_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertIn("[API_KEY_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertNotIn("DEMOSECRET", decision.redacted_prompt_preview or "")

    def test_disabled_detector_is_ignored(self) -> None:
        evaluator = HeuristicSafetyEvaluator()
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(
                "Contact alex@example.test.",
                [detector("email", "redact", "[EMAIL_REDACTED]", enabled=False)],
            ),
        )

        self.assertEqual(decision.action, "none")
        self.assertEqual(decision.detected_count, 0)
        self.assertIsNone(decision.redacted_prompt_preview)

    def test_preview_is_bounded_after_redaction(self) -> None:
        evaluator = HeuristicSafetyEvaluator()
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(
                " ".join(["Contact alex@example.test"] + ["safe"] * 80),
                [detector("email", "redact", "[EMAIL_REDACTED]")],
            ),
        )

        self.assertEqual(decision.action, "redacted")
        self.assertIsNotNone(decision.redacted_prompt_preview)
        self.assertLessEqual(len(decision.redacted_prompt_preview or ""), PREVIEW_MAX_CHARS + 3)

    def test_signal_does_not_store_raw_match_value(self) -> None:
        regex_detector = RegexDetector("email", re.compile(r"\b\S+@\S+\b"), 50)
        signals = regex_detector.detect(
            "Contact alex@example.test.",
            detector("email", "redact", "[EMAIL_REDACTED]"),
        )

        self.assertEqual(len(signals), 1)
        self.assertFalse(hasattr(signals[0], "value"))
        self.assertFalse(hasattr(signals[0], "raw_value"))
        self.assertEqual(signals[0].detector_type, "email")

    def test_noop_evaluator_returns_none_without_preview(self) -> None:
        decision = NoopSafetyEvaluator().evaluate(
            remote_context(),
            remote_input(
                "Contact alex@example.test.",
                [detector("email", "redact", "[EMAIL_REDACTED]")],
            ),
        )

        self.assertEqual(decision.action, "none")
        self.assertEqual(decision.detected_count, 0)
        self.assertIsNone(decision.redacted_prompt_preview)

    def test_safety_domain_outcome_allows_only_sanitized_summary(self) -> None:
        outcome = SafetyDomainOutcome(
            outcome="redacted",
            detectorSummary={
                "detectedCount": 2,
                "detectorCategories": ["email", "phone_number"],
            },
        )

        self.assertEqual(outcome.outcome, "redacted")
        self.assertIsNotNone(outcome.detector_summary)
        self.assertEqual(outcome.detector_summary.detected_count, 2)
        self.assertEqual(outcome.detector_summary.detector_categories, ["email", "phone_number"])

        with self.assertRaises(ValidationError):
            SafetyDomainOutcome(
                outcome="partial_success",
                detectorSummary={"detectedCount": 1, "detectorCategories": ["email"]},
            )

        with self.assertRaises(ValidationError):
            SafetyDomainOutcome(
                outcome="blocked",
                detectorSummary={
                    "detectedCount": 1,
                    "detectorCategories": ["email"],
                    "rawDetectedValue": "alex@example.test",
                },
            )


def remote_context() -> RemoteSafetyContext:
    return RemoteSafetyContext(
        requestId="request_remote_safety_policy_test",
        traceId="trace_remote_safety_policy_test",
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


def detector(
    detector_type: str,
    action: str,
    placeholder: str,
    *,
    enabled: bool = True,
) -> SafetyDetector:
    return SafetyDetector(
        type=detector_type,
        enabled=enabled,
        action=action,
        placeholder=placeholder,
    )


if __name__ == "__main__":
    unittest.main()
