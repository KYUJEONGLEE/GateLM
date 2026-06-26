# GateLM P0 Team Workplan v0.2

## 문서 목적

이 문서는 5명의 교육생이 3~5일 동안 GateLM P0를 구현할 때의 역할, 마일스톤, 의존성 해결 방식, 참고 문서를 정의한다.

P0 목표는 기능을 많이 여는 것이 아니라 아래 흐름을 끊기지 않게 완성하는 것이다.

```text
API Key/App Token 발급
-> Gateway request
-> 인증/식별
-> 마스킹/차단
-> Simple Routing
-> Exact Cache
-> Mock Provider 또는 cache response
-> Request Log / Detail
-> Dashboard / Demo Flow
```

---

## 1. 팀 운영 원칙

```text
1. Gateway vertical slice가 항상 1순위다.
2. 화면은 Gateway가 end-to-end로 돈 뒤 붙인다.
3. 작업은 2~4시간 단위로 자른다.
4. 의존성이 있는 작업은 공통계약을 먼저 고정한다.
5. 문서에 없는 API/DB/Event는 만들지 않는다.
6. raw prompt/raw response/secret 원문 저장 변경은 보안 리뷰 대상이다.
7. 매일 마지막에는 통합 시나리오를 한 번 실행한다.
```

공통 기준 문서:

```text
범위 판단: docs/p0/p0-contract.md
구현 컷라인: docs/p0/implementation-cut.md
테스트 판단: docs/p0/p0-test-matrix.md
리뷰/CI 판단: docs/p0/p0-review-and-ci-gate.md
데모 완료 판단: docs/p0/demo-acceptance.md
로컬 실행: docs/p0/local-dev.md
```

---

## 2. 역할 분배


| 담당  | 1차 책임                                   | 2차 책임                                                                                                        | 절대 책임                                                       |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| A   | Control Plane / DB / Runtime Config     | Tenant, Project, Application, Provider Connection, API Key/App Token 발급, seed, Gateway용 active config 생성     | Gateway가 인증/식별/Provider 호출에 필요한 데이터를 DB와 seed로 제공해야 함       |
| B   | Gateway Core / Provider Adapter         | `/v1/chat/completions`, `/v1/models`, Gateway pipeline 뼈대, mock provider adapter, OpenAI-compatible response | curl 요청이 Gateway에 들어와 mock provider 응답 또는 cache 응답으로 돌아와야 함 |
| C   | Gateway Auth / Context / Simple Routing | API Key 인증 stage, App Token 검증 stage, Tenant/Project/Application 식별, `model=auto` routing stage              | Gateway가 요청 주체를 식별하고 selectedModel을 결정할 수 있어야 함             |
| D   | Security / Exact Cache / Safety Test    | email/phone redaction, API Key/JWT/RRN block, cache key 생성, Redis exact cache, raw prompt/secret 노출 검사       | Provider 호출 전에 마스킹/차단과 캐시 조회가 반드시 적용되어야 함                   |
| E   | Observability / Web Console / Demo Flow | Usage Log 저장, Request Log API, Request Detail API, Dashboard API, Web 화면, curl/demo script                   | requestId로 Gateway 결과를 로그, 상세, 대시보드, 데모 화면에서 추적할 수 있어야 함    |


역할 경계 원칙:

```text
A는 Gateway가 읽을 데이터를 만든다.
B는 Gateway 요청/응답의 뼈대를 책임진다.
C는 요청 주체와 모델 선택을 확정한다.
D는 Provider 호출 전에 보안과 캐시를 적용한다.
E는 결과를 사람이 확인할 수 있게 만든다.
```

---

## 3. 역할별 참고 문서


| 담당  | 반드시 먼저 볼 문서                                                                                          | 보조 참고 문서                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A   | `docs/p0/p0-db-migration-plan.md`, `docs/architecture/db-schema.md`, `docs/architecture/api-spec.md` | `docs/p0/local-dev.md`, `docs/policies/ai-coding-rules.md`, `docs/policies/coding-convention.md`       |
| B   | `docs/architecture/gateway-flow.md`, `docs/p0/mock-provider.md`, `docs/p0/p0-contract.md`            | `docs/architecture/api-spec.md`, `docs/p0/demo-acceptance.md`, `docs/p0/p0-test-matrix.md`             |
| C   | `docs/architecture/gateway-flow.md`, `docs/p0/p0-contract.md`, `docs/architecture/api-spec.md`       | `docs/p0/p0-db-migration-plan.md`, `docs/policies/coding-convention.md`                                |
| D   | `docs/policies/pii-masking-policy.md`, `docs/architecture/gateway-flow.md`, `docs/p0/p0-contract.md` | `docs/p0/p0-test-matrix.md`, `docs/p0/p0-log-event-payload.md`, `docs/p0/local-dev.md`                 |
| E   | `docs/p0/p0-log-event-payload.md`, `docs/p0/demo-acceptance.md`, `docs/p0/p0-contract.md`            | `docs/architecture/api-spec.md`, `docs/architecture/dashboard-metrics.md`, `docs/p0/p0-test-matrix.md` |


공통으로 따라야 하는 금지 기준:

```text
- raw prompt 저장 금지
- raw response 저장 금지
- API Key/App Token/Provider Key 평문 저장 금지
- Authorization header 로그 출력 금지
- Provider raw error body 저장 금지
- 문서에 없는 API/DB/Event 추가 금지
```

---

## 4. 역할 간 공통계약

의존성이 있는 역할은 구현으로 맞추지 말고 아래 계약을 먼저 맞춘다.

### 4.1 Active Config 계약 — A -> B/C/D

A는 Gateway가 요청 처리에 필요한 active config를 seed 또는 DB 조회로 제공한다.

필수 개념:


| 항목                       | 제공자 | 소비자   | P0 기준                           |
| ------------------------ | --- | ----- | ------------------------------- |
| `tenantId`               | A   | C/E   | 로그와 scope 기준                    |
| `projectId`              | A   | C/D/E | 인증, cache key, 로그 기준            |
| `applicationId`          | A   | C/E   | App Token 검증과 로그 기준             |
| `apiKeyId`, key hash     | A   | C/E   | API Key 인증, 원문 key 저장 금지        |
| `appTokenId`, token hash | A   | C/E   | App Token 검증, 원문 token 저장 금지    |
| provider connection      | A   | B/C   | P0는 mock provider 가능            |
| model catalog            | A   | B/C   | `mock-fast`, `mock-balanced` 최소 |
| security policy hash     | A   | D/E   | cache key와 masking 기록 기준        |
| routing policy hash      | A   | C/D/E | routing과 cache key 기준           |


완료 기준:

```text
Gateway가 seed 데이터만으로도 인증, 식별, routing, cache, log를 수행할 수 있다.
```

### 4.2 Gateway Context 계약 — B/C/D -> E

Gateway 처리 중 누적되는 공통 context는 E가 로그로 저장할 수 있는 형태여야 한다.

필수 개념:


| 묶음       | 필드 예시                                                                                    | 담당      |
| -------- | ---------------------------------------------------------------------------------------- | ------- |
| Request  | `requestId`, `traceId`, `endpoint`, `method`, `stream`                                   | B       |
| Identity | `tenantId`, `projectId`, `applicationId`, `apiKeyId`, `appTokenId`                       | C       |
| Routing  | `requestedModel`, `selectedProvider`, `selectedModel`, `routingReason`                   | C       |
| Security | `maskingAction`, `maskingDetectedTypes`, `maskingDetectedCount`, `redactedPromptPreview` | D       |
| Cache    | `cacheStatus`, `cacheType`, `cacheKeyHash`, `cacheHitRequestId`                          | D       |
| Provider | `provider`, `model`, `providerLatencyMs`                                                 | B       |
| Usage    | `promptTokens`, `completionTokens`, `totalTokens`, `costMicroUsd`, `latencyMs`           | B/E     |
| Status   | `status`, `httpStatus`, `errorCode`, `errorMessage`, `errorStage`                        | B/C/D/E |


완료 기준:

```text
E가 requestId 하나로 Request Log, Request Detail, Dashboard 값을 만들 수 있다.
```

### 4.3 Pipeline 순서 계약 — B/C/D

P0 Gateway stage 순서는 아래 개념을 따른다.

```text
receive request
-> assign requestId
-> parse OpenAI-compatible payload
-> authenticate API Key
-> validate App Token
-> resolve Tenant/Project/Application context
-> detect sensitive data
-> mask or block
-> decide simple routing
-> build exact cache key
-> exact cache lookup
-> call mock provider if cache miss
-> build OpenAI-compatible response
-> write log
```

핵심 규칙:

```text
- 마스킹/차단은 Provider 호출보다 앞에 있어야 한다.
- cache key는 raw prompt가 아니라 redacted prompt 기준이어야 한다.
- D의 cache key에는 C가 결정한 selectedModel/selectedProvider가 들어간다.
- cache hit이면 B는 mock provider를 호출하지 않는다.
- block이면 cache lookup과 Provider 호출을 하지 않는다.
```

### 4.4 Log/Event 계약 — B/C/D -> E

E는 `docs/p0/p0-log-event-payload.md` 기준으로 저장한다.

P0 terminal status:


| status      | 의미                  | 담당 stage |
| ----------- | ------------------- | -------- |
| `success`   | Provider/mock 호출 성공 | B        |
| `cache_hit` | Exact Cache hit     | D        |
| `blocked`   | 민감정보 또는 정책 차단       | D        |
| `error`     | 인증/검증/Provider 등 실패 | B/C/D    |
| `cancelled` | 취소                  | B        |


완료 기준:

```text
success, cache_hit, blocked 요청이 모두 Request Log와 Dashboard에 반영된다.
```

---

## 5. 5일 마일스톤

### 오늘 저녁 시작 체크리스트

첫 2시간 안에 아래를 먼저 맞춘다.


| 담당  | 먼저 확정할 것                                                        | 공유 대상   |
| --- | --------------------------------------------------------------- | ------- |
| A   | seed tenant/project/application/provider/key/token 이름과 ID 예시    | B/C/D/E |
| B   | Gateway base URL, mock provider base URL, 공통 response/header 기준 | C/D/E   |
| C   | 인증 성공 context 예시, invalid key/token error 기준, routing output 예시 | B/D/E   |
| D   | redaction placeholder, block 대상, cache key material 예시          | B/C/E   |
| E   | Request Log/Detail/Dashboard에 보여줄 P0 필드 목록, demo script 초안      | A/B/C/D |


첫 통합 목표:

```text
오늘 저녁 안에 최소 한 번은 safe curl 요청이 Gateway를 지나 mock provider 응답으로 돌아와야 한다.
```

### Day 1 — Skeleton / Contracts / First Curl

목표:

```text
Gateway가 mock provider까지 왕복하고, A/B/C/D/E 사이 공통계약이 문서와 작업 단위로 고정된다.
```

역할별 산출물:


| 담당  | 산출물                                                   | 완료 기준                                            |
| --- | ----------------------------------------------------- | ------------------------------------------------ |
| A   | seed tenant/project/application/provider/key/token 초안 | Gateway가 읽을 demo identity와 provider metadata가 있음 |
| B   | `/v1/chat/completions` 기본 왕복, `/v1/models` mock 목록    | curl 요청이 mock response로 돌아옴                      |
| C   | 인증/context/routing stage 자리와 입력/출력 정의                 | context에 identity와 requestedModel 자리가 있음         |
| D   | masking/cache stage 자리와 cache key material 정의         | redacted prompt 기준 cache key 원칙이 정해짐             |
| E   | request log DTO 초안, demo script 초안                    | requestId 기준으로 보여줄 필드 목록이 정해짐                    |


통합 체크:

```text
curl -> Gateway -> mock provider -> response
```

### Day 2 — Auth / Context / Active Config

목표:

```text
Gateway가 요청 주체를 식별하고, 잘못된 key/token을 Provider 호출 전에 막는다.
```

역할별 산출물:


| 담당  | 산출물                                                      | 완료 기준                           |
| --- | -------------------------------------------------------- | ------------------------------- |
| A   | API Key/App Token 발급 또는 seed output, active config 조회 기준 | 원문 key/token은 1회만 확인 가능         |
| B   | Gateway error/header/response shape 정리                   | 인증 실패도 일관된 응답을 반환               |
| C   | API Key 인증, App Token 검증, Tenant/Project/Application 식별  | 유효 요청과 invalid 요청이 구분됨          |
| D   | 인증 실패/차단 케이스가 Provider로 가지 않는지 safety check              | Provider 호출 전 차단 원칙 확인          |
| E   | auth failure log 저장 기준                                   | requestId/status/httpStatus가 남음 |


통합 체크:

```text
valid key/token -> 200
invalid API Key -> 401 before provider
invalid App Token -> 403 before provider
```

### Day 3 — Security / Routing / Exact Cache

목표:

```text
Provider 호출 전에 보안 처리와 cache lookup이 적용되고, model=auto가 선택 모델로 확정된다.
```

역할별 산출물:


| 담당  | 산출물                                                             | 완료 기준                              |
| --- | --------------------------------------------------------------- | ---------------------------------- |
| A   | security/routing/cache seed config                              | policy hash 또는 config hash 기준이 있음  |
| B   | cache hit/provider miss에 맞는 response path                       | cache hit이면 mock provider 호출 없음    |
| C   | `model=auto` simple routing                                     | requestedModel과 selectedModel이 분리됨 |
| D   | email/phone redaction, API Key/JWT/RRN block, Redis exact cache | redaction/block/cache hit가 재현됨     |
| E   | masking/cache/routing fields log mapping                        | Detail에서 각 결과를 볼 수 있음              |


통합 체크:

```text
safe request 1회차 -> cache miss -> provider
same request 2회차 -> cache hit -> no provider
email/phone -> redacted before provider
credential/JWT/RRN -> blocked before provider
model=auto -> selectedModel 기록
```

### Day 4 — Request Log / Detail / Dashboard API

목표:

```text
requestId 기준으로 Gateway 결과를 운영자가 추적할 수 있다.
```

역할별 산출물:


| 담당  | 산출물                                                    | 완료 기준                                |
| --- | ------------------------------------------------------ | ------------------------------------ |
| A   | log query에 필요한 tenant/project scope 확인                 | scope 없는 로그 조회가 없음                   |
| B   | provider/cache/error response metadata 보강              | E가 저장할 usage/status 값이 채워짐           |
| C   | identity/routing metadata 보강                           | requested/selected model이 detail에 남음 |
| D   | masking/cache metadata 보강, raw prompt/secret 노출 검사     | raw 값이 log/detail에 없음                |
| E   | Request Log API, Request Detail API, Dashboard API 축소판 | total/success/blocked/cache 중심 조회 가능 |


통합 체크:

```text
requestId -> log list -> detail -> dashboard count
```

### Day 5 — Web Console / Demo Rehearsal / Acceptance

목표:

```text
고객사 앱 또는 curl 데모로 GateLM의 인증, 보안, 캐시, 라우팅, 로깅 가치를 한 번에 보여준다.
```

역할별 산출물:


| 담당  | 산출물                                          | 완료 기준                           |
| --- | -------------------------------------------- | ------------------------------- |
| A   | seed reset 절차와 demo credential 확인            | 데모 시작 상태가 재현됨                   |
| B   | Gateway smoke script 안정화                     | safe/cache/provider 경로가 모두 동작   |
| C   | auth/context/routing demo case 검증            | invalid/auto routing 케이스가 설명 가능 |
| D   | security/cacghe safety checklist 통과          | raw prompt/secret 노출 없음         |
| E   | Web Console 또는 demo page, curl script, 발표 흐름 | Dashboard/Detail에서 결과 확인 가능     |


통합 체크:

```text
demo-acceptance 핵심 항목 통과
```

---

## 6. 의존성 처리 규칙

의존성은 기다리지 말고 임시 계약으로 먼저 고정한다.


| 막힌 역할 | 의존 대상                  | 해결 방식                                                  |
| ----- | ---------------------- | ------------------------------------------------------ |
| B     | A의 DB/seed 미완성         | A가 demo active config JSON 또는 seed 값을 먼저 제공            |
| C     | A의 key/token 저장 구조 미완성 | key hash/token hash 검증 인터페이스와 fixture를 먼저 합의           |
| D     | C의 selectedModel 미완성   | C가 routing output 예시를 먼저 제공하고 D는 그 필드로 cache key 구성    |
| E     | B/C/D의 context 미완성     | `Gateway Context 계약`의 필드를 null 허용으로 먼저 저장하고, Day 4에 채움 |
| E     | Web Console 지연         | curl/demo script로 먼저 acceptance를 통과하고 UI는 축소           |


계약 변경 규칙:

```text
1. 변경 이유를 Daily Sync에서 먼저 말한다.
2. 영향 받는 역할을 지정한다.
3. API/DB/Event 변경 여부를 표시한다.
4. p0-contract와 p0-log-event-payload에 없는 필드는 추가하지 않는다.
5. 변경 후 당일 smoke owner가 전체 demo flow를 다시 확인한다.
```

---

## 7. Daily Sync 방식

매일 15분만 진행한다.

각자 아래만 말한다.

```text
1. 어제 완료한 end-to-end 영향
2. 오늘 GateLM 데모에 붙일 것
3. 막힌 API/DB/Event/보안 이슈
4. 오늘 통합 시나리오에서 깨질 가능성
```

금지:

```text
- 세부 구현 설명 길게 하기
- AI가 생성한 코드를 검토 없이 merge하기
- 문서 변경 없이 계약 변경하기
- 자기 역할 안에서만 성공하고 통합 smoke를 깨는 변경하기
```

---

## 8. Daily Smoke Owner

매일 마지막에는 한 명을 smoke owner로 지정한다.


| 일차    | 기본 owner | 확인 범위                                                            |
| ----- | -------- | ---------------------------------------------------------------- |
| Day 1 | B        | healthz/readyz, mock provider 연결, safe `/v1/chat/completions` 초안 |
| Day 2 | C        | API Key/App Token 인증, 최소 project/application context             |
| Day 3 | D        | masking/block/cache/routing                                      |
| Day 4 | E        | Request Log/Detail/Dashboard API                                 |
| Day 5 | E        | Dashboard 축소 카드, 고객사 앱 연동 demo flow                              |


Smoke 실패 시 원칙:

```text
1. 새 기능 구현보다 smoke 복구를 우선한다.
2. 실패 requestId와 깨진 stage를 기록한다.
3. raw prompt/secret 노출 가능성이 있으면 즉시 보안 이슈로 올린다.
4. Dashboard 숫자 불일치는 Request Log canonical source부터 확인한다.
```

---

## 9. Branch / PR 규칙

Branch 이름 예시:

```text
feature/p0-active-config
feature/p0-gateway-chat-completions
feature/p0-auth-context-routing
feature/p0-security-cache
feature/p0-request-logs-dashboard
fix/p0-demo-smoke
```

PR 크기 기준:

```text
- 수정 파일 10개 이하 권장
- 목적 1개
- 역할 owner 명시
- DB/API/Event 변경 여부 명시
- 보안 영향 여부 명시
- 테스트 결과 첨부
```

PR checklist:

```text
[ ] 관련 문서 확인
[ ] p0-contract 범위 안의 변경
[ ] 역할 간 공통계약을 깨지 않음
[ ] API/DB/Event 변경 여부 표시
[ ] raw prompt/raw response 저장 없음
[ ] secret 원문 노출 없음
[ ] tenant/project scope 확인
[ ] p0-test-matrix 관련 항목 통과 또는 수동 검증 기록
[ ] 보안 리뷰 필요 여부 표시
[ ] rollback 또는 영향 범위 명시
```

---

## 10. 팀장 점검 질문

매일 팀장은 아래 질문만 집요하게 본다.

```text
- 오늘도 curl로 /v1/chat/completions가 도는가?
- Gateway가 API Key/App Token으로 요청 주체를 식별하는가?
- Provider 호출 전에 masking/block/cache가 적용되는가?
- cache hit에서 mock provider 호출이 생략되는가?
- raw prompt나 secret이 저장되는가?
- requestId로 Gateway -> Log -> Detail -> Dashboard까지 추적되는가?
- 새로운 기능이 P0 acceptance를 더 가깝게 만드는가?
```

