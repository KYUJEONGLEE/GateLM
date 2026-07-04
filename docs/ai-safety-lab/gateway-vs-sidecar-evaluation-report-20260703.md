# Gateway vs AI Service Sidecar Evaluation Report

## Scope

This report compares the current Gateway AI safety path with the ai-service sidecar path using the same AI Safety Lab resource-latency benchmark corpus.

This is local evidence only, not a production SLA.

## Answer To The Design Question

The sidecar owns local detector execution while Gateway owns orchestration and fail-open behavior.

The ai-service sidecar owns the detector endpoint:

- fast rule / regex signals
- primary `openai/privacy-filter` adapter
- additional KoELECTRA privacy NER adapter
- sanitized sidecar response contract

The Gateway owns the request hot path:

- Gateway auth and runtime policy
- local P0 masking fallback
- sidecar call when enabled
- sidecar timeout/error fail-open to the local masking result
- budget/routing/cache/provider/logging behavior

In these runs, the observed difference is Gateway orchestration and fail-open behavior around the detector sidecar.

## Runner Change

The benchmark runner now supports:

```text
--target gateway_http
```

This target sends the benchmark corpus through Gateway `/v1/chat/completions`. It does not write request credentials, raw prompts, raw detected values, raw offsets, raw model token text, or raw response bodies to the report.

For `gateway_http`, the generated runner field named `sidecarLatencyMs` represents Gateway-reported `gate_lm.latencyMs` when present, with wall latency as a fallback for blocked/error response shapes. Use `fullSafetyStageMs` for the externally observed Gateway request latency.

## Environment

| Field | Value |
|---|---|
| Date | 2026-07-03 |
| Git SHA | `e0ff999` |
| OS | Windows 11 `10.0.26200` |
| Python | `3.13.14` |
| Torch | `2.12.1` |
| Transformers | `4.57.6` |
| Corpus | `docs/ai-safety-lab/fixtures/resource-latency-benchmark-corpus.jsonl` |
| Warmup requests | `10` |
| Measured requests | `100` |
| Timeout candidate | `300 ms` |
| Request timeout | `5000 ms` |

## Commands

Sidecar HTTP, Transformers runtime:

```powershell
python -m app.services.ai_safety_latency_benchmark_runner `
  --target http `
  --endpoint-url http://127.0.0.1:8001/internal/ai-safety/v1/detect `
  --runtime-profile cpu_local_pipeline `
  --timeout-ms 300 `
  --request-timeout-ms 5000 `
  --warmup-requests 10 `
  --measured-requests 100 `
  --run-id sidecar-http-20260703 `
  --model-id openai/privacy-filter `
  --no-fail-on-gate
```

Sidecar HTTP, ONNX runtime:

```powershell
python -m app.services.ai_safety_latency_benchmark_runner `
  --target http `
  --endpoint-url http://127.0.0.1:8002/internal/ai-safety/v1/detect `
  --runtime-profile quantized_cpu `
  --timeout-ms 300 `
  --request-timeout-ms 5000 `
  --warmup-requests 10 `
  --measured-requests 100 `
  --run-id sidecar-onnx-http-20260703 `
  --model-id openai/privacy-filter `
  --no-fail-on-gate
```

Gateway HTTP, ONNX sidecar enabled:

```powershell
python -m app.services.ai_safety_latency_benchmark_runner `
  --target gateway_http `
  --endpoint-url http://127.0.0.1:8080/v1/chat/completions `
  --runtime-profile quantized_cpu `
  --timeout-ms 300 `
  --request-timeout-ms 5000 `
  --warmup-requests 10 `
  --measured-requests 100 `
  --run-id gateway-http-20260703 `
  --model-id openai/privacy-filter `
  --gateway-model auto `
  --no-fail-on-gate
```

## Summary

| Target | Runtime | Status | Success | Errors | Timeouts | p50 full ms | p95 full ms | p50 reported ms | p95 reported ms |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| sidecar HTTP | Transformers | fail | 58 | 36 | 6 | 861 | 5597 | 1 | 5 |
| sidecar HTTP | ONNX | fail | 58 | 41 | 1 | 329 | 377 | 0 | 3 |
| Gateway HTTP | ONNX sidecar | pass | 100 | 0 | 0 | 344 | 532 | 17 | 173 |

## Case Group Summary

| Target | Group | p50 full ms | p95 full ms | max ms | timeouts |
|---|---|---:|---:|---:|---:|
| sidecar ONNX | short_safe | 312 | 337 | 368 | 0 |
| sidecar ONNX | long_safe | 332 | 369 | 374 | 0 |
| sidecar ONNX | pii_en | 340 | 4946 | 5350 | 1 |
| sidecar ONNX | pii_ko | 337 | 377 | 401 | 0 |
| sidecar ONNX | mixed_edge | 324 | 361 | 370 | 0 |
| Gateway ONNX sidecar | short_safe | 329 | 366 | 398 | 0 |
| Gateway ONNX sidecar | long_safe | 326 | 534 | 553 | 0 |
| Gateway ONNX sidecar | pii_en | 362 | 545 | 546 | 0 |
| Gateway ONNX sidecar | pii_ko | 341 | 501 | 506 | 0 |
| Gateway ONNX sidecar | mixed_edge | 352 | 522 | 565 | 0 |

## Interpretation

Gateway passed because it treats sidecar timeout/error as unavailable and falls back to the local P0 masking result. That is good for availability, but it also means this run does not prove that `openai/privacy-filter` successfully executed for every Gateway request.

The sidecar direct runs show the current local model/runtime issue clearly:

- Transformers runtime cannot load the local `openai/privacy-filter` checkpoint with this installed Transformers version.
- ONNX runtime still returns sidecar errors for ML-triggering paths because the local artifact/tokenizer combination is not fully usable in this environment.
- KoELECTRA additional detector is configured, but the primary model/runtime failure prevents a clean all-model sidecar pass.

Gateway observed latency is higher than sidecar direct reported latency because Gateway includes request orchestration, routing/cache/provider work, and mock provider latency. Its external p95 stayed under the 800 ms full-stage gate in this local run.

## Conclusion

Current Gateway wiring is operational and availability-safe, but the current local `openai/privacy-filter` runtime is not healthy enough to claim full ML detector performance.

Recommended next step:

- Fix or replace the local `openai/privacy-filter` artifact/runtime so the sidecar direct benchmark has zero `http_500` and zero timeout at the selected request timeout.
- Re-run sidecar and Gateway benchmarks after that fix.
- Keep Gateway fail-open behavior, but expose a sanitized sidecar-unavailable count in evaluation evidence so a passing Gateway run cannot hide detector runtime failures.

## Evidence Files

| Evidence | Path |
|---|---|
| Sidecar Transformers report | `reports/ai-safety-lab/sidecar-http-20260703/resource-latency-benchmark.md` |
| Sidecar ONNX report | `reports/ai-safety-lab/sidecar-onnx-http-20260703/resource-latency-benchmark.md` |
| Gateway ONNX sidecar report | `reports/ai-safety-lab/gateway-http-20260703/resource-latency-benchmark.md` |

## Safety Check

- No source input text is stored in this report.
- No detected sensitive value is stored in this report.
- No raw source offsets are stored in this report.
- No raw model token text is stored in this report.
- No request credentials are stored in this report.
- No raw provider or sidecar error body is stored in this report.
