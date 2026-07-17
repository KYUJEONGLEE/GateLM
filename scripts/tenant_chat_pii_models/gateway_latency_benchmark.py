from __future__ import annotations

import argparse
import json
import math
import os
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Iterable

from app.domain.ai_safety_benchmark.corpus import load_benchmark_corpus, render_case_prompt


DEFAULT_CORPUS = Path("docs/ai-safety-lab/fixtures/resource-latency-benchmark-corpus.jsonl")
SIDECAR_CALLS = "gatelm_ai_safety_sidecar_calls_total"
SIDECAR_FALLBACKS = "gatelm_ai_safety_sidecar_fallback_total"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Measure aggregate-only Gateway PII latency without persisting prompt bodies."
    )
    parser.add_argument("--endpoint", default="http://gateway-core:8080/v1/chat/completions")
    parser.add_argument("--metrics-endpoint", default="http://gateway-core:8080/metrics")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--warmup", type=int, default=20)
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--timeout-ms", type=int, default=500)
    parser.add_argument("--out", type=Path, required=True)
    return parser


def nearest_rank(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * quantile) - 1))
    return round(ordered[index], 3)


def metric_sum(text: str, metric_name: str) -> float:
    total = 0.0
    for line in text.splitlines():
        if line.startswith("#"):
            continue
        name = line.split("{", 1)[0].split(" ", 1)[0]
        if name != metric_name:
            continue
        try:
            total += float(line.rsplit(" ", 1)[-1])
        except ValueError:
            continue
    return total


def fetch_metrics(url: str, timeout_seconds: float) -> dict[str, float]:
    with urllib.request.urlopen(url, timeout=timeout_seconds) as response:
        text = response.read().decode("utf-8", errors="replace")
    return {
        "sidecarCalls": metric_sum(text, SIDECAR_CALLS),
        "sidecarFallbacks": metric_sum(text, SIDECAR_FALLBACKS),
    }


def request_once(
    endpoint: str,
    prompt: str,
    locale: str | None,
    timeout_seconds: float,
) -> tuple[int | None, float, str | None]:
    payload = json.dumps(
        {"model": "auto", "messages": [{"role": "user", "content": prompt}], "stream": False}
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {os.environ.get('GATELM_DEMO_API_KEY', 'glm_api_test_redacted')}",
            "Content-Type": "application/json",
            "X-GateLM-App-Token": os.environ.get(
                "GATELM_DEMO_APP_TOKEN", "glm_app_token_test_redacted"
            ),
            "X-GateLM-End-User-Id": "pii_v36_latency_user",
            "X-GateLM-Feature-Id": "pii_v36_latency",
            **({"X-GateLM-Locale": locale} if locale else {}),
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        exc.read()
        status = exc.code
    except TimeoutError:
        return None, (time.perf_counter() - started) * 1000, "timeout"
    except urllib.error.URLError:
        return None, (time.perf_counter() - started) * 1000, "transport_error"
    return status, (time.perf_counter() - started) * 1000, None


def cycle_cases(cases: list[object], count: int) -> Iterable[object]:
    for index in range(count):
        yield cases[index % len(cases)]


def run(args: argparse.Namespace) -> int:
    if args.warmup < 0 or args.requests <= 0 or args.timeout_ms <= 0:
        raise ValueError("warmup, requests, and timeout must be valid positive bounds")
    cases = load_benchmark_corpus(args.corpus)
    timeout_seconds = args.timeout_ms / 1000
    before = fetch_metrics(args.metrics_endpoint, timeout_seconds)

    warmup_failures = 0
    for case in cycle_cases(cases, args.warmup):
        status, _, error = request_once(
            args.endpoint,
            render_case_prompt(case),
            case.locale,
            timeout_seconds,
        )
        if error is not None or status not in {200, 403}:
            warmup_failures += 1

    latencies: list[float] = []
    status_counts: Counter[str] = Counter()
    error_counts: Counter[str] = Counter()
    for case in cycle_cases(cases, args.requests):
        status, latency_ms, error = request_once(
            args.endpoint,
            render_case_prompt(case),
            case.locale,
            timeout_seconds,
        )
        latencies.append(latency_ms)
        if error is not None:
            error_counts[error] += 1
        elif status is not None:
            status_counts[str(status)] += 1

    after = fetch_metrics(args.metrics_endpoint, timeout_seconds)
    successful = sum(status_counts[status] for status in ("200", "403"))
    p95 = nearest_rank(latencies, 0.95)
    sidecar_call_delta = round(after["sidecarCalls"] - before["sidecarCalls"], 3)
    fallback_delta = round(after["sidecarFallbacks"] - before["sidecarFallbacks"], 3)
    gates = {
        "allRequestsTerminal": successful == args.requests,
        "noWarmupFailure": warmup_failures == 0,
        "noTimeoutOrTransportError": not error_counts,
        "p95AtOrBelow500Ms": p95 is not None and p95 <= 500,
        "sidecarObserved": sidecar_call_delta > 0,
        "noSidecarFallback": fallback_delta == 0,
    }
    report = {
        "schemaVersion": "gatelm.pii-v36-gateway-latency.v1",
        "target": "gateway_public_chat_completion",
        "input": {
            "corpusCases": len(cases),
            "warmupRequests": args.warmup,
            "measuredRequests": args.requests,
            "timeoutMs": args.timeout_ms,
        },
        "latencyMs": {
            "p50": nearest_rank(latencies, 0.50),
            "p95": p95,
            "max": round(max(latencies), 3) if latencies else None,
        },
        "outcome": {
            "successfulRequests": successful,
            "statusCounts": dict(sorted(status_counts.items())),
            "sanitizedErrorCounts": dict(sorted(error_counts.items())),
            "warmupFailures": warmup_failures,
        },
        "sidecarMetricsDelta": {
            "calls": sidecar_call_delta,
            "fallbacks": fallback_delta,
        },
        "gates": gates,
        "status": "pass" if all(gates.values()) else "fail",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 0 if report["status"] == "pass" else 1


def main() -> int:
    return run(build_parser().parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
