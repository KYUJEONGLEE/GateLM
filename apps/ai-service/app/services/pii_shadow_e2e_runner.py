from __future__ import annotations

import argparse
import asyncio
import dataclasses
import importlib.metadata
import json
import os
import platform
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
from app.services.pii_shadow import (
    EncryptedPiiShadowBuffer,
    PII_SHADOW_ENVELOPE_VERSION,
    PiiShadowEvaluator,
    PiiShadowWorker,
)


REPORT_VERSION = "gatelm.pii-shadow-e2e.v2"
INPUT_SCHEMA_VERSION = "gatelm.pii-shadow-e2e-input.v1"
CLIENT_SCHEMA_VERSION = "gatelm.pii-shadow-e2e-client.v2"
DEFAULT_MODEL_VERSION = "v0.1.1"
DEFAULT_REQUEST_COUNT = 1_000
DEFAULT_SAMPLE_BASIS_POINTS = 500
DEFAULT_TEST_TENANT_ID = "00000000-0000-4000-8000-000000000100"
SHADOW_MAXIMUM_ITEMS = 5_000
SHADOW_MAXIMUM_BYTES = 10 * 1024 * 1024
SHADOW_TTL_SECONDS = 12 * 60 * 60
KST = timezone(timedelta(hours=9), name="Asia/Seoul")
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
    parser.add_argument(
        "--tenant-id",
        default=os.getenv("PII_SHADOW_TEST_TENANT_ID", DEFAULT_TEST_TENANT_ID),
    )
    parser.add_argument("--gateway-client-binary", type=Path, default=None)
    parser.add_argument(
        "--execution-context",
        choices=("local", "aws_test_tenant_host"),
        default="local",
    )
    parser.add_argument(
        "--respect-night-window",
        action="store_true",
        help="Require and enforce the configured 02:00-05:00 KST Shadow window.",
    )
    parser.add_argument(
        "--verified-clean-source",
        action="store_true",
        help="Record the caller's immutable clean-source verification.",
    )
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
        if args.respect_night_window and not _inside_night_window(
            datetime.now(tz=KST)
        ):
            raise BenchmarkError("PII Shadow E2E is outside the 02:00-05:00 KST window")
        ignore_window = not args.respect_night_window
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
        tenant_id = str(uuid.UUID(args.tenant_id))
        control_tenant_id = _control_tenant_id(tenant_id)

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
                    pii_shadow_max_items=SHADOW_MAXIMUM_ITEMS,
                    pii_shadow_max_bytes=SHADOW_MAXIMUM_BYTES,
                    pii_shadow_ttl_seconds=SHADOW_TTL_SECONDS,
                    pii_shadow_timezone="Asia/Seoul",
                    pii_shadow_window_start_hour=2,
                    pii_shadow_window_end_hour=5,
                )
            )
            evaluator = _state_evaluator(app)
            worker = _state_worker(app)
            with _running_loopback_server(app) as endpoint:
                client_result = _run_gateway_client(
                    endpoint=endpoint,
                    prompts=prompts,
                    sample_basis_points=args.sample_basis_points,
                    tenant_id=tenant_id,
                    control_tenant_id=control_tenant_id,
                    gateway_client_binary=args.gateway_client_binary,
                )
            encrypted_before_candidate = _captured_payloads_are_encrypted(
                evaluator,
                prompts,
            )
            live_pause_verified = asyncio.run(
                _verify_live_pause(
                    worker=worker,
                    live_gate=app.state.ai_safety_concurrency_gate,
                    evaluator=evaluator,
                    ignore_window=ignore_window,
                )
            )
            processed = asyncio.run(
                worker.process_available(
                    maximum_items=args.requests,
                    ignore_window=ignore_window,
                )
            )
            shadow_snapshot = evaluator.safe_snapshot()
            fault_validation = _run_fault_counter_validation()

        report = build_report(
            generated_at=generated_at or datetime.now(tz=timezone.utc),
            git_sha=git_sha,
            worktree_dirty=(
                False if args.verified_clean_source else tracked_worktree_dirty()
            ),
            model_binding=model_binding,
            corpus_sha256=sha256_file(args.corpus),
            corpus_case_count=len(cases),
            request_count=args.requests,
            sample_basis_points=args.sample_basis_points,
            client_result=client_result,
            processed=processed,
            shadow_snapshot=shadow_snapshot,
            encrypted_before_candidate=encrypted_before_candidate,
            live_pause_verified=live_pause_verified,
            fault_validation=fault_validation,
            execution_context=args.execution_context,
            night_window_bypassed=ignore_window,
        )
        _assert_sensitive_values_absent(
            report,
            tenant_id=tenant_id,
            control_tenant_id=control_tenant_id,
            prompts=prompts,
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
    try:
        normalized_tenant_id = str(uuid.UUID(args.tenant_id))
    except (AttributeError, TypeError, ValueError) as error:
        raise BenchmarkError("tenant-id must be a canonical UUID") from error
    if normalized_tenant_id != args.tenant_id.lower():
        raise BenchmarkError("tenant-id must be a canonical UUID")
    if args.gateway_client_binary is not None:
        binary = args.gateway_client_binary.resolve()
        if not binary.is_file():
            raise BenchmarkError("gateway-client-binary must be a regular file")
    if args.execution_context == "aws_test_tenant_host" and not args.respect_night_window:
        raise BenchmarkError("AWS test-tenant execution must respect the night window")
    if args.execution_context == "aws_test_tenant_host" and not args.verified_clean_source:
        raise BenchmarkError("AWS test-tenant execution requires clean-source verification")


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
    encrypted_before_candidate: bool = True,
    live_pause_verified: bool = True,
    fault_validation: Mapping[str, Any] | None = None,
    execution_context: str = "local",
    night_window_bypassed: bool = True,
) -> dict[str, Any]:
    comparison = dict(shadow_snapshot["comparison"])
    buffer_snapshot = dict(shadow_snapshot["buffer"])
    sampled = int(client_result["sampledRequestCount"])
    configured_percent = sample_basis_points / 100
    actual_percent = round(sampled * 100 / request_count, 3)
    fault_snapshot = dict(fault_validation or _passing_fault_validation())
    checks = {
        "allGatewayRequestsSucceeded": (
            client_result["successCount"] == request_count
            and client_result["errorCount"] == 0
        ),
        "sampledRequestsCaptured": buffer_snapshot["capturedItems"] == sampled,
        "testTenantExactAllowlist": (
            client_result["controlRequestCount"] == 1
            and client_result["controlSampledRequestCount"] == 0
            and client_result["controlSuccessCount"] == 1
            and client_result["controlErrorCount"] == 0
        ),
        "deterministicSamplingReplayMatches": (
            client_result["deterministicReplaySampledRequestCount"] == sampled
        ),
        "sampleRateIsApproximatelyConfigured": (
            abs(actual_percent - configured_percent) <= 2.0
        ),
        "captureEncryptedBeforeCandidateInference": encrypted_before_candidate,
        "liveRequestPausesNextCandidateInference": live_pause_verified,
        "liveRequestLatencyAggregated": (
            _latency_count(client_result["requestLatencyMs"]) == request_count
            and _latency_count(client_result["sampledRequestLatencyMs"])
            == sampled
            and _latency_count(client_result["nonSampledRequestLatencyMs"])
            == request_count - sampled
        ),
        "faultCountersValidated": all(
            bool(value) for value in fault_snapshot["checks"].values()
        ),
        "awsExecutionRespectsNightWindow": (
            execution_context != "aws_test_tenant_host" or not night_window_bypassed
        ),
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
            "nightWindowBypassedForExplicitE2E": night_window_bypassed,
            "executionContext": execution_context,
        },
        "dataSafety": {
            "syntheticCorpusOnly": True,
            "rawInputPersisted": False,
            "individualResultsPersisted": False,
            "detectedValuesPersisted": False,
            "aggregateOnly": True,
            "bufferProfile": {
                "storage": "process_memory_only",
                "encryption": "AES-256-GCM",
                "maximumItems": SHADOW_MAXIMUM_ITEMS,
                "maximumCiphertextAndNonceBytes": SHADOW_MAXIMUM_BYTES,
                "ttlSeconds": SHADOW_TTL_SECONDS,
                "samplesRecoveredAfterRestart": False,
                "encryptionKeyRecoveredAfterRestart": False,
            },
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
            "configuredSamplePercent": configured_percent,
            "sampledRequestCount": sampled,
            "actualSamplePercent": actual_percent,
        },
        "gatewayClient": dict(client_result),
        "shadow": {
            "candidate": dict(shadow_snapshot["candidate"]),
            "buffer": buffer_snapshot,
            "comparison": comparison,
            "latencyMs": dict(shadow_snapshot["latencyMs"]),
            "faultValidation": fault_snapshot,
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
    tenant_id: str,
    control_tenant_id: str,
    gateway_client_binary: Path | None,
) -> dict[str, Any]:
    payload = json.dumps(
        {
            "schemaVersion": INPUT_SCHEMA_VERSION,
            "items": [{"prompt": prompt} for prompt in prompts],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    command = (
        [str(gateway_client_binary)]
        if gateway_client_binary is not None
        else [
            "go",
            "run",
            "./cmd/pii-shadow-e2e-client",
        ]
    )
    completed = subprocess.run(
        [
            *command,
            "--endpoint",
            endpoint,
            "--tenant-id",
            tenant_id,
            "--control-tenant-id",
            control_tenant_id,
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
        "deterministicReplaySampledRequestCount",
        "successCount",
        "errorCount",
        "controlRequestCount",
        "controlSampledRequestCount",
        "controlSuccessCount",
        "controlErrorCount",
        "requestLatencyMs",
        "sampledRequestLatencyMs",
        "nonSampledRequestLatencyMs",
    }
    if not isinstance(decoded, dict) or set(decoded) != expected_fields:
        raise BenchmarkError("Gateway PII Shadow E2E client output is invalid")
    if decoded["schemaVersion"] != CLIENT_SCHEMA_VERSION:
        raise BenchmarkError("Gateway PII Shadow E2E client schema is invalid")
    return decoded


def _control_tenant_id(tenant_id: str) -> str:
    parsed = uuid.UUID(tenant_id)
    return str(uuid.UUID(int=parsed.int ^ 1))


def _latency_count(value: object) -> int:
    if not isinstance(value, Mapping):
        return -1
    count = value.get("count")
    return count if isinstance(count, int) and not isinstance(count, bool) else -1


def _captured_payloads_are_encrypted(
    evaluator: PiiShadowEvaluator,
    prompts: Sequence[str],
) -> bool:
    buffer = evaluator._buffer
    markers = tuple({prompt.encode("utf-8") for prompt in prompts if prompt})
    with buffer._lock:
        encrypted_payloads = tuple(
            item.nonce + item.ciphertext for item in buffer._items
        )
    return bool(encrypted_payloads) and all(
        marker not in payload
        for marker in markers
        for payload in encrypted_payloads
    )


async def _verify_live_pause(
    *,
    worker: PiiShadowWorker,
    live_gate: Any,
    evaluator: PiiShadowEvaluator,
    ignore_window: bool,
) -> bool:
    if not evaluator.has_pending() or not await live_gate.try_acquire():
        return False
    before = evaluator.safe_snapshot()["comparison"]["pausedForLiveRequests"]
    try:
        processed = await worker.process_available(
            maximum_items=1,
            ignore_window=ignore_window,
        )
    finally:
        await live_gate.release()
    after = evaluator.safe_snapshot()["comparison"]["pausedForLiveRequests"]
    return processed == 0 and evaluator.has_pending() and after == before + 1


def _inside_night_window(now: datetime) -> bool:
    local = now.astimezone(KST)
    return 2 <= local.hour < 5


def _run_fault_counter_validation() -> dict[str, Any]:
    now = [0.0]
    ttl_buffer = EncryptedPiiShadowBuffer(
        maximum_items=2,
        maximum_bytes=4_096,
        ttl_seconds=1,
        clock=lambda: now[0],
    )
    ttl_buffer.capture({"syntheticCase": "ttl"})
    now[0] = 2.0
    ttl_buffer.has_pending()
    ttl_snapshot = ttl_buffer.safe_snapshot()

    bounded_buffer = EncryptedPiiShadowBuffer(
        maximum_items=1,
        maximum_bytes=256,
        ttl_seconds=60,
    )
    bounded_buffer.capture({"syntheticCase": "first"})
    bounded_buffer.capture({"syntheticCase": "second"})
    bounded_buffer.capture({"syntheticCase": "x" * 1_024})
    bounded_snapshot = bounded_buffer.safe_snapshot()

    decrypt_buffer = EncryptedPiiShadowBuffer(
        maximum_items=1,
        maximum_bytes=4_096,
        ttl_seconds=60,
    )
    decrypt_buffer.capture({"syntheticCase": "decrypt"})
    with decrypt_buffer._lock:
        item = decrypt_buffer._items[0]
        corrupted = bytes([item.ciphertext[0] ^ 1]) + item.ciphertext[1:]
        decrypt_buffer._items[0] = dataclasses.replace(
            item,
            ciphertext=corrupted,
        )
    decrypt_buffer.pop()
    decrypt_snapshot = decrypt_buffer.safe_snapshot()

    inference_buffer = EncryptedPiiShadowBuffer(
        maximum_items=1,
        maximum_bytes=4_096,
        ttl_seconds=60,
    )
    inference_buffer.capture(
        {
            "schemaVersion": PII_SHADOW_ENVELOPE_VERSION,
            "kind": "single",
        }
    )

    def fail_candidate() -> Any:
        raise RuntimeError("synthetic candidate failure")

    inference_evaluator = PiiShadowEvaluator(
        buffer=inference_buffer,
        candidate_service_factory=fail_candidate,
        candidate_model_id="gatelm/koelectra-small-v3-pii-ner",
        candidate_model_version=DEFAULT_MODEL_VERSION,
    )
    inference_evaluator.process_next()
    inference_snapshot = inference_evaluator.safe_snapshot()["comparison"]

    restart_buffer = EncryptedPiiShadowBuffer(
        maximum_items=1,
        maximum_bytes=4_096,
        ttl_seconds=60,
    )
    restart_buffer.capture({"syntheticCase": "restart"})
    with restart_buffer._lock:
        pre_restart_item = restart_buffer._items[0]
    replacement_buffer = EncryptedPiiShadowBuffer(
        maximum_items=1,
        maximum_bytes=4_096,
        ttl_seconds=60,
    )
    with replacement_buffer._lock:
        replacement_buffer._items.append(pre_restart_item)
        replacement_buffer._stored_bytes = pre_restart_item.stored_bytes
    replacement_buffer.pop()
    replacement_snapshot = replacement_buffer.safe_snapshot()
    restart_buffer.clear()

    counters = {
        "expiredItems": int(ttl_snapshot["expiredItems"]),
        "evictedItems": int(bounded_snapshot["evictedItems"]),
        "oversizedItems": int(bounded_snapshot["oversizedItems"]),
        "decryptErrors": int(decrypt_snapshot["decryptErrors"]),
        "inferenceErrors": int(inference_snapshot["inferenceErrors"]),
        "restartDecryptErrors": int(replacement_snapshot["decryptErrors"]),
    }
    return {
        "counters": counters,
        "checks": {
            "ttlExpiryCounted": counters["expiredItems"] == 1,
            "capacityEvictionCounted": counters["evictedItems"] == 1,
            "oversizedCaptureCounted": counters["oversizedItems"] == 1,
            "decryptFailureCounted": counters["decryptErrors"] == 1,
            "candidateInferenceFailureCounted": counters["inferenceErrors"] == 1,
            "restartDropsPendingSamples": not restart_buffer.has_pending(),
            "restartKeyDoesNotRecoverSamples": (
                counters["restartDecryptErrors"] == 1
            ),
        },
    }


def _passing_fault_validation() -> dict[str, Any]:
    return {
        "counters": {
            "expiredItems": 1,
            "evictedItems": 1,
            "oversizedItems": 1,
            "decryptErrors": 1,
            "inferenceErrors": 1,
            "restartDecryptErrors": 1,
        },
        "checks": {
            "ttlExpiryCounted": True,
            "capacityEvictionCounted": True,
            "oversizedCaptureCounted": True,
            "decryptFailureCounted": True,
            "candidateInferenceFailureCounted": True,
            "restartDropsPendingSamples": True,
            "restartKeyDoesNotRecoverSamples": True,
        },
    }


def _assert_sensitive_values_absent(
    report: Mapping[str, Any],
    *,
    tenant_id: str,
    control_tenant_id: str,
    prompts: Sequence[str],
) -> None:
    rendered = json.dumps(report, ensure_ascii=False, sort_keys=True)
    forbidden_values = {tenant_id, control_tenant_id, *prompts}
    if any(value and value in rendered for value in forbidden_values):
        raise BenchmarkError("PII Shadow report contains a forbidden source value")


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
