from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
import platform
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI

from app.core.config import AI_SAFETY_DETECTOR_RUNTIME_ONNX, Settings
from app.domain.ai_safety_benchmark.corpus import (
    load_benchmark_corpus,
    render_case_prompt,
)
from app.domain.ai_safety_benchmark.report import (
    scan_text_for_forbidden_report_values,
)
from app.domain.ai_safety_benchmark.types import BenchmarkError
from app.main import create_app
from app.services.pii_direct_inference_concurrency_benchmark_runner import (
    CANONICAL_MODEL_REGISTRY_PATH,
    DEFAULT_CORPUS_PATH,
    FULL_GIT_SHA_PATTERN,
    bind_model_artifact,
    current_git_sha,
    sha256_file,
    tracked_worktree_dirty,
)
from app.services.pii_shadow import PiiShadowEvaluator, PiiShadowWorker


REPORT_VERSION = "gatelm.pii-shadow-e2e.v1"
INPUT_SCHEMA_VERSION = "gatelm.pii-shadow-e2e-input.v1"
CLIENT_SCHEMA_VERSION = "gatelm.pii-shadow-e2e-client.v1"
DEFAULT_MODEL_VERSION = "v0.1.1"
DEFAULT_REQUEST_COUNT = 1_000
DEFAULT_SAMPLE_BASIS_POINTS = 500
DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parents[4]
    / ".tmp"
    / "pii-shadow-e2e"
    / "pii-shadow-e2e-latest.json"
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
GATEWAY_ROOT = REPOSITORY_ROOT / "apps" / "gateway-core"
PRODUCTION_DETECTOR_TYPES = (
    "email",
    "organization_name",
    "person_name",
    "phone_number",
    "postal_address",
    "resident_registration_number",
)
PRODUCTION_THRESHOLDS = (
    ("email", 0.99),
    ("organization_name", 0.90),
    ("person_name", 0.90),
    ("phone_number", 0.99),
    ("postal_address", 0.90),
    ("resident_registration_number", 0.99),
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run the real Gateway sampler and HTTP adapter against the real "
            "AI Service baseline and identical offline PII Shadow model."
        )
    )
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument(
        "--requests",
        type=int,
        default=DEFAULT_REQUEST_COUNT,
    )
    parser.add_argument(
        "--sample-basis-points",
        type=int,
        default=DEFAULT_SAMPLE_BASIS_POINTS,
    )
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS_PATH)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--git-sha", default=None)
    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    generated_at: datetime | None = None,
    registry_path: Path = CANONICAL_MODEL_REGISTRY_PATH,
) -> int:
    args = build_parser().parse_args(argv)
    evaluator: PiiShadowEvaluator | None = None
    try:
        validate_args(args)
        git_sha = args.git_sha or current_git_sha()
        if not FULL_GIT_SHA_PATTERN.fullmatch(git_sha):
            raise BenchmarkError("an immutable Git SHA is required")
        model_dir = args.model_dir.resolve()
        model_binding = bind_model_artifact(
            model_dir=model_dir,
            model_version=args.model_version,
            registry_path=registry_path,
        )
        cases = load_benchmark_corpus(args.corpus)
        prompts = [
            render_case_prompt(cases[index % len(cases)])
            for index in range(args.requests)
        ]

        with _temporary_environment(
            {
                "AI_SERVICE_ONNX_INTRA_OP_THREADS": "2",
                "AI_SERVICE_ONNX_INTER_OP_THREADS": "1",
                "AI_SERVICE_ONNX_ALLOW_SPINNING": "false",
            }
        ):
            app = create_app(
                Settings(
                    ai_safety_detector_model_id=str(model_dir),
                    ai_safety_ml_allowed_detector_types=PRODUCTION_DETECTOR_TYPES,
                    ai_safety_ml_detector_thresholds=PRODUCTION_THRESHOLDS,
                    ai_safety_person_name_model_only=True,
                    ai_safety_detector_runtime=AI_SAFETY_DETECTOR_RUNTIME_ONNX,
                    ai_safety_preload_enabled=True,
                    ai_safety_max_concurrent=2,
                    ai_safety_max_pending=4,
                    ai_safety_wait_timeout_ms=50,
                    pii_shadow_enabled=True,
                    pii_shadow_candidate_model_id=str(model_dir),
                    pii_shadow_candidate_version=args.model_version,
                )
            )
            evaluator = _state_evaluator(app)
            worker = _state_worker(app)
            with _running_loopback_server(app) as endpoint:
                client_result = _run_gateway_client(
                    endpoint=endpoint,
                    prompts=prompts,
                    sample_basis_points=args.sample_basis_points,
                )
            processed = asyncio.run(
                worker.process_available(
                    maximum_items=args.requests,
                    ignore_window=True,
                )
            )
            shadow_snapshot = evaluator.safe_snapshot()

        report = build_report(
            generated_at=generated_at or datetime.now(tz=timezone.utc),
            git_sha=git_sha,
            worktree_dirty=tracked_worktree_dirty(),
            model_binding=model_binding,
            corpus_sha256=sha256_file(args.corpus),
            corpus_case_count=len(cases),
            request_count=args.requests,
            sample_basis_points=args.sample_basis_points,
            client_result=client_result,
            processed=processed,
            shadow_snapshot=shadow_snapshot,
        )
        write_safe_report(report, args.out)
    except (
        BenchmarkError,
        OSError,
        RuntimeError,
        ValueError,
        json.JSONDecodeError,
        subprocess.SubprocessError,
    ):
        print(
            "FAIL: PII Shadow E2E could not produce safe aggregate evidence.",
            file=sys.stderr,
        )
        return 2
    finally:
        if evaluator is not None:
            evaluator.close()

    comparison = report["shadow"]["comparison"]
    print(
        "PII Shadow E2E completed: "
        f"requests={args.requests}, "
        f"sampled={client_result['sampledRequestCount']}, "
        f"compared={comparison['comparedItems']}, "
        f"agreement={comparison['agreementPercent']}, "
        f"eligible={str(report['eligibility']['eligible']).lower()}"
    )
    return 0 if report["eligibility"]["eligible"] else 1


def validate_args(args: argparse.Namespace) -> None:
    if not 100 <= args.requests <= 5_000:
        raise BenchmarkError("requests must be between 100 and 5000")
    if not 1 <= args.sample_basis_points <= 10_000:
        raise BenchmarkError("sample-basis-points must be between 1 and 10000")
    if args.git_sha is not None and not FULL_GIT_SHA_PATTERN.fullmatch(
        args.git_sha
    ):
        raise BenchmarkError("git-sha must be an immutable full Git object id")


def build_report(
    *,
    generated_at: datetime,
    git_sha: str,
    worktree_dirty: bool | None,
    model_binding: Mapping[str, Any],
    corpus_sha256: str,
    corpus_case_count: int,
    request_count: int,
    sample_basis_points: int,
    client_result: Mapping[str, Any],
    processed: int,
    shadow_snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    comparison = dict(shadow_snapshot["comparison"])
    buffer_snapshot = dict(shadow_snapshot["buffer"])
    sampled = int(client_result["sampledRequestCount"])
    checks = {
        "allGatewayRequestsSucceeded": (
            client_result["successCount"] == request_count
            and client_result["errorCount"] == 0
        ),
        "sampledRequestsCaptured": buffer_snapshot["capturedItems"] == sampled,
        "capturedRequestsProcessed": (
            processed == sampled
            and buffer_snapshot["pendingItems"] == 0
            and comparison["comparedItems"] == sampled
        ),
        "identicalModelAgreementIsExact": (
            sampled > 0
            and comparison["matchedItems"] == sampled
            and comparison["mismatchedItems"] == 0
            and comparison["agreementPercent"] == 100.0
        ),
        "realModelInferenceCompared": (
            comparison["modelActiveComparedItems"] > 0
            and comparison["baselineModelInvocations"] > 0
            and comparison["candidateModelInvocations"] > 0
            and comparison["baselineModelInvocations"]
            == comparison["candidateModelInvocations"]
        ),
        "shadowPathHasNoErrors": (
            comparison["captureErrors"] == 0
            and comparison["inferenceErrors"] == 0
            and buffer_snapshot["decryptErrors"] == 0
            and buffer_snapshot["expiredItems"] == 0
            and buffer_snapshot["evictedItems"] == 0
            and buffer_snapshot["oversizedItems"] == 0
        ),
    }
    report = {
        "reportVersion": REPORT_VERSION,
        "generatedAt": generated_at.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "gitSha": git_sha,
        "trackedWorktreeDirty": worktree_dirty,
        "syntheticOnly": True,
        "scope": {
            "gatewaySamplerAndHttpAdapter": "real",
            "transport": "loopback_tcp",
            "aiServiceHttpRoute": "real",
            "baselineOnnxModel": "real",
            "encryptedProcessLocalBuffer": "real",
            "candidateOnnxModel": "real_identical_artifact",
            "productionTraffic": False,
            "productionDeployment": False,
            "nightWindowBypassedForExplicitE2E": True,
        },
        "dataSafety": {
            "syntheticCorpusOnly": True,
            "rawInputPersisted": False,
            "individualResultsPersisted": False,
            "detectedValuesPersisted": False,
            "aggregateOnly": True,
        },
        "model": dict(model_binding),
        "runtime": {
            "logicalCpuCount": os.cpu_count(),
            "operatingSystem": platform.system(),
            "pythonVersion": platform.python_version(),
            "onnxruntimeVersion": _package_version("onnxruntime"),
            "liveProfile": {
                "maximumConcurrentInference": 2,
                "onnxIntraOpThreads": 2,
                "onnxInterOpThreads": 1,
                "allowSpinning": False,
            },
            "candidateProfile": {
                "maximumConcurrentInference": 1,
                "onnxIntraOpThreads": 1,
                "onnxInterOpThreads": 1,
                "allowSpinning": False,
            },
        },
        "workload": {
            "sourceCaseCount": corpus_case_count,
            "requestCount": request_count,
            "corpusSha256": corpus_sha256,
            "sampleBasisPoints": sample_basis_points,
            "configuredSamplePercent": sample_basis_points / 100,
            "sampledRequestCount": sampled,
            "actualSamplePercent": round(sampled * 100 / request_count, 3),
        },
        "gatewayClient": dict(client_result),
        "shadow": {
            "candidate": dict(shadow_snapshot["candidate"]),
            "buffer": buffer_snapshot,
            "comparison": comparison,
            "latencyMs": dict(shadow_snapshot["latencyMs"]),
        },
        "eligibility": {
            "purpose": "same_model_shadow_plumbing_validation_only",
            "checks": checks,
            "eligible": all(checks.values()),
            "doesNotApprove": [
                "candidate_model_promotion",
                "production_global_enablement",
                "production_sla_claim",
            ],
        },
    }
    return report


def write_safe_report(report: Mapping[str, Any], path: Path) -> None:
    rendered = json.dumps(
        report,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    scan_text_for_forbidden_report_values(rendered, "PII Shadow E2E report")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((rendered + "\n").encode("utf-8"))


def _run_gateway_client(
    *,
    endpoint: str,
    prompts: Sequence[str],
    sample_basis_points: int,
) -> dict[str, Any]:
    payload = json.dumps(
        {
            "schemaVersion": INPUT_SCHEMA_VERSION,
            "items": [{"prompt": prompt} for prompt in prompts],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    completed = subprocess.run(
        [
            "go",
            "run",
            "./cmd/pii-shadow-e2e-client",
            "--endpoint",
            endpoint,
            "--tenant-id",
            "pii-shadow-e2e-tenant",
            "--sample-basis-points",
            str(sample_basis_points),
        ],
        cwd=GATEWAY_ROOT,
        input=payload,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=600,
        check=False,
    )
    if completed.returncode != 0:
        raise BenchmarkError("Gateway PII Shadow E2E client failed")
    decoded = json.loads(completed.stdout)
    expected_fields = {
        "schemaVersion",
        "requestCount",
        "sampledRequestCount",
        "successCount",
        "errorCount",
    }
    if not isinstance(decoded, dict) or set(decoded) != expected_fields:
        raise BenchmarkError("Gateway PII Shadow E2E client output is invalid")
    if decoded["schemaVersion"] != CLIENT_SCHEMA_VERSION:
        raise BenchmarkError("Gateway PII Shadow E2E client schema is invalid")
    return decoded


@contextmanager
def _running_loopback_server(app: FastAPI) -> Iterator[str]:
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("127.0.0.1", 0))
    server_socket.listen(128)
    port = int(server_socket.getsockname()[1])
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        access_log=False,
        lifespan="off",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(
        target=server.run,
        kwargs={"sockets": [server_socket]},
        name="pii-shadow-e2e-sidecar",
        daemon=True,
    )
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.02)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=5)
        server_socket.close()
        raise BenchmarkError("loopback AI Service did not start")
    try:
        yield f"http://127.0.0.1:{port}/internal/ai-safety/v1/detect"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        server_socket.close()
        if thread.is_alive():
            raise BenchmarkError("loopback AI Service did not stop")


@contextmanager
def _temporary_environment(values: Mapping[str, str]) -> Iterator[None]:
    previous = {name: os.environ.get(name) for name in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def _state_evaluator(app: FastAPI) -> PiiShadowEvaluator:
    evaluator = getattr(app.state, "pii_shadow_evaluator", None)
    if not isinstance(evaluator, PiiShadowEvaluator):
        raise BenchmarkError("PII Shadow evaluator is unavailable")
    return evaluator


def _state_worker(app: FastAPI) -> PiiShadowWorker:
    worker = getattr(app.state, "pii_shadow_worker", None)
    if not isinstance(worker, PiiShadowWorker):
        raise BenchmarkError("PII Shadow worker is unavailable")
    return worker


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


if __name__ == "__main__":
    raise SystemExit(run())
