# GateLM v1.0.0 Role Coordination Notes

## 1. Purpose

이 문서는 재혁님 Control Plane & Runtime Policy 관점에서 역할별 확인 사항을 정리한 보조 coordination note다.

목표는 새 기능을 늘리는 것이 아니라, 재혁님이 어떤 역할과 어떤 계약을 추가로 확정해야 독립 구현과 통합이 가능한지 명확히 하는 것이다.

기준 문서:

- `docs/archive/v1.0.0/contracts.md`
- `docs/archive/v1.0.0/implementation-plan.md`

Status:

- This file is not an additional source of truth.
- Implementation agents must start from `contracts.md` and `implementation-plan.md`.
- Items marked as "추가로 정해야 할 것" are coordination notes unless they are explicitly frozen in `contracts.md`.
- As of 2026-06-27, first implementation PR scope is defined in `implementation-plan.md` section 9.1.
- If this file conflicts with `contracts.md`, `contracts.md` wins.

Closed by final contract freeze:

- ActiveRuntimeConfig canonical artifacts are `schemas/runtime-config.schema.json` and `fixtures/runtime-config.fixture.json`.
- Gateway executes only active published runtime config and fails closed when required runtime config is unavailable.
- Provider credentials use `secretRef`/resolver boundaries; raw provider credentials never enter GatewayContext, logs, cache, metrics, or fixtures.
- Rate limit config is Control Plane owned, while PostgreSQL counter execution is Gateway owned.
- Rate limit config/storage errors fail closed before cache/provider; explicit `enabled=false` records `rate_limit_disabled`.
- First implementation PR uses the Gateway governance vertical slice in `implementation-plan.md` section 9.1.

## 2. Summary

| 부족한 계약 | 우선 맞출 역할 | 우선순위 | 이유 |
|---|---|---:|---|
| ActiveRuntimeConfig 상세 구조 | 이지섭 / Gateway | P1 | `runtime-config` schema/fixture로 1차 고정했다. |
| API Key/App Token lifecycle | 이지섭 / Gateway, 김규민 / Web | P1 | `credential-lifecycle` schema/fixture로 1차 고정했다. |
| Runtime Config publish/versioning | 이지섭 / Gateway, 이규정 / Observability | P1 | `configVersion`, `configHash`, `publishState`를 Runtime Config 계약에 반영했다. |
| Control Plane Admin API | 김규민 / Web | P1 | `control-plane-admin-api` route catalog로 1차 고정했다. |
| Provider credential/secretRef | 이지섭 / Gateway | P1 | Runtime Config 계약에 `secretRef`, `credentialPreview`, `resolver`를 반영했다. |
| Rate Limit config/counter 경계 | 이지섭 / Gateway, 이규정 / Observability | P2 | 재혁님은 limit 설정, Gateway는 counter 실행, Observability는 429를 집계한다. |
| Auth failure log 기준 | 이지섭 / Gateway, 이규정 / Observability | P2 | null 허용 기준은 보강됐지만 auth failure 포함 범위는 아직 남았다. |
| Dashboard/Detail API query | 이규정 / Observability, 김규민 / Web | P2 | Dashboard 필수 필드와 fixture는 보강됐지만 API path, filter, pagination은 아직 맞춰야 한다. |
| Safety policy 상세 구조 | 이지섭 / Gateway, 이윤지 / Safety | P2 | Gateway는 정책을 실행하고 Safety는 detector 기준을 평가한다. |
| Hash/cost 계산 규칙 | 이지섭 / Gateway, 이규정 / Observability | P2 | Runtime Config 계약에 hash/cost 기준을 반영했고 구현 검증이 남았다. |
| Runtime Config fixture/schema 검증 기준 | 전체, 특히 이지섭 / Gateway | P2 | 재혁님 코드형 계약 3종을 추가했고 validation script가 남았다. |

### 2.1 2026-06-27 pull 검토 결과

- `3751fac docs: 관측성 fixture 출처 기준 보강`은 `docs/archive/v1.0.0/fixtures/invocation-log.fixture.json`의 출처 기준과 금지 데이터 기준을 보강했다.
- 관측성 fixture 출처 기준은 닫혔고, 재혁님이 추가해야 하는 코드형 계약은 Control Plane/Runtime Policy 산출물로 좁힌다.
- 이번 정리에서 추가한 코드형 계약은 `runtime-config`, `credential-lifecycle`, `control-plane-admin-api` 3개 축이다.

## 3. Gateway 계약: 재혁님 <-> 이지섭

Gateway 담당자와 가장 먼저 확정해야 하는 계약이다.

### 3.1 ActiveRuntimeConfig 상세 구조

코드형 계약 반영:

- `docs/archive/v1.0.0/schemas/runtime-config.schema.json`으로 ActiveRuntimeConfig의 v1 기본 구조를 고정했다.
- `docs/archive/v1.0.0/fixtures/runtime-config.fixture.json`은 Gateway `RuntimeConfigProvider`가 읽어야 하는 샘플 입력이다.
- `providers[]`, `models[]`, `pricingRules[]`, `safetyPolicy`, `cachePolicy`, `routingPolicy` 내부 구조를 JSON Schema로 명시했다.

구현 시 확인할 것:

- inactive tenant/project/application/key/token 처리 방식
- active config가 없을 때 Gateway error code
- config fetch 실패 시 Gateway가 fail-open인지 fail-closed인지

계약 산출물:

- `docs/archive/v1.0.0/schemas/runtime-config.schema.json`
- `docs/archive/v1.0.0/fixtures/runtime-config.fixture.json`
- Gateway `RuntimeConfigProvider` input/output DTO

### 3.2 API Key/App Token 검증 데이터 계약

코드형 계약 반영:

- `docs/archive/v1.0.0/schemas/credential-lifecycle.schema.json`으로 발급, 1회 원문 표시, 조회, 회전, 폐기, Gateway 검증 record 형태를 고정했다.
- `docs/archive/v1.0.0/fixtures/credential-lifecycle.fixture.json`은 API Key와 App Token 각각의 lifecycle 예시다.

구현 시 확인할 것:

- Control Plane DB schema가 `gatewayVerificationRecord`와 같은 정보를 저장하는지
- Admin API response에서 `secretHash`, `plaintext`, raw Authorization header가 빠지는지
- Gateway가 `prefix_then_hash_compare` 기준으로 검증하는지

계약 산출물:

- `docs/archive/v1.0.0/schemas/credential-lifecycle.schema.json`
- `docs/archive/v1.0.0/fixtures/credential-lifecycle.fixture.json`

### 3.3 Runtime Config publish/versioning 계약

현재 부족한 점:

- `configVersion`, `configHash` field는 있지만 publish lifecycle이 없다.

추가로 정해야 할 것:

- draft config와 active config를 구분할지
- publish API가 active version을 바꾸는 기준
- `configHash` 계산 기준
- `generatedAt`, `effectiveAt`, `publishedAt` 필요 여부
- rollback 허용 여부
- Gateway가 config를 매 요청마다 읽는지 cache하는지
- stale config 허용 시간

계약 산출물 후보:

- `docs/archive/v1.0.0/schemas/runtime-config.schema.json`
- `docs/archive/v1.0.0/fixtures/runtime-config.fixture.json`
- active config selection rule
- config hash canonicalization rule

### 3.4 Provider credential/secretRef 계약

코드형 계약 반영:

- `runtime-config.schema.json`의 `providers[]`에 `secretRef`, `credentialPreview`, `resolver`를 고정했다.
- Runtime Config fixture는 Mock Provider의 `secretRef=null` 예시와 실제 provider가 채워야 할 위치를 보여준다.

구현 시 확인할 것:

- Mock Provider와 실제 Provider config 차이
- base URL 우선순위
- provider별 추가 config 위치
- disabled/degraded provider 처리
- Provider credential을 Gateway가 직접 읽는지 별도 resolver를 쓰는지

계약 산출물:

- `docs/archive/v1.0.0/schemas/runtime-config.schema.json`
- `docs/archive/v1.0.0/fixtures/runtime-config.fixture.json`

### 3.5 Rate Limit config와 실행 경계

현재 부족한 점:

- Control Plane은 rule/config를 저장하고 Gateway는 counter를 실행한다고 되어 있지만 구체 경계가 부족하다.

추가로 정해야 할 것:

- 재혁님 config가 제공해야 하는 최소 필드
- `applicationId` scope 고정 여부
- limit 변경이 active request에 반영되는 시점
- Gateway counter table schema 소유자
- DB 오류 시 `rate_limit_disabled`, `internal_error`, fail-open/fail-closed 기준

계약 산출물 후보:

- rate limit config contract
- rate limit decision contract

## 4. Web Console 계약: 재혁님 <-> 김규민

김규민은 Web Console과 Demo UX를 담당하므로 재혁님의 Control Plane API를 호출한다.

### 4.1 Control Plane Admin API 계약

코드형 계약 반영:

- `docs/archive/v1.0.0/schemas/control-plane-admin-api.schema.json`으로 Admin API route catalog 구조를 고정했다.
- `docs/archive/v1.0.0/fixtures/control-plane-admin-api.fixture.json`에 Project/Application/Provider/API Key/App Token/Runtime Config endpoint 목록을 정리했다.

구현 시 확인할 것:

- 공통 error response
- authorization placeholder 기준

계약 산출물:

- `docs/archive/v1.0.0/schemas/control-plane-admin-api.schema.json`
- `docs/archive/v1.0.0/fixtures/control-plane-admin-api.fixture.json`
- Admin API request/response DTO

### 4.2 Credential 원문 1회 표시 UX 계약

현재 부족한 점:

- 원문 1회 표시 원칙은 있으나 response shape이 없다.

추가로 정해야 할 것:

- 발급 직후 response에만 포함되는 field 이름
- 이후 조회 API에서 숨겨야 하는 field
- copy 안내용 preview field
- 회전 시 새 원문 표시 방식
- 폐기된 key/token의 UI 표시 상태

계약 산출물 후보:

- one-time credential response contract
- credential list item contract

## 5. Observability 계약: 재혁님 <-> 이규정

이규정은 로그, 대시보드, 지표를 담당한다. 재혁님 설정은 로그 해석 기준이 된다.

### 5.1 configHash/policyHash 계산 계약

현재 부족한 점:

- `contracts.md`에 `GatewayContext -> Invocation Log Mapping`이 추가되어 저장 위치는 보강됐다.
- `runtime-config.schema.json`에 hash canonicalization과 source field 목록을 추가했다.
- 실제 코드에서 같은 canonicalization 함수를 공유하는지는 아직 확인해야 한다.

추가로 정해야 할 것:

- `cachePolicyHash` 필요 여부
- `pricingVersion`과 cost 계산 연결

계약 산출물 후보:

- `docs/archive/v1.0.0/schemas/runtime-config.schema.json`
- runtime metadata mapping contract

### 5.2 Auth failure log 계약

현재 부족한 점:

- `contracts.md`에 실행되지 않은 stage가 생산하는 field는 `null` 가능하다는 기준이 추가되어, auth failure log의 일부 모호함은 줄었다.
- 아직 invalid API Key처럼 tenant/project/application context를 모를 수 있는 요청을 Dashboard total에 포함할지, 별도 auth failure log로 둘지 부족하다.

추가로 정해야 할 것:

- auth failure를 invocation log에 저장할지 별도 auth failure log에 저장할지
- credential prefix/hash 저장 가능 범위
- auth failure가 dashboard totalRequests에 포함되는지
- raw Authorization header 저장 금지 검증 기준

계약 산출물 후보:

- auth failure log contract
- auth failure dashboard inclusion rule

### 5.3 Cost/hash 계산 규칙

현재 부족한 점:

- `contracts.md`에 `requestBodyHash`는 normalized request body, `promptHash`는 normalized redacted prompt 기준이라는 설명이 추가됐다.
- Dashboard 필수 집계 field와 fixture는 보강됐다.
- Demo scenario에 `cacheHitRate = cacheHitRequests / cacheEligibleRequests` 기준이 보강됐다.
- `runtime-config.schema.json`에 canonical JSON normalize 방식, hash algorithm, cache key field, cost formula를 추가했다.
- 실제 Gateway와 Observability 구현이 같은 식을 쓰는지는 구현 PR에서 검증해야 한다.

구현 시 확인할 것:

- `missingPricingRule=provider_error` 기준을 Gateway가 그대로 적용하는지

계약 산출물 후보:

- `docs/archive/v1.0.0/schemas/runtime-config.schema.json`
- cost calculation contract test

## 6. Safety 계약: 재혁님 <-> 이윤지

v1 hot path 실행은 Gateway가 담당하지만, 정책 설정과 평가 기준은 Safety 담당자와 맞아야 한다.

### 6.1 Safety policy 상세 구조

현재 부족한 점:

- detector type과 action 표는 있지만 Control Plane config shape이 부족하다.

추가로 정해야 할 것:

- detector rule item 구조
- detector enable/disable field
- action allowed values
- placeholder field
- policy mode
- `securityPolicyHash` 생성 기준
- remote safety shadow mode가 config에 들어가는지

계약 산출물 후보:

- safety policy config contract
- safety detector rule contract

## 7. 전체 팀 계약

### 7.1 Runtime Config fixture/schema 검증 기준

현재 부족한 점:

- `docs/archive/v1.0.0/fixtures/`와 `docs/archive/v1.0.0/schemas/`가 canonical 위치로 정리됐다.
- `invocation-log`, `dashboard-overview`, `gateway-context`, `safety-eval-corpus` fixture/schema는 추가됐다.
- 재혁님이 생산해야 하는 `runtime-config`, `credential-lifecycle`, `control-plane-admin-api` fixture/schema를 이번 정리에서 추가했다.

추가로 정해야 할 것:

- Gateway `RuntimeConfigProvider`가 fixture와 같은 shape을 사용하는지
- smoke script가 runtime config fixture를 읽을지
- fixture 변경 시 누가 승인하는지

계약 산출물 후보:

- runtime config fixture validation script
- contract smoke checklist

## 8. Recommended Order

재혁님이 먼저 처리해야 하는 순서는 아래가 적절하다.

1. 이지섭과 `ActiveRuntimeConfig` 상세 구조 확정
2. 이지섭, 김규민과 API Key/App Token lifecycle 확정
3. 이지섭, 이규정과 Runtime Config publish/versioning 확정
4. 김규민과 Control Plane Admin API 확정
5. 이지섭과 Provider credential/secretRef 확정
6. 이규정과 auth failure log 및 configHash 추적 확정
7. 이윤지와 safety policy 상세 구조 확정
8. 전체 팀과 fixture/schema 위치 및 검증 기준 확정

## 9. Contracts.md 반영 후보

`contracts.md`에 바로 추가할 때는 아래 section 단위로 나누는 것을 권장한다.

```text
Control Plane Admin API Contract
Credential Lifecycle Contract
ActiveRuntimeConfig Detailed Contract
Runtime Config Publish Contract
Provider Secret Reference Contract
Auth Failure Log Contract
Hash and Cost Calculation Contract
Fixture and Schema Validation Contract
```

이 문서는 위 section을 만들기 전 사전 정리 문서로 사용한다.
