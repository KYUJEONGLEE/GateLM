# Jiseob - Gateway Data Plane Contract Notes

이 문서는 v2.0.0 공식 계약이 아니라 Gateway owner 관점의 계약/의존성 정리 초안이다. 확정 필드명은 이후 `docs/v2.0.0/contracts.md`, JSON Schema, fixture에서 별도로 고정한다.

## 1. 내 역할의 v2 main path

Gateway Data Plane의 v2 main path는 고객/직원 요청이 실제 Provider까지 안전하게 흐르고, 그 결과가 로그/대시보드/메트릭에서 설명 가능하게 남는 것이다.

```text
Auth
-> Tenant/Project/Application context
-> RuntimeSnapshot load
-> Budget/Rate Limit
-> Request-side Safety
-> Exact Cache
-> Routing
-> Actual Provider call
-> Mock fallback if allowed
-> Streaming or non-streaming response
-> Request Log / Detail / Dashboard / Metrics evidence
```

v2에서 Gateway가 특히 책임질 부분은 아래와 같다.

- `RuntimeSnapshot`을 hot path에서 소비한다.
- 실제 Provider 1종과 모델 2개 이상을 adapter 경계로 연결한다.
- `model=auto` 요청을 Provider/Model catalog와 routing policy로 해석한다.
- Mock Provider는 데모용 주 경로가 아니라 fallback/evidence 경로로 분리한다.
- streaming thin slice를 지원하되, request-side safety는 cache/routing/provider/streaming start 전에 끝낸다.
- raw prompt, raw response, raw detected value, offset, API Key, App Token, Provider Key, Authorization header는 저장/로그/fixture에 남기지 않는다.

## 2. 내가 다른 역할에게 받아야 하는 계약

### 재혁님 - Control Plane / Runtime Policy

- Gateway가 소비할 `RuntimeSnapshot` 최소 schema
- `RuntimeSnapshot` publish/reload 실패 시 상태 표현
- active snapshot pointer 조회 방식
- active snapshot lookup key 기준
- Provider/Model catalog shape
- Provider credential reference shape
- API Key/App Token 검증 결과와 Application binding
- `budgetScopeType/budgetScopeId` resolve 규칙

### 김규민 - Product Experience / Demo

- Employee Chat이 Gateway를 호출하는 경계
- 브라우저 direct 방식인지 Web BFF/server-side 방식인지
- 데모 시나리오에서 보여줄 요청 유형
- Request Detail에서 꼭 보여야 하는 Gateway evidence
- Mock fallback과 Actual Provider path를 UI에서 어떻게 구분할지

### 이윤지 - AI Safety / Evaluation Lab

- request-side safety detector type/action 계약
- remote/shadow safety가 Gateway hot path에 영향을 주지 않는 fallback 규칙
- streaming 요청에서 request-side safety를 어디까지 검사할지
- redacted preview와 detected summary의 최소 표현
- raw value, offset, raw prompt fragment를 반환하지 않는 응답 규칙

### 이규정 - Observability / Data Platform / Performance

- terminal status와 domain outcome을 집계하는 read model
- Request Log/Detail/Dashboard에서 필요한 최소 필드
- `/metrics` label 허용 목록과 금지 목록
- k6 baseline 시나리오와 성공 기준
- Dashboard freshness/query budget 표현
- PostgreSQL query/index/partition 검토 기준

## 3. 내가 다른 역할에게 제공해야 하는 계약

Gateway는 아래 계약 후보를 생산해야 한다.

- Gateway request context 최소 shape
- Gateway terminal status 후보와 domain outcome 후보
- Rate Limit/Budget/Safety/Cache/Routing/Provider/Fallback/Streaming stage outcome
- Actual Provider adapter interface
- Mock fallback outcome 표현
- selectedProvider, selectedModel, routingReason evidence
- cache hit/miss/bypass와 provider bypass evidence
- requestId/traceId 중심 Request Log/Detail mapping
- `/metrics`로 노출 가능한 Gateway-owned metric evidence
- local stack smoke와 demo smoke 실행 방법
- safety block 시 provider call, cache write, streaming start가 모두 일어나지 않는다는 bypass evidence
- remote/shadow safety 결과는 evidence track으로 분리하고 Gateway core 차단 판단을 대체하지 않는다는 evidence

중요한 원칙:

- Gateway는 Observability가 추측해야 하는 outcome을 만들지 않게 해야 한다.
- stage가 실행되지 않았다면 `not_called`, `not_checked`, `not_used`처럼 명시적으로 표현해야 한다.
- Gateway가 모르는 Control Plane 내부 상태를 임의로 만들어 기록하지 않는다.

## 4. 내가 막히는 dependency

아래가 결정되지 않으면 Gateway 구현이 쉽게 흔들린다.

- P0 legacy field cleanup inventory
- `RuntimeSnapshot` 최소 schema와 provenance field
- active snapshot lookup key: `tenant/project/application` 기준인지, budget scope까지 포함하는지
- publish 실패, reload 실패, last known safe 상태 계약
- Provider/Model catalog와 credential reference 계약
- Actual Provider 1종과 모델 2개 이상 범위
- Mock fallback이 허용되는 조건과 outcome 표현
- terminal status와 domain outcome의 최종 구조
- `budgetScopeType/budgetScopeId` resolve 위치
- Employee Chat의 Gateway 호출 경계
- streaming thin slice의 lifecycle 범위
- Request Log/Detail/Dashboard/Metrics 필드 승격 기준

## 5. 내가 늦어지면 막히는 다른 역할

- 재혁님: RuntimeSnapshot을 발행해도 Gateway 소비 경계가 없으면 live 적용 증명이 어렵다.
- 김규민: UI에서 Actual Provider, Mock fallback, cache hit, safety block을 실제 evidence로 보여주기 어렵다.
- 이윤지: remote/shadow safety 결과가 Gateway 요청 흐름과 어떻게 분리되는지 검증하기 어렵다.
- 이규정: 대시보드와 k6가 Gateway terminal/domain outcome을 기준으로 집계하기 어렵다.

## 6. 계약 확정 전에도 병렬로 할 수 있는 shadow/evidence 작업

- P0 legacy field cleanup 후보 조사
- OpenAI-compatible Provider adapter spike
- Mock fallback outcome smoke
- streaming fake provider smoke
- request-side safety before provider 검증 smoke
- DB/Redis connection pool과 timeout 설정 조사
- k6 scenario 후보 정리
- Dashboard query profile 후보 정리

단, 위 작업은 공식 API/DB/Event/Metrics 필드를 확정하지 않는 범위에서만 진행한다.

## 7. P0로 먼저 확정해야 하는 항목

1. P0 legacy field cleanup scope
2. terminal status와 domain outcome 구조
3. RuntimeConfig/RuntimeSnapshot 경계
4. RuntimeSnapshot publish/reload/last known safe 계약
5. active snapshot lookup key와 기존 `configHash/securityPolicyHash/routingPolicyHash`의 v2 provenance 연결
6. Provider/Model catalog와 credential reference 계약
7. Actual Provider 1종, 모델 2개 이상, Mock fallback 범위
8. `budgetScopeType/budgetScopeId` resolve 규칙
9. Employee Chat Gateway 호출 경계
10. streaming thin slice 범위
11. redaction 이후 cache/evidence 입력은 raw prompt가 아니라 normalized redacted prompt 계열만 쓴다는 원칙
12. raw prompt/raw response 저장 금지 유지와 opt-in deferred 조건

## 8. 아직 공식 필드로 확정하면 안 되는 후보 용어

아래 용어는 아직 계약 후보로만 다룬다.

- `terminalStatus`
- `domainOutcome`
- `runtimeSnapshotId`
- `runtimeSnapshotVersion`
- `runtimeState`
- `lastKnownSafe`
- `budgetScopeType`
- `budgetScopeId`
- `provider.outcome`
- `fallback.outcome`
- `streaming.outcome`
- `not_called`
- `not_checked`
- `not_used`
- `mock_fallback`
- `actual_provider`

## 9. 첫 구현 PR로 쪼갤 수 있는 단위

추천 순서:

1. P0 legacy field cleanup inventory와 저위험 정리
2. terminal status/domain outcome contract fixture
3. RuntimeSnapshot static adapter와 provenance smoke
4. Actual Provider adapter 1종 + 모델 2개 이상 + Mock fallback
5. Provider/Model catalog 기반 `model=auto` routing
6. `budgetScopeType/budgetScopeId` context propagation
7. streaming thin slice
8. Gateway local stack smoke 갱신
9. k6 scenario 강화와 dashboard query profile handoff

첫 구현은 기능 욕심을 줄이고, `P0 legacy cleanup -> Actual Provider adapter -> RuntimeSnapshot live thin slice` 순서가 안전하다.
