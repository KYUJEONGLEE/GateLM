from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.domain.ai_safety_benchmark.corpus import (
    load_benchmark_corpus,
    render_case_prompt,
)
from app.domain.ai_safety_benchmark.report import (
    scan_text_for_forbidden_report_values,
)
from app.services import pii_direct_inference_concurrency_benchmark_runner as runner


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = (
    REPO_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "resource-latency-benchmark-corpus.jsonl"
)


class PiiDirectInferenceConcurrencyBenchmarkTests(unittest.TestCase):
    def test_defaults_and_crossed_round_order(self) -> None:
        self.assertEqual(runner.DEFAULT_ROUNDS, 3)
        self.assertEqual(runner.DEFAULT_MEASURED_REQUESTS, 1000)
        self.assertEqual(runner.DEFAULT_SAMPLE_INTERVAL_MS, 100.0)
        self.assertEqual(runner.parse_concurrency_levels("1,2,4"), (1, 2, 4))
        self.assertEqual(
            runner.round_concurrency_order((1, 2, 4), 0),
            (1, 2, 4),
        )
        self.assertEqual(
            runner.round_concurrency_order((1, 2, 4), 1),
            (4, 2, 1),
        )
        self.assertEqual(
            runner.round_concurrency_order((1, 2, 4), 2),
            (2, 4, 1),
        )

        for value in ("", "1,1", "0,1", "1,33", "one,two"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.parse_concurrency_levels(value)

    def test_closed_loop_reaches_limit_and_matches_sequential_baseline(self) -> None:
        adapter = TrackingAdapter(delay_seconds=0.01)
        texts = ("safe synthetic one", "safe synthetic two")
        baseline = runner.build_sequential_baseline(adapter, texts)

        measured = runner.run_closed_loop(
            adapter=adapter,
            texts=texts,
            baseline_outputs=baseline,
            concurrency=4,
            request_count=16,
            deadline_ms=100,
            sampler=FixedResourceSampler(),
        )
        result = measured.summary

        self.assertEqual(result["requested"], 16)
        self.assertEqual(result["completed"], 16)
        self.assertEqual(result["successful"], 16)
        self.assertEqual(result["inferenceErrorCount"], 0)
        self.assertEqual(result["outputMismatchCount"], 0)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["observedPeakActiveAdapterCalls"], 4)
        self.assertEqual(adapter.peak_active, 4)
        self.assertGreater(result["successfulRps"], 0)
        self.assertEqual(
            result["latencyMs"]["population"],
            "successful_requests_in_this_round",
        )
        self.assertEqual(result["latencyMs"]["sampleCount"], 16)
        self.assertLessEqual(result["latencyMs"]["p50"], result["latencyMs"]["p95"])
        self.assertLessEqual(result["latencyMs"]["p95"], result["latencyMs"]["p99"])
        self.assertLessEqual(result["latencyMs"]["p99"], result["latencyMs"]["max"])

    def test_closed_loop_rejects_silent_concurrent_output_changes(self) -> None:
        adapter = TrackingAdapter(
            delay_seconds=0.01,
            corrupt_when_concurrent=True,
        )
        texts = ("synthetic one", "synthetic two")
        baseline = runner.build_sequential_baseline(adapter, texts)

        result = runner.run_closed_loop(
            adapter=adapter,
            texts=texts,
            baseline_outputs=baseline,
            concurrency=4,
            request_count=16,
            deadline_ms=100,
            sampler=FixedResourceSampler(),
        ).summary

        self.assertEqual(result["inferenceErrorCount"], 0)
        self.assertGreater(result["outputMismatchCount"], 0)
        self.assertFalse(result["eligible"])

    def test_closed_loop_counts_errors_and_deadline_excess_without_details(self) -> None:
        adapter = TrackingAdapter(delay_seconds=0.003, fail_every=2)
        texts = ("safe synthetic",)
        baseline = runner.build_sequential_baseline(adapter, texts)

        result = runner.run_closed_loop(
            adapter=adapter,
            texts=texts,
            baseline_outputs=baseline,
            concurrency=2,
            request_count=6,
            deadline_ms=0.1,
            sampler=FixedResourceSampler(),
        ).summary
        serialized = json.dumps(result, ensure_ascii=False)

        self.assertEqual(result["completed"], 6)
        self.assertEqual(result["successful"], 3)
        self.assertEqual(result["inferenceErrorCount"], 3)
        self.assertEqual(result["deadlineExceededCount"], 6)
        self.assertFalse(result["eligible"])
        self.assertNotIn("synthetic inference detail", serialized)

    def test_idle_control_adjustment_reports_raw_control_and_adjusted(self) -> None:
        raw = fixed_resources(
            peak_rss_mib=150.0,
            peak_threads=10,
            cpu_seconds=5.0,
            core_pct=50.0,
            available_pct=25.0,
            voluntary=70,
            involuntary=30,
        )
        control = fixed_resources(
            peak_rss_mib=100.0,
            peak_threads=4,
            cpu_seconds=1.0,
            core_pct=10.0,
            available_pct=5.0,
            voluntary=15,
            involuntary=5,
        )

        adjusted = runner.adjusted_resources(
            raw,
            control,
            raw_wall_seconds=10.0,
            control_wall_seconds=10.0,
            completed=20,
        )

        self.assertEqual(adjusted["peakRssMiB"], 50.0)
        self.assertEqual(adjusted["peakThreadCount"], 6)
        self.assertEqual(adjusted["processCpuSeconds"], 4.0)
        self.assertEqual(adjusted["cpuCoreEquivalentPct"], 40.0)
        self.assertEqual(adjusted["cpuAvailableUtilizationPct"], 20.0)
        self.assertEqual(
            adjusted["contextSwitches"],
            {
                "voluntary": 55,
                "involuntary": 25,
                "total": 80,
                "perCompletedRequest": 4.0,
            },
        )

    def test_selection_uses_only_fully_eligible_throughput(self) -> None:
        eligible = fake_measured_run(
            concurrency=1,
            wall_seconds=10.0,
            eligible=True,
        )
        fast_but_ineligible = fake_measured_run(
            concurrency=2,
            wall_seconds=1.0,
            eligible=False,
            deadline_exceeded=1,
        )

        summary = runner.summarize_concurrency_results(
            (eligible, fast_but_ineligible),
            levels=(1, 2),
        )
        selection = runner.build_selection_summary(summary)

        self.assertEqual(selection["eligibleConcurrencyLevels"], [1])
        self.assertEqual(
            selection["highestEligibleThroughputConcurrency"],
            1,
        )
        self.assertIsNone(summary[1]["eligibleSuccessfulRps"])
        self.assertEqual(
            summary[0]["latencyMs"]["population"],
            "successful_requests_across_all_rounds",
        )

    def test_process_sampler_uses_affinity_and_aligned_counter_snapshots(self) -> None:
        fake_process = FakeProcess()
        psutil_module = types.ModuleType("psutil")
        psutil_module.Process = lambda: fake_process
        psutil_module.cpu_count = lambda logical=True: 8 if logical else 4

        with patch.dict(sys.modules, {"psutil": psutil_module}):
            sampler = runner.ProcessResourceSampler(1000)
            sampler.start()
            sampler.mark_start()
            result = sampler.stop(1.0)

        self.assertEqual(result["samplingStatus"], "collected")
        self.assertEqual(result["processCpuSeconds"], 2.0)
        self.assertEqual(result["cpuCoreEquivalentPct"], 200.0)
        self.assertEqual(result["cpuAvailableUtilizationPct"], 50.0)
        self.assertEqual(result["peakRssMiB"], 256.0)
        self.assertEqual(result["peakThreadCount"], 9)
        self.assertEqual(
            result["contextSwitches"],
            {"voluntary": 5, "involuntary": 7, "total": 12},
        )

    def test_registry_binding_rejects_version_or_sha_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            model_dir, registry_path = write_test_model_registry(root)

            binding = runner.bind_model_artifact(
                model_dir=model_dir,
                model_version="v0.1.1",
                registry_path=registry_path,
            )

            self.assertEqual(binding["version"], "v0.1.1")
            self.assertEqual(binding["legacyRevision"], "v3.14")
            self.assertEqual(
                binding["modelOnnxSha256"],
                hashlib.sha256(b"model.onnx-test-bytes").hexdigest(),
            )
            with self.assertRaisesRegex(ValueError, "not present"):
                runner.bind_model_artifact(
                    model_dir=model_dir,
                    model_version="v0.1.0",
                    registry_path=registry_path,
                )
            (model_dir / "model.onnx").write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "byte size|SHA-256"):
                runner.bind_model_artifact(
                    model_dir=model_dir,
                    model_version="v0.1.1",
                    registry_path=registry_path,
                )

    def test_cli_renders_synthetic_workload_but_never_persists_it(self) -> None:
        adapter = TrackingAdapter(delay_seconds=0.001)
        cases = load_benchmark_corpus(CORPUS_PATH)
        rendered_workload = [render_case_prompt(case) for case in cases]
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            model_dir, registry_path = write_test_model_registry(root)
            out = root / "report.json"
            generated_at = datetime(2026, 7, 31, tzinfo=timezone.utc)
            with patch.dict(
                os.environ,
                {
                    "AI_SERVICE_ONNX_INTRA_OP_THREADS": "4",
                    "AI_SERVICE_ONNX_INTER_OP_THREADS": "1",
                    "AI_SERVICE_ONNX_ALLOW_SPINNING": "false",
                },
                clear=False,
            ):
                exit_code = runner.run(
                    [
                        "--model-dir",
                        str(model_dir),
                        "--model-version",
                        "v0.1.1",
                        "--concurrency-levels",
                        "1,2",
                        "--rounds",
                        "2",
                        "--warmup-requests",
                        "2",
                        "--measured-requests",
                        "4",
                        "--deadline-ms",
                        "100",
                        "--sample-interval-ms",
                        "100",
                        "--corpus",
                        str(CORPUS_PATH),
                        "--out",
                        str(out),
                        "--git-sha",
                        "a" * 40,
                    ],
                    adapter_factory=lambda _path: adapter,
                    sampler_factory=lambda _interval: FixedResourceSampler(),
                    generated_at=generated_at,
                    registry_path=registry_path,
                )

            self.assertEqual(exit_code, 0)
            report_text = out.read_text(encoding="utf-8")
            report = json.loads(report_text)
            scan_text_for_forbidden_report_values(
                report_text,
                "test PII concurrency report",
            )
            self.assertEqual(report["reportVersion"], runner.REPORT_VERSION)
            self.assertEqual(report["model"]["version"], "v0.1.1")
            self.assertEqual(
                report["workload"]["valueMode"],
                "rendered_synthetic_values_in_memory_not_persisted",
            )
            self.assertEqual(
                report["workload"]["p99Population"],
                "successful_requests_across_all_rounds_for_each_concurrency",
            )
            self.assertEqual(
                report["roundExecutionOrder"],
                [
                    {"round": 1, "concurrencyLevels": [1, 2]},
                    {"round": 2, "concurrencyLevels": [2, 1]},
                ],
            )
            self.assertEqual(len(report["roundResults"]), 4)
            self.assertEqual(
                report["runtime"]["onnxIntraOpThreads"],
                4,
            )
            self.assertEqual(
                report["runtime"]["onnxInterOpThreads"],
                1,
            )
            self.assertFalse(report["runtime"]["onnxAllowSpinning"])
            self.assertIn(
                report["selectionSummary"][
                    "highestEligibleThroughputConcurrency"
                ],
                {1, 2},
            )
            self.assertEqual(adapter.warmup_count, 1)
            self.assertNotIn(str(root), report_text)
            self.assertNotIn("inputTemplate", report_text)
            self.assertNotIn("actualPeakConcurrent", report_text)
            self.assertIn("observedPeakActiveAdapterCalls", report_text)
            for workload_text in rendered_workload:
                self.assertNotIn(workload_text, report_text)
            parser_options = {
                option
                for action in runner.build_parser()._actions
                for option in action.option_strings
            }
            self.assertNotIn("--no-security-scan", parser_options)

    def test_korean_synthetic_overrides_are_valid_utf8_text(self) -> None:
        korean_case = next(
            case
            for case in load_benchmark_corpus(CORPUS_PATH)
            if case.case_id == "pii_ko_01"
        )
        rendered = render_case_prompt(korean_case)

        self.assertIn("테스트사용자", rendered)
        self.assertNotIn("\ufffd", rendered)
        self.assertNotIn("SYNTHETIC_KO_", rendered)


class TrackingAdapter:
    def __init__(
        self,
        *,
        delay_seconds: float,
        fail_every: int | None = None,
        corrupt_when_concurrent: bool = False,
    ) -> None:
        self.delay_seconds = delay_seconds
        self.fail_every = fail_every
        self.corrupt_when_concurrent = corrupt_when_concurrent
        self._lock = threading.Lock()
        self.active = 0
        self.peak_active = 0
        self.detect_count = 0
        self.warmup_count = 0

    def warmup(self) -> None:
        self.warmup_count += 1

    def detect(self, text: str) -> tuple[str, str]:
        with self._lock:
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
            self.detect_count += 1
            call_number = self.detect_count
            concurrent = self.active > 1
        try:
            time.sleep(self.delay_seconds)
            if self.fail_every is not None and call_number % self.fail_every == 0:
                raise RuntimeError("synthetic inference detail")
            if self.corrupt_when_concurrent and concurrent:
                return ("corrupt", text)
            return ("stable", text)
        finally:
            with self._lock:
                self.active -= 1


class FixedResourceSampler:
    def start(self) -> None:
        return None

    def mark_start(self) -> None:
        return None

    def stop(self, _wall_seconds: float) -> dict[str, object]:
        return fixed_resources()


class FakeProcess:
    def __init__(self) -> None:
        self._cpu_calls = 0
        self._context_calls = 0

    def cpu_times(self) -> SimpleNamespace:
        self._cpu_calls += 1
        if self._cpu_calls == 1:
            return SimpleNamespace(user=1.0, system=1.0)
        return SimpleNamespace(user=2.0, system=2.0)

    def num_ctx_switches(self) -> SimpleNamespace:
        self._context_calls += 1
        if self._context_calls == 1:
            return SimpleNamespace(voluntary=10, involuntary=20)
        return SimpleNamespace(voluntary=15, involuntary=27)

    def memory_info(self) -> SimpleNamespace:
        return SimpleNamespace(rss=256 * 1024 * 1024)

    def num_threads(self) -> int:
        return 9

    def cpu_affinity(self) -> list[int]:
        return [0, 1, 2, 3]


def fixed_resources(
    *,
    peak_rss_mib: float = 128.0,
    peak_threads: int = 5,
    cpu_seconds: float = 0.01,
    core_pct: float = 25.0,
    available_pct: float = 6.25,
    voluntary: int = 2,
    involuntary: int = 1,
) -> dict[str, object]:
    return {
        "samplingStatus": "collected",
        "peakRssMiB": peak_rss_mib,
        "peakThreadCount": peak_threads,
        "processCpuSeconds": cpu_seconds,
        "cpuCoreEquivalentPct": core_pct,
        "cpuAvailableUtilizationPct": available_pct,
        "contextSwitches": {
            "voluntary": voluntary,
            "involuntary": involuntary,
            "total": voluntary + involuntary,
        },
    }


def fake_measured_run(
    *,
    concurrency: int,
    wall_seconds: float,
    eligible: bool,
    deadline_exceeded: int = 0,
) -> runner.ClosedLoopRun:
    adjusted = fixed_resources()
    summary = {
        "concurrency": concurrency,
        "round": 1,
        "orderIndex": 0,
        "observedPeakActiveAdapterCalls": concurrency,
        "requested": 100,
        "completed": 100,
        "successful": 100,
        "inferenceErrorCount": 0,
        "outputMismatchCount": 0,
        "deadlineExceededCount": deadline_exceeded,
        "eligible": eligible,
        "wallTimeSeconds": wall_seconds,
        "completedRps": 100 / wall_seconds,
        "successfulRps": 100 / wall_seconds,
        "latencyMs": {
            "population": "successful_requests_in_this_round",
            "sampleCount": 100,
            "p50": 1.0,
            "p95": 1.0,
            "p99": 1.0,
            "max": 1.0,
        },
        "resources": {
            "measurementScope": "test",
            "sampleIntervalMs": 100.0,
            "rawWallTimeSeconds": wall_seconds,
            "idleControlWallTimeSeconds": wall_seconds,
            "raw": fixed_resources(),
            "idleControl": fixed_resources(),
            "adjusted": adjusted,
        },
    }
    return runner.ClosedLoopRun(
        summary=summary,
        successful_latencies_ms=tuple(1.0 for _ in range(100)),
        wall_seconds=wall_seconds,
    )


def write_test_model_registry(root: Path) -> tuple[Path, Path]:
    model_dir = root / "model"
    model_dir.mkdir()
    file_contents = {
        "config.json": b"config-test-bytes",
        "export-report.json": b"export-test-bytes",
        "model.onnx": b"model.onnx-test-bytes",
        "special_tokens_map.json": b"special-test-bytes",
        "tokenizer.json": b"tokenizer-test-bytes",
        "tokenizer_config.json": b"tokenizer-config-test-bytes",
        "vocab.txt": b"vocab-test-bytes",
    }
    files = []
    for name, content in file_contents.items():
        (model_dir / name).write_bytes(content)
        files.append(
            {
                "path": name,
                "bytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    registry = {
        "schemaVersion": runner.REGISTRY_VERSION,
        "modelId": "gatelm/koelectra-small-v3-pii-ner",
        "entries": [
            {
                "canonicalVersion": "v0.1.1",
                "legacyRevision": "v3.14",
                "runtime": "onnx-cpu-dynamic-qint8",
                "lifecycle": "test-only",
                "sourceManifests": [
                    {
                        "path": "test/manifest.sha256",
                        "sha256": "b" * 64,
                    }
                ],
                "files": files,
            }
        ],
    }
    registry_path = root / "registry.json"
    registry_path.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return model_dir, registry_path


if __name__ == "__main__":
    unittest.main()
