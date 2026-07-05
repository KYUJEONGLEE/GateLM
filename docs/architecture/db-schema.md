# GateLM DB Schema

> v1.0.0 범위 안내: 이 문서는 장기 DB 설계를 포함한다. 현재 구현할 DB 범위와 우선 계약은 `docs/archive/v1.0.0/contracts.md`와 `docs/archive/v1.0.0/implementation-plan.md`를 따른다. 이 문서의 `P0`, `MVP`, `필수`, `P1/P2` 표현이 v1.0.0 문서와 충돌하면 v1.0.0 문서를 우선한다. 과거 P0 DB 계획은 `docs/archive/p0/p0-db-migration-plan.md`에서 참고한다.

## 문서 목적

이 문서는 GateLM에서 Prisma, TypeORM, SQL migration, seed, repository, query 구현 시 기준으로 삼는 DB 설계 문서다.

GateLM은 단순 Chat UI가 아니라 LLM Gateway 플랫폼이므로, DB도 다음 기준으로 분리한다.

- **PostgreSQL**: Control Plane의 원천 데이터. Tenant, User, Project, Credential metadata, Policy, Budget, Audit, Ledger를 저장한다.
- **ClickHouse**: Gateway 호출 로그와 분석 데이터. Request Log, Attempt Log, Dashboard, Detail Drawer 조회에 사용한다.
- **Redis**: 짧은 수명 상태. Rate Limit counter, Quota counter, active policy cache, exact cache, circuit state를 저장한다.
- **S3-compatible Object Storage**: redacted payload, response summary, export artifact를 저장한다.
- **AWS Secrets Manager + KMS**: Provider API Key 원문을 저장한다. PostgreSQL에는 secret reference만 저장한다.

DB 설계의 핵심은 **확장 가능성**이다. Provider, Model, Policy, Deployment mode, Application, Tenant 규모가 늘어나도 핵심 테이블을 갈아엎지 않도록 설계한다.

민감정보 관련 저장 금지 field, masking event 의미, raw prompt/raw response 저장 제한은 `pii-masking-policy.md`와 `llm-log-schema.md`를 함께 따른다.

---

# 1. 공통 설계 원칙

## 1.1 Naming Convention

DB 실제 이름은 `snake_case`를 사용한다.

```text
PostgreSQL table: tenant_memberships
PostgreSQL column: created_at
TypeScript field: createdAt
Prisma model: TenantMembership
TypeORM entity: TenantMembershipEntity
```

ORM에서 camelCase를 쓰더라도 DB column은 `snake_case`로 mapping한다.

## 1.2 ID 기준

모든 주요 테이블의 Primary Key는 `uuid`를 사용한다.

권장:

```text
id uuid primary key
```

생성 방식:

- 가능하면 애플리케이션에서 UUIDv7 생성
- 불가능하면 PostgreSQL `gen_random_uuid()` 사용
- 외부 API 응답에서는 필요 시 `tenant_xxx`, `project_xxx` 같은 prefix ID를 별도 표시 필드로 둘 수 있지만, DB PK는 uuid로 통일한다.

## 1.3 Multi-tenancy 기준

Tenant 소속 데이터는 반드시 `tenant_id`를 가진다.

예외:

- `users`: 전역 사용자 계정
- `model_catalog`: 전역 모델 카탈로그
- `outbox_events`: 시스템 이벤트이지만 가능하면 `tenant_id` nullable 포함

Tenant-scoped 테이블의 주요 index는 대부분 `tenant_id`로 시작한다.

```text
좋음:   index (tenant_id, project_id, status)
나쁨:   index (status) only
```

## 1.4 created_at / updated_at 기준

모든 PostgreSQL 테이블은 아래 기준을 따른다.

### Mutable table

수정 가능한 테이블은 반드시 아래 필드를 가진다.

```sql
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
deleted_at timestamptz null
```

대상:

- tenants
- users
- projects
- applications
- provider_connections
- policies
- budgets
- conversations

`updated_at`은 애플리케이션 또는 DB trigger에서 update 시 자동 갱신한다.

### Append-only table

감사, 로그, ledger, event, immutable version 테이블은 기본적으로 update하지 않는다.

```sql
created_at timestamptz not null default now()
```

대상:

- audit_logs
- usage_ledger_entries
- budget_ledger_entries
- runtime_policy_versions
- provider_key_versions
- outbox_events

Append-only 테이블에는 `updated_at`을 두지 않는다. ORM 일관성을 위해 꼭 필요하면 넣을 수 있지만, 구현에서는 update를 금지한다.

## 1.5 삭제 기준

기본은 **soft delete**다.

```text
삭제 요청
-> status 변경 또는 deleted_at 기록
-> Gateway active config에서 제외
-> retention 기간 후 hard delete 또는 anonymize
```

Hard delete는 아래 경우에만 허용한다.

- 잘못 생성된 seed/test 데이터
- 아직 외부 요청과 연결되지 않은 draft 데이터
- retention 기간이 지난 payload object
- 명시적 tenant purge 작업

감사 로그와 비용 ledger는 원칙적으로 append-only이며 삭제하지 않는다. Tenant 삭제 시에는 식별 정보를 anonymize하고 보관 기간 만료 후 제거한다.

## 1.6 원문 Prompt / Response 저장 기준

기본적으로 원문 Prompt/Response는 저장하지 않는다.

저장 가능 데이터:

- `redacted_prompt`
- `response_summary`
- `prompt_hash`
- `response_hash`
- `token_count`
- `cost`
- `latency`
- `cache_status`
- `routing_reason`
- `masking_result`
- `object_storage_ref`

원문 저장이 필요한 경우:

- Tenant가 명시적으로 허용해야 한다.
- 별도 암호화 object storage에 저장한다.
- retention 정책을 반드시 가진다.
- request log에는 raw value를 직접 넣지 않는다.

## 1.7 확장 가능성 기준

아래 값은 DB enum으로 강하게 묶지 않는다.

- provider: `openai`, `anthropic`, `gemini`, `local`, future provider
- model: `gpt-4.1-mini`, `claude-*`, future model
- policy type
- detector type
- deployment mode

Provider와 Model은 자주 바뀐다. DB enum으로 박아두면 migration이 잦아진다. MVP에서는 `text` + validation layer를 기본으로 한다.

---

# 2. 저장소별 책임

## 2.1 PostgreSQL

Control Plane 원천 데이터 저장소다.

저장 대상:

- Tenant / User / Membership
- Project / Application
- API Key / App Token metadata
- Provider credential reference
- Runtime Policy / Policy Version / Policy Binding
- Rate Limit / Quota / Budget 설정
- Usage Ledger / Budget Ledger
- Audit Log
- Chat Conversation metadata
- Outbox Event

저장하지 않을 것:

- 대량 Gateway invocation raw log
- Provider API Key 원문
- 원문 Prompt/Response
- Redis counter 성격의 초단기 상태

## 2.2 ClickHouse

분석 조회 전용 저장소다.
P0 canonical request log source는 PostgreSQL `p0_llm_invocation_logs`다. 아래 ClickHouse 테이블은 P1/장기 분석 경로 기준이며 P0 필수 저장소가 아니다.

저장 대상:

- LLM request invocation log
- Provider attempt log
- masking event
- cache event
- routing decision log
- daily/hourly rollup 또는 materialized view

기준:

- Gateway는 ClickHouse에 직접 쓰지 않는다.
- Worker가 Redpanda event를 소비해 ClickHouse에 쓴다.
- Dashboard Request Log / Detail Drawer는 ClickHouse를 조회한다.

## 2.3 Redis

짧은 수명 상태 저장소다.

저장 대상:

- Rate Limit counter
- Quota counter
- Active policy cache
- Exact cache
- Short-lived semantic cache candidate
- Provider circuit breaker state
- Idempotency lock

기준:

- Redis는 source of truth가 아니다.
- 재시작 또는 eviction 후 PostgreSQL/ClickHouse/Provider에서 복구 가능한 데이터만 넣는다.

## 2.4 S3-compatible Object Storage

큰 payload와 export artifact 저장소다.

저장 대상:

- redacted prompt object
- response summary object
- optional encrypted raw payload
- dashboard export artifact

Object key 기준:

```text
tenants/{tenant_id}/requests/{yyyy}/{mm}/{dd}/{request_id}/redacted_prompt.json
tenants/{tenant_id}/requests/{yyyy}/{mm}/{dd}/{request_id}/response_summary.json
tenants/{tenant_id}/exports/{export_id}.jsonl
```

## 2.5 AWS Secrets Manager + KMS

Provider credential 원문 저장소다.

PostgreSQL에는 아래만 저장한다.

```text
secret_ref
kms_key_ref
secret_version
fingerprint
last_rotated_at
```

Provider API Key 원문은 PostgreSQL, Redis, ClickHouse, 로그에 저장하지 않는다.

---

# 3. 테이블 목록

## 3.1 PostgreSQL Control Plane Tables

| 분류 | 테이블 | 설명 | 장기 판단 | 3~5일 P0 판단 |
|---|---|---|---|---|
| Identity | `users` | 전역 사용자 계정 | 필수 | seed 또는 최소 생성 |
| Identity | `tenants` | 고객사 조직 | 필수 | seed 또는 최소 생성 |
| Identity | `tenant_memberships` | 사용자와 Tenant 관계 | 필수 | seed 가능 |
| Identity | `tenant_invitations` | 사용자 초대 | 필수 | 제외 |
| Identity | `groups` | 부서/팀 확장 단위 | 권장 | 제외 |
| Identity | `group_memberships` | 사용자와 Group 관계 | 권장 | 제외 |
| Project | `projects` | LLM 사용 단위 프로젝트 | 필수 | seed 또는 최소 생성 |
| Project | `project_memberships` | 사용자와 Project 관계 | 필수 | seed 가능 |
| Project | `applications` | 고객사 앱/API Client/Chat UI 단위 | 필수 | seed 또는 최소 생성 |
| Credential | `api_keys` | Gateway API Key metadata | 필수 | 필수 |
| Credential | `app_tokens` | Application 접근 Token metadata | 필수 | 필수 |
| Provider | `provider_connections` | Tenant/Project별 Provider 연결 | 필수 | 필수 |
| Provider | `provider_key_versions` | Provider Key version reference | 필수 | seed 또는 간소화 |
| Provider | `model_catalog` | Provider model catalog | 필수 | seed 가능 |
| Provider | `model_pricing_rules` | 모델 가격 계산 기준 | 필수 | 선택 |
| Policy | `runtime_policies` | 정책 논리 단위 | 필수 | JSON config 가능 |
| Policy | `runtime_policy_versions` | immutable 정책 버전 | 필수 | JSON config 가능 |
| Policy | `policy_bindings` | 정책과 대상 resource 연결 | 필수 | JSON config 가능 |
| Policy | `model_allowlist_rules` | 허용 Provider/Model 규칙 | 필수 | 제외 |
| Policy | `routing_rules` | 모델 라우팅 규칙 | 필수 | simple routing config |
| Policy | `sensitive_data_rules` | 민감정보 탐지/마스킹 규칙 | 필수 | 기본 rule config |
| Limit | `rate_limit_rules` | RPM/TPM/동시 요청 제한 | 필수 | v1 필수. `applicationId` 기준 PostgreSQL-backed fixed window |
| Limit | `quota_rules` | 월/일/사용자별 quota | 필수 | P1 |
| Budget | `budget_policies` | 예산 정책 | 필수 | P1 |
| Budget | `budget_ledger_entries` | 예산 차감/보정 ledger | 필수 | 제외 |
| Usage | `usage_ledger_entries` | 비용/토큰 사용 ledger | 필수 | 선택 |
| Chat | `conversations` | Chat UI 대화 metadata | 필수 | 제외 |
| Chat | `chat_messages` | Reply-to Context용 메시지 metadata | 필수 | 제외 |
| Audit | `audit_logs` | 관리자 행위 감사 로그 | 필수 | 선택 |
| Reliability | `outbox_events` | Control Plane event outbox | 권장 | 제외 |
| Alert | `alert_rules` | 알림 규칙 | 권장 | 제외 |
| Alert | `alert_events` | 알림 발생 기록 | 권장 | 제외 |
| Extension | `webhook_endpoints` | 외부 webhook 연동 | 선택 | 제외 |
| Extension | `deployment_environments` | SaaS/Hybrid/Self-hosted 확장 단위 | 선택 | 제외 |
| Retention | `data_retention_policies` | Tenant별 보관 정책 | 권장 | 제외 |

## 3.2 ClickHouse Analytics Tables

| 테이블 | 설명 | 장기 판단 | 3~5일 P0 판단 |
|---|---|---|---|
| `llm_invocations` | 요청 1건당 1 row | 필수 | 선택 mirror |
| `llm_provider_attempts` | Provider 호출 attempt 1건당 1 row | 필수 | 제외 |
| `llm_masking_events` | 민감정보 탐지/마스킹 이벤트 | 필수 | 제외 |
| `llm_cache_events` | exact/semantic cache 이벤트 | 필수 | 제외 |
| `llm_routing_events` | routing/fallback 결정 이벤트 | 필수 | 제외 |
| `usage_daily_rollups` | 일별 비용/토큰 집계 | 권장 | 제외 |

---

# 4. PostgreSQL 상세 스키마

## 4.1 `users`

전역 사용자 계정이다. 사용자는 여러 tenant에 속할 수 있다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `email` | citext | N | 로그인 이메일. case-insensitive unique |
| `name` | text | Y | 사용자 이름 |
| `avatar_url` | text | Y | 프로필 이미지 URL |
| `password_hash` | text | Y | 자체 로그인 사용 시 저장. SSO 사용 시 nullable |
| `auth_provider` | text | N | `local`, `google`, `saml`, `oidc` 등 |
| `auth_provider_subject` | text | Y | 외부 IdP subject |
| `status` | text | N | `active`, `invited`, `suspended`, `deleted` |
| `last_login_at` | timestamptz | Y | 마지막 로그인 시각 |
| `metadata` | jsonb | N | 확장 metadata. default `{}` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_users_email on users (email) where deleted_at is null;
create index ix_users_status on users (status);
create index ix_users_auth_provider_subject on users (auth_provider, auth_provider_subject);
```

삭제 정책:

- 기본은 soft delete.
- Tenant와 연결된 audit/ledger가 있으면 hard delete 금지.
- hard delete가 필요하면 email/name을 anonymize 후 delete 또는 별도 purge job으로 처리한다.

---

## 4.2 `tenants`

고객사 조직 단위다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `name` | text | N | 회사/조직명 |
| `slug` | text | N | URL/path용 tenant slug |
| `plan` | text | N | `free`, `team`, `enterprise`, future plan |
| `status` | text | N | `active`, `suspended`, `pending_delete`, `deleted` |
| `default_timezone` | text | N | 예: `Asia/Seoul` |
| `default_currency` | text | N | 예: `USD`, `KRW` |
| `settings` | jsonb | N | tenant-level 설정. default `{}` |
| `created_by_user_id` | uuid | Y | 최초 생성자. FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_tenants_slug on tenants (slug) where deleted_at is null;
create index ix_tenants_status on tenants (status);
create index ix_tenants_created_by on tenants (created_by_user_id);
```

삭제 정책:

- Tenant 삭제는 즉시 hard delete하지 않는다.
- `status = pending_delete`, `deleted_at`, `scheduled_purge_at` 성격의 job metadata를 settings에 기록한다.
- 연결된 provider secret은 revoke/rotate 후 Secrets Manager에서 삭제 예약한다.
- ClickHouse/S3 데이터는 retention 정책에 따라 TTL/purge 처리한다.

---

## 4.3 `tenant_memberships`

사용자와 Tenant의 관계 및 역할을 나타낸다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `user_id` | uuid | N | FK `users.id` |
| `role` | text | N | `tenant_admin`, `project_admin`, `developer`, `employee`, `viewer` |
| `status` | text | N | `active`, `invited`, `suspended`, `removed` |
| `joined_at` | timestamptz | Y | 가입 완료 시각 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_tenant_memberships_tenant_user
  on tenant_memberships (tenant_id, user_id)
  where deleted_at is null;
create index ix_tenant_memberships_user on tenant_memberships (user_id, status);
create index ix_tenant_memberships_tenant_role on tenant_memberships (tenant_id, role, status);
```

삭제 정책:

- 사용자 퇴사/제거 시 `status = removed`, `deleted_at` 기록.
- 기존 audit/ledger의 actor 참조를 위해 row는 보존한다.

---

## 4.4 `tenant_invitations`

Tenant 사용자 초대 기록이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `email` | citext | N | 초대 이메일 |
| `role` | text | N | 초대할 tenant role |
| `invited_by_user_id` | uuid | N | FK `users.id` |
| `token_hash` | text | N | 초대 token hash. 원문 token 저장 금지 |
| `status` | text | N | `pending`, `accepted`, `expired`, `revoked` |
| `expires_at` | timestamptz | N | 만료 시각 |
| `accepted_at` | timestamptz | Y | 수락 시각 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |

Indexes:

```sql
create unique index ux_tenant_invitations_pending_email
  on tenant_invitations (tenant_id, email)
  where status = 'pending';
create unique index ux_tenant_invitations_token_hash on tenant_invitations (token_hash);
create index ix_tenant_invitations_tenant_status on tenant_invitations (tenant_id, status, expires_at);
```

삭제 정책:

- expired/revoked 초대는 90일 후 hard delete 가능.
- accepted 초대는 audit 용도로 최소 1년 보관 권장.

---

## 4.5 `groups`

Tenant 내부의 부서/팀 단위다. MVP에서 당장 UI가 없어도 향후 팀/부서별 비용 분석을 위해 확장점으로 둔다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `name` | text | N | 그룹명 |
| `slug` | text | N | tenant 내 unique slug |
| `parent_group_id` | uuid | Y | FK `groups.id`. 조직 계층 확장 |
| `metadata` | jsonb | N | default `{}` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_groups_tenant_slug on groups (tenant_id, slug) where deleted_at is null;
create index ix_groups_parent on groups (tenant_id, parent_group_id);
```

삭제 정책:

- soft delete.
- 하위 group 또는 project가 있으면 먼저 이동해야 한다.

---

## 4.6 `group_memberships`

사용자와 group 관계다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `group_id` | uuid | N | FK `groups.id` |
| `user_id` | uuid | N | FK `users.id` |
| `role` | text | N | `member`, `manager` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_group_memberships_group_user
  on group_memberships (group_id, user_id)
  where deleted_at is null;
create index ix_group_memberships_tenant_user on group_memberships (tenant_id, user_id);
```

삭제 정책:

- soft delete.

---

## 4.7 `projects`

LLM 사용량, 예산, 정책의 핵심 단위다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `group_id` | uuid | Y | FK `groups.id`. 부서/팀 연결 |
| `name` | text | N | 프로젝트 이름 |
| `slug` | text | N | tenant 내 unique slug |
| `description` | text | Y | 설명 |
| `status` | text | N | `active`, `archived`, `suspended`, `deleted` |
| `default_provider` | text | Y | 기본 provider |
| `default_model` | text | Y | 기본 model |
| `settings` | jsonb | N | project-level 설정. default `{}` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_projects_tenant_slug on projects (tenant_id, slug) where deleted_at is null;
create index ix_projects_tenant_status on projects (tenant_id, status);
create index ix_projects_group on projects (tenant_id, group_id);
```

삭제 정책:

- 기본 soft delete.
- 연결된 application, token, policy가 있으면 active config에서 먼저 제외한다.

---

## 4.8 `project_memberships`

Project별 사용자 역할이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | N | FK `projects.id` |
| `user_id` | uuid | N | FK `users.id` |
| `role` | text | N | `project_admin`, `developer`, `employee`, `viewer` |
| `status` | text | N | `active`, `suspended`, `removed` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_project_memberships_project_user
  on project_memberships (project_id, user_id)
  where deleted_at is null;
create index ix_project_memberships_tenant_user on project_memberships (tenant_id, user_id, status);
create index ix_project_memberships_project_role on project_memberships (project_id, role, status);
```

삭제 정책:

- soft delete.

---

## 4.9 `applications`

고객사 앱, 내부 API Client, 개발 도구 연동, GateLM Chat UI 같은 실제 사용 경로를 표현한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | N | FK `projects.id` |
| `name` | text | N | 애플리케이션 이름 |
| `slug` | text | N | project 내 unique slug |
| `type` | text | N | `customer_app`, `developer_tool`, `chat_ui`, `internal_api`, future type |
| `status` | text | N | `active`, `disabled`, `deleted` |
| `owner_user_id` | uuid | Y | FK `users.id` |
| `metadata` | jsonb | N | callback, feature id 등 확장값 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_applications_project_slug on applications (project_id, slug) where deleted_at is null;
create index ix_applications_tenant_project_status on applications (tenant_id, project_id, status);
create index ix_applications_owner on applications (tenant_id, owner_user_id);
```

삭제 정책:

- soft delete.
- 연결된 app token은 revoke한다.

---

## 4.10 `api_keys`

Gateway API Key metadata다. 원문 key는 최초 발급 시 한 번만 보여주고 DB에는 hash만 저장한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | Y | FK `projects.id`. tenant-wide key면 nullable |
| `application_id` | uuid | Y | FK `applications.id` |
| `name` | text | N | key 이름 |
| `key_prefix` | text | N | 식별용 prefix. 예: `gatelm_live_xxxx` |
| `key_hash` | text | N | secret hash. 원문 저장 금지 |
| `scope` | jsonb | N | 권한 scope. 예: models, endpoints, projects |
| `status` | text | N | `active`, `revoked`, `expired` |
| `expires_at` | timestamptz | Y | 만료 시각 |
| `last_used_at` | timestamptz | Y | 마지막 사용 시각 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `revoked_by_user_id` | uuid | Y | FK `users.id` |
| `revoked_at` | timestamptz | Y | 폐기 시각 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_api_keys_key_hash on api_keys (key_hash);
create index ix_api_keys_prefix on api_keys (key_prefix);
create index ix_api_keys_tenant_project_status on api_keys (tenant_id, project_id, status);
create index ix_api_keys_application_status on api_keys (application_id, status);
```

삭제 정책:

- 사용자가 삭제해도 `status = revoked`, `revoked_at` 기록.
- hash는 보관 가능하나 보안 정책상 purge가 필요하면 audit 보관 후 제거한다.

---

## 4.11 `app_tokens`

Application 접근용 token metadata다. 고객사 앱이 Gateway를 호출할 때 application 단위 접근 제어에 사용한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | N | FK `projects.id` |
| `application_id` | uuid | N | FK `applications.id` |
| `name` | text | N | token 이름 |
| `token_prefix` | text | N | 식별용 prefix |
| `token_hash` | text | N | token hash. 원문 저장 금지 |
| `scope` | jsonb | N | endpoint/model/policy scope |
| `status` | text | N | `active`, `revoked`, `expired` |
| `expires_at` | timestamptz | Y | 만료 시각 |
| `last_used_at` | timestamptz | Y | 마지막 사용 시각 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `revoked_by_user_id` | uuid | Y | FK `users.id` |
| `revoked_at` | timestamptz | Y | 폐기 시각 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_app_tokens_token_hash on app_tokens (token_hash);
create index ix_app_tokens_prefix on app_tokens (token_prefix);
create index ix_app_tokens_tenant_project_status on app_tokens (tenant_id, project_id, status);
create index ix_app_tokens_application_status on app_tokens (application_id, status);
```

삭제 정책:

- 삭제는 revoke로 처리한다.
- token hash는 최소 감사 기간 동안 보관한다.

---

## 4.12 `provider_connections`

Tenant 또는 Project에서 사용할 LLM Provider 연결 metadata다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | Y | FK `projects.id`. tenant-wide 연결이면 nullable |
| `name` | text | N | 연결 이름 |
| `provider` | text | N | `openai`, `anthropic`, `gemini`, `local`, future provider |
| `base_url` | text | Y | custom/local provider base URL |
| `status` | text | N | `active`, `disabled`, `error`, `deleted` |
| `default_model` | text | Y | 기본 모델 |
| `config` | jsonb | N | provider-specific 설정. timeout 등 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_provider_connections_scope_name
  on provider_connections (tenant_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), provider, name)
  where deleted_at is null;
create index ix_provider_connections_tenant_project_status on provider_connections (tenant_id, project_id, status);
create index ix_provider_connections_provider on provider_connections (provider, status);
```

삭제 정책:

- soft delete.
- active key version은 먼저 revoke한다.
- Secrets Manager secret deletion은 별도 job으로 예약한다.

---

## 4.13 `provider_key_versions`

Provider credential의 version reference다. 원문 key는 Secrets Manager에만 저장한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `provider_connection_id` | uuid | N | FK `provider_connections.id` |
| `version` | int | N | connection 내 증가 version |
| `secret_ref` | text | N | Secrets Manager ARN 또는 secret id |
| `kms_key_ref` | text | Y | KMS key reference |
| `fingerprint` | text | N | key 식별용 fingerprint. 원문 복구 불가 |
| `status` | text | N | `active`, `rotated`, `revoked`, `deleted` |
| `last_verified_at` | timestamptz | Y | Provider 검증 시각 |
| `activated_at` | timestamptz | Y | active 전환 시각 |
| `revoked_at` | timestamptz | Y | 폐기 시각 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create unique index ux_provider_key_versions_connection_version
  on provider_key_versions (provider_connection_id, version);
create index ix_provider_key_versions_active
  on provider_key_versions (provider_connection_id, status)
  where status = 'active';
create index ix_provider_key_versions_tenant_status on provider_key_versions (tenant_id, status);
```

삭제 정책:

- append-only.
- rotate/revoke 상태만 변경할 수 있다. 단, 보안상 상태 업데이트는 예외적으로 허용한다.
- 원문 secret은 Secrets Manager retention 정책에 따른다.

---

## 4.14 `model_catalog`

Provider model catalog다. Provider와 model은 확장을 위해 text로 관리한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `provider` | text | N | provider name |
| `model` | text | N | provider model id |
| `display_name` | text | Y | UI 표시명 |
| `capabilities` | jsonb | N | `chat`, `streaming`, `vision`, future capability |
| `context_window_tokens` | int | Y | context window |
| `status` | text | N | `active`, `deprecated`, `disabled` |
| `metadata` | jsonb | N | 확장 metadata |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |

Indexes:

```sql
create unique index ux_model_catalog_provider_model on model_catalog (provider, model);
create index ix_model_catalog_provider_status on model_catalog (provider, status);
```

삭제 정책:

- Provider 모델이 사라져도 hard delete하지 않고 `deprecated` 처리한다.
- 과거 로그의 provider/model join 가능성을 유지한다.

---

## 4.15 `model_pricing_rules`

모델 가격 계산 기준이다. 가격은 변경되므로 versioned row로 관리한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `provider` | text | N | provider name |
| `model` | text | N | model id |
| `currency` | text | N | 기본 `USD` |
| `input_token_micro_usd` | bigint | N | input token 1개당 비용. micro USD |
| `output_token_micro_usd` | bigint | N | output token 1개당 비용. micro USD |
| `cached_input_token_micro_usd` | bigint | Y | cached input token 비용 |
| `pricing_unit` | int | N | 보통 1 또는 1000 또는 1000000. 계산 명확화 |
| `effective_from` | timestamptz | N | 적용 시작 |
| `effective_to` | timestamptz | Y | 적용 종료 |
| `source` | text | Y | 가격 출처 metadata |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create index ix_model_pricing_rules_lookup
  on model_pricing_rules (provider, model, effective_from desc, effective_to);
create unique index ux_model_pricing_rules_effective
  on model_pricing_rules (provider, model, effective_from);
```

삭제 정책:

- append-only.
- 가격이 바뀌면 기존 row의 `effective_to`를 닫고 새 row를 추가한다.

---

## 4.16 `runtime_policies`

정책의 논리 단위다. 실제 적용 가능한 내용은 `runtime_policy_versions`에 저장한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `name` | text | N | 정책 이름 |
| `policy_type` | text | N | `routing`, `security`, `budget`, `rate_limit`, `guardrail`, future type |
| `description` | text | Y | 설명 |
| `status` | text | N | `draft`, `active`, `archived`, `deleted` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_runtime_policies_tenant_type_name
  on runtime_policies (tenant_id, policy_type, name)
  where deleted_at is null;
create index ix_runtime_policies_tenant_status on runtime_policies (tenant_id, policy_type, status);
```

삭제 정책:

- soft delete.
- published version이 있으면 archive 후 active binding을 제거해야 한다.

---

## 4.17 `runtime_policy_versions`

정책의 immutable version이다. CEL expression, JSON Schema 검증 결과, compiled artifact reference를 저장한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `policy_id` | uuid | N | FK `runtime_policies.id` |
| `version` | int | N | policy 내 증가 version |
| `status` | text | N | `draft`, `validated`, `published`, `rolled_back`, `archived` |
| `definition` | jsonb | N | 정책 원본 JSON |
| `cel_expression` | text | Y | CEL expression |
| `compiled_ref` | text | Y | compiled policy artifact reference |
| `validation_errors` | jsonb | Y | validation 실패 이유 |
| `published_at` | timestamptz | Y | publish 시각 |
| `published_by_user_id` | uuid | Y | FK `users.id` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create unique index ux_runtime_policy_versions_policy_version
  on runtime_policy_versions (policy_id, version);
create index ix_runtime_policy_versions_tenant_status
  on runtime_policy_versions (tenant_id, status, created_at desc);
create index ix_runtime_policy_versions_published
  on runtime_policy_versions (policy_id, published_at desc)
  where status = 'published';
```

삭제 정책:

- append-only.
- 정책 롤백은 과거 version을 다시 binding한다.
- 기존 version row를 수정하지 않는다.

---

## 4.18 `policy_bindings`

정책 version을 Tenant, Project, Application, User, Group 같은 대상에 연결한다.

확장 가능성을 위해 `target_type`, `target_id` 구조를 사용한다. FK는 서비스 레이어에서 검증한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `policy_id` | uuid | N | FK `runtime_policies.id` |
| `policy_version_id` | uuid | N | FK `runtime_policy_versions.id` |
| `policy_type` | text | N | 조회 최적화용 중복값 |
| `target_type` | text | N | `tenant`, `group`, `project`, `application`, `user`, `app_token` |
| `target_id` | uuid | N | 대상 resource id |
| `priority` | int | N | 낮을수록 우선 적용 |
| `status` | text | N | `active`, `disabled`, `replaced` |
| `effective_from` | timestamptz | N | 적용 시작 |
| `effective_to` | timestamptz | Y | 적용 종료 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |

Indexes:

```sql
create index ix_policy_bindings_target_active
  on policy_bindings (tenant_id, target_type, target_id, policy_type, status, priority);
create index ix_policy_bindings_policy_version on policy_bindings (policy_version_id);
create unique index ux_policy_bindings_active_priority
  on policy_bindings (tenant_id, target_type, target_id, policy_type, priority)
  where status = 'active';
```

삭제 정책:

- hard delete 금지.
- 교체 시 기존 binding은 `replaced`, `effective_to` 기록.

---

## 4.19 `model_allowlist_rules`

Tenant/Project/Application 단위 허용 Provider/Model 규칙이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `target_type` | text | N | `tenant`, `project`, `application`, `user`, `app_token` |
| `target_id` | uuid | N | 대상 resource id |
| `provider` | text | N | provider. `*` 허용 가능 |
| `model_pattern` | text | N | exact model 또는 wildcard pattern |
| `action` | text | N | `allow`, `deny` |
| `priority` | int | N | 낮을수록 우선 |
| `reason` | text | Y | 정책 이유 |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_model_allowlist_rules_target
  on model_allowlist_rules (tenant_id, target_type, target_id, status, priority);
create index ix_model_allowlist_rules_provider_model
  on model_allowlist_rules (tenant_id, provider, model_pattern);
```

삭제 정책:

- soft delete.

---

## 4.20 `routing_rules`

모델 라우팅 규칙이다. 단순 요청을 저비용 모델로 보내거나 fallback chain을 정의한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | Y | FK `projects.id` |
| `application_id` | uuid | Y | FK `applications.id` |
| `name` | text | N | 규칙 이름 |
| `priority` | int | N | 낮을수록 우선 |
| `condition` | jsonb | N | routing 조건. prompt length, feature, requested model 등 |
| `target_provider` | text | N | 선택 provider |
| `target_model` | text | N | 선택 model |
| `fallback_chain` | jsonb | N | fallback provider/model 배열 |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_routing_rules_scope_priority
  on routing_rules (tenant_id, project_id, application_id, status, priority);
create index ix_routing_rules_target_model on routing_rules (target_provider, target_model);
```

삭제 정책:

- soft delete.
- Gateway active config에서 즉시 제거한다.

---

## 4.21 `sensitive_data_rules`

민감정보 탐지/마스킹 규칙이다. detector, action, replacement token, sampleHash, 저장 전 마스킹, 외부 LLM 요청 전 마스킹 기준은 `pii-masking-policy.md`를 따른다. 기본 패턴 외에 tenant custom rule을 추가할 수 있게 한다.

`detector_type`, `action`, `severity`는 확장 가능한 text 값이며 DB enum으로 닫지 않는다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | Y | null이면 system default rule |
| `name` | text | N | 규칙 이름 |
| `detector_type` | text | N | `email`, `phone_number`, `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `account_id`, `employee_id`, `internal_keyword`, `custom_regex`, `custom_keyword`, future detector |
| `pattern` | text | Y | regex/keyword detector 사용 시 값 |
| `action` | text | N | `allow`, `redact`, `block` |
| `replacement` | text | Y | 예: `[EMAIL_REDACTED]`, `[API_KEY_REDACTED]`, `[RESIDENT_REGISTRATION_NUMBER_REDACTED]` |
| `severity` | text | N | `low`, `medium`, `high`, `critical` |
| `priority` | int | N | 충돌 시 우선순위. 낮은 값 우선 |
| `apply_to` | jsonb | N | 적용 대상. 예: `messages`, `system_prompt`, `reply_context`, `free_form_metadata` |
| `cache_behavior` | text | N | `bypass`, `redacted_exact_cache_allowed`, `tenant_policy` |
| `status` | text | N | `active`, `disabled` |
| `metadata` | jsonb | N | default `{}`. confidence/checksum/caseSensitive 등 detector-specific 설정 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_sensitive_data_rules_tenant_status
  on sensitive_data_rules (tenant_id, status, detector_type);
create index ix_sensitive_data_rules_severity on sensitive_data_rules (severity, status);
create index ix_sensitive_data_rules_priority on sensitive_data_rules (tenant_id, status, priority);
```

삭제 정책:

- system default rule은 삭제하지 않고 disabled 처리한다.
- custom rule은 soft delete.
- rule 변경은 audit log를 남긴다.
- raw detected value나 마스킹 전 sample은 저장하지 않는다.

---

## 4.22 `rate_limit_rules`

RPM, TPM, 동시 요청 수 제한 규칙이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `target_type` | text | N | `tenant`, `project`, `application`, `user`, `api_key`, `app_token` |
| `target_id` | uuid | N | 대상 resource id |
| `limit_type` | text | N | `rpm`, `tpm`, `concurrent_requests` |
| `limit_value` | bigint | N | 제한값 |
| `window_seconds` | int | N | 예: 60, 3600 |
| `burst_value` | bigint | Y | burst 허용값 |
| `action` | text | N | `block`, `warn` |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_rate_limit_rules_target
  on rate_limit_rules (tenant_id, target_type, target_id, status, limit_type);
create unique index ux_rate_limit_rules_target_type
  on rate_limit_rules (tenant_id, target_type, target_id, limit_type, window_seconds)
  where deleted_at is null;
```

삭제 정책:

- soft delete.
- active config cache invalidation 필요.

---

## 4.23 `quota_rules`

월/일/기간 단위 사용량 제한 규칙이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `target_type` | text | N | `tenant`, `project`, `application`, `user`, `api_key`, `app_token` |
| `target_id` | uuid | N | 대상 resource id |
| `quota_type` | text | N | `requests`, `tokens`, `cost_micro_usd` |
| `quota_value` | bigint | N | 제한값 |
| `period` | text | N | `daily`, `monthly`, `custom` |
| `period_start_day` | int | Y | monthly 기준 시작일. 기본 1 |
| `action` | text | N | `block`, `warn` |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_quota_rules_target
  on quota_rules (tenant_id, target_type, target_id, status, quota_type, period);
create unique index ux_quota_rules_target_type_period
  on quota_rules (tenant_id, target_type, target_id, quota_type, period)
  where deleted_at is null;
```

삭제 정책:

- soft delete.

---

## 4.24 `budget_policies`

예산 제한/알림 정책이다. 금액은 floating point를 쓰지 않고 micro USD 정수로 저장한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `target_type` | text | N | `tenant`, `group`, `project`, `application`, `user`, `api_key`, `app_token` |
| `target_id` | uuid | N | 대상 resource id |
| `period` | text | N | `daily`, `monthly`, `custom` |
| `budget_micro_usd` | bigint | N | 예산 금액. micro USD |
| `warn_threshold_ratio` | numeric(5,4) | N | 예: `0.8000` |
| `block_threshold_ratio` | numeric(5,4) | N | 예: `1.0000` |
| `action_on_exceed` | text | N | `block`, `warn_only` |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_budget_policies_target
  on budget_policies (tenant_id, target_type, target_id, status, period);
create unique index ux_budget_policies_target_period
  on budget_policies (tenant_id, target_type, target_id, period)
  where deleted_at is null;
```

삭제 정책:

- soft delete.
- 기존 ledger는 유지한다.

---

## 4.25 `usage_ledger_entries`

토큰/비용 사용 ledger다. Worker가 Gateway event를 기준으로 append한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | Y | FK `projects.id` |
| `application_id` | uuid | Y | FK `applications.id` |
| `user_id` | uuid | Y | FK `users.id` |
| `api_key_id` | uuid | Y | FK `api_keys.id` |
| `app_token_id` | uuid | Y | FK `app_tokens.id` |
| `request_id` | uuid | N | Gateway request id |
| `event_time` | timestamptz | N | 요청 발생 시각 |
| `provider` | text | Y | 사용 provider |
| `model` | text | Y | 사용 model |
| `prompt_tokens` | bigint | N | prompt tokens |
| `completion_tokens` | bigint | N | completion tokens |
| `total_tokens` | bigint | N | total tokens |
| `cost_micro_usd` | bigint | N | 비용. micro USD |
| `cache_status` | text | N | `hit`, `miss`, `bypass`, `error` |
| `entry_type` | text | N | `debit`, `credit`, `adjustment` |
| `source` | text | N | `gateway_event`, `manual_adjustment`, `reconciliation` |
| `metadata` | jsonb | N | default `{}` |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create unique index ux_usage_ledger_entries_request_entry
  on usage_ledger_entries (request_id, entry_type, source);
create index ix_usage_ledger_tenant_time on usage_ledger_entries (tenant_id, event_time desc);
create index ix_usage_ledger_project_time on usage_ledger_entries (tenant_id, project_id, event_time desc);
create index ix_usage_ledger_user_time on usage_ledger_entries (tenant_id, user_id, event_time desc);
create index ix_usage_ledger_app_time on usage_ledger_entries (tenant_id, application_id, event_time desc);
```

삭제 정책:

- append-only.
- 비용 정정은 기존 row 수정이 아니라 `adjustment` row 추가.
- tenant purge 시 anonymize 후 retention 만료 시 삭제.

---

## 4.26 `budget_ledger_entries`

Budget 차감/보정 ledger다. `usage_ledger_entries`와 별도로 두어 budget enforcement와 회계성 기록을 분리한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `budget_policy_id` | uuid | N | FK `budget_policies.id` |
| `target_type` | text | N | budget target type |
| `target_id` | uuid | N | budget target id |
| `request_id` | uuid | Y | 관련 Gateway request id |
| `period_key` | text | N | 예: `2026-06`, `2026-06-22` |
| `amount_micro_usd` | bigint | N | 차감 금액. 보정 시 음수 가능 |
| `entry_type` | text | N | `debit`, `credit`, `adjustment` |
| `reason` | text | Y | 보정 사유 |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create index ix_budget_ledger_target_period
  on budget_ledger_entries (tenant_id, target_type, target_id, period_key);
create index ix_budget_ledger_policy_period
  on budget_ledger_entries (budget_policy_id, period_key);
create index ix_budget_ledger_request on budget_ledger_entries (request_id);
```

삭제 정책:

- append-only.
- 정정은 adjustment row로 처리한다.

---

## 4.27 `conversations`

GateLM Chat UI의 대화 metadata다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | N | FK `projects.id` |
| `application_id` | uuid | Y | FK `applications.id`. 보통 Chat UI application |
| `user_id` | uuid | N | FK `users.id` |
| `title` | text | Y | 대화 제목 |
| `status` | text | N | `active`, `archived`, `deleted` |
| `metadata` | jsonb | N | default `{}` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_conversations_user_updated
  on conversations (tenant_id, project_id, user_id, updated_at desc)
  where deleted_at is null;
create index ix_conversations_project_updated
  on conversations (tenant_id, project_id, updated_at desc);
```

삭제 정책:

- 사용자 삭제 요청 시 soft delete.
- redacted message content는 retention 정책에 따라 hard delete 가능.

---

## 4.28 `chat_messages`

Reply-to Context 처리를 위한 메시지 metadata다. 원문 메시지는 저장하지 않고 redacted content 또는 summary만 저장한다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | N | FK `projects.id` |
| `conversation_id` | uuid | N | FK `conversations.id` |
| `parent_message_id` | uuid | Y | FK `chat_messages.id`. Reply-to Context |
| `request_id` | uuid | Y | Gateway request id |
| `role` | text | N | `user`, `assistant`, `system` |
| `content_redacted` | text | Y | 마스킹된 내용 |
| `content_summary` | text | Y | 긴 메시지 요약 |
| `content_hash` | text | Y | redacted content hash |
| `token_count` | int | Y | context token 계산용 |
| `provider` | text | Y | assistant 메시지 생성 provider |
| `model` | text | Y | assistant 메시지 생성 model |
| `metadata` | jsonb | N | default `{}` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_chat_messages_conversation_created
  on chat_messages (conversation_id, created_at);
create index ix_chat_messages_parent on chat_messages (parent_message_id);
create index ix_chat_messages_request on chat_messages (request_id);
create index ix_chat_messages_tenant_project_created
  on chat_messages (tenant_id, project_id, created_at desc);
```

삭제 정책:

- soft delete.
- 원문 미저장이 기본이므로 `content_redacted`, `content_summary`도 retention 만료 후 null 처리 가능.
- `request_id`, `token_count`, `metadata`는 분석 연계 목적으로 보존 가능.

---

## 4.29 `audit_logs`

Control Plane의 관리자 행위 감사 로그다. Gateway invocation log가 아니다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | Y | 관련 tenant. system action은 nullable |
| `actor_user_id` | uuid | Y | FK `users.id` |
| `actor_type` | text | N | `user`, `system`, `worker` |
| `action` | text | N | 예: `project.create`, `policy.publish`, `key.revoke` |
| `resource_type` | text | N | `tenant`, `project`, `api_key`, `policy`, etc. |
| `resource_id` | uuid | Y | 대상 resource id |
| `before` | jsonb | Y | 변경 전 값. secret/raw prompt 금지 |
| `after` | jsonb | Y | 변경 후 값. secret/raw prompt 금지 |
| `ip_address` | inet | Y | 요청 IP |
| `user_agent` | text | Y | user agent |
| `request_id` | uuid | Y | Control Plane request id |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create index ix_audit_logs_tenant_created on audit_logs (tenant_id, created_at desc);
create index ix_audit_logs_actor_created on audit_logs (actor_user_id, created_at desc);
create index ix_audit_logs_resource on audit_logs (tenant_id, resource_type, resource_id, created_at desc);
create index ix_audit_logs_action on audit_logs (tenant_id, action, created_at desc);
```

삭제 정책:

- append-only.
- 최소 1년 보관 권장.
- tenant purge 시 actor/resource 식별자 anonymize 후 retention에 따라 삭제.

---

## 4.30 `outbox_events`

Control Plane의 DB transaction과 event 발행을 안전하게 연결하기 위한 outbox다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | Y | 관련 tenant |
| `event_type` | text | N | 예: `policy.published`, `api_key.revoked` |
| `aggregate_type` | text | N | 예: `policy`, `api_key` |
| `aggregate_id` | uuid | N | 대상 id |
| `payload` | jsonb | N | event payload |
| `status` | text | N | `pending`, `published`, `failed` |
| `retry_count` | int | N | default 0 |
| `last_error` | text | Y | 마지막 실패 이유 |
| `published_at` | timestamptz | Y | 발행 시각 |
| `created_at` | timestamptz | N | 생성 시각 |

Indexes:

```sql
create index ix_outbox_events_pending
  on outbox_events (status, created_at)
  where status in ('pending', 'failed');
create index ix_outbox_events_aggregate on outbox_events (aggregate_type, aggregate_id);
create index ix_outbox_events_tenant_created on outbox_events (tenant_id, created_at desc);
```

삭제 정책:

- published event는 30~90일 후 삭제 가능.
- failed event는 운영자가 확인 후 재시도/폐기한다.

---

## 4.31 `alert_rules`

대시보드/운영 알림 규칙이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `project_id` | uuid | Y | FK `projects.id` |
| `name` | text | N | 알림 이름 |
| `metric` | text | N | `cost`, `latency`, `error_rate`, `budget_ratio`, `cache_hit_rate` |
| `condition` | jsonb | N | threshold/window 조건 |
| `channels` | jsonb | N | email, webhook 등 |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_alert_rules_scope_status on alert_rules (tenant_id, project_id, status, metric);
```

삭제 정책:

- soft delete.

---

## 4.32 `alert_events`

발생한 알림 기록이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `alert_rule_id` | uuid | Y | FK `alert_rules.id` |
| `severity` | text | N | `info`, `warning`, `critical` |
| `status` | text | N | `open`, `acknowledged`, `resolved` |
| `message` | text | N | 알림 메시지 |
| `metric_snapshot` | jsonb | N | 발생 당시 metric |
| `acknowledged_by_user_id` | uuid | Y | FK `users.id` |
| `acknowledged_at` | timestamptz | Y | 확인 시각 |
| `resolved_at` | timestamptz | Y | 해결 시각 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |

Indexes:

```sql
create index ix_alert_events_tenant_status_created
  on alert_events (tenant_id, status, created_at desc);
create index ix_alert_events_rule_created on alert_events (alert_rule_id, created_at desc);
```

삭제 정책:

- 해결된 알림은 retention 기간 후 삭제 가능.

---

## 4.33 `webhook_endpoints`

외부 시스템으로 event를 전달하기 위한 확장 테이블이다. MVP 필수는 아니지만 구조상 확장점으로 둔다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `name` | text | N | webhook 이름 |
| `url` | text | N | endpoint URL |
| `secret_hash` | text | Y | signing secret hash. 원문 저장 금지 |
| `event_types` | jsonb | N | 구독 event types |
| `status` | text | N | `active`, `disabled`, `failed` |
| `last_success_at` | timestamptz | Y | 마지막 성공 |
| `last_failure_at` | timestamptz | Y | 마지막 실패 |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create index ix_webhook_endpoints_tenant_status on webhook_endpoints (tenant_id, status);
```

삭제 정책:

- soft delete.
- secret hash purge 가능.

---

## 4.34 `deployment_environments`

향후 SaaS, Hybrid, Self-hosted 배포를 지원하기 위한 확장 테이블이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `name` | text | N | 환경 이름. 예: `default-saas`, `prod-gateway` |
| `mode` | text | N | `saas`, `hybrid`, `self_hosted` |
| `region` | text | Y | 배포 region |
| `gateway_base_url` | text | Y | data plane URL |
| `status` | text | N | `active`, `disabled`, `provisioning`, `error` |
| `config` | jsonb | N | 배포 설정 |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |
| `deleted_at` | timestamptz | Y | soft delete 시각 |

Indexes:

```sql
create unique index ux_deployment_env_tenant_name
  on deployment_environments (tenant_id, name)
  where deleted_at is null;
create index ix_deployment_env_tenant_mode_status on deployment_environments (tenant_id, mode, status);
```

삭제 정책:

- soft delete.
- 연결된 gateway active config가 있으면 먼저 disable한다.

---

## 4.35 `data_retention_policies`

Tenant별 데이터 보관 정책이다.

| 필드 | 타입 | Null | 설명 |
|---|---:|---:|---|
| `id` | uuid | N | PK |
| `tenant_id` | uuid | N | FK `tenants.id` |
| `data_type` | text | N | `invocation_log`, `redacted_payload`, `chat_message`, `audit_log`, `ledger` |
| `retention_days` | int | N | 보관 일수 |
| `raw_payload_allowed` | boolean | N | 원문 payload 저장 허용 여부 |
| `encryption_required` | boolean | N | 암호화 필수 여부 |
| `status` | text | N | `active`, `disabled` |
| `created_by_user_id` | uuid | Y | FK `users.id` |
| `created_at` | timestamptz | N | 생성 시각 |
| `updated_at` | timestamptz | N | 수정 시각 |

Indexes:

```sql
create unique index ux_data_retention_tenant_type
  on data_retention_policies (tenant_id, data_type)
  where status = 'active';
create index ix_data_retention_tenant_status on data_retention_policies (tenant_id, status);
```

삭제 정책:

- 정책 자체는 soft delete 대신 disabled 처리한다.
- 변경 이력은 audit_logs에 남긴다.

---

# 5. ClickHouse 상세 스키마

ClickHouse는 대량 분석 조회용이다. Gateway가 직접 쓰지 않고 Worker가 Redpanda event를 소비해 저장한다.

공통 기준:

```text
Partition: toYYYYMM(event_time)
Order By: (tenant_id, project_id, event_time, request_id)
TTL: 기본 180일 또는 tenant retention policy 반영
```

## 5.1 `llm_invocations`

Gateway 요청 1건당 1 row다.

| 필드 | 타입 | 설명 |
|---|---:|---|
| `event_date` | Date | event_time의 날짜 |
| `event_time` | DateTime64(3, 'UTC') | 요청 시작 시각 |
| `request_id` | UUID | Gateway request id |
| `trace_id` | String | trace id |
| `tenant_id` | UUID | tenant id |
| `project_id` | Nullable(UUID) | project id |
| `application_id` | Nullable(UUID) | application id |
| `user_id` | Nullable(UUID) | user id |
| `api_key_id` | Nullable(UUID) | api key id |
| `app_token_id` | Nullable(UUID) | app token id |
| `endpoint` | LowCardinality(String) | OpenAI-compatible endpoint |
| `stream` | UInt8 | streaming 여부 |
| `requested_provider` | LowCardinality(String) | 요청 provider |
| `requested_model` | LowCardinality(String) | 요청 model |
| `provider` | LowCardinality(String) | 실제 provider |
| `model` | LowCardinality(String) | 실제 model |
| `status` | LowCardinality(String) | `success`, `error`, `blocked`, `cache_hit` |
| `http_status` | UInt16 | HTTP status |
| `error_code` | LowCardinality(String) | error code |
| `error_message_hash` | String | error message hash. 원문 저장 금지 |
| `prompt_tokens` | UInt64 | prompt tokens |
| `completion_tokens` | UInt64 | completion tokens |
| `context_tokens` | UInt64 | Reply-to Context token |
| `total_tokens` | UInt64 | total tokens |
| `cost_micro_usd` | Int64 | 비용. micro USD |
| `latency_ms` | UInt64 | 총 latency |
| `ttft_ms` | Nullable(UInt64) | time to first token |
| `cache_status` | LowCardinality(String) | `hit`, `miss`, `bypass`, `error` |
| `cache_type` | LowCardinality(String) | `none`, `exact`, `semantic` |
| `cache_key_hash` | String | cache key hash |
| `routing_rule_id` | Nullable(UUID) | 적용 routing rule |
| `routing_policy_version_id` | Nullable(UUID) | 적용 policy version |
| `security_policy_version_id` | Nullable(UUID) | 적용 security policy version |
| `masking_action` | LowCardinality(String) | `none`, `redacted`, `blocked` |
| `masking_detected_types` | Array(String) | 탐지 유형 |
| `masking_detected_count` | UInt32 | 탐지 건수 |
| `fallback_count` | UInt32 | fallback 횟수 |
| `redacted_prompt_ref` | String | S3 object ref 또는 inline ref |
| `response_summary_ref` | String | S3 object ref 또는 inline ref |
| `metadata` | String | JSON string. ClickHouse JSON 컬럼 대신 MVP 단순화 |
| `ingested_at` | DateTime64(3, 'UTC') | Worker 저장 시각 |

DDL 기준:

```sql
create table llm_invocations (
  event_date Date,
  event_time DateTime64(3, 'UTC'),
  request_id UUID,
  trace_id String,
  tenant_id UUID,
  project_id Nullable(UUID),
  application_id Nullable(UUID),
  user_id Nullable(UUID),
  api_key_id Nullable(UUID),
  app_token_id Nullable(UUID),
  endpoint LowCardinality(String),
  stream UInt8,
  requested_provider LowCardinality(String),
  requested_model LowCardinality(String),
  provider LowCardinality(String),
  model LowCardinality(String),
  status LowCardinality(String),
  http_status UInt16,
  error_code LowCardinality(String),
  error_message_hash String,
  prompt_tokens UInt64,
  completion_tokens UInt64,
  context_tokens UInt64,
  total_tokens UInt64,
  cost_micro_usd Int64,
  latency_ms UInt64,
  ttft_ms Nullable(UInt64),
  cache_status LowCardinality(String),
  cache_type LowCardinality(String),
  cache_key_hash String,
  routing_rule_id Nullable(UUID),
  routing_policy_version_id Nullable(UUID),
  security_policy_version_id Nullable(UUID),
  masking_action LowCardinality(String),
  masking_detected_types Array(String),
  masking_detected_count UInt32,
  fallback_count UInt32,
  redacted_prompt_ref String,
  response_summary_ref String,
  metadata String,
  ingested_at DateTime64(3, 'UTC')
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (tenant_id, project_id, event_time, request_id)
ttl event_time + interval 180 day;
```

조회 기준:

- Request Log: `tenant_id`, `project_id`, `event_time desc`
- Detail Drawer: `request_id`
- Dashboard: materialized view 또는 rollup 사용

---

## 5.2 `llm_provider_attempts`

Provider 호출 attempt 단위 로그다. Retry/Fallback 분석에 사용한다.

| 필드 | 타입 | 설명 |
|---|---:|---|
| `event_date` | Date | 날짜 |
| `event_time` | DateTime64(3, 'UTC') | attempt 시작 시각 |
| `request_id` | UUID | Gateway request id |
| `attempt_id` | UUID | attempt id |
| `attempt_no` | UInt16 | 순번 |
| `tenant_id` | UUID | tenant id |
| `project_id` | Nullable(UUID) | project id |
| `provider` | LowCardinality(String) | provider |
| `model` | LowCardinality(String) | model |
| `status` | LowCardinality(String) | `success`, `error`, `timeout`, `cancelled` |
| `http_status` | UInt16 | Provider HTTP status |
| `error_code` | LowCardinality(String) | error code |
| `prompt_tokens` | UInt64 | prompt tokens |
| `completion_tokens` | UInt64 | completion tokens |
| `total_tokens` | UInt64 | total tokens |
| `cost_micro_usd` | Int64 | 비용 |
| `latency_ms` | UInt64 | latency |
| `ttft_ms` | Nullable(UInt64) | streaming TTFT |
| `is_fallback` | UInt8 | fallback attempt 여부 |
| `fallback_from_provider` | LowCardinality(String) | fallback 이전 provider |
| `fallback_from_model` | LowCardinality(String) | fallback 이전 model |
| `metadata` | String | JSON string |
| `ingested_at` | DateTime64(3, 'UTC') | 저장 시각 |

DDL 기준:

```sql
create table llm_provider_attempts (
  event_date Date,
  event_time DateTime64(3, 'UTC'),
  request_id UUID,
  attempt_id UUID,
  attempt_no UInt16,
  tenant_id UUID,
  project_id Nullable(UUID),
  provider LowCardinality(String),
  model LowCardinality(String),
  status LowCardinality(String),
  http_status UInt16,
  error_code LowCardinality(String),
  prompt_tokens UInt64,
  completion_tokens UInt64,
  total_tokens UInt64,
  cost_micro_usd Int64,
  latency_ms UInt64,
  ttft_ms Nullable(UInt64),
  is_fallback UInt8,
  fallback_from_provider LowCardinality(String),
  fallback_from_model LowCardinality(String),
  metadata String,
  ingested_at DateTime64(3, 'UTC')
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (tenant_id, project_id, event_time, request_id, attempt_no)
ttl event_time + interval 180 day;
```

---

## 5.3 `llm_masking_events`

민감정보 탐지/마스킹 이벤트다. 이벤트 payload와 sample 저장 금지 기준은 `pii-masking-policy.md`와 `llm-log-schema.md`를 함께 따른다.

| 필드 | 타입 | 설명 |
|---|---:|---|
| `event_date` | Date | 날짜 |
| `event_time` | DateTime64(3, 'UTC') | 발생 시각 |
| `request_id` | UUID | Gateway request id |
| `tenant_id` | UUID | tenant id |
| `project_id` | Nullable(UUID) | project id |
| `user_id` | Nullable(UUID) | user id |
| `rule_id` | Nullable(UUID) | sensitive_data_rules id |
| `detector_type` | LowCardinality(String) | 탐지 유형 |
| `action` | LowCardinality(String) | `allow`, `redact`, `block` |
| `detected_count` | UInt32 | 탐지 건수 |
| `severity` | LowCardinality(String) | severity |
| `sample_hash` | String | 탐지값 hash. 원문 저장 금지 |
| `ingested_at` | DateTime64(3, 'UTC') | 저장 시각 |

DDL 기준:

```sql
create table llm_masking_events (
  event_date Date,
  event_time DateTime64(3, 'UTC'),
  request_id UUID,
  tenant_id UUID,
  project_id Nullable(UUID),
  user_id Nullable(UUID),
  rule_id Nullable(UUID),
  detector_type LowCardinality(String),
  action LowCardinality(String),
  detected_count UInt32,
  severity LowCardinality(String),
  sample_hash String,
  ingested_at DateTime64(3, 'UTC')
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (tenant_id, project_id, event_time, request_id)
ttl event_time + interval 180 day;
```

---

## 5.4 `llm_cache_events`

Exact/Semantic Cache 동작 기록이다.

| 필드 | 타입 | 설명 |
|---|---:|---|
| `event_date` | Date | 날짜 |
| `event_time` | DateTime64(3, 'UTC') | 발생 시각 |
| `request_id` | UUID | Gateway request id |
| `tenant_id` | UUID | tenant id |
| `project_id` | Nullable(UUID) | project id |
| `cache_type` | LowCardinality(String) | `exact`, `semantic` |
| `cache_status` | LowCardinality(String) | `hit`, `miss`, `write`, `bypass`, `error` |
| `cache_key_hash` | String | cache key hash |
| `similarity_score` | Nullable(Float32) | semantic cache similarity |
| `saved_cost_micro_usd` | Int64 | 절감 추정 비용 |
| `latency_saved_ms` | UInt64 | 절감 추정 시간 |
| `ingested_at` | DateTime64(3, 'UTC') | 저장 시각 |

DDL 기준:

```sql
create table llm_cache_events (
  event_date Date,
  event_time DateTime64(3, 'UTC'),
  request_id UUID,
  tenant_id UUID,
  project_id Nullable(UUID),
  cache_type LowCardinality(String),
  cache_status LowCardinality(String),
  cache_key_hash String,
  similarity_score Nullable(Float32),
  saved_cost_micro_usd Int64,
  latency_saved_ms UInt64,
  ingested_at DateTime64(3, 'UTC')
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (tenant_id, project_id, event_time, request_id)
ttl event_time + interval 180 day;
```

---

## 5.5 `llm_routing_events`

모델 라우팅과 fallback 결정 기록이다.

| 필드 | 타입 | 설명 |
|---|---:|---|
| `event_date` | Date | 날짜 |
| `event_time` | DateTime64(3, 'UTC') | 발생 시각 |
| `request_id` | UUID | Gateway request id |
| `tenant_id` | UUID | tenant id |
| `project_id` | Nullable(UUID) | project id |
| `routing_rule_id` | Nullable(UUID) | routing rule id |
| `policy_version_id` | Nullable(UUID) | policy version id |
| `requested_provider` | LowCardinality(String) | 요청 provider |
| `requested_model` | LowCardinality(String) | 요청 model |
| `selected_provider` | LowCardinality(String) | 선택 provider |
| `selected_model` | LowCardinality(String) | 선택 model |
| `decision_reason` | LowCardinality(String) | `low_cost`, `fallback`, `policy`, `default`, etc. |
| `fallback_chain` | String | JSON string |
| `ingested_at` | DateTime64(3, 'UTC') | 저장 시각 |

DDL 기준:

```sql
create table llm_routing_events (
  event_date Date,
  event_time DateTime64(3, 'UTC'),
  request_id UUID,
  tenant_id UUID,
  project_id Nullable(UUID),
  routing_rule_id Nullable(UUID),
  policy_version_id Nullable(UUID),
  requested_provider LowCardinality(String),
  requested_model LowCardinality(String),
  selected_provider LowCardinality(String),
  selected_model LowCardinality(String),
  decision_reason LowCardinality(String),
  fallback_chain String,
  ingested_at DateTime64(3, 'UTC')
)
engine = MergeTree
partition by toYYYYMM(event_time)
order by (tenant_id, project_id, event_time, request_id)
ttl event_time + interval 180 day;
```

---

## 5.6 `usage_daily_rollups`

Dashboard Overview를 위한 일별 rollup이다. Materialized View로 만들거나 Worker가 집계해 쓸 수 있다.

| 필드 | 타입 | 설명 |
|---|---:|---|
| `date` | Date | 집계일 |
| `tenant_id` | UUID | tenant id |
| `project_id` | Nullable(UUID) | project id |
| `application_id` | Nullable(UUID) | application id |
| `provider` | LowCardinality(String) | provider |
| `model` | LowCardinality(String) | model |
| `request_count` | UInt64 | 요청 수 |
| `success_count` | UInt64 | 성공 수 |
| `error_count` | UInt64 | 오류 수 |
| `blocked_count` | UInt64 | 차단 수 |
| `cache_hit_count` | UInt64 | cache hit 수 |
| `prompt_tokens` | UInt64 | prompt tokens |
| `completion_tokens` | UInt64 | completion tokens |
| `total_tokens` | UInt64 | total tokens |
| `cost_micro_usd` | Int64 | 비용 |
| `avg_latency_ms` | Float64 | 평균 latency |
| `p95_latency_ms` | Float64 | p95 latency |
| `avg_ttft_ms` | Float64 | 평균 TTFT |
| `updated_at` | DateTime64(3, 'UTC') | 갱신 시각 |

DDL 기준:

```sql
create table usage_daily_rollups (
  date Date,
  tenant_id UUID,
  project_id Nullable(UUID),
  application_id Nullable(UUID),
  provider LowCardinality(String),
  model LowCardinality(String),
  request_count UInt64,
  success_count UInt64,
  error_count UInt64,
  blocked_count UInt64,
  cache_hit_count UInt64,
  prompt_tokens UInt64,
  completion_tokens UInt64,
  total_tokens UInt64,
  cost_micro_usd Int64,
  avg_latency_ms Float64,
  p95_latency_ms Float64,
  avg_ttft_ms Float64,
  updated_at DateTime64(3, 'UTC')
)
engine = SummingMergeTree
partition by toYYYYMM(date)
order by (tenant_id, project_id, application_id, date, provider, model);
```

---

# 6. Redis Keyspace 설계

Redis는 테이블이 아니라 key pattern으로 관리한다. 모든 key는 tenant 기준 prefix를 포함한다.

## 6.1 Rate Limit Counter

```text
rl:{tenant_id}:{limit_type}:{target_type}:{target_id}:{window_start_epoch}
```

예:

```text
rl:tenant-uuid:rpm:project:project-uuid:1782104040
rl:tenant-uuid:tpm:app_token:token-uuid:1782104040
rl:tenant-uuid:concurrent_requests:project:project-uuid
```

TTL:

- rpm/tpm: window seconds + 10초
- concurrent_requests: 요청 종료 시 decrement, stale 방지를 위해 짧은 TTL

## 6.2 Quota Counter

```text
quota:{tenant_id}:{quota_type}:{target_type}:{target_id}:{period_key}
```

예:

```text
quota:tenant-uuid:cost_micro_usd:project:project-uuid:2026-06
quota:tenant-uuid:tokens:user:user-uuid:2026-06-22
```

TTL:

- period 종료 후 7~30일
- PostgreSQL ledger와 reconciliation 가능해야 한다.

## 6.3 Active Policy Cache

```text
policy:active:{tenant_id}:{project_id}
policy:active:{tenant_id}:{project_id}:{application_id}
```

Value:

```json
{
  "version": 12,
  "publishedAt": "2026-06-22T00:00:00Z",
  "rateLimits": [],
  "budgets": [],
  "routingRules": [],
  "securityRules": [],
  "modelAllowlist": []
}
```

Invalidation:

- policy publish/rollback
- key revoke
- project/application disable
- provider connection change

## 6.4 Exact Cache

```text
exact_cache:{tenant_id}:{project_id}:{cache_scope}:{prompt_hash}
```

Value:

```json
{
  "responseRedacted": "...",
  "responseSummary": "...",
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "tokenCount": 123,
  "costMicroUsdSaved": 42,
  "createdAt": "2026-06-22T00:00:00Z"
}
```

기준:

- key에는 원문 prompt를 넣지 않는다.
- redacted prompt 기준 hash를 사용한다.
- parent message가 있으면 `current_prompt_hash + parent_message_hash`를 함께 반영한다.

## 6.5 Provider Health / Circuit State

```text
provider_health:{provider}:{region}
circuit:{tenant_id}:{provider}:{model}
```

Value:

```json
{
  "status": "closed",
  "failureCount": 0,
  "openedAt": null,
  "lastErrorCode": null
}
```

## 6.6 Idempotency / Request Lock

```text
request_lock:{request_id}
idempotency:{tenant_id}:{idempotency_key}
```

TTL:

- request lock: 1~5분
- idempotency: 1~24시간. API contract에서 결정

---

# 7. 관계

## 7.1 Core Relationship

```text
users
  └─ tenant_memberships ── tenants
                              ├─ groups
                              │    └─ group_memberships ── users
                              ├─ projects
                              │    ├─ project_memberships ── users
                              │    ├─ applications
                              │    │    └─ app_tokens
                              │    ├─ api_keys
                              │    ├─ provider_connections
                              │    │    └─ provider_key_versions
                              │    ├─ conversations
                              │    │    └─ chat_messages
                              │    ├─ routing_rules
                              │    ├─ rate_limit_rules
                              │    ├─ quota_rules
                              │    └─ budget_policies
                              ├─ runtime_policies
                              │    └─ runtime_policy_versions
                              │         └─ policy_bindings
                              ├─ sensitive_data_rules
                              ├─ audit_logs
                              └─ usage_ledger_entries
```

## 7.2 Request Log Relationship

```text
Gateway request
  -> request_id 생성
  -> Redis에서 policy/rate/cache 처리
  -> Provider 호출 또는 cache hit
  -> Redpanda event 발행
  -> Worker 소비
       -> ClickHouse llm_invocations 저장
       -> ClickHouse llm_provider_attempts 저장
       -> ClickHouse llm_masking_events 저장
       -> ClickHouse llm_cache_events 저장
       -> ClickHouse llm_routing_events 저장
       -> PostgreSQL usage_ledger_entries 저장
       -> PostgreSQL budget_ledger_entries 저장
       -> S3 redacted payload / response summary 저장
```

## 7.3 Policy Relationship

```text
runtime_policies
  -> runtime_policy_versions
  -> policy_bindings
  -> active policy cache in Redis
  -> Gateway runtime decision
```

정책은 code deploy 없이 변경되어야 한다. `runtime_policy_versions`는 immutable이고, `policy_bindings`가 현재 적용 대상을 결정한다.

## 7.4 Credential Relationship

```text
provider_connections
  -> provider_key_versions
       -> secret_ref in AWS Secrets Manager
```

Provider API Key 원문은 DB에 없다.

```text
api_keys / app_tokens
  -> key_hash / token_hash only
  -> Gateway 인증 시 hash 비교
```

---

# 8. 인덱스 기준

## 8.1 PostgreSQL 인덱스 원칙

- Tenant-scoped query는 `tenant_id`를 첫 번째 column으로 둔다.
- 목록 화면은 `status`, `created_at`, `updated_at` 조합을 둔다.
- key/token 인증은 hash unique index를 둔다.
- soft delete table은 unique index에 `where deleted_at is null`을 붙인다.
- JSONB 전체 GIN index는 남발하지 않는다. 자주 검색하는 JSONB key가 생기면 generated column 또는 별도 column으로 승격한다.

## 8.2 ClickHouse 인덱스 원칙

- 대시보드 기본 필터는 `tenant_id`, `project_id`, `event_time`이다.
- `request_id` detail 조회가 많으면 secondary data skipping index 또는 projection을 추가한다.
- provider/model/status는 LowCardinality를 사용한다.
- dashboard는 raw table full scan 대신 rollup/materialized view를 우선 사용한다.

## 8.3 Redis Key 원칙

- 모든 key는 tenant 식별자를 포함한다.
- 원문 prompt, response, provider key를 key/value에 넣지 않는다.
- TTL 없는 cache/counter key 금지.
- source of truth로 쓰지 않는다.

---

# 9. 삭제 정책

## 9.1 Tenant 삭제

```text
1. Tenant status = pending_delete
2. active API Key / App Token revoke
3. active Provider Connection disable
4. active policy cache invalidate
5. Gateway 요청 차단
6. S3 object retention/purge 예약
7. ClickHouse TTL 또는 tenant purge query 수행
8. PostgreSQL PII anonymize
9. retention 만료 후 hard delete 가능
```

## 9.2 User 삭제

```text
1. users.status = deleted
2. tenant_memberships.status = removed
3. project_memberships.status = removed
4. active personal API Key revoke
5. audit/ledger actor 참조는 보존
6. email/name anonymize 가능
```

## 9.3 Project 삭제

```text
1. projects.status = deleted
2. application disable
3. project-scoped API Key / App Token revoke
4. project-scoped Provider Connection disable
5. Redis active policy/cache invalidate
6. 로그와 ledger는 retention 기간 유지
```

## 9.4 API Key / App Token 삭제

삭제는 revoke로 처리한다.

```text
status = revoked
revoked_at = now()
revoked_by_user_id = actor
```

원문 key/token은 애초에 저장하지 않는다.

## 9.5 Provider Key 삭제

```text
1. provider_key_versions.status = revoked
2. provider_connections.status = disabled 또는 새 version active
3. Secrets Manager secret deletion 예약
4. audit_logs에 key fingerprint만 기록
```

## 9.6 Log / Payload 삭제

- ClickHouse invocation log: 기본 180일 TTL
- S3 redacted payload: tenant retention policy 기준
- raw payload: 기본 저장 금지. 허용 시 더 짧은 retention 적용
- audit log: 최소 1년 권장
- ledger: 회계/정산 기준에 맞춰 장기 보관 가능

---

# 10. Prisma / TypeORM 구현 기준

## 10.1 Prisma 기준

- DB column은 `@map("snake_case")`를 사용한다.
- table은 `@@map("table_name")`을 사용한다.
- PostgreSQL `citext` 사용 전 migration에서 extension을 켠다.

```sql
create extension if not exists citext;
create extension if not exists pgcrypto;
```

- `jsonb`는 Prisma `Json`으로 mapping한다.
- money/cost는 Decimal이 아니라 `BigInt` 기반 `*_micro_usd` 사용을 우선한다.

## 10.2 TypeORM 기준

- Entity property는 camelCase, column name은 snake_case로 지정한다.
- 모든 repository query는 tenant-scoped table에서 `tenantId` 조건을 포함해야 한다.
- soft delete는 TypeORM soft remove를 써도 되지만, revoke/archive가 필요한 credential/policy에는 명시 상태 변경 메서드를 둔다.

## 10.3 Migration 기준

- schema 변경은 항상 migration 파일로 남긴다.
- provider/model 추가 때문에 DB enum migration을 만들지 않는다.
- JSONB로 시작한 필드가 자주 필터링되면 별도 column으로 승격한다.
- 대량 테이블에 column 추가 시 default backfill locking을 피한다.

---

# 11. 구현 금지 사항

- Provider API Key 원문을 PostgreSQL, Redis, ClickHouse, 로그에 저장하지 않는다.
- 원문 Prompt/Response를 기본 저장하지 않는다.
- Gateway가 ClickHouse에 직접 쓰지 않는다.
- Frontend가 DB 또는 Provider를 직접 호출하지 않는다.
- 고볼륨 invocation log를 PostgreSQL에 모두 저장하지 않는다. PostgreSQL에는 ledger와 audit 중심으로 저장한다.
- Provider별로 `openai_requests`, `anthropic_requests` 같은 별도 request table을 만들지 않는다.
- provider/model을 DB enum으로 고정하지 않는다.
- 정책을 코드에 하드코딩하지 않는다.
- 문서에 없는 신규 테이블을 임의로 추가하지 않는다. 필요하면 이 문서를 먼저 수정한다.

---

# 12. v1.0.0 구현 우선순위

현재 v1.0.0 DB 범위는 `docs/archive/v1.0.0/contracts.md`를 우선한다. 과거 P0 DB 계획은 `docs/archive/p0/p0-db-migration-plan.md`에서 참고한다. 이 장기 DB 문서의 `P0`, `MVP`, `필수` 표현이 v1.0.0 계약과 충돌하면 v1.0.0 계약을 우선한다.

## 12.1 v1.0.0에서 우선 만들 테이블

PostgreSQL:

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
usage_ledger_entries
audit_logs
p0_llm_invocation_logs
```

`usage_ledger_entries`, `audit_logs`, `model_pricing_rules`는 P0에서 mock usage/cost와 key/provider 변경 기록을 단순화해 저장할 때만 사용한다.

P1 준비 또는 선택 구현:

```text
budget_policies
rate_limit_rules
```

Redis:

```text
gatelm:auth:api_key:{keyHash}
gatelm:auth:app_token:{tokenHash}
gatelm:config:project:{projectId}
gatelm:cache:exact:{cacheKeyHash}
```

## 12.2 P0 필수에서 미뤄도 되는 테이블

```text
groups
group_memberships
tenant_invitations
provider_key_versions
runtime_policies
runtime_policy_versions
policy_bindings
model_allowlist_rules
routing_rules
sensitive_data_rules
quota_rules
budget_ledger_entries
conversations
chat_messages
outbox_events
alert_rules
alert_events
webhook_endpoints
deployment_environments
data_retention_policies
llm_invocations
llm_provider_attempts
llm_masking_events
llm_cache_events
llm_routing_events
usage_daily_rollups
```

단, schema 설계에서는 이미 확장 가능한 target 구조를 사용한다.

---

# 13. 체크리스트

DB 또는 ORM 작업 전에 아래를 확인한다.

- [ ] 이 테이블은 PostgreSQL에 들어갈 원천 데이터인가, ClickHouse에 들어갈 분석 데이터인가?
- [ ] Tenant-scoped 데이터에 `tenant_id`가 있는가?
- [ ] 원문 Prompt/Response 또는 Provider Key가 저장되지 않는가?
- [ ] soft delete가 필요한 테이블에 `deleted_at`이 있는가?
- [ ] mutable table에 `created_at`, `updated_at`이 있는가?
- [ ] append-only table을 update하지 않는가?
- [ ] 비용 값은 float가 아니라 `*_micro_usd` 정수인가?
- [ ] provider/model 확장을 DB enum이 막고 있지 않은가?
- [ ] Gateway 요청 경로에서 대량 분석 DB write를 직접 하지 않는가?
- [ ] 정책 변경 시 audit log와 outbox event가 남는가?
- [ ] index가 실제 조회 조건과 맞는가?
- [ ] 새 테이블을 만들기 전에 이 문서가 먼저 수정되었는가?

---

# 16. PII Masking Policy DB 기준

민감정보 detector/action/redaction의 원천 정책은 `pii-masking-policy.md`를 따른다. DB는 아래 기준을 지킨다.

- `llm_invocations.masking_action`은 request-level outcome이며 `none`, `redacted`, `blocked`를 사용한다.
- `llm_masking_events.action`은 policy action이며 `allow`, `redact`, `block`을 사용한다.
- `llm_masking_events.detector_type`은 enum으로 고정하지 않는다. 새 detector 추가가 가능해야 한다.
- `llm_masking_events.sample_hash`에는 HMAC 기반 hash만 저장한다. raw sample 저장 금지.
- redacted payload는 S3-compatible Object Storage에 저장하고, PostgreSQL/ClickHouse에는 reference만 저장한다.
- security policy 변경은 immutable version row를 추가하고 binding을 교체한다. 기존 로그를 최신 policy 기준으로 덮어쓰지 않는다.
