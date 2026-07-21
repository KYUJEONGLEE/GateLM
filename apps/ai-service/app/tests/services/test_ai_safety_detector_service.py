from __future__ import annotations

import unittest

from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_MODEL,
    KOELECTRA_PRIVACY_NER_MODEL,
    PrivacyFilterAdapter,
)
from app.domain.safety.signals import SafetySignal
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION,
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AiSafetyBatchDetectRequest,
    AiSafetyBatchInput,
    AiSafetyDetectRequest,
    AiSafetyDetectorConfig,
    AiSafetyDetectorInput,
    AiSafetyDetectorPolicy,
    SafetyDetector,
)
from app.services.ai_safety_detector import (
    ML_MAX_CANDIDATES_PER_REQUEST,
    ML_WINDOW_MAX_CHARS,
    AiSafetyDetectorService,
    MlCandidate,
    _ml_candidates_from_rule_signals,
)


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

    def test_ml_allowlist_filters_model_labels_but_keeps_rules_enabled(self) -> None:
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return []

        adapter = PrivacyFilterAdapter(
            classifier=classifier,
            allowed_detector_types=frozenset({"phone_number", "secret"}),
        )
        service = AiSafetyDetectorService(
            adapter=adapter,
            ml_allowed_detector_types=("phone_number", "secret"),
        )

        response = service.detect(detect_request("Contact rule-only@example.test."))

        self.assertEqual(adapter.supported_detector_types, {"phone_number", "secret"})
        self.assertEqual(service.configured_ml_detector_types(), ["phone_number", "secret"])
        self.assertEqual(classifier_calls, 0)
        self.assertEqual(response.execution_summary.execution_mode, "rules_only")
        self.assertEqual(response.detector_summary.detector_categories, ["email"])

    def test_ml_threshold_overrides_are_merged_with_safe_defaults(self) -> None:
        service = AiSafetyDetectorService(
            ml_min_confidence_by_detector_type={
                "organization_name": 0.9,
                "person_name": 0.9,
                "phone_number": 0.99,
                "postal_address": 0.9,
            },
        )

        thresholds = service.adapter.min_confidence_by_detector_type
        self.assertEqual(thresholds["organization_name"], 0.9)
        self.assertEqual(thresholds["person_name"], 0.9)
        self.assertEqual(thresholds["phone_number"], 0.99)
        self.assertEqual(thresholds["postal_address"], 0.9)
        self.assertIn("secret", thresholds)

    def test_ml_allowlist_rejects_detector_type_unsupported_by_model(self) -> None:
        with self.assertRaisesRegex(ValueError, "does not support"):
            AiSafetyDetectorService(
                model_id="openai/privacy-filter",
                ml_allowed_detector_types=("person_name",),
            )

    def test_person_name_model_only_requires_person_name_model_support(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires person_name"):
            AiSafetyDetectorService(
                adapter=PrivacyFilterAdapter(
                    classifier=lambda _text: [],
                    allowed_detector_types=frozenset({"phone_number"}),
                ),
                ml_allowed_detector_types=("phone_number",),
                person_name_model_only=True,
            )

    def test_person_name_model_only_rejects_rule_false_positive(self) -> None:
        prompt = "고객 문의"
        rule_response = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda _text: [],
                model_name=GATELM_KOELECTRA_PII_NER_MODEL,
                allowed_detector_types=frozenset({"person_name"}),
            ),
            ml_allowed_detector_types=("person_name",),
        ).detect(detect_request(prompt))
        classifier_inputs: list[str] = []
        model_only_response = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda text: classifier_inputs.append(text) or [],
                model_name=GATELM_KOELECTRA_PII_NER_MODEL,
                allowed_detector_types=frozenset({"person_name"}),
            ),
            ml_allowed_detector_types=("person_name",),
            person_name_model_only=True,
        ).detect(detect_request(prompt))

        self.assertEqual(rule_response.detector_summary.detector_categories, ["person_name"])
        self.assertEqual(len(classifier_inputs), 1)
        self.assertEqual(model_only_response.outcome, "passed")
        self.assertEqual(model_only_response.detector_summary.detector_categories, [])

    def test_person_name_model_only_keeps_other_rules_and_accepts_model_name(self) -> None:
        prompt = "고객 김민수의 이메일은 person-model-only@example.test 입니다."
        name_start = prompt.index("김민수")
        thresholds = {"person_name": 0.9}
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda _text: [
                    {
                        "entity_group": "PER",
                        "score": 0.95,
                        "start": name_start,
                        "end": name_start + len("김민수"),
                    }
                ],
                model_name=GATELM_KOELECTRA_PII_NER_MODEL,
                min_confidence_by_detector_type=thresholds,
                allowed_detector_types=frozenset({"person_name"}),
            ),
            ml_allowed_detector_types=("person_name",),
            ml_min_confidence_by_detector_type=thresholds,
            person_name_model_only=True,
        )

        response = service.detect(detect_request(prompt))

        self.assertEqual(response.outcome, "redacted")
        self.assertEqual(
            response.detector_summary.detector_categories,
            ["email", "person_name"],
        )
        self.assertEqual(response.execution_summary.accepted_model_detection_count, 1)
        self.assertNotIn("김민수", response.redacted_prompt)
        self.assertNotIn("person-model-only@example.test", response.redacted_prompt)

    def test_person_name_model_only_keeps_non_person_ml_types_enabled(self) -> None:
        prompt = "Contact Minseo Kim at BlueStone Synthetic."
        person_name = "Minseo Kim"
        organization_name = "BlueStone Synthetic"
        thresholds = {"person_name": 0.9, "organization_name": 0.9}
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda _text: [
                    {
                        "entity_group": "PER",
                        "score": 0.95,
                        "start": prompt.index(person_name),
                        "end": prompt.index(person_name) + len(person_name),
                    },
                    {
                        "entity_group": "ORG",
                        "score": 0.96,
                        "start": prompt.index(organization_name),
                        "end": prompt.index(organization_name) + len(organization_name),
                    },
                ],
                model_name=GATELM_KOELECTRA_PII_NER_MODEL,
                min_confidence_by_detector_type=thresholds,
                allowed_detector_types=frozenset(
                    {"person_name", "organization_name"}
                ),
            ),
            ml_allowed_detector_types=("person_name", "organization_name"),
            ml_min_confidence_by_detector_type=thresholds,
            person_name_model_only=True,
        )

        response = service.detect(detect_request(prompt))

        self.assertEqual(
            service.configured_ml_detector_types(),
            ["organization_name", "person_name"],
        )
        self.assertEqual(
            response.detector_summary.detector_categories,
            ["organization_name", "person_name"],
        )
        self.assertEqual(response.execution_summary.accepted_model_detection_count, 2)

    def test_person_name_model_only_handles_full_batch_without_duplicate_candidates(self) -> None:
        classifier = RecordingBatchClassifier()
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=classifier,
                model_name=GATELM_KOELECTRA_PII_NER_MODEL,
                allowed_detector_types=frozenset({"person_name"}),
            ),
            ml_allowed_detector_types=("person_name",),
            person_name_model_only=True,
        )

        response = service.detect_batch(
            batch_request(*("고객 김민수의 문의" for _ in range(64)))
        )

        self.assertEqual(len(response.results), 64)
        self.assertTrue(all(item.outcome == "passed" for item in response.results))

    def test_person_name_rule_candidate_deduplicates_only_same_detector_type(self) -> None:
        prompt = "김민수"
        signal = SafetySignal(
            detector_type="person_name",
            start=0,
            end=len(prompt),
            action="redact",
            placeholder="[PERSON_NAME_REDACTED]",
            priority=1,
        )

        different_type_candidates = _ml_candidates_from_rule_signals(
            prompt,
            [signal],
            {"email", "person_name"},
            existing_candidates=[
                MlCandidate(0, len(prompt), frozenset({"email"})),
            ],
        )
        same_type_candidates = _ml_candidates_from_rule_signals(
            prompt,
            [signal],
            {"email", "person_name"},
            existing_candidates=[
                MlCandidate(0, len(prompt), frozenset({"person_name"})),
            ],
        )

        self.assertEqual(
            different_type_candidates,
            [MlCandidate(0, len(prompt), frozenset({"person_name"}))],
        )
        self.assertEqual(same_type_candidates, [])

    def test_ml_allowlist_discards_disallowed_output_from_injected_adapter(self) -> None:
        prompt = "secret reference synthetic marker"
        marker_start = prompt.index("synthetic")
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(
                classifier=lambda _text: [
                    {
                        "entity_group": "private_url",
                        "score": 0.99,
                        "start": marker_start,
                        "end": marker_start + len("synthetic"),
                    }
                ]
            ),
            ml_allowed_detector_types=("phone_number", "secret"),
        )

        response = service.detect(detect_request(prompt))

        self.assertEqual(response.execution_summary.execution_mode, "hybrid")
        self.assertEqual(response.execution_summary.accepted_model_detection_count, 0)
        self.assertNotIn(
            "private_url",
            response.detector_summary.detector_categories,
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

    def test_warmup_runs_every_configured_adapter(self) -> None:
        calls: list[str] = []
        service = AiSafetyDetectorService(
            adapters=(
                PrivacyFilterAdapter(classifier=lambda text: calls.append(f"primary:{text}") or []),
                PrivacyFilterAdapter(
                    classifier=lambda text: calls.append(f"additional:{text}") or [],
                    model_name=KOELECTRA_PRIVACY_NER_MODEL,
                ),
            )
        )

        service.warmup()

        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0].startswith("primary:"))
        self.assertTrue(calls[1].startswith("additional:"))

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

    def test_detect_rules_cover_resident_number_followed_by_korean_particle(self) -> None:
        classifier_calls = 0

        def classifier(_text: str) -> list[object]:
            nonlocal classifier_calls
            classifier_calls += 1
            return []

        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )

        response = service.detect(
            detect_request("주민등록번호 900101-1234567은 외부로 보내면 안 됩니다.")
        )

        self.assertEqual(classifier_calls, 0)
        self.assertEqual(response.outcome, "blocked")
        self.assertEqual(
            response.detector_summary.detector_categories,
            ["resident_registration_number"],
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

    def test_detect_applies_request_detector_policy_override(self) -> None:
        prompt = "Share policy-owner@example.invalid externally."
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
        )

        allowed = service.detect(
            AiSafetyDetectRequest(
                contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
                input=AiSafetyDetectorInput(promptText=prompt),
                detectorConfig=AiSafetyDetectorConfig(
                    returnConfidence=False,
                    detectorPolicies=(
                        AiSafetyDetectorPolicy(detectorType="email", action="allow"),
                    ),
                ),
            )
        )
        blocked = service.detect(
            AiSafetyDetectRequest(
                contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
                mode="enforce",
                input=AiSafetyDetectorInput(promptText=prompt),
                detectorConfig=AiSafetyDetectorConfig(
                    returnConfidence=False,
                    detectorPolicies=(
                        AiSafetyDetectorPolicy(detectorType="email", action="block"),
                    ),
                ),
            )
        )

        self.assertEqual(allowed.outcome, "passed")
        self.assertEqual(allowed.redacted_prompt, prompt)
        self.assertNotIn("policy-owner@example.invalid", allowed.log_safe_prompt)
        self.assertNotIn("policy-owner@example.invalid", allowed.redacted_prompt_preview or "")
        self.assertEqual(allowed.detections[0].action, "allow")
        self.assertEqual(blocked.outcome, "blocked")
        self.assertEqual(blocked.mode, "enforce")
        self.assertNotIn("policy-owner@example.invalid", blocked.redacted_prompt)
        self.assertEqual(blocked.detections[0].action, "block")
        self.assertEqual(blocked.detections[0].mode, "enforce")

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

    def test_batch_skips_models_for_person_and_organization_only_candidates(self) -> None:
        classifier = RecordingBatchClassifier(fail_if_called=True)
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )

        response = service.detect_batch(
            batch_request(
                "Candidate name is Alex Kim.",
                "Organization is Acme Synthetic.",
            )
        )

        self.assertEqual(classifier.calls, 0)
        self.assertEqual(response.execution_summary.execution_mode, "rules_only")
        self.assertEqual(response.execution_summary.model_invocation_count, 0)
        self.assertEqual([item.item_index for item in response.results], [0, 1])

    def test_batch_runs_supported_candidate_in_one_dynamic_model_invocation(self) -> None:
        value = "tenant-link-value"
        classifier = RecordingBatchClassifier(
            detector_label="private_url",
            detected_value=value,
        )
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )

        response = service.detect_batch(
            batch_request(
                f"Review private URL {value} before handoff.",
                f"Rotate secret {value} before handoff.",
            )
        )

        self.assertEqual(classifier.calls, 1)
        self.assertEqual(response.execution_summary.execution_mode, "hybrid")
        self.assertEqual(response.execution_summary.model_invocation_count, 1)
        self.assertGreaterEqual(response.execution_summary.accepted_model_detection_count, 1)
        self.assertEqual([item.item_index for item in response.results], [0, 1])
        self.assertNotIn(value, response.results[0].log_safe_prompt)

    def test_batch_model_detections_continue_seeded_placeholder_counters(self) -> None:
        values = ("alpha-mail-token", "beta-mail-token")

        def classifier(text: str) -> list[object]:
            detections: list[object] = []
            for value in values:
                start = text.find(value)
                if start < 0:
                    continue
                detections.append(
                    {
                        "entity_group": "private_email",
                        "score": 0.99,
                        "start": start,
                        "end": start + len(value),
                    }
                )
            return detections

        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )

        response = service.detect_batch(
            batch_request(
                f"Inspect production email {values[0]} before release.",
                f"Inspect production email {values[1]} before release.",
                placeholder_counters={"EMAIL": 3},
            )
        )

        self.assertEqual(response.execution_summary.execution_mode, "hybrid")
        self.assertEqual(response.execution_summary.accepted_model_detection_count, 2)
        self.assertIn("[EMAIL_4]", response.results[0].redacted_prompt)
        self.assertIn("[EMAIL_5]", response.results[1].redacted_prompt)
        self.assertNotIn(values[0], response.results[0].log_safe_prompt)
        self.assertNotIn(values[1], response.results[1].log_safe_prompt)

    def test_batch_results_match_single_detection_semantics(self) -> None:
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=lambda _text: []),
        )
        prompts = (
            "Contact batch-equivalence@example.test.",
            "Write a safe handoff note.",
        )

        batch = service.detect_batch(batch_request(*prompts))
        singles = [service.detect(detect_request(prompt)) for prompt in prompts]

        for batch_item, single in zip(batch.results, singles, strict=True):
            self.assertEqual(batch_item.outcome, single.outcome)
            self.assertEqual(batch_item.redacted_prompt, single.redacted_prompt)
            self.assertEqual(batch_item.log_safe_prompt, single.log_safe_prompt)
            self.assertEqual(batch_item.detector_summary, single.detector_summary)

    def test_long_prompt_model_window_excludes_covered_unrelated_rule_signal(self) -> None:
        private_url_value = "tenant-link-value"
        covered_email = "covered-window@example.test"
        classifier = RecordingBatchClassifier(
            detector_label="private_url",
            detected_value=private_url_value,
        )
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )
        prompt = (
            f"Contact {covered_email}. "
            + ("neutral context " * 120)
            + f"Review private URL {private_url_value}."
        )

        response = service.detect_batch(batch_request(prompt))

        self.assertEqual(response.execution_summary.execution_mode, "hybrid")
        self.assertTrue(classifier.seen_texts)
        self.assertTrue(all(covered_email not in text for text in classifier.seen_texts))

    def test_long_prompt_keeps_late_candidate_in_a_bounded_model_window(self) -> None:
        late_value = "late-model-value"
        classifier = RecordingBatchClassifier(
            detector_label="private_url",
            detected_value=late_value,
        )
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )
        prompt = (
            "Review private URL early-model-value. "
            + ("neutral context " * 180)
            + f"Review private URL {late_value}."
        )

        response = service.detect_batch(batch_request(prompt))

        self.assertTrue(classifier.seen_texts)
        self.assertTrue(all(len(text) <= ML_WINDOW_MAX_CHARS for text in classifier.seen_texts))
        self.assertTrue(any(late_value in text for text in classifier.seen_texts))
        self.assertNotIn(late_value, response.results[0].log_safe_prompt)

    def test_excessive_model_candidates_fail_before_classifier_invocation(self) -> None:
        private_marker = "private-window-marker"
        classifier = RecordingBatchClassifier()
        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
        )
        prompt = (
            f"Review private URL {private_marker}. "
            * (ML_MAX_CANDIDATES_PER_REQUEST + 1)
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "^AI safety model work limit exceeded[.]$",
        ) as raised:
            service.detect_batch(batch_request(prompt))

        self.assertEqual(classifier.calls, 0)
        self.assertNotIn(private_marker, str(raised.exception))


def detect_request(prompt: str) -> AiSafetyDetectRequest:
    return AiSafetyDetectRequest(
        contractVersion=AI_SAFETY_DETECTOR_CONTRACT_VERSION,
        input=AiSafetyDetectorInput(promptText=prompt),
        detectorConfig=AiSafetyDetectorConfig(returnConfidence=False),
    )


def batch_request(
    *prompts: str,
    placeholder_counters: dict[str, int] | None = None,
) -> AiSafetyBatchDetectRequest:
    return AiSafetyBatchDetectRequest(
        contractVersion=AI_SAFETY_DETECTOR_BATCH_CONTRACT_VERSION,
        mode="enforce",
        inputs=[
            AiSafetyBatchInput(itemIndex=index, promptText=prompt)
            for index, prompt in enumerate(prompts)
        ],
        placeholderCounters=placeholder_counters or {},
        detectorConfig=AiSafetyDetectorConfig(returnConfidence=False),
    )


class RecordingBatchClassifier:
    def __init__(
        self,
        *,
        detector_label: str = "private_url",
        detected_value: str = "",
        fail_if_called: bool = False,
    ) -> None:
        self.detector_label = detector_label
        self.detected_value = detected_value
        self.fail_if_called = fail_if_called
        self.calls = 0
        self.seen_texts: list[str] = []

    def __call__(self, text: str) -> list[object]:
        return self.classify_many([text])[0]

    def classify_many(self, texts: list[str]) -> list[list[object]]:
        self.calls += 1
        self.seen_texts.extend(texts)
        if self.fail_if_called:
            raise AssertionError("model classifier must not be called")
        results: list[list[object]] = []
        for text in texts:
            start = text.find(self.detected_value)
            if self.detected_value == "" or start < 0:
                results.append([])
                continue
            results.append(
                [
                    {
                        "entity_group": self.detector_label,
                        "score": 0.99,
                        "start": start,
                        "end": start + len(self.detected_value),
                    }
                ]
            )
        return results


def detector(detector_type: str, action: str, placeholder: str) -> SafetyDetector:
    return SafetyDetector(
        type=detector_type,
        enabled=True,
        action=action,
        placeholder=placeholder,
    )


if __name__ == "__main__":
    unittest.main()
