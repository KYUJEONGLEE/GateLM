# Remote E5 Inference Experiment

| Field | Value |
|---|---|
| Status | Experimental proposal; not active contract |
| Branch | `feat/remote-e5-inference-experiment` |
| Baseline | Local Gateway E5 106D hot path |
| Promotion rule | Parity and performance gates must pass before any active contract change |
| Last updated | 2026-07-19 |

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

## Experimental Internal API

이 절은 구현과 비교 테스트를 위한 제안이며 active API contract가 아니다.

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
- Gateway remote experiment: `GATEWAY_DIFFICULTY_REMOTE_ENABLED`
- AI Service remote inference: `AI_SERVICE_ROUTING_DIFFICULTY_ENABLED`

Gateway local, remote, historical shadow는 동시에 켤 수 없다. 롤백은 remote flag를 끄고 기존 local flag를 다시 켜는 것이다. AI Service 장애가 Provider 호출 실패로 확대되지 않도록 Gateway는 per-request rule fallback을 유지한다.

실험용 AI Service 이미지는 `routing` ML extra만 설치한다. 이 extra는 실제 추론 경로가 import하는 NumPy, ONNX Runtime, tokenizer, Transformers만 포함하며 학습·export용 PyTorch/CUDA 의존성은 포함하지 않는다. 기존 `onnx` extra와 기본 self-host 빌드 의미는 변경하지 않는다.

## Comparison Gates

계약 변경 검토 전 다음을 모두 충족해야 한다.

1. 동일 holdout과 실제 k6 prompt 분포에서 local/remote `simple | complex` 일치율 100%.
2. 동일 Gateway 1대, 동일 Mock 100ms, 동일 DB/Redis, 동일 150 RPS부터 단계적으로 증가한 조건.
3. remote의 Gateway CPU 평균과 `decide_model_route` p95가 local보다 개선.
4. end-to-end HTTP p95/p99가 local보다 악화되지 않거나, 악화 폭보다 확장성 이득이 명확함.
5. remote ready 비율, timeout, busy, rule fallback 비율을 별도 집계.
6. AI Service CPU·memory·p95와 포화점을 함께 기록해 병목 이동 여부를 확인.
7. AI Service 중단 실험에서 Provider 호출은 계속되고 rule fallback만 발생.
8. PII sidecar까지 켠 production-like 최종 실행에서 같은 결론 재현.

remote가 위 기준을 통과하지 못하면 active [`contracts.md`](contracts.md)는 변경하지 않는다. 통과하면 이 문서의 내부 경계, 장애 의미, 배포 토폴로지를 별도 contract PR로 제안한다.
