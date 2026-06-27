# Merge 1: 독립 구현 시작

## 목표

A~E가 동시에 구현을 시작한다.

이 단계의 목표는 각 역할이 자기 앱 또는 레이어를 독립적으로 실행 가능한 상태로 만드는 것이다.

## 에이전트 사용 방법

에이전트에게 여러 문서를 하나씩 첨부하지 않는다.

각 역할 에이전트에는 이 파일 하나와 자기 역할 프롬프트만 전달한다.

에이전트는 자기 역할 프롬프트의 `읽을 문서` 목록에 적힌 파일을 직접 열어서 확인한 뒤 작업한다.

만약 에이전트가 로컬 파일을 읽을 수 없는 환경이라면, 그때만 필요한 문서를 추가로 첨부한다.

## 공통 계약

- Gateway 외부 API는 OpenAI-compatible 형식을 유지한다.
- Control Plane API 응답은 `{ "data": ... }` envelope을 사용한다.
- API Key와 App Token 원문은 생성 응답에서 1회만 반환한다.
- DB에는 credential 원문을 저장하지 않고 hash와 prefix만 저장한다.
- 로그 API는 원문 prompt와 원문 response를 반환하지 않는다.
- P0에서는 Mock Provider만 사용한다.
- P0에서는 `stream=true`를 지원하지 않는다.
- P0에서는 Rate Limit, Budget hard block, Semantic Cache를 구현하지 않는다.
- Web은 Provider를 직접 호출하지 않고 Control Plane 또는 Gateway만 호출한다.
- 담당 영역 밖 파일은 최소한으로만 수정한다.

## 역할별 구현 프롬프트

### A: Control Plane API 시작

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-1-independent-start.md
- docs/p0/p0-contract.md
- docs/architecture/api-spec.md
- docs/architecture/db-schema.md
- docs/p0/p0-db-migration-plan.md

Merge 1 A 작업을 수행해줘.
apps/control-plane-api를 실행 가능한 API 서버로 만들고,
POST /api/tenants,
POST /api/projects,
POST /api/projects/:projectId/applications를 구현해줘.
응답은 반드시 { data: ... } envelope을 사용한다.
DB는 기존 PostgreSQL schema 계약을 따른다.
apps/web과 apps/gateway-core는 수정하지 않는다.
완료 기준은 Tenant, Project, Application 생성 API가 로컬에서 호출 가능한 것이다.
```

### B: Gateway Provider / Model 회귀

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-1-independent-start.md
- docs/p0/p0-contract.md
- docs/architecture/gateway-flow.md
- docs/p0/mock-provider.md
- docs/architecture/llm-log-schema.md

Merge 1 B 작업을 수행해줘.
기존 Go Gateway의 /v1/models와 /v1/chat/completions 흐름을 안정화해줘.
safe request가 Mock Provider를 거쳐 정상 응답과 request_id를 반환해야 한다.
Auth, Security, Cache 정책은 C/D 담당이므로 임의로 변경하지 않는다.
완료 기준은 Gateway safe request 1건이 정상 응답을 반환하는 것이다.
```

### C: Gateway DB Auth 골격

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-1-independent-start.md
- docs/p0/p0-contract.md
- docs/architecture/gateway-flow.md
- docs/architecture/db-schema.md
- docs/p0/a-day3-runtime-config.md

Merge 1 C 작업을 수행해줘.
기존 StaticCredentialStore interface를 최대한 유지하면서 PostgresCredentialStore 골격을 추가해줘.
API Key와 App Token hash 비교 로직을 만들고,
tenant_id, project_id, application_id scope mismatch를 판정할 수 있게 한다.
B/D 영역의 provider, security, cache 정책은 수정하지 않는다.
완료 기준은 fixture 또는 단위 테스트로 정상 credential과 잘못된 credential을 구분하는 것이다.
```

### D: Security / Cache 테스트 골격

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-1-independent-start.md
- docs/p0/p0-contract.md
- docs/architecture/gateway-flow.md
- docs/policies/pii-masking-policy.md
- docs/p0/p0-test-matrix.md

Merge 1 D 작업을 수행해줘.
개인정보 마스킹, 위험 정보 차단, Exact Cache 테스트 골격을 만들어줘.
이메일/전화번호는 redacted 처리되어야 한다.
API Key/JWT/주민등록번호 같은 위험 정보는 Provider 호출 전에 차단되어야 한다.
동일 요청 2회차는 Exact Cache hit가 가능해야 한다.
A/C/E 영역은 수정하지 않는다.
완료 기준은 security/cache 테스트가 실행 가능한 것이다.
```

### E: Web Console 시작

```text
읽을 문서:
- AGENTS.md
- docs/p0/one-day/merge-1-independent-start.md
- docs/p0/p0-contract.md
- docs/architecture/dashboard-metrics.md
- docs/architecture/api-spec.md
- docs/p0/demo-acceptance.md

Merge 1 E 작업을 수행해줘.
apps/web을 실행 가능한 Web Console로 만들고,
온보딩, 키 발급, 고객사 앱 연동 데모, 로그, 대시보드 페이지 라우팅을 만든다.
API가 아직 완성되지 않은 부분은 mock client로 분리한다.
Gateway나 Control Plane 내부 코드는 수정하지 않는다.
완료 기준은 Web dev server가 뜨고 주요 페이지 이동이 가능한 것이다.
```

## 머지 후 통과해야 할 테스트 리스트

- A: Tenant 생성 API 호출 가능
- A: Project 생성 API 호출 가능
- A: Application 생성 API 호출 가능
- B: `/v1/models` 응답 가능
- B: `/v1/chat/completions` safe request 성공
- C: 정상 credential과 잘못된 credential 구분 가능
- D: 마스킹 테스트 실행 가능
- D: 차단 테스트 실행 가능
- D: Exact Cache 테스트 실행 가능
- E: Web dev server 실행 가능
- E: 온보딩, 키 발급, 로그, 대시보드 페이지 이동 가능

## 머지 후 Codex 검증 요청 프롬프트

```text
Merge 1 구현이 끝났어.
docs/p0/one-day/merge-1-independent-start.md 기준으로 구현 상황을 검증해줘.
가능한 자동 테스트를 먼저 실행하고,
통과/실패/미구현/수동확인 필요 항목을 표로 정리해줘.
계약 위반, 원문 secret 저장, 담당 영역 침범이 있는지도 확인해줘.
```
