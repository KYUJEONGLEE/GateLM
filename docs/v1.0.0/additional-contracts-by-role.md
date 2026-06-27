# GateLM v1.0.0 Additional Contracts by Role

## 1. Purpose

이 문서는 현재 `contracts.md`에서 부족한 계약을 재혁님 Control Plane & Runtime Policy 관점에서 역할별로 정리한다.

목표는 새 기능을 늘리는 것이 아니라, 재혁님이 어떤 역할과 어떤 계약을 추가로 확정해야 독립 구현과 통합이 가능한지 명확히 하는 것이다.

기준 문서:

- `docs/v1.0.0/contracts.md`
- `docs/v1.0.0/implementation-plan.md`

## 2. Summary

| 부족한 계약 | 우선 맞출 역할 | 우선순위 | 이유 |
|---|---|---:|---|
| ActiveRuntimeConfig 상세 구조 | 이지섭 / Gateway | P1 | Control Plane이 만들고 Gateway가 그대로 실행한다. |
| API Key/App Token lifecycle | 이지섭 / Gateway, 김규민 / Web | P1 | Gateway 검증과 Web 1회 표시 UX가 동시에 의존한다. |
| Runtime Config publish/versioning | 이지섭 / Gateway, 이규정 / Observability | P1 | Gateway는 active config를 실행하고 로그는 configHash를 추적한다. |
| Control Plane Admin API | 김규민 / Web | P1 | Web Console이 재혁님 API를 호출해 설정을 만든다. |
| Provider credential/secretRef | 이지섭 / Gateway | P1 | Gateway가 Provider 호출 시 어떤 secret reference를 쓸지 알아야 한다. |
| Rate Limit config/counter 경계 | 이지섭 / Gateway, 이규정 / Observability | P2 | 재혁님은 limit 설정, Gateway는 counter 실행, Observability는 429를 집계한다. |
| Auth failure log 기준 | 이지섭 / Gateway, 이규정 / Observability | P2 | invalid API Key는 tenant/project context가 없을 수 있다. |
| Dashboard/Detail API query | 이규정 / Observability, 김규민 / Web | P2 | API path, filter, pagination이 있어야 UI와 backend가 맞는다. |
| Safety policy 상세 구조 | 이지섭 / Gateway, 이윤지 / Safety | P2 | Gateway는 정책을 실행하고 Safety는 detector 기준을 평가한다. |
| Hash/cost 계산 규칙 | 이지섭 / Gateway, 이규정 / Observability | P2 | Gateway가 기록한 값을 Observability가 같은 의미로 집계해야 한다. |
| Fixture/schema 위치와 검증 기준 | 전체, 특히 이지섭 / Gateway | P2 | mock 개발과 smoke가 같은 입력 계약을 써야 한다. |

## 3. Gateway 계약: 재혁님 <-> 이지섭

Gateway 담당자와 가장 먼저 확정해야 하는 계약이다.

### 3.1 ActiveRuntimeConfig 상세 구조

현재 부족한 점:

- `contracts.md`에는 필수 field 이름만 있다.
- `providers[]`, `models[]`, `pricingRules[]`, `safetyPolicy`, `cachePolicy`, `routingPolicy` 내부 구조가 고정되어 있지 않다.

추가로 정해야 할 것:

- `providers[]` item 구조
- `models[]` item 구조
- `pricingRules[]` item 구조
- status allowed values
- `defaultProvider/defaultModel`과 `fallbackProvider/fallbackModel`의 관계
- inactive tenant/project/application/key/token 처리 방식
- active config가 없을 때 Gateway error code
- config fetch 실패 시 Gateway가 fail-open인지 fail-closed인지

계약 산출물 후보:

- `active-runtime-config.schema.json`
- `runtime-config.fixture.json`
- Gateway `RuntimeConfigProvider` input/output DTO

### 3.2 API Key/App Token 검증 데이터 계약

현재 부족한 점:

- API Key/App Token을 발급한다는 경계는 있지만 검증에 필요한 저장/조회 계약이 부족하다.

추가로 정해야 할 것:

- key/token 생성 prefix
- raw key/token 형식
- hash 알고리즘
- trim/normalize 여부
- prefix 검색 후 hash 비교인지, full hash direct lookup인지
- `last4` 저장 여부
- `scopes` 의미
- `applicationId` binding 기준
- `active/revoked/expired/disabled` 상태 의미
- rotate 시 기존 key 처리
- revoke 시 Gateway 응답

계약 산출물 후보:

- credential lifecycle contract
- credential verification query contract
- one-time plaintext response contract

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

- runtime config publish contract
- active config selection rule
- config hash canonicalization rule

### 3.4 Provider credential/secretRef 계약

현재 부족한 점:

- Provider Key 원문 저장 금지는 있지만 `secretRef` 형식과 Gateway 사용 방식이 부족하다.

추가로 정해야 할 것:

- `secretRef` format
- `credentialPreview` 허용 범위
- Mock Provider와 실제 Provider config 차이
- base URL 우선순위
- provider별 추가 config 위치
- disabled/degraded provider 처리
- Provider credential을 Gateway가 직접 읽는지 별도 resolver를 쓰는지

계약 산출물 후보:

- provider connection contract
- secret reference contract

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

현재 부족한 점:

- Gateway endpoint 계약은 있지만 Admin API endpoint 계약이 없다.

추가로 정해야 할 것:

- Project 생성/조회/수정 API
- Application 생성/조회/수정 API
- Provider 등록/조회/수정 API
- API Key 발급/조회/회전/폐기 API
- App Token 발급/조회/회전/폐기 API
- Runtime Config 조회/수정/publish API
- 공통 error response
- authorization placeholder 기준

계약 산출물 후보:

- Control Plane OpenAPI skeleton
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

### 5.1 configHash/policyHash 추적 계약

현재 부족한 점:

- `configHash`, `routingPolicyHash`, `securityPolicyHash`는 있지만 어떤 설정에서 만들어지는지 부족하다.

추가로 정해야 할 것:

- `configHash` source fields
- `routingPolicyHash` source fields
- `securityPolicyHash` source fields
- `cachePolicyHash` 필요 여부
- `pricingVersion`과 cost 계산 연결
- 로그에 저장할 config identifier 이름

계약 산출물 후보:

- runtime metadata mapping contract
- policy hash calculation rule

### 5.2 Auth failure log 계약

현재 부족한 점:

- invalid API Key는 tenant/project/application context를 모를 수 있는데, log contract는 tenant/project 중심이다.

추가로 정해야 할 것:

- auth failure를 invocation log에 저장할지 별도 auth failure log에 저장할지
- unknown tenant/project일 때 nullable 허용 여부
- credential prefix/hash 저장 가능 범위
- auth failure가 dashboard totalRequests에 포함되는지
- raw Authorization header 저장 금지 검증 기준

계약 산출물 후보:

- auth failure log contract
- auth failure dashboard inclusion rule

### 5.3 Cost/hash 계산 규칙

현재 부족한 점:

- field는 있지만 계산 방식이 부족하다.

추가로 정해야 할 것:

- `requestBodyHash` 계산 기준
- `promptHash` 계산 기준
- `cacheKeyHash` 계산 기준
- `costMicroUsd` 계산식
- `savedCostMicroUsd` 계산식
- micro USD에서 USD string 변환 규칙
- pricing rule이 없을 때 처리

계약 산출물 후보:

- hash calculation contract
- cost calculation contract

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

### 7.1 Fixture/schema 위치와 검증 기준

현재 부족한 점:

- `implementation-plan.md`에는 fixture 목록이 있지만 실제 위치와 검증 기준이 부족하다.

추가로 정해야 할 것:

- `runtime-config.fixture.json` 위치
- `gateway-context.schema.json` 위치
- `invocation-log.fixture.json` 위치
- fixture가 어떤 schema를 통과해야 하는지
- smoke script가 어떤 fixture를 읽는지
- fixture 변경 시 누가 승인하는지

계약 산출물 후보:

- contracts package directory rule
- fixture validation script
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
