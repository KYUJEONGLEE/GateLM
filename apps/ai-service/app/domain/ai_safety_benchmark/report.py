from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.domain.ai_safety_benchmark.stats import nearest_rank, round_rate
from app.domain.ai_safety_benchmark.types import (
    CASE_GROUPS,
    MODEL_ID,
    REPORT_VERSION,
    RUNTIME_PROFILES,
    BenchmarkError,
    BenchmarkSample,
    ResourceSummary,
)


FORBIDDEN_REPORT_FIELD_NAMES = {
    "promptText",
    "inputTemplate",
    "redactedPrompt",
    "rawPrompt",
    "rawMessages",
    "rawResponse",
    "rawValue",
    "rawDetectedValue",
    "detectedValue",
    "rawSpan",
    "span",
    "offset",
    "start",
    "end",
    "word",
    "rawErrorBody",
    "requestId",
    "traceId",
    "sampleHash",
    "promptHash",
}
FORBIDDEN_LITERAL_PATTERNS = {
    "openai_like_key": re.compile(r"\bsk-[A-Za-z0-9][A-Za-z0-9_\-]{10,}"),
    "anthropic_like_key": re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{10,}"),
    "google_api_key_like": re.compile(r"\bAIza[A-Za-z0-9_\-]{10,}"),
    "aws_access_key_like": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github_token_like": re.compile(r"\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    "slack_token_like": re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}"),
    "authorization_credential": re.compile(r"Authorization\s*:\s*(?:Bearer|Basic)\s+\S+", re.IGNORECASE),
    "jwt_like": re.compile(r"\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b"),
    "private_key_block": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "rrn_like": re.compile(r"\b\d{6}[-\s]?[1-8]\d{6}\b"),
}


def build_report(
    *,
    samples: list[BenchmarkSample],
    runtime_profile: str,
    target: str,
    warmup_requests: int,
    measured_requests: int,
    timeout_ms: int,
    request_timeout_ms: int | None = None,
    resource_summary: ResourceSummary,
    run_id: str,
    git_sha: str,
    model_revision: str | None,
    generated_at: datetime | None = None,
    hardware: str | None = None,
    os_name: str | None = None,
    python_version: str | None = None,
    torch_version: str | None = None,
    transformers_version: str | None = None,
) -> dict[str, Any]:
    generated = generated_at or datetime.now(tz=timezone.utc)
    selected_runtime_result = build_runtime_result(
        runtime_profile=runtime_profile,
        samples=samples,
        resource_summary=resource_summary,
        timeout_ms=timeout_ms,
    )
    runtime_results = [
        selected_runtime_result
        if profile == runtime_profile
        else not_run_runtime_result(profile)
        for profile in RUNTIME_PROFILES
    ]
    case_group_results = build_case_group_results(samples)
    decision_summary = build_decision_summary(selected_runtime_result)
    return {
        "metadata": {
            "reportVersion": REPORT_VERSION,
            "runId": run_id,
            "date": generated.isoformat().replace("+00:00", "Z"),
            "gitSha": git_sha,
            "modelId": MODEL_ID,
            "modelRevision": model_revision,
            "runtimeProfile": runtime_profile,
            "target": target,
            "hardware": hardware,
            "os": os_name,
            "pythonVersion": python_version,
            "torchVersion": torch_version,
            "transformersVersion": transformers_version,
            "warmupRequests": warmup_requests,
            "measuredRequests": measured_requests,
            "timeoutMs": timeout_ms,
            "requestTimeoutMs": request_timeout_ms or timeout_ms,
            "evidenceOnly": True,
        },
        "runtimeResults": runtime_results,
        "caseGroupResults": case_group_results,
        "decisionSummary": decision_summary,
        "fallbackRecommendation": build_fallback_recommendation(selected_runtime_result),
    }


def build_runtime_result(
    *,
    runtime_profile: str,
    samples: list[BenchmarkSample],
    resource_summary: ResourceSummary,
    timeout_ms: int,
) -> dict[str, Any]:
    sidecar_latencies = [
        sample.sidecar_latency_ms
        for sample in samples
        if sample.sidecar_latency_ms is not None and sample.sidecar_outcome == "success"
    ]
    full_latencies = [sample.full_safety_latency_ms for sample in samples]
    request_count = len(samples)
    timeout_count = count_matching(samples, "sidecar_outcome", "timeout")
    fallback_count = count_matching(samples, "fallback_mode", "regex_only")
    p95_sidecar = nearest_rank(sidecar_latencies, 0.95)
    p95_full = nearest_rank(full_latencies, 0.95)
    sidecar_gate = sidecar_latency_gate(
        p95_sidecar_latency_ms=p95_sidecar,
        request_count=request_count,
        timeout_count=timeout_count,
        fallback_count=fallback_count,
        timeout_ms=timeout_ms,
    )
    full_gate = full_safety_gate(p95_full)
    return {
        "runtimeProfile": runtime_profile,
        "status": runtime_status(sidecar_gate, full_gate),
        "requests": request_count,
        "successfulRequests": len(sidecar_latencies),
        "p50SidecarLatencyMs": nearest_rank(sidecar_latencies, 0.50),
        "p95SidecarLatencyMs": p95_sidecar,
        "p50FullSafetyStageMs": nearest_rank(full_latencies, 0.50),
        "p95FullSafetyStageMs": p95_full,
        "timeoutCount": timeout_count,
        "fallbackCount": fallback_count,
        "timeoutRate": round_rate(timeout_count, request_count),
        "sidecarOutcomeCounts": dict(sorted(Counter(sample.sidecar_outcome for sample in samples).items())),
        "fallbackModeCounts": dict(sorted(Counter(sample.fallback_mode for sample in samples).items())),
        "sanitizedErrorCounts": sanitized_error_counts(samples),
        "sidecarLatencyGate": sidecar_gate,
        "fullSafetyStageGate": full_gate,
        "resource": resource_summary.to_report(),
    }


def not_run_runtime_result(runtime_profile: str) -> dict[str, Any]:
    return {
        "runtimeProfile": runtime_profile,
        "status": "not_run",
        "requests": 0,
        "successfulRequests": 0,
        "p50SidecarLatencyMs": None,
        "p95SidecarLatencyMs": None,
        "p50FullSafetyStageMs": None,
        "p95FullSafetyStageMs": None,
        "timeoutCount": 0,
        "fallbackCount": 0,
        "timeoutRate": 0.0,
        "sidecarOutcomeCounts": {},
        "fallbackModeCounts": {},
        "sanitizedErrorCounts": {},
        "sidecarLatencyGate": "not_run",
        "fullSafetyStageGate": "not_run",
        "resource": {
            "peakRssMb": None,
            "avgCpuPct": None,
            "peakGpuMemoryMb": None,
            "notes": "not_run",
        },
    }


def build_case_group_results(samples: list[BenchmarkSample]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for case_group in CASE_GROUPS:
        group_samples = [sample for sample in samples if sample.case_group == case_group]
        latencies = [sample.full_safety_latency_ms for sample in group_samples]
        results.append(
            {
                "caseGroup": case_group,
                "requests": len(group_samples),
                "p50LatencyMs": nearest_rank(latencies, 0.50),
                "p95LatencyMs": nearest_rank(latencies, 0.95),
                "maxLatencyMs": max(latencies) if latencies else None,
                "timeoutCount": count_matching(group_samples, "sidecar_outcome", "timeout"),
                "fallbackCount": count_matching(group_samples, "fallback_mode", "regex_only"),
            }
        )
    return results


def build_decision_summary(runtime_result: dict[str, Any]) -> dict[str, str]:
    timeout_gate = "pass"
    if runtime_result["timeoutCount"] != runtime_result["fallbackCount"]:
        timeout_gate = "fail"
    return {
        "sidecarLatencyGate": runtime_result["sidecarLatencyGate"],
        "fullSafetyStageGate": runtime_result["fullSafetyStageGate"],
        "timeoutFallbackGate": timeout_gate,
        "rawValueExposureGate": "pass",
    }


def build_fallback_recommendation(runtime_result: dict[str, Any]) -> dict[str, str]:
    p95_sidecar = runtime_result["p95SidecarLatencyMs"]
    p95_full = runtime_result["p95FullSafetyStageMs"]
    sidecar_under = (
        "ml_sidecar_candidate"
        if p95_sidecar is not None and p95_sidecar <= 300 and runtime_result["timeoutCount"] == 0
        else "not_applicable"
    )
    sidecar_over = (
        "mark_shadow_unavailable_and_use_regex_only_fallback"
        if p95_sidecar is None or p95_sidecar > 300 or runtime_result["timeoutCount"] > 0
        else "not_applicable"
    )
    full_over = (
        "do_not_promote_ml_sidecar_to_enforce_path"
        if p95_full is None or p95_full > 1200
        else "not_applicable"
    )
    posture = "evidence_only"
    if runtime_result["status"] == "pass":
        posture = "shadow_candidate_with_regex_only_timeout_fallback"
    elif runtime_result["status"] == "warn":
        posture = "shadow_only_until_latency_headroom_improves"
    return {
        "sidecarP95Under300Ms": sidecar_under,
        "sidecarP95Over300Ms": sidecar_over,
        "fullSafetyP95Over1200Ms": full_over,
        "recommendedProductionPosture": posture,
    }


def sidecar_latency_gate(
    *,
    p95_sidecar_latency_ms: int | None,
    request_count: int,
    timeout_count: int,
    fallback_count: int,
    timeout_ms: int,
) -> str:
    if request_count == 0 or p95_sidecar_latency_ms is None:
        return "fail"
    if p95_sidecar_latency_ms <= timeout_ms and timeout_count == 0:
        return "pass"
    if fallback_count == timeout_count:
        return "warn"
    return "fail"


def full_safety_gate(p95_full_safety_stage_ms: int | None) -> str:
    if p95_full_safety_stage_ms is None:
        return "fail"
    if p95_full_safety_stage_ms <= 800:
        return "pass"
    if p95_full_safety_stage_ms <= 1200:
        return "warn"
    return "fail"


def runtime_status(sidecar_gate: str, full_gate: str) -> str:
    if "fail" in {sidecar_gate, full_gate}:
        return "fail"
    if "warn" in {sidecar_gate, full_gate}:
        return "warn"
    return "pass"


def count_matching(samples: list[BenchmarkSample], field_name: str, expected: str) -> int:
    return sum(1 for sample in samples if getattr(sample, field_name) == expected)


def sanitized_error_counts(samples: list[BenchmarkSample]) -> dict[str, int]:
    counts = Counter(
        sample.sanitized_error_code
        for sample in samples
        if sample.sanitized_error_code is not None
    )
    return dict(sorted(counts.items()))


def render_markdown_report(report: dict[str, Any]) -> str:
    metadata = report["metadata"]
    runtime_results = report["runtimeResults"]
    decision_summary = report["decisionSummary"]
    fallback = report["fallbackRecommendation"]
    lines: list[str] = [
        "# Resource / Latency Benchmark Report",
        "",
        "## Run Metadata",
        f"- runId: `{metadata['runId']}`",
        f"- date: `{metadata['date']}`",
        f"- gitSha: `{metadata['gitSha']}`",
        f"- modelId: `{metadata['modelId']}`",
        f"- modelRevision: `{metadata['modelRevision']}`",
        f"- runtimeProfile: `{metadata['runtimeProfile']}`",
        f"- target: `{metadata['target']}`",
        f"- hardware: `{metadata['hardware']}`",
        f"- os: `{metadata['os']}`",
        f"- pythonVersion: `{metadata['pythonVersion']}`",
        f"- torchVersion: `{metadata['torchVersion']}`",
        f"- transformersVersion: `{metadata['transformersVersion']}`",
        f"- warmupRequests: `{metadata['warmupRequests']}`",
        f"- measuredRequests: `{metadata['measuredRequests']}`",
        "",
        "## Decision Summary",
        "| Gate | Result | Evidence |",
        "|---|---|---|",
        (
            "| sidecar p95 <= 300ms | {result} | p95SidecarLatencyMs={evidence} |"
        ).format(
            result=decision_summary["sidecarLatencyGate"],
            evidence=selected_runtime(runtime_results)["p95SidecarLatencyMs"],
        ),
        (
            "| full safety stage <= 800~1200ms | {result} | p95FullSafetyStageMs={evidence} |"
        ).format(
            result=decision_summary["fullSafetyStageGate"],
            evidence=selected_runtime(runtime_results)["p95FullSafetyStageMs"],
        ),
        (
            "| timeout fallback works | {result} | timeoutCount={timeoutCount}, "
            "regexOnlyFallbackCount={fallbackCount} |"
        ).format(
            result=decision_summary["timeoutFallbackGate"],
            timeoutCount=selected_runtime(runtime_results)["timeoutCount"],
            fallbackCount=selected_runtime(runtime_results)["fallbackCount"],
        ),
        "| raw value exposure | pass | sanitized aggregate fields only |",
        "",
        "## Latency Summary",
        "| Runtime | p50 sidecar | p95 sidecar | p50 full safety | p95 full safety | timeout rate |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for runtime in runtime_results:
        lines.append(
            "| {runtimeProfile} | {p50SidecarLatencyMs} | {p95SidecarLatencyMs} | "
            "{p50FullSafetyStageMs} | {p95FullSafetyStageMs} | {timeoutRate} |".format(**runtime)
        )
    lines.extend(
        [
            "",
            "## Case Group Summary",
            "| Group | requests | p50 | p95 | max | timeoutCount | fallbackCount |",
            "|---|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for group in report["caseGroupResults"]:
        lines.append(
            "| {caseGroup} | {requests} | {p50LatencyMs} | {p95LatencyMs} | "
            "{maxLatencyMs} | {timeoutCount} | {fallbackCount} |".format(**group)
        )
    lines.extend(
        [
            "",
            "## Resource Summary",
            "| Runtime | peakRssMb | avgCpuPct | peakGpuMemoryMb | notes |",
            "|---|---:|---:|---:|---|",
        ]
    )
    for runtime in runtime_results:
        resource = runtime["resource"]
        lines.append(
            "| {runtime} | {peakRssMb} | {avgCpuPct} | {peakGpuMemoryMb} | {notes} |".format(
                runtime=runtime["runtimeProfile"],
                **resource,
            )
        )
    lines.extend(
        [
            "",
            "## Fallback Recommendation",
            f"- If sidecar p95 <= 300ms: `{fallback['sidecarP95Under300Ms']}`",
            f"- If sidecar p95 > 300ms: `{fallback['sidecarP95Over300Ms']}`",
            f"- If full safety p95 > 1200ms: `{fallback['fullSafetyP95Over1200Ms']}`",
            f"- Recommended production posture: `{fallback['recommendedProductionPosture']}`",
            "",
            "## Raw Value Safety Check",
            "- Report stores no source input text.",
            "- Report stores no detected sensitive value.",
            "- Report stores no raw location data.",
            "- Report stores no raw model token text.",
            "- Report stores no raw error body.",
            "",
        ]
    )
    return "\n".join(lines)


def selected_runtime(runtime_results: list[dict[str, Any]]) -> dict[str, Any]:
    for runtime in runtime_results:
        if runtime["status"] != "not_run":
            return runtime
    return runtime_results[0]


def write_reports(report: dict[str, Any], out_dir: Path, *, strict_security_scan: bool = True) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "resource-latency-benchmark.json"
    markdown_path = out_dir / "resource-latency-benchmark.md"
    json_text = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
    markdown_text = render_markdown_report(report)
    if strict_security_scan:
        scan_text_for_forbidden_report_values(json_text, "JSON benchmark report")
        scan_text_for_forbidden_report_values(markdown_text, "Markdown benchmark report")
    json_path.write_text(json_text + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_text, encoding="utf-8")
    return json_path, markdown_path


def scan_text_for_forbidden_report_values(text: str, label: str) -> None:
    for field_name in FORBIDDEN_REPORT_FIELD_NAMES:
        if re.search(rf'"{re.escape(field_name)}"\s*:', text):
            raise BenchmarkError(f"{label}: forbidden field name {field_name!r} found")
        if re.search(rf"`{re.escape(field_name)}`", text):
            raise BenchmarkError(f"{label}: forbidden field name {field_name!r} found")
    for pattern_name, pattern in FORBIDDEN_LITERAL_PATTERNS.items():
        if pattern.search(text):
            raise BenchmarkError(f"{label}: forbidden sensitive literal pattern {pattern_name!r} found")
