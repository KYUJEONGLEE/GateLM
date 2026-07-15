# 리소스 / 지연시간 벤치마크 리포트

## 1. 목적

이 문서는 `openai/privacy-filter` local sidecar가 노트북 CPU-only 환경, GPU 서버, quantized runtime에서 충분히 빠르게 동작하는지 판단하기 위한 측정 프로토콜과 리포트 양식이다.

Benchmark runner는 `apps/ai-service/app/services/ai_safety_latency_benchmark_runner.py`에 둔다. 이 문서는 runner의 측정 기준과 리포트 템플릿을 정의한다.

이 문서는 AI Safety Lab evidence를 위한 보조 문서이며 production SLA나 v2 공식 API, DB, Event, Metrics 계약이 아니다.

## 2. 기본 기준

| 항목 | 기본값 |
|---|---|
| 첫 필수 런타임 | `cpu_local_pipeline` |
| 비교 슬롯 | `gpu_pipeline`, `quantized_cpu` |
| 모델 | `openai/privacy-filter` |
| 측정 대상 | `POST /internal/ai-safety/v1/detect` 또는 동일 service in-process harness |
| Warmup 요청 수 | 10 |
| 측정 요청 수 | runtime profile별 100회 |
| Sidecar p95 목표 후보 | `<= 300 ms` |
| Measured target latency good 기준 후보 | `<= 800 ms` |
| Measured target latency warning 구간 후보 | `> 800 ms` 그리고 `<= 1200 ms` |
| Measured target latency fail 기준 후보 | `> 1200 ms` |
| Timeout 동작 | caller timeout과 실제 Gateway fallback을 별도 관측; 추정 금지 |

`300 ms`와 `800~1200 ms`는 평가용 후보 gate이며 production 계약값으로 확정하지 않는다.

기본 실행 명령:

```powershell
cd apps/ai-service
python -m app.services.ai_safety_latency_benchmark_runner `
  --target http `
  --endpoint-url http://127.0.0.1:8001/internal/ai-safety/v1/detect `
  --runtime-profile cpu_local_pipeline `
  --timeout-ms 300 `
  --request-timeout-ms 3000 `
  --artifact-verification <artifact-verification-json> `
  --corpus ../../docs/ai-safety-lab/fixtures/resource-latency-benchmark-corpus.jsonl `
  --out ../../reports/ai-safety-lab
```

Production promotion evidence로 사용할 때는 checksum verifier가 만든 `pii-artifact-verification.v1` 파일을 `--artifact-verification`으로 반드시 전달한다. Runner는 성공한 파일 count와 nested `evidenceBinding`을 검증하고 report root에 복사한다. `metadata.gitSha`는 binding의 lowercase full Git object ID와 같아야 한다. `--evidence-binding` 직접 입력은 격리 테스트용이며 checksum 성공을 runner가 추정하지 않는다.

## 3. 런타임 프로파일

| Runtime Profile | 지금 필수 여부 | 목적 | 측정하지 못한 경우 |
|---|---:|---|---|
| `cpu_local_pipeline` | yes | 노트북 또는 CPU-only 서버에서 실제 사용 가능성 확인 | `fail` |
| `gpu_pipeline` | no | GPU 서버에서 latency headroom 확인 | `not_run` |
| `quantized_cpu` | no | ONNX/int8 등 quantized 후보 비교 | `not_run` |

결과 해석에 필요한 환경 정보는 최소한 아래 항목을 기록한다.

```text
hardware
os
pythonVersion
torchVersion
transformersVersion
modelRevision
runtimeProfile
```

## 4. 입력 코퍼스

입력은 synthetic template만 사용한다. 고객 문장, 실제 이메일, 실제 전화번호, 실제 이름, 실제 credential, production log, provider raw error body를 사용하지 않는다.

첫 benchmark corpus 기준은 50개 template이다.

| 그룹 | 개수 | 목적 |
|---|---:|---|
| `short_safe` | 10 | 짧고 개인정보 없는 일반 문장 |
| `long_safe` | 10 | 1k~2k chars 긴 문장 |
| `pii_en` | 10 | email, phone, person name 후보 포함 |
| `pii_ko` | 10 | 한국어 이름, 전화, 주소, 날짜 후보 포함 |
| `mixed_edge` | 10 | 반복, 괄호/공백, 여러 detector, no-PII mixed |

리포트에는 `caseId`, `caseGroup`, `inputLengthBucket`만 저장할 수 있다. prompt template이나 렌더링된 전체 prompt는 저장하지 않는다.

권장 길이 bucket:

| Bucket | 의미 |
|---|---|
| `short` | `< 200 chars` |
| `medium` | `200~999 chars` |
| `long` | `1000~2000 chars` |
| `very_long` | `> 2000 chars` |

## 5. 측정 절차

1. 모델을 로드하고 cold start / model load latency를 별도로 기록한다.
2. Warmup 요청 10회를 실행한다. Warmup 측정값은 percentile 계산에서 제외한다.
3. Runtime profile별 측정 요청 100회를 실행한다. Synthetic corpus를 순환하며 사용한다.
4. Direct sidecar endpoint 또는 in-process target만 response의 `latencyMs`를 sidecar latency로 기록한다.
5. 요청 바깥에서 잰 wall-clock 값은 `targetLatencyMs`다. Gateway 전체 응답 시간은 sidecar latency로 재표기하지 않는다.
6. p50과 p95는 nearest-rank 방식으로 계산한다.
7. Timeout scenario에서는 `300 ms` sidecar timeout 후보를 적용한다.
8. Direct sidecar timeout은 `sidecarOutcome=timeout`, `fallbackObservation=not_observed`로 기록한다. Gateway timeout은 sidecar 결과 자체가 `unobserved`다.
9. 리포트에는 raw prompt, raw detected value, raw span, raw model `word`, raw response, raw error body, hash, request ID, trace ID를 기록하지 않는다.
10. Gateway의 200/403 응답만으로 sidecar 성공 또는 fallback 성공을 추정하지 않는다. 별도 bounded telemetry가 없으면 sidecar와 fallback을 모두 `not_observed`로 남긴다.

Percentile 계산 방식:

```text
오름차순 정렬
rank = ceil(percentile * sample_count)
value = sorted[rank - 1]
```

## 6. 판단 게이트

| Gate | Pass 기준 | Warn 기준 | Fail 기준 |
|---|---|---|---|
| Sidecar latency | 실제 관측된 p95 sidecar `<= 300 ms`, timeout 0 | 관측된 timeout마다 fallback 증거가 있음 | sidecar latency 미관측, 기준 초과 또는 fallback 근거 없음 |
| Measured target latency | p95 target `<= 800 ms` | p95 target `> 800 ms` 그리고 `<= 1200 ms` | p95 target `> 1200 ms` |
| Timeout fallback | 관측된 sidecar timeout마다 실제 regex-only fallback이 관측됨 | timeout scenario 미실행 | timeout이 있지만 fallback은 추정 또는 미관측 |
| Evidence completeness | 모든 sample의 sidecar 실행 결과가 직접 또는 bounded telemetry로 관측됨 | 없음 | Gateway total latency/상태만 있고 sidecar 결과가 미관측 |
| Raw value exposure | report에 금지된 내용 없음 | 수동 검토 필요 | raw prompt/value/span/model word/error body 존재 |

초기 권장 판단:

```text
sidecar p95 <= 300ms -> ML sidecar 후보 유지
sidecar p95 > 300ms -> shadow unavailable로 보고 runtime path는 regex-only fallback
measured target p95 > 1200ms -> ML sidecar를 enforce path로 승격하지 않음
```

## 7. 리포트 템플릿

실제 측정 리포트는 runner가 `reports/ai-safety-lab/resource-latency-benchmark.md`에 아래 양식으로 작성한다.

```md
# 리소스 / 지연시간 벤치마크 리포트

## 실행 메타데이터
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

## 판단 요약
| Gate | 결과 | 근거 |
|---|---|---|
| sidecar p95 <= 300ms | pass/warn/fail | p95SidecarLatencyMs |
| measured target p95 <= 800~1200ms | pass/warn/fail | p95TargetLatencyMs |
| timeout fallback 관측 | pass/fail/not_exercised | timeoutCount + observedFallbackCount |
| sidecar evidence completeness | pass/fail | unobservedSidecarCount |
| raw value 노출 여부 | pass/fail | report에 raw prompt/value/span 없음 |

## 지연시간 요약
| Runtime | p50 sidecar | p95 sidecar | p50 target | p95 target | timeout rate |
|---|---:|---:|---:|---:|---:|

## Case Group 요약
| Group | requests | p50 target | p95 target | max target | timeoutCount | observedFallbackCount | unobservedSidecarCount |
|---|---:|---:|---:|---:|---:|---:|---:|

## 리소스 요약
| Runtime | peakRssMb | avgCpuPct | peakGpuMemoryMb | notes |
|---|---:|---:|---:|---|

## Fallback 권장안
- sidecar p95 <= 300ms인 경우:
- sidecar p95 > 300ms인 경우:
- measured target p95 > 1200ms인 경우:
- 권장 production posture:

## Raw Value 안전성 확인
- Report에 raw prompt가 없다.
- Report에 raw detected value가 없다.
- Report에 offset/span이 없다.
- Report에 raw model `word`가 없다.
- Report에 raw error body가 없다.
```

## 8. JSON 결과 초안

JSON 리포트 shape는 runner 후보이며 아직 locked schema가 아니다.

```json
{
  "evidenceBinding": {
    "schemaVersion": "pii-promotion-evidence-binding.v1",
    "manifestVersion": "<manifest-version>",
    "modelRevisions": {"<model-id>": "<immutable-model-revision>"},
    "artifactChecksumsVerified": true,
    "gitRevision": "<full-lowercase-git-object-id>"
  },
  "metadata": {
    "reportVersion": "ai-safety-resource-latency-benchmark.v2",
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
      "p50TargetLatencyMs": 0,
      "p95TargetLatencyMs": 0,
      "observedFallbackCount": 0,
      "unobservedFallbackCount": 0,
      "unobservedSidecarCount": 0,
      "sidecarObservationCounts": {"observed": 100},
      "fallbackObservationCounts": {"not_applicable": 100},
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
      "observedFallbackCount": 0,
      "unobservedSidecarCount": 0
    }
  ],
  "decisionSummary": {
    "sidecarLatencyGate": "pass",
    "targetLatencyGate": "pass",
    "timeoutFallbackGate": "not_exercised",
    "evidenceCompletenessGate": "pass",
    "rawValueExposureGate": "pass"
  },
  "fallbackRecommendation": {
    "sidecarP95Under300Ms": "",
    "sidecarP95Over300Ms": "",
    "targetP95Over1200Ms": "",
    "recommendedProductionPosture": ""
  }
}
```

허용되는 report value는 sanitized aggregate뿐이다. Prompt text, prompt template, raw detected value, raw span, model `word`, request ID, trace ID, sample hash, raw error body를 추가하지 않는다.

## 9. 승인 체크리스트

```text
[ ] CPU-only local sidecar benchmark가 measured request 100회를 실행했다.
[ ] Cold start/model load latency를 별도로 기록했다.
[ ] Warmup request를 p50/p95 계산에서 제외했다.
[ ] p50/p95 계산 방식은 nearest-rank이며 재현 가능하다.
[ ] GPU runtime은 측정했거나 not_run으로 명확히 표시했다.
[ ] Quantized runtime은 측정했거나 not_run으로 명확히 표시했다.
[ ] Direct sidecar timeout은 sidecarOutcome=timeout을 기록한다.
[ ] Direct timeout만으로 Gateway fallback을 추정하지 않는다.
[ ] Gateway target latency를 sidecar latency로 기록하지 않는다.
[ ] Gateway fallback 검증은 bounded telemetry로 실제 관측한다.
[ ] Report에 raw prompt가 없다.
[ ] Report에 raw detected value가 없다.
[ ] Report에 raw span 또는 offset이 없다.
[ ] Report에 raw model word가 없다.
[ ] Report에 raw error body가 없다.
[ ] Report가 benchmark evidence이며 production SLA가 아니라고 명시한다.
```
