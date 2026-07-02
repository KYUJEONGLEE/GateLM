from __future__ import annotations

import re
import unittest

from app.adapters.safety.noop_evaluator import NoopSafetyEvaluator
from app.adapters.safety.heuristic_evaluator import (
    CREDIT_CARD_CANDIDATE_PATTERN,
    IP_ADDRESS_CANDIDATE_PATTERN,
    HeuristicSafetyEvaluator,
    RegexDetector,
)
from app.domain.safety.policy import PREVIEW_MAX_CHARS, effective_signals, redact_prompt
from app.domain.safety.signals import SafetySignal
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
        self.assertIn("[EMAIL_1]", decision.redacted_prompt_preview or "")
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

    def test_financial_and_identity_block_detectors_block_high_confidence_values(self) -> None:
        cases = [
            (
                "credit_card",
                "[CREDIT_CARD_REDACTED]",
                "4111 1111 1111 1111",
                "card_number=4111 1111 1111 1111",
            ),
            (
                "credit_card",
                "[CREDIT_CARD_REDACTED]",
                "5555-5555-5555-4444",
                "payment card: 5555-5555-5555-4444",
            ),
            (
                "bank_account",
                "[BANK_ACCOUNT_REDACTED]",
                "110-123-456789",
                "계좌번호: 110-123-456789",
            ),
            (
                "passport_number",
                "[PASSPORT_NUMBER_REDACTED]",
                "M12345678",
                "passport_no=M12345678",
            ),
            (
                "driver_license",
                "[DRIVER_LICENSE_REDACTED]",
                "12-34-567890-12",
                "driver_license=12-34-567890-12",
            ),
        ]

        for detector_type, placeholder, raw_value, prompt in cases:
            with self.subTest(detector_type=detector_type, raw_value=raw_value):
                assert_blocked_detector(self, prompt, detector_type, placeholder, raw_value)

    def test_financial_and_identity_block_detectors_ignore_low_confidence_values(self) -> None:
        cases = {
            "credit_card": [
                "order_id=1234567890123456",
                "card number is required",
                "card_number=4111 1111 1111 1112",
            ],
            "bank_account": [
                "account is required",
                "account_id=acct_1234567890",
                "주문번호: 123456789012",
            ],
            "passport_number": [
                "passport renewal guide",
                "M12345678",
                "문서번호: M12345678",
            ],
            "driver_license": [
                "driver license is required",
                "123456789012",
                "ticket_number=123456789012",
            ],
        }

        for detector_type, prompts in cases.items():
            with self.subTest(detector_type=detector_type):
                assert_ignored_prompts(self, detector_type, prompts)

    def test_pii_redact_detectors_redact_high_confidence_values(self) -> None:
        cases = [
            (
                "postal_address",
                "[ADDRESS_REDACTED]",
                "서울시 강남구 테헤란로 123",
                "주소: 서울시 강남구 테헤란로 123",
            ),
            (
                "date_of_birth",
                "[DATE_OF_BIRTH_REDACTED]",
                "1998-03-12",
                "생년월일: 1998-03-12",
            ),
            (
                "person_name",
                "[PERSON_NAME_REDACTED]",
                "홍길동",
                "이름: 홍길동",
            ),
            (
                "customer_id",
                "[CUSTOMER_ID_REDACTED]",
                "cus_1234567890",
                "customer_id=cus_1234567890",
            ),
            (
                "employee_id",
                "[EMPLOYEE_ID_REDACTED]",
                "E123456",
                "employee_id=E123456",
            ),
            (
                "account_id",
                "[ACCOUNT_ID_REDACTED]",
                "acct_1234567890",
                "account_id=acct_1234567890",
            ),
            (
                "ip_address",
                "[IP_ADDRESS_REDACTED]",
                "8.8.8.8",
                "source ip 8.8.8.8",
            ),
            (
                "ip_address",
                "[IP_ADDRESS_REDACTED]",
                "2606:4700:4700::1111",
                "source ip 2606:4700:4700::1111",
            ),
        ]

        for detector_type, placeholder, raw_value, prompt in cases:
            with self.subTest(detector_type=detector_type, raw_value=raw_value):
                assert_redacted_detector(self, prompt, detector_type, placeholder, raw_value)

    def test_pii_redact_detectors_ignore_low_confidence_values(self) -> None:
        cases = {
            "postal_address": [
                "주소를 알려주세요",
                "서울시 강남구 테헤란로를 분석해줘",
            ],
            "date_of_birth": [
                "meeting date 1998-03-12",
                "1998년 프로젝트를 요약해줘",
            ],
            "person_name": [
                "홍길동은 한국 소설의 인물이다",
                "Kim model routing test",
            ],
            "customer_id": [
                "customer id is required",
                "회원번호를 확인해 주세요",
            ],
            "employee_id": [
                "employee id is required",
                "사번을 입력해 주세요",
            ],
            "account_id": [
                "account id field is missing",
                "계정번호를 확인해 주세요",
            ],
            "ip_address": [
                "127.0.0.1",
                "localhost",
                "10.0.0.8",
                "192.168.0.2",
                "172.16.0.2",
                "2001:db8::1",
            ],
        }

        for detector_type, prompts in cases.items():
            with self.subTest(detector_type=detector_type):
                assert_ignored_prompts(self, detector_type, prompts)

    def test_candidate_patterns_restrict_digit_matching_to_ascii(self) -> None:
        unicode_ipv4_digits = "\u0668.\u0668.\u0668.\u0668"
        unicode_card_digits = "\u0664\u0661\u0661\u0661 \u0661\u0661\u0661\u0661 \u0661\u0661\u0661\u0661 \u0661\u0661\u0661\u0661"

        self.assertIsNone(IP_ADDRESS_CANDIDATE_PATTERN.search(unicode_ipv4_digits))
        self.assertIsNone(CREDIT_CARD_CANDIDATE_PATTERN.search(unicode_card_digits))

    def test_person_name_detector_is_label_based_only(self) -> None:
        assert_redacted_detector(
            self,
            "고객명=김민수",
            "person_name",
            "[PERSON_NAME_REDACTED]",
            "김민수",
        )
        assert_redacted_detector(
            self,
            "customer_name=Alex Kim",
            "person_name",
            "[PERSON_NAME_REDACTED]",
            "Alex Kim",
        )
        assert_ignored_prompts(
            self,
            "person_name",
            [
                "김민수 고객이 문의했다",
                "Alex Kim is a sample name",
            ],
        )

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

    def test_signal_span_trims_boundary_inner_spaces(self) -> None:
        prompt = "Contact ( alex@example.test ) for the synthetic demo."
        signal = SafetySignal(
            detector_type="email",
            start=prompt.index("("),
            end=prompt.index(")") + 1,
            action="redact",
            placeholder="[EMAIL_REDACTED]",
            priority=10,
        )

        signals = effective_signals([signal], prompt_text=prompt)

        self.assertEqual(len(signals), 1)
        self.assertEqual(prompt[signals[0].start : signals[0].end], "alex@example.test")
        self.assertEqual(
            redact_prompt(prompt, signals),
            "Contact ( [EMAIL_1] ) for the synthetic demo.",
        )

    def test_redact_prompt_uses_entity_consistent_placeholders_for_supported_pii(self) -> None:
        prompt = (
            "Contact Alex Kim at alex@example.test. "
            "Alex Kim can use alex@example.test or 010-0000-0000 and 010 0000 0000."
        )

        signals = [
            signal(prompt, "person_name", "Alex Kim", "[PERSON_NAME_REDACTED]"),
            signal(prompt, "email", "alex@example.test", "[EMAIL_REDACTED]"),
            signal(prompt, "person_name", "Alex Kim", "[PERSON_NAME_REDACTED]", occurrence=2),
            signal(prompt, "email", "alex@example.test", "[EMAIL_REDACTED]", occurrence=2),
            signal(prompt, "phone_number", "010-0000-0000", "[PHONE_NUMBER_REDACTED]"),
            signal(prompt, "phone_number", "010 0000 0000", "[PHONE_NUMBER_REDACTED]"),
        ]

        self.assertEqual(
            redact_prompt(prompt, signals),
            (
                "Contact [PERSON_1] at [EMAIL_1]. "
                "[PERSON_1] can use [EMAIL_1] or [PHONE_NUMBER_1] and [PHONE_NUMBER_1]."
            ),
        )

    def test_redact_prompt_uses_role_aware_placeholders_for_explicit_person_roles(self) -> None:
        prompt = (
            "customer Alex Kim asked agent Jamie Park. "
            "patient Alex Kim later called doctor Pat Lee. "
            "name Taylor Lee"
        )

        signals = [
            signal(prompt, "person_name", "Alex Kim", "[PERSON_NAME_REDACTED]"),
            signal(prompt, "person_name", "Jamie Park", "[PERSON_NAME_REDACTED]"),
            signal(prompt, "person_name", "Alex Kim", "[PERSON_NAME_REDACTED]", occurrence=2),
            signal(prompt, "person_name", "Pat Lee", "[PERSON_NAME_REDACTED]"),
            signal(prompt, "person_name", "Taylor Lee", "[PERSON_NAME_REDACTED]"),
        ]

        self.assertEqual(
            redact_prompt(prompt, signals),
            (
                "[CUSTOMER_1] asked [AGENT_1]. "
                "[CUSTOMER_1] later called [DOCTOR_1]. "
                "name [PERSON_1]"
            ),
        )

    def test_redact_prompt_uses_role_aware_placeholders_for_korean_person_roles(self) -> None:
        customer_name = "\uc774\uc724\uc9c0"
        agent_name = "\uae40\ubbfc\uc218"
        doctor_name = "\ubc15\uc9c0\ud6c8"
        patient_name = "\ucd5c\uc11c\uc5f0"
        prompt = (
            f"\uace0\uac1d {customer_name}\uac00 "
            f"\uc0c1\ub2f4\uc6d0 {agent_name}\uc5d0\uac8c \ud658\ubd88\uc744 \uc694\uccad\ud588\ub2e4. "
            f"\ub2f4\ub2f9 \uc758\uc0ac {doctor_name}\uc774 "
            f"\ud658\uc790 {patient_name}\uc5d0\uac8c \uc124\uba85\ud588\ub2e4."
        )

        signals = [
            signal(prompt, "person_name", customer_name, "[PERSON_NAME_REDACTED]"),
            signal(prompt, "person_name", agent_name, "[PERSON_NAME_REDACTED]"),
            signal(prompt, "person_name", doctor_name, "[PERSON_NAME_REDACTED]"),
            signal(prompt, "person_name", patient_name, "[PERSON_NAME_REDACTED]"),
        ]

        self.assertEqual(
            redact_prompt(prompt, signals),
            (
                "[CUSTOMER_1]\uac00 "
                "[AGENT_1]\uc5d0\uac8c \ud658\ubd88\uc744 \uc694\uccad\ud588\ub2e4. "
                "[DOCTOR_1]\uc774 "
                "[PATIENT_1]\uc5d0\uac8c \uc124\uba85\ud588\ub2e4."
            ),
        )

    def test_redact_prompt_keeps_block_placeholders_type_level(self) -> None:
        raw_secret = "syntheticSecretValue1234567890abcdef"
        prompt = f"Review secret {raw_secret} for Alex Kim."

        redacted = redact_prompt(
            prompt,
            [
                signal(prompt, "secret", raw_secret, "[SECRET_REDACTED]", action="block"),
                signal(prompt, "person_name", "Alex Kim", "[PERSON_NAME_REDACTED]"),
            ],
        )

        self.assertEqual(redacted, "Review secret [SECRET_REDACTED] for [PERSON_1].")
        self.assertNotIn(raw_secret, redacted)

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


def assert_redacted_detector(
    test_case: unittest.TestCase,
    prompt: str,
    detector_type: str,
    placeholder: str,
    raw_value: str,
) -> None:
    evaluator = HeuristicSafetyEvaluator()
    decision = evaluator.evaluate(
        remote_context(),
        remote_input(prompt, [detector(detector_type, "redact", placeholder)]),
    )

    test_case.assertEqual(decision.action, "redacted")
    test_case.assertEqual(decision.detected_types, (detector_type,))
    test_case.assertEqual(decision.detected_count, 1)
    test_case.assertIn(expected_placeholder(detector_type, placeholder), decision.redacted_prompt_preview or "")
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


def expected_placeholder(detector_type: str, fallback: str) -> str:
    return {
        "person_name": "[PERSON_1]",
        "organization_name": "[ORGANIZATION_1]",
        "postal_address": "[ADDRESS_1]",
        "email": "[EMAIL_1]",
        "phone_number": "[PHONE_NUMBER_1]",
    }.get(detector_type, fallback)


def signal(
    prompt: str,
    detector_type: str,
    raw_value: str,
    placeholder: str,
    *,
    action: str = "redact",
    occurrence: int = 1,
) -> SafetySignal:
    start = nth_index(prompt, raw_value, occurrence)
    return SafetySignal(
        detector_type=detector_type,
        start=start,
        end=start + len(raw_value),
        action=action,
        placeholder=placeholder,
        priority=10,
    )


def nth_index(text: str, value: str, occurrence: int) -> int:
    start = -1
    for _ in range(occurrence):
        start = text.index(value, start + 1)
    return start


if __name__ == "__main__":
    unittest.main()
