from __future__ import annotations

import argparse
import os
import platform
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

from app.domain.ai_safety_benchmark.corpus import load_benchmark_corpus
from app.domain.ai_safety_benchmark.report import build_report, write_reports
from app.domain.ai_safety_benchmark.resources import ResourceSampler
from app.domain.ai_safety_benchmark.runner import run_benchmark
from app.domain.ai_safety_benchmark.targets import (
    BenchmarkTarget,
    HttpBenchmarkTarget,
    InProcessBenchmarkTarget,
)
from app.domain.ai_safety_benchmark.types import (
    DEFAULT_ENDPOINT_PATH,
    DEFAULT_MEASURED_REQUESTS,
    DEFAULT_RUNTIME_PROFILE,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_WARMUP_REQUESTS,
    MODEL_ID,
    RUNTIME_PROFILES,
    BenchmarkError,
)


REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CORPUS_PATH = (
    REPO_ROOT / "docs" / "ai-safety-lab" / "fixtures" / "resource-latency-benchmark-corpus.jsonl"
)
DEFAULT_OUT_DIR = REPO_ROOT / "reports" / "ai-safety-lab"
DEFAULT_ENDPOINT_URL = f"http://127.0.0.1:8000{DEFAULT_ENDPOINT_PATH}"
TargetFactory = Callable[[argparse.Namespace], BenchmarkTarget]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run AI Safety Lab resource/latency benchmark.")
    parser.add_argument(
        "--target",
        choices=["http", "in_process"],
        default="http",
        help="Benchmark target. Use http for the local sidecar endpoint or in_process for the service harness.",
    )
    parser.add_argument(
        "--endpoint-url",
        default=DEFAULT_ENDPOINT_URL,
        help="HTTP endpoint URL for POST /internal/ai-safety/v1/detect.",
    )
    parser.add_argument(
        "--runtime-profile",
        choices=RUNTIME_PROFILES,
        default=DEFAULT_RUNTIME_PROFILE,
        help="Runtime profile represented by this benchmark run.",
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS_PATH,
        help="Path to resource-latency-benchmark-corpus.jsonl.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help="Output directory for JSON and Markdown reports.",
    )
    parser.add_argument(
        "--warmup-requests",
        type=int,
        default=DEFAULT_WARMUP_REQUESTS,
        help="Warmup request count excluded from percentile calculation.",
    )
    parser.add_argument(
        "--measured-requests",
        type=int,
        default=DEFAULT_MEASURED_REQUESTS,
        help="Measured request count included in percentile calculation.",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=DEFAULT_TIMEOUT_MS,
        help="Sidecar gate timeout candidate in milliseconds.",
    )
    parser.add_argument(
        "--request-timeout-ms",
        type=int,
        default=None,
        help="Optional HTTP/in-process request timeout in milliseconds. Defaults to --timeout-ms.",
    )
    parser.add_argument(
        "--resource-pid",
        type=int,
        default=None,
        help="Optional sidecar process id for HTTP resource sampling.",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Optional run id. Defaults to a generated benchmark run id.",
    )
    parser.add_argument(
        "--model-revision",
        default=None,
        help="Optional model revision metadata.",
    )
    parser.add_argument(
        "--model-id",
        default=default_model_id(),
        help="Model id represented by this benchmark run.",
    )
    parser.add_argument(
        "--git-sha",
        default=None,
        help="Optional git sha override for reproducible tests.",
    )
    parser.add_argument(
        "--no-fail-on-gate",
        action="store_true",
        help="Return exit code 0 even when a benchmark gate fails.",
    )
    parser.add_argument(
        "--strict-security-scan",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Fail if generated reports include forbidden raw value fields or sensitive literals.",
    )
    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    target_factory: TargetFactory | None = None,
    generated_at: datetime | None = None,
) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        validate_args(args)
        cases = load_benchmark_corpus(args.corpus)
        target = target_factory(args) if target_factory is not None else build_target(args)
        resource_sampler = ResourceSampler.for_target(target=args.target, resource_pid=args.resource_pid)
        samples = run_benchmark(
            cases=cases,
            target=target,
            runtime_profile=args.runtime_profile,
            warmup_requests=args.warmup_requests,
            measured_requests=args.measured_requests,
            timeout_ms=args.timeout_ms,
            request_timeout_ms=args.request_timeout_ms,
            resource_sampler=resource_sampler,
        )
        report = build_report(
            samples=samples,
            runtime_profile=args.runtime_profile,
            target=args.target,
            warmup_requests=args.warmup_requests,
            measured_requests=args.measured_requests,
            timeout_ms=args.timeout_ms,
            request_timeout_ms=args.request_timeout_ms,
            resource_summary=resource_sampler.summary(),
            run_id=args.run_id or default_run_id(),
            git_sha=args.git_sha or git_sha(),
            model_revision=args.model_revision,
            model_id=args.model_id,
            generated_at=generated_at,
            hardware=platform.machine(),
            os_name=platform.platform(),
            python_version=platform.python_version(),
            torch_version=optional_package_version("torch"),
            transformers_version=optional_package_version("transformers"),
        )
        json_path, markdown_path = write_reports(
            report,
            args.out,
            strict_security_scan=args.strict_security_scan,
        )
    except (BenchmarkError, OSError, UnicodeError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 2

    selected_runtime = next(
        runtime
        for runtime in report["runtimeResults"]
        if runtime["runtimeProfile"] == args.runtime_profile
    )
    print(
        "ai safety latency benchmark completed: "
        f"runtime={args.runtime_profile}, "
        f"status={selected_runtime['status']}, "
        f"measured={selected_runtime['requests']}, "
        f"timeouts={selected_runtime['timeoutCount']}, "
        f"json={json_path}, markdown={markdown_path}"
    )
    if selected_runtime["status"] == "fail" and not args.no_fail_on_gate:
        return 1
    return 0


def validate_args(args: argparse.Namespace) -> None:
    if args.warmup_requests < 0:
        raise BenchmarkError("warmupRequests must be non-negative")
    if args.measured_requests <= 0:
        raise BenchmarkError("measuredRequests must be positive")
    if args.timeout_ms <= 0:
        raise BenchmarkError("timeoutMs must be positive")
    if args.request_timeout_ms is not None and args.request_timeout_ms <= 0:
        raise BenchmarkError("requestTimeoutMs must be positive")
    if args.target == "http" and not str(args.endpoint_url).startswith(("http://", "https://")):
        raise BenchmarkError("endpoint-url must be an http or https URL")


def build_target(args: argparse.Namespace) -> BenchmarkTarget:
    if args.target == "http":
        return HttpBenchmarkTarget(endpoint_url=args.endpoint_url, model_id=args.model_id)
    if args.target == "in_process":
        return InProcessBenchmarkTarget.create(model_id=args.model_id)
    raise BenchmarkError(f"unsupported target {args.target!r}")


def default_model_id() -> str:
    value = os.environ.get("AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID", "").strip()
    if value == "" or any(char.isspace() for char in value):
        return MODEL_ID
    return value


def default_run_id() -> str:
    return f"ai-safety-latency-{uuid.uuid4().hex[:12]}"


def git_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError:
        return "unknown"
    if result.returncode != 0:
        return "unknown"
    return result.stdout.strip() or "unknown"


def optional_package_version(package_name: str) -> str | None:
    try:
        from importlib.metadata import PackageNotFoundError, version

        return version(package_name)
    except PackageNotFoundError:
        return None
    except Exception:
        return None


def main() -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
