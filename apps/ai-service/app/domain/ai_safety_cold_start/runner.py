from __future__ import annotations

import json
import math
import re
from collections.abc import Callable, Mapping
from typing import Any

from app.domain.ai_safety_benchmark.stats import nearest_rank
from app.domain.ai_safety_promotion.binding import (
    EvidenceBindingError,
    validate_evidence_binding,
)


REPORT_VERSION = "pii-repeated-cold-evidence.v1"
CHILD_VERSION = "pii-cold-start-child.v1"


class ColdStartEvidenceError(ValueError):
    """Raised when cold-start evidence is unsafe or structurally invalid."""


ChildExecutor = Callable[[int], Mapping[str, Any]]


def build_repeated_cold_evidence(
    *,
    runs: int,
    child_timeout_ms: int,
    execute_child: ChildExecutor,
    evidence_binding: Mapping[str, Any],
) -> dict[str, Any]:
    if isinstance(runs, bool) or not isinstance(runs, int) or runs <= 0:
        raise ColdStartEvidenceError("runs must be a positive integer")
    if (
        isinstance(child_timeout_ms, bool)
        or not isinstance(child_timeout_ms, int)
        or child_timeout_ms <= 0
    ):
        raise ColdStartEvidenceError("child timeout must be a positive integer")
    try:
        normalized_binding = validate_evidence_binding(evidence_binding)
    except EvidenceBindingError as exc:
        raise ColdStartEvidenceError("evidence binding is invalid") from exc

    latencies: list[int] = []
    peak_values: list[float] = []
    for _ in range(runs):
        try:
            observation = execute_child(child_timeout_ms)
        except Exception:
            continue
        normalized = _successful_child_observation(observation)
        if normalized is None:
            continue
        latency_ms, peak_rss_mb = normalized
        latencies.append(latency_ms)
        peak_values.append(peak_rss_mb)

    successful_runs = len(latencies)
    failed_runs = runs - successful_runs
    evidence = {
        "schemaVersion": REPORT_VERSION,
        "aggregateOnly": True,
        "runs": runs,
        "successfulRuns": successful_runs,
        "failedRuns": failed_runs,
        "startupFailureRate": round(failed_runs / runs, 6),
        "coldP50Ms": nearest_rank(latencies, 0.50),
        "coldP95Ms": nearest_rank(latencies, 0.95),
        "peakRssMb": round(max(peak_values), 3) if peak_values else None,
        "evidenceBinding": normalized_binding,
        "contentSafety": {
            "rawContentIncluded": False,
            "requestIdentifiersIncluded": False,
            "endpointLocationsIncluded": False,
            "artifactDigestsIncluded": False,
            "childErrorDetailIncluded": False,
        },
    }
    scan_cold_start_output(evidence)
    return evidence


def scan_cold_start_output(evidence: Mapping[str, Any]) -> None:
    serialized = json.dumps(evidence, ensure_ascii=False, sort_keys=True)
    forbidden_fields = (
        "promptText",
        "rawPrompt",
        "rawValue",
        "requestId",
        "traceId",
        "endpointUrl",
        "sha256",
        "errorDetail",
    )
    for field_name in forbidden_fields:
        if re.search(rf'"{re.escape(field_name)}"\s*:', serialized):
            raise ColdStartEvidenceError("cold-start output contains a forbidden field category")
    forbidden_literals = (
        re.compile(r"https?://\S+", re.IGNORECASE),
        re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
        re.compile(r"\b\d{6}[-\s]?[1-8]\d{6}\b"),
    )
    if any(pattern.search(serialized) for pattern in forbidden_literals):
        raise ColdStartEvidenceError("cold-start output contains a forbidden literal category")


def _successful_child_observation(value: Mapping[str, Any]) -> tuple[int, float] | None:
    if not isinstance(value, Mapping):
        return None
    if set(value) != {"schemaVersion", "status", "startupLatencyMs", "peakRssMb"}:
        return None
    if value.get("schemaVersion") != CHILD_VERSION or value.get("status") != "passed":
        return None
    latency = value.get("startupLatencyMs")
    peak_rss = value.get("peakRssMb")
    if (
        not _finite_number(latency)
        or float(latency) < 0
        or not float(latency).is_integer()
        or not _finite_number(peak_rss)
        or float(peak_rss) <= 0
    ):
        return None
    return int(latency), float(peak_rss)


def _finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )
