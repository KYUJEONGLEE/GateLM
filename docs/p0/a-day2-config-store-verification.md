# A Day2 Config Store Verification

## 1. 목적

이 문서는 Day2 A파트에서 만든 PostgreSQL migration과 P0 demo seed가 Day1 active config fixture와 같은 기준으로 동작하는지 검증한 기록이다.

검증 기준은 다음과 같다.

- Day1 fixture가 JSON으로 정상 파싱된다.
- P0 demo seed가 PostgreSQL에 정상 적용된다.
- seed를 반복 실행해도 중복 row가 생기지 않는다.
- Gateway가 사용할 tenant, project, application, credential metadata, provider, model, pricing 기준 데이터가 존재한다.
- API Key, App Token, Provider Key 원문과 raw prompt/response를 DB schema나 seed에 저장하지 않는다.

---

## 2. 검증 대상 파일

```text
docs/p0/a-day1-active-config.fixture.json
db/migrations/001_create_identity_tables.sql
db/migrations/002_create_project_tables.sql
db/migrations/003_create_gateway_credentials.sql
db/migrations/004_create_provider_and_models.sql
db/migrations/005_harden_config_store_constraints.sql
db/seeds/001_seed_p0_demo_data.sql
```

---

## 3. 실행한 검증 명령

### 3.1 Fixture JSON 파싱

```powershell
Get-Content .\docs\p0\a-day1-active-config.fixture.json -Raw | ConvertFrom-Json | Out-Null
```

결과:

```text
fixture json ok
```

### 3.2 금지 문자열 검색

```powershell
rg -n "raw_prompt|raw_response|provider_api_key|api_key_plaintext|app_token_plaintext|authorization_header|sk-|AKIA|BEGIN PRIVATE KEY|Bearer " .\db .\docs\p0\a-day2-config-store-scope.md
```

결과:

```text
검색 결과 없음
```

### 3.3 PostgreSQL 상태 확인

```powershell
docker compose ps
```

결과:

```text
gatelm-postgres-1   postgres:16   Up   healthy   5432
```

### 3.4 Seed 재적용

```powershell
Get-Content .\db\seeds\001_seed_p0_demo_data.sql -Raw |
  docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1
```

결과:

```text
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 1
INSERT 0 3
INSERT 0 3
```

의미:

- seed SQL은 `on conflict (id) do update` 기준으로 작성되어 반복 실행 가능하다.
- 같은 seed를 다시 적용해도 중복 row가 생기지 않는다.

---

## 4. DB 검증 결과

### 4.1 Row Count

```text
api_keys             1
applications         1
app_tokens           1
model_catalog        3
model_pricing_rules  3
projects             1
provider_connections 1
tenants              1
users                1
```

### 4.2 Tenant / Project / Application 연결

```text
tenant_id:       00000000-0000-4000-8000-000000000100
tenant_name:     Acme Corp
project_id:      00000000-0000-4000-8000-000000000200
project_name:    CampaignBot
application_id:  00000000-0000-4000-8000-000000000300
application_name: CampaignBot Web
```

### 4.3 Project Settings

```text
project:          CampaignBot
default_provider: mock
default_model:    mock-balanced
securityPolicyHash: sec_p0_v1
routingPolicyHash:  route_p0_v1
cachePolicyHash:    cache_p0_v1
```

### 4.4 Credential 저장 기준

```text
api key prefix:   glm_api_p0_demo
api key hash:     local-demo-api-key-hash-placeholder
app token prefix: glm_app_p0_demo
app token hash:   local-demo-app-token-hash-placeholder
provider secret_ref: local/mock-provider/no-secret-required
credential_preview:  mock-provider
```

원문 API Key, 원문 App Token, 원문 Provider Key는 저장하지 않는다.

### 4.5 Provider / Model / Pricing

```text
provider: mock
default model: mock-balanced
models:
- mock-fast
- mock-balanced
- mock-smart
pricing version: p0-demo
currency: USD
effective_from: 2024-01-01 00:00:00+00
```

### 4.6 Constraint / Index 검증

아래 제약과 인덱스가 존재해야 한다.

```text
ux_projects_id_tenant_id
fk_applications_project_tenant
ix_api_keys_application_id
ix_app_tokens_application_id
ux_model_catalog_provider_model
fk_model_pricing_rules_model_catalog
```

### 4.7 금지 컬럼 검증

아래 컬럼은 public schema에 존재하지 않는다.

```text
raw_prompt
raw_response
provider_api_key
api_key_plaintext
app_token_plaintext
authorization_header
```

검증 결과:

```text
0 rows
```

---

## 5. B/C/D/E 파트가 가정해도 되는 기준

- P0 demo tenant는 `Acme Corp` 하나다.
- P0 demo project는 `CampaignBot` 하나다.
- P0 demo application은 `CampaignBot Web` 하나다.
- Gateway API Key와 App Token은 원문이 아니라 prefix/hash metadata로만 존재한다.
- Mock Provider는 `mock` provider와 `mock-balanced` 기본 모델을 사용한다.
- 모델 catalog에는 `mock-fast`, `mock-balanced`, `mock-smart`가 존재한다.
- 정책 hash는 project settings에 `sec_p0_v1`, `route_p0_v1`, `cache_p0_v1`로 존재한다.

---

## 6. 완료 판단

Day2 A파트 4단계 기준으로 다음 조건을 만족했다.

- migration 5개가 PostgreSQL에서 사용할 수 있는 table 구조와 정합성 제약을 제공한다.
- seed 1개가 P0 E2E 기준 데이터를 채운다.
- seed는 반복 실행 가능하다.
- seed의 pricing `effective_from`은 `2024-01-01 00:00:00+00` 고정값을 사용한다.
- fixture JSON은 파싱 가능하다.
- seed와 DB schema에는 금지된 raw payload/key 원문 저장 구조가 없다.
- B/C/D/E가 Day1 fixture와 Day2 seed를 같은 기준으로 보고 병렬 개발할 수 있다.
