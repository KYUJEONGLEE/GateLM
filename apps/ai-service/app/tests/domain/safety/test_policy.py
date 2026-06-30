from __future__ import annotations

import re
import unittest

from app.adapters.safety.noop_evaluator import NoopSafetyEvaluator
from app.adapters.safety.heuristic_evaluator import HeuristicSafetyEvaluator, RegexDetector
from app.domain.safety.policy import PREVIEW_MAX_CHARS
from app.schemas.safety import RemoteSafetyContext, RemoteSafetyInput, SafetyDetector


class RemoteSafetyPolicyTests(unittest.TestCase):
    def test_block_takes_precedence_over_redaction(self) -> None:
        evaluator = HeuristicSafetyEvaluator()
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(
                "Contact alex@example.test and inspect api_key=test_api_key_redacted_demo_1234567890abcdef.",
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
        self.assertNotIn("1234567890abcdef", decision.redacted_prompt_preview or "")

    def test_api_key_detector_blocks_credential_like_assignment(self) -> None:
        raw_value = "test_api_key_redacted_demo_1234567890abcdef"
        evaluator = HeuristicSafetyEvaluator()
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(
                f"Inspect api_key={raw_value}.",
                [detector("api_key", "block", "[API_KEY_REDACTED]")],
            ),
        )

        self.assertEqual(decision.action, "blocked")
        self.assertEqual(decision.detected_types, ("api_key",))
        self.assertEqual(decision.detected_count, 1)
        self.assertIn("[API_KEY_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_value, decision.redacted_prompt_preview or "")

    def test_api_key_detector_ignores_bare_secret_and_short_token_values(self) -> None:
        evaluator = HeuristicSafetyEvaluator()

        for prompt in [
            "secret=internal note",
            "token budget is 3000",
            "token=short_demo",
        ]:
            with self.subTest(prompt=prompt):
                decision = evaluator.evaluate(
                    remote_context(),
                    remote_input(prompt, [detector("api_key", "block", "[API_KEY_REDACTED]")]),
                )

                self.assertEqual(decision.action, "none")
                self.assertEqual(decision.detected_count, 0)
                self.assertIsNone(decision.redacted_prompt_preview)

    def test_jwt_detector_blocks_long_synthetic_token(self) -> None:
        raw_token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.synthetic_signature_1234567890"
        evaluator = HeuristicSafetyEvaluator()
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(
                f"Review this token {raw_token}.",
                [detector("jwt", "block", "[JWT_REDACTED]")],
            ),
        )

        self.assertEqual(decision.action, "blocked")
        self.assertEqual(decision.detected_types, ("jwt",))
        self.assertEqual(decision.detected_count, 1)
        self.assertIn("[JWT_REDACTED]", decision.redacted_prompt_preview or "")
        self.assertNotIn(raw_token, decision.redacted_prompt_preview or "")

    def test_jwt_detector_ignores_short_or_non_jwt_triplets(self) -> None:
        evaluator = HeuristicSafetyEvaluator()

        for prompt in [
            "eyJ.a.b",
            "header.payload.signature",
        ]:
            with self.subTest(prompt=prompt):
                decision = evaluator.evaluate(
                    remote_context(),
                    remote_input(prompt, [detector("jwt", "block", "[JWT_REDACTED]")]),
                )

                self.assertEqual(decision.action, "none")
                self.assertEqual(decision.detected_count, 0)
                self.assertIsNone(decision.redacted_prompt_preview)

    def test_secret_block_detectors_block_high_confidence_values(self) -> None:
        cases = [
            (
                "provider_api_key",
                "[PROVIDER_API_KEY_REDACTED]",
                "sk-redactedDemoProviderKey1234567890",
                "Provider key sk-redactedDemoProviderKey1234567890 was pasted.",
            ),
            (
                "cloud_access_key",
                "[CLOUD_ACCESS_KEY_REDACTED]",
                "AKIAREDACTEDDEMO1234",
                "Cloud key AKIAREDACTEDDEMO1234 was pasted.",
            ),
            (
                "github_token",
                "[GITHUB_TOKEN_REDACTED]",
                "ghp_redactedDemoToken1234567890",
                "GitHub token ghp_redactedDemoToken1234567890 was pasted.",
            ),
            (
                "slack_token",
                "[SLACK_TOKEN_REDACTED]",
                "xoxb-redacted-demo-token-1234567890",
                "Slack token xoxb-redacted-demo-token-1234567890 was pasted.",
            ),
            (
                "database_url",
                "[DATABASE_URL_REDACTED]",
                "postgres://demo_user:demoPass123456@db.local/app",
                "DATABASE_URL=postgres://demo_user:demoPass123456@db.local/app",
            ),
            (
                "webhook_url",
                "[WEBHOOK_URL_REDACTED]",
                "https://hooks.slack.com/services/T00000000/B00000000/redactedWebhookToken1234567890",
                "Webhook https://hooks.slack.com/services/T00000000/B00000000/redactedWebhookToken1234567890",
            ),
            (
                "password_assignment",
                "[PASSWORD_REDACTED]",
                "demoPassword123456!",
                "password=demoPassword123456!",
            ),
            (
                "session_cookie",
                "[SESSION_COOKIE_REDACTED]",
                "demoSessionToken1234567890abcdef",
                "Cookie: session=demoSessionToken1234567890abcdef",
            ),
        ]

        for detector_type, placeholder, raw_value, prompt in cases:
            with self.subTest(detector_type=detector_type):
                assert_blocked_detector(self, prompt, detector_type, placeholder, raw_value)

    def test_secret_block_detectors_ignore_low_confidence_values(self) -> None:
        cases = {
            "provider_api_key": [
                "sketch-123",
                "hf model name",
                "sk-demo",
            ],
            "cloud_access_key": [
                "asia region",
                "akia",
                "cloud_access_key=short_demo",
            ],
            "github_token": [
                "github token required",
                "ghp_short",
                "github_pat_short",
            ],
            "slack_token": [
                "xoxb-short",
                "slack token xoxb missing",
            ],
            "database_url": [
                "postgres://localhost/app",
                "postgres://demo_user@localhost/app",
            ],
            "webhook_url": [
                "https://api.github.com/repos/acme/demo/hooks/123",
                "https://discord.com/api/webhooks/123/short",
            ],
            "password_assignment": [
                "password is required",
                "password=short",
                "password=internal note",
            ],
            "session_cookie": [
                "Cookie: theme=dark",
                "Set-Cookie: session=short",
            ],
        }

        for detector_type, prompts in cases.items():
            with self.subTest(detector_type=detector_type):
                assert_ignored_prompts(self, detector_type, prompts)

    def test_structural_secret_detectors_win_over_inner_token_matches(self) -> None:
        jwt_token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vIn0.synthetic_signature_1234567890"
        cases = [
            (
                "session_cookie",
                "Cookie: access_token=test_access_token_redacted_demo_1234567890abcdef",
                [
                    detector("session_cookie", "block", "[SESSION_COOKIE_REDACTED]"),
                    detector("api_key", "block", "[API_KEY_REDACTED]"),
                ],
            ),
            (
                "database_url",
                "postgres://demo_user:password123456@db.local/app",
                [
                    detector("database_url", "block", "[DATABASE_URL_REDACTED]"),
                    detector("password_assignment", "block", "[PASSWORD_REDACTED]"),
                ],
            ),
            (
                "authorization_header",
                f"Authorization: Bearer {jwt_token}",
                [
                    detector("authorization_header", "block", "[AUTHORIZATION_HEADER_REDACTED]"),
                    detector("jwt", "block", "[JWT_REDACTED]"),
                ],
            ),
        ]

        evaluator = HeuristicSafetyEvaluator()
        for expected_type, prompt, detectors in cases:
            with self.subTest(expected_type=expected_type):
                decision = evaluator.evaluate(remote_context(), remote_input(prompt, detectors))

                self.assertEqual(decision.action, "blocked")
                self.assertEqual(decision.detected_types, (expected_type,))
                self.assertEqual(decision.detected_count, 1)

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


def assert_blocked_detector(
    test_case: unittest.TestCase,
    prompt: str,
    detector_type: str,
    placeholder: str,
    raw_value: str,
) -> None:
    evaluator = HeuristicSafetyEvaluator()
    decision = evaluator.evaluate(
        remote_context(),
        remote_input(prompt, [detector(detector_type, "block", placeholder)]),
    )

    test_case.assertEqual(decision.action, "blocked")
    test_case.assertEqual(decision.detected_types, (detector_type,))
    test_case.assertEqual(decision.detected_count, 1)
    test_case.assertIn(placeholder, decision.redacted_prompt_preview or "")
    test_case.assertNotIn(raw_value, decision.redacted_prompt_preview or "")


def assert_ignored_prompts(
    test_case: unittest.TestCase,
    detector_type: str,
    prompts: list[str],
) -> None:
    evaluator = HeuristicSafetyEvaluator()
    for prompt in prompts:
        decision = evaluator.evaluate(
            remote_context(),
            remote_input(prompt, [detector(detector_type, "block", f"[{detector_type.upper()}_REDACTED]")]),
        )

        test_case.assertEqual(decision.action, "none", prompt)
        test_case.assertEqual(decision.detected_count, 0, prompt)
        test_case.assertIsNone(decision.redacted_prompt_preview, prompt)


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
