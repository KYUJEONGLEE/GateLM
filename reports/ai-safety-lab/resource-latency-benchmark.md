# Resource / Latency Benchmark Report

## Run Metadata
- runId: `ai-safety-latency-ba5fae7481f3`
- date: `2026-07-01T06:27:50.485019Z`
- gitSha: `0e8e0fb`
- modelId: `openai/privacy-filter`
- modelRevision: `7ffa9a043d54d1be65afb281eddf0ffbe629385b`
- runtimeProfile: `cpu_local_pipeline`
- target: `http`
- hardware: `AMD64`
- os: `Windows-11-10.0.26200-SP0`
- pythonVersion: `3.13.14`
- torchVersion: `2.12.1`
- transformersVersion: `5.13.0.dev0`
- warmupRequests: `10`
- measuredRequests: `100`

## Decision Summary
| Gate | Result | Evidence |
|---|---|---|
| sidecar p95 <= 300ms | warn | p95SidecarLatencyMs=2001 |
| full safety stage <= 800~1200ms | fail | p95FullSafetyStageMs=2423 |
| timeout fallback works | pass | timeoutCount=0, regexOnlyFallbackCount=0 |
| raw value exposure | pass | sanitized aggregate fields only |

## Latency Summary
| Runtime | p50 sidecar | p95 sidecar | p50 full safety | p95 full safety | timeout rate |
|---|---:|---:|---:|---:|---:|
| cpu_local_pipeline | 248 | 2001 | 653 | 2423 | 0.0 |
| gpu_pipeline | None | None | None | None | 0.0 |
| quantized_cpu | None | None | None | None | 0.0 |

## Case Group Summary
| Group | requests | p50 | p95 | max | timeoutCount | fallbackCount |
|---|---:|---:|---:|---:|---:|---:|
| short_safe | 20 | 553 | 635 | 713 | 0 | 0 |
| long_safe | 20 | 2394 | 2601 | 2662 | 0 | 0 |
| pii_en | 20 | 607 | 686 | 719 | 0 | 0 |
| pii_ko | 20 | 683 | 795 | 829 | 0 | 0 |
| mixed_edge | 20 | 649 | 727 | 731 | 0 | 0 |

## Resource Summary
| Runtime | peakRssMb | avgCpuPct | peakGpuMemoryMb | notes |
|---|---:|---:|---:|---|
| cpu_local_pipeline | 2936.43 | 1054.2 | None | sampled_process;gpu_not_collected |
| gpu_pipeline | None | None | None | not_run |
| quantized_cpu | None | None | None | not_run |

## Fallback Recommendation
- If sidecar p95 <= 300ms: `not_applicable`
- If sidecar p95 > 300ms: `mark_shadow_unavailable_and_use_regex_only_fallback`
- If full safety p95 > 1200ms: `do_not_promote_ml_sidecar_to_enforce_path`
- Recommended production posture: `evidence_only`

## Raw Value Safety Check
- Report stores no source input text.
- Report stores no detected sensitive value.
- Report stores no raw location data.
- Report stores no raw model token text.
- Report stores no raw error body.
