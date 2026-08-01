from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import os
import platform
import re
import subprocess
import sys
import threading
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from time import perf_counter, sleep
from typing import Any, Protocol

from app.adapters.safety import PrivacyFilterAdapter
from app.domain.ai_safety_benchmark.corpus import (
    load_benchmark_corpus,
    render_case_prompt,
)
from app.domain.ai_safety_benchmark.report import (
    scan_text_for_forbidden_report_values,
)
from app.domain.ai_safety_benchmark.stats import nearest_rank
from app.domain.ai_safety_benchmark.types import BenchmarkError


REPORT_VERSION = "gatelm.pii-direct-inference-concurrency-benchmark.v1"
REGISTRY_VERSION = "gatelm.pii-model-canonical-registry.v1"
DEFAULT_CONCURRENCY_LEVELS = (1, 2, 4, 8, 16, 32)
DEFAULT_ROUNDS = 3
DEFAULT_WARMUP_REQUESTS = 32
DEFAULT_MEASURED_REQUESTS = 1000
DEFAULT_DEADLINE_MS = 100.0
DEFAULT_SAMPLE_INTERVAL_MS = 100.0
MODEL_VERSION_PATTERN = re.compile(
    r"^v0\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$"
)
LEGACY_VERSION_PATTERN = re.compile(r"^v\d+(?:\.\d+)*$")
FULL_GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CORPUS_PATH = (
    REPO_ROOT
    / "docs"
    / "ai-safety-lab"
    / "fixtures"
    / "resource-latency-benchmark-corpus.jsonl"
)
DEFAULT_OUTPUT_PATH = (
    REPO_ROOT
    / ".tmp"
    / "pii-concurrency-benchmark"
    / "pii-direct-inference-concurrency-latest.json"
)
CANONICAL_MODEL_REGISTRY_PATH = (
    REPO_ROOT
    / "apps"
    / "ai-service"
    / "app"
    / "model_artifacts"
    / "releases"
    / "pii-model-canonical-registry.json"
)
REQUIRED_MODEL_FILES = {
    "config.json",
    "export-report.json",
    "model.onnx",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.txt",
}


class DetectorAdapter(Protocol):
    def detect(self, text: str) -> object: ...

    def warmup(self) -> None: ...


class ResourceSampler(Protocol):
    def start(self) -> None: ...

    def mark_start(self) -> None: ...

    def stop(self, wall_seconds: float) -> dict[str, Any]: ...


AdapterFactory = Callable[[Path], DetectorAdapter]
SamplerFactory = Callable[[float], ResourceSampler]


@dataclass(frozen=True)
class ClosedLoopRun:
    summary: dict[str, Any]
    successful_latencies_ms: tuple[float, ...]
    wall_seconds: float


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Measure direct KoELECTRA ONNX inference while increasing closed-loop "
            "request concurrency."
        ),
    )
    parser.add_argument(
        "--model-dir",
        type=Path,
        required=True,
        help="Local exported model directory bound by the checked-in canonical registry.",
    )
    parser.add_argument(
        "--model-version",
        default="v0.1.1",
        help="Canonical GateLM model version required to match the artifact registry.",
    )
    parser.add_argument(
        "--concurrency-levels",
        default=",".join(str(value) for value in DEFAULT_CONCURRENCY_LEVELS),
        help="Comma-separated closed-loop client concurrency levels from 1 to 32.",
    )
    parser.add_argument(
        "--rounds",
        type=int,
        default=DEFAULT_ROUNDS,
        help="Measured rounds. Each round crosses or rotates level execution order.",
    )
    parser.add_argument(
        "--warmup-requests",
        type=int,
        default=DEFAULT_WARMUP_REQUESTS,
        help="Warmup requests before every measured level; excluded from results.",
    )
    parser.add_argument(
        "--measured-requests",
        type=int,
        default=DEFAULT_MEASURED_REQUESTS,
        help="Measured requests per concurrency level and round.",
    )
    parser.add_argument(
        "--deadline-ms",
        type=float,
        default=DEFAULT_DEADLINE_MS,
        help=(
            "Deadline threshold. Calls finish normally and are counted as "
            "deadlineExceeded rather than forcibly interrupted."
        ),
    )
    parser.add_argument(
        "--sample-interval-ms",
        type=float,
        default=DEFAULT_SAMPLE_INTERVAL_MS,
        help="Peak RSS and thread-count sampling interval. Default: 100 ms.",
    )
    parser.add_argument(
        "--cpu-affinity-count",
        type=int,
        default=None,
        help=(
            "Optional benchmark-only logical CPU affinity limit applied before "
            "the ONNX session is loaded."
        ),
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS_PATH,
        help="Existing 50-case synthetic benchmark corpus.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Aggregate-only JSON report path.",
    )
    parser.add_argument(
        "--git-sha",
        default=None,
        help="Optional immutable Git object id. Defaults to git rev-parse HEAD.",
    )
    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    adapter_factory: AdapterFactory | None = None,
    sampler_factory: SamplerFactory | None = None,
    generated_at: datetime | None = None,
    registry_path: Path = CANONICAL_MODEL_REGISTRY_PATH,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        levels = parse_concurrency_levels(args.concurrency_levels)
        validate_args(args, levels)
        apply_cpu_affinity_limit(args.cpu_affinity_count)
        git_sha = args.git_sha or current_git_sha()
        if not FULL_GIT_SHA_PATTERN.fullmatch(git_sha):
            raise BenchmarkError("an immutable Git SHA is required")
        model_binding = bind_model_artifact(
            model_dir=args.model_dir,
            model_version=args.model_version,
            registry_path=registry_path,
        )
        cases = load_benchmark_corpus(args.corpus)
        workload_texts = tuple(render_case_prompt(case) for case in cases)
        adapter = (
            adapter_factory(args.model_dir)
            if adapter_factory is not None
            else build_adapter(args.model_dir)
        )
        adapter.warmup()
        baseline_outputs = build_sequential_baseline(adapter, workload_texts)
        sampler_builder = sampler_factory or (
            lambda interval_ms: ProcessResourceSampler(interval_ms)
        )
        measured_runs: list[ClosedLoopRun] = []
        round_orders: list[dict[str, Any]] = []
        for round_index in range(args.rounds):
            execution_order = round_concurrency_order(levels, round_index)
            round_orders.append(
                {
                    "round": round_index + 1,
                    "concurrencyLevels": list(execution_order),
                }
            )
            for order_index, concurrency in enumerate(execution_order):
                run_closed_loop(
                    adapter=adapter,
                    texts=workload_texts,
                    baseline_outputs=baseline_outputs,
                    concurrency=concurrency,
                    request_count=args.warmup_requests,
                    deadline_ms=args.deadline_ms,
                    sampler=NullResourceSampler(),
                )
                measured = run_closed_loop(
                    adapter=adapter,
                    texts=workload_texts,
                    baseline_outputs=baseline_outputs,
                    concurrency=concurrency,
                    request_count=args.measured_requests,
                    deadline_ms=args.deadline_ms,
                    sampler=sampler_builder(args.sample_interval_ms),
                )
                raw_wall_seconds = measured.wall_seconds
                control_resources, control_wall_seconds = run_idle_control(
                    target_wall_seconds=raw_wall_seconds,
                    sampler=sampler_builder(args.sample_interval_ms),
                )
                measured_runs.append(
                    with_resource_control(
                        measured,
                        control_resources=control_resources,
                        control_wall_seconds=control_wall_seconds,
                        sample_interval_ms=args.sample_interval_ms,
                        round_number=round_index + 1,
                        order_index=order_index,
                    )
                )
        concurrency_summary = summarize_concurrency_results(
            measured_runs,
            levels=levels,
        )
        selection_summary = build_selection_summary(concurrency_summary)
        report = build_report(
            measured_runs=measured_runs,
            concurrency_summary=concurrency_summary,
            selection_summary=selection_summary,
            round_orders=round_orders,
            model_binding=model_binding,
            corpus_file=args.corpus,
            corpus_case_count=len(cases),
            rounds=args.rounds,
            warmup_requests=args.warmup_requests,
            measured_requests=args.measured_requests,
            deadline_ms=args.deadline_ms,
            sample_interval_ms=args.sample_interval_ms,
            git_sha=git_sha,
            generated_at=generated_at,
        )
        rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
        scan_text_for_forbidden_report_values(
            rendered,
            "PII concurrency benchmark report",
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes((rendered + "\n").encode("utf-8"))
    except (BenchmarkError, OSError, RuntimeError, ValueError, json.JSONDecodeError):
        print(
            "FAIL: PII concurrency benchmark could not produce safe aggregate evidence.",
            file=sys.stderr,
        )
        return 2

    selected_concurrency = selection_summary["highestEligibleThroughputConcurrency"]
    print(
        "PII direct inference concurrency benchmark completed: "
        f"rounds={args.rounds}, "
        f"levels={','.join(str(value) for value in levels)}, "
        f"requests_per_level_per_round={args.measured_requests}, "
        f"highest_eligible_throughput_concurrency="
        f"{selected_concurrency if selected_concurrency is not None else 'none'}, "
        f"report={args.out}"
    )
    return 0 if selected_concurrency is not None else 1


def validate_args(args: argparse.Namespace, levels: tuple[int, ...]) -> None:
    if not MODEL_VERSION_PATTERN.fullmatch(args.model_version):
        raise BenchmarkError("model-version must use canonical v0.x.y SemVer")
    if not 1 <= args.rounds <= 10:
        raise BenchmarkError("rounds must be between 1 and 10")
    if args.warmup_requests < max(levels):
        raise BenchmarkError(
            "warmup-requests must be at least the largest concurrency level"
        )
    if args.measured_requests < max(levels):
        raise BenchmarkError(
            "measured-requests must be at least the largest concurrency level"
        )
    if args.deadline_ms <= 0:
        raise BenchmarkError("deadline-ms must be positive")
    if not 10 <= args.sample_interval_ms <= 1000:
        raise BenchmarkError("sample-interval-ms must be between 10 and 1000")
    if args.cpu_affinity_count is not None and not (
        1 <= args.cpu_affinity_count <= 256
    ):
        raise BenchmarkError("cpu-affinity-count must be between 1 and 256")
    if args.git_sha is not None and not FULL_GIT_SHA_PATTERN.fullmatch(args.git_sha):
        raise BenchmarkError("git-sha must be a full lowercase Git object id")


def parse_concurrency_levels(raw_value: str) -> tuple[int, ...]:
    try:
        levels = tuple(int(part.strip()) for part in raw_value.split(","))
    except ValueError as exc:
        raise BenchmarkError("concurrency-levels must contain integers") from exc
    if not levels or any(value < 1 or value > 32 for value in levels):
        raise BenchmarkError("concurrency-levels must be between 1 and 32")
    if len(levels) != len(set(levels)):
        raise BenchmarkError("concurrency-levels must not contain duplicates")
    return levels


def round_concurrency_order(
    levels: tuple[int, ...],
    round_index: int,
) -> tuple[int, ...]:
    if not levels:
        raise BenchmarkError("concurrency levels must not be empty")
    ordered = levels if round_index % 2 == 0 else tuple(reversed(levels))
    rotation = (round_index // 2) % len(ordered)
    return ordered[rotation:] + ordered[:rotation]


def build_adapter(model_dir: Path) -> DetectorAdapter:
    return PrivacyFilterAdapter(
        model_name=str(model_dir),
        runtime="onnx",
    )


def build_sequential_baseline(
    adapter: DetectorAdapter,
    texts: Sequence[str],
) -> tuple[object, ...]:
    outputs: list[object] = []
    for text in texts:
        outputs.append(adapter.detect(text))
    return tuple(outputs)


def run_closed_loop(
    *,
    adapter: DetectorAdapter,
    texts: Sequence[str],
    baseline_outputs: Sequence[object],
    concurrency: int,
    request_count: int,
    deadline_ms: float,
    sampler: ResourceSampler,
) -> ClosedLoopRun:
    if not texts:
        raise BenchmarkError("benchmark workload must not be empty")
    if len(baseline_outputs) != len(texts):
        raise BenchmarkError("baseline output count must match workload text count")
    if request_count < concurrency:
        raise BenchmarkError("request count must be at least concurrency")

    assignments: list[list[tuple[int, str]]] = [
        [] for _ in range(concurrency)
    ]
    for request_index in range(request_count):
        workload_index = request_index % len(texts)
        assignments[request_index % concurrency].append(
            (workload_index, texts[workload_index])
        )

    barrier = threading.Barrier(concurrency + 1)
    active_lock = threading.Lock()
    active = 0
    peak_active = 0

    def worker(
        items: list[tuple[int, str]],
    ) -> list[tuple[float, bool, bool]]:
        nonlocal active, peak_active
        observations: list[tuple[float, bool, bool]] = []
        barrier.wait()
        for workload_index, text in items:
            started = perf_counter()
            with active_lock:
                active += 1
                peak_active = max(peak_active, active)
            succeeded = True
            output_matches = False
            try:
                output = adapter.detect(text)
                output_matches = output == baseline_outputs[workload_index]
            except Exception:
                succeeded = False
            finally:
                with active_lock:
                    active -= 1
            observations.append(
                (
                    (perf_counter() - started) * 1000,
                    succeeded,
                    output_matches,
                )
            )
        return observations

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(worker, items) for items in assignments]
        sampler.start()
        sampler.mark_start()
        started = perf_counter()
        barrier.wait()
        observations = [
            observation
            for future in futures
            for observation in future.result()
        ]
        wall_seconds = max(perf_counter() - started, 1e-9)
        raw_resources = sampler.stop(wall_seconds)

    successful_latencies = tuple(
        latency_ms for latency_ms, succeeded, _ in observations if succeeded
    )
    completed = len(observations)
    successful = len(successful_latencies)
    inference_errors = completed - successful
    output_mismatches = sum(
        succeeded and not output_matches
        for _, succeeded, output_matches in observations
    )
    deadline_exceeded = sum(
        latency_ms > deadline_ms for latency_ms, _, _ in observations
    )
    eligible = (
        inference_errors == 0
        and output_mismatches == 0
        and deadline_exceeded == 0
    )
    return ClosedLoopRun(
        summary={
            "concurrency": concurrency,
            "observedPeakActiveAdapterCalls": peak_active,
            "requested": request_count,
            "completed": completed,
            "successful": successful,
            "inferenceErrorCount": inference_errors,
            "outputMismatchCount": output_mismatches,
            "deadlineExceededCount": deadline_exceeded,
            "eligible": eligible,
            "wallTimeSeconds": rounded(wall_seconds),
            "completedRps": rounded(completed / wall_seconds),
            "successfulRps": rounded(successful / wall_seconds),
            "latencyMs": aggregate_latency(
                successful_latencies,
                population="successful_requests_in_this_round",
            ),
            "resourcesRaw": raw_resources,
        },
        successful_latencies_ms=successful_latencies,
        wall_seconds=wall_seconds,
    )


def run_idle_control(
    *,
    target_wall_seconds: float,
    sampler: ResourceSampler,
) -> tuple[dict[str, Any], float]:
    sampler.start()
    sampler.mark_start()
    started = perf_counter()
    sleep(max(target_wall_seconds, 0.0))
    observed_wall_seconds = max(perf_counter() - started, 1e-9)
    return sampler.stop(observed_wall_seconds), observed_wall_seconds


def with_resource_control(
    run_result: ClosedLoopRun,
    *,
    control_resources: dict[str, Any],
    control_wall_seconds: float,
    sample_interval_ms: float,
    round_number: int,
    order_index: int,
) -> ClosedLoopRun:
    summary = dict(run_result.summary)
    raw_resources = summary.pop("resourcesRaw")
    raw_wall_seconds = run_result.wall_seconds
    adjusted = adjusted_resources(
        raw_resources,
        control_resources,
        raw_wall_seconds=raw_wall_seconds,
        control_wall_seconds=control_wall_seconds,
        completed=int(summary["completed"]),
    )
    summary["round"] = round_number
    summary["orderIndex"] = order_index
    summary["resources"] = {
        "measurementScope": "benchmark_process_including_harness",
        "sampleIntervalMs": rounded(sample_interval_ms),
        "rawWallTimeSeconds": rounded(raw_wall_seconds),
        "idleControlWallTimeSeconds": rounded(control_wall_seconds),
        "raw": raw_resources,
        "idleControl": control_resources,
        "adjusted": adjusted,
    }
    return ClosedLoopRun(
        summary=summary,
        successful_latencies_ms=run_result.successful_latencies_ms,
        wall_seconds=run_result.wall_seconds,
    )


def adjusted_resources(
    raw: Mapping[str, Any],
    control: Mapping[str, Any],
    *,
    raw_wall_seconds: float,
    control_wall_seconds: float,
    completed: int,
) -> dict[str, Any]:
    if (
        raw.get("samplingStatus") != "collected"
        or control.get("samplingStatus") != "collected"
    ):
        return unavailable_resources("control_adjustment_unavailable")
    scale = raw_wall_seconds / max(control_wall_seconds, 1e-9)

    def subtract_scaled_count(name: str) -> float | None:
        raw_value = raw.get(name)
        control_value = control.get(name)
        if not isinstance(raw_value, (int, float)) or not isinstance(
            control_value, (int, float)
        ):
            return None
        return rounded(max(0.0, float(raw_value) - float(control_value) * scale))

    def subtract_rate(name: str) -> float | None:
        raw_value = raw.get(name)
        control_value = control.get(name)
        if not isinstance(raw_value, (int, float)) or not isinstance(
            control_value, (int, float)
        ):
            return None
        return rounded(max(0.0, float(raw_value) - float(control_value)))

    def subtract_peak(name: str) -> float | int | None:
        raw_value = raw.get(name)
        control_value = control.get(name)
        if not isinstance(raw_value, (int, float)) or not isinstance(
            control_value, (int, float)
        ):
            return None
        difference = max(0.0, float(raw_value) - float(control_value))
        return int(difference) if name == "peakThreadCount" else rounded(difference)

    raw_context = raw.get("contextSwitches")
    control_context = control.get("contextSwitches")
    adjusted_context = {
        "voluntary": None,
        "involuntary": None,
        "total": None,
        "perCompletedRequest": None,
    }
    if isinstance(raw_context, Mapping) and isinstance(control_context, Mapping):
        for name in ("voluntary", "involuntary", "total"):
            raw_value = raw_context.get(name)
            control_value = control_context.get(name)
            if isinstance(raw_value, int) and isinstance(control_value, int):
                adjusted_context[name] = int(
                    max(0, round(raw_value - control_value * scale))
                )
        total = adjusted_context["total"]
        if isinstance(total, int) and completed > 0:
            adjusted_context["perCompletedRequest"] = rounded(total / completed)

    return {
        "samplingStatus": "collected",
        "peakRssMiB": subtract_peak("peakRssMiB"),
        "peakThreadCount": subtract_peak("peakThreadCount"),
        "processCpuSeconds": subtract_scaled_count("processCpuSeconds"),
        "cpuCoreEquivalentPct": subtract_rate("cpuCoreEquivalentPct"),
        "cpuAvailableUtilizationPct": subtract_rate(
            "cpuAvailableUtilizationPct"
        ),
        "contextSwitches": adjusted_context,
    }


def aggregate_latency(
    values: Sequence[float],
    *,
    population: str,
) -> dict[str, float | int | str | None]:
    if not values:
        return {
            "population": population,
            "sampleCount": 0,
            "p50": None,
            "p95": None,
            "p99": None,
            "max": None,
        }
    return {
        "population": population,
        "sampleCount": len(values),
        "p50": rounded(nearest_rank(values, 0.50)),
        "p95": rounded(nearest_rank(values, 0.95)),
        "p99": rounded(nearest_rank(values, 0.99)),
        "max": rounded(max(values)),
    }


def summarize_concurrency_results(
    runs: Sequence[ClosedLoopRun],
    *,
    levels: Sequence[int],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for concurrency in levels:
        selected = [
            run for run in runs if run.summary["concurrency"] == concurrency
        ]
        if not selected:
            raise BenchmarkError("every concurrency level must have measured rounds")
        total_wall_seconds = sum(run.wall_seconds for run in selected)
        all_latencies = tuple(
            latency
            for run in selected
            for latency in run.successful_latencies_ms
        )
        requested = sum(int(run.summary["requested"]) for run in selected)
        completed = sum(int(run.summary["completed"]) for run in selected)
        successful = sum(int(run.summary["successful"]) for run in selected)
        inference_errors = sum(
            int(run.summary["inferenceErrorCount"]) for run in selected
        )
        output_mismatches = sum(
            int(run.summary["outputMismatchCount"]) for run in selected
        )
        deadline_exceeded = sum(
            int(run.summary["deadlineExceededCount"]) for run in selected
        )
        eligible = all(bool(run.summary["eligible"]) for run in selected)
        observed_successful_rps = rounded(
            successful / max(total_wall_seconds, 1e-9)
        )
        summaries.append(
            {
                "concurrency": concurrency,
                "roundCount": len(selected),
                "eligibleRoundCount": sum(
                    bool(run.summary["eligible"]) for run in selected
                ),
                "eligible": eligible,
                "requested": requested,
                "completed": completed,
                "successful": successful,
                "inferenceErrorCount": inference_errors,
                "outputMismatchCount": output_mismatches,
                "deadlineExceededCount": deadline_exceeded,
                "observedSuccessfulRps": observed_successful_rps,
                "eligibleSuccessfulRps": (
                    observed_successful_rps if eligible else None
                ),
                "latencyMs": aggregate_latency(
                    all_latencies,
                    population="successful_requests_across_all_rounds",
                ),
                "adjustedResourceMedian": aggregate_adjusted_resources(
                    selected
                ),
            }
        )
    return summaries


def aggregate_adjusted_resources(
    runs: Sequence[ClosedLoopRun],
) -> dict[str, Any]:
    resources = [
        run.summary["resources"]["adjusted"]
        for run in runs
        if run.summary["resources"]["adjusted"].get("samplingStatus")
        == "collected"
    ]
    if not resources:
        return unavailable_resources("not_collected")

    def median_value(name: str) -> float | None:
        values = [
            float(resource[name])
            for resource in resources
            if isinstance(resource.get(name), (int, float))
        ]
        return (
            rounded(nearest_rank(values, 0.50))
            if values
            else None
        )

    context_values: dict[str, int | float | None] = {}
    for name in ("voluntary", "involuntary", "total", "perCompletedRequest"):
        values = [
            float(resource["contextSwitches"][name])
            for resource in resources
            if isinstance(
                resource.get("contextSwitches", {}).get(name),
                (int, float),
            )
        ]
        context_values[name] = (
            rounded(nearest_rank(values, 0.50))
            if values
            else None
        )
    peak_thread_count = median_value("peakThreadCount")
    return {
        "samplingStatus": "collected",
        "peakRssMiB": median_value("peakRssMiB"),
        "peakThreadCount": (
            int(peak_thread_count)
            if peak_thread_count is not None
            else None
        ),
        "processCpuSeconds": median_value("processCpuSeconds"),
        "cpuCoreEquivalentPct": median_value("cpuCoreEquivalentPct"),
        "cpuAvailableUtilizationPct": median_value(
            "cpuAvailableUtilizationPct"
        ),
        "contextSwitches": context_values,
    }


def build_selection_summary(
    concurrency_summary: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    eligible = [
        result
        for result in concurrency_summary
        if result.get("eligible") is True
        and isinstance(result.get("eligibleSuccessfulRps"), (int, float))
    ]
    selected = (
        max(eligible, key=lambda result: float(result["eligibleSuccessfulRps"]))
        if eligible
        else None
    )
    return {
        "eligibilityRule": (
            "all_rounds_have_zero_inference_errors_output_mismatches_"
            "and_deadline_excesses"
        ),
        "eligibleConcurrencyLevels": [
            int(result["concurrency"]) for result in eligible
        ],
        "highestEligibleThroughputConcurrency": (
            int(selected["concurrency"]) if selected is not None else None
        ),
        "highestEligibleSuccessfulRps": (
            float(selected["eligibleSuccessfulRps"])
            if selected is not None
            else None
        ),
    }


def build_report(
    *,
    measured_runs: Sequence[ClosedLoopRun],
    concurrency_summary: list[dict[str, Any]],
    selection_summary: dict[str, Any],
    round_orders: list[dict[str, Any]],
    model_binding: dict[str, Any],
    corpus_file: Path,
    corpus_case_count: int,
    rounds: int,
    warmup_requests: int,
    measured_requests: int,
    deadline_ms: float,
    sample_interval_ms: float,
    git_sha: str,
    generated_at: datetime | None,
) -> dict[str, Any]:
    timestamp = generated_at or datetime.now(tz=timezone.utc)
    return {
        "reportVersion": REPORT_VERSION,
        "generatedAt": timestamp.isoformat().replace("+00:00", "Z"),
        "gitSha": git_sha,
        "trackedWorktreeDirty": tracked_worktree_dirty(),
        "evidenceOnly": True,
        "provenance": {
            "benchmarkRunnerSha256": sha256_file(Path(__file__)),
            "adapterImplementationSha256": sha256_file(
                REPO_ROOT
                / "apps"
                / "ai-service"
                / "app"
                / "adapters"
                / "safety"
                / "privacy_filter_adapter.py"
            ),
            "corpusImplementationSha256": sha256_file(
                REPO_ROOT
                / "apps"
                / "ai-service"
                / "app"
                / "domain"
                / "ai_safety_benchmark"
                / "corpus.py"
            ),
            "statsImplementationSha256": sha256_file(
                REPO_ROOT
                / "apps"
                / "ai-service"
                / "app"
                / "domain"
                / "ai_safety_benchmark"
                / "stats.py"
            ),
        },
        "model": model_binding,
        "workload": {
            "corpusSha256": sha256_file(corpus_file),
            "caseCount": corpus_case_count,
            "valueMode": (
                "rendered_synthetic_values_in_memory_not_persisted"
            ),
            "sequentialBaselineRequests": corpus_case_count,
            "baselineSemantics": (
                "full_detection_objects_compared_in_memory_only"
            ),
            "rounds": rounds,
            "warmupRequestsPerLevelPerRound": warmup_requests,
            "measuredRequestsPerLevelPerRound": measured_requests,
            "measuredRequestsPerLevelTotal": rounds * measured_requests,
            "deadlineMs": rounded(deadline_ms),
            "deadlineSemantics": (
                "observed_after_completion_no_forced_interrupt"
            ),
            "deadlinePopulation": (
                "all_completed_requests_including_inference_errors"
            ),
            "p99Population": (
                "successful_requests_across_all_rounds_for_each_concurrency"
            ),
        },
        "runtime": runtime_metadata(sample_interval_ms),
        "roundExecutionOrder": round_orders,
        "roundResults": [run.summary for run in measured_runs],
        "concurrencySummary": concurrency_summary,
        "selectionSummary": selection_summary,
    }


class NullResourceSampler:
    def start(self) -> None:
        return None

    def mark_start(self) -> None:
        return None

    def stop(self, _wall_seconds: float) -> dict[str, Any]:
        return unavailable_resources("not_collected")


class ProcessResourceSampler:
    def __init__(self, sample_interval_ms: float) -> None:
        self._sample_interval_seconds = sample_interval_ms / 1000
        self._stop = threading.Event()
        self._sample_lock = threading.Lock()
        self._sampler_thread: threading.Thread | None = None
        self._process: Any | None = None
        self._initial_cpu_seconds: float | None = None
        self._initial_context_switches: tuple[int, int] | None = None
        self._peak_rss_bytes: int | None = None
        self._peak_thread_count: int | None = None
        self._available_cpu_count: int | None = None
        self._status = "collected"

    def start(self) -> None:
        try:
            import psutil  # type: ignore[import-not-found]

            self._process = psutil.Process()
            self._available_cpu_count = process_available_cpu_count(
                self._process
            )
            with self._sample_lock:
                self._sample_once_unlocked()
        except Exception:
            self._process = None
            self._status = "psutil_unavailable"
            return

        self._sampler_thread = threading.Thread(
            target=self._sample_until_stopped,
            name="pii-concurrency-resource-sampler",
            daemon=True,
        )
        self._sampler_thread.start()

    def mark_start(self) -> None:
        if self._process is None:
            return
        try:
            with self._sample_lock:
                cpu_times = self._process.cpu_times()
                self._initial_cpu_seconds = float(
                    cpu_times.user + cpu_times.system
                )
                self._initial_context_switches = context_switch_counts(
                    self._process
                )
        except Exception:
            self._status = "resource_sample_failed"

    def stop(self, wall_seconds: float) -> dict[str, Any]:
        if self._process is None:
            return unavailable_resources(self._status)
        self._stop.set()
        try:
            with self._sample_lock:
                self._sample_once_unlocked()
                cpu_times = self._process.cpu_times()
                final_cpu_seconds = float(cpu_times.user + cpu_times.system)
                final_context_switches = context_switch_counts(self._process)
            initial_cpu_seconds = self._initial_cpu_seconds
            cpu_seconds = (
                max(0.0, final_cpu_seconds - initial_cpu_seconds)
                if initial_cpu_seconds is not None
                else None
            )
            context_switches = context_switch_delta(
                self._initial_context_switches,
                final_context_switches,
            )
        except Exception:
            return unavailable_resources("resource_sample_failed")
        finally:
            if self._sampler_thread is not None:
                self._sampler_thread.join(timeout=1)

        available_cpus = max(self._available_cpu_count or 1, 1)
        core_equivalent_pct = (
            (cpu_seconds / max(wall_seconds, 1e-9)) * 100
            if cpu_seconds is not None
            else None
        )
        return {
            "samplingStatus": self._status,
            "peakRssMiB": (
                rounded(self._peak_rss_bytes / (1024 * 1024))
                if self._peak_rss_bytes is not None
                else None
            ),
            "peakThreadCount": self._peak_thread_count,
            "processCpuSeconds": (
                rounded(cpu_seconds) if cpu_seconds is not None else None
            ),
            "cpuCoreEquivalentPct": (
                rounded(core_equivalent_pct)
                if core_equivalent_pct is not None
                else None
            ),
            "cpuAvailableUtilizationPct": (
                rounded(core_equivalent_pct / available_cpus)
                if core_equivalent_pct is not None
                else None
            ),
            "contextSwitches": context_switches,
        }

    def _sample_until_stopped(self) -> None:
        while not self._stop.wait(self._sample_interval_seconds):
            try:
                with self._sample_lock:
                    self._sample_once_unlocked()
            except Exception:
                self._status = "resource_sample_failed"
                self._stop.set()
                return

    def _sample_once_unlocked(self) -> None:
        if self._process is None:
            return
        rss_bytes = int(self._process.memory_info().rss)
        thread_count = int(self._process.num_threads())
        self._peak_rss_bytes = max(self._peak_rss_bytes or 0, rss_bytes)
        self._peak_thread_count = max(
            self._peak_thread_count or 0,
            thread_count,
        )


def context_switch_counts(process: Any) -> tuple[int, int] | None:
    try:
        values = process.num_ctx_switches()
        return int(values.voluntary), int(values.involuntary)
    except Exception:
        return None


def context_switch_delta(
    initial: tuple[int, int] | None,
    final: tuple[int, int] | None,
) -> dict[str, int | None]:
    if initial is None or final is None:
        return {
            "voluntary": None,
            "involuntary": None,
            "total": None,
        }
    voluntary = max(0, final[0] - initial[0])
    involuntary = max(0, final[1] - initial[1])
    return {
        "voluntary": voluntary,
        "involuntary": involuntary,
        "total": voluntary + involuntary,
    }


def unavailable_resources(status: str) -> dict[str, Any]:
    return {
        "samplingStatus": status,
        "peakRssMiB": None,
        "peakThreadCount": None,
        "processCpuSeconds": None,
        "cpuCoreEquivalentPct": None,
        "cpuAvailableUtilizationPct": None,
        "contextSwitches": {
            "voluntary": None,
            "involuntary": None,
            "total": None,
        },
    }


def process_available_cpu_count(process: Any | None = None) -> int:
    candidate = process
    if candidate is None:
        try:
            import psutil  # type: ignore[import-not-found]

            candidate = psutil.Process()
        except Exception:
            candidate = None
    if candidate is not None:
        try:
            affinity = candidate.cpu_affinity()
            if affinity:
                return len(affinity)
        except Exception:
            pass
    return max(os.cpu_count() or 1, 1)


def apply_cpu_affinity_limit(
    requested_count: int | None,
    *,
    process: Any | None = None,
) -> int:
    if requested_count is None:
        return process_available_cpu_count(process)
    candidate = process
    if candidate is None:
        try:
            import psutil  # type: ignore[import-not-found]

            candidate = psutil.Process()
        except Exception as exc:
            raise BenchmarkError(
                "psutil with CPU affinity support is required when "
                "cpu-affinity-count is set"
            ) from exc
    try:
        available = sorted(int(cpu) for cpu in candidate.cpu_affinity())
    except Exception as exc:
        raise BenchmarkError("process CPU affinity is unavailable") from exc
    if requested_count > len(available):
        raise BenchmarkError(
            "cpu-affinity-count exceeds the CPUs available to this process"
        )
    selected = available[:requested_count]
    try:
        candidate.cpu_affinity(selected)
        confirmed = candidate.cpu_affinity()
    except Exception as exc:
        raise BenchmarkError("failed to apply process CPU affinity") from exc
    if len(confirmed) != requested_count:
        raise BenchmarkError("process CPU affinity verification failed")
    return len(confirmed)


def physical_cpu_count() -> int | None:
    try:
        import psutil  # type: ignore[import-not-found]

        return psutil.cpu_count(logical=False)
    except Exception:
        return None


def runtime_metadata(sample_interval_ms: float) -> dict[str, Any]:
    return {
        "os": platform.platform(),
        "machine": platform.machine(),
        "cpuModel": cpu_model(),
        "logicalCpuCount": os.cpu_count(),
        "physicalCpuCount": physical_cpu_count(),
        "processAffinityCpuCount": process_available_cpu_count(),
        "pythonVersion": platform.python_version(),
        "packageVersions": {
            name: optional_package_version(name)
            for name in (
                "numpy",
                "onnxruntime",
                "psutil",
                "tokenizers",
                "transformers",
            )
        },
        "onnxAvailableProviders": available_onnx_providers(),
        "onnxIntraOpThreads": env_integer(
            "AI_SERVICE_ONNX_INTRA_OP_THREADS"
        ),
        "onnxInterOpThreads": env_integer(
            "AI_SERVICE_ONNX_INTER_OP_THREADS"
        ),
        "onnxAllowSpinning": env_boolean(
            "AI_SERVICE_ONNX_ALLOW_SPINNING"
        ),
        "peakSampleIntervalMs": rounded(sample_interval_ms),
        "resourceControl": "same_wall_idle_process_control",
    }


def cpu_model() -> str:
    value = platform.processor().strip()
    if value:
        return value
    return os.getenv("PROCESSOR_IDENTIFIER", "").strip() or platform.machine()


def optional_package_version(package_name: str) -> str | None:
    try:
        return importlib.metadata.version(package_name)
    except importlib.metadata.PackageNotFoundError:
        return None


def available_onnx_providers() -> list[str] | None:
    try:
        import onnxruntime  # type: ignore[import-not-found]

        return sorted(str(value) for value in onnxruntime.get_available_providers())
    except Exception:
        return None


def load_canonical_model_registry(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise BenchmarkError("canonical model registry is missing")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise BenchmarkError("canonical model registry must be an object")
    if set(value) != {"schemaVersion", "modelId", "entries"}:
        raise BenchmarkError("canonical model registry fields are invalid")
    if value["schemaVersion"] != REGISTRY_VERSION:
        raise BenchmarkError("canonical model registry version is invalid")
    if not isinstance(value["modelId"], str) or value["modelId"].strip() == "":
        raise BenchmarkError("canonical model registry modelId is invalid")
    entries = value["entries"]
    if not isinstance(entries, list) or not entries:
        raise BenchmarkError("canonical model registry entries are invalid")
    versions: set[str] = set()
    for entry in entries:
        validate_registry_entry(entry)
        version = entry["canonicalVersion"]
        if version in versions:
            raise BenchmarkError("canonical model versions must be unique")
        versions.add(version)
    return value


def validate_registry_entry(entry: Any) -> None:
    expected_fields = {
        "canonicalVersion",
        "legacyRevision",
        "runtime",
        "lifecycle",
        "sourceManifests",
        "files",
    }
    if not isinstance(entry, dict) or set(entry) != expected_fields:
        raise BenchmarkError("canonical model registry entry fields are invalid")
    if not MODEL_VERSION_PATTERN.fullmatch(entry["canonicalVersion"]):
        raise BenchmarkError("canonical registry model version is invalid")
    if not LEGACY_VERSION_PATTERN.fullmatch(entry["legacyRevision"]):
        raise BenchmarkError("canonical registry legacy revision is invalid")
    for name in ("runtime", "lifecycle"):
        if not isinstance(entry[name], str) or entry[name].strip() == "":
            raise BenchmarkError("canonical registry metadata is invalid")
    source_manifests = entry["sourceManifests"]
    if not isinstance(source_manifests, list) or not source_manifests:
        raise BenchmarkError("canonical registry source manifests are invalid")
    for source in source_manifests:
        if not isinstance(source, dict) or set(source) != {"path", "sha256"}:
            raise BenchmarkError("canonical registry source manifest is invalid")
        validate_relative_registry_path(source["path"])
        if not SHA256_PATTERN.fullmatch(source["sha256"]):
            raise BenchmarkError("canonical registry source SHA-256 is invalid")
    files = entry["files"]
    if not isinstance(files, list) or not files:
        raise BenchmarkError("canonical registry artifact files are invalid")
    paths: set[str] = set()
    for file_entry in files:
        if not isinstance(file_entry, dict) or set(file_entry) != {
            "path",
            "bytes",
            "sha256",
        }:
            raise BenchmarkError("canonical registry artifact file is invalid")
        file_path = file_entry["path"]
        validate_relative_registry_path(file_path)
        if file_path in paths:
            raise BenchmarkError("canonical registry artifact paths must be unique")
        paths.add(file_path)
        if not isinstance(file_entry["bytes"], int) or file_entry["bytes"] <= 0:
            raise BenchmarkError("canonical registry artifact bytes are invalid")
        if not SHA256_PATTERN.fullmatch(file_entry["sha256"]):
            raise BenchmarkError("canonical registry artifact SHA-256 is invalid")
    if paths != REQUIRED_MODEL_FILES:
        raise BenchmarkError("canonical registry artifact file set is invalid")


def validate_relative_registry_path(value: Any) -> None:
    if not isinstance(value, str) or value.strip() == "":
        raise BenchmarkError("canonical registry path is invalid")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value:
        raise BenchmarkError("canonical registry path must be relative")


def bind_model_artifact(
    *,
    model_dir: Path,
    model_version: str,
    registry_path: Path,
) -> dict[str, Any]:
    registry = load_canonical_model_registry(registry_path)
    entry = next(
        (
            item
            for item in registry["entries"]
            if item["canonicalVersion"] == model_version
        ),
        None,
    )
    if entry is None:
        raise BenchmarkError("model version is not present in canonical registry")
    total_bytes = 0
    for expected in entry["files"]:
        candidate = model_dir / expected["path"]
        if not candidate.is_file():
            raise BenchmarkError("model artifact file is missing")
        if candidate.stat().st_size != expected["bytes"]:
            raise BenchmarkError("model artifact byte size does not match registry")
        if sha256_file(candidate) != expected["sha256"]:
            raise BenchmarkError("model artifact SHA-256 does not match registry")
        total_bytes += expected["bytes"]
    model_file = next(
        item for item in entry["files"] if item["path"] == "model.onnx"
    )
    artifact_manifest_text = json.dumps(
        entry,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "modelId": registry["modelId"],
        "version": entry["canonicalVersion"],
        "legacyRevision": entry["legacyRevision"],
        "runtime": entry["runtime"],
        "lifecycle": entry["lifecycle"],
        "registryVersion": registry["schemaVersion"],
        "registrySha256": sha256_file(registry_path),
        "artifactManifestSha256": hashlib.sha256(
            artifact_manifest_text.encode("utf-8")
        ).hexdigest(),
        "artifactFileCount": len(entry["files"]),
        "artifactBytes": total_bytes,
        "modelOnnxSha256": model_file["sha256"],
        "modelOnnxBytes": model_file["bytes"],
        "sourceManifestSha256": [
            source["sha256"] for source in entry["sourceManifests"]
        ],
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_git_sha() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    candidate = completed.stdout.strip().lower()
    return candidate if FULL_GIT_SHA_PATTERN.fullmatch(candidate) else "unknown"


def tracked_worktree_dirty() -> bool | None:
    try:
        completed = subprocess.run(
            ["git", "diff", "--quiet", "HEAD", "--"],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode == 0:
        return False
    if completed.returncode == 1:
        return True
    return None


def env_integer(name: str) -> int | None:
    value = os.getenv(name)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def env_boolean(name: str) -> bool | None:
    value = os.getenv(name)
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return None


def rounded(value: float) -> float:
    if not math.isfinite(value):
        raise BenchmarkError("benchmark result must be finite")
    return round(float(value), 3)


if __name__ == "__main__":
    raise SystemExit(run())
