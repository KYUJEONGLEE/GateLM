# Resource / Latency Benchmark Report

## 1. Purpose

이 문서는 `openai/privacy-filter` local sidecar가 노트북, CPU-only 서버, GPU 서버, quantized runtime에서 충분히 빠르게 동작하는지 판단하기 위한 측정 프로토콜과 report 양식이다.

첫 산출물은 benchmark runner 구현이 아니라 측정 기준과 report template이다.

이 문서는 Lab evidence용 기준이며 production SLA 또는 v2 공식 API/DB/Event/Metrics 계약이 아니다.

## 2. Benchmark Defaults

| Item | Default |
|---|---|
| First required runtime | `cpu_local_pipeline` |
| Comparison slots | `gpu_pipeline`, `quantized_cpu` |
| Model | `openai/privacy-filter` |
| Target endpoint | `POST /internal/ai-safety/v1/detect` or equivalent in-process harness |
| Warmup requests | 10 |
| Measured requests | 100 per runtime profile |
| Sidecar p95 candidate gate | `<= 300 ms` |
| Full safety stage good gate | `<= 800 ms` |
| Full safety stage warning band | `> 800 ms` and `<= 1200 ms` |
| Full safety stage fail gate | `> 1200 ms` |
| Timeout behavior | abandon ML result and continue with regex-only fallback |

`300 ms` and `800~1200 ms` are candidate gates for evaluation. They are not production contract values.

## 3. Runtime Profiles

| Runtime Profile | Required Now | Purpose | Result When Missing |
|---|---:|---|---|
| `cpu_local_pipeline` | yes | 노트북 또는 CPU-only 서버에서 실제 사용 가능성 확인 | `fail` if not measured |
| `gpu_pipeline` | no | GPU 서버에서 latency headroom 확인 | `not_run` |
| `quantized_cpu` | no | ONNX/int8 등 quantized 후보 비교 | `not_run` |

Record enough environment metadata to explain the result:

```text
hardware
os
pythonVersion
torchVersion
transformersVersion
modelRevision
runtimeProfile
```

## 4. Input Corpus

Use only synthetic templates. Do not use customer text, real email addresses, real phone numbers, real names, real credentials, production logs, or provider error bodies.

First benchmark corpus target: 50 templates.

| Group | Count | Purpose |
|---|---:|---|
| `short_safe` | 10 | 짧고 개인정보 없는 일반 문장 |
| `long_safe` | 10 | 1k~2k chars 긴 문장 |
| `pii_en` | 10 | email, phone, person name 후보 포함 |
| `pii_ko` | 10 | 한국어 이름, 전화, 주소, 날짜 후보 포함 |
| `mixed_edge` | 10 | 반복, 괄호/공백, 여러 detector, no-PII mixed |

The report may store `caseId`, `caseGroup`, and `inputLengthBucket`. It must not store the prompt template or rendered prompt.

Suggested length buckets:

| Bucket | Meaning |
|---|---|
| `short` | `< 200 chars` |
| `medium` | `200~999 chars` |
| `long` | `1000~2000 chars` |
| `very_long` | `> 2000 chars` |

## 5. Measurement Protocol

1. Load the model and record cold start / model load latency separately.
2. Run 10 warmup requests. Exclude warmup measurements from percentile calculations.
3. Run 100 measured requests per runtime profile, cycling through the synthetic corpus.
4. Record primary sidecar latency from response `latencyMs` when using the endpoint.
5. Record secondary client-observed latency around the request or in-process call.
6. Use nearest-rank percentile calculation for p50 and p95.
7. Apply the `300 ms` sidecar timeout candidate during timeout scenario runs.
8. When timeout occurs, record `sidecarOutcome=timeout` and `fallbackMode=regex_only`.
9. Do not record raw prompt, raw detected value, raw span, raw model `word`, raw response, raw error body, hashes, request IDs, or trace IDs in the report.

Percentile calculation:

```text
sort ascending
rank = ceil(percentile * sample_count)
value = sorted[rank - 1]
```

## 6. Decision Gates

| Gate | Pass | Warn | Fail |
|---|---|---|---|
| Sidecar latency | p95 sidecar `<= 300 ms` | p95 sidecar `> 300 ms` but fallback works | p95 sidecar `> 300 ms` and fallback missing |
| Full safety stage | p95 full safety `<= 800 ms` | p95 full safety `> 800 ms` and `<= 1200 ms` | p95 full safety `> 1200 ms` |
| Timeout fallback | timeout count equals regex-only fallback count | partial fallback evidence | timeout path leaks raw value or fails request unexpectedly |
| Raw value exposure | no forbidden content in report | manual review needed | raw prompt/value/span/model word/error body present |

Recommended initial decision:

```text
sidecar p95 <= 300ms -> keep ML sidecar candidate
sidecar p95 > 300ms -> shadow unavailable, regex-only fallback for runtime path
full safety p95 > 1200ms -> do not promote ML sidecar to enforce path
```

## 7. Report Template

Use this Markdown template for future measured reports at `reports/ai-safety-lab/resource-latency-benchmark.md`.

```md
# Resource / Latency Benchmark Report

## Run Metadata
- runId:
- date:
- gitSha:
- modelId: openai/privacy-filter
- modelRevision:
- runtimeProfile:
- hardware:
- os:
- pythonVersion:
- torchVersion:
- transformersVersion:
- warmupRequests:
- measuredRequests:

## Decision Summary
| Gate | Result | Evidence |
|---|---|---|
| sidecar p95 <= 300ms | pass/warn/fail | p95SidecarLatencyMs |
| full safety stage <= 800~1200ms | pass/warn/fail | p95FullSafetyStageMs |
| timeout fallback works | pass/fail | timeoutCount + regexOnlyFallbackCount |
| raw value exposure | pass/fail | no raw prompt/value/span in report |

## Latency Summary
| Runtime | p50 sidecar | p95 sidecar | p50 full safety | p95 full safety | timeout rate |
|---|---:|---:|---:|---:|---:|

## Case Group Summary
| Group | requests | p50 | p95 | max | timeoutCount | fallbackCount |
|---|---:|---:|---:|---:|---:|---:|

## Resource Summary
| Runtime | peakRssMb | avgCpuPct | peakGpuMemoryMb | notes |
|---|---:|---:|---:|---|

## Fallback Recommendation
- If sidecar p95 <= 300ms:
- If sidecar p95 > 300ms:
- If full safety p95 > 1200ms:
- Recommended production posture:

## Raw Value Safety Check
- Report stores no raw prompts.
- Report stores no raw detected values.
- Report stores no offsets/spans.
- Report stores no raw model `word`.
- Report stores no raw error bodies.
```

## 8. Draft JSON Shape

The JSON report shape is a runner candidate, not a locked schema.

```json
{
  "metadata": {
    "runId": "",
    "date": "",
    "gitSha": "",
    "modelId": "openai/privacy-filter",
    "modelRevision": "",
    "warmupRequests": 10,
    "measuredRequests": 100
  },
  "runtimeResults": [
    {
      "runtimeProfile": "cpu_local_pipeline",
      "status": "pass",
      "p50SidecarLatencyMs": 0,
      "p95SidecarLatencyMs": 0,
      "p50FullSafetyStageMs": 0,
      "p95FullSafetyStageMs": 0,
      "timeoutRate": 0
    }
  ],
  "caseGroupResults": [
    {
      "caseGroup": "short_safe",
      "requests": 0,
      "p50LatencyMs": 0,
      "p95LatencyMs": 0,
      "maxLatencyMs": 0,
      "timeoutCount": 0,
      "fallbackCount": 0
    }
  ],
  "decisionSummary": {
    "sidecarLatencyGate": "pass",
    "fullSafetyStageGate": "pass",
    "timeoutFallbackGate": "pass",
    "rawValueExposureGate": "pass"
  },
  "fallbackRecommendation": {
    "sidecarP95Under300Ms": "",
    "sidecarP95Over300Ms": "",
    "fullSafetyP95Over1200Ms": "",
    "recommendedProductionPosture": ""
  }
}
```

Allowed report values are sanitized aggregates only. Do not add prompt text, prompt template, detected raw value, raw span, model `word`, request IDs, trace IDs, sample hashes, or raw error bodies.

## 9. Acceptance Checklist

```text
[ ] CPU-only local sidecar benchmark ran 100 measured requests.
[ ] Cold start/model load latency is recorded separately.
[ ] Warmup requests are excluded from p50/p95.
[ ] p50/p95 calculation is nearest-rank and reproducible.
[ ] GPU runtime is either measured or marked not_run.
[ ] Quantized runtime is either measured or marked not_run.
[ ] Timeout scenario records sidecarOutcome=timeout.
[ ] Timeout scenario records fallbackMode=regex_only.
[ ] Report contains no raw prompt.
[ ] Report contains no raw detected value.
[ ] Report contains no raw span or offset.
[ ] Report contains no raw model word.
[ ] Report contains no raw error body.
[ ] Report states that benchmark evidence is not a production SLA.
```
