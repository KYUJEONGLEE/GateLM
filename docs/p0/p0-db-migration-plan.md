# GateLM P0 DB Migration Plan v0.1

## 문서 목적

이 문서는 GateLM P0 구현에 필요한 DB migration 범위를 확정한다. 기존 `db-schema.md`는 장기 제품 테이블을 포함한다. 이 문서는 3~5일 데모 필수 구현에 필요한 최소 테이블만 남긴다.

---

## 1. P0 DB 원칙

```text
1. P0는 Control Plane 동작과 Gateway request log 조회에 필요한 테이블만 만든다.
2. Provider/Model은 DB enum으로 고정하지 않는다.
3. 비용은 float가 아니라 micro USD integer로 저장한다.
4. API Key/App Token/Provider Key 원문은 저장하지 않는다.
5. raw prompt/raw response는 저장하지 않는다.
6. Tenant-scoped table은 tenant_id를 포함한다.
7. 삭제는 기본 soft delete 또는 revoke다.
```

---

## 2. P0 저장소 선택

### 2.1 필수

```text
PostgreSQL
Redis
```

### 2.2 선택

```text
ClickHouse: P1 권장. P0에서 안정화되면 사용.
Redpanda: P1 권장. P0에서 안정화되면 사용.
S3-compatible Object Storage: P2.
AWS Secrets Manager + KMS: P2.
```

---

## 3. PostgreSQL P0 테이블 목록

| 순서 | 테이블 | P0 필요 이유 | 우선순위 |
|---:|---|---|---|
| 1 | `users` | seed admin 또는 local login | 높음 |
| 2 | `tenants` | 조직 scope. seed 허용 | 낮음 |
| 3 | `tenant_memberships` | tenant 권한. seed 허용 | 낮음 |
| 4 | `projects` | Gateway 사용량/정책 단위. seed 허용 | 낮음 |
| 5 | `project_memberships` | project 권한. seed 허용 | 낮음 |
| 6 | `applications` | 고객사 앱 단위. seed 허용 | 낮음 |
| 7 | `api_keys` | Gateway 인증 | 높음 |
| 8 | `app_tokens` | Application 접근 제어. seed 허용 | 중간 |
| 9 | `provider_connections` | Mock Provider 연결 metadata | 높음 |
| 10 | `model_catalog` | `/v1/models`, routing 후보. mock catalog 가능 | 낮음 |
| 11 | `model_pricing_rules` | 예상 비용 계산. mock pricing 가능 | 중간 |
| 12 | `usage_ledger_entries` | 비용/토큰 ledger 최소. P0에서는 생략 가능 | 중간 |
| 13 | `audit_logs` | key/provider/policy 변경 감사. P0에서는 생략 가능 | 낮음 |
| 14 | `p0_llm_invocation_logs` | ClickHouse 미사용 시 request log fallback | 높음 |

3~5일 P0 필수 migration은 `api_keys`, `app_tokens`, `provider_connections`, `p0_llm_invocation_logs`와 seed 기반 identity/project/application context를 우선한다.
`budget_policies`, `rate_limit_rules`는 P1 준비 테이블이며 P0 필수 migration이 아니다.

3~5일 P0 필수 migration에서 제외:

```text
groups
group_memberships
tenant_invitations
runtime_policies
runtime_policy_versions
policy_bindings
routing_rules
sensitive_data_rules
quota_rules
budget_policies
rate_limit_rules
budget_ledger_entries
conversations
chat_messages
outbox_events
alert_rules
alert_events
webhook_endpoints
```

단, P1/P2에서 추가할 수 있도록 schema 설계와 code structure는 막지 않는다. 이 문서의 P1 준비 DDL은 선택 구현용 참고로만 사용한다.

---

## 4. 공통 Column 기준

### 4.1 Mutable table

```sql
id uuid primary key,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
deleted_at timestamptz null
```

### 4.2 Append-only table

```sql
id uuid primary key,
created_at timestamptz not null default now()
```

### 4.3 Tenant scope

Tenant 데이터는 가능한 한 `tenant_id`를 가진다.

```sql
tenant_id uuid not null references tenants(id)
```

---

## 5. P0 Table Detail

### 5.1 `users`

```sql
create table users (
  id uuid primary key,
  email text not null,
  name text null,
  password_hash text null,
  auth_provider text not null default 'local',
  status text not null default 'active',
  last_login_at timestamptz null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_users_email_active
  on users (lower(email))
  where deleted_at is null;
```

### 5.2 `tenants`

```sql
create table tenants (
  id uuid primary key,
  name text not null,
  slug text not null,
  plan text not null default 'starter',
  status text not null default 'active',
  default_timezone text not null default 'Asia/Seoul',
  default_currency text not null default 'USD',
  settings jsonb not null default '{}',
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_tenants_slug_active
  on tenants (slug)
  where deleted_at is null;
```

### 5.3 `tenant_memberships`

```sql
create table tenant_memberships (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role text not null,
  status text not null default 'active',
  joined_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_tenant_memberships_tenant_user_active
  on tenant_memberships (tenant_id, user_id)
  where deleted_at is null;

create index ix_tenant_memberships_user
  on tenant_memberships (user_id, status);
```

### 5.4 `projects`

```sql
create table projects (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  slug text not null,
  description text null,
  status text not null default 'active',
  default_provider text null,
  default_model text null,
  settings jsonb not null default '{}',
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_projects_tenant_slug_active
  on projects (tenant_id, slug)
  where deleted_at is null;

create index ix_projects_tenant_status
  on projects (tenant_id, status);
```

### 5.5 `project_memberships`

```sql
create table project_memberships (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_project_memberships_project_user_active
  on project_memberships (project_id, user_id)
  where deleted_at is null;

create index ix_project_memberships_tenant_user
  on project_memberships (tenant_id, user_id, status);
```

### 5.6 `applications`

```sql
create table applications (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  name text not null,
  slug text not null,
  type text not null default 'customer_app',
  status text not null default 'active',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_applications_project_slug_active
  on applications (project_id, slug)
  where deleted_at is null;

create index ix_applications_tenant_project_status
  on applications (tenant_id, project_id, status);
```

### 5.7 `api_keys`

```sql
create table api_keys (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  application_id uuid null references applications(id),
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes jsonb not null default '[]',
  status text not null default 'active',
  expires_at timestamptz null,
  last_used_at timestamptz null,
  created_by_user_id uuid null references users(id),
  revoked_by_user_id uuid null references users(id),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_api_keys_key_hash on api_keys (key_hash);
create index ix_api_keys_prefix on api_keys (key_prefix);
create index ix_api_keys_tenant_project_status
  on api_keys (tenant_id, project_id, status);
```

원문 key 저장 금지.

### 5.8 `app_tokens`

```sql
create table app_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  application_id uuid not null references applications(id),
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  scopes jsonb not null default '[]',
  status text not null default 'active',
  expires_at timestamptz null,
  last_used_at timestamptz null,
  created_by_user_id uuid null references users(id),
  revoked_by_user_id uuid null references users(id),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index ux_app_tokens_token_hash on app_tokens (token_hash);
create index ix_app_tokens_prefix on app_tokens (token_prefix);
create index ix_app_tokens_tenant_project_status
  on app_tokens (tenant_id, project_id, status);
```

원문 token 저장 금지.

### 5.9 `provider_connections`

```sql
create table provider_connections (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid null references projects(id),
  name text not null,
  provider text not null,
  base_url text null,
  status text not null default 'active',
  default_model text null,
  secret_ref text not null,
  credential_preview text null,
  config jsonb not null default '{}',
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index ix_provider_connections_tenant_project_status
  on provider_connections (tenant_id, project_id, status);

create index ix_provider_connections_provider_status
  on provider_connections (provider, status);
```

Provider credential 원문 저장 금지. P0는 `secret_ref`에 local resolver ref를 저장한다.

### 5.10 `model_catalog`

```sql
create table model_catalog (
  id uuid primary key,
  provider text not null,
  model text not null,
  display_name text null,
  capabilities jsonb not null default '[]',
  context_window_tokens int null,
  status text not null default 'active',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ux_model_catalog_provider_model
  on model_catalog (provider, model);

create index ix_model_catalog_provider_status
  on model_catalog (provider, status);
```

### 5.11 `model_pricing_rules`

P0는 단순 pricing rule로 충분하다.

```sql
create table model_pricing_rules (
  id uuid primary key,
  provider text not null,
  model text not null,
  currency text not null default 'USD',
  input_micro_usd_per_1m_tokens bigint not null,
  output_micro_usd_per_1m_tokens bigint not null,
  pricing_version text not null default 'p0',
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  source text null,
  created_at timestamptz not null default now()
);

create index ix_model_pricing_rules_lookup
  on model_pricing_rules (provider, model, effective_from desc, effective_to);
```

### 5.12 `budget_policies` — P1 준비

```sql
create table budget_policies (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  target_type text not null,
  target_id uuid not null,
  period text not null default 'monthly',
  budget_micro_usd bigint not null,
  warn_threshold_ratio numeric(5,4) not null default 0.8000,
  block_threshold_ratio numeric(5,4) not null default 1.0000,
  action_on_exceed text not null default 'block',
  status text not null default 'active',
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index ix_budget_policies_target
  on budget_policies (tenant_id, target_type, target_id, status, period);
```

P1 Budget Hard Block 선택 시 사용한다. 3~5일 P0 필수 migration은 아니다.

### 5.13 `rate_limit_rules` — P1 준비

```sql
create table rate_limit_rules (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  target_type text not null,
  target_id uuid not null,
  limit_type text not null,
  limit_value bigint not null,
  window_seconds int not null,
  action text not null default 'block',
  status text not null default 'active',
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index ix_rate_limit_rules_target
  on rate_limit_rules (tenant_id, target_type, target_id, status, limit_type);
```

P1 Rate Limit 선택 시 사용한다. 3~5일 P0 필수 migration은 아니다.

### 5.14 `usage_ledger_entries`

```sql
create table usage_ledger_entries (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid null references projects(id),
  application_id uuid null references applications(id),
  user_id uuid null references users(id),
  api_key_id uuid null references api_keys(id),
  app_token_id uuid null references app_tokens(id),
  request_id text not null,
  event_time timestamptz not null,
  provider text null,
  model text null,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  cost_micro_usd bigint not null default 0,
  cache_status text not null default 'bypass',
  entry_type text not null default 'debit',
  source text not null default 'gateway_event',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create unique index ux_usage_ledger_entries_request_entry
  on usage_ledger_entries (request_id, entry_type, source);

create index ix_usage_ledger_project_time
  on usage_ledger_entries (tenant_id, project_id, event_time desc);
```

### 5.15 `audit_logs`

```sql
create table audit_logs (
  id uuid primary key,
  tenant_id uuid null references tenants(id),
  actor_user_id uuid null references users(id),
  actor_type text not null,
  action text not null,
  resource_type text not null,
  resource_id uuid null,
  before jsonb null,
  after jsonb null,
  ip_address text null,
  user_agent text null,
  request_id text null,
  created_at timestamptz not null default now()
);

create index ix_audit_logs_tenant_created
  on audit_logs (tenant_id, created_at desc);

create index ix_audit_logs_resource
  on audit_logs (tenant_id, resource_type, resource_id, created_at desc);
```

`before/after`에 secret/raw prompt를 넣지 않는다.

### 5.16 `p0_llm_invocation_logs`

P0 canonical request log table이다. Dashboard, Request Log, Request Detail은 이 테이블을 기준으로 조회한다. ClickHouse를 optional mirror로 붙이더라도 P0 완료 판단은 이 테이블의 값을 기준으로 한다.

```sql
create table p0_llm_invocation_logs (
  id uuid primary key,
  request_id text not null,
  trace_id text not null,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  application_id uuid null references applications(id),
  api_key_id uuid null references api_keys(id),
  app_token_id uuid null references app_tokens(id),
  end_user_id text null,
  feature_id text null,
  endpoint text not null,
  method text not null,
  source text not null,
  stream boolean not null default false,
  requested_provider text null,
  requested_model text null,
  provider text not null default '',
  model text not null default '',
  selected_provider text null,
  selected_model text null,
  routing_reason text null,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  cost_micro_usd bigint not null default 0,
  saved_cost_micro_usd bigint not null default 0,
  latency_ms int not null default 0,
  provider_latency_ms int null,
  status text not null,
  http_status int not null,
  error_code text null,
  error_message text null,
  error_stage text null,
  cache_status text not null default 'bypass',
  cache_type text not null default 'none',
  cache_key_hash text null,
  cache_hit_request_id text null,
  masking_action text not null default 'none',
  masking_detected_types jsonb not null default '[]',
  masking_detected_count int not null default 0,
  request_body_hash text not null,
  prompt_hash text not null,
  redacted_prompt_preview text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null,
  completed_at timestamptz null,
  ingested_at timestamptz not null default now()
);

create unique index ux_p0_llm_invocation_logs_request_id
  on p0_llm_invocation_logs (request_id);

create index ix_p0_llm_invocation_logs_project_created
  on p0_llm_invocation_logs (tenant_id, project_id, created_at desc);

create index ix_p0_llm_invocation_logs_status_created
  on p0_llm_invocation_logs (tenant_id, status, created_at desc);
```

금지:

```text
raw_prompt column 추가 금지
raw_response column 추가 금지
provider_api_key column 추가 금지
api_key_plaintext column 추가 금지
app_token_plaintext column 추가 금지
```

---

## 6. ClickHouse P0 Optional DDL

ClickHouse를 P0에서 쓸 수 있으면 최소 `llm_invocations`만 만든다.

```sql
create table if not exists llm_invocations (
  event_date Date,
  created_at DateTime64(3, 'UTC'),
  request_id String,
  trace_id String,
  tenant_id String,
  project_id String,
  application_id Nullable(String),
  api_key_id Nullable(String),
  app_token_id Nullable(String),
  endpoint String,
  provider String,
  model String,
  requested_model Nullable(String),
  selected_model Nullable(String),
  status String,
  http_status UInt16,
  error_code Nullable(String),
  error_message Nullable(String),
  prompt_tokens UInt64,
  completion_tokens UInt64,
  total_tokens UInt64,
  cost_micro_usd Int64,
  saved_cost_micro_usd Int64,
  latency_ms UInt32,
  provider_latency_ms Nullable(UInt32),
  cache_status String,
  cache_type String,
  routing_reason Nullable(String),
  masking_action String,
  masking_detected_types Array(String),
  masking_detected_count UInt32,
  redacted_prompt_preview Nullable(String),
  metadata String,
  ingested_at DateTime64(3, 'UTC')
)
engine = MergeTree
partition by event_date
order by (tenant_id, project_id, created_at, request_id);
```

---

## 7. Redis Keyspace P0

| 목적 | Key pattern | TTL |
|---|---|---:|
| API Key validation cache | `gatelm:auth:api_key:{keyHash}` | 5m |
| App Token validation cache | `gatelm:auth:app_token:{tokenHash}` | 5m |
| Active project config | `gatelm:config:project:{projectId}` | 5m 또는 publish 갱신 |
| Exact cache | `gatelm:cache:exact:{cacheKeyHash}` | policy TTL |
| Rate limit counter | `gatelm:rl:{target}:{window}` | P1 Rate Limit 선택 시 사용 |

Redis value에도 raw prompt를 넣지 않는다.

---

## 8. Migration 순서

```text
001_create_identity_tables
002_create_project_tables
003_create_gateway_credentials
004_create_provider_and_models
005_create_usage_and_audit_tables_optional
006_create_p0_invocation_logs_fallback
007_seed_demo_data
P1 이후: create_limit_and_budget_tables
```

한 migration에 모든 것을 몰아넣지 않는다.

---

## 9. Seed 필수 데이터

```text
- admin user
- tenant
- tenant membership
- project
- project membership
- application
- mock provider connection
- mock model catalog: mock-fast, mock-balanced, mock-smart
- mock pricing rules
- gateway api key metadata
- app token metadata
```

Seed output:

```text
- control plane login email/password
- gateway api key plaintext, local only
- app token plaintext, local only
```

Seed output 파일은 gitignore 대상이다.

---

## 10. Review 필요 기준

```text
[ ] key_hash/token_hash 저장 방식 보안 리뷰
[ ] provider secret_ref 처리 보안 리뷰
[ ] p0_llm_invocation_logs에 raw column이 없는지 확인
[ ] tenant/project scope index 확인
[ ] costMicroUsd bigint 사용 확인
[ ] destructive migration 없음 확인
```
