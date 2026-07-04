from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.adapters.safety import PrivacyFilterAdapter
from app.domain.ai_safety_eval.master_corpus import load_master_eval_corpus
from app.services.ai_safety_master_eval_runner import (
    DEFAULT_CORPUS_PATH,
    build_detector_service,
    build_master_detector_config,
    evaluate_master_corpus,
    force_load_detector_models,
    normalize_ml_confidence_threshold,
    parse_ml_allowed_detector_types,
    parse_ml_detector_thresholds,
    render_detector_eval_prompt,
    write_reports,
)
from app.services.ai_safety_detector import AiSafetyDetectorService


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


if __name__ == "__main__":
    unittest.main()
