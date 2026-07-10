# GateLM v2.0.0 DB Migration Plan

> [!IMPORTANT]
> **문서 상태: Historical migration plan.** 현재 작업은 [`docs/current/README.md`](../current/README.md)에서 시작한다. 이 inventory와 순서는 v2.0.0 시점의 실행 계획이며 current DB 상태는 실제 schema/migration으로 다시 확인한다.

이 문서는 v2.0.0 구현을 위한 DB migration 방향을 정리한다.

중요:

- 이 문서는 공식 DB 계약이 아니라 migration 실행 계획이다.
- 실제 table/column 추가는 `contracts.md`, schema/fixture, 구현 PR의 합의 후 진행한다.
- Provider/Model은 DB enum으로 고정하지 않는다.
- raw prompt, raw response, API Key, App Token, Provider Key, Authorization header, provider raw error body, actual secret은 DB에 저장하지 않는다.
- `p0_llm_invocation_logs` 물리 rename은 v2.0.0 초기 PR에서 하지 않는다.

## 1. Current Inventory

현재 DB 관련 경로는 두 계열이 공존한다.

| Area | Current files | Notes |
|---|---|---|
| Control Plane Prisma | `apps/control-plane-api/prisma/schema.prisma` | NestJS/Prisma app source of truth |
| Shared SQL migrations | `db/migrations/*.sql` | Gateway/local stack/evidence path |
| Runtime config | `runtime_configs` in Prisma | editable config and publish state are currently together |
| Provider catalog | `provider_connections`, `model_catalog`, `model_pricing_rules` in SQL; `ProviderConnection` in Prisma | names/columns are not fully aligned |
| Credentials | `gateway_api_keys`, `app_tokens` in Prisma; `api_keys`, `app_tokens` in SQL | compatibility path exists |
| Request logs | `p0_llm_invocation_logs` in SQL and Gateway postgres adapter | physical rename deferred |

Implication:

- v2 migration must not assume a single perfectly clean DB history.
- Prisma and SQL migration paths need explicit compatibility review before physical renames.
- First v2 migration PRs should add bridge-compatible structures before deleting or renaming legacy structures.

## 2. Contract Constraints

| Contract rule | Migration consequence |
|---|---|
| Core identity is `tenantId/projectId/applicationId` | RuntimeSnapshot active lookup index uses tenant/project/application, not budget scope |
| Budget scope is attribution, not runtime lookup key | Budget scope columns may be stored for logs/read model, but not as RuntimeSnapshot active key |
| RuntimeConfig is editable | Keep editable config table/document separate from immutable snapshot records |
| RuntimeSnapshot is immutable | Never update snapshot body in place; create a new version |
| DB is source of truth, Redis is pointer/cache | Store snapshot body/provenance in DB; Redis may cache active pointer |
| Provider/Model are not enums | Use text/catalog rows, not DB enum types |
| Provider credential is `credentialRef` metadata | Do not store provider key plaintext in snapshot/catalog/log |
| `secretRef` is legacy compatibility | Keep bridge/mapping until explicit migration |
| Observability consumes Gateway outcomes | Request log tables/read models should store or derive from Gateway-produced outcome, not guessed status |
| physical log rename is deferred | Do not rename `p0_llm_invocation_logs` in initial v2 PRs |

## 3. Proposed Migration Sequence

### DB-0. Inventory And Compatibility Gate

Goal:

- Confirm which DB path is active for each app before changing schema.

Tasks:

- Compare `apps/control-plane-api/prisma/schema.prisma` with `db/migrations/*.sql`.
- List table name differences such as `gateway_api_keys` vs `api_keys` and ProviderConnection column differences.
- Confirm which migrations are actually applied in local/dev.
- Do not add RuntimeSnapshot tables until this inventory is done.

Acceptance:

- A PR description states the active DB path and affected tables.
- No table/column rename is performed.

Rollback:

- Documentation-only revert.

### DB-1. RuntimeSnapshot Storage Thin Slice

Goal:

- Add immutable RuntimeSnapshot storage while keeping RuntimeConfig editable source intact.

Candidate table:

```text
runtime_snapshots
```

Candidate columns:

| Column | Type candidate | Rule |
|---|---|---|
| `id` | uuid primary key | maps to `runtimeSnapshotId` |
| `tenant_id` | uuid not null | part of lookup key |
| `project_id` | uuid not null | part of lookup key |
| `application_id` | uuid not null | part of lookup key |
| `runtime_config_id` | uuid null | lineage to editable source |
| `version` | integer not null | monotonic per application |
| `content_hash` | text not null | no raw policy body exposure |
| `snapshot_body` | jsonb not null | sanitized Gateway execution body |
| `published_at` | timestamptz not null | provenance |
| `published_by` | text not null | sanitized actor id |
| `created_at` | timestamptz not null default now() | audit |

Candidate constraints:

- unique `(application_id, version)`
- unique `(application_id, content_hash)` only if idempotent publish is desired
- index `(tenant_id, project_id, application_id, version desc)`

Rules:

- `snapshot_body` must not include Provider Key, API Key, App Token, Authorization header, or actual secret.
- `budgetScopeType/budgetScopeId` may exist inside snapshot body as policy, but not in the active lookup key.
- `runtimeState` is not a mutable DB status for the snapshot row. Runtime states such as `last_known_safe_used` are Gateway runtime provenance.

Rollback:

- Drop `runtime_snapshots` only if no Gateway reads it.
- If Gateway already reads it, disable RuntimeSnapshot adapter first.

### DB-2. Active RuntimeSnapshot Pointer

Goal:

- Represent the active published snapshot without mutating the immutable snapshot row.

Candidate table:

```text
active_runtime_snapshots
```

Candidate columns:

| Column | Type candidate | Rule |
|---|---|---|
| `tenant_id` | uuid not null | lookup key |
| `project_id` | uuid not null | lookup key |
| `application_id` | uuid not null | lookup key |
| `runtime_snapshot_id` | uuid not null | points to immutable snapshot |
| `updated_at` | timestamptz not null | pointer update time |
| `updated_by` | text not null | sanitized actor id |

Candidate constraints:

- primary key `(tenant_id, project_id, application_id)`
- foreign key to `runtime_snapshots(id)`

Rules:

- Publish failure must not change this pointer.
- Validation failure must not create a snapshot and must not change this pointer.
- Redis can cache this pointer, but DB remains source of truth.

Rollback:

- Repoint to the previous snapshot id.
- If pointer table is new and unused, drop it.

### DB-3. Provider Catalog And Credential Reference Bridge

Goal:

- Align Provider Catalog with `credentialRef` without breaking existing `secretRef` code.

Candidate changes:

| Existing concept | v2 direction | Migration rule |
|---|---|---|
| `secretRef` | `credentialRef` | add read/write bridge before rename |
| provider/model strings | catalog data | keep text, no enum |
| provider key storage | external secret/env reference | no plaintext provider key DB column |
| provider raw error | sanitized error code | no raw provider error body storage |

Safe path:

1. Keep existing `secretRef` fields where code still needs them.
2. Add mapper that exposes `credentialRef` in RuntimeSnapshot/Provider Catalog.
3. Only after all consumers use `credentialRef`, consider physical rename.

Rollback:

- Keep `secretRef` compatibility field.
- Disable new mapper if it breaks consumers.

### DB-4. Budget Scope Propagation

Goal:

- Persist resolved budget scope for Request Log/Detail/Dashboard attribution.

Candidate storage:

- Prefer metadata/read model bridge first if existing log table already stores JSON metadata.
- Add physical columns only after query profile proves they are needed.

Candidate physical columns, if needed later:

| Column | Type candidate | Rule |
|---|---|---|
| `budget_scope_type` | text | allowed values: `application`, `project`, `team` |
| `budget_scope_id` | text or uuid | resolved target id |
| `budget_scope_resolved_by` | text | `default_application`, `runtime_snapshot`, `control_plane_rule` |

Rules:

- Do not store `client_provided` as `resolvedBy`.
- Do not include budget scope in RuntimeSnapshot active lookup key.
- Dashboard filters may use resolved budget scope.

Rollback:

- If physical columns are added, keep nullable and fall back to metadata/default application mapping.

### DB-5. Request Outcome Read Model Bridge

Goal:

- Support `terminalStatus + domainOutcomes` without risky physical rename.

Current table:

```text
p0_llm_invocation_logs
```

Safe path:

1. Keep physical table name and legacy columns.
2. Add mapper/read model that exposes v2 terminal/domain outcomes.
3. Store domain outcomes in JSON metadata if needed before physical schema freeze.
4. Do not rename `status` column in v2.0.0 initial PRs.

Candidate later columns, only after contract/schema freeze:

| Column | Type candidate | Rule |
|---|---|---|
| `terminal_status` | text | values: `success`, `blocked`, `rate_limited`, `failed`, `cancelled` |
| `domain_outcomes` | jsonb | Gateway-produced only |
| `runtime_snapshot_id` | text or uuid | provenance only |
| `runtime_snapshot_version` | integer | monotonic version |

Rules:

- Observability must not infer outcomes.
- Metrics labels must not include request/trace IDs, hashes, credential IDs, auth headers, provider keys, or raw error detail.

Rollback:

- Keep legacy log reader/writer.
- Disable v2 read model mapping if needed.

## 4. Tables To Avoid Renaming In Early v2

| Table / column | Reason |
|---|---|
| `p0_llm_invocation_logs` | high blast radius; existing Gateway tests/readers depend on it |
| `p0_llm_invocation_logs.status` | logical mapping can happen before physical rename |
| `secretRef` fields | compatibility bridge needed before rename to `credentialRef` |
| provider/model text columns | enum locking is explicitly forbidden |

## 5. Migration Review Checklist

Every DB PR must answer:

- Which `contracts.md` section is consumed?
- Does this PR add/change table, column, index, constraint, enum, or seed data?
- Does this PR store any forbidden sensitive value?
- Does this PR keep Provider/Model as catalog/config data?
- Does this PR keep RuntimeSnapshot lookup key as `tenantId/projectId/applicationId`?
- Does this PR avoid trusting client-provided budget scope?
- Does this PR preserve v1 baseline smoke where applicable?
- What is the rollback command or operational rollback path?
- What read model remains compatible during rollback?

## 6. Stop Conditions

Stop and create a contract/design PR if:

- A physical rename of `p0_llm_invocation_logs` is required.
- A physical rename from `secretRef` to `credentialRef` is required before mapper compatibility exists.
- A provider/model enum seems necessary.
- RuntimeSnapshot needs budget scope in its active lookup key.
- RuntimeSnapshot body needs raw credential material.
- Request logs need raw prompt/response or provider raw error body.
- Dashboard requires high-cardinality IDs or hashes as metrics labels.

## 7. First Safe DB PR Recommendation

The first DB PR should be conservative:

1. Do not rename existing tables.
2. Add `runtime_snapshots` and `active_runtime_snapshots` only after DB inventory confirms the active migration path.
3. Keep new columns nullable or isolated until Gateway live adapter consumes them.
4. Add tests that validation failure creates no snapshot and publish failure preserves the active pointer.
5. Keep rollback as pointer revert or feature flag disable, not destructive data migration.
