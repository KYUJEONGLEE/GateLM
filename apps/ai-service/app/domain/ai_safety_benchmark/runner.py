from __future__ import annotations

from itertools import cycle, islice

from app.domain.ai_safety_benchmark.corpus import render_case_prompt
from app.domain.ai_safety_benchmark.resources import ResourceSampler
from app.domain.ai_safety_benchmark.targets import BenchmarkTarget
from app.domain.ai_safety_benchmark.types import BenchmarkCase, BenchmarkSample


def run_benchmark(
    *,
    cases: list[BenchmarkCase],
    target: BenchmarkTarget,
    runtime_profile: str,
    warmup_requests: int,
    measured_requests: int,
    timeout_ms: int,
    resource_sampler: ResourceSampler,
) -> list[BenchmarkSample]:
    for case in islice(cycle(cases), warmup_requests):
        target.detect(render_case_prompt(case), locale=case.locale, timeout_ms=timeout_ms)

    samples: list[BenchmarkSample] = []
    resource_sampler.start()
    for case in islice(cycle(cases), measured_requests):
        result = target.detect(render_case_prompt(case), locale=case.locale, timeout_ms=timeout_ms)
        resource_sampler.sample()
        samples.append(
            BenchmarkSample(
                case_id=case.case_id,
                case_group=case.case_group,
                input_length_bucket=case.input_length_bucket,
                runtime_profile=runtime_profile,
                sidecar_latency_ms=result.sidecar_latency_ms,
                full_safety_latency_ms=result.full_safety_latency_ms,
                sidecar_outcome=result.sidecar_outcome,
                fallback_mode=result.fallback_mode,
                sanitized_error_code=result.sanitized_error_code,
            )
        )
    return samples
