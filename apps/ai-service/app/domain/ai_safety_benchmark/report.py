from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Mapping
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
from app.domain.ai_safety_promotion.binding import (
    EvidenceBindingError,
    validate_evidence_binding,
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
    model_id: str = MODEL_ID,
    generated_at: datetime | None = None,
    hardware: str | None = None,
    os_name: str | None = None,
    python_version: str | None = None,
    torch_version: str | None = None,
    transformers_version: str | None = None,
    evidence_binding: Mapping[str, Any] | None = None,
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
    report = {
        "metadata": {
            "reportVersion": REPORT_VERSION,
            "runId": run_id,
            "date": generated.isoformat().replace("+00:00", "Z"),
            "gitSha": git_sha,
            "modelId": model_id,
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
    if evidence_binding is not None:
        try:
            normalized_binding = validate_evidence_binding(evidence_binding)
        except EvidenceBindingError as exc:
            raise BenchmarkError("benchmark evidence binding is invalid") from exc
        if git_sha != normalized_binding["gitRevision"]:
            raise BenchmarkError("benchmark Git revision does not match evidence binding")
        report["evidenceBinding"] = normalized_binding
    return report


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
    target_latencies = [sample.target_latency_ms for sample in samples]
    model_active_samples = [
        sample
        for sample in samples
        if sample.execution_mode == "hybrid"
        and sample.model_invocation_count is not None
        and sample.model_invocation_count > 0
    ]
    model_active_sidecar_latencies = [
        sample.sidecar_latency_ms
        for sample in model_active_samples
        if sample.sidecar_latency_ms is not None and sample.sidecar_outcome == "success"
    ]
    request_count = len(samples)
    timeout_count = count_matching(samples, "sidecar_outcome", "timeout")
    observed_fallback_count = sum(
        1
        for sample in samples
        if sample.fallback_observation == "observed" and sample.fallback_mode == "regex_only"
    )
    unobserved_fallback_count = count_matching(
        samples, "fallback_observation", "not_observed"
    )
    unobserved_sidecar_count = count_matching(
        samples, "sidecar_observation", "not_observed"
    )
    p95_sidecar = nearest_rank(sidecar_latencies, 0.95)
    p95_target = nearest_rank(target_latencies, 0.95)
    sidecar_gate = sidecar_latency_gate(
        p95_sidecar_latency_ms=p95_sidecar,
        request_count=request_count,
        timeout_count=timeout_count,
        observed_fallback_count=observed_fallback_count,
        unobserved_sidecar_count=unobserved_sidecar_count,
        timeout_ms=timeout_ms,
    )
    target_gate = target_latency_gate(p95_target)
    evidence_gate = "pass" if unobserved_sidecar_count == 0 else "fail"
    return {
        "runtimeProfile": runtime_profile,
        "status": runtime_status(sidecar_gate, target_gate, evidence_gate),
        "requests": request_count,
        "successfulRequests": len(sidecar_latencies),
        "p50SidecarLatencyMs": nearest_rank(sidecar_latencies, 0.50),
        "p95SidecarLatencyMs": p95_sidecar,
        "p50TargetLatencyMs": nearest_rank(target_latencies, 0.50),
        "p95TargetLatencyMs": p95_target,
        "modelActiveRequestCount": len(model_active_samples),
        "modelInvocationCount": sum(
            sample.model_invocation_count or 0 for sample in samples
        ),
        "acceptedModelDetectionCount": sum(
            sample.accepted_model_detection_count or 0 for sample in samples
        ),
        "p50ModelActiveSidecarLatencyMs": nearest_rank(
            model_active_sidecar_latencies, 0.50
        ),
        "p95ModelActiveSidecarLatencyMs": nearest_rank(
            model_active_sidecar_latencies, 0.95
        ),
        "executionModeCounts": dict(
            sorted(Counter(sample.execution_mode or "unobserved" for sample in samples).items())
        ),
        "timeoutCount": timeout_count,
        "observedFallbackCount": observed_fallback_count,
        "unobservedFallbackCount": unobserved_fallback_count,
        "unobservedSidecarCount": unobserved_sidecar_count,
        "timeoutRate": round_rate(timeout_count, request_count),
        "targetKindCounts": dict(sorted(Counter(sample.target_kind for sample in samples).items())),
        "targetOutcomeCounts": dict(sorted(Counter(sample.target_outcome for sample in samples).items())),
        "sidecarOutcomeCounts": dict(sorted(Counter(sample.sidecar_outcome for sample in samples).items())),
        "sidecarObservationCounts": dict(
            sorted(Counter(sample.sidecar_observation for sample in samples).items())
        ),
        "fallbackModeCounts": dict(sorted(Counter(sample.fallback_mode for sample in samples).items())),
        "fallbackObservationCounts": dict(
            sorted(Counter(sample.fallback_observation for sample in samples).items())
        ),
        "sanitizedErrorCounts": sanitized_error_counts(samples),
        "sidecarLatencyGate": sidecar_gate,
        "targetLatencyGate": target_gate,
        "evidenceCompletenessGate": evidence_gate,
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
        "p50TargetLatencyMs": None,
        "p95TargetLatencyMs": None,
        "modelActiveRequestCount": 0,
        "modelInvocationCount": 0,
        "acceptedModelDetectionCount": 0,
        "p50ModelActiveSidecarLatencyMs": None,
        "p95ModelActiveSidecarLatencyMs": None,
        "executionModeCounts": {},
        "timeoutCount": 0,
        "observedFallbackCount": 0,
        "unobservedFallbackCount": 0,
        "unobservedSidecarCount": 0,
        "timeoutRate": 0.0,
        "targetKindCounts": {},
        "targetOutcomeCounts": {},
        "sidecarOutcomeCounts": {},
        "sidecarObservationCounts": {},
        "fallbackModeCounts": {},
        "fallbackObservationCounts": {},
        "sanitizedErrorCounts": {},
        "sidecarLatencyGate": "not_run",
        "targetLatencyGate": "not_run",
        "evidenceCompletenessGate": "not_run",
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
        latencies = [sample.target_latency_ms for sample in group_samples]
        results.append(
            {
                "caseGroup": case_group,
                "requests": len(group_samples),
                "p50LatencyMs": nearest_rank(latencies, 0.50),
                "p95LatencyMs": nearest_rank(latencies, 0.95),
                "maxLatencyMs": max(latencies) if latencies else None,
                "timeoutCount": count_matching(group_samples, "sidecar_outcome", "timeout"),
                "observedFallbackCount": sum(
                    1
                    for sample in group_samples
                    if sample.fallback_observation == "observed"
                    and sample.fallback_mode == "regex_only"
                ),
                "unobservedSidecarCount": count_matching(
                    group_samples, "sidecar_observation", "not_observed"
                ),
            }
        )
    return results


def build_decision_summary(runtime_result: dict[str, Any]) -> dict[str, str]:
    timeout_gate = "not_exercised"
    if runtime_result["timeoutCount"] > 0:
        timeout_gate = (
            "pass"
            if runtime_result["timeoutCount"] == runtime_result["observedFallbackCount"]
            else "fail"
        )
    return {
        "sidecarLatencyGate": runtime_result["sidecarLatencyGate"],
        "targetLatencyGate": runtime_result["targetLatencyGate"],
        "timeoutFallbackGate": timeout_gate,
        "evidenceCompletenessGate": runtime_result["evidenceCompletenessGate"],
        "rawValueExposureGate": "pass",
    }


def build_fallback_recommendation(runtime_result: dict[str, Any]) -> dict[str, str]:
    p95_sidecar = runtime_result["p95SidecarLatencyMs"]
    p95_target = runtime_result["p95TargetLatencyMs"]
    sidecar_under = (
        "ml_sidecar_candidate"
        if p95_sidecar is not None
        and p95_sidecar <= 300
        and runtime_result["timeoutCount"] == 0
        and runtime_result["unobservedSidecarCount"] == 0
        else "not_applicable"
    )
    sidecar_over = (
        "mark_shadow_unavailable_and_use_regex_only_fallback"
        if p95_sidecar is None
        or p95_sidecar > 300
        or runtime_result["timeoutCount"] > 0
        or runtime_result["unobservedSidecarCount"] > 0
        else "not_applicable"
    )
    target_over = (
        "do_not_promote_ml_sidecar_to_enforce_path"
        if p95_target is None or p95_target > 1200
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
        "targetP95Over1200Ms": target_over,
        "recommendedProductionPosture": posture,
    }


def sidecar_latency_gate(
    *,
    p95_sidecar_latency_ms: int | None,
    request_count: int,
    timeout_count: int,
    observed_fallback_count: int,
    unobserved_sidecar_count: int,
    timeout_ms: int,
) -> str:
    if request_count == 0 or p95_sidecar_latency_ms is None or unobserved_sidecar_count > 0:
        return "fail"
    if p95_sidecar_latency_ms <= timeout_ms and timeout_count == 0:
        return "pass"
    if timeout_count > 0 and observed_fallback_count == timeout_count:
        return "warn"
    return "fail"


def target_latency_gate(p95_target_latency_ms: int | None) -> str:
    if p95_target_latency_ms is None:
        return "fail"
    if p95_target_latency_ms <= 800:
        return "pass"
    if p95_target_latency_ms <= 1200:
        return "warn"
    return "fail"


def runtime_status(sidecar_gate: str, target_gate: str, evidence_gate: str) -> str:
    if "fail" in {sidecar_gate, target_gate, evidence_gate}:
        return "fail"
    if "warn" in {sidecar_gate, target_gate}:
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
        f"- reportVersion: `{metadata['reportVersion']}`",
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
            "| measured target p95 <= 800~1200ms | {result} | p95TargetLatencyMs={evidence} |"
        ).format(
            result=decision_summary["targetLatencyGate"],
            evidence=selected_runtime(runtime_results)["p95TargetLatencyMs"],
        ),
        (
            "| timeout fallback observed | {result} | timeoutCount={timeoutCount}, "
            "observedFallbackCount={fallbackCount} |"
        ).format(
            result=decision_summary["timeoutFallbackGate"],
            timeoutCount=selected_runtime(runtime_results)["timeoutCount"],
            fallbackCount=selected_runtime(runtime_results)["observedFallbackCount"],
        ),
        (
            "| sidecar evidence complete | {result} | unobservedSidecarCount={count} |"
        ).format(
            result=decision_summary["evidenceCompletenessGate"],
            count=selected_runtime(runtime_results)["unobservedSidecarCount"],
        ),
        "| raw value exposure | pass | sanitized aggregate fields only |",
        "",
        "## Latency Summary",
        "| Runtime | p50 sidecar | p95 sidecar | p50 target | p95 target | timeout rate |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for runtime in runtime_results:
        lines.append(
            "| {runtimeProfile} | {p50SidecarLatencyMs} | {p95SidecarLatencyMs} | "
            "{p50TargetLatencyMs} | {p95TargetLatencyMs} | {timeoutRate} |".format(**runtime)
        )
    lines.extend(
        [
            "",
            "## Model Execution Summary",
            "| Runtime | rules-only | hybrid | unobserved | model-active requests | "
            "model invocations | accepted detections | model-active p50 sidecar | "
            "model-active p95 sidecar |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for runtime in runtime_results:
        mode_counts = runtime["executionModeCounts"]
        lines.append(
            "| {runtime} | {rulesOnly} | {hybrid} | {unobserved} | {activeRequests} | "
            "{invocations} | {accepted} | {p50} | {p95} |".format(
                runtime=runtime["runtimeProfile"],
                rulesOnly=mode_counts.get("rules_only", 0),
                hybrid=mode_counts.get("hybrid", 0),
                unobserved=mode_counts.get("unobserved", 0),
                activeRequests=runtime["modelActiveRequestCount"],
                invocations=runtime["modelInvocationCount"],
                accepted=runtime["acceptedModelDetectionCount"],
                p50=runtime["p50ModelActiveSidecarLatencyMs"],
                p95=runtime["p95ModelActiveSidecarLatencyMs"],
            )
        )
    lines.extend(
        [
            "",
            "## Case Group Summary",
            "| Group | requests | p50 target | p95 target | max target | timeoutCount | "
            "observedFallbackCount | unobservedSidecarCount |",
            "|---|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for group in report["caseGroupResults"]:
        lines.append(
            "| {caseGroup} | {requests} | {p50LatencyMs} | {p95LatencyMs} | "
            "{maxLatencyMs} | {timeoutCount} | {observedFallbackCount} | "
            "{unobservedSidecarCount} |".format(**group)
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
            f"- If measured target p95 > 1200ms: `{fallback['targetP95Over1200Ms']}`",
            f"- Recommended production posture: `{fallback['recommendedProductionPosture']}`",
            "- Gateway target latency is never reported as sidecar latency.",
            "- A Gateway result without explicit sidecar telemetry remains not observed.",
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
