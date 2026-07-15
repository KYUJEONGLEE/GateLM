"""Run local PII models and emit sanitized model-call and latency evidence."""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter


@dataclass(frozen=True)
class SmokeCase:
    case_id: str
    text: str
    expected_type: str
    marker: str
    rule_backstop_expected: bool = False


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(len(ordered) * quantile) - 1))
    return ordered[index]


def latency_summary(values: list[float]) -> dict[str, object]:
    return {
        "iterations": len(values),
        "p50Ms": round(percentile(values, 0.50), 2),
        "p95Ms": round(percentile(values, 0.95), 2),
        "maxMs": round(max(values), 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--iterations", type=int, default=20)
    args = parser.parse_args()
    if args.iterations < 1:
        raise SystemExit("--iterations must be positive")

    repo_root = Path(__file__).resolve().parents[2]
    ai_service_root = repo_root / "apps" / "ai-service"
    model_root = (
        ai_service_root
        / ".cache"
        / "onnx"
        / "releases"
        / "tenant-chat-pii-models-20260715"
    )
    sys.path.insert(0, str(ai_service_root))

    import psutil

    from app.services.ai_safety_detector import AiSafetyDetectorService
    from app.schemas.safety import AiSafetyBatchDetectRequest, AiSafetyDetectRequest

    service = AiSafetyDetectorService(
        model_id=str(model_root / "openai--privacy-filter"),
        additional_model_ids=(
            str(model_root / "amoeba04--koelectra-small-v3-privacy-ner-quantized"),
        ),
        detector_runtime="onnx",
    )
    process = psutil.Process()
    rss_before = process.memory_info().rss
    states_before = service.detector_model_states()
    warmup_started = perf_counter()
    service.warmup()
    warmup_ms = (perf_counter() - warmup_started) * 1000
    rss_after = process.memory_info().rss
    states_after = service.detector_model_states()

    cases = (
        SmokeCase(
            "synthetic_email",
            "이메일: contact@synthetic.test",
            "email",
            "contact@synthetic.test",
        ),
        SmokeCase(
            "synthetic_korean_name",
            "고객명: 홍길동에게 안내해줘",
            "person_name",
            "홍길동",
            rule_backstop_expected=True,
        ),
        SmokeCase(
            "synthetic_organization",
            "회사명: Quorivex Research",
            "organization_name",
            "Quorivex Research",
            rule_backstop_expected=True,
        ),
    )
    probe_text = (
        "Candidate record review is pending. "
        "Email: contact@synthetic.test"
    )

    results: list[dict[str, object]] = []
    observed_sources: set[str] = set()
    for case in cases:
        response = service.detect(
            AiSafetyDetectRequest(
                contractVersion="ai-safety-detector.v1",
                input={"promptText": case.text, "locale": "ko-KR"},
            )
        )
        sources = sorted(
            {
                detection.source
                for detection in response.detections
                if detection.detector_type == case.expected_type
            }
        )
        observed_sources.update(sources)
        results.append(
            {
                "caseId": case.case_id,
                "expectedDetectorType": case.expected_type,
                "actualDetectorTypes": response.detector_summary.detector_categories,
                "detected": case.expected_type
                in response.detector_summary.detector_categories,
                "redactionApplied": case.marker not in response.redacted_prompt,
                "sources": sources,
                "ruleBackstopExpected": case.rule_backstop_expected,
            }
        )

    warm_samples_ms: list[float] = []
    for _ in range(args.iterations):
        started = perf_counter()
        probe_response = service.detect(
            AiSafetyDetectRequest(
                contractVersion="ai-safety-detector.v1",
                input={"promptText": probe_text, "locale": "ko-KR"},
            )
        )
        warm_samples_ms.append((perf_counter() - started) * 1000)
        observed_sources.update(detection.source for detection in probe_response.detections)

    adapter_paths: dict[str, dict[str, object]] = {}
    for adapter in service.adapters:
        samples: list[float] = []
        for _ in range(args.iterations):
            started = perf_counter()
            adapter.detect(probe_text)
            samples.append((perf_counter() - started) * 1000)
        adapter_paths[adapter.source] = latency_summary(samples)

    sequential_samples_ms: list[float] = []
    for _ in range(args.iterations):
        started = perf_counter()
        for adapter in service.adapters:
            adapter.detect(probe_text)
        sequential_samples_ms.append((perf_counter() - started) * 1000)

    ordered_batch_probe_texts = (
        "Review synthetic email alpha.batch@synthetic.test.",
        "Review synthetic phone +82-10-0000-0001.",
        "Review synthetic resident number 900101-1234567.",
        "Review synthetic URL https://synthetic.test/private-beta.",
    )
    expected_batch_invocations = {
        "openai_privacy_filter": 1,
        "koelectra_privacy_ner": 4,
    }
    adapter_batch_comparison: dict[str, dict[str, object]] = {}
    adapter_batch_comparison_passed = True
    comparison_iterations = max(5, args.iterations)
    for adapter in service.adapters:
        # Warm both four-item execution shapes before measuring either one.
        for text in ordered_batch_probe_texts:
            adapter.detect(text)
        adapter.detect_many(
            list(ordered_batch_probe_texts),
            batch_size=len(ordered_batch_probe_texts),
        )

        sequential_measurements_ms: list[float] = []
        batch_measurements_ms: list[float] = []
        equivalent = True
        batch_invocation_counts: list[int] = []
        for iteration in range(comparison_iterations):
            if iteration % 2 == 0:
                sequential_started = perf_counter()
                sequential_detections = [
                    adapter.detect(text) for text in ordered_batch_probe_texts
                ]
                sequential_measurements_ms.append(
                    (perf_counter() - sequential_started) * 1000
                )

                batch_started = perf_counter()
                batch_detections = adapter.detect_many(
                    list(ordered_batch_probe_texts),
                    batch_size=len(ordered_batch_probe_texts),
                )
                batch_measurements_ms.append((perf_counter() - batch_started) * 1000)
            else:
                batch_started = perf_counter()
                batch_detections = adapter.detect_many(
                    list(ordered_batch_probe_texts),
                    batch_size=len(ordered_batch_probe_texts),
                )
                batch_measurements_ms.append((perf_counter() - batch_started) * 1000)

                sequential_started = perf_counter()
                sequential_detections = [
                    adapter.detect(text) for text in ordered_batch_probe_texts
                ]
                sequential_measurements_ms.append(
                    (perf_counter() - sequential_started) * 1000
                )

            sequential_signatures = [
                sorted(
                    (
                        detection.detector_type,
                        detection.start,
                        detection.end,
                        detection.source,
                    )
                    for detection in detections
                )
                for detections in sequential_detections
            ]
            batch_signatures = [
                sorted(
                    (
                        detection.detector_type,
                        detection.start,
                        detection.end,
                        detection.source,
                    )
                    for detection in detections
                )
                for detections in batch_detections.detections
            ]
            equivalent = equivalent and sequential_signatures == batch_signatures
            batch_invocation_counts.append(batch_detections.model_invocation_count)

        expected_invocations = expected_batch_invocations.get(adapter.source)
        invocation_count_matches = (
            expected_invocations is None
            or all(
                invocation_count == expected_invocations
                for invocation_count in batch_invocation_counts
            )
        )
        adapter_batch_comparison_passed = (
            adapter_batch_comparison_passed
            and equivalent
            and invocation_count_matches
        )
        adapter_batch_comparison[adapter.source] = {
            "equivalent": equivalent,
            "measurementIterations": comparison_iterations,
            "sequentialP50Ms": round(percentile(sequential_measurements_ms, 0.50), 2),
            "batchP50Ms": round(percentile(batch_measurements_ms, 0.50), 2),
            "sequentialModelInvocationCount": len(ordered_batch_probe_texts),
            "batchModelInvocationCount": batch_invocation_counts[-1],
        }

    models_loaded = bool(states_after) and all(
        state["loadState"] == "loaded" for state in states_after
    )

    batch_marker = "runtime.probe@privacy.local"
    batch_response = service.detect_batch(
        AiSafetyBatchDetectRequest.model_validate(
            {
                "contractVersion": "ai-safety-detector-batch.v1",
                "mode": "enforce",
                "inputs": [
                    {
                        "itemIndex": 0,
                        "promptText": f"email: {batch_marker}; secret reference alpha",
                        "locale": "en-US",
                    }
                ],
                "detectorConfig": {
                    "detectorSet": "privacy-filter-default",
                },
            }
        )
    )
    batch_result = batch_response.results[0]
    batch_passed = (
        batch_response.execution_summary.execution_mode == "hybrid"
        and batch_response.execution_summary.model_invocation_count >= 1
        and batch_marker not in batch_result.redacted_prompt
        and batch_marker not in batch_result.log_safe_prompt
    )
    cases_passed = all(
        bool(item["detected"]) and bool(item["redactionApplied"])
        for item in results
    )
    output = {
        "syntheticOnly": True,
        "rawPromptStored": False,
        "modelsLoaded": models_loaded,
        "modelStatesBefore": states_before,
        "modelStatesAfter": states_after,
        "modelSourcesObserved": sorted(observed_sources),
        "probeEvidence": {
            "outcome": probe_response.outcome,
            "detectorTypes": probe_response.detector_summary.detector_categories,
            "sources": sorted({detection.source for detection in probe_response.detections}),
        },
        "batchEvidence": {
            "executionMode": batch_response.execution_summary.execution_mode,
            "modelInvocationCount": (
                batch_response.execution_summary.model_invocation_count
            ),
            "acceptedModelDetectionCount": (
                batch_response.execution_summary.accepted_model_detection_count
            ),
            "outcome": batch_result.outcome,
            "maskingApplied": (
                batch_marker not in batch_result.redacted_prompt
                and batch_marker not in batch_result.log_safe_prompt
            ),
        },
        "startupWarmupMs": round(warmup_ms, 2),
        "rssBeforeMiB": round(rss_before / (1024 * 1024), 2),
        "rssAfterMiB": round(rss_after / (1024 * 1024), 2),
        "rssDeltaMiB": round((rss_after - rss_before) / (1024 * 1024), 2),
        "warmModelPath": latency_summary(warm_samples_ms),
        "adapterPaths": adapter_paths,
        "sequentialAdaptersPath": latency_summary(sequential_samples_ms),
        "adapterBatchComparison": adapter_batch_comparison,
        "cases": results,
        "passed": (
            models_loaded
            and cases_passed
            and batch_passed
            and adapter_batch_comparison_passed
        ),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    raise SystemExit(0 if output["passed"] else 1)


if __name__ == "__main__":
    main()
