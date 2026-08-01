from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app.domain.ai_safety_benchmark.report import (
    scan_text_for_forbidden_report_values,
)
from app.services import (
    pii_direct_inference_concurrency_benchmark_runner as direct_runner,
)
from app.services import pii_thread_budget_matrix_benchmark_runner as runner


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = (
    REPO_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "resource-latency-benchmark-corpus.jsonl"
)


class PiiThreadBudgetMatrixBenchmarkTests(unittest.TestCase):
    def test_default_matrix_uses_exact_fixed_budget_and_crossed_order(self) -> None:
        configurations = runner.parse_configurations(
            runner.DEFAULT_CONFIGURATIONS,
            cpu_budget=4,
        )

        self.assertEqual(
            [
                (
                    configuration.request_concurrency,
                    configuration.onnx_intra_op_threads,
                )
                for configuration in configurations
            ],
            [(1, 4), (2, 2), (4, 1)],
        )
        self.assertTrue(
            all(configuration.thread_budget == 4 for configuration in configurations)
        )
        self.assertEqual(
            [
                configuration.configuration_id
                for configuration in runner.round_configuration_order(
                    configurations,
                    1,
                )
            ],
            [
                "concurrency-4-intra-op-1",
                "concurrency-2-intra-op-2",
                "concurrency-1-intra-op-4",
            ],
        )
        self.assertEqual(
            [
                configuration.configuration_id
                for configuration in runner.round_configuration_order(
                    configurations,
                    2,
                )
            ],
            [
                "concurrency-2-intra-op-2",
                "concurrency-4-intra-op-1",
                "concurrency-1-intra-op-4",
            ],
        )

        for value in (
            "1x4",
            "1x4,2x4",
            "1x4,1x4",
            "2x2,4x1",
            "one,two",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.parse_configurations(value, cpu_budget=4)

    def test_revalidation_candidate_requires_output_parity_and_bounded_p99(
        self,
    ) -> None:
        configurations = runner.parse_configurations(
            "1x4,2x2",
            cpu_budget=4,
        )
        results = [
            fake_round_result(
                configuration=configurations[0],
                round_number=round_number,
                rps=50.0,
                p99=80.0,
            )
            for round_number in range(1, 4)
        ]
        results.extend(
            fake_round_result(
                configuration=configurations[1],
                round_number=round_number,
                rps=90.0,
                p99=110.0 if round_number == 2 else 90.0,
            )
            for round_number in range(1, 4)
        )

        summaries = runner.summarize_configurations(
            results,
            configurations=configurations,
            rounds=3,
            deadline_ms=100.0,
        )
        selection = runner.build_selection_summary(summaries)

        self.assertTrue(summaries[0]["revalidationEligible"])
        self.assertFalse(summaries[1]["revalidationEligible"])
        self.assertEqual(
            selection["revalidationCandidateConfigurationId"],
            configurations[0].configuration_id,
        )
        self.assertFalse(selection["productionDefaultChanged"])

    def test_cli_writes_aggregate_only_matrix_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            model_dir, registry_path = write_test_model_registry(root)
            model_binding = direct_runner.bind_model_artifact(
                model_dir=model_dir,
                model_version="v0.1.1",
                registry_path=registry_path,
            )
            out = root / "matrix.json"
            git_sha = "a" * 40

            def fake_child_executor(**kwargs: object) -> dict[str, object]:
                configuration = kwargs["configuration"]
                self.assertIsInstance(
                    configuration,
                    runner.ThreadBudgetConfiguration,
                )
                assert isinstance(
                    configuration,
                    runner.ThreadBudgetConfiguration,
                )
                round_number = int(kwargs["round_number"])
                return fake_child_report(
                    configuration=configuration,
                    round_number=round_number,
                    git_sha=git_sha,
                    model_binding=model_binding,
                )

            with patch.object(
                runner.direct_runner,
                "process_available_cpu_count",
                return_value=4,
            ):
                exit_code = runner.run(
                    [
                        "--model-dir",
                        str(model_dir),
                        "--model-version",
                        "v0.1.1",
                        "--configurations",
                        "1x4,2x2,4x1",
                        "--cpu-budget",
                        "4",
                        "--rounds",
                        "3",
                        "--warmup-requests",
                        "4",
                        "--measured-requests",
                        "8",
                        "--deadline-ms",
                        "100",
                        "--sample-interval-ms",
                        "100",
                        "--corpus",
                        str(CORPUS_PATH),
                        "--out",
                        str(out),
                        "--git-sha",
                        git_sha,
                    ],
                    child_executor=fake_child_executor,
                    generated_at=datetime(
                        2026,
                        7,
                        31,
                        tzinfo=timezone.utc,
                    ),
                    registry_path=registry_path,
                )

            self.assertEqual(exit_code, 0)
            report_text = out.read_text(encoding="utf-8")
            report = json.loads(report_text)
            scan_text_for_forbidden_report_values(
                report_text,
                "test PII thread budget matrix report",
            )
            self.assertEqual(report["reportVersion"], runner.REPORT_VERSION)
            self.assertEqual(report["experiment"]["cpuBudget"], 4)
            self.assertEqual(len(report["roundResults"]), 9)
            self.assertEqual(
                report["selectionSummary"][
                    "revalidationCandidateConfigurationId"
                ],
                "concurrency-4-intra-op-1",
            )
            self.assertFalse(
                report["selectionSummary"]["productionDefaultChanged"]
            )
            self.assertNotIn(str(root), report_text)
            self.assertNotIn("promptText", report_text)
            self.assertNotIn("detections", report_text)
            self.assertNotIn(b"\r", out.read_bytes())


def fake_round_result(
    *,
    configuration: runner.ThreadBudgetConfiguration,
    round_number: int,
    rps: float,
    p99: float,
) -> dict[str, object]:
    deadline_exceeded = 1 if p99 > 100.0 else 0
    return {
        "round": round_number,
        "orderIndex": 0,
        "configurationId": configuration.configuration_id,
        "requestConcurrency": configuration.request_concurrency,
        "onnxIntraOpThreads": configuration.onnx_intra_op_threads,
        "onnxInterOpThreads": 1,
        "onnxAllowSpinning": False,
        "fixedThreadBudget": configuration.thread_budget,
        "strictEligible": deadline_exceeded == 0,
        "requested": 100,
        "completed": 100,
        "successful": 100,
        "inferenceErrorCount": 0,
        "outputMismatchCount": 0,
        "deadlineExceededCount": deadline_exceeded,
        "successfulRps": rps,
        "latencyMs": {
            "population": "successful_requests_across_all_rounds",
            "sampleCount": 100,
            "p50": 10.0,
            "p95": p99 - 10.0,
            "p99": p99,
            "max": p99 + 5.0,
        },
        "adjustedResources": fixed_resources(),
    }


def fake_child_report(
    *,
    configuration: runner.ThreadBudgetConfiguration,
    round_number: int,
    git_sha: str,
    model_binding: dict[str, object],
) -> dict[str, object]:
    successful_rps = (
        configuration.request_concurrency * 25.0 + round_number
    )
    p99 = 80.0 - configuration.request_concurrency
    return {
        "reportVersion": direct_runner.REPORT_VERSION,
        "gitSha": git_sha,
        "model": model_binding,
        "runtime": {
            "os": "test-os",
            "machine": "AMD64",
            "cpuModel": "test-cpu",
            "logicalCpuCount": 8,
            "physicalCpuCount": 4,
            "processAffinityCpuCount": 4,
            "pythonVersion": "3.12.0",
            "packageVersions": {},
            "onnxAvailableProviders": ["CPUExecutionProvider"],
            "onnxIntraOpThreads": configuration.onnx_intra_op_threads,
            "onnxInterOpThreads": 1,
            "onnxAllowSpinning": False,
            "peakSampleIntervalMs": 100.0,
            "resourceControl": "same_wall_idle_process_control",
        },
        "workload": {
            "rounds": 1,
            "warmupRequestsPerLevelPerRound": 4,
            "measuredRequestsPerLevelPerRound": 8,
            "deadlineMs": 100.0,
        },
        "concurrencySummary": [
            {
                "concurrency": configuration.request_concurrency,
                "eligible": True,
                "requested": 8,
                "completed": 8,
                "successful": 8,
                "inferenceErrorCount": 0,
                "outputMismatchCount": 0,
                "deadlineExceededCount": 0,
                "observedSuccessfulRps": successful_rps,
                "latencyMs": {
                    "population": "successful_requests_across_all_rounds",
                    "sampleCount": 8,
                    "p50": 10.0,
                    "p95": p99 - 5.0,
                    "p99": p99,
                    "max": p99 + 2.0,
                },
                "adjustedResourceMedian": fixed_resources(),
            }
        ],
    }


def fixed_resources() -> dict[str, object]:
    return {
        "samplingStatus": "collected",
        "peakRssMiB": 128.0,
        "peakThreadCount": 8,
        "processCpuSeconds": 1.0,
        "cpuCoreEquivalentPct": 200.0,
        "cpuAvailableUtilizationPct": 50.0,
        "contextSwitches": {
            "voluntary": 10,
            "involuntary": 2,
            "total": 12,
            "perCompletedRequest": 1.5,
        },
    }


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
        "schemaVersion": direct_runner.REGISTRY_VERSION,
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
