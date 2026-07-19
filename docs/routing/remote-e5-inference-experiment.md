# Remote E5 Inference Promotion Record

| Field | Value |
|---|---|
| Status | Accepted production architecture; active semantics are in `contracts.md` |
| Branch | `feat/remote-e5-inference-experiment` |
| Baseline | Local Gateway E5 106D hot path |
| Promotion rule | Gateway resource isolation, deterministic model identity, safe fallback and remote coverage are the primary gates |
| Last updated | 2026-07-20 |

## Why This Experiment Exists

Gateway 한 대, 4 vCPU, Mock Provider 100ms, 150 RPS, 60초 조건에서 로컬 E5를 켠 기준선은 Gateway CPU 평균/최대 `96.934% / 100%`, `decide_model_route` 평균 `21.552ms`, HTTP p95 `139.684ms`였다. 같은 조건에서 E5만 끄면 Gateway CPU 평균/최대 `5.659% / 8.142%`, `decide_model_route` 평균 `0.189ms`, HTTP p95 `105.910ms`였다.

두 실행 모두 9,001건 완료, dropped iteration 0, HTTP failure 0이므로 이 결과는 현재 로컬 E5가 Gateway CPU 병목이라는 진단 근거다. 이 수치는 150 RPS에서의 A/B 진단이며 최종 용량이나 운영 SLA 주장이 아니다.

## Boundary Under Test

외부 `/v1/chat/completions`, RuntimeSnapshot routing policy, Provider 선택 결과의 의미는 바꾸지 않는다. 실험을 켠 경우에만 Gateway가 PII 마스킹 이후의 bounded instruction text와 정확한 `difficulty-feature-vector.v1` 42차원 벡터를 private AI Service에 보낸다.

```text
Gateway
  category + 42D rule vector
  -> private authenticated HTTP
AI Service
  E5 tokenizer -> QInt8 ONNX -> 384D pooled -> PCA 64D
  -> frozen 106D Logistic + Platt + threshold
  -> simple | complex only
Gateway
  existing 5 x 2 matrix -> Provider/model selection
```

AI Service는 embedding, score, token, instruction text를 응답·로그·metric에 남기지 않는다. 응답은 `simple | complex`, 고정 model version, content hash만 포함한다. Timeout, 429, transport failure, invalid response에서는 해당 요청만 기존 rule difficulty를 유지한다.

실험 플래그가 켜진 동안 Gateway는 원문 없는 집계 전용 metric인 `gatelm_routing_difficulty_remote_total{status}`와 `gatelm_routing_difficulty_remote_duration_seconds{status}`를 노출한다. `status`는 기존 bounded difficulty 상태 집합만 사용한다. 이 metric도 active Metrics contract가 아니라 A/B 판정용 실험 관측 경계다.

## Active Private Internal API

이 API는 외부 제품 surface가 아니라 Gateway와 private AI Service 사이의 active internal contract다. 의미 계약의 최종 기준은 [`contracts.md`](contracts.md)다.

- Method: `POST`
- Path: `/internal/routing/difficulty/v1/classify`
- Auth: dedicated service token in `X-GateLM-AI-Service-Token`
- Network: private address 또는 HTTPS only in production-like modes
- Request bound: instruction text 최대 4,096자, rule vector 정확히 42개 finite number

Request identity:

```json
{
  "contractVersion": "gatelm.internal.routing-difficulty-inference.v1",
  "modelContentHash": "sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d",
  "ruleVectorVersion": "difficulty-feature-vector.v1",
  "instructionText": "request-local sensitive text",
  "ruleVector": [0.0]
}
```

`ruleVector` 예시는 shape만 축약해서 보여준다. 실제 요청은 정확히 42개 값이어야 한다.

Response identity:

```json
{
  "contractVersion": "gatelm.internal.routing-difficulty-inference.v1",
  "status": "ready",
  "difficulty": "simple",
  "modelVersion": "difficulty-offline.model-path-5000.2026-07-16.42d-rule-vector-v1-plus-projection.shadow.v1",
  "modelContentHash": "sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d"
}
```

## Feature Flags And Rollback

기본값은 모두 비활성이다.

- Gateway local: `GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED`
- Gateway remote runtime: `GATEWAY_DIFFICULTY_REMOTE_ENABLED`
- AI Service remote inference: `AI_SERVICE_ROUTING_DIFFICULTY_ENABLED`

Gateway local, remote, historical shadow는 동시에 켤 수 없다. 롤백은 remote flag를 끄고 기존 local flag를 다시 켜는 것이다. AI Service 장애가 Provider 호출 실패로 확대되지 않도록 Gateway는 per-request rule fallback을 유지한다.

운영 service token은 `/gatelm/production/routing-difficulty-service-token` SecureString에서 Gateway와 AI role 배포 시점에 읽어 보호된 Compose env에 주입한다. Token 값은 Git, workflow input, SSM Run Command payload와 배포 로그에 포함하지 않는다.

실험용 AI Service 이미지는 `routing` ML extra만 설치한다. 이 extra는 실제 추론 경로가 import하는 NumPy, ONNX Runtime, tokenizer, Transformers만 포함하며 학습·export용 PyTorch/CUDA 의존성은 포함하지 않는다. 기존 `onnx` extra와 기본 self-host 빌드 의미는 변경하지 않는다.

## CPU Tuning Outcome

2026-07-19 격리 성능환경에서 batch size와 추론 worker 수를 분리해 비교했다. 구현은 bounded queue와 dedicated worker를 사용하며 다음 실험 변수만 추가한다.

- `AI_SERVICE_ROUTING_DIFFICULTY_BATCH_SIZE`
- `AI_SERVICE_ROUTING_DIFFICULTY_BATCH_MAX_WAIT_MS`
- `AI_SERVICE_ROUTING_DIFFICULTY_WORKER_COUNT`

동적 micro-batch는 채택하지 않는다. 승인된 holdout 100건을 batch 1 기준과 비교했을 때 batch 2부터 판정 2건이 바뀌었고 그중 1건은 `complex -> simple`이었다. 처리량 증가는 2.08%뿐이므로 정확성 회귀를 정당화하지 못한다. 현재 artifact의 authoritative 실행 단위는 계속 batch 1이다.

단일 2 vCPU AI 호스트의 두-Gateway 150 RPS E2E에서는 worker 4가 가장 나았다. 기존 원격 기준선 대비 AI CPU 평균은 `182.24% -> 102.02%`, remote `ready` 비율은 `31.04% -> 87.29%`, routing 평균은 `84.217ms -> 44.384ms`로 개선됐다. 그러나 timeout, busy, inference failure가 합계 12.71% 남았고 HTTP p95도 `206.336ms`여서 당시 latency 중심 local E5 기준선은 통과하지 못했다.

worker 8은 같은 AI CPU 수준에서 `ready`가 44.55%로 다시 악화됐다. 같은 호스트에서 Uvicorn process를 2개로 늘려 ONNX Session을 분리한 실험도 메모리만 약 1.55GiB로 증가하고 `ready`는 48.25%에 그쳤다. 따라서 authoritative 실행값은 single process, batch 1, worker 4, ONNX intra/inter-op 1/1로 고정한다. 이 결과만으로 150 RPS 원격 추론 용량을 보장하지 않으며 전체 근거는 [`remote-e5-cpu-optimization-report.md`](../testing/remote-e5-cpu-optimization-report.md)에 기록한다.

## Production Promotion Decision

2026-07-20 운영 결정에서는 최저 지연보다 Gateway의 CPU·메모리 격리와 독립 확장 가능성을 우선했다. 2 vCPU 실험에서 최종 HTTP 요청은 모두 Rule fallback을 포함해 성공했고 Gateway의 E5 CPU 병목은 제거됐으므로, AI 호스트를 `c7i.xlarge` 4 vCPU로 확장하고 remote timeout을 `250ms`로 늘린 상태에서 위 execution shape를 운영에 적용한다. `ready` 비율과 fallback을 HTTP 성공률과 분리해 계속 관측하며, 4 vCPU 결과는 기존 2 vCPU 보고서를 덮어쓰지 않고 별도 운영 검증 기록으로 남긴다.

## Post-deployment Verification Gates

계약 변경 검토 전 다음을 모두 충족해야 한다.

1. 동일 holdout과 실제 k6 prompt 분포에서 local/remote `simple | complex` 일치율 100%.
2. 동일 Gateway 1대, 동일 Mock 100ms, 동일 DB/Redis, 동일 150 RPS부터 단계적으로 증가한 조건.
3. remote의 Gateway CPU 평균과 `decide_model_route` p95가 local보다 개선.
4. end-to-end HTTP p95/p99 악화 폭을 기록하되, Gateway resource isolation과 remote coverage를 별도 주 지표로 판정.
5. remote ready 비율, timeout, busy, rule fallback 비율을 별도 집계.
6. AI Service CPU·memory·p95와 포화점을 함께 기록해 병목 이동 여부를 확인.
7. AI Service 중단 실험에서 Provider 호출은 계속되고 rule fallback만 발생.
8. PII sidecar까지 켠 production-like 최종 실행에서 같은 결론 재현.

전환 후에는 Gateway CPU 감소, AI Service `ready`/fallback 비율, 4 vCPU 포화점과 장애 시 Rule fallback을 함께 검증한다. HTTP 성공률만으로 원격 E5 처리 성공을 주장하지 않으며, 회귀가 확인되면 이전 main SHA의 local E5 배포로 롤백한다.
