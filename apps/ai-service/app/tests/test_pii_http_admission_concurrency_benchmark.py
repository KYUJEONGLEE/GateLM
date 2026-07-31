from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_SOURCE,
)
from app.api.dependencies import get_ai_safety_detector_service
from app.core.config import Settings
from app.domain.ai_safety_benchmark.types import BenchmarkCase, BenchmarkError
from app.main import create_app
from app.schemas.safety import AiSafetyDetectRequest, AiSafetyDetectResponse
from app.services.pii_http_admission_concurrency_benchmark_runner import (
    RenderedWorkload,
    bind_primary_model,
    build_parser,
    build_report,
    run_http_admission_waves,
    select_model_candidate_cases,
    write_safe_report,
)


INPUT_SENTINEL = "SYNTHETIC_INPUT_SENTINEL_MUST_NOT_BE_STORED"
OUTPUT_SENTINEL = "SYNTHETIC_OUTPUT_SENTINEL_MUST_NOT_BE_STORED"


class PiiHttpAdmissionConcurrencyBenchmarkTests(
    unittest.IsolatedAsyncioTestCase
):
    async def test_shared_gate_reports_busy_and_recovers_without_raw_data(
        self,
    ) -> None:
        service = DelayedHybridService(delay_seconds=0.04)
        app = create_app(Settings(ai_safety_max_concurrent=2))
        app.dependency_overrides[get_ai_safety_detector_service] = (
            lambda: service
        )
        workload = (
            RenderedWorkload(
                prompt_text=INPUT_SENTINEL,
                locale="ko-KR",
            ),
        )

        wave_summaries = await run_http_admission_waves(
            app=app,
            workload=workload,
            capacity=2,
            parallel_requests=6,
            waves=3,
            wave_timeout_seconds=2.0,
        )
        report = build_report(
            wave_summaries=wave_summaries,
            capacity=2,
            parallel_requests=6,
            waves=3,
            corpus_case_count=50,
            selected_workload_case_count=20,
            corpus_sha256="a" * 64,
            model_binding=canonical_model_binding(),
            primary_model_binding=primary_model_binding(),
            git_sha="b" * 40,
            generated_at=datetime(2026, 7, 31, tzinfo=timezone.utc),
        )

        self.assertEqual(service.peak_active, 2)
        self.assertEqual(service.active, 0)
        self.assertEqual(report["httpStatusCounts"]["200"], 6)
        self.assertEqual(report["httpStatusCounts"]["503"], 12)
        self.assertEqual(report["otherErrorCount"], 0)
        self.assertEqual(report["envelopeMismatchCount"], 0)
        self.assertEqual(report["hybridSuccessCount"], 6)
        self.assertEqual(report["modelInvocationCount"], 12)
        self.assertEqual(
            report["acceptedKoelectraSourceDetectionCount"],
            6,
        )
        self.assertTrue(report["slotRecoveryVerified"])
        self.assertTrue(
            report["eligibility"]["checks"]["slotRecoveryVerified"]
        )
        self.assertTrue(report["eligibility"]["eligible"])
        self.assertTrue(
            all(
                wave["httpStatusCounts"]["200"] == 2
                and wave["httpStatusCounts"]["503"] == 4
                for wave in wave_summaries
            )
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "aggregate.json"
            write_safe_report(report, report_path)
            report_text = report_path.read_text(encoding="utf-8")
            public_report = json.loads(report_text)

        self.assertNotIn(INPUT_SENTINEL, report_text)
        self.assertNotIn(OUTPUT_SENTINEL, report_text)
        self.assertNotIn("promptText", report_text)
        self.assertNotIn("redactedPrompt", report_text)
        self.assertNotIn("_samplesMs", report_text)
        self.assertEqual(public_report["httpStatusCounts"]["200"], 6)
        self.assertFalse(
            public_report["metadata"]["concurrencyRecommendation"]
        )

    async def test_report_is_ineligible_without_busy_or_koelectra_contribution(
        self,
    ) -> None:
        service = DelayedHybridService(
            delay_seconds=0.0,
            include_koelectra_detection=False,
        )
        app = create_app(Settings(ai_safety_max_concurrent=4))
        app.dependency_overrides[get_ai_safety_detector_service] = (
            lambda: service
        )
        summaries = await run_http_admission_waves(
            app=app,
            workload=(
                RenderedWorkload(
                    prompt_text=INPUT_SENTINEL,
                    locale=None,
                ),
            ),
            capacity=4,
            parallel_requests=5,
            waves=2,
            wave_timeout_seconds=2.0,
        )
        report = build_report(
            wave_summaries=summaries,
            capacity=4,
            parallel_requests=5,
            waves=2,
            corpus_case_count=50,
            selected_workload_case_count=20,
            corpus_sha256="c" * 64,
            model_binding=canonical_model_binding(),
            primary_model_binding=primary_model_binding(),
            git_sha="d" * 40,
        )

        self.assertFalse(report["eligibility"]["eligible"])
        self.assertFalse(
            report["eligibility"]["checks"][
                "koelectraAcceptedContributionObserved"
            ]
        )

    def test_primary_binding_supports_root_and_quantized_package_layouts(
        self,
    ) -> None:
        for layout in ("root", "quantized"):
            with self.subTest(layout=layout), tempfile.TemporaryDirectory() as temp_dir:
                model_dir = Path(temp_dir)
                required_contents = {
                    "config.json": b'{"model":"synthetic"}',
                    "tokenizer.json": b'{"tokenizer":"synthetic"}',
                    "tokenizer_config.json": b'{"config":"synthetic"}',
                }
                for name, content in required_contents.items():
                    (model_dir / name).write_bytes(content)
                if layout == "root":
                    (model_dir / "model.onnx").write_bytes(
                        b"synthetic-root-onnx"
                    )
                else:
                    (model_dir / "onnx").mkdir()
                    (model_dir / "onnx" / "model_quantized.onnx").write_bytes(
                        b"synthetic-quantized-onnx"
                    )
                    (
                        model_dir / "onnx" / "model_quantized.onnx_data"
                    ).write_bytes(b"synthetic-external-tensors")

                binding = bind_primary_model(model_dir)
                serialized = json.dumps(binding, sort_keys=True)

                self.assertEqual(
                    set(binding),
                    {"artifactRole", "runtime", "sha256", "bytes"},
                )
                self.assertEqual(binding["runtime"], "onnx")
                self.assertGreater(binding["bytes"], 0)
                self.assertNotIn(str(model_dir), serialized)
                self.assertNotIn("model.onnx", serialized)
                self.assertNotIn("model_quantized.onnx", serialized)
                self.assertNotIn("tokenizer.json", serialized)

                (model_dir / "tokenizer_config.json").unlink()
                with self.assertRaises(BenchmarkError):
                    bind_primary_model(model_dir)

    def test_safe_only_cases_are_excluded_from_model_candidate_workload(
        self,
    ) -> None:
        safe_case = benchmark_case(
            case_id="safe-only",
            placeholder_type="safe_text",
        )
        phone_case = benchmark_case(
            case_id="phone-candidate",
            placeholder_type="phone_number",
        )
        secret_case = benchmark_case(
            case_id="non-koelectra-secret",
            placeholder_type="secret",
        )

        selected = select_model_candidate_cases(
            (safe_case, phone_case, secret_case)
        )

        self.assertEqual(selected, (phone_case,))

    def test_security_scan_is_mandatory_and_has_no_disable_option(self) -> None:
        option_destinations = {
            action.dest for action in build_parser()._actions
        }
        self.assertNotIn("no_security_scan", option_destinations)

        report = {
            "metadata": {
                "rawPrompt": INPUT_SENTINEL,
            }
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            with self.assertRaises(BenchmarkError):
                write_safe_report(
                    report,
                    Path(temp_dir) / "unsafe.json",
                )


class DelayedHybridService:
    def __init__(
        self,
        *,
        delay_seconds: float,
        include_koelectra_detection: bool = True,
    ) -> None:
        self._delay_seconds = delay_seconds
        self._include_koelectra_detection = (
            include_koelectra_detection
        )
        self._lock = threading.Lock()
        self.active = 0
        self.peak_active = 0

    def detect(
        self,
        _request: AiSafetyDetectRequest,
    ) -> AiSafetyDetectResponse:
        with self._lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
        try:
            if self._delay_seconds:
                time.sleep(self._delay_seconds)
            detections = []
            if self._include_koelectra_detection:
                detections.append(
                    {
                        "detectorType": "phone_number",
                        "source": GATELM_KOELECTRA_PII_NER_SOURCE,
                        "confidence": 0.99,
                        "action": "redact",
                        "mode": "shadow",
                    }
                )
            return AiSafetyDetectResponse.model_validate(
                {
                    "contractVersion": "ai-safety-detector.v1",
                    "model": {
                        "modelId": "gatelm/synthetic-test-model",
                        "runtime": "cpu_only",
                    },
                    "outcome": "redacted",
                    "mode": "shadow",
                    "redactedPrompt": OUTPUT_SENTINEL,
                    "logSafePrompt": "[SYNTHETIC_REDACTED]",
                    "redactedPromptPreview": None,
                    "detectorSummary": {
                        "detectedCount": len(detections),
                        "detectorCategories": ["phone_number"]
                        if detections
                        else [],
                    },
                    "detections": detections,
                    "executionSummary": {
                        "executionMode": "hybrid",
                        "modelInvocationCount": 2,
                        "acceptedModelDetectionCount": len(detections),
                    },
                    "latencyMs": max(
                        0,
                        round(self._delay_seconds * 1000),
                    ),
                }
            )
        finally:
            with self._lock:
                self.active -= 1


def canonical_model_binding() -> dict[str, object]:
    return {
        "modelId": "gatelm/koelectra-small-v3-pii-ner",
        "version": "v0.1.1",
        "legacyRevision": "v3.14",
        "runtime": "onnx-qint8",
        "lifecycle": "package-ready",
        "registryVersion": "gatelm.pii-model-canonical-registry.v1",
        "registrySha256": "e" * 64,
        "artifactManifestSha256": "f" * 64,
        "artifactFileCount": 7,
        "artifactBytes": 100,
        "modelOnnxSha256": "1" * 64,
        "modelOnnxBytes": 80,
        "sourceManifestSha256": ["2" * 64],
    }


def primary_model_binding() -> dict[str, object]:
    return {
        "artifactRole": "primary_local_privacy_filter_package",
        "runtime": "onnx",
        "sha256": "3" * 64,
        "bytes": 90,
    }


def benchmark_case(
    *,
    case_id: str,
    placeholder_type: str,
) -> BenchmarkCase:
    return BenchmarkCase(
        case_id=case_id,
        case_group="short_safe",
        input_length_bucket="short",
        input_template="{SYNTHETIC_VALUE}",
        placeholder_bindings={
            "SYNTHETIC_VALUE": placeholder_type,
        },
        locale="ko-KR",
        tags=("synthetic",),
    )


if __name__ == "__main__":
    unittest.main()
