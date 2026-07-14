# GateLM Tenant Chat Active Contract v1

상태: **Active implementation contract**
계약 revision: `tenant-chat/v1`
적용 시작: 2026-07-12
대상: Control Plane, Chat Web, Chat API, Gateway, PostgreSQL, Redis, Dashboard, Compose

## 1. 계약 지위

이 문서는 신규 Tenant Chat 구현의 현재 기준이다. 기존 `docs/v2.0.0`은 Project/Application 경로의 legacy baseline이며 Tenant Chat에 hidden Project/Application을 강제하지 않는다. `docs/v2.1.0`은 기존 self-host/advanced-routing 범위로 유지한다.

이 계약은 영구 불변 문서가 아니다. 구현 경험으로 전제가 달라지면 revision을 만들 수 있다. 다만 active revision이 바뀌기 전까지 구현과 테스트는 이 문서 및 paired schema/fixture를 따른다.

## 2. 용어와 identity 결정

| 용어 | 의미 |
|---|---|
| `User` | 로그인 가능한 전역 계정. 인증 principal의 원본이다. |
| `TenantMembership` | User와 Tenant를 연결하고 `tenant_admin` 또는 `employee` 역할 및 active 상태를 가진다. |
| `Employee` | Tenant의 직원/인사 레코드. employee membership에는 active Employee가 필요하다. |
| canonical actor | `(tenantId, userId)`. 인증, 대화 소유권, 개인 quota의 안정적인 key다. |
| `employeeId` | employee entitlement와 관리자 조회를 위한 보조 식별자. 인증 principal이나 quota ledger primary key가 아니다. |
| tenant admin | active User + active Tenant + active tenant_admin membership. dummy Employee row를 만들지 않는다. admin이 실제 직원이기도 하면 Employee가 연결될 수 있다. |
| signing key set | 현재 서명 key와 교체 중인 이전 key를 함께 관리하는 작은 versioned 집합. 과거 문서의 `keyring`과 같은 뜻이다. |
| workload JWT | end-user 로그인 token이 아니라 Chat API가 Gateway에 자신과 요청 결정을 증명하는 service-to-service token이다. `auth.*` browser domain이 아니다. |
| `EncryptedChatStore` | PostgreSQL ciphertext와 application-level AES-GCM envelope encryption을 사용하는 모듈. HashiCorp Vault를 도입한다는 뜻이 아니다. |

### 2.1 Entitlement 규칙

- `tenant_admin`: User, Tenant, TenantMembership이 모두 active면 Chat을 사용할 수 있다. Employee는 선택 사항이다.
- `employee`: User, Tenant, TenantMembership, linked Employee가 모두 active여야 한다.
- tenant admin도 employee와 동일하게 `(tenantId,userId,periodStart)` 개인 quota와 request/token rate를 적용받는다. Employee가 없다는 이유로 무제한이 되지 않는다.
- tenant 기본 user quota는 admin/employee에 동일하게 적용한다. tenant admin은 userId별 override를 설정할 수 있지만 변경은 audit하고 새 RuntimeSnapshot부터 적용하며 tenant budget hard stop을 우회할 수 없다.
- Chat API가 모든 새 browser/API 요청에서 session/device state는 자체 session DB에서, identity entitlement는 Control Plane private API의 authoritative read로 확인한다.
- Gateway는 Employee DB를 다시 조회하거나 browser actor header를 해석하지 않는다. 유효한 workload JWT의 Chat API 결정을 신뢰하고 tenant snapshot/status, JWT scope/binding/replay만 검증한다.
- 정지·logout·device revoke·password reset은 다음 Chat API 요청부터 거부한다. 이미 Provider로 전달된 in-flight 요청은 best-effort cancel하고, 완료되면 기존 safety/persistence 규칙을 적용한다.

### 2.2 Browser auth와 session 계약

Browser auth wire는 [Chat auth OpenAPI](./openapi/chat-auth.openapi.json)를 따른다.

- Browser는 `chat-web`의 same-origin BFF만 호출한다. `chat-api`와 Control Plane은 private service network에만 둔다.
- Chat Web BFF는 `TENANT_CHAT_WEB_SERVICE_TOKEN`으로 Chat API를 인증한다. Chat API는 별도 `TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN`으로 Control Plane의 Tenant Chat identity endpoint와 active RuntimeSnapshot metadata reader만 호출한다. 기존 Gateway용 internal token 권한을 mutation으로 넓히지 않는다.
- access token은 별도 signing key set으로 서명한 5분 JWT다. refresh token은 30일 opaque random token이며 PostgreSQL에는 hash만 저장한다.
- refresh는 매번 rotate한다. consumed token 재사용이 발견되면 해당 family와 session을 모두 revoke하고 `sessionVersion`을 증가시킨다.
- Chat API는 session table만 직접 소유·조회한다. User/Tenant/Membership/Employee identity는 Control Plane private entitlement API에서 authoritative하게 확인한다.
- 보호 요청 시작 시 한 번 entitlement를 확인한다. Control Plane이 unavailable이면 safe `503 CHAT_ENTITLEMENT_UNAVAILABLE`로 fail closed하며 mutation을 retry하지 않는다.
- access JWT claim은 `iss`, `aud`, `sub`, `sid`, `deviceIdHash`, optional selected `tenantId`, `actorKind`, optional `employeeId`, `sessionVersion`, `actorAuthzVersion`, `tenantAuthzVersion`, `iat`, `nbf`, `exp`, `jti`다. raw invitation/refresh/CSRF value는 포함하지 않는다.

| Cookie | HttpOnly | SameSite | TTL/path |
|---|---:|---|---|
| `gatelm_chat_access` | yes | Lax | 5분, `/` |
| `gatelm_chat_refresh` | yes | Strict | 30일, `/api/tenant-chat/auth` |
| `gatelm_chat_csrf` | no | Strict | session bounded, `/` |
| `gatelm_chat_oauth_state` | yes | Lax | 10분, Google callback path |
| `gatelm_chat_invite_intent` | yes | Lax | 15분, `/` |

- cookie는 host-only이고 `Domain`을 설정하지 않는다. production은 `Secure`, local origin은 `http://chat.localhost:3002`다.
- state-changing BFF route는 exact `Origin`과 double-submit `X-GateLM-CSRF` header/cookie를 검증한다. OAuth callback은 CSRF 대신 one-time state를 검증한다.
- auth/session response는 `Cache-Control: no-store`, invitation entry는 `Referrer-Policy: no-referrer`를 사용한다.

### 2.3 Invitation과 Google binding

- employee email link는 `TENANT_CHAT_WEB_ORIGIN`의 `/invitations/accept?token=...`을 사용한다. Project Admin invitation은 기존 Dashboard origin을 유지한다.
- Chat Web은 entry token을 server-side 15분 invitation intent로 교환한 뒤 clean URL로 `303` redirect한다. token을 DOM, browser storage, public API response, structured log에 남기지 않는다.
- 신규 account만 invitation acceptance에서 password를 만들 수 있다. 기존 account는 정상 password login 또는 Google 인증을 완료한 뒤 invitation을 bind한다.
- acceptance transaction은 invitation row와 normalized email advisory lock을 획득하고 status/expiry/revoke/email을 재검사한 뒤 User/Membership/Employee를 atomic bind한다.
- 기존 User의 `passwordHash`, `authProvider`, OAuth link는 invitation token만으로 변경하지 않는다.
- Google callback은 protected state와 invitation intent를 확인하고 provider email 일치, invitation status/expiry/revoke를 다시 검사한 뒤 atomic bind한다.
- 여러 active tenant가 있으면 session은 `tenant_selection_required`로 시작한다. tenant 선택 후 entitlement를 다시 확인하고 새 access JWT를 발급한다.

Version ownership:

- Control Plane은 `actorAuthzVersion`과 `tenantAuthzVersion`을 소유한다.
- User status/password/OAuth identity, Membership role/status/delete, linked Employee status/link/delete 변경은 actor version을 증가시킨다.
- Tenant status 변경은 tenant version을 증가시킨다.
- Chat API는 session별 `sessionVersion`을 소유하며 logout, device revoke, refresh reuse detection에서 증가시킨다.

## 3. 제품 및 runtime 경계

Tenant Chat은 기존 Application Chat과 분리한다.

```json
{
  "surface": "tenant_chat",
  "executionScope": {
    "kind": "tenant_chat",
    "tenantId": "tenant_demo_001",
    "actor": {
      "userId": "user_demo_001",
      "actorKind": "employee",
      "employeeId": "employee_demo_001"
    },
    "quotaScope": {
      "type": "user",
      "id": "user_demo_001"
    },
    "budgetScope": {
      "type": "tenant",
      "id": "tenant_demo_001"
    }
  }
}
```

Rules:

- `executionScope.kind=tenant_chat`에는 `projectId`와 `applicationId`가 없다.
- `employeeId`는 actor가 employee일 때만 존재한다.
- quota primary key는 `(tenantId,userId,periodStart)`다.
- budget primary key는 `(tenantId,periodStart,currency)`다.
- client-provided execution/quota/budget scope는 무시하지 않고 `400 CHAT_SCOPE_FIELD_FORBIDDEN`으로 거부한다.
- Provider/Model은 catalog data이며 code/DB enum으로 고정하지 않는다.

## 4. 전체 요청 흐름

```text
Browser
-> chat-web same-origin BFF
-> chat-api access/session/CSRF validation
-> Control Plane private User/Tenant/Membership/Employee entitlement API check
-> employeeNoticeVersion acknowledgement check
-> exact immutable tenant RuntimeSnapshot pin
-> workload JWT(admission) 발급
-> private Gateway admission: request rate + active concurrency
-> Chat API가 current user message를 encrypted store에 durable 기록
-> Chat API가 completed prior context만 bounded decrypt
-> workload JWT(completion) 발급
-> private Gateway completion이 admission/body/snapshot binding consume
-> safety
-> routing eligibility
-> cache strategy
-> quota/budget state 계산 및 atomic reservation
-> provider token rate
-> provider call, 필요 시 eligible fallback 전 top-up
-> 모든 billable attempt confirmed usage/cost atomic settlement
-> final assistant display만 EncryptedChatStore에 저장
-> usage outbox/projector
-> Request Detail/Dashboard aggregate
-> SSE final
```

Hard ordering rules:

- rate/concurrency deny 전에는 user content/history/diagnostic capture를 저장하지 않는다.
- exact cache hit은 request rate만 소비하고 token quota 및 cost budget debit은 0이다.
- provider call은 quota/budget reservation이 성공한 뒤에만 시작한다.
- assistant partial delta는 영구 저장하지 않는다.
- raw content, body binding digest, JWT/JTI는 structured log나 metric label에 남기지 않는다.
- Chat API-facing 성공 terminal은 assistant ciphertext commit 뒤에만 보낸다.
- user ciphertext commit 실패는 admission을 best-effort cancel하고 Provider completion을 시작하지 않는다.

## 5. Private Gateway API

Gateway의 Tenant Chat route는 public `/v1` listener에 등록하지 않는다. Compose private network에만 expose하고 host port를 publish하지 않는다.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/internal/v1/tenant-chat/admissions` | content 없이 request rate/concurrency/idempotency를 결정하고 30초 admission을 생성 |
| `POST` | `/internal/v1/tenant-chat/admissions/{admissionId}/cancel` | Chat API persistence 실패 또는 user cancel 시 admission/slot을 idempotent 종료 |
| `POST` | `/internal/v1/tenant-chat/completions` | encrypted user write 후 admission을 consume하고 policy/provider pipeline 실행 |

Common requirements:

- `Authorization: Bearer <workload JWT>`
- `Content-Type: application/json`
- request body/context와 JWT `bindingDigest`가 일치해야 한다.
- same `idempotencyKey` + same binding은 기존 결과를 replay/attach한다.
- same `idempotencyKey` + different binding은 `409 CHAT_IDEMPOTENCY_CONFLICT`다.
- JWT 또는 body를 log하지 않는다.

Endpoint별 request/response, required/optional field, status, error code, idempotency replay와 SSE wire는 [Private Gateway OpenAPI](./openapi/private-gateway.openapi.json)와 [execution contract](./execution-contract.md)를 따른다.

## 6. Workload JWT

### 6.1 JOSE header

```json
{
  "alg": "EdDSA",
  "typ": "gatelm-workload+jwt",
  "kid": "chat-workload-active-key-id"
}
```

- Ed25519를 사용한다.
- user access token, workload token, diagnostic token은 각각 별도 signing key set, issuer, audience를 사용한다.
- Gateway는 `alg`, `typ`, `kid`, issuer, audience, subject를 exact allowlist로 검증한다.
- private key는 Chat API만 읽고 Gateway는 JWKS/public key만 읽는다.

### 6.2 Claims

필수 claim은 paired [schema](./schemas/workload-jwt-claims.schema.json)를 따른다.

- `iss=gatelm-chat-api`
- `aud=gatelm-gateway-tenant-chat`
- `sub=service:chat-api`
- `jti`, `iat`, `nbf`, `exp`
- `phase=admission|completion|cancel`
- `requestId`, `turnId`, `idempotencyKey`
- `tenantId`, `userId`, `actorKind`, optional `employeeId`
- `actorAuthzVersion`, `tenantAuthzVersion`, `sessionVersion`
- `snapshotVersion`, `snapshotDigest`
- `bindingDigest`
- completion/cancel의 `admissionId`

Default lifetime은 30초, absolute maximum은 60초다. clock skew allowance는 ±5초다. `jti`는 token expiry까지 Redis에서 exactly-once consume하고 Redis continuity를 확인할 수 없으면 fail closed한다.

`bindingDigest`는 canonical metadata/body의 `HMAC-SHA-256` digest다. 실제 content나 운영 digest는 log/metric/fixture에 넣지 않으며 synthetic contract vector만 허용한다. 정확한 canonicalization과 key 선택은 [execution contract](./execution-contract.md)를 따른다.

## 7. RuntimeSnapshot과 policy

- Chat API가 turn 시작 시 immutable `snapshotVersion`, `snapshotDigest`, `policyVersion`, `employeeNoticeVersion`을 pin한다.
- Gateway는 같은 version/digest만 실행한다. latest로 다시 해석하지 않는다.
- active snapshot이 없거나 revoked/invalid이면 `503 CHAT_RUNTIME_UNAVAILABLE`로 fail closed한다.
- rollback은 과거 pointer를 되돌리지 않고, 과거 content를 재검증한 새 monotonic snapshot을 발행한다.
- routing/provider/safety/cache/quota/budget/pricing capability는 snapshot에 포함한다.
- 정확한 tenant snapshot shape, digest와 pricing provenance는 [paired schema](./schemas/tenant-runtime-snapshot.schema.json) 및 [execution contract](./execution-contract.md)를 따른다.

### 7.1 관리자 Runtime 활성화

- 관리자 wire는 [`openapi/admin-runtime.openapi.json`](./openapi/admin-runtime.openapi.json)을 따른다.
- `GET /admin/v1/tenants/{tenantId}/tenant-chat/runtime`은 tenant-level ACTIVE Provider 연결, 설정된 Chat 모델의 가격 지원 상태와 active snapshot metadata만 반환한다. credential, base URL, secret reference, Provider raw error와 `publishedBy`는 반환하지 않는다.
- `PUT /admin/v1/tenants/{tenantId}/tenant-chat/runtime`은 `providerConnectionId`와 `modelKey`만 받는다. Control Plane은 tenant scope, `projectId=null`, ACTIVE 상태, persisted `providerConfig.models` 포함 여부와 versioned 가격 catalog의 exact model entry를 다시 검증한다.
- Provider family는 persisted `providerConfig.providerFamily`에서만 판정한다. client 입력이나 base URL 추론으로 가격을 선택하지 않는다.
- 가격 catalog는 Provider/Model config data이며 DB/code enum이 아니다. 표준 on-demand text input/output 가격을 현재 pricing schema로 정확히 표현할 수 있는 exact model ID만 활성화한다. 알 수 없거나 tiered/modality-specific인 가격은 `pricing_unavailable`이다.
- `modelKey`는 1~200자의 `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$`를 사용한다. Provider/model catalog의 점, 슬래시와 콜론을 지원하지만 whitespace와 control 문자는 허용하지 않는다.
- 최초 활성화는 계약에 고정된 safe default policy를 조합한다. 재구성은 active snapshot의 rate/concurrency/quota/budget/cache/safety/streaming 및 employee notice version을 보존하고 routing/fallback/provider token rate/pricing만 새 선택으로 교체한다.
- 동일 Provider/model, policy와 가격의 PUT은 active snapshot을 그대로 반환한다. 변경이 있으면 snapshot, policy, pricing version을 serializable transaction 안에서 각각 monotonic하게 증가시킨다.
- 선택 모델 하나에 deterministic `standard`와 `economy` route를 만들고 fallback은 끈다. client-provided quota, budget, route 또는 publisher scope는 허용하지 않는다.

### 7.2 Cache extensibility

현재 published policy shape는 다음 전략만 허용한다.

```json
{
  "cache": {
    "strategy": "exact",
    "enabled": true,
    "ttlSeconds": 300,
    "maxEntriesPerUser": 100,
    "keySetId": "tenant_chat_cache_keys_001"
  }
}
```

- 현재 runtime/API/schema/UI 지원 전략은 `off|exact`다.
- Semantic Cache는 닫힌 non-goal이 아니라 follow-up capability지만, backend API와 Gateway adapter가 없으므로 현재 DTO, published RuntimeSnapshot, Admin UI에 선택지를 노출하지 않는다.
- cache adapter/interface, versioned policy discriminator, capabilities response는 후속 contract revision에서 `semantic` 전략을 추가할 수 있어야 한다.
- exact cache는 tenant+user scoped, encrypted, history disabled면 off다.
- exact cache outer key는 tenant+user namespace만 포함하고 keyed fingerprint는 Redis hash field로만 사용한다. value는 AES-256-GCM으로 암호화하며 confirmed primary 성공만 저장한다.
- Semantic Cache를 구현할 때 tenant isolation, embedding/version, safety/policy/snapshot binding, content retention, invalidation, false-hit evaluation과 Admin API/UI를 별도 contract revision으로 고정한다.

## 8. Quota와 budget 정책

### 8.1 상용 패턴을 반영한 결정

공급자 budget은 대개 알림 중심이며 hard stop은 별도 정책으로 결합한다. 고급 모델 allowance가 소진된 뒤 기본 모델을 계속 제공하는 제품 패턴도 있다.

- [OpenAI project budget](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform?t=1): soft threshold이며 초과 후에도 API 요청이 계속된다.
- [GitHub Copilot usage limits](https://docs.github.com/en/copilot/concepts/usage-limits): allowance와 추가 사용 budget을 분리한다.
- [AWS Budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html): threshold 이후 자동 또는 수동 정책 action을 결합한다.
- [Google Cloud selective control](https://docs.cloud.google.com/billing/docs/how-to/control-usage): 전체 중단 대신 선택적으로 resource를 줄이는 방식을 제공한다.

Tenant Chat은 이를 단순한 세 상태로 구현한다.

| 상태 | 사용자 UI | Gateway behavior |
|---|---|---|
| `normal` | 별도 경고 없음 | snapshot의 전체 eligible route 사용 |
| `warning` | profile에 사용량 경고 | routing 변경 없음 |
| `economy` | “절약 모드가 적용됨” | `high_quality` 제외, `standard|economy` route만 사용 |
| `blocked` | “관리자에게 한도 문의” | cache hit 외 새 provider call 차단 |

MVP UI는 위 상태만 보여주고 세부 threshold 편집은 admin advanced section에 둔다. 직원용 in-product 증액 승인 workflow는 후속 PR이며 MVP는 관리자 문의 안내와 admin quota 편집으로 끝낸다.

### 8.2 기본 threshold

| Scope | Warning | Economy | Hard stop |
|---|---:|---:|---:|
| user monthly confirmed tokens | soft allocation의 80% | soft allocation의 100% | soft allocation의 120% |
| tenant monthly confirmed cost | budget의 80% | budget의 90% | budget의 100% |

- tenant admin은 absolute limits와 threshold를 설정할 수 있다.
- publish validator는 `0 < warning < economy < hardStop`과 최소 하나의 economy-eligible route를 요구한다.
- user period는 tenant-configured IANA timezone 기준 월이며 변경은 다음 period부터 적용한다.
- tenant cost는 MVP에서 USD micro-unit과 pinned pricing version을 사용한다.

### 8.3 Reservation과 settlement

1. exact cache miss에서 user token과 tenant cost의 current confirmed+reserved 상태를 확인한다.
2. selected route의 bounded input estimate + max output 및 가격으로 conservative reservation을 한 transaction에서 만든다.
3. hard stop을 넘으면 reservation 없이 차단한다.
4. Provider call 직전 weighted token-rate를 소비한다.
5. fallback이 필요하면 실제 호출 전에 추가 exposure를 atomic top-up한다. top-up이 실패하면 fallback을 호출하지 않는다.
6. Provider가 확인한 input/output token과 pinned price만 confirmed ledger로 이동한다.
7. reservation 잔액은 release한다.
8. cache hit, safety/rate block, provider pre-call failure는 confirmed token/cost 0이다.
9. 실제 Provider call에서 confirmed billable usage가 발생했다면 final 성공 여부와 무관하게 user quota와 tenant budget에 귀속한다.
10. primary와 fallback 모두 billable usage가 있으면 모든 attempt를 합산한다. 최종 성공 Provider만 계산하지 않는다.

### 8.4 Missing usage

- 성공/실패 응답에 usage가 없으면 0으로 추정하지 않는다.
- reservation은 최대 15분 `pending_unconfirmed`으로 유지한다.
- 이후 non-billable `unconfirmed_exposure` capacity hold/incident로 전환한다. 직원 Dashboard confirmed totals에는 넣지 않는다.
- late usage가 오면 original period/pricing으로 exactly-once settle한다.
- 운영자는 provider evidence가 있을 때만 audited CAS release를 할 수 있다.

## 9. Usage ledger와 idempotency

### 9.1 Authoritative records

| Record | Unique key | Purpose |
|---|---|---|
| `TenantChatRequestAdmission` | `(tenantId,userId,idempotencyKey)` | content-free rate/concurrency admission |
| `TenantChatUserTokenPeriod` | `(tenantId,userId,periodStart)` | confirmed/reserved token balance |
| `TenantChatTenantCostPeriod` | `(tenantId,periodStart,currency)` | confirmed/reserved tenant cost balance |
| `TenantChatUsageReservation` | `requestId` and `(tenantId,userId,idempotencyKey)` | request reserve/top-up/settle state machine |
| `TenantChatProviderAttempt` | `(requestId,attemptNo)` | primary/fallback billable attempt |
| `TenantChatUsageLedgerEntry` | `(requestId,ledgerVersion)` | append-only reservation/settlement delta |
| `TenantChatInvocationOutbox` | `(aggregateId,eventType,eventVersion)` | atomic projection handoff |
| `TenantChatInvocationLog` | `requestId` | Request Detail/Dashboard physical read model |

정확한 column/type/PK/FK/nullability/check/index는 [usage DDL contract](./db/tenant-chat-usage.sql)를 따른다. 이 DDL은 아직 적용된 migration이 아니며 Gateway 구현 PR이 동일 의미의 additive Prisma/SQL migration으로 옮긴다.

Correctness source는 period/reservation/ledger transaction이다. `TenantChatInvocationLog`와 Dashboard projector는 재생 가능한 read model이며 projection lag가 quota 판단을 바꾸지 않는다. 기존 `p0_llm_invocation_logs`에 tenant-chat sentinel Project/Application을 넣지 않는다.

### 9.2 Event

Ledger transition outbox는 paired [usage settlement schema](./schemas/usage-settlement-event.schema.json)를 따른다. admission/rate/concurrency처럼 usage ledger 이전에 끝난 요청은 [content-free terminal event schema](./schemas/invocation-terminal-event.schema.json)로 같은 outbox/projector를 사용한다.

Idempotency rules:

- `turnId`는 Chat API가 logical user turn마다 한 번 생성한다.
- `requestId`는 Gateway execution마다 globally unique이며 같은 logical retry는 유지한다.
- `idempotencyKey`는 Chat API가 turn에 binding하고 browser-provided identity/scope를 포함하지 않는다.
- provider attempt는 `(requestId,attemptNo)` unique다.
- ledger transition은 expected `ledgerVersion` CAS로 한 번만 적용한다.
- outbox insert는 ledger transaction과 같은 DB transaction이다.
- 기존 event는 `schemaVersion=1`을 유지한다. mixed deadline/late transition만 `schemaVersion=2`, `eventVersion=ledgerVersion`이며 consumer는 `(aggregateId=requestId,eventType,eventVersion)` duplicate를 no-op한다.

## 10. 오류 계약

모든 오류 response는 safe `code`, `message`, optional bounded `retryAfterSeconds`만 포함한다. request body, provider raw error, JWT, internal request ID는 employee response에 넣지 않는다.

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `CHAT_INVALID_REQUEST` | body/size/field validation 실패 |
| 400 | `CHAT_SCOPE_FIELD_FORBIDDEN` | browser가 tenant/user/employee/quota/budget scope를 보냄 |
| 400 | `CHAT_CURSOR_INVALID` | cursor tamper, scope/limit/epoch binding 불일치 |
| 401 | `CHAT_AUTH_REQUIRED` | user session 없음/만료 |
| 401 | `CHAT_CSRF_INVALID` | exact Origin 또는 CSRF header/cookie 검증 실패 |
| 401 | `CHAT_REFRESH_REUSED` | consumed refresh token 재사용; family/session revoke |
| 401 | `CHAT_TOKEN_INVALID` | private route JWT 검증 실패; 외부에는 일반 service auth 실패로만 노출 |
| 403 | `CHAT_USER_DISABLED` | User inactive |
| 403 | `CHAT_TENANT_DISABLED` | Tenant inactive |
| 403 | `CHAT_MEMBERSHIP_DISABLED` | active membership 없음 |
| 403 | `CHAT_EMPLOYEE_DISABLED` | employee actor의 linked Employee inactive/missing |
| 403 | `CHAT_SAFETY_BLOCKED` | executable safety policy가 content를 차단; detected value는 비노출 |
| 403 | `CHAT_QUOTA_HARD_LIMIT` | user hard stop; cache miss provider call 불가 |
| 403 | `CHAT_BUDGET_HARD_LIMIT` | tenant hard stop; 금액은 직원에게 비노출 |
| 409 | `CHAT_POLICY_ACK_REQUIRED` | employee notice acknowledgement 필요 |
| 409 | `CHAT_IDEMPOTENCY_CONFLICT` | 같은 key와 다른 binding |
| 409 | `CHAT_CONVERSATION_VERSION_CONFLICT` | stale rename/delete compare-and-swap |
| 409 | `CHAT_TURN_STATE_CONFLICT` | terminal/deleted turn 또는 cache epoch 변경으로 실행을 계속할 수 없음 |
| 409 | `CHAT_TERMINAL_REPLAY_UNAVAILABLE` | terminal facts는 있으나 성공 content를 안전하게 복구할 수 없음 |
| 409 | `CHAT_ADMISSION_EXPIRED` | admission 30초 만료/consume됨 |
| 409 | `CHAT_INVITATION_INVALID` | invitation intent가 없거나 token이 유효하지 않음 |
| 409 | `CHAT_INVITATION_EXPIRED` | invitation 만료 |
| 409 | `CHAT_INVITATION_REVOKED` | invitation 취소 또는 이미 consume됨 |
| 409 | `CHAT_INVITATION_EMAIL_MISMATCH` | 인증 email과 invitation email 불일치 |
| 409 | `CHAT_TENANT_SELECTION_REQUIRED` | active tenant 선택 필요 |
| 429 | `CHAT_RATE_LIMITED` | request/token rate 초과 |
| 429 | `CHAT_CONCURRENCY_LIMITED` | actor active admission/stream cap 초과 |
| 502 | `CHAT_PROVIDER_FAILED` | eligible provider/fallback terminal failure |
| 503 | `CHAT_RUNTIME_UNAVAILABLE` | active exact snapshot 없음/invalid/revoked |
| 503 | `CHAT_USAGE_GUARD_UNAVAILABLE` | rate/quota consistency를 안전하게 판단할 수 없음 |
| 503 | `CHAT_NO_ELIGIBLE_ROUTE` | policy에 실행 가능한 route 없음; publish validator가 선제 차단해야 함 |
| 503 | `CHAT_ENTITLEMENT_UNAVAILABLE` | Control Plane entitlement를 안전하게 확인할 수 없음 |
| 503 | `CHAT_STORAGE_UNAVAILABLE` | encrypted content store를 안전하게 사용할 수 없음 |
| 504 | `CHAT_PROVIDER_TIMEOUT` | provider hard timeout |
| 404 | `CHAT_CONVERSATION_NOT_FOUND` | foreign/deleted/missing conversation의 동일 경계 |
| 503 | `CHAT_CONTENT_KEY_UNAVAILABLE` | active/grace content key를 안전하게 사용할 수 없음 |
| 500 | `CHAT_CONTENT_INTEGRITY_FAILED` | ciphertext/tag/AAD/key binding 검증 실패; detail은 비노출 |
| SSE | `CHAT_RESPONSE_TOO_LARGE` | assistant aggregate가 Chat API 상한을 초과해 fail closed |

## 11. Dashboard와 metrics

### 11.1 Discriminator

- DB/read model: `surface=tenant_chat`, `executionScope.kind=tenant_chat`
- legacy union API는 discriminated union으로만 합친다.
- Prometheus label에는 bounded `surface="tenant_chat"`만 추가한다.
- tenantId/userId/employeeId/requestId/turnId/JTI/digest/error detail은 metric label 금지다.

### 11.2 Required aggregate

- request total과 terminal outcome counts
- active users count는 authorized DB aggregate에서만 제공하고 metric label로 만들지 않음
- cache hit/miss/off/eligible count, hit rate와 strategy
- rate/concurrency/safety blocks
- quota state `normal|warning|economy|blocked` counts
- budget state `normal|warning|economy|blocked`
- confirmed input/output/total tokens
- confirmed cost micro-USD
- pending/unconfirmed incident count 및 bounded exposure aggregate
- Provider/Model/route tier request and attempt breakdown
- fallback request/attempt/success counts
- provider attempt count와 billable attempt count
- p50/p95/p99 total/provider latency
- snapshotVersion/pricingVersion별 safe provenance
- projection freshness/lag

Paired [Dashboard schema](./schemas/dashboard-aggregate.schema.json)는 content-free aggregate만 허용한다.
메인 Dashboard 비용 추이와 legacy union reader는 additive [cost series schema](./schemas/cost-series.schema.json)를 사용하며 confirmed cost만 포함한다.

## 12. Content storage와 diagnostics

- `EncryptedChatStore`는 PostgreSQL ciphertext table + AES-256-GCM envelope encryption module이다. 별도 HashiCorp Vault service를 도입하지 않는다.
- tenant DEK와 versioned wrapping key를 사용한다. MVP wrapping backend는 local secret-file provider이며 interface 뒤에 둔다.
- managed KMS/HSM adapter는 follow-up이며 current data format을 바꾸지 않고 추가할 수 있어야 한다.
- history 기본 30일, allowed disabled/7/30/90일이다.
- Full Content Logging 기본 off, 활성 시 기본 7일 별도 encrypted retention이다.
- legal hold는 소송/감사 때문에 정상 삭제를 보류하는 기능이며 MVP에서는 지원하지 않는다. retention/hard delete가 정상 동작한다.

### 12.1 Conversation과 turn API

Chat Web BFF가 호출하는 private wire는 [Chat conversation OpenAPI](./openapi/chat-conversation.openapi.json)를 따른다. Browser가 이 route를 직접 호출하거나 tenant/user/employee scope를 body/query로 제공하지 않는다.

- conversation create/list/get/rename/delete와 message history read는 매 요청의 authoritative `(tenantId,userId)`에 binding한다.
- conversation, turn, message ID는 UUID v4 opaque ID다. foreign tenant, 다른 user, deleted row와 존재하지 않는 row는 모두 같은 `404 CHAT_CONVERSATION_NOT_FOUND`를 반환한다.
- create와 turn은 caller가 만든 bounded `idempotencyKey`를 사용한다. Chat API는 actor와 canonical request binding을 keyed MAC으로 저장하며 same key/different binding은 `409 CHAT_IDEMPOTENCY_CONFLICT`다.
- new turn row는 actor-scoped active conversation row를 `FOR UPDATE`로 잠근 같은 transaction 안에서 reserve한다. delete가 lock을 먼저 획득하면 turn row를 만들지 않는다.
- rename/delete는 conversation `version`을 compare-and-swap한다. stale mutation은 `409 CHAT_CONVERSATION_VERSION_CONFLICT`이며 title plaintext를 conflict response에 포함하지 않는다.
- list cursor는 version, actor, scope, boundary, requested limit을 MAC으로 binding한다. history cursor는 여기에 conversation과 `cacheEpoch`를 추가한다. tamper, scope 변경, epoch 불일치는 `400 CHAT_CURSOR_INVALID`다.
- history page는 최대 100개, completion context는 최근 completed message 최대 32개와 복호화 plaintext 최대 256 KiB다. request user content는 UTF-8 1~20,000자, title은 1~120자다.
- completion context의 개별 message도 private Gateway의 20,000자 한도를 따른다. 저장된 assistant가 이 한도를 넘으면 그 message와 더 오래된 history는 context에서 제외하지만 encrypted history resource 자체를 자르거나 변경하지 않는다.
- exact route와 response field는 OpenAPI, resource shape는 [conversation schema](./schemas/chat-conversation.schema.json), SSE는 [turn event schema](./schemas/chat-turn-sse-event.schema.json)를 따른다.

### 12.2 Envelope encryption과 key rotation

- 저장 format과 column은 [content DDL contract](./db/tenant-chat-content.sql)를 따른다. legacy `conversations`/`chat_messages`를 재사용하거나 dual-write하지 않는다.
- tenant content key(DEK)는 random 32-byte key이며 title/message마다 random 96-bit nonce를 사용해 AES-256-GCM으로 암호화한다. ciphertext, nonce, 128-bit tag만 content row에 저장한다.
- DEK는 versioned wrapping key로 AES-256-GCM wrapping한다. wrapping key file은 active version과 active+grace reader key를 포함하며 Chat API 외 서비스에 mount하지 않는다.
- canonical AAD는 `schemaVersion`, `tenantId`, `conversationId`, `recordId`, `contentKind=title|message`, `role=none|user|assistant`, `contentKeyVersion`을 exact key set과 JCS UTF-8로 binding한다.
- wrong tenant/AAD/key version, tag/ciphertext tamper와 record swap은 `CHAT_CONTENT_INTEGRITY_FAILED`로 fail closed한다. 원인 detail이나 key metadata를 caller/log/metric에 포함하지 않는다.
- rotation은 reader-first다. 새 wrapping key를 reader set에 배포한 뒤 active version을 올리고 DEK를 rewrap한다. DB의 monotonic `wrappingKeyRollbackFloor` 아래 active version은 readiness와 write 모두 거부한다.
- content DEK rotation은 새 version을 writer로 선택하고 이전 DEK를 grace reader로 유지한다. row의 `contentKeyVersion`이 없는 key를 가리키면 fail closed한다.
- readiness는 key file shape, active key, 모든 DB rollback floor 이상 여부를 검사한다. actual key, unwrapped DEK와 canonical plaintext를 log/fixture/metric/artifact에 남기지 않는다.

### 12.3 Turn lifecycle, SSE와 DOC-013

1. session/device와 authoritative entitlement를 확인한다.
2. conversation ownership, request binding, cursor/idempotency bound를 확인한다.
3. content-free turn identity를 reserve하고 기존 `authorizeAndAdmit`을 호출한다.
4. admission 성공 뒤 user message ciphertext를 commit한다.
5. user commit 뒤 completed prior history만 bounded decrypt하고 `complete`를 호출한다.
6. private Gateway SSE를 strict consume하며 Chat API-facing `accepted -> delta* -> final|error|cancelled` 순서를 유지한다.
7. successful assistant 전체를 한 번 암호화해 commit한 뒤에만 `chat.turn.final`을 보낸다.

- Chat API-facing event ID는 `<turnId>:<sequence>`이고 sequence는 1부터 증가한다. event/frame/assistant aggregate와 response backpressure는 bounded다. 같은 turn의 HTTP attachment는 기본 4개이며 `TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN`으로 1~16개 범위에서 제한하고, 초과 요청은 stream header 전 `429 CHAT_CONCURRENCY_LIMITED`로 거절한다.
- public turn `usageIntent`는 `requestedTier`, `maxOutputTokens`, `cacheStrategy`만 받는다. Chat API는 실제 private completion에 포함하는 bounded message content의 UTF-8 byte length 합계(최소 1)를 conservative `estimatedInputTokens`로 계산하며 caller estimate를 받거나 신뢰하지 않는다.
- attachment capacity는 admission 전에 reserve한다. admission 뒤 user persistence, history preparation 또는 local attachment activation이 실패하면 마지막 local attachment만 admission과 turn을 best effort cancel하고 reservation을 반드시 해제한다.
- 느린 attachment의 response backpressure는 해당 응답에만 적용하며 공유 Provider stream과 final persistence를 막지 않는다. disconnect된 attachment handle은 취소 시도 결과와 무관하게 local registry에서 해제한다.
- partial, interrupted, cancelled assistant와 Provider raw error는 저장하지 않는다. 이미 저장된 user message와 confirmed Gateway usage는 assistant persistence 실패 때문에 삭제·변조하지 않는다.
- duplicate final은 `(turnId,role=assistant)` unique와 locked conversation state로 no-op/replay하며 다른 content면 fail closed한다.
- successful Provider final의 assistant persistence는 content를 메모리에 보유한 동안 retryable PostgreSQL timeout/connection/transaction conflict에 최대 3회 bounded retry한다. 각 시도는 같은 turn/content를 사용하고 duplicate commit은 위 exactly-once 규칙으로 replay한다.
- DOC-013 결정: completed turn의 encrypted assistant가 있으면 Chat API가 이를 decrypt해 bounded delta로 재생한다. Gateway가 terminal facts만 replay했는데 local encrypted final이 없으면 `CHAT_TERMINAL_REPLAY_UNAVAILABLE`로 종료하며 성공 content나 빈 assistant를 만들지 않는다.
- HTTP header 전 auth/ownership/admission/user persistence 실패는 safe HTTP error다. stream 시작 뒤 실패는 safe `chat.turn.error` 또는 `chat.turn.cancelled` terminal이다.

### 12.4 Retention, delete와 cache epoch

- history retention은 server/tenant policy만 결정하며 `disabled|7|30|90`일이다. 기본은 30일이고 browser request가 바꾸지 못한다.
- delete는 conversation row를 actor-scoped lock하고 deleted tombstone/version/cache epoch를 먼저 commit한 뒤 title/message ciphertext를 synchronous hard delete한다. tombstone에는 content를 남기지 않는다.
- final persistence는 같은 conversation row의 active 상태와 captured cache epoch를 lock/check하므로 delete 뒤 late assistant가 다시 나타날 수 없다.
- active turn은 delete/caller disconnect에서 best-effort Gateway cancel하고 Chat API turn state를 terminal cancel로 만든다. billable usage 정산은 되돌리지 않는다.
- retention expiry는 마지막 성공적인 user/assistant ciphertext commit에서 server policy 기간만큼 연장된다. `disabled`는 expiry를 두지 않는다.
- retention worker는 expiry 순서의 bounded batch를 같은 hard-delete primitive로 처리하고 active in-process turn을 commit 뒤 best-effort cancel한다. tombstone/이미 삭제된 row replay는 no-op이며 destructive down이나 plaintext export rollback을 제공하지 않는다.
- retention delete는 selection 시각을 cutoff로 고정하고 conversation row lock을 얻은 뒤 `expiresAt <= cutoff`를 다시 확인한다. selection 뒤 ciphertext commit으로 expiry가 연장된 row는 삭제하지 않는다.
- history cursor와 any future cache entry는 `cacheEpoch`를 binding한다. delete epoch 이전 값은 재사용할 수 없다.

### 12.5 Admin diagnostic

MVP에서 다른 관리자의 승인은 요구하지 않는다.

필수 조건:

- active tenant admin
- tenant policy상 Full Content Logging enabled
- `chat_content_diagnostics_viewer` capability. MVP tenant_admin role에 포함한다.
- 최근 5분 내 re-auth/step-up
- allowlisted purpose 입력
- 60초 one-time decrypt grant
- append-only intent/result audit
- 단건 조회만 허용, bulk search/export 금지

후속 enterprise policy에서 `fourEyesRequired=true`일 때만 다른 admin 승인 흐름을 추가한다.

## 13. Demo 우선순위와 후속 기능

### MVP에서 구현

- Web login/invite/tenant selection
- exact cache와 cache policy UI
- three-state quota UX
- admin이 quota/policy를 수정하면 다음 snapshot부터 적용
- hard block 화면의 관리자 문의 안내
- single-admin content diagnostic + step-up/purpose/audit

### 후속 PR

- Semantic Cache live path. policy/interface/discriminator는 이미 확장 가능해야 한다.
- OAuth-only 계정에 password를 추가하는 Google re-auth + email re-proof flow
- 실제 employee quota increase request/approval workflow
- diagnostic four-eyes approval
- legal hold
- native clients 및 enterprise SSO 고도화

## 14. DB migration과 서비스 배포 순서

모든 DB 변경은 expand-first이며 destructive down migration을 하지 않는다.

1. 이 contract/schema/fixture를 merge하고 구현 feature flag는 off로 둔다.
2. auth/actor version, tenant-chat RuntimeConfig/Snapshot, admission, period, reservation, attempt, ledger, outbox, encrypted chat store, diagnostic audit table을 additive migration으로 생성한다.
3. DB role/grant를 생성한다. schema migrate만 DDL, app runtime은 최소 권한을 갖는다.
4. Control Plane reader/writer와 entitlement resolver를 배포한다. tenant-chat publish는 아직 disabled다.
5. Gateway workload-JWT verifier, private listener, ledger/outbox reader를 배포한다. public exposure와 traffic은 없다.
6. Chat API와 `EncryptedChatStore` reader/writer를 배포한다.
7. invocation projector와 Dashboard discriminated reader를 배포하고 empty-state를 검증한다.
8. Chat Web을 배포하되 tenant-chat feature flag는 off다.
9. demo tenant/User/Membership/Employee/provider credential/policy/snapshot을 idempotent seed한다.
10. private network/JWKS/readiness/migration smoke 후 tenant 단위 feature flag를 켠다.
11. admission→provider→settlement→Dashboard E2E와 legacy `/v1` regression을 통과한 뒤 demo traffic을 연다.

Rollback:

- feature flag와 new route writer를 끈다.
- 새 rows/ciphertext/key versions/ledger는 보존한다.
- old/new reader가 필요한 format을 만들었다면 reader-capable image 아래로 rollback하지 않는다.
- RuntimeSnapshot rollback은 새 monotonic version을 발행한다.

## 15. 구현 시작 gate

다음 조건을 만족하면 PR 02 이후 구현을 시작할 수 있다.

- 이 contract와 4개 paired schema/fixture가 review 가능한 상태다.
- Tenant Chat과 legacy Application Chat 경계가 PR 설명에 명시된다.
- private Gateway route가 public listener/host port에 노출되지 않는다.
- quota threshold와 billable-all-attempt settlement acceptance가 테스트에 포함된다.
- no raw content/credential/identity metric label guard가 있다.
- migration은 additive이고 legacy smoke를 건드리지 않는다.
