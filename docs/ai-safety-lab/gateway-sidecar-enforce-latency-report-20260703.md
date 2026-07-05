# Gateway Sidecar Enforce / ONNX Latency Report

## Scope

This report captures local evidence for moving AI Safety Lab detector results into the Gateway request path as an enforce gate.

It includes:

- Gateway public-path sidecar enforce smoke with the real local ai-service.
- ONNX and quantized ONNX in-process latency measurements for current ai-service detector behavior.

This is local evidence only, not a production SLA.

## Environment

| Field | Value |
|---|---|
| Date | 2026-07-03 |
| Branch | `feat/NER-PII-detector-update` |
| Gateway test runtime | `gatelm-go-toolbox` / Go `1.24.13` |
| ai-service Python | `3.13.14` |
| OS | Windows 11 `10.0.26200` |
| ONNX artifact | `.cache/onnx/amoeba04--koelectra-small-v3-privacy-ner` |
| Quantized ONNX artifact | `.cache/onnx/amoeba04--koelectra-small-v3-privacy-ner-quantized` |
| Warmup per scenario | `20` requests |
| Measured per scenario | `100` requests |

## Gateway Enforce Smoke

The Gateway ran with:

```text
GATEWAY_AI_SAFETY_SIDECAR_ENABLED=true
GATEWAY_AI_SAFETY_SIDECAR_URL=http://host.docker.internal:8001/internal/ai-safety/v1/detect
GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS=300
```

Smoke result:

| Scenario | Expected Gateway effect | HTTP | Masking action | Provider calls | Raw value leaked |
|---|---|---:|---|---:|---|
| sidecar-only redaction | provider receives redacted prompt | `200` | `redacted` | `1` | `false` |
| sidecar-only block | provider/cache/streaming bypass | `403` | `blocked` | `0` | `false` |

## Latency Summary

Wall latency uses the outer service-call timer. Reported latency uses the response `latencyMs` field, which is integer-rounded.

| Scenario | Runtime | Outcome | Model loaded after cold call | Cold wall ms | Warm wall p50 ms | Warm wall p95 ms | Reported p50 ms | Reported p95 ms |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `cheap_label_person_rule_only` | ONNX configured, ML skipped | `redacted` | `false` | `2.25` | `0.39` | `0.48` | `0` | `0` |
| `deterministic_rule_only_email_phone_auth` | ONNX configured, ML skipped | `blocked` | `false` | `0.39` | `0.28` | `0.36` | `0` | `0` |
| `long_safe_rule_only_no_candidates` | ONNX configured, ML skipped | `passed` | `false` | `5.59` | `5.84` | `6.57` | `6` | `6` |
| `ml_title_case_candidate_onnx` | ONNX ML path | `redacted` | `true` | `34777.52` | `7.21` | `8.98` | `7` | `9` |
| `ml_title_case_candidate_quantized_onnx` | Quantized ONNX ML path | `passed` | `true` | `335.55` | `6.95` | `9.68` | `7` | `10` |

## Effect Summary

For the label-based person-name case handled by cheap pass:

| Comparison | Cold wall saved | Warm p50 saved | Warm p95 saved | Warm p50 speedup | Warm p95 speedup |
|---|---:|---:|---:|---:|---:|
| cheap rule-only vs ONNX ML | `34775.27 ms` | `6.82 ms` | `8.50 ms` | `18.5x` | `18.7x` |
| cheap rule-only vs quantized ONNX ML | `333.30 ms` | `6.56 ms` | `9.20 ms` | `17.8x` | `20.2x` |

## Interpretation

The enforce-path win is mostly from not calling ML when deterministic rule signals already cover the sensitive span. The Gateway can enforce ai-service results before provider/cache/streaming, while the ai-service keeps rule-only paths sub-millisecond for short deterministic inputs.

Quantized ONNX remains useful when ML must run, mainly by reducing cold-start cost relative to the non-quantized ONNX path. Warm p50/p95 are close in this local run.

## Caveats

- ONNX cold latency includes first-time import/session initialization in the Python process. Use warm p50/p95 for steady-state comparison.
- Quantized cold latency was measured after the ONNX stack had already been imported in the same benchmark process, so compare cold numbers carefully.
- Gateway E2E smoke used fast rule detector inputs to verify enforce behavior without forcing model load during the smoke.
- This report stores aggregate results and sanitized scenario labels only.

## Safety Check

- No source input text is stored in this report.
- No detected sensitive value is stored in this report.
- No source position data is stored in this report.
- No model token text is stored in this report.
- No provider raw error body is stored in this report.
