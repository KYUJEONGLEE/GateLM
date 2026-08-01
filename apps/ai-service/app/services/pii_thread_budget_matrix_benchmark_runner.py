from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.domain.ai_safety_benchmark.report import (
    scan_text_for_forbidden_report_values,
)
from app.domain.ai_safety_benchmark.types import BenchmarkError
from app.services import (
    pii_direct_inference_concurrency_benchmark_runner as direct_runner,
)


REPORT_VERSION = "gatelm.pii-thread-budget-matrix-benchmark.v1"
DEFAULT_CONFIGURATIONS = "1x4,2x2,4x1"
DEFAULT_CPU_BUDGET = 4
DEFAULT_CHILD_TIMEOUT_SECONDS = 900
CONFIGURATION_PATTERN = re.compile(r"^(?P<concurrency>\d+)[xX](?P<intra>\d+)$")
DEFAULT_OUTPUT_PATH = (
    direct_runner.REPO_ROOT
    / ".tmp"
    / "pii-concurrency-benchmark"
    / "pii-thread-budget-matrix-latest.json"
)
AI_SERVICE_ROOT = direct_runner.REPO_ROOT / "apps" / "ai-service"


@dataclass(frozen=True)
class ThreadBudgetConfiguration:
    request_concurrency: int
    onnx_intra_op_threads: int

    @property
    def configuration_id(self) -> str:
        return (
            f"concurrency-{self.request_concurrency}-"
            f"intra-op-{self.onnx_intra_op_threads}"
        )

    @property
    def thread_budget(self) -> int:
        return self.request_concurrency * self.onnx_intra_op_threads


ChildExecutor = Callable[..., Mapping[str, Any]]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Compare request concurrency and ONNX intra-op thread combinations "
            "under one fixed logical CPU budget."
        ),
    )
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-version", default="v0.1.1")
    parser.add_argument(
        "--configurations",
        default=DEFAULT_CONFIGURATIONS,
        help=(
            "Comma-separated request-concurrency x ONNX-intra-op-thread pairs. "
            "Every product must equal cpu-budget."
        ),
    )
    parser.add_argument(
        "--cpu-budget",
        type=int,
        default=DEFAULT_CPU_BUDGET,
        help="Logical CPUs made available to every child process.",
    )
    parser.add_argument(
        "--rounds",
        type=int,
        default=direct_runner.DEFAULT_ROUNDS,
    )
    parser.add_argument(
        "--warmup-requests",
        type=int,
        default=direct_runner.DEFAULT_WARMUP_REQUESTS,
    )
    parser.add_argument(
        "--measured-requests",
        type=int,
        default=direct_runner.DEFAULT_MEASURED_REQUESTS,
    )
    parser.add_argument(
        "--deadline-ms",
        type=float,
        default=direct_runner.DEFAULT_DEADLINE_MS,
    )
    parser.add_argument(
        "--sample-interval-ms",
        type=float,
        default=direct_runner.DEFAULT_SAMPLE_INTERVAL_MS,
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=direct_runner.DEFAULT_CORPUS_PATH,
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--git-sha", default=None)
    parser.add_argument(
        "--child-timeout-seconds",
        type=int,
        default=DEFAULT_CHILD_TIMEOUT_SECONDS,
    )
    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    child_executor: ChildExecutor | None = None,
    generated_at: datetime | None = None,
    registry_path: Path = direct_runner.CANONICAL_MODEL_REGISTRY_PATH,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        configurations = parse_configurations(
            args.configurations,
            cpu_budget=args.cpu_budget,
        )
        validate_args(args, configurations)
        git_sha = args.git_sha or direct_runner.current_git_sha()
        if not direct_runner.FULL_GIT_SHA_PATTERN.fullmatch(git_sha):
            raise BenchmarkError("an immutable Git SHA is required")
        available_cpus = direct_runner.process_available_cpu_count()
        if args.cpu_budget > available_cpus:
            raise BenchmarkError(
                "cpu-budget exceeds the CPUs available to the parent process"
            )
        model_binding = direct_runner.bind_model_artifact(
            model_dir=args.model_dir,
            model_version=args.model_version,
            registry_path=registry_path,
        )
        execute = child_executor or execute_direct_child
        round_results: list[dict[str, Any]] = []
        round_orders: list[dict[str, Any]] = []
        common_runtime: dict[str, Any] | None = None
        with tempfile.TemporaryDirectory(
            prefix="gatelm-pii-thread-budget-"
        ) as temp_dir:
            temp_root = Path(temp_dir)
            for round_index in range(args.rounds):
                execution_order = round_configuration_order(
                    configurations,
                    round_index,
                )
                round_orders.append(
                    {
                        "round": round_index + 1,
                        "configurationIds": [
                            config.configuration_id
                            for config in execution_order
                        ],
                    }
                )
                for order_index, configuration in enumerate(execution_order):
                    child_report = execute(
                        configuration=configuration,
                        round_number=round_index + 1,
                        args=args,
                        git_sha=git_sha,
                        out_path=(
                            temp_root
                            / (
                                f"round-{round_index + 1}-"
                                f"{configuration.configuration_id}.json"
                            )
                        ),
                    )
                    result, runtime = extract_child_result(
                        child_report,
                        configuration=configuration,
                        round_number=round_index + 1,
                        order_index=order_index,
                        args=args,
                        git_sha=git_sha,
                        model_binding=model_binding,
                    )
                    round_results.append(result)
                    if common_runtime is None:
                        common_runtime = runtime
                    elif runtime != common_runtime:
                        raise BenchmarkError(
                            "child runtime metadata changed across configurations"
                        )
        if common_runtime is None:
            raise BenchmarkError("matrix benchmark produced no child results")
        configuration_summary = summarize_configurations(
            round_results,
            configurations=configurations,
            rounds=args.rounds,
            deadline_ms=args.deadline_ms,
        )
        add_baseline_comparisons(
            configuration_summary,
            cpu_budget=args.cpu_budget,
        )
        selection = build_selection_summary(configuration_summary)
        report = build_report(
            args=args,
            git_sha=git_sha,
            generated_at=generated_at,
            model_binding=model_binding,
            configurations=configurations,
            round_orders=round_orders,
            round_results=round_results,
            configuration_summary=configuration_summary,
            selection=selection,
            runtime=common_runtime,
        )
        rendered = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
        scan_text_for_forbidden_report_values(
            rendered,
            "PII thread budget matrix benchmark report",
        )
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes((rendered + "\n").encode("utf-8"))
    except (
        BenchmarkError,
        OSError,
        RuntimeError,
        ValueError,
        json.JSONDecodeError,
        subprocess.TimeoutExpired,
    ):
        print(
            "FAIL: PII thread budget matrix could not produce safe aggregate evidence.",
            file=sys.stderr,
        )
        return 2

    candidate = selection["revalidationCandidateConfigurationId"]
    print(
        "PII thread budget matrix completed: "
        f"cpu_budget={args.cpu_budget}, "
        f"rounds={args.rounds}, "
        f"revalidation_candidate={candidate or 'none'}, "
        f"report={args.out}"
    )
    return 0 if candidate is not None else 1


def parse_configurations(
    raw_value: str,
    *,
    cpu_budget: int,
) -> tuple[ThreadBudgetConfiguration, ...]:
    configurations: list[ThreadBudgetConfiguration] = []
    for raw_part in raw_value.split(","):
        match = CONFIGURATION_PATTERN.fullmatch(raw_part.strip())
        if match is None:
            raise BenchmarkError(
                "configurations must use request-concurrency x intra-op syntax"
            )
        configuration = ThreadBudgetConfiguration(
            request_concurrency=int(match.group("concurrency")),
            onnx_intra_op_threads=int(match.group("intra")),
        )
        if not 1 <= configuration.request_concurrency <= 32:
            raise BenchmarkError("request concurrency must be between 1 and 32")
        if not 1 <= configuration.onnx_intra_op_threads <= 64:
            raise BenchmarkError("ONNX intra-op threads must be between 1 and 64")
        if configuration.thread_budget != cpu_budget:
            raise BenchmarkError(
                "every configuration must use exactly the fixed CPU budget"
            )
        configurations.append(configuration)
    if len(configurations) < 2:
        raise BenchmarkError("at least two configurations are required")
    ids = [configuration.configuration_id for configuration in configurations]
    if len(ids) != len(set(ids)):
        raise BenchmarkError("configurations must not contain duplicates")
    baseline = ThreadBudgetConfiguration(1, cpu_budget)
    if baseline not in configurations:
        raise BenchmarkError("configurations must include the 1 x cpu-budget baseline")
    return tuple(configurations)


def validate_args(
    args: argparse.Namespace,
    configurations: Sequence[ThreadBudgetConfiguration],
) -> None:
    if not 1 <= args.cpu_budget <= 64:
        raise BenchmarkError("cpu-budget must be between 1 and 64")
    if not direct_runner.MODEL_VERSION_PATTERN.fullmatch(args.model_version):
        raise BenchmarkError("model-version must use canonical v0.x.y SemVer")
    if not 1 <= args.rounds <= 10:
        raise BenchmarkError("rounds must be between 1 and 10")
    largest_concurrency = max(
        configuration.request_concurrency
        for configuration in configurations
    )
    if args.warmup_requests < largest_concurrency:
        raise BenchmarkError(
            "warmup-requests must be at least the largest request concurrency"
        )
    if args.measured_requests < largest_concurrency:
        raise BenchmarkError(
            "measured-requests must be at least the largest request concurrency"
        )
    if args.deadline_ms <= 0:
        raise BenchmarkError("deadline-ms must be positive")
    if not 10 <= args.sample_interval_ms <= 1000:
        raise BenchmarkError("sample-interval-ms must be between 10 and 1000")
    if not 30 <= args.child_timeout_seconds <= 3600:
        raise BenchmarkError("child-timeout-seconds must be between 30 and 3600")
    if args.git_sha is not None and not (
        direct_runner.FULL_GIT_SHA_PATTERN.fullmatch(args.git_sha)
    ):
        raise BenchmarkError("git-sha must be a full lowercase Git object id")


def round_configuration_order(
    configurations: tuple[ThreadBudgetConfiguration, ...],
    round_index: int,
) -> tuple[ThreadBudgetConfiguration, ...]:
    if not configurations:
        raise BenchmarkError("configurations must not be empty")
    ordered = (
        configurations
        if round_index % 2 == 0
        else tuple(reversed(configurations))
    )
    rotation = (round_index // 2) % len(ordered)
    return ordered[rotation:] + ordered[:rotation]


def execute_direct_child(
    *,
    configuration: ThreadBudgetConfiguration,
    round_number: int,
    args: argparse.Namespace,
    git_sha: str,
    out_path: Path,
) -> Mapping[str, Any]:
    environment = os.environ.copy()
    environment.update(
        {
            "AI_SERVICE_ONNX_INTRA_OP_THREADS": str(
                configuration.onnx_intra_op_threads
            ),
            "AI_SERVICE_ONNX_INTER_OP_THREADS": "1",
            "AI_SERVICE_ONNX_ALLOW_SPINNING": "false",
            "AI_SERVICE_TRANSFORMERS_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_OFFLINE": "1",
        }
    )
    command = [
        sys.executable,
        "-m",
        "app.services.pii_direct_inference_concurrency_benchmark_runner",
        "--model-dir",
        str(args.model_dir.resolve()),
        "--model-version",
        args.model_version,
        "--concurrency-levels",
        str(configuration.request_concurrency),
        "--rounds",
        "1",
        "--warmup-requests",
        str(args.warmup_requests),
        "--measured-requests",
        str(args.measured_requests),
        "--deadline-ms",
        str(args.deadline_ms),
        "--sample-interval-ms",
        str(args.sample_interval_ms),
        "--cpu-affinity-count",
        str(args.cpu_budget),
        "--corpus",
        str(args.corpus.resolve()),
        "--out",
        str(out_path),
        "--git-sha",
        git_sha,
    ]
    completed = subprocess.run(
        command,
        cwd=AI_SERVICE_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        timeout=args.child_timeout_seconds,
    )
    if completed.returncode not in {0, 1} or not out_path.is_file():
        raise BenchmarkError(
            f"direct benchmark child failed in round {round_number}"
        )
    report = json.loads(out_path.read_text(encoding="utf-8"))
    if not isinstance(report, dict):
        raise BenchmarkError("direct benchmark child report must be an object")
    return report


def extract_child_result(
    report: Mapping[str, Any],
    *,
    configuration: ThreadBudgetConfiguration,
    round_number: int,
    order_index: int,
    args: argparse.Namespace,
    git_sha: str,
    model_binding: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if report.get("reportVersion") != direct_runner.REPORT_VERSION:
        raise BenchmarkError("direct child report version is invalid")
    if report.get("gitSha") != git_sha or report.get("model") != model_binding:
        raise BenchmarkError("direct child provenance does not match the matrix")
    runtime = report.get("runtime")
    workload = report.get("workload")
    summaries = report.get("concurrencySummary")
    if (
        not isinstance(runtime, dict)
        or not isinstance(workload, dict)
        or not isinstance(summaries, list)
        or len(summaries) != 1
        or not isinstance(summaries[0], dict)
    ):
        raise BenchmarkError("direct child report shape is invalid")
    if (
        runtime.get("processAffinityCpuCount") != args.cpu_budget
        or runtime.get("onnxIntraOpThreads")
        != configuration.onnx_intra_op_threads
        or runtime.get("onnxInterOpThreads") != 1
        or runtime.get("onnxAllowSpinning") is not False
    ):
        raise BenchmarkError("direct child runtime does not match its configuration")
    if (
        workload.get("rounds") != 1
        or workload.get("warmupRequestsPerLevelPerRound")
        != args.warmup_requests
        or workload.get("measuredRequestsPerLevelPerRound")
        != args.measured_requests
        or workload.get("deadlineMs") != direct_runner.rounded(args.deadline_ms)
    ):
        raise BenchmarkError("direct child workload does not match the matrix")
    summary = summaries[0]
    if summary.get("concurrency") != configuration.request_concurrency:
        raise BenchmarkError(
            "direct child concurrency does not match its configuration"
        )
    common_runtime = {
        key: value
        for key, value in runtime.items()
        if key
        not in {
            "onnxIntraOpThreads",
            "onnxInterOpThreads",
            "onnxAllowSpinning",
        }
    }
    return (
        {
            "round": round_number,
            "orderIndex": order_index,
            "configurationId": configuration.configuration_id,
            "requestConcurrency": configuration.request_concurrency,
            "onnxIntraOpThreads": configuration.onnx_intra_op_threads,
            "onnxInterOpThreads": 1,
            "onnxAllowSpinning": False,
            "fixedThreadBudget": configuration.thread_budget,
            "strictEligible": bool(summary.get("eligible")),
            "requested": integer_field(summary, "requested"),
            "completed": integer_field(summary, "completed"),
            "successful": integer_field(summary, "successful"),
            "inferenceErrorCount": integer_field(
                summary,
                "inferenceErrorCount",
            ),
            "outputMismatchCount": integer_field(
                summary,
                "outputMismatchCount",
            ),
            "deadlineExceededCount": integer_field(
                summary,
                "deadlineExceededCount",
            ),
            "successfulRps": numeric_field(
                summary,
                "observedSuccessfulRps",
            ),
            "latencyMs": dict_field(summary, "latencyMs"),
            "adjustedResources": dict_field(
                summary,
                "adjustedResourceMedian",
            ),
        },
        common_runtime,
    )


def integer_field(value: Mapping[str, Any], name: str) -> int:
    candidate = value.get(name)
    if not isinstance(candidate, int) or isinstance(candidate, bool):
        raise BenchmarkError(f"direct child {name} must be an integer")
    return candidate


def numeric_field(value: Mapping[str, Any], name: str) -> float:
    candidate = value.get(name)
    if not isinstance(candidate, (int, float)) or isinstance(candidate, bool):
        raise BenchmarkError(f"direct child {name} must be numeric")
    return direct_runner.rounded(float(candidate))


def dict_field(value: Mapping[str, Any], name: str) -> dict[str, Any]:
    candidate = value.get(name)
    if not isinstance(candidate, dict):
        raise BenchmarkError(f"direct child {name} must be an object")
    return dict(candidate)


def summarize_configurations(
    round_results: Sequence[Mapping[str, Any]],
    *,
    configurations: Sequence[ThreadBudgetConfiguration],
    rounds: int,
    deadline_ms: float,
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for configuration in configurations:
        selected = [
            result
            for result in round_results
            if result["configurationId"] == configuration.configuration_id
        ]
        if len(selected) != rounds:
            raise BenchmarkError("every configuration must have every round")
        requested = sum(int(result["requested"]) for result in selected)
        completed = sum(int(result["completed"]) for result in selected)
        successful = sum(int(result["successful"]) for result in selected)
        inference_errors = sum(
            int(result["inferenceErrorCount"]) for result in selected
        )
        output_mismatches = sum(
            int(result["outputMismatchCount"]) for result in selected
        )
        deadline_exceeded = sum(
            int(result["deadlineExceededCount"]) for result in selected
        )
        rps_values = [float(result["successfulRps"]) for result in selected]
        p50_values = latency_values(selected, "p50")
        p95_values = latency_values(selected, "p95")
        p99_values = latency_values(selected, "p99")
        max_values = latency_values(selected, "max")
        all_complete = requested == completed == successful
        output_equivalent = inference_errors == 0 and output_mismatches == 0
        worst_round_p99 = max(p99_values)
        revalidation_eligible = (
            all_complete
            and output_equivalent
            and worst_round_p99 <= deadline_ms
        )
        adjusted_resources = summarize_adjusted_resources(selected)
        median_rps = median_number(rps_values)
        core_pct = adjusted_resources.get("cpuCoreEquivalentPct")
        rps_per_core = (
            direct_runner.rounded(median_rps / (float(core_pct) / 100.0))
            if isinstance(core_pct, (int, float)) and core_pct > 0
            else None
        )
        summaries.append(
            {
                "configurationId": configuration.configuration_id,
                "requestConcurrency": configuration.request_concurrency,
                "onnxIntraOpThreads": configuration.onnx_intra_op_threads,
                "onnxInterOpThreads": 1,
                "onnxAllowSpinning": False,
                "fixedThreadBudget": configuration.thread_budget,
                "roundCount": len(selected),
                "strictEligible": all(
                    bool(result["strictEligible"]) for result in selected
                ),
                "revalidationEligible": revalidation_eligible,
                "requested": requested,
                "completed": completed,
                "successful": successful,
                "inferenceErrorCount": inference_errors,
                "outputMismatchCount": output_mismatches,
                "deadlineExceededCount": deadline_exceeded,
                "deadlineExceededRatePct": percentage(
                    deadline_exceeded,
                    completed,
                ),
                "successfulRps": {
                    "roundMedian": median_rps,
                    "roundMin": direct_runner.rounded(min(rps_values)),
                    "roundMax": direct_runner.rounded(max(rps_values)),
                },
                "latencyMs": {
                    "population": "median_of_per_round_request_percentiles",
                    "roundP50Median": median_number(p50_values),
                    "roundP95Median": median_number(p95_values),
                    "roundP99Median": median_number(p99_values),
                    "worstRoundP99": direct_runner.rounded(worst_round_p99),
                    "worstRequest": direct_runner.rounded(max(max_values)),
                },
                "adjustedResourceRoundMedian": adjusted_resources,
                "successfulRpsPerCoreEquivalent": rps_per_core,
            }
        )
    return summaries


def summarize_adjusted_resources(
    results: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    resources = [
        result["adjustedResources"]
        for result in results
        if result["adjustedResources"].get("samplingStatus") == "collected"
    ]
    if not resources:
        return direct_runner.unavailable_resources("not_collected")

    def resource_median(name: str) -> float | None:
        values = [
            float(resource[name])
            for resource in resources
            if isinstance(resource.get(name), (int, float))
        ]
        return median_number(values) if values else None

    context_switches: dict[str, int | float | None] = {}
    for name in ("voluntary", "involuntary", "total", "perCompletedRequest"):
        values = [
            float(resource["contextSwitches"][name])
            for resource in resources
            if isinstance(
                resource.get("contextSwitches", {}).get(name),
                (int, float),
            )
        ]
        context_switches[name] = median_number(values) if values else None
    peak_threads = resource_median("peakThreadCount")
    return {
        "samplingStatus": "collected",
        "peakRssMiB": resource_median("peakRssMiB"),
        "peakThreadCount": int(peak_threads) if peak_threads is not None else None,
        "processCpuSeconds": resource_median("processCpuSeconds"),
        "cpuCoreEquivalentPct": resource_median("cpuCoreEquivalentPct"),
        "cpuAvailableUtilizationPct": resource_median(
            "cpuAvailableUtilizationPct"
        ),
        "contextSwitches": context_switches,
    }


def add_baseline_comparisons(
    summaries: list[dict[str, Any]],
    *,
    cpu_budget: int,
) -> None:
    baseline_id = ThreadBudgetConfiguration(1, cpu_budget).configuration_id
    baseline = next(
        summary
        for summary in summaries
        if summary["configurationId"] == baseline_id
    )
    for summary in summaries:
        summary["baselineComparison"] = {
            "baselineConfigurationId": baseline_id,
            "roundMedianSuccessfulRpsChangePct": percentage_change(
                summary["successfulRps"]["roundMedian"],
                baseline["successfulRps"]["roundMedian"],
            ),
            "roundP99MedianChangePct": percentage_change(
                summary["latencyMs"]["roundP99Median"],
                baseline["latencyMs"]["roundP99Median"],
            ),
            "successfulRpsPerCoreEquivalentChangePct": percentage_change(
                summary["successfulRpsPerCoreEquivalent"],
                baseline["successfulRpsPerCoreEquivalent"],
            ),
        }


def build_selection_summary(
    summaries: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    strict = [summary for summary in summaries if summary["strictEligible"]]
    candidates = [
        summary for summary in summaries if summary["revalidationEligible"]
    ]
    strict_selected = max(
        strict,
        key=lambda value: float(value["successfulRps"]["roundMedian"]),
        default=None,
    )
    candidate = max(
        candidates,
        key=lambda value: float(value["successfulRps"]["roundMedian"]),
        default=None,
    )
    return {
        "strictEligibilityRule": (
            "all_rounds_have_zero_inference_errors_output_mismatches_"
            "and_deadline_excesses"
        ),
        "revalidationEligibilityRule": (
            "all_rounds_complete_with_output_equivalence_and_"
            "worst_round_p99_at_or_below_deadline"
        ),
        "strictEligibleConfigurationIds": [
            summary["configurationId"] for summary in strict
        ],
        "highestStrictThroughputConfigurationId": (
            strict_selected["configurationId"]
            if strict_selected is not None
            else None
        ),
        "revalidationEligibleConfigurationIds": [
            summary["configurationId"] for summary in candidates
        ],
        "revalidationCandidateConfigurationId": (
            candidate["configurationId"] if candidate is not None else None
        ),
        "productionDefaultChanged": False,
        "promotionBoundary": (
            "candidate_only_until_repeated_on_target_4_vcpu_linux_"
            "uvicorn_network_and_gateway_e2e"
        ),
    }


def latency_values(
    results: Sequence[Mapping[str, Any]],
    name: str,
) -> list[float]:
    values: list[float] = []
    for result in results:
        latency = result.get("latencyMs")
        if not isinstance(latency, dict):
            raise BenchmarkError("round latency must be an object")
        candidate = latency.get(name)
        if not isinstance(candidate, (int, float)) or isinstance(candidate, bool):
            raise BenchmarkError(f"round latency {name} must be numeric")
        values.append(float(candidate))
    return values


def median_number(values: Sequence[float]) -> float:
    if not values:
        raise BenchmarkError("median requires at least one value")
    ordered = sorted(float(value) for value in values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return direct_runner.rounded(ordered[middle])
    return direct_runner.rounded(
        (ordered[middle - 1] + ordered[middle]) / 2.0
    )


def percentage(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return direct_runner.rounded(numerator / denominator * 100.0)


def percentage_change(
    value: int | float | None,
    baseline: int | float | None,
) -> float | None:
    if (
        not isinstance(value, (int, float))
        or not isinstance(baseline, (int, float))
        or baseline == 0
    ):
        return None
    return direct_runner.rounded((float(value) / float(baseline) - 1.0) * 100.0)


def build_report(
    *,
    args: argparse.Namespace,
    git_sha: str,
    generated_at: datetime | None,
    model_binding: Mapping[str, Any],
    configurations: Sequence[ThreadBudgetConfiguration],
    round_orders: list[dict[str, Any]],
    round_results: list[dict[str, Any]],
    configuration_summary: list[dict[str, Any]],
    selection: dict[str, Any],
    runtime: dict[str, Any],
) -> dict[str, Any]:
    timestamp = generated_at or datetime.now(tz=timezone.utc)
    return {
        "reportVersion": REPORT_VERSION,
        "generatedAt": timestamp.isoformat().replace("+00:00", "Z"),
        "gitSha": git_sha,
        "trackedWorktreeDirty": direct_runner.tracked_worktree_dirty(),
        "evidenceOnly": True,
        "provenance": {
            "matrixRunnerSha256": direct_runner.sha256_file(Path(__file__)),
            "directRunnerSha256": direct_runner.sha256_file(
                Path(direct_runner.__file__)
            ),
            "corpusSha256": direct_runner.sha256_file(args.corpus),
        },
        "model": dict(model_binding),
        "experiment": {
            "goal": (
                "compare_request_concurrency_and_onnx_intra_op_threads_"
                "under_one_fixed_cpu_budget"
            ),
            "cpuBudget": args.cpu_budget,
            "processAffinityCpuCount": args.cpu_budget,
            "configurationIds": [
                configuration.configuration_id
                for configuration in configurations
            ],
            "threadBudgetRule": (
                "request_concurrency_times_onnx_intra_op_threads_"
                "equals_cpu_budget"
            ),
            "rounds": args.rounds,
            "warmupRequestsPerConfigurationPerRound": args.warmup_requests,
            "measuredRequestsPerConfigurationPerRound": args.measured_requests,
            "measuredRequestsPerConfigurationTotal": (
                args.rounds * args.measured_requests
            ),
            "deadlineMs": direct_runner.rounded(args.deadline_ms),
            "roundStatisticSemantics": (
                "median_across_independent_fresh_process_rounds"
            ),
            "valueMode": "rendered_synthetic_values_in_memory_not_persisted",
        },
        "runtime": runtime,
        "roundExecutionOrder": round_orders,
        "roundResults": round_results,
        "configurationSummary": configuration_summary,
        "selectionSummary": selection,
    }


if __name__ == "__main__":
    raise SystemExit(run())
