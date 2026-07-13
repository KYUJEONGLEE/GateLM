# Tenant Chat → Employee Usage Integration Handoff

상태: **Active integration handoff**
수신 대상: Control Plane / Runtime Policy / Employee Usage 담당 Codex
기준 계약: `docs/tenant-chat/contracts.md`

이 문서는 기존 Application Chat 계약의 빈칸을 채우는 답변이 아니다. 신규 Tenant Chat이 Employee identity/usage 영역과 맞닿는 지점에서 구현에 필요한 값을 고정한다. 기존 Project/Application 경로는 변경하지 않는다.

실제 wire/DB/digest/key operation은 [`../execution-contract.md`](../execution-contract.md), [Private Gateway OpenAPI](../openapi/private-gateway.openapi.json), [usage DDL](../db/tenant-chat-usage.sql)을 함께 따른다. 이 handoff의 요약과 machine-readable artifact가 충돌하면 active contract와 execution artifact를 먼저 수정한다.

## 1. Tenant Chat 전체 요청 흐름

```text
Browser
-> chat-web BFF
-> chat-api user access/session/CSRF 검증
-> Control Plane private API에서 User/Tenant/Membership/Employee entitlement 검증
-> employeeNoticeVersion ack 검증
-> tenant-only RuntimeSnapshot exact pin
-> POST private Gateway /admissions + workload JWT
-> Gateway request rate/concurrency allow
-> Chat API bounded context decrypt + current user message encrypted write
-> POST private Gateway /completions + workload JWT + admission binding
-> safety
-> routing
-> cache
-> quota/budget state + reservation
-> provider token rate
-> primary/fallback attempts
-> all billable attempts confirmed settlement
-> assistant final encrypted write
-> usage outbox/projector
-> Request Detail/Dashboard
-> SSE final
```

`rate_limited` 또는 `concurrency_limited`이면 user content/history/capture를 만들지 않는다. cache hit은 request rate만 소비하고 token/cost debit은 0이다.

## 2. Private Gateway endpoint

| Method | Path | Result |
|---|---|---|
| `POST` | `/internal/v1/tenant-chat/admissions` | content-free request rate/concurrency, 30초 admission |
| `POST` | `/internal/v1/tenant-chat/admissions/{admissionId}/cancel` | admission/slot idempotent cancel |
| `POST` | `/internal/v1/tenant-chat/completions` | admission consume, policy/provider pipeline, SSE |

- public `/v1` listener와 다른 private listener를 사용한다.
- Compose private network에만 expose하고 host port를 publish하지 않는다.
- Chat API service만 network path와 signing permission을 가진다.
- 기존 Project API Key/App Token/`X-GateLM-End-User-Id`를 재사용하지 않는다.

## 3. Workload JWT

JOSE header:

```json
{
  "alg": "EdDSA",
  "typ": "gatelm-workload+jwt",
  "kid": "<active workload signing key id>"
}
```

Validation:

- Ed25519/`EdDSA`
- `iss=gatelm-chat-api`
- `aud=gatelm-gateway-tenant-chat`
- `sub=service:chat-api`
- default TTL 30초, max 60초, skew ±5초
- `jti`는 expiry까지 exactly-once consume
- user/workload/diagnostic signing key set은 분리

Claims:

```json
{
  "iss": "gatelm-chat-api",
  "aud": "gatelm-gateway-tenant-chat",
  "sub": "service:chat-api",
  "jti": "<opaque id>",
  "iat": 0,
  "nbf": 0,
  "exp": 0,
  "phase": "admission|completion|cancel",
  "requestId": "<opaque id>",
  "turnId": "<opaque id>",
  "idempotencyKey": "<opaque id>",
  "tenantId": "<tenant id>",
  "userId": "<user id>",
  "actorKind": "tenant_admin|employee",
  "employeeId": "<employee actor only>",
  "actorAuthzVersion": 1,
  "tenantAuthzVersion": 1,
  "sessionVersion": 1,
  "snapshotVersion": 1,
  "snapshotDigest": "sha256:<digest>",
  "bindingDigest": "hmac-sha256:<digest>",
  "admissionId": "<completion/cancel only>"
}
```

Machine-readable shape: `../schemas/workload-jwt-claims.schema.json`.

## 4. executionScope

```json
{
  "surface": "tenant_chat",
  "executionScope": {
    "kind": "tenant_chat",
    "tenantId": "<tenant id>",
    "actor": {
      "userId": "<user id>",
      "actorKind": "employee",
      "employeeId": "<employee id>"
    },
    "quotaScope": {
      "type": "user",
      "id": "<user id>"
    },
    "budgetScope": {
      "type": "tenant",
      "id": "<tenant id>"
    }
  }
}
```

- `projectId`, `applicationId` 없음.
- canonical actor 및 quota key는 `(tenantId,userId)`.
- `employeeId`는 employee entitlement 보조값이며 admin에는 없을 수 있음.
- client가 scope/identity field를 보내면 `400 CHAT_SCOPE_FIELD_FORBIDDEN`.

Machine-readable shape: `../schemas/gateway-request-context.schema.json`.

## 5. User/Tenant/Employee entitlement 검증 위치

| Component | Owns | Does not own |
|---|---|---|
| Control Plane DB | User, Tenant, Membership, Employee status/link/version | per-request Provider execution |
| Chat API | 자체 session check와 매 요청 Control Plane entitlement 호출, workload JWT 발급 | browser scope 신뢰, Control Plane identity table 직접 조회 |
| Gateway | workload JWT, phase/body/admission/snapshot/replay 검증 | Employee 재조회/정규화, user login |

Rules:

- tenant admin: active User + active Tenant + active tenant_admin membership. Employee 불필요.
- employee: active User + active Tenant + active employee membership + linked active Employee.
- admin이 실제 직원이면 optional Employee link 가능.
- admin도 `(tenantId,userId)` 개인 quota/rate를 동일하게 적용받고 tenant budget을 우회하지 않는다.
- tenant 기본 user quota는 admin/employee에 동일하다. userId override는 audit하고 새 snapshot부터 적용한다.
- suspend/logout/revoke/password reset은 다음 Chat API 요청부터 반영.
- in-flight Provider call은 best-effort cancel.

## 6. Quota/budget 예약 및 정산

### State

| State | User quota default | Tenant budget default | Routing |
|---|---:|---:|---|
| warning | soft allocation 80% | budget 80% | unchanged |
| economy | soft allocation 100% | budget 90% | exclude high_quality |
| blocked | soft allocation 120% | budget 100% | cache hit 외 provider call block |

Publish validation은 threshold 순서와 최소 한 개 economy route를 보장한다.

### Transaction

1. cache miss에서 user token period와 tenant cost period를 lock/read한다.
2. selected route의 input estimate + max output + pinned price로 reserve한다.
3. hard stop 초과면 reserve/provider call 없이 403.
4. fallback 전 추가 exposure를 top-up한다.
5. Provider-confirmed usage만 confirmed token/cost로 이동한다.
6. unused reservation은 release한다.
7. all billable attempts를 합산한다.
8. missing usage는 15분 pending 후 unconfirmed incident exposure로 보수적으로 hold한다.

Cache hit, rate/safety block, Provider pre-call failure는 confirmed debit 0이다.

## 7. Usage ledger/event와 idempotency

Tables/records:

- `TenantChatRequestAdmission`
- `TenantChatUserTokenPeriod`
- `TenantChatTenantCostPeriod`
- `TenantChatUsageReservation`
- `TenantChatProviderAttempt`
- `TenantChatUsageLedgerEntry`
- `TenantChatInvocationOutbox`
- `TenantChatInvocationLog`

Keys:

- admission: `(tenantId,userId,idempotencyKey)`
- request/reservation: `requestId`, plus `(tenantId,userId,idempotencyKey)` unique
- provider attempt: `(requestId,attemptNo)`
- ledger: `(requestId,ledgerVersion)`
- outbox/projector dedupe: `(aggregateId=requestId,eventType,eventVersion=ledgerVersion)`
- invocation read model: `requestId`

Events:

- `usage_reserved`
- `usage_topped_up`
- `usage_settled`
- `usage_released`
- `usage_unconfirmed`

Machine-readable schema and transition vectors: `../schemas/usage-settlement-event.schema.json`, `../vectors/usage-event-vectors.json`. Pre-ledger block은 `../schemas/invocation-terminal-event.schema.json`을 따른다.

Correctness 기준은 period/reservation/ledger DB transaction이다. Invocation Log와 Dashboard는 outbox projection이며 lag가 enforcement를 바꾸지 않는다.

## 8. Retry/fallback 비용 계산

- same logical retry는 같은 `turnId`, `requestId`, `idempotencyKey`를 유지한다.
- completed retry는 stored terminal result를 반환하고 provider를 다시 호출하지 않는다.
- 같은 key에 다른 digest가 오면 `409 CHAT_IDEMPOTENCY_CONFLICT`.
- primary가 network call 전 실패하면 confirmed cost/token 0.
- primary가 confirmed billable usage를 만든 뒤 실패하면 그 usage는 정산한다.
- fallback은 pre-delta eligible error/timeout에서만 실행한다.
- fallback call 전 quota/budget top-up과 provider token-rate를 다시 통과한다.
- primary와 fallback 모두 billable이면 둘 다 user quota와 tenant budget에 합산한다.
- 사용자에게는 effective final model과 confirmed total token만 보여주고 attempt별 내부 비용은 숨긴다.

## 9. 오류 코드와 HTTP 상태

| HTTP | Code |
|---:|---|
| 400 | `CHAT_INVALID_REQUEST`, `CHAT_SCOPE_FIELD_FORBIDDEN` |
| 401 | `CHAT_AUTH_REQUIRED`, private-only `CHAT_TOKEN_INVALID` |
| 403 | `CHAT_USER_DISABLED`, `CHAT_TENANT_DISABLED`, `CHAT_MEMBERSHIP_DISABLED`, `CHAT_EMPLOYEE_DISABLED` |
| 403 | `CHAT_QUOTA_HARD_LIMIT`, `CHAT_BUDGET_HARD_LIMIT` |
| 409 | `CHAT_POLICY_ACK_REQUIRED`, `CHAT_IDEMPOTENCY_CONFLICT`, `CHAT_ADMISSION_EXPIRED` |
| 429 | `CHAT_RATE_LIMITED`, `CHAT_CONCURRENCY_LIMITED` |
| 502 | `CHAT_PROVIDER_FAILED` |
| 503 | `CHAT_RUNTIME_UNAVAILABLE`, `CHAT_USAGE_GUARD_UNAVAILABLE`, `CHAT_NO_ELIGIBLE_ROUTE` |
| 504 | `CHAT_PROVIDER_TIMEOUT` |

Response는 safe code/message/retry-after만 포함한다.

## 10. Dashboard 구분자와 집계

Discriminator:

- `surface=tenant_chat`
- `executionScope.kind=tenant_chat`

Required aggregate:

- request/terminal outcome counts
- cache/rate/concurrency/safety/quota/budget outcomes
- quota/budget state counts
- confirmed input/output/total tokens 및 cost micro-USD
- unconfirmed incident count/exposure
- provider/model/route-tier request and attempt breakdown
- fallback request/attempt/success
- p50/p95/p99 latency
- snapshot/pricing provenance와 projection lag

Prometheus에는 bounded `surface`만 추가한다. identity/request/digest를 label로 쓰지 않는다.

Machine-readable shape: `../schemas/dashboard-aggregate.schema.json`.

## 11. DB migration 순서

1. contract/schema/fixture merge
2. additive auth/actor/runtime/admission/ledger/outbox/encrypted-store/audit migration
3. least-privilege DB role/grant
4. Control Plane reader/writer + entitlement path
5. Gateway private listener/JWT verifier/ledger writer, traffic off
6. Chat API + encrypted store
7. projector + Dashboard discriminated reader
8. Chat Web
9. idempotent demo seed + RuntimeSnapshot publish
10. smoke 후 tenant feature flag enable

Destructive down migration, legacy sentinel backfill, old table reuse는 하지 않는다.

## 12. 서비스 배포 순서

```text
PostgreSQL/Redis
-> schema migrate
-> Control Plane
-> Gateway private reader/verifier
-> Chat API
-> projector/Dashboard reader
-> Chat Web
-> demo seed/snapshot
-> feature flag
-> E2E + legacy regression
```

Rollback은 feature flag/writer를 끄고 rows/ciphertext/ledger/key version을 보존한다.

## 13. 이번 handoff에서 제외한 후속 기능

- Semantic Cache backend API/Gateway adapter/Admin UI. 현재 published strategy는 `off|exact`만 허용하고 versioned extension point만 유지한다.
- OAuth-only add-password flow
- employee quota 증액 요청/승인 UI
- diagnostic second-admin/four-eyes option
- legal hold
- native client/enterprise SSO
- managed KMS/HSM, multi-node HA

이 후속 기능은 현재 private Gateway, identity, ledger, Dashboard schema를 깨지 않고 추가해야 한다.
