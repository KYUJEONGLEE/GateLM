from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.adapters.safety import PrivacyFilterAdapter
from app.core.config import Settings
from app.domain.ai_safety_eval.master_corpus import (
    DetectorExpectation,
    GatewayExpectation,
    MasterEvalCase,
    TargetExpectations,
    load_master_eval_corpus,
)
from app.services.ai_safety_master_eval_runner import (
    MODEL_PROFILE_RULES_BOTH,
    MODEL_PROFILE_RULES_ONLY,
    REPORT_VERSION,
    DEFAULT_CORPUS_PATH,
    build_detector_service,
    build_detector_service_for_profile,
    build_master_detector_config,
    evaluate_master_corpus,
    force_load_detector_models,
    load_screening_subset,
    normalize_ml_confidence_threshold,
    parse_ml_allowed_detector_types,
    parse_ml_detector_thresholds,
    render_detector_eval_prompt,
    settings_for_model_profile,
    write_reports,
)
from app.services.ai_safety_detector import AiSafetyDetectorService
from app.services.ai_safety_model_ablation_runner import (
    KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS,
)


class AiSafetyMasterEvalRunnerTests(unittest.TestCase):
    def test_runner_report_uses_master_expectations_without_storing_rendered_prompts(self) -> None:
        cases = load_master_eval_corpus(DEFAULT_CORPUS_PATH)[:5]
        service = build_detector_service("fast-rules-noop-ml")

        report = evaluate_master_corpus(
            cases,
            service=service,
            corpus_path=DEFAULT_CORPUS_PATH,
            actual_source="fast-rules-noop-ml",
        )

        self.assertEqual(report["summary"]["totalCases"], 5)
        self.assertEqual(report["reportVersion"], REPORT_VERSION)
        self.assertEqual(report["actualSource"]["kind"], "fast-rules-noop-ml")
        self.assertEqual(report["actualSource"]["adapterLoadStates"], {"loaded": 1})
        self.assertEqual(report["actualSource"]["mlMinConfidence"], 0.7)
        self.assertIn("email", report["actualSource"]["mlDetectorThresholds"])
        self.assertIn("email", report["actualSource"]["mlAllowedDetectorTypes"])
        serialized = json.dumps(report, ensure_ascii=False)
        for case in cases:
            self.assertNotIn(render_detector_eval_prompt(case), serialized)
        self.assertIn("outcomeConfusion", report)
        self.assertIn("detectors", report)

    def test_runner_records_adapter_invocation_and_model_contribution_without_prompt_body(self) -> None:
        case = model_candidate_case()

        def classifier(text: str) -> list[object]:
            marker = "AliasValue"
            start = text.find(marker)
            if start == -1:
                return []
            return [
                {
                    "entity_group": "private_email",
                    "score": 0.99,
                    "start": start,
                    "end": start + len(marker),
                }
            ]

        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
            detectors=build_master_detector_config(),
        )
        report = evaluate_master_corpus(
            [case],
            service=service,
            corpus_path=DEFAULT_CORPUS_PATH,
            actual_source="instrumented-test",
        )

        adapter_stats = report["actualSource"]["adapterStats"][0]
        self.assertEqual(adapter_stats["modelInvocationCount"], 1)
        self.assertEqual(adapter_stats["acceptedDetectionCount"], 1)
        self.assertEqual(adapter_stats["acceptedDetectionsByDetectorType"], {"email": 1})
        self.assertEqual(adapter_stats["contributedCases"], 1)
        self.assertTrue(report["modelExecution"]["modelInvocationAccountingMatched"])
        self.assertTrue(report["modelExecution"]["acceptedDetectionAccountingMatched"])
        self.assertEqual(report["cases"][0]["actual"]["detectedCountsByType"], {"email": 1})
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn(case.input_template, serialized)
        self.assertNotIn("AliasValue", serialized)

    def test_rules_only_profile_has_no_supported_ml_types_or_model_invocation(self) -> None:
        service, source = build_detector_service_for_profile(MODEL_PROFILE_RULES_ONLY)
        report = evaluate_master_corpus(
            [model_candidate_case()],
            service=service,
            corpus_path=DEFAULT_CORPUS_PATH,
            actual_source=source,
        )

        adapter_stats = report["actualSource"]["adapterStats"][0]
        self.assertEqual(adapter_stats["supportedDetectorTypes"], [])
        self.assertEqual(adapter_stats["detectManyCalls"], 0)
        self.assertEqual(adapter_stats["inputWindowCount"], 0)
        self.assertEqual(adapter_stats["modelInvocationCount"], 0)
        self.assertEqual(report["modelExecution"]["executionModeCases"], {"rules_only": 1})

    def test_screening_subset_manifest_is_checksum_bound_and_balanced(self) -> None:
        cases = load_master_eval_corpus(DEFAULT_CORPUS_PATH)
        subset_path = (
            DEFAULT_CORPUS_PATH.parent / "pii-model-screening-subset-v1.json"
        )

        selected, metadata = load_screening_subset(
            subset_path,
            corpus_path=DEFAULT_CORPUS_PATH,
            cases=cases,
        )

        self.assertEqual(len(selected), 103)
        self.assertEqual(metadata["localeCounts"], {"en-US": 52, "ko-KR": 51})
        self.assertEqual(metadata["riskFalsePositiveCases"], 22)
        self.assertEqual(metadata["riskFalseNegativeCases"], 49)
        self.assertTrue(
            set(KNOWN_KOELECTRA_EMAIL_COUNT_CASE_IDS).issubset(
                {case.case_id for case in selected}
            )
        )

    def test_screening_subset_rejects_source_corpus_checksum_drift(self) -> None:
        cases = load_master_eval_corpus(DEFAULT_CORPUS_PATH)
        subset_path = DEFAULT_CORPUS_PATH.parent / "pii-model-screening-subset-v1.json"
        with tempfile.TemporaryDirectory() as temp_dir:
            drifted_corpus = Path(temp_dir) / "corpus.jsonl"
            drifted_corpus.write_bytes(DEFAULT_CORPUS_PATH.read_bytes() + b"\n")

            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                load_screening_subset(
                    subset_path,
                    corpus_path=drifted_corpus,
                    cases=cases,
                )

    def test_rules_both_profile_selects_only_known_configured_models(self) -> None:
        settings = Settings(
            ai_safety_detector_model_id=(
                ".cache/onnx/releases/test/openai--privacy-filter"
            ),
            ai_safety_additional_detector_model_ids=(
                ".cache/onnx/releases/test/amoeba04--koelectra-small-v3-privacy-ner-quantized",
            ),
        )

        selected = settings_for_model_profile(settings, MODEL_PROFILE_RULES_BOTH)

        self.assertEqual(selected.ai_safety_detector_model_id, settings.ai_safety_detector_model_id)
        self.assertEqual(
            selected.ai_safety_additional_detector_model_ids,
            settings.ai_safety_additional_detector_model_ids,
        )

    def test_runner_writes_json_and_markdown_reports(self) -> None:
        cases = load_master_eval_corpus(DEFAULT_CORPUS_PATH)[:3]
        service = build_detector_service("fast-rules-noop-ml")
        report = evaluate_master_corpus(
            cases,
            service=service,
            corpus_path=DEFAULT_CORPUS_PATH,
            actual_source="fast-rules-noop-ml",
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            json_path, markdown_path = write_reports(report, Path(temp_dir))

            self.assertTrue(json_path.exists())
            self.assertTrue(markdown_path.exists())
            self.assertIn("Master Corpus Eval Report", markdown_path.read_text(encoding="utf-8"))

    def test_force_load_detector_models_calls_each_adapter_before_eval(self) -> None:
        calls: list[str] = []

        def classifier(text: str) -> list[object]:
            calls.append(text)
            return []

        service = AiSafetyDetectorService(
            adapter=PrivacyFilterAdapter(classifier=classifier),
            detectors=build_master_detector_config(),
        )

        force_load_detector_models(service)

        self.assertEqual(len(calls), 1)
        self.assertEqual(service.adapters[0].load_state, "loaded")

    def test_build_detector_service_applies_eval_threshold_override(self) -> None:
        service = build_detector_service("fast-rules-noop-ml", ml_min_confidence=0.97)

        self.assertEqual(service.adapters[0].min_confidence, 0.97)
        self.assertEqual(set(service.adapters[0].min_confidence_by_detector_type.values()), {0.97})

    def test_build_detector_service_applies_detector_threshold_overrides(self) -> None:
        service = build_detector_service(
            "fast-rules-noop-ml",
            ml_min_confidence=0.9,
            ml_detector_thresholds={"email": 0.6, "person_name": 0.98},
        )

        self.assertEqual(service.adapters[0].min_confidence, 0.9)
        self.assertEqual(service.adapters[0].min_confidence_by_detector_type["email"], 0.6)
        self.assertEqual(service.adapters[0].min_confidence_by_detector_type["person_name"], 0.98)
        self.assertEqual(service.adapters[0].min_confidence_by_detector_type["phone_number"], 0.9)

    def test_build_detector_service_filters_ml_label_map_by_allowlist(self) -> None:
        service = build_detector_service(
            "fast-rules-noop-ml",
            ml_allowed_detector_types=frozenset({"email", "phone_number"}),
        )

        self.assertEqual(set(service.adapters[0].label_map.values()), {"email", "phone_number"})

    def test_normalize_ml_confidence_threshold_rejects_out_of_range_value(self) -> None:
        with self.assertRaisesRegex(ValueError, "between 0 and 1"):
            normalize_ml_confidence_threshold(1.1)

    def test_parse_ml_detector_thresholds_accepts_repeated_and_csv_values(self) -> None:
        self.assertEqual(
            parse_ml_detector_thresholds(["email=0.8,phone_number=0.6", "person_name=0.99"]),
            {"email": 0.8, "phone_number": 0.6, "person_name": 0.99},
        )

    def test_parse_ml_allowed_detector_types_accepts_repeated_and_csv_values(self) -> None:
        self.assertEqual(
            parse_ml_allowed_detector_types(["email,phone_number", "private_url"]),
            frozenset({"email", "phone_number", "private_url"}),
        )


def model_candidate_case() -> MasterEvalCase:
    return MasterEvalCase(
        case_id="instrumented_model_candidate",
        locale="en-US",
        input_template="Review email AliasValue for internal support.",
        placeholder_bindings={},
        expectations=TargetExpectations(
            gateway=GatewayExpectation(
                safety_outcome="redacted",
                provider_called=True,
                cache_lookup=False,
                streaming_started=False,
                terminal_status="success",
                http_status=200,
                error_code=None,
            ),
            detector=DetectorExpectation(
                outcome="redacted",
                mode="enforce",
                detected_types=("email",),
                detected_count=1,
                block_reason=None,
            ),
        ),
        tags=("detector-email", "risk-false-negative"),
    )


if __name__ == "__main__":
    unittest.main()
