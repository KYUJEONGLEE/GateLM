# A Day2 Config Store Scope

## 1. 목적

Day2 A파트는 Day1에서 만든 fixture 기반 계약을 실제 DB seed와 Gateway용 active config 조회 흐름으로 옮기기 위한 준비 단계다.

Day2 1단계에서는 migration이나 API를 바로 추가하지 않는다.
먼저 아래 기준을 고정한다.

```text
Day1 fixture
-> PostgreSQL seed data
-> active project config response
-> Redis project config cache
-> Gateway B/C/D/E consumer
```

이 문서는 A가 Day2에서 만들 설정 저장소의 범위와 다음 단계 작업 순서를 정의한다.

---

## 2. Day2 A파트 4단계

| 단계 | 이름 | 목표 | 산출물 |
|---|---|---|---|
| 1 | DB/계약 기준 확인 | Day1 fixture를 DB/API/Redis 기준으로 매핑한다 | 이 문서 |
| 2 | Migration 작성 | P0 필수 Control Plane 테이블을 만든다 | SQL migration |
| 3 | Seed 작성 | demo tenant/project/application/key/token/provider/model/pricing을 넣는다 | seed script 또는 SQL |
| 4 | 검증/문서 업데이트 | fixture와 DB seed가 같은 active config를 만들 수 있는지 확인한다 | 검증 명령, 문서 보강 |

---

## 3. A가 Day2에서 책임지는 범위

A는 Gateway가 요청을 처리할 때 필요한 기준 데이터를 제공한다.

포함 범위:

```text
tenant
admin user
tenant membership
project
project membership
application
gateway api key metadata
app token metadata
provider connection metadata
model catalog
model pricing rules
security/routing/cache policy hash 또는 JSON config
active project config shape
```

P0에서 API 구현이 늦어질 경우에도 seed data와 active config fixture만으로 B/C/D/E가 계속 개발할 수 있어야 한다.

---

## 4. A가 Day2 1단계에서 만들지 않는 것

이번 단계에서 아래는 만들지 않는다.

```text
Control Plane API handler
실제 API Key/App Token 발급 로직
Provider Key 암호화 저장
Redis config cache 구현
Gateway에서 DB를 직접 조회하는 adapter
Rate Limit / Budget table
Policy publish / rollback table
실제 외부 Provider credential
```

이 단계의 목적은 구현 전 기준 고정이다.

---

## 5. Day1 Fixture -> DB Table 매핑

| Fixture 영역 | DB 기준 | 비고 |
|---|---|---|
| `tenant` | `tenants` | tenant scope의 기준 |
| `adminUser` | `users` | seed admin, 실제 비밀번호 원문 저장 금지 |
| admin membership | `tenant_memberships` | fixture에는 별도 객체가 없지만 Day1 seed contract에 있음 |
| `project` | `projects` | Gateway log/cache/routing의 project scope |
| project membership | `project_memberships` | fixture에는 별도 객체가 없지만 Day1 seed contract에 있음 |
| `application` | `applications` | App Token과 request context 기준 |
| `credentials.apiKey` | `api_keys` | 원문 key 저장 금지, prefix/hash만 저장 |
| `credentials.appToken` | `app_tokens` | 원문 token 저장 금지, prefix/hash만 저장 |
| `providerConnections[]` | `provider_connections` | P0는 mock provider, `secret_ref`만 저장 |
| `modelCatalog[]` | `model_catalog` | provider/model string을 enum으로 고정하지 않음 |
| `pricingRules[]` | `model_pricing_rules` | mock usage cost 계산 기준 |
| `policies.security` | P0 JSON config 또는 future policy table | P0에서는 hash/config로 충분 |
| `policies.routing` | P0 JSON config 또는 future policy table | simple routing 기준 |
| `policies.cache` | P0 JSON config 또는 future policy table | exact cache 기준 |

P0 필수 DB table은 `docs/p0/p0-db-migration-plan.md`의 migration 순서를 우선한다.
`budget_policies`, `rate_limit_rules`, policy versioning table은 P1/P2 성격이므로 Day2 1차 구현 대상이 아니다.

---

## 6. Active Config 응답 기준

Gateway가 원하는 active config는 DB row를 그대로 노출하는 것이 아니라 요청 처리에 필요한 값을 묶은 runtime view다.

P0 active config 최소 shape:

```json
{
  "tenantId": "00000000-0000-4000-8000-000000000100",
  "projectId": "00000000-0000-4000-8000-000000000200",
  "applicationId": "00000000-0000-4000-8000-000000000300",
  "apiKeyId": "00000000-0000-4000-8000-000000000400",
  "appTokenId": "00000000-0000-4000-8000-000000000500",
  "providerConnections": [],
  "modelCatalog": [],
  "pricingRules": [],
  "policies": {
    "security": {},
    "routing": {},
    "cache": {}
  },
  "redisKeys": {}
}
```

실제 응답 구조의 source of truth는 아래 fixture다.

```text
docs/p0/a-day1-active-config.fixture.json
```

Day2 구현은 이 fixture와 호환되는 형태를 유지해야 한다.

---

## 7. Redis Config Cache 기준

P0 Redis keyspace는 아래 기준을 따른다.

| 목적 | Key pattern | TTL |
|---|---|---:|
| Active project config | `gatelm:config:project:{projectId}` | 300초 |

Day2 1단계에서는 Redis 구현을 하지 않는다.
다만 DB에서 만든 active config가 나중에 이 key에 저장될 수 있는 shape이어야 한다.

Redis value에도 아래 값은 넣지 않는다.

```text
raw prompt
raw response
API Key 원문
App Token 원문
Provider Key 원문
Authorization header 원문
```

---

## 8. Secret / Credential 저장 기준

Day2 A파트는 credential 원문을 DB에 저장하지 않는다.

| 대상 | 저장 가능 | 저장 금지 |
|---|---|---|
| Gateway API Key | `key_prefix`, `key_hash`, scopes, status | 원문 API Key |
| App Token | `token_prefix`, `token_hash`, scopes, status | 원문 App Token |
| Provider credential | `secret_ref`, `credential_preview` | 원문 Provider Key |

Seed script가 로컬 데모용 원문 key/token을 출력해야 한다면, 출력은 1회성으로만 허용하고 문서/fixture/로그에는 남기지 않는다.

---

## 9. 다음 단계에서 만들 Migration 후보

Day2 2단계 migration은 아래 순서를 따른다.

```text
001_create_identity_tables
002_create_project_tables
003_create_gateway_credentials
004_create_provider_and_models
005_create_usage_and_audit_tables_optional
006_create_p0_invocation_logs_fallback
007_seed_demo_data
```

Day2 2단계에서 실제 생성한 P0 A파트 migration 파일:

```text
db/migrations/001_create_identity_tables.sql
db/migrations/002_create_project_tables.sql
db/migrations/003_create_gateway_credentials.sql
db/migrations/004_create_provider_and_models.sql
db/migrations/005_harden_config_store_constraints.sql
```

`005_harden_config_store_constraints.sql`는 PR review 반영용 보강 migration이다.

포함 내용:

```text
projects(id, tenant_id) composite unique constraint
applications(project_id, tenant_id) -> projects(id, tenant_id) composite foreign key
api_keys(application_id) index
app_tokens(application_id) index
model_catalog(provider, model) explicit unique constraint
model_pricing_rules(provider, model) -> model_catalog(provider, model) foreign key
```

Day2 3단계에서 실제 생성한 P0 demo seed 파일:

```text
db/seeds/001_seed_p0_demo_data.sql
```

Day2 A파트에서 우선 고려할 최소 table:

```text
users
tenants
tenant_memberships
projects
project_memberships
applications
api_keys
app_tokens
provider_connections
model_catalog
model_pricing_rules
```

`p0_llm_invocation_logs`는 E파트와 연결되므로 migration owner를 조율해야 한다.

---

## 10. 검증 방법

PowerShell 기준:

```powershell
Test-Path .\docs\p0\a-day2-config-store-scope.md
Get-Content .\docs\p0\a-day1-active-config.fixture.json -Raw | ConvertFrom-Json | Out-Null
rg -n "tenants|projects|applications|api_keys|app_tokens|provider_connections|model_catalog|model_pricing_rules" .\docs\p0\a-day2-config-store-scope.md
rg -n "raw prompt|raw response|Provider Key 원문|API Key 원문|App Token 원문" .\docs\p0\a-day2-config-store-scope.md
```

검증 포인트:

- fixture JSON이 파싱된다.
- Day1 fixture 영역이 DB table로 매핑되어 있다.
- API/DB/Event 변경이 이번 단계에 없다는 점이 명확하다.
- secret/raw payload 저장 금지 기준이 유지된다.

---

## 11. 완료 기준

- Day2 A파트의 config store 구현 범위가 문서화되어 있다.
- Day1 fixture와 DB table의 연결이 설명되어 있다.
- 다음 단계인 migration 작성 범위가 정리되어 있다.
- B/C/D/E가 계속 Day1 fixture shape을 기준으로 병렬 개발할 수 있다.

---

## 12. Day2 4단계 검증 문서

Day2 4단계에서 migration과 seed 적용 결과를 아래 문서에 기록했다.

```text
docs/p0/a-day2-config-store-verification.md
```

이 문서는 다음 내용을 포함한다.

- Day1 active config fixture JSON 파싱 검증
- P0 demo seed 반복 적용 검증
- 주요 table row count 검증
- tenant/project/application 연결 검증
- provider/model/pricing 기준 데이터 검증
- API Key/App Token/Provider Key 원문 미저장 검증
- raw prompt/raw response 금지 컬럼 미존재 검증
- tenant/project/application composite constraint 검증
- application_id 조회 index 검증
- model pricing 참조 무결성 검증
- seed pricing effective_from 고정값 검증
