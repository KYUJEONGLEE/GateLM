from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import math
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Protocol

import httpx
from fastapi import FastAPI
from pydantic import ValidationError

from app.adapters.safety.privacy_filter_adapter import (
    GATELM_KOELECTRA_PII_NER_SOURCE,
    KOELECTRA_PRIVACY_NER_SOURCE,
)
from app.core.config import AI_SAFETY_DETECTOR_RUNTIME_ONNX, Settings
from app.domain.ai_safety_benchmark.corpus import (
    load_benchmark_corpus,
    render_case_prompt,
)
from app.domain.ai_safety_benchmark.report import (
    scan_text_for_forbidden_report_values,
)
from app.domain.ai_safety_benchmark.types import BenchmarkCase, BenchmarkError
from app.main import create_app
from app.schemas.safety import (
    AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    AiSafetyDetectRequest,
    AiSafetyDetectResponse,
)
from app.services.pii_direct_inference_concurrency_benchmark_runner import (
    CANONICAL_MODEL_REGISTRY_PATH,
    DEFAULT_CORPUS_PATH,
    FULL_GIT_SHA_PATTERN,
    bind_model_artifact,
    current_git_sha,
    load_canonical_model_registry,
    sha256_file,
    validate_registry_entry,
)


REPORT_VERSION = "gatelm.pii-http-admission-concurrency-benchmark.v1"
DEFAULT_OUTPUT_PATH = (
    Path(__file__).resolve().parents[4]
    / ".tmp"
    / "pii-concurrency-benchmark"
    / "pii-http-admission-concurrency-latest.json"
)
DEFAULT_MODEL_VERSION = "v0.1.1"
DEFAULT_CAPACITY = 1
DEFAULT_PARALLEL_REQUESTS = 8
DEFAULT_WAVES = 20
DEFAULT_WAVE_TIMEOUT_SECONDS = 120.0
DETECT_PATH = "/internal/ai-safety/v1/detect"
EXPECTED_BUSY_ERROR = {
    "contractVersion": AI_SAFETY_DETECTOR_CONTRACT_VERSION,
    "error": {
        "code": "sidecar_unavailable",
        "message": "AI safety detector sidecar is unavailable.",
        "retryable": True,
    },
}
KOELECTRA_SOURCES = frozenset(
    {
        KOELECTRA_PRIVACY_NER_SOURCE,
        GATELM_KOELECTRA_PII_NER_SOURCE,
    }
)
KOELECTRA_MODEL_CANDIDATE_PLACEHOLDER_TYPES = frozenset(
    {
        "email",
        "phone_number",
        "person_name",
        "postal_address",
    }
)
MODEL_CANDIDATE_SELECTION_RULE = (
    "case_has_koelectra_supported_placeholder_type_that_enters_ml_candidate_pipeline"
)
HYBRID_PREFLIGHT_SELECTION_RULE = (
    "in_memory_preflight_confirms_hybrid_execution_and_accepted_koelectra_source"
)


@dataclass(frozen=True)
class RenderedWorkload:
    prompt_text: str
    locale: str | None


class DetectorService(Protocol):
    def detect(
        self,
        request: AiSafetyDetectRequest,
    ) -> AiSafetyDetectResponse: ...


@dataclass(frozen=True)
class AdmissionSample:
    status: int
    latency_ms: float
    success_envelope_mismatch: int = 0
    busy_envelope_mismatch: int = 0
    hybrid_success: int = 0
    model_invocation_count: int = 0
    accepted_koelectra_source_detection_count: int = 0
    transport_error: int = 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Exercise the process-local AI Safety HTTP admission gate through "
            "FastAPI and httpx ASGITransport. This produces gate E2E evidence, "
            "not a concurrency recommendation."
        )
    )
    parser.add_argument(
        "--primary-model-dir",
        type=Path,
        required=True,
        help="Local primary openai/privacy-filter ONNX artifact directory.",
    )
    parser.add_argument(
        "--koelectra-model-dir",
        type=Path,
        required=True,
        help="Local canonical GateLM KoELECTRA ONNX artifact directory.",
    )
    parser.add_argument(
        "--model-version",
        default=DEFAULT_MODEL_VERSION,
        help="Canonical KoELECTRA model version bound by the checked-in registry.",
    )
    parser.add_argument(
        "--capacity",
        type=int,
        default=DEFAULT_CAPACITY,
        help="Process-local AI Safety admission capacity from 1 to 32.",
    )
    parser.add_argument(
        "--parallel-requests",
        type=int,
        default=DEFAULT_PARALLEL_REQUESTS,
        help="Requests released together in each wave; must exceed capacity.",
    )
    parser.add_argument(
        "--waves",
        type=int,
        default=DEFAULT_WAVES,
        help="Number of completed request waves; must be at least 2.",
    )
    parser.add_argument(
        "--wave-timeout-seconds",
        type=float,
        default=DEFAULT_WAVE_TIMEOUT_SECONDS,
        help="Fail the run if a request wave does not settle within this time.",
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS_PATH,
        help="Synthetic benchmark corpus rendered only in process memory.",
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
    generated_at: datetime | None = None,
    registry_path: Path = CANONICAL_MODEL_REGISTRY_PATH,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        validate_args(args)
        git_sha = args.git_sha or current_git_sha()
        if not FULL_GIT_SHA_PATTERN.fullmatch(git_sha):
            raise BenchmarkError("an immutable Git SHA is required")

        model_binding = bind_canonical_koelectra_model(
            model_dir=args.koelectra_model_dir,
            model_version=args.model_version,
            registry_path=registry_path,
        )
        primary_model_binding = bind_primary_model(args.primary_model_dir)
        cases = load_benchmark_corpus(args.corpus)
        selected_cases = select_model_candidate_cases(cases)
        workload = tuple(
            RenderedWorkload(
                prompt_text=render_case_prompt(case),
                locale=case.locale,
            )
            for case in selected_cases
        )
        settings = Settings(
            ai_safety_detector_model_id=str(args.primary_model_dir.resolve()),
            ai_safety_additional_detector_model_ids=(
                str(args.koelectra_model_dir.resolve()),
            ),
            ai_safety_detector_runtime=AI_SAFETY_DETECTOR_RUNTIME_ONNX,
            ai_safety_ml_allowed_detector_types=tuple(
                sorted(KOELECTRA_MODEL_CANDIDATE_PLACEHOLDER_TYPES)
            ),
            ai_safety_preload_enabled=True,
            ai_safety_max_concurrent=args.capacity,
        )
        app = create_app(settings)
        verified_workload = select_verified_hybrid_workload(
            app.state.ai_safety_detector_service,
            workload,
        )
        wave_summaries = asyncio.run(
            run_http_admission_waves(
                app=app,
                workload=verified_workload,
                capacity=args.capacity,
                parallel_requests=args.parallel_requests,
                waves=args.waves,
                wave_timeout_seconds=args.wave_timeout_seconds,
            )
        )
        report = build_report(
            wave_summaries=wave_summaries,
            capacity=args.capacity,
            parallel_requests=args.parallel_requests,
            waves=args.waves,
            corpus_case_count=len(cases),
            selected_workload_case_count=len(selected_cases),
            verified_workload_case_count=len(verified_workload),
            corpus_sha256=sha256_file(args.corpus),
            model_binding=model_binding,
            primary_model_binding=primary_model_binding,
            git_sha=git_sha,
            generated_at=generated_at,
        )
        write_safe_report(report, args.out)
    except (
        BenchmarkError,
        OSError,
        RuntimeError,
        ValueError,
        json.JSONDecodeError,
        asyncio.TimeoutError,
    ):
        print(
            "FAIL: PII HTTP admission benchmark could not produce safe "
            "aggregate evidence.",
            file=sys.stderr,
        )
        return 2

    eligibility = report["eligibility"]
    print(
        "PII HTTP admission gate benchmark completed: "
        f"capacity={args.capacity}, "
        f"parallel_requests={args.parallel_requests}, "
        f"waves={args.waves}, "
        f"success_200={report['httpStatusCounts']['200']}, "
        f"busy_503={report['httpStatusCounts']['503']}, "
        f"eligible={str(eligibility['eligible']).lower()}"
    )
    return 0 if eligibility["eligible"] else 1


def validate_args(args: argparse.Namespace) -> None:
    if not 1 <= args.capacity <= 32:
        raise BenchmarkError("capacity must be between 1 and 32")
    if not 2 <= args.parallel_requests <= 256:
        raise BenchmarkError("parallel-requests must be between 2 and 256")
    if args.parallel_requests <= args.capacity:
        raise BenchmarkError("parallel-requests must exceed capacity")
    if not 2 <= args.waves <= 100:
        raise BenchmarkError("waves must be between 2 and 100")
    if not 1 <= args.wave_timeout_seconds <= 600:
        raise BenchmarkError(
            "wave-timeout-seconds must be between 1 and 600"
        )
    if args.git_sha is not None and not FULL_GIT_SHA_PATTERN.fullmatch(
        args.git_sha
    ):
        raise BenchmarkError("git-sha must be an immutable full Git object id")


def bind_canonical_koelectra_model(
    *,
    model_dir: Path,
    model_version: str,
    registry_path: Path = CANONICAL_MODEL_REGISTRY_PATH,
) -> dict[str, Any]:
    registry = load_canonical_model_registry(registry_path)
    entry = next(
        (
            candidate
            for candidate in registry["entries"]
            if candidate["canonicalVersion"] == model_version
        ),
        None,
    )
    if entry is None:
        raise BenchmarkError("model version is not present in canonical registry")
    validate_registry_entry(entry)
    return bind_model_artifact(
        model_dir=model_dir,
        model_version=model_version,
        registry_path=registry_path,
    )


def bind_primary_model(model_dir: Path) -> dict[str, Any]:
    root_graph = model_dir / "model.onnx"
    quantized_graph = model_dir / "onnx" / "model_quantized.onnx"
    graph_candidates = [
        candidate
        for candidate in (root_graph, quantized_graph)
        if candidate.is_file()
    ]
    if len(graph_candidates) != 1:
        raise BenchmarkError(
            "primary local ONNX package must contain exactly one supported graph"
        )

    graph = graph_candidates[0]
    artifacts: list[tuple[str, Path]] = [("model_graph", graph)]
    if graph == quantized_graph:
        external_data = model_dir / "onnx" / "model_quantized.onnx_data"
        if not external_data.is_file():
            raise BenchmarkError(
                "primary quantized ONNX external tensor data is missing"
            )
        artifacts.append(("external_tensor_data", external_data))
    else:
        optional_external_data = model_dir / "model.onnx_data"
        if optional_external_data.is_file():
            artifacts.append(
                ("external_tensor_data", optional_external_data)
            )

    for artifact_role, relative_name in (
        ("model_config", "config.json"),
        ("tokenizer", "tokenizer.json"),
        ("tokenizer_config", "tokenizer_config.json"),
    ):
        artifact = model_dir / relative_name
        if not artifact.is_file():
            raise BenchmarkError(
                "primary local ONNX package metadata is incomplete"
            )
        artifacts.append((artifact_role, artifact))

    package_entries = []
    total_bytes = 0
    for artifact_role, artifact in artifacts:
        artifact_bytes = artifact.stat().st_size
        if artifact_bytes <= 0:
            raise BenchmarkError(
                "primary local ONNX package contains an empty artifact"
            )
        total_bytes += artifact_bytes
        package_entries.append(
            {
                "artifactRole": artifact_role,
                "sha256": sha256_file(artifact),
                "bytes": artifact_bytes,
            }
        )
    package_binding = json.dumps(
        package_entries,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "artifactRole": "primary_local_privacy_filter_package",
        "runtime": AI_SAFETY_DETECTOR_RUNTIME_ONNX,
        "sha256": hashlib.sha256(
            package_binding.encode("utf-8")
        ).hexdigest(),
        "bytes": total_bytes,
    }


def select_model_candidate_cases(
    cases: Sequence[BenchmarkCase],
) -> tuple[BenchmarkCase, ...]:
    selected = tuple(
        case
        for case in cases
        if KOELECTRA_MODEL_CANDIDATE_PLACEHOLDER_TYPES.intersection(
            case.placeholder_bindings.values()
        )
    )
    if not selected:
        raise BenchmarkError(
            "synthetic corpus has no KoELECTRA model-candidate cases"
        )
    return selected


def select_verified_hybrid_workload(
    service: DetectorService,
    workload: Sequence[RenderedWorkload],
) -> tuple[RenderedWorkload, ...]:
    verified: list[RenderedWorkload] = []
    for item in workload:
        response = service.detect(
            AiSafetyDetectRequest.model_validate(request_payload(item))
        )
        if (
            response.execution_summary.execution_mode == "hybrid"
            and any(
                detection.source in KOELECTRA_SOURCES
                for detection in response.detections
            )
        ):
            verified.append(item)
    if not verified:
        raise BenchmarkError(
            "no synthetic workload retained hybrid KoELECTRA contribution"
        )
    return tuple(verified)


async def run_http_admission_waves(
    *,
    app: FastAPI,
    workload: Sequence[RenderedWorkload],
    capacity: int,
    parallel_requests: int,
    waves: int,
    wave_timeout_seconds: float,
) -> list[dict[str, Any]]:
    if not workload:
        raise BenchmarkError("rendered workload must not be empty")
    if capacity < 1 or parallel_requests <= capacity or waves < 1:
        raise BenchmarkError("HTTP admission wave dimensions are invalid")

    transport = httpx.ASGITransport(
        app=app,
        raise_app_exceptions=False,
    )
    summaries: list[dict[str, Any]] = []
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://gatelm-benchmark.invalid",
    ) as client:
        for wave_index in range(waves):
            release = asyncio.Event()
            tasks = []
            for request_index in range(parallel_requests):
                workload_item = workload[
                    (wave_index * parallel_requests + request_index)
                    % len(workload)
                ]
                tasks.append(
                    asyncio.create_task(
                        send_admission_request(
                            client=client,
                            workload=workload_item,
                            release=release,
                        )
                    )
                )
            await asyncio.sleep(0)
            release.set()
            samples = await asyncio.wait_for(
                asyncio.gather(*tasks),
                timeout=wave_timeout_seconds,
            )
            summaries.append(
                summarize_samples(
                    samples,
                    wave_number=wave_index + 1,
                )
            )
    return summaries


async def send_admission_request(
    *,
    client: httpx.AsyncClient,
    workload: RenderedWorkload,
    release: asyncio.Event,
) -> AdmissionSample:
    payload = request_payload(workload)
    await release.wait()
    started = perf_counter()
    try:
        response = await client.post(DETECT_PATH, json=payload)
    except httpx.HTTPError:
        return AdmissionSample(
            status=0,
            latency_ms=elapsed_ms(started),
            transport_error=1,
        )

    latency_ms = elapsed_ms(started)
    if response.status_code == 200:
        return inspect_success_response(response, latency_ms=latency_ms)
    if response.status_code == 503:
        return inspect_busy_response(response, latency_ms=latency_ms)
    return AdmissionSample(
        status=response.status_code,
        latency_ms=latency_ms,
    )


def request_payload(workload: RenderedWorkload) -> dict[str, Any]:
    return {
        "contractVersion": AI_SAFETY_DETECTOR_CONTRACT_VERSION,
        "mode": "shadow",
        "input": {
            "promptText": workload.prompt_text,
            "locale": workload.locale,
        },
        "detectorConfig": {
            "detectorSet": "privacy-filter-default",
            "returnConfidence": False,
        },
    }


def inspect_success_response(
    response: httpx.Response,
    *,
    latency_ms: float,
) -> AdmissionSample:
    try:
        value = response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return AdmissionSample(
            status=200,
            latency_ms=latency_ms,
            success_envelope_mismatch=1,
        )
    try:
        parsed = AiSafetyDetectResponse.model_validate(value, strict=True)
    except ValidationError:
        return AdmissionSample(
            status=200,
            latency_ms=latency_ms,
            success_envelope_mismatch=1,
        )

    if parsed.contract_version != AI_SAFETY_DETECTOR_CONTRACT_VERSION:
        return AdmissionSample(
            status=200,
            latency_ms=latency_ms,
            success_envelope_mismatch=1,
        )

    accepted_koelectra = sum(
        1
        for detection in parsed.detections
        if detection.source in KOELECTRA_SOURCES
    )
    return AdmissionSample(
        status=200,
        latency_ms=latency_ms,
        hybrid_success=(
            1
            if parsed.execution_summary.execution_mode == "hybrid"
            else 0
        ),
        model_invocation_count=(
            parsed.execution_summary.model_invocation_count
        ),
        accepted_koelectra_source_detection_count=accepted_koelectra,
    )


def inspect_busy_response(
    response: httpx.Response,
    *,
    latency_ms: float,
) -> AdmissionSample:
    try:
        value = response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return AdmissionSample(
            status=503,
            latency_ms=latency_ms,
            busy_envelope_mismatch=1,
        )
    return AdmissionSample(
        status=503,
        latency_ms=latency_ms,
        busy_envelope_mismatch=0 if value == EXPECTED_BUSY_ERROR else 1,
    )


def summarize_samples(
    samples: Sequence[AdmissionSample],
    *,
    wave_number: int,
) -> dict[str, Any]:
    success_latencies = [
        sample.latency_ms for sample in samples if sample.status == 200
    ]
    busy_latencies = [
        sample.latency_ms for sample in samples if sample.status == 503
    ]
    success_count = len(success_latencies)
    busy_count = len(busy_latencies)
    transport_error_count = sum(sample.transport_error for sample in samples)
    other_status_count = sum(
        1 for sample in samples if sample.status not in {0, 200, 503}
    )
    return {
        "wave": wave_number,
        "requestCount": len(samples),
        "httpStatusCounts": {
            "200": success_count,
            "503": busy_count,
            "other": other_status_count,
        },
        "transportErrorCount": transport_error_count,
        "successEnvelopeMismatchCount": sum(
            sample.success_envelope_mismatch for sample in samples
        ),
        "busyErrorEnvelopeMismatchCount": sum(
            sample.busy_envelope_mismatch for sample in samples
        ),
        "hybridSuccessCount": sum(
            sample.hybrid_success for sample in samples
        ),
        "modelInvocationCount": sum(
            sample.model_invocation_count for sample in samples
        ),
        "acceptedKoelectraSourceDetectionCount": sum(
            sample.accepted_koelectra_source_detection_count
            for sample in samples
        ),
        "latencyDistributions": {
            "success200": latency_distribution(
                success_latencies,
                population="http_status_200",
            ),
            "busy503": latency_distribution(
                busy_latencies,
                population="http_status_503",
            ),
        },
    }


def build_report(
    *,
    wave_summaries: Sequence[Mapping[str, Any]],
    capacity: int,
    parallel_requests: int,
    waves: int,
    corpus_case_count: int,
    selected_workload_case_count: int,
    verified_workload_case_count: int,
    corpus_sha256: str,
    model_binding: Mapping[str, Any],
    primary_model_binding: Mapping[str, Any],
    git_sha: str,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    if len(wave_summaries) != waves:
        raise BenchmarkError("completed wave count does not match configuration")
    if not 0 < selected_workload_case_count <= corpus_case_count:
        raise BenchmarkError("selected workload case count is invalid")
    if not 0 < verified_workload_case_count <= selected_workload_case_count:
        raise BenchmarkError("verified workload case count is invalid")
    generated = generated_at or datetime.now(timezone.utc)
    success_count = sum(
        int(summary["httpStatusCounts"]["200"])
        for summary in wave_summaries
    )
    busy_count = sum(
        int(summary["httpStatusCounts"]["503"])
        for summary in wave_summaries
    )
    other_status_count = sum(
        int(summary["httpStatusCounts"]["other"])
        for summary in wave_summaries
    )
    transport_error_count = sum(
        int(summary["transportErrorCount"]) for summary in wave_summaries
    )
    success_mismatch_count = sum(
        int(summary["successEnvelopeMismatchCount"])
        for summary in wave_summaries
    )
    busy_mismatch_count = sum(
        int(summary["busyErrorEnvelopeMismatchCount"])
        for summary in wave_summaries
    )
    envelope_mismatch_count = (
        success_mismatch_count + busy_mismatch_count
    )
    hybrid_success_count = sum(
        int(summary["hybridSuccessCount"]) for summary in wave_summaries
    )
    model_invocation_count = sum(
        int(summary["modelInvocationCount"]) for summary in wave_summaries
    )
    accepted_koelectra_count = sum(
        int(summary["acceptedKoelectraSourceDetectionCount"])
        for summary in wave_summaries
    )
    success_latencies = flatten_wave_latency_samples(
        wave_summaries,
        status_key="success200",
    )
    busy_latencies = flatten_wave_latency_samples(
        wave_summaries,
        status_key="busy503",
    )
    other_error_count = other_status_count + transport_error_count
    slot_recovery_verified = (
        waves >= 2
        and all(
            int(summary["httpStatusCounts"]["200"]) > 0
            for summary in wave_summaries
        )
    )
    checks = {
        "otherErrorsZero": other_error_count == 0,
        "envelopeMismatchesZero": envelope_mismatch_count == 0,
        "successAndBusyObserved": success_count > 0 and busy_count > 0,
        "allSuccessesHybrid": (
            success_count > 0 and hybrid_success_count == success_count
        ),
        "koelectraAcceptedContributionObserved": accepted_koelectra_count > 0,
        "allSuccessesHaveKoelectraContribution": (
            success_count > 0 and accepted_koelectra_count >= success_count
        ),
        "slotRecoveryVerified": slot_recovery_verified,
    }
    return {
        "metadata": {
            "reportVersion": REPORT_VERSION,
            "generatedAt": generated.isoformat().replace("+00:00", "Z"),
            "gitSha": git_sha,
            "purpose": "http_admission_gate_end_to_end_evidence",
            "concurrencyRecommendation": False,
            "evidenceScope": "single_process_shared_app_state_gate",
        },
        "configuration": {
            "capacity": capacity,
            "parallelRequestsPerWave": parallel_requests,
            "waves": waves,
            "totalRequests": parallel_requests * waves,
            "endpointContractVersion": AI_SAFETY_DETECTOR_CONTRACT_VERSION,
            "transport": "httpx_asgi_transport",
        },
        "workload": {
            "fullCorpusCaseCount": corpus_case_count,
            "selectedWorkloadCaseCount": selected_workload_case_count,
            "verifiedHybridWorkloadCaseCount": verified_workload_case_count,
            "selectionRule": MODEL_CANDIDATE_SELECTION_RULE,
            "verificationRule": HYBRID_PREFLIGHT_SELECTION_RULE,
            "corpusSha256": corpus_sha256,
            "rendering": "synthetic_placeholders_rendered_in_memory_only",
            "storedContent": "aggregate_only",
        },
        "artifactBinding": {
            "primary": dict(primary_model_binding),
            "koelectra": dict(model_binding),
        },
        "httpStatusCounts": {
            "200": success_count,
            "503": busy_count,
            "other": other_status_count,
        },
        "transportErrorCount": transport_error_count,
        "otherErrorCount": other_error_count,
        "successEnvelopeMismatchCount": success_mismatch_count,
        "busyErrorEnvelopeMismatchCount": busy_mismatch_count,
        "envelopeMismatchCount": envelope_mismatch_count,
        "hybridSuccessCount": hybrid_success_count,
        "modelInvocationCount": model_invocation_count,
        "acceptedKoelectraSourceDetectionCount": accepted_koelectra_count,
        "latencyDistributions": {
            "success200": latency_distribution(
                success_latencies,
                population="http_status_200",
            ),
            "busy503": latency_distribution(
                busy_latencies,
                population="http_status_503",
            ),
        },
        "slotRecoveryVerified": slot_recovery_verified,
        "eligibility": {
            "eligible": all(checks.values()),
            "checks": checks,
            "meaning": (
                "HTTP admission and hybrid-retention evidence only; "
                "not a concurrency recommendation."
            ),
        },
        "waveSummaries": list(wave_summaries),
    }


def flatten_wave_latency_samples(
    wave_summaries: Sequence[Mapping[str, Any]],
    *,
    status_key: str,
) -> list[float]:
    values: list[float] = []
    for summary in wave_summaries:
        distribution = summary["latencyDistributions"][status_key]
        encoded_samples = distribution.get("_samplesMs")
        if not isinstance(encoded_samples, list):
            raise BenchmarkError("wave latency samples are missing")
        values.extend(float(value) for value in encoded_samples)
    return values


def latency_distribution(
    values: Sequence[float],
    *,
    population: str,
) -> dict[str, Any]:
    rounded_values = [round(max(0.0, float(value)), 3) for value in values]
    return {
        "population": population,
        "count": len(rounded_values),
        "p50Ms": percentile(rounded_values, 0.50),
        "p95Ms": percentile(rounded_values, 0.95),
        "p99Ms": percentile(rounded_values, 0.99),
        "_samplesMs": rounded_values,
    }


def strip_private_latency_samples(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: strip_private_latency_samples(item)
            for key, item in value.items()
            if key != "_samplesMs"
        }
    if isinstance(value, list):
        return [strip_private_latency_samples(item) for item in value]
    return value


def percentile(values: Sequence[float], percentile_value: float) -> float | None:
    if not values:
        return None
    if not 0 < percentile_value <= 1:
        raise ValueError("percentile must be in the range (0, 1]")
    sorted_values = sorted(values)
    rank = math.ceil(percentile_value * len(sorted_values))
    return round(float(sorted_values[rank - 1]), 3)


def elapsed_ms(started: float) -> float:
    return round(max(0.0, (perf_counter() - started) * 1000), 3)


def write_safe_report(report: Mapping[str, Any], path: Path) -> None:
    public_report = strip_private_latency_samples(dict(report))
    rendered = json.dumps(
        public_report,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    scan_text_for_forbidden_report_values(
        rendered,
        "PII HTTP admission benchmark report",
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((rendered + "\n").encode("utf-8"))


if __name__ == "__main__":
    raise SystemExit(run())
