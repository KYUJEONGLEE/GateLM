from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app.adapters.safety.privacy_filter_adapter import KOELECTRA_PRIVACY_NER_MODEL
from app.domain.ai_safety_benchmark.corpus import load_benchmark_corpus, render_case_prompt
from app.domain.ai_safety_benchmark.report import (
    build_report,
    scan_text_for_forbidden_report_values,
    write_reports,
)
from app.domain.ai_safety_benchmark.resources import ResourceSampler
from app.domain.ai_safety_benchmark.runner import run_benchmark
from app.domain.ai_safety_benchmark.stats import nearest_rank
from app.domain.ai_safety_benchmark.targets import GatewayHttpBenchmarkTarget, HttpBenchmarkTarget
from app.domain.ai_safety_benchmark.types import BenchmarkError, TargetResult
from app.services import ai_safety_latency_benchmark_runner


REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS_PATH = REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "resource-latency-benchmark-corpus.jsonl"


class AiSafetyLatencyBenchmarkTests(unittest.TestCase):
    def test_corpus_has_50_cases_and_10_per_group(self) -> None:
        cases = load_benchmark_corpus(CORPUS_PATH)

        self.assertEqual(len(cases), 50)
        group_counts: dict[str, int] = {}
        for case in cases:
            group_counts[case.case_group] = group_counts.get(case.case_group, 0) + 1
        self.assertEqual(
            group_counts,
            {
                "short_safe": 10,
                "long_safe": 10,
                "pii_en": 10,
                "pii_ko": 10,
                "mixed_edge": 10,
            },
        )

    def test_active_benchmark_contract_uses_v2_observation_fields_only(self) -> None:
        contract = (
            REPO_ROOT / "docs" / "ai-safety-lab" / "resource-latency-benchmark.md"
        ).read_text(encoding="utf-8")

        for removed_field in (
            "p95FullSafetyStageMs",
            "p50FullSafetyStageMs",
            "fullSafetyStageGate",
            '"fallbackCount"',
        ):
            self.assertNotIn(removed_field, contract)
        for required_field in (
            "p95TargetLatencyMs",
            "targetLatencyGate",
            "observedFallbackCount",
            "unobservedSidecarCount",
            "evidenceCompletenessGate",
        ):
            self.assertIn(required_field, contract)

    def test_renderer_keeps_fixture_templates_out_of_report(self) -> None:
        cases = load_benchmark_corpus(CORPUS_PATH)
        pii_case = next(case for case in cases if case.case_id == "pii_en_01")
        rendered_prompt = render_case_prompt(pii_case)
        report, _, _ = build_fake_report(cases)
        serialized = json.dumps(report, ensure_ascii=False)

        self.assertNotIn(rendered_prompt, serialized)
        self.assertNotIn("promptText", serialized)
        self.assertNotIn("inputTemplate", serialized)
        self.assertNotIn("redactedPrompt", serialized)
        self.assertNotIn('"word"', serialized)
        self.assertNotIn('"start"', serialized)
        self.assertNotIn('"end"', serialized)
        self.assertNotIn("rawErrorBody", serialized)

    def test_nearest_rank_percentiles_are_reproducible(self) -> None:
        values = [50, 10, 30, 20, 40]

        self.assertEqual(nearest_rank(values, 0.50), 30)
        self.assertEqual(nearest_rank(values, 0.95), 50)

    def test_fake_target_excludes_warmup_and_records_timeout_fallbacks(self) -> None:
        cases = load_benchmark_corpus(CORPUS_PATH)
        report, fake_target, samples = build_fake_report(cases, mode="timeout")
        runtime = selected_runtime(report)

        self.assertEqual(len(fake_target.prompts), 110)
        self.assertEqual(len(samples), 100)
        self.assertEqual(runtime["requests"], 100)
        self.assertEqual(runtime["successfulRequests"], 90)
        self.assertEqual(runtime["timeoutCount"], 10)
        self.assertEqual(runtime["observedFallbackCount"], 10)
        self.assertEqual(runtime["sidecarLatencyGate"], "warn")
        self.assertEqual(report["decisionSummary"]["timeoutFallbackGate"], "pass")
        self.assertEqual([group["requests"] for group in report["caseGroupResults"]], [20, 20, 20, 20, 20])

    def test_gate_results_cover_pass_warn_and_fail(self) -> None:
        cases = load_benchmark_corpus(CORPUS_PATH)
        pass_report, _, _ = build_fake_report(cases, mode="pass")
        slow_report, _, _ = build_fake_report(cases, mode="slow")
        error_report, _, _ = build_fake_report(cases, mode="error")

        self.assertEqual(selected_runtime(pass_report)["status"], "pass")
        self.assertEqual(selected_runtime(slow_report)["status"], "warn")
        self.assertEqual(selected_runtime(error_report)["status"], "fail")

    def test_report_writer_scans_for_forbidden_raw_fields(self) -> None:
        with self.assertRaisesRegex(BenchmarkError, "forbidden field name"):
            scan_text_for_forbidden_report_values('{"promptText":"do not store"}', "bad report")
        with self.assertRaisesRegex(BenchmarkError, "forbidden field name"):
            scan_text_for_forbidden_report_values("`word`", "bad markdown")

    def test_cli_writes_sanitized_json_and_markdown_with_fake_target(self) -> None:
        fake_target = FakeBenchmarkTarget(mode="pass")
        with tempfile.TemporaryDirectory() as temp_dir:
            verification_path = Path(temp_dir) / "artifact-verification.json"
            verification_path.write_text(
                json.dumps(artifact_verification()), encoding="utf-8"
            )
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                exit_code = ai_safety_latency_benchmark_runner.run(
                    [
                        "--target",
                        "http",
                        "--corpus",
                        str(CORPUS_PATH),
                        "--out",
                        temp_dir,
                        "--run-id",
                        "benchmark-test-run",
                        "--git-sha",
                        "a" * 40,
                        "--model-id",
                        KOELECTRA_PRIVACY_NER_MODEL,
                        "--artifact-verification",
                        str(verification_path),
                    ],
                    target_factory=lambda _args: fake_target,
                    generated_at=datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc),
                )

            self.assertEqual(exit_code, 0)
            self.assertIn("ai safety latency benchmark completed", stdout.getvalue())
            json_path = Path(temp_dir) / "resource-latency-benchmark.json"
            markdown_path = Path(temp_dir) / "resource-latency-benchmark.md"
            self.assertTrue(json_path.exists())
            self.assertTrue(markdown_path.exists())
            report = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(report["evidenceBinding"], evidence_binding())
            self.assertEqual(report["metadata"]["runId"], "benchmark-test-run")
            self.assertEqual(report["metadata"]["modelId"], KOELECTRA_PRIVACY_NER_MODEL)
            self.assertEqual(selected_runtime(report)["requests"], 100)
            self.assertEqual(
                [runtime["status"] for runtime in report["runtimeResults"]],
                ["pass", "not_run", "not_run"],
            )

    def test_benchmark_never_infers_artifact_checksum_verification(self) -> None:
        invalid_binding = evidence_binding()
        invalid_binding["artifactChecksumsVerified"] = False

        with self.assertRaisesRegex(BenchmarkError, "evidence binding is invalid"):
            build_fake_report(
                load_benchmark_corpus(CORPUS_PATH),
                evidence_binding=invalid_binding,
            )

    def test_benchmark_binding_requires_matching_full_git_revision(self) -> None:
        with self.assertRaisesRegex(BenchmarkError, "Git revision does not match"):
            build_fake_report(
                load_benchmark_corpus(CORPUS_PATH),
                evidence_binding=evidence_binding(),
                git_sha="b" * 40,
            )

    def test_cli_builds_gateway_http_target(self) -> None:
        args = ai_safety_latency_benchmark_runner.build_parser().parse_args(
            [
                "--target",
                "gateway_http",
                "--endpoint-url",
                "http://127.0.0.1:8080/v1/chat/completions",
            ]
        )

        target = ai_safety_latency_benchmark_runner.build_target(args)

        self.assertIsInstance(target, GatewayHttpBenchmarkTarget)

    def test_gateway_total_latency_is_not_reported_as_sidecar_latency(self) -> None:
        response = FakeGatewayResponse(
            {
                "gate_lm": {
                    "requestId": "request_not_written_to_report",
                    "latencyMs": 17,
                }
            },
            status_code=200,
        )
        target = GatewayHttpBenchmarkTarget(endpoint_url="http://127.0.0.1:8080/v1/chat/completions")

        with patch("httpx.post", return_value=response):
            result = target.detect("synthetic safe input", locale="en-US", timeout_ms=300)

        self.assertIsNone(result.sidecar_latency_ms)
        self.assertEqual(result.sidecar_outcome, "unobserved")
        self.assertEqual(result.sidecar_observation, "not_observed")
        self.assertEqual(result.fallback_mode, "not_observed")
        self.assertEqual(result.target_kind, "gateway_http")

    def test_gateway_timeout_does_not_claim_sidecar_timeout_or_fallback(self) -> None:
        import httpx

        target = GatewayHttpBenchmarkTarget(endpoint_url="http://127.0.0.1:8080/v1/chat/completions")
        with patch("httpx.post", side_effect=httpx.TimeoutException("synthetic timeout")):
            result = target.detect("synthetic safe input", locale=None, timeout_ms=300)

        self.assertEqual(result.target_outcome, "timeout")
        self.assertEqual(result.sidecar_outcome, "unobserved")
        self.assertEqual(result.sidecar_observation, "not_observed")
        self.assertEqual(result.fallback_observation, "not_observed")

    def test_direct_sidecar_timeout_does_not_claim_gateway_fallback(self) -> None:
        import httpx

        target = HttpBenchmarkTarget(endpoint_url="http://127.0.0.1:8001/internal/ai-safety/v1/detect")
        with patch("httpx.post", side_effect=httpx.TimeoutException("synthetic timeout")):
            result = target.detect("synthetic safe input", locale=None, timeout_ms=300)

        self.assertEqual(result.sidecar_outcome, "timeout")
        self.assertEqual(result.sidecar_observation, "observed")
        self.assertEqual(result.fallback_mode, "not_observed")
        self.assertEqual(result.fallback_observation, "not_observed")

    def test_unobserved_gateway_sidecar_evidence_fails_report_gate(self) -> None:
        cases = load_benchmark_corpus(CORPUS_PATH)
        report, _, _ = build_fake_report(cases, mode="gateway_unobserved")
        runtime = selected_runtime(report)

        self.assertEqual(runtime["status"], "fail")
        self.assertIsNone(runtime["p95SidecarLatencyMs"])
        self.assertEqual(runtime["unobservedSidecarCount"], 100)
        self.assertEqual(runtime["evidenceCompletenessGate"], "fail")


class FakeBenchmarkTarget:
    def __init__(self, *, mode: str) -> None:
        self.mode = mode
        self.prompts: list[str] = []

    def detect(self, prompt_text: str, *, locale: str | None, timeout_ms: int) -> TargetResult:
        self.prompts.append(prompt_text)
        call_index = len(self.prompts)
        if self.mode == "timeout" and call_index % 10 == 0:
            return TargetResult(
                target_kind="gateway_with_observed_metrics",
                target_latency_ms=timeout_ms + 5,
                target_outcome="success",
                sidecar_latency_ms=None,
                sidecar_outcome="timeout",
                sidecar_observation="observed",
                fallback_mode="regex_only",
                fallback_observation="observed",
                sanitized_error_code="timeout",
            )
        if self.mode == "slow":
            return TargetResult(
                target_kind="direct_sidecar_http",
                target_latency_ms=900,
                target_outcome="success",
                sidecar_latency_ms=250,
                sidecar_outcome="success",
                sidecar_observation="observed",
                fallback_mode="none",
                fallback_observation="not_applicable",
            )
        if self.mode == "error":
            return TargetResult(
                target_kind="direct_sidecar_http",
                target_latency_ms=25,
                target_outcome="error",
                sidecar_latency_ms=None,
                sidecar_outcome="error",
                sidecar_observation="observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
                sanitized_error_code="fake_error",
            )
        if self.mode == "gateway_unobserved":
            return TargetResult(
                target_kind="gateway_http",
                target_latency_ms=55,
                target_outcome="success",
                sidecar_latency_ms=None,
                sidecar_outcome="unobserved",
                sidecar_observation="not_observed",
                fallback_mode="not_observed",
                fallback_observation="not_observed",
            )
        return TargetResult(
            target_kind="direct_sidecar_http",
            target_latency_ms=55 + (call_index % 7),
            target_outcome="success",
            sidecar_latency_ms=40 + (call_index % 5),
            sidecar_outcome="success",
            sidecar_observation="observed",
            fallback_mode="none",
            fallback_observation="not_applicable",
        )


class FakeGatewayResponse:
    def __init__(self, body: dict, *, status_code: int = 200) -> None:
        self.body = body
        self.status_code = status_code

    def json(self) -> dict:
        return self.body


def build_fake_report(
    cases: list,
    *,
    mode: str = "pass",
    evidence_binding: dict | None = None,
    git_sha: str | None = None,
) -> tuple[dict, FakeBenchmarkTarget, list]:
    fake_target = FakeBenchmarkTarget(mode=mode)
    resource_sampler = ResourceSampler.for_target(target="http", resource_pid=None)
    samples = run_benchmark(
        cases=cases,
        target=fake_target,
        runtime_profile="cpu_local_pipeline",
        warmup_requests=10,
        measured_requests=100,
        timeout_ms=300,
        request_timeout_ms=300,
        resource_sampler=resource_sampler,
    )
    report = build_report(
        samples=samples,
        runtime_profile="cpu_local_pipeline",
        target="http",
        warmup_requests=10,
        measured_requests=100,
        timeout_ms=300,
        request_timeout_ms=300,
        resource_summary=resource_sampler.summary(),
        run_id="test-run",
        git_sha=git_sha
        or (evidence_binding["gitRevision"] if evidence_binding is not None else "testsha"),
        model_revision=None,
        generated_at=datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc),
        hardware="test-machine",
        os_name="test-os",
        python_version="3.12",
        torch_version=None,
        transformers_version=None,
        evidence_binding=evidence_binding,
    )
    with tempfile.TemporaryDirectory() as temp_dir:
        write_reports(report, Path(temp_dir))
    return report, fake_target, samples


def selected_runtime(report: dict) -> dict:
    return next(runtime for runtime in report["runtimeResults"] if runtime["runtimeProfile"] == "cpu_local_pipeline")


def evidence_binding() -> dict:
    return {
        "schemaVersion": "pii-promotion-evidence-binding.v1",
        "manifestVersion": "synthetic-manifest.v1",
        "modelRevisions": {"synthetic/model": "revision-a"},
        "artifactChecksumsVerified": True,
        "gitRevision": "a" * 40,
    }


def artifact_verification() -> dict:
    return {
        "schemaVersion": "pii-artifact-verification.v1",
        "aggregateOnly": True,
        "filesExpected": 1,
        "filesVerified": 1,
        "checksumFailures": 0,
        "evidenceBinding": evidence_binding(),
    }


if __name__ == "__main__":
    unittest.main()
