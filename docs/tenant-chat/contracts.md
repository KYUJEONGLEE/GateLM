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
| `employeeId` | employee entitlement와 관리자 조회를 위한 보조 식별자. 인증 principal은 아니며, user monthly quota와 별도로 Tenant Chat 직원 주간 token ledger의 key가 된다. |
| tenant admin | active User + active Tenant + active tenant_admin membership. dummy Employee row를 만들지 않는다. admin이 실제 직원이기도 하면 Employee가 연결될 수 있다. |
| signing key set | 현재 서명 key와 교체 중인 이전 key를 함께 관리하는 작은 versioned 집합. 과거 문서의 `keyring`과 같은 뜻이다. |
| workload JWT | end-user 로그인 token이 아니라 Chat API가 Gateway에 자신과 요청 결정을 증명하는 service-to-service token이다. `auth.*` browser domain이 아니다. |
| `EncryptedChatStore` | PostgreSQL ciphertext와 application-level AES-GCM envelope encryption을 사용하는 모듈. HashiCorp Vault를 도입한다는 뜻이 아니다. |

### 2.1 Entitlement 규칙

- `tenant_admin`: User, Tenant, TenantMembership이 모두 active면 Chat을 사용할 수 있다. Employee는 선택 사항이다.
- `employee`: User, Tenant, TenantMembership, linked Employee가 모두 active여야 한다.
- tenant admin도 employee와 동일하게 `(tenantId,userId,periodStart)` 개인 quota와 request/token rate를 적용받는다. Employee가 없다는 이유로 무제한이 되지 않는다.
- tenant 기본 user quota는 admin/employee에 동일하게 적용한다. 현재 RuntimeSnapshot에는 userId별 override가 없으며, 이 계약도 user override를 제공하지 않는다.
- employee actor에는 RuntimeSnapshot의 `employeeWeeklyTokenLimits`에 있는 경우에만 `(tenantId,employeeId,weekStart)` 주간 token ledger를 추가 적용한다. 목록에 없으면 제한 없음이고, `0`은 다음 새 Provider 호출을 즉시 차단한다. 활성 직원 주간 한도는 공통 `defaultMonthlyTokenLimit`보다 클 수 없으며, tenant admin처럼 employee actor가 아닌 요청에는 적용하지 않는다.
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

#### 2.2.1 로그인 ID, 비밀번호 복구와 변경

- Dashboard와 신규 Tenant Chat의 전역 `User`는 같은 credential을 사용하며 로그인 ID는 가입 또는 초대 이메일이다. 초기 테스트용 Application Chat은 이 계약과 구현 범위가 아니다.
- Tenant Chat browser는 비밀번호 복구·변경 시에도 same-origin `chat-web` BFF만 호출한다. 호출 체인은 `chat-web -> chat-api -> Control Plane private identity`를 유지한다.
- `POST /api/tenant-chat/auth/password-reset/request`는 인증 없이 사용할 수 있지만 exact Origin과 CSRF 검증을 통과해야 한다. 계정 없음, Google-only, 미인증·비활성 계정, 시간당 제한 도달 여부와 무관하게 `202 { "accepted": true }`를 반환한다.
- eligible local account의 reset token 생성은 사용자당 최근 1시간 최대 5회다. 원본 token은 DB에 저장하지 않고 hash만 저장하며 30분 후 만료된다.
- Tenant Chat에서 요청한 reset link는 `TENANT_CHAT_WEB_ORIGIN/reset-password#token=...`을 사용한다. 화면은 fragment를 읽은 즉시 주소 표시줄에서 제거한다.
- `POST /api/tenant-chat/auth/password-reset/confirm`은 일회용 token을 소비하고 비밀번호를 바꾼 뒤 같은 사용자의 다른 reset token, Dashboard session, Tenant Chat refresh token·session을 모두 폐기한다.
- `POST /api/tenant-chat/auth/password/change`는 active Chat access session에 결합된 `userId`와 현재 비밀번호를 모두 검증한다. 성공 시 모든 Dashboard·Tenant Chat session을 폐기하고 Chat auth cookie를 지우며 새 비밀번호로 다시 로그인하게 한다.
- reset과 change는 `actorAuthzVersion`을 증가시킨다. 기존 access JWT는 새 버전과 불일치하며 재사용할 수 없다.
- Tenant Chat auth session의 `user.hasLocalPassword`는 local password 설정 여부만 나타낸다. Chat Web은 `true`인 계정에만 비밀번호 변경 action을 제공한다.
- 새 비밀번호는 8자 이상 15자 이하이며 영문 대문자·소문자·숫자·ASCII 특수문자를 각각 1개 이상 포함하고 공백을 포함하지 않아야 한다. 정책 미충족 값은 `WEAK_PASSWORD`로 거부한다. 비밀번호 변경 시 현재 비밀번호와 같은 값은 `PASSWORD_UNCHANGED`로 거부한다. 기존 비밀번호 로그인에는 이 정책을 소급 적용하지 않는다.
- raw password, raw reset token, password hash, 이메일 주소는 log·metric label에 기록하지 않는다. SMTP 오류는 provider error를 포함하지 않는 고정 문구만 기록한다.

#### 2.2.2 2026-07-23 credential recovery revision

| 항목 | 내용 |
|---|---|
| 현재 의미 | Tenant Chat v1은 invite, password login, Google login, tenant selection, refresh, logout만 제공했다. |
| 변경 이유 | Dashboard와 active Tenant Chat 두 로그인 표면에서 동일한 계정 복구·비밀번호 변경 기능이 필요하다. |
| 호환성 | 기존 login route와 기존 비밀번호는 유지한다. session response에는 필수 boolean `user.hasLocalPassword`가 추가된다. |
| migration | 공통 `password_reset_tokens` table migration을 적용한다. 기존 User credential data migration은 없다. |
| acceptance | generic reset 응답, hash-only single-use token, 만료·rate limit, 현재 비밀번호 검증, actor version 증가, 전 surface session 폐기, schema·fixture 검증이 통과해야 한다. |

### 2.3 Invitation과 Google binding

- employee email link는 `TENANT_CHAT_WEB_ORIGIN`의 `/invitations/accept?token=...`을 사용한다. Project Admin invitation은 기존 Dashboard origin을 유지한다.
- Tenant Admin은 `DELETE /admin/v1/tenants/{tenantId}/employees/{employeeId}/invitations`로 pending employee invitation을 취소한다. 취소는 Employee와 project assignment를 유지하고 `invitationStatus=revoked`, `invitationRevokedAt`을 기록하며 token hash와 expiry를 제거한다. pending이 아닌 invitation은 이 endpoint로 변경하지 않는다.
- Chat Web은 entry token을 server-side 15분 invitation intent로 교환한 뒤 clean URL로 `303` redirect한다. token을 DOM, browser storage, public API response, structured log에 남기지 않는다.
- invitation resolve의 `accountState`는 `new`, `reclaimable`, `existing` 중 하나다. `new`는 email User가 없는 경우, `reclaimable`은 active User가 local 인증을 사용하면서 유효한 Employee/Admin 연결이 더 이상 없고 남은 active membership이 제거된 employee의 stale membership뿐인 경우다. 그 외에는 `existing`이다.
- `new`와 `reclaimable` account는 invitation acceptance에서 password를 만들 수 있다. `existing` account는 정상 password login 또는 Google 인증을 완료한 뒤 invitation을 bind한다. OAuth-only account와 suspended/staged Employee 연결은 `reclaimable`로 분류하지 않는다.
- acceptance transaction은 invitation row와 normalized email advisory lock을 획득하고 status/expiry/revoke/email을 재검사한 뒤 User/Membership/Employee를 atomic bind한다.
- `reclaimable` local User는 one-time invitation을 email re-proof로 사용해 `passwordHash`를 교체하고 `actorAuthzVersion`을 증가시킬 수 있다. 이때 기존 Control Plane session, Tenant Chat session, refresh token을 모두 revoke하고 stale employee membership을 제거한다. `authProvider`와 OAuth link는 변경하지 않는다.
- `existing` User의 `passwordHash`, `authProvider`, OAuth link는 invitation token만으로 변경하지 않는다.
- Google callback은 protected state와 invitation intent를 확인하고 provider email 일치, invitation status/expiry/revoke를 다시 검사한 뒤 atomic bind한다.
- 여러 active tenant가 있으면 session은 `tenant_selection_required`로 시작한다. tenant 선택 후 entitlement를 다시 확인하고 새 access JWT를 발급한다.
- linked Employee가 `archived`로 변경되면 employee-role Membership을 `removed` 처리하고 `actorAuthzVersion`을 증가시킨다. archived Employee를 다시 `active`로 복구하면 같은 employee-role Membership을 활성화하고 actor version을 다시 증가시킨다.

Version ownership:

- Control Plane은 `actorAuthzVersion`과 `tenantAuthzVersion`을 소유한다.
- User status/password/OAuth identity, Membership role/status/delete, linked Employee status/link/delete 변경은 actor version을 증가시킨다.
- Tenant status 변경은 tenant version을 증가시킨다.
- Chat API는 session별 `sessionVersion`을 소유하며 logout, device revoke, refresh reuse detection에서 증가시킨다. Control Plane의 `reclaimable` credential 교체는 `sessionVersion`을 수정하지 않고 해당 User의 session과 refresh token을 revoke한다.

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
-> Chat API가 contextMode=conversation이면 completed prior context를 bounded decrypt하고, single_turn이면 prior history를 읽지 않음
-> workload JWT(sanitization) 발급
-> private Gateway가 current user와 bounded legacy_unverified user만 pinned safety policy로 검사
-> Chat API가 passed/redacted content와 safety provenance만 encrypted store에 durable 기록
-> workload JWT(completion) 발급
-> private Gateway completion이 admission/body/snapshot binding consume
-> 저장된 message safety provenance를 검증하고 이미 처리된 history의 PII 재검사를 생략
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
- admission 성공 뒤에도 sanitization 성공 전에는 user ciphertext를 저장하지 않는다.
- sanitization이 `CHAT_SAFETY_BLOCKED`이면 Gateway가 admission을 consume하고 slot을 release하며 content-free `safety_blocked` terminal event를 exactly once 기록한다. Chat API는 user ciphertext와 Provider completion을 만들지 않는다.
- `sanitization` 성공 응답의 ordered content만 user ciphertext로 저장한다. 원래 user input을 별도 보존하거나 dual-write하지 않는다.
- exact cache hit은 request rate만 소비하고 token quota 및 cost budget debit은 0이다. executable safety가 켜진 요청은 admission에 기록된 완전한 server-owned safety summary가 명시적 `maskingAction=none`일 때만 cache-eligible이다. `redacted|blocked` 또는 summary 부재 요청은 cache lookup/write를 모두 우회하고 `cacheOutcome=off`를 기록한다. quota/budget만 변경되어 새 RuntimeSnapshot이 발행돼도 cache 호환 material이 유지되면 기존 exact cache entry를 재사용한다. 따라서 `0` 한도는 cache hit이 아닌 다음 새 Provider 호출을 즉시 차단한다.
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
| `POST` | `/internal/v1/tenant-chat/admissions/{admissionId}/sanitizations` | admission에 묶인 ordered user message를 저장 전에 한 번 safety 처리하고 masked content를 반환 |
| `POST` | `/internal/v1/tenant-chat/admissions/{admissionId}/cancel` | Chat API persistence 실패 또는 user cancel 시 admission/slot을 idempotent 종료 |
| `POST` | `/internal/v1/tenant-chat/completions` | sanitized encrypted user write 후 admission을 consume하고 provenance/cache/routing/provider pipeline 실행 |

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
- `phase=admission|sanitization|completion|cancel`
- `requestId`, `turnId`, `idempotencyKey`
- `tenantId`, `userId`, `actorKind`, optional `employeeId`
- `actorAuthzVersion`, `tenantAuthzVersion`, `sessionVersion`
- `snapshotVersion`, `snapshotDigest`
- `bindingDigest`
- sanitization/completion/cancel의 `admissionId`

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
- Web Console의 단일 authoring surface 이름은 `채팅 앱`이며 built-in Tenant Chat에만 적용한다. 과거 `회사 정책`과 `Tenant Chat` 메뉴는 이 화면으로 redirect하고 Project/Application routing 의미를 변경하지 않는다.
- `GET /admin/v1/tenants/{tenantId}/tenant-chat/runtime`은 tenant-level ACTIVE Provider 연결, 설정된 Chat 모델의 opaque `modelRef`, 가격 상태, active 5×2 routing metadata와 편집 가능한 exact cache/safety detector 및 공통 월간 token quota 설정을 반환한다. cache key set, safety digest, credential, base URL, secret reference, Provider raw error와 `publishedBy`는 반환하지 않는다.
- `PUT /admin/v1/tenants/{tenantId}/tenant-chat/runtime`의 현재 authoring wire는 `routingMode`, `manualModelRef`, 정확히 다섯 category × `simple|complex`의 `routes`, `cachePolicy`, `safetyPolicy`, `quota`를 받는다. `quota.defaultMonthlyTokenLimit`은 `0`을 포함한 정확한 hard stop이고 Control Plane은 threshold를 `80/90/100`으로 발행한다. 각 routing cell은 우선순위가 보존되는 1~4개의 `modelRefs`를 가지며 Control Plane은 모든 ref를 tenant scope, `projectId=null`, ACTIVE Provider 및 persisted `providerConfig.models`에 다시 resolve한다.

직원 주간 token quota 관리 API는 다음과 같다.

- `GET /admin/v1/tenants/{tenantId}/employees/weekly-token-quotas`
- `PATCH /admin/v1/tenants/{tenantId}/employees/{employeeId}/weekly-token-quota` with `{ enabled, limitTokens, expectedVersion? }`

이 정책은 `(tenantId, employeeId)` 원본·감사 레코드와 `(tenantId, employeeId, mondayStart)` 주간 원장을 함께 갱신하고, 같은 transaction에서 새 RuntimeSnapshot을 발행한다. 정책을 낮춰도 이번 주 누적 사용량은 초기화하지 않는다. 활성 직원의 `limitTokens`는 현재 공통 `defaultMonthlyTokenLimit`을 초과할 수 없고, 공통 월간 한도를 낮출 때에도 기존 활성 직원 한도가 더 크면 발행을 거부한다.
- `cachePolicy`는 exact cache의 enabled, positive integer TTL, positive integer per-user entry limit만 편집한다. `safetyPolicy.detectorSet`은 1~10개의 unique detector와 `allow|redact|block` action을 받으며 주민등록번호/API key/Authorization header/JWT/private key detector는 모두 포함되어야 하고 `allow`를 거부한다. 이 관리자 wire는 raw prompt, raw response, raw detected value 또는 secret 원문을 받거나 반환하지 않는다.
- compatibility client는 `cachePolicy` 대신 boolean `cacheEnabled`만 보낼 수 있다. 이 경우 기존 TTL, 사용자별 엔트리 상한과 key-set ID를 보존하고 `exact/enabled` 또는 `off/disabled`만 전환한다. cache 입력을 모두 생략하면 기존 snapshot 정책을 보존하며 최초 활성화에서만 TTL 300초, 사용자당 100개와 operator-configured key-set ID의 Exact Cache를 기본 활성화한다. key-set ID는 관리자 응답에 노출하지 않는다.
- `routingMode=manual`은 `manualModelRef` 하나를 사용하지만 5×2 matrix를 삭제하지 않는다. `routingMode=auto`는 안전 처리된 메시지에서 기존 deterministic rule classifier로 category를 계산한다. Model-path difficulty는 활성화된 경우 일반 Gateway와 동일한 process-global 106D runtime을 사용하며 `ready` 결과가 `simple|complex` cell 선택에 권위를 가진다. Runtime 비활성화·초기화 실패·queue 포화·timeout·invalid result·inference 실패·panic과 non-model-path에서는 기존 rule difficulty를 요청 단위로 유지한다. manual 경로는 semantic runtime을 호출하지 않으며 offline shadow Routing AI service는 이 active 경로에 포함하지 않는다. 선택된 `simple|complex`는 content-free `routingDifficulty`로 usage reservation과 terminal projection에 보존하며 route tier나 provider/model에서 역추론하지 않는다.
- compatibility 기간 동안 Control Plane은 과거 `providerConnectionId`+`modelKey` PUT을 동일 ref로 채운 manual 5×2 policy로 변환해 받을 수 있다. 이 legacy shape는 새 authoring wire가 아니며 RuntimeSnapshot의 명시적 Routing v2 bridge를 우회하지 않는다.
- Provider family는 persisted `providerConfig.providerFamily`에서만 판정한다. client 입력이나 base URL 추론으로 가격을 선택하지 않는다.
- 가격은 현재 유효한 shared `model_pricing_rules`를 먼저 사용하고, Tenant Chat bundled catalog를 fallback으로 사용한다. 둘 다 없거나 안전한 정수 micro-USD 단가로 표현할 수 없으면 모델을 비활성화하지 않고 `pricingStatus=unavailable`, `pricingSource=unavailable`, monetary rate 0으로 pin한다.
- 가격 미확인 모델은 Provider 호출과 token quota 적용이 가능하다. 이 상태의 monetary reservation/confirmed cost는 0으로 계산하되 UI/snapshot에 `unavailable`을 유지하며 known price처럼 표시하지 않는다. 이미 hard-block 상태인 tenant budget을 우회하지 않는다.
- `modelKey`는 1~200자의 `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$`를 사용한다. Provider/model catalog의 점, 슬래시와 콜론을 지원하지만 whitespace와 control 문자는 허용하지 않는다.
- RuntimeSnapshot은 기존 concrete `policies.routing.routes[]`와 pricing provenance를 유지하면서 `policies.routing.policy`에 `gatelm.routing-policy.v2`, mode, bootstrap state, canonical hex policy hash와 5×2 matrix를 명시한다. concrete route에는 opaque `modelRef`를 포함하며 난이도와 `standard|economy` tier를 암묵 변환하지 않는다.
- 최초 활성화는 계약에 고정된 safe default 비라우팅 policy를 조합한다. 재구성은 active snapshot의 rate/concurrency/quota/budget/streaming 및 employee notice version을 보존하고 routing/fallback/provider token rate/pricing과 요청에 명시된 cache/safety 설정만 새 값으로 교체한다. 호환 요청에서 cache/safety를 생략하면 기존 값을 보존한다.
- 동일 runtime policy와 가격의 PUT은 active snapshot을 그대로 반환한다. 변경이 있으면 snapshot, policy, pricing version을 serializable transaction 안에서 각각 monotonic하게 증가시킨다.

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
- exact cache는 tenant+user scoped, encrypted이며 실제 private completion에 전달된 message 배열을 fingerprint한다. fingerprint는 cache policy, 전체 safety policy, 고정된 routing decision/modelRef, usage intent와 sanitized input을 포함하고 quota/budget·가격·rate/concurrency의 usage-only 정책은 포함하지 않는다. `contextMode=single_turn`은 current user message만 fingerprint하므로 context 유지 여부와 cache hit을 독립적으로 검증할 수 있다. 다만 sanitized input에 실제 마스킹이 관측된 요청은 fingerprint를 만들거나 기존 entry를 조회하지 않는다.
- exact cache outer key는 tenant+user namespace만 포함하고 keyed fingerprint는 Redis hash field로만 사용한다. value는 AES-256-GCM으로 암호화하며 명시적 `maskingAction=none`인 confirmed primary 성공만 저장한다. 과거에 저장된 redacted entry는 새 실행 경로에서 읽지 않고 기존 TTL 만료에 맡기며 별도 content inspection이나 일괄 삭제를 수행하지 않는다.
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
| `economy` | “예산/할당량 경고” | Routing v2의 category/difficulty 선택은 변경하지 않음 |
| `blocked` | “관리자에게 한도 문의” | cache hit 외 새 provider call 차단 |

MVP UI는 위 상태만 보여주고 세부 threshold 편집은 admin advanced section에 둔다. 직원용 in-product 증액 승인 workflow는 후속 PR이며 MVP는 관리자 문의 안내와 admin quota 편집으로 끝낸다.

### 8.2 기본 threshold

| Scope | Warning | Economy | Hard stop |
|---|---:|---:|---:|
| user monthly confirmed tokens | allocation의 80% | allocation의 90% | allocation의 100% |
| employee weekly tokens | 적용 시 별도 warning/economy 단계 없음 | 적용 시 별도 warning/economy 단계 없음 | 주간 `limitTokens` 100%; `0`은 즉시 차단 |
| tenant monthly confirmed cost | budget의 80% | budget의 90% | budget의 100% |

- tenant admin은 absolute limits와 threshold를 설정할 수 있다.
- publish validator는 `0 < warning < economy < hardStop`을 요구한다. Routing v2에는 tier 기반 economy route를 요구하지 않는다.
- user period는 tenant-configured IANA timezone 기준 월이며 변경은 다음 period부터 적용한다.
- tenant cost는 MVP에서 USD micro-unit과 pinned pricing version을 사용한다.

### 8.3 Reservation과 settlement

1. exact cache miss에서 user token, 적용된 employee weekly token, tenant cost의 current confirmed+reserved 상태를 확인한다.
2. selected route의 bounded input estimate + max output 및 pinned 가격으로 conservative reservation을 한 transaction에서 만든다. `pricingStatus=unavailable`이면 token reservation은 유지하고 monetary reservation만 0이다.
3. hard stop 또는 적용된 employee weekly token limit을 넘으면 reservation 없이 차단한다.
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
| `TenantChatEmployeeWeeklyTokenPeriod` | `(tenantId,employeeId,periodStart)` | RuntimeSnapshot에 명시된 employee actor의 confirmed/reserved/unconfirmed weekly token balance |
| `TenantChatTenantCostPeriod` | `(tenantId,periodStart,currency)` | confirmed/reserved tenant cost balance |
| `TenantChatUsageReservation` | `requestId` and `(tenantId,userId,idempotencyKey)` | request reserve/top-up/settle state machine and immutable `off|miss` cache provenance |
| `TenantChatProviderAttempt` | `(requestId,attemptNo)` | primary/fallback billable attempt |
| `TenantChatUsageLedgerEntry` | `(requestId,ledgerVersion)` | append-only reservation/settlement delta |
| `TenantChatInvocationOutbox` | `(aggregateId,eventType,eventVersion)` | atomic projection handoff |
| `TenantChatInvocationLog` | `requestId` | Request Detail/Dashboard physical read model |

정확한 column/type/PK/FK/nullability/check/index는 [usage DDL contract](./db/tenant-chat-usage.sql)를 따른다. 이 DDL은 아직 적용된 migration이 아니며 Gateway 구현 PR이 동일 의미의 additive Prisma/SQL migration으로 옮긴다.

Correctness source는 period/reservation/ledger transaction이다. `TenantChatInvocationLog`와 Dashboard projector는 재생 가능한 read model이며 projection lag가 quota 판단을 바꾸지 않는다. 기존 `p0_llm_invocation_logs`에 tenant-chat sentinel Project/Application을 넣지 않는다.

### 9.2 Event

최신 terminal usage v3와 content-free terminal v2 event에는 선택적 `ttftMs`를 추가한다. 값은 private completion 시작부터 browser 전달에 성공한 첫 non-empty `tenant_chat.delta`까지 한 번만 측정한다. fallback은 최초 시작점을 유지하고 exact cache hit은 `0`을 기록한다. delta 없이 끝난 요청과 이전 event는 필드를 보내지 않으며 invocation log/API에서는 `null`과 `—`로 표현한다. replay/attach가 별도 TTFT event를 만들지 않고, `latencyMs`와 총 처리 시간의 기존 의미도 유지한다.

Ledger transition outbox의 최신 writer는 paired [usage settlement schema v3](./schemas/usage-settlement-event-v3.schema.json)를 따르고 reservation에 고정된 필수 `cacheOutcome=off|miss`를 모든 transition에 전달한다. Exact Cache hit는 usage reservation을 만들지 않으므로 [content-free terminal event schema](./schemas/invocation-terminal-event.schema.json)의 `cacheOutcome=hit`을 사용한다. projector는 v1/v2를 계속 읽으며 해당 필드가 없으면 backfill된 reservation provenance를 사용한다.

Analytics policy-impact projection is additive to that ledger contract. `TenantChatInvocationLog` persists nullable `routingDifficulty=simple|complex`, legacy-compatible `effectiveRouteTier=high_quality|standard|economy`, non-negative `savedCostMicroUsd`, and bounded safety summary fields. Policy-impact routing uses only `routingDifficulty`; the legacy tier is not converted into difficulty. Exact-cache payload v2 carries encrypted source provider/model/tier and source confirmed cost; a cache-hit v2 terminal event may project those bounded values without content. Its `effectiveModelKey` follows the same bounded model-key character contract as usage settlement, including `.`, `_`, `:`, `/`, and `-`; it is not an opaque identifier. Historical routing difficulty remains `NULL` unless the original classification was persisted, historical cache hits with no source-cost evidence remain `NULL`, and historical masking is never reconstructed from content. Tenant-wide Analytics may combine the resulting aggregate with Project/Application data, while any project-scoped query excludes Tenant Chat.

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
| 403 | `CHAT_EMPLOYEE_WEEKLY_TOKEN_QUOTA_HARD_LIMIT` | employee 주간 token limit 도달; 안전한 관리자 문의 메시지를 반환 |
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
- AI safety sidecar metric은 원문, 탐지값, span/offset, 모델 경로·버전, URL, 오류 문자열을 포함하지 않는다. 허용 label은 아래 bounded enum만 사용하고 그 밖의 입력은 `unknown` 또는 `invalid_response`로 정규화한다.

| Metric | Bounded labels | Meaning |
|---|---|---|
| `gatelm_ai_safety_sidecar_calls_total` | `surface=gateway_v1|tenant_chat|unknown`, `mode=shadow|enforce|unknown`, `outcome=passed|redacted|blocked|timeout|transport_error|http_error|invalid_response|cancelled`, `inference_path=rules_only|hybrid|unknown` | sidecar 호출의 terminal aggregate |
| `gatelm_ai_safety_sidecar_call_duration_seconds` | calls와 동일 | sidecar 호출 wall-clock duration; Gateway 전체 요청 지연이 아님 |
| `gatelm_ai_safety_sidecar_fallback_total` | `surface`, `mode`, `reason=timeout|transport_error|http_error|invalid_response` | 실제 local-rule fallback이 실행된 횟수 |
| `gatelm_gateway_dependency_ready` | `dependency=postgres|postgres_log|redis|mock_provider|control_plane|ai_safety_sidecar|unknown`, `required=true|false` | `/readyz`가 마지막으로 관측한 dependency 상태(1/0) |

`inference_path=hybrid`는 sidecar가 안전한 실행 요약으로 모델 호출을 명시한 경우에만 사용한다. 응답이 그 증거를 제공하지 않으면 `unknown`이며 detection source나 응답 지연으로 추정하지 않는다. readiness gauge는 능동 probe가 아니라 `/readyz` poll 시점의 마지막 관측값이다.

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
- content-free safety summary가 관측된 요청의 masking action `none|redacted|blocked`, detector type별 요청 수, redacted/blocked 보호 처리량

Gateway는 sanitization 직후 admission에 `maskingAction`, 정규화·중복 제거된 `maskingDetectedTypes`, 총 `maskingDetectedCount`, pinned `safetyPolicyDigest`를 원문·탐지값·span 없이 기록한다. 네 field는 terminal event와 `TenantChatInvocationLog`에서 함께 존재하거나 모두 없어야 한다. 기존 event/log에 이 묶음이 없으면 `passed`로 추정하지 않고 security coverage를 `partial` 또는 `unavailable`로 표시한다. `terminalOutcome=safety_blocked`는 과거 호환 집계에서 blocked로 셀 수 있지만 detector type을 임의 생성하지 않는다.

배포는 reader-first로 수행한다. Control Plane migration과 additive event reader/projector를 먼저 배포하고, 다음으로 Gateway writer를 활성화한 뒤, 마지막으로 Dashboard/Web consumer를 노출한다. 이 순서를 지키는 동안 legacy event는 계속 projection되며 safety summary가 없는 구간만 coverage로 명시한다.

Projection freshness는 마지막 invocation의 경과 시간이 아니라 미처리 outbox 유무를 뜻한다. 미처리 outbox가 없으면 tenant가 유휴 상태여도 `fresh`이며, `lagSeconds`는 마지막 projected invocation의 경과 시간을 관측용으로만 전달한다. 미처리 outbox가 있으면 `partial`로 표시한다.

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
- 새 user message는 admission 뒤 `sanitization` phase에서 한 번만 검사한다. Chat API는 Gateway가 반환한 ordered content를 `safety.status=sanitized`와 exact `policyDigest`로 저장하며 이후 completion에는 그 ciphertext 복호화 결과만 사용한다.
- safety policy가 비활성화됐거나 detector/masking runtime이 준비되지 않으면 sanitization은 fail closed한다. 원문을 그대로 반환해 `sanitized`로 저장하는 우회 동작은 허용하지 않는다.
- assistant message는 이미 sanitized user context로 Provider가 생성한 provenance를 `safety.status=provider_generated`로 저장한다. 이것은 output DLP 검사를 통과했다는 뜻이 아니며 `policyDigest`를 갖지 않는다.
- completion message의 optional `safety` object는 additive wire compatibility를 위한 것이다. Chat API는 schema v2 AAD로 인증된 provenance만 이 field에 싣고 workload JWT의 `bindingDigest`로 exact completion input을 서명한다. Tenant Chat stored history에서 이 field가 없거나 user status/digest와 role 조합이 맞지 않으면 provider-bound context에서 제외하거나 fail closed하며, Gateway도 이를 trusted history로 보지 않고 방어적으로 safety 처리한다.
- placeholder counter는 `[EMAIL_2]`의 `EMAIL`처럼 실제 masked text에 쓰는 uppercase placeholder prefix별 이미 사용한 최대 숫자 suffix만 전달할 수 있다. detector type, raw entity, raw-to-placeholder mapping, message/conversation identifier는 포함하지 않는다.
- exact route와 response field는 OpenAPI, resource shape는 [conversation schema](./schemas/chat-conversation.schema.json), SSE는 [turn event schema](./schemas/chat-turn-sse-event.schema.json)를 따른다.

### 12.2 Envelope encryption과 key rotation

- 저장 format과 column은 [content DDL contract](./db/tenant-chat-content.sql)를 따른다. legacy `conversations`/`chat_messages`를 재사용하거나 dual-write하지 않는다.
- tenant content key(DEK)는 random 32-byte key이며 title/message마다 random 96-bit nonce를 사용해 AES-256-GCM으로 암호화한다. ciphertext, nonce, 128-bit tag만 content row에 저장한다.
- DEK는 versioned wrapping key로 AES-256-GCM wrapping한다. Chat API combined key file은 active version과 active+grace `wrappingKey`/`integrityKey`를 포함한다. Control Plane API에는 combined file을 mount하지 않고 동일 wrapping material/version만 가진 `RAG_CONTENT_WRAPPING_KEYS_FILE` exact projection을 별도 전달하며 `integrityKey`는 포함하거나 허용하지 않는다.
- title, legacy message와 assistant citation의 schema v1 canonical AAD는 `schemaVersion`, `tenantId`, `conversationId`, `recordId`, `contentKind=title|message|message_citations`, `role=none|user|assistant`, `contentKeyVersion`을 exact key set과 JCS UTF-8로 binding한다. `message_citations`는 assistant role에만 허용한다.
- 새 message write는 schema v2만 사용한다. v2 message canonical AAD는 v1 message exact set에 `safetyStatus`, `safetyPolicyDigest`를 추가한다. user는 `safetyStatus=sanitized`와 valid policy digest가 필수이고 assistant는 `safetyStatus=provider_generated`, `safetyPolicyDigest=null`이 필수다. DB metadata만 바꿔 legacy plaintext를 sanitized로 승격할 수 없도록 AES-GCM tag가 provenance를 인증한다.
- 기존 schema v1 user message는 `legacy_unverified` reader-only 상태이고, 기존 schema v1 assistant는 `provider_generated`로 표시한다. legacy user를 복호화해 현재 pinned sanitization을 한 번 통과시키고 schema v2로 재암호화하기 전에는 completion context에서 안전한 history로 사용하지 않는다. 일괄 `sanitized` backfill이나 metadata-only 승격은 금지한다.
- wrong tenant/AAD/key version, tag/ciphertext tamper와 record swap은 `CHAT_CONTENT_INTEGRITY_FAILED`로 fail closed한다. 원인 detail이나 key metadata를 caller/log/metric에 포함하지 않는다.
- rotation은 reader-first다. 새 wrapping key를 reader set에 배포한 뒤 active version을 올리고 DEK를 rewrap한다. DB의 monotonic `wrappingKeyRollbackFloor` 아래 active version은 readiness와 write 모두 거부한다.
- content DEK rotation은 새 version을 writer로 선택하고 이전 DEK를 grace reader로 유지한다. row의 `contentKeyVersion`이 없는 key를 가리키면 fail closed한다.
- readiness는 key file shape, active key, 모든 DB rollback floor 이상 여부와 non-retired wrapping key version별 대표 persisted DEK 하나가 실제 unwrap되는지를 검사한다. version 번호만 일치하고 key material이 바뀐 경우도 fail closed한다. key set은 최대 8개이므로 readiness crypto 검증도 최대 8개로 제한한다. 개별 row integrity는 실제 read path에서 계속 fail closed한다. actual key, unwrapped DEK와 canonical plaintext를 log/fixture/metric/artifact에 남기지 않는다.

#### 12.2.1 RAG crypto와 고정 profile 경계

Tenant Chat RAG의 공용 crypto/config 기반은 route, upload, extraction, embedding 호출, retrieval을 활성화하지 않는 호환성 계층이다.

- `packages/tenant-content-crypto`는 framework-neutral AES-256-GCM, JCS, key wrapping, versioned keyset parser, Chat/RAG AAD builder와 `TenantKeyResolver` 계약만 소유한다. Nest, Prisma, 환경 로딩, tenant authorization과 secret file I/O는 포함하지 않는다.
- 기존 title/message는 32-byte tenant DEK, 매 record마다 새 random 96-bit nonce, 128-bit tag와 기존 Chat AAD byte 형식을 그대로 사용한다. package 추출은 기존 row를 재암호화하거나 AAD field, title `recordId=conversationId`, error code를 바꾸지 않는다.
- RAG chunk plaintext는 저장 전에 같은 primitive로 암호화한다. `RagChunkAadV1`의 exact key set은 `schemaVersion=1`, `tenantId`, `knowledgeBaseId`, `documentId`, `documentIndexId`, `chunkId`, `contentKind=rag_chunk`, `contentKeyVersion`이다. 값은 server-owned DB/job state에서만 온다.
- RAG private document metadata용 별도 AAD의 exact key set은 `schemaVersion=1`, `tenantId`, `knowledgeBaseId`, `documentId`, `contentKind=rag_document_private_metadata`, `contentKeyVersion`이다. 이 compatibility milestone은 metadata나 chunk 저장 경로를 만들지 않는다.
- crypto/key 조회 실패는 fail closed한다. plaintext 저장 fallback, raw chunk가 포함된 error, key material log는 허용하지 않는다.

RAG의 process-wide kill switch는 `TENANT_CHAT_RAG_ENABLED`이며 기본값은 `false`다. tenant-level enablement는 기존 `RagKnowledgeBase.status=ENABLED`만 사용한다. 두 조건이 모두 참일 때만 향후 Tenant Chat RAG route가 유효하며, global flag만으로 public Gateway/Application Chat이나 아직 구현되지 않은 RAG route가 열리지 않는다.

고정 runtime profile은 다음 환경 계약을 사용한다.

```text
RAG_EMBEDDING_PROVIDER=openai
RAG_EMBEDDING_MODEL=text-embedding-3-large
RAG_EMBEDDING_DIMENSIONS=1536
RAG_EMBEDDING_PROFILE_VERSION=1
RAG_DISTANCE_METRIC=cosine
```

- 각 값은 미지정 시 위 고정값을 사용한다. 명시적으로 빈 값, 다른 provider/model/dimension/profile version/distance는 service listen 전에 거부한다.
- Chat API와 Control Plane은 global flag 값과 무관하게 listen 전에 mismatch existence query로 `RagKnowledgeBase` profile을 고정 runtime profile과 비교한다. 하나라도 다르면 identifier나 row detail 없이 startup을 실패시킨다.
- 이 startup guard는 M2 migration이 먼저 배포됐다는 expand-first 순서를 전제로 한다. global flag가 `false`이면 profile 정합성만 확인하고 RAG 실행은 계속 허용하지 않는다.
- dedicated worker process와 worker-only secret delivery는 M6에서 아래 ingestion contract로 확정한다. HTTP Control Plane process는 parsing, extraction, embedding을 실행하지 않는다.

#### 12.2.2 Private RAG embedding 계약

Gateway의 `POST /internal/v1/rag/embeddings`는 private `:8081` listener에만 등록한다. public OpenAI-compatible `/v1`, 기존 Application Chat, public Gateway router에는 route, alias, discovery 항목을 만들지 않는다.

- request body의 exact shape는 paired [RAG embedding request schema](./schemas/rag-embedding-request.schema.json)다. `purpose`, `profileVersion=1`, ordered `inputs`만 받으며 `tenantId`, `knowledgeBaseId`, provider, model, dimensions, credential, base URL, cache control은 unknown-field rejection으로 거부한다.
- `tenantId`, `requestId`, `operationId`와 caller identity는 [RAG workload JWT schema](./schemas/rag-embedding-workload-jwt-claims.schema.json)를 검증한 결과에서만 가져온다. body/header의 별도 tenant field를 신뢰하지 않는다.
- RAG workload JWT는 기존 Chat workload key를 Worker에 공유하지 않는다. 서명 `kid`는 issuer, subject, allowed purposes에 원자적으로 결합되고 Chat API는 `RAG_QUERY`, Control Plane Worker는 `RAG_INGESTION`만 허용한다.
- exact ordered request body 전체의 JCS SHA-256을 tenant/request/operation/purpose/profile과 HMAC binding한다. 변경된 input, input order, purpose 또는 profile은 Provider 호출 전에 거부하고 JTI는 전체 검증 후 한 번만 consume한다.
- Gateway가 선택하는 provider/model/dimensions는 각각 `openai`, `text-embedding-3-large`, `1536`이다. OpenAI 요청에 `dimensions=1536`을 명시하며 response의 index/count, vector 1536차원, finite number, model과 bounded usage를 검증한다.
- endpoint는 1~128 inputs, input별 conservative token upper bound 8,192, batch upper bound 300,000과 bounded request/response bytes를 적용한다. 이 upper bound는 tokenizer dependency를 추가하지 않고 UTF-8 bytes를 token count의 보수적 상한으로 취급하며, 실제 provider token usage는 response metadata로만 반환한다.
- Provider attempt에는 timeout을 적용한다. timeout, HTTP 408/429/5xx와 retryable transport failure만 최대 3회 bounded retry하고, credential/authorization/other permanent 4xx, malformed response, caller cancellation은 재시도하지 않는다.
- `DEPLOYMENT_MODE=local|test`로 명시한 환경만 `httptest` 또는 custom OpenAI-compatible base URL을 허용한다. 환경 분류가 비어 있거나 staging/production/self-host release이면 feature flag가 꺼져 있어도 `https://api.openai.com/v1`만 허용하고 다른 host/path, HTTP, loopback endpoint를 startup에서 거부한다.
- response는 input order와 같은 embedding 배열, fixed profile, request ID, request purpose, `inputCount`, provider-reported prompt/total tokens만 반환한다. tenant ID, credential, Provider raw body, operation ID, input, object key, DB ID는 반환하지 않는다.
- 이 usage metadata는 M6/M7 caller가 tenant-scoped idempotent `RagEmbeddingUsage`를 기록하기 위한 근거다. Gateway는 기존 employee/tenant chat budget ledger를 차감하거나 DB usage row를 만들지 않는다.
- embedding path에는 response cache나 Semantic Cache read/write가 없다. RAG chat은 query embedding과 현재 tenant retrieval을 먼저 완료한 뒤 기존 `UsageIntent.cacheStrategy=off|exact`와 Runtime Snapshot 정책에 따라 사용자별 Exact Response Cache만 사용할 수 있다. 별도 client-controlled `cacheMode` 또는 `semanticCache` field를 추가하지 않는다.
- input, vector, raw query/chunk, API key와 Provider raw error body는 log, metric, DB, cache에 남기지 않는다. 기본 test suite는 fake/`httptest`만 사용하며 OpenAI를 호출하지 않는다.

#### 12.2.3 Tenant Admin RAG enablement 및 문서 upload/read/delete 계약

Control Plane의 Tenant Admin wire는 [Admin RAG OpenAPI](./openapi/admin-rag.openapi.json)를 따른다. 이 revision의 active surface는 tenant enablement, upload, 목록, 단건 상태 조회, 비동기 hard delete다.

- `GET /admin/v1/tenants/{tenantId}/rag/knowledge-base`는 row를 만들지 않는 read다. tenant Knowledge Base가 아직 없으면 `tenantEnabled=false`를 반환한다. `PATCH` body는 additional property 없는 exact `{enabled:boolean}`이고, 같은 값의 반복은 idempotent하다. response는 safe boolean인 `tenantEnabled`, process configuration을 반영한 read-only `globalEnabled`, 둘의 AND인 `effectiveEnabled`만 반환하며 Knowledge Base ID, profile row, revision은 노출하지 않는다.
- `PATCH`는 tenant singleton Knowledge Base가 없으면 고정 embedding profile과 요청 status로 생성하고, 있으면 `status=ENABLED|DISABLED`만 갱신한다. document, index, chunk, job, revision과 encrypted citation snapshot은 변경하거나 삭제하지 않는다. 다시 활성화하면 기존 `READY` document와 `ACTIVE` index를 재수집 없이 사용한다.
- tenant `DISABLED`여도 관리자 upload와 worker ingestion은 허용되어 문서를 `READY`로 준비할 수 있다. 이 준비 흐름은 RAG infrastructure가 배포되어 process-wide flag가 켜진 환경을 전제로 한다. process-wide flag가 꺼진 운영 kill-switch 상태에서는 Control Plane의 현재 fail-closed storage/worker 구성이 우선한다.
- employee retrieval과 새 RAG turn은 `TENANT_CHAT_RAG_ENABLED=true`와 tenant `status=ENABLED`를 모두 매 요청 확인한다. disable commit 이후 시작하는 create/retrieval은 embedding 및 provider 호출 전에 `CHAT_RAG_DISABLED`로 실패하고 일반 chat으로 자동 fallback하지 않는다. 이미 provider streaming이 시작된 in-flight turn의 distributed cancellation은 이 계약 범위가 아니다.
- `TENANT_CHAT_RAG_ENABLED`는 process-local 환경값이므로 Control Plane의 `globalEnabled` 표시와 Chat API의 실제 집행값은 배포 단위에서 반드시 같아야 한다. 지원하는 self-host/AWS Compose RAG overlay는 Control Plane, Gateway, AI Service, worker, Chat API 모두에 동일한 enabled 값을 주입하며 wiring test가 이 parity를 검증한다. 별도 orchestrator는 같은 불변식을 보장해야 하고, 값을 독립적으로 변경하는 배포는 지원하지 않는다. 실제 retrieval은 표시값을 신뢰하지 않고 Chat API 자신의 global flag와 DB의 tenant status를 다시 확인해 fail-closed한다.
- enablement route도 기존 `AdminAuthGuard`, full admin session과 route tenant만 신뢰한다. 일반 직원, 다른 tenant 관리자, body/query의 `tenantId`·`knowledgeBaseId` override는 controller 실행 또는 validation에서 거부한다. DB 장애는 내부 detail 없이 `503 RAG_KNOWLEDGE_BASE_UNAVAILABLE`이다.

- `POST /admin/v1/tenants/{tenantId}/rag/documents`, `GET /admin/v1/tenants/{tenantId}/rag/documents`, `GET /admin/v1/tenants/{tenantId}/rag/documents/{documentId}`는 기존 `AdminAuthGuard`와 full admin session을 사용한다. route의 tenant scope와 `CurrentAdminUserId`만 신뢰하며 body/query의 `tenantId`, `knowledgeBaseId`, uploader ID는 unknown-field validation으로 거부한다. 일반 직원 session과 다른 tenant의 Tenant Admin은 controller 실행 전에 거부한다.
- upload body는 `multipart/form-data`의 단일 `file`과 optional `displayName`만 받는다. `RAG_MAX_UPLOAD_BYTES` 기본값과 상한은 모두 `20 * 1024 * 1024` bytes이고 환경은 1 byte 이상 이 상한 이하로만 낮출 수 있다. 빈 파일은 거부한다.
- `.txt`는 declared `text/plain`, 유효한 UTF-8과 NUL 부재를 확인하고, `.pdf`는 declared `application/pdf`와 leading `%PDF-` signature를 확인한다. extension, declared MIME, 최소 signature/content 검사가 일치하지 않으면 `400 RAG_DOCUMENT_INVALID_UPLOAD`이다. PDF page 수와 text layer 유효성은 upload 성공을 판정하는 근거가 아니다.
- raw multipart filename은 basename으로 축약하기 전에 path separator, traversal segment, NUL/control character와 길이를 검증한다. original filename과 display name은 NFC normalization과 bounded validation 뒤 tenant document-private-metadata AES-256-GCM payload에만 저장한다. client `displayName`이 없으면 검증된 normalized original filename을 사용한다. extension, MIME, byte size만 허용된 평문 metadata다.
- API는 전체 파일을 하나의 `Buffer`나 plaintext 임시 파일로 만들지 않는다. 입력 stream을 bounded validation 및 SHA-256 계산과 함께 object store로 전달한다. file limit 외에도 bounded multipart overhead, declared/actual total request byte limit과 idle deadline을 적용하며 invalid/aborted multipart upload는 시작된 provider operation의 성공 응답이 유실된 경우까지 UUID key를 best-effort 삭제한다.
- object key는 server-generated internal document UUID로 만든 `rag/{tenantUuid}/{documentUuid}/source` 형태이고 filename, tenant name, display name을 포함하지 않는다. staging/production adapter는 environment-private bucket, SSE-KMS와 ECS/IRSA/EC2 IAM role source만 사용한다. SDK default credential chain을 사용하지 않아 static env key뿐 아니라 shared credentials/profile/credential process도 선택하지 않으며 public ACL, fake/local endpoint를 startup에서 거부한다.
- 관리자/tenant 확인 뒤 tenant Knowledge Base를 먼저 조회하거나 생성한다. S3 성공 전에는 `RagDocument`나 `RagJob`을 만들지 않는다. object가 durable해진 뒤 한 database transaction에서 해당 Knowledge Base row를 잠그고 tenant document count와 duplicate를 재검증하며, encrypted metadata를 포함한 `RagDocument(status=UPLOADED)`와 정확히 한 `RagJob(type=INGEST,status=PENDING)`을 함께 생성한다. 둘 중 하나만 commit되는 상태는 허용하지 않는다. S3 실패 뒤 빈 Knowledge Base가 남는 것은 허용하지만 Document와 Job은 남기지 않는다.
- S3 실패는 Document/Job을 만들지 않고 `503 RAG_STORAGE_UNAVAILABLE`이다. S3 성공 뒤 database transaction이 실패하거나 duplicate/limit 검사가 거부하면 업로드 object를 best effort 삭제한다. transaction COMMIT 결과가 불명확하면 같은 predetermined IDs로 Knowledge Base lock 아래 idempotent finalization을 재실행하여 committed row를 확인하거나 안전하게 완성하고, 결과를 직렬화해 확인할 수 없으면 object를 보존해 reconciliation 대상으로 남긴다. 보상 삭제 실패는 server-generated opaque operation UUID와 stable code만 구조화해 기록하고 filename, display name, digest, bucket, object key, KMS key, raw SDK error를 log/metric에 남기지 않는다.
- duplicate 판단은 동일 tenant 안의 같은 SHA-256 digest를 가진 `READY` 또는 비종료 처리 상태(`UPLOADING`, `UPLOADED`, `EXTRACTING`, `CHUNKING`, `EMBEDDING`, `INDEXING`)만 대상으로 한다. digest는 encrypted private metadata에서만 비교하며 다른 tenant를 조회하거나 deduplicate하지 않는다. duplicate conflict는 `409 RAG_DOCUMENT_DUPLICATE`만 반환하고 기존 document ID나 digest를 공개하지 않는다. DELETING을 포함해 tenant에 이미 500개 Document row가 있으면 `409 RAG_DOCUMENT_LIMIT_REACHED`이다.
- upload 성공은 `202`이며 response의 status는 `UPLOADED`, failure fields는 `null`이다. list는 `limit=1..100`(default 50)과 이전 page의 safe `documentId` UUID cursor를 사용하고 `createdAt DESC, documentId DESC`로 안정 정렬한다. cursor가 다른 tenant이거나 존재하지 않으면 `400 RAG_DOCUMENT_CURSOR_INVALID`이다.
- 외부 `documentId`는 `RagDocument.publicId` UUID만 사용한다. 단건 조회는 `(tenantId,publicId)`로 제한하고 다른 tenant와 미존재를 동일한 `404 RAG_DOCUMENT_NOT_FOUND`로 처리한다.
- `DELETE /admin/v1/tenants/{tenantId}/rag/documents/{documentId}`도 같은 `AdminAuthGuard` tenant scope를 사용한다. 한 transaction에서 tenant-scoped document row를 lock하고 `DELETING` 전환 및 `DELETE/PENDING` job 생성(opaque object-key snapshot 포함)을 함께 commit한다. 이미 `DELETING`이면 새 job을 만들지 않고 같은 safe document resource를 `202`으로 반환한다. hard delete 후에는 status 조회와 반복 DELETE 모두 기존 absent-resource 정책인 `404 RAG_DOCUMENT_NOT_FOUND`다.
- `DELETING`은 retrieval SQL의 즉시 제외 조건이다. delete worker는 snapshot으로 S3를 먼저 삭제하고, `DeleteObject`의 이미 없는 object를 success로 취급한다. 이후 하나의 DB transaction에서 non-terminal `INGEST`/`REINDEX`/legacy DELETE jobs를 CANCELLED로 terminalize하고 lease를 clear한 뒤 모든 job의 `documentId`를 detach하고, chunks/indexes/document를 hard delete한다. DB finalization이 실패하면 Document row와 snapshot이 rollback으로 유지되어 S3 delete를 idempotent하게 다시 호출한다. S3 실패 또는 retry exhaustion은 document를 계속 `DELETING`으로 남긴다.
- Citation persistence와 Tenant Chat history UI는 구현됐다. 서버 검증을 통과한 safe citation snapshot만 assistant message와 별도 AAD로 tenant 암호화하며 document original, raw RAG context, chunk text를 복제하지 않는다. Document hard delete는 과거 대화 자체를 삭제하거나 snapshot을 재작성하지 않는다. History는 tenant-scoped READY-document 조회로 `available | unavailable`을 계산하고, UI는 unavailable source의 링크를 제거해 `삭제된 자료 또는 현재 사용할 수 없는 출처`로 표시한다.
- document response는 `documentId`, 서버에서 복호화한 `displayName`, `mimeType`, `sizeBytes`, `status`, bounded `failureCode`, 내부 `sanitizedFailureMessage`를 safe response 이름으로 바꾼 `failureMessage`, 내부 user ID 없이 `{displayName: string|null}`만 가진 `uploadedBy`, `createdAt`, `updatedAt`만 가진다. bucket, object key, KMS key, digest, original filename, internal user/document/Knowledge Base/job/index/chunk ID, vector와 job lease 정보는 반환하지 않는다.
- 기본 unit/integration suite는 fake object store와 local test double만 사용하며 AWS를 호출하지 않는다. `NODE_ENV=development|test` 또는 명시적인 local/test deployment marker에서만 fake를 허용하고, 분류되지 않은 환경과 staging/production은 fail closed한다. staging/production은 실제 IAM-role S3/KMS adapter와 readable rollback-safe wrapping-only key projection만 등록하며 fake 설정이나 combined Tenant Chat key mount를 발견하면 startup을 실패시킨다.

#### 12.2.4 Private RAG extraction 계약

AI Service의 `POST /internal/v1/rag/extract`는 Control Plane Worker 전용 raw-body route다. `X-GateLM-AI-Service-Token`을 환경별 secret과 constant-time 비교한 뒤에만 body를 읽는다. token이 없거나 다르면 `401 RAG_EXTRACTION_AUTH_REQUIRED`이고, `self_host`, `staging`, `production`, `aws`는 32자 미만 또는 local/fake/example placeholder token으로 시작하지 못한다. 이 route는 public Gateway/OpenAI-compatible/Application Chat surface에 등록하지 않는다.

- request는 bounded `text/plain`(optional `charset=utf-8`) 또는 parameter 없는 `application/pdf` body다. multipart, filename, tenant ID, Knowledge Base ID, storage key는 받지 않는다.
- TXT는 UTF-8 strict/BOM, NUL 제거, CRLF/CR→LF, Unicode NFC, line 내부 horizontal whitespace 축약을 적용한다. blank line 문단 경계와 1-based original line range는 보존하며 빈 결과는 영구 실패다.
- PDF는 pinned `pypdf==6.14.2`를 timeout 시 종료 가능한 child process에서 사용해 page text만 읽는다. encrypted, damaged, page/character limit 초과, text layer 부족은 stable error다. OCR, image, attachment, script, external reference는 읽거나 실행하지 않는다.
- tokenizer는 pinned `tiktoken==0.13.0`의 `text-embedding-3-large -> cl100k_base` mapping이다. `chunkingProfileVersion=1` 기본값은 target 600, overlap 100, maximum 900이며 환경 설정은 overlap < target <= maximum을 만족해야 한다.
- success는 ordered `chunks`와 top-level `parserVersion`, `chunkerVersion`을 반환한다. 각 chunk는 `ordinal`, `text`, tokenizer-derived `tokenCount`, nullable paired `pageStart/pageEnd`, nullable paired `lineStart/lineEnd`, bounded `sourceMetadata`, `parserVersion`, `chunkerVersion`만 가진다. 동일 bytes/config/dependency versions는 동일 결과와 순서를 만든다.
- AI Service는 PostgreSQL, S3, OpenAI, embedding, tenant key, chunk persistence, RagJob state를 소유하지 않는다. raw document/chunk와 parser raw exception은 log/metric/error에 넣지 않고 임시 파일은 success/failure/timeout 모두 삭제한다.
- default unit/integration suite는 network와 database 없이 동작한다. prompt-injection 문구도 실행 명령이 아니라 반환 text일 뿐이며, scanned/image-only PDF는 success 결과가 될 수 없다.

#### 12.2.5 Dedicated RAG ingestion worker

- `apps/control-plane-api`의 `start:rag-worker`는 HTTP API와 별도 process다. PostgreSQL `RagJob`을 `FOR UPDATE SKIP LOCKED`로 claim하고, RUNNING lease heartbeat·lease expiration·bounded exponential backoff·max attempts로 여러 worker와 crash recovery를 처리한다. Celery, BullMQ, Redis queue, transactional outbox는 MVP에 추가하지 않는다.
- worker는 `INGEST`와 `DELETE`를 처리한다. tenant/document/Knowledge Base identity는 claimed job과 tenant-scoped DB relation에서만 읽고, request body나 object metadata에서 tenant identity를 받지 않는다. INGEST document가 `DELETING`/missing이면 job을 CANCELLED로 끝내며, READY replay는 no-op SUCCEEDED다. DELETE는 durable object-key snapshot만 사용해 S3 삭제를 먼저 수행하고, 그 뒤 transaction에서 job detach와 Document cascade hard delete를 완료한다.
- extraction/Gateway 외부 호출 중에는 DB transaction을 열지 않는다. worker는 S3 object stream을 AI Service로 전달하고, ordered chunks를 검증한 뒤 새 BUILDING index에서 batch embedding을 요청한다. 모든 batch의 count/finite 1536-dimensional vector가 검증되기 전에는 chunk를 저장하거나 ACTIVE index를 만들지 않는다.
- chunk plaintext는 active tenant DEK로 `rag_chunk` AES-256-GCM AAD (`tenantId`, Knowledge Base, document, index, chunk ID, content-key version)를 사용해 암호화한다. final transaction에서 encrypted chunks/vector를 저장하고 existing ACTIVE index를 RETIRED로 바꾼 뒤 replacement를 ACTIVE로 승격하며 Document READY, Knowledge Base revision increment, job SUCCEEDED를 함께 commit한다. BUILDING/FAILED/RETIRED index는 retrieval SQL 대상이 아니다.
- permanent extraction/profile/dimension errors terminate Document/Job as FAILED. S3, AI Service, Gateway, timeout/rate-limit, and transient DB errors become RETRY_WAIT until `maxAttempts`; each failed staged index is FAILED and a retry creates a new BUILDING version. No error/log/metric contains source text, chunk text, vector, object key, bucket, filename, or provider body.
- worker Gateway credential files are worker-only: `RAG_WORKER_EMBEDDING_SIGNING_JWK_FILE`, `RAG_WORKER_EMBEDDING_BINDING_HMAC_KEYS_FILE`, and `RAG_WORKER_EMBEDDING_ACTIVE_KID`. Their `kid` must map only to issuer `gatelm-control-plane-worker`, subject `service:control-plane-worker`, and purpose `RAG_INGESTION`; Worker never mounts a Chat API private key. `RAG_WORKER_AI_SERVICE_TOKEN` is a separate environment-specific AI Service token. staging/production rejects fake object storage, local endpoints, and placeholder worker token values at startup.
- each gateway batch creates an idempotent `RagEmbeddingUsage` row keyed by `(tenantId,purpose,operationId,batchOrdinal)` with profile and bounded usage counts only. It measures platform RAG cost and never debits chat budget ledger.

#### 12.2.6 Tenant Chat RAG turn composition

- `TenantChatConversation.knowledgeMode` is a server-persisted `off|tenant` field. Create defaults it to `off`; an actor-owned, version-checked conversation `PATCH` may update its title and/or knowledge mode. No turn request accepts a Knowledge Base, document, embedding model, dimension, or retrieval filter. A `tenant` create or update requires the authenticated tenant's globally and tenant-enabled Knowledge Base. The captured mode of an already admitted turn does not change; the update applies to later turns.
- For `knowledgeMode=tenant`, Chat API embeds the most recent non-empty current user message with `RAG_QUERY`, searches only the authenticated tenant through the tenant-scoped retrieval SQL, then creates request-local `S1...Sn` source IDs. The selected complete chunks are bounded by `RAG_TOP_K` (default 6) and `RAG_CONTEXT_MAX_TOKENS` (default 6000); adjacent chunks from one document are deterministically de-duplicated and chunks are never truncated.
- The context is safe JSON inside a length-delimited block and is sent as a private `system` message with `purpose=rag_context`. Source text is explicitly untrusted: it cannot alter system/developer instructions or execute commands, answers require supplied evidence, and citations may only use emitted source IDs. Selection accounts for the fixed instruction, source metadata, JSON escaping expansion, and the tokenizer-derived chunk counts before enforcing `RAG_CONTEXT_MAX_TOKENS`; the request-local `rag_context` message has a separate 65,536-character ceiling while every non-RAG message remains capped at 20,000. The private marker is signed, size-validated, safety/provider/token/budget-accounted, and excluded only from routing classification.
- RAG context is never stored in encrypted conversation messages, logs, metrics, cache values, or public REST search output. It participates only in the HMAC Exact Cache fingerprint material. Only the user message and the final assistant response use the existing encrypted conversation persistence path.
- Every RAG turn completes query embedding, current tenant retrieval, and context construction before Gateway completion. Chat API preserves `UsageIntent.cacheStrategy=off|exact`; when Runtime Snapshot cache policy also enables `exact`, Gateway may reuse an encrypted final response only within the same `tenantId + userId` namespace, only when the complete final Provider input matches, and only when the server-owned safety summary is explicit `maskingAction=none`. RAG On/Off와 무관하게 `redacted|blocked` 또는 safety summary 부재 요청은 exact cache를 우회한다. The private Tenant Chat route does not use the public Semantic Cache. Final reservation and token estimate use the completed Provider message list including the context; a cache miss budget rejection occurs before a Provider call, while an exact hit keeps the existing zero-debit behavior.
- A retrieval no-hit does not downgrade to ordinary chat or call Gateway. Chat API persists the deterministic Korean product answer `등록된 문서에서 관련 근거를 찾지 못했습니다.` and returns it using the existing `chat.turn.accepted`, delta, and final SSE event shapes. Retrieval, embedding, key, decryption, or context failures return the stable RAG-unavailable error and never call the normal LLM route.
- Citation metadata is server-owned. Chat API maps each retrieval result to `S1...Sn`, accepts only those markers found in the final assistant text, removes duplicates, and ignores fabricated IDs. `documentId`, display name, page/line range and ordinal always come from that source map, never from model text. The encrypted assistant record stores only the validated citation snapshot, never chunk/context plaintext. `chat.turn.sources` is emitted after accepted and before deltas; `chat.turn.citations` is emitted after encrypted assistant persistence and before the existing final event. Both are additive `chat.turn.*` SSE events and contain only safe citation metadata; chunk/index IDs and storage/crypto fields are not part of the external citation contract. History rehydrates the snapshot and marks citations unavailable when their tenant-scoped document is no longer READY.

### 12.3 Turn lifecycle, SSE와 DOC-013

1. session/device와 authoritative entitlement를 확인한다.
2. conversation ownership, request binding, cursor/idempotency bound를 확인한다.
3. content-free turn identity를 reserve하고 기존 `authorizeAndAdmit`을 호출한다.
4. admission 성공 뒤 conversation이면 completed prior context를 bounded decrypt해 placeholder counter와 legacy migration 대상을 구성하고, single_turn이면 prior history 없이 current user만 준비한다. current user와 bounded legacy_unverified user만 sanitization phase로 보낸다.
5. block이면 admission terminal 처리 뒤 user ciphertext 없이 종료한다. passed/redacted이면 반환 content와 safety provenance를 schema v2 user ciphertext로 commit한다.
6. user commit 뒤 context mode에 맞는 completed history와 current sanitized user로 complete를 호출한다. 이미 처리된 v2 history는 PII model에 다시 보내지 않는다.
7. private Gateway SSE를 strict consume한다. chat.turn.accepted는 committed user message UUID와 sanitized stored content를 포함한다. browser는 이를 in-memory optimistic 원문과 비교해 마스킹 안내 여부만 결정하고, 현재 화면의 원문을 서버 기준값으로 덮어쓰거나 browser storage에 보존하지 않는다.
8. successful assistant 전체를 schema v2 provider_generated provenance로 암호화해 commit한 뒤에만 chat.turn.final을 보낸다.

- Chat API-facing event ID는 `<turnId>:<sequence>`이고 sequence는 1부터 증가한다. event/frame/assistant aggregate와 response backpressure는 bounded다. 같은 turn의 HTTP attachment는 기본 4개이며 `TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN`으로 1~16개 범위에서 제한하고, 초과 요청은 stream header 전 `429 CHAT_CONCURRENCY_LIMITED`로 거절한다.
- chat.turn.accepted.userMessageId는 UUID v4이고 userContent는 1~20,000자의 sanitized committed value다. 원래 untrusted input은 accepted/replay/history/durable log에 다시 내보내지 않는다. browser가 이미 보유한 원문은 해당 in-memory optimistic message의 현재 렌더링에만 사용할 수 있으며 reload 또는 history 재조회에서는 복원하지 않는다.
- fresh successful `chat.turn.final`은 Gateway가 확정한 bounded `quotaState`와 `budgetState`를 전달한다. encrypted assistant만으로 재생하는 completed turn은 두 상태를 복원할 Chat API-owned 근거가 없으므로 생략할 수 있으며, browser는 이를 새 정책 상태로 추정하지 않는다.
- successful assistant history와 `chat.turn.final`은 Gateway가 확정한 bounded `effectiveModelKey`를 선택적으로 포함한다. Chat API는 이를 assistant message와 함께 저장하며 legacy row 또는 Gateway가 모델을 확정하지 못한 경우 생략한다. Provider connection, fallback attempt, credential과 비용 상세는 직원 응답에 포함하지 않는다.
- fresh successful `chat.turn.final`은 Gateway가 확정한 `cacheOutcome`을 선택적으로 포함한다. exact cache hit에서는 assistant history의 모델 표시를 생략하고 browser는 모델 호출이 없었다고 표시한다.
- public turn `usageIntent`는 `requestedTier`, `maxOutputTokens`, `cacheStrategy`만 받는다. 별도 optional `contextMode`는 `conversation|single_turn`이며 미지정 시 기존 호환을 위해 `conversation`이다. `conversation`은 completed prior context와 current user message를 전달하고, `single_turn`은 encrypted history를 삭제하거나 변경하지 않은 채 current user message만 전달한다.
- Chat API는 실제 private completion에 포함하는 bounded message content의 UTF-8 byte length 합계(최소 1)를 conservative `estimatedInputTokens`로 계산하며 caller estimate를 받거나 신뢰하지 않는다. context mode는 actor, employee, tenant usage 귀속을 바꾸지 않으므로 confirmed ledger와 향후 DB-backed employee usage/cost aggregate는 동일 identity 경계를 유지한다.
- context mode는 keyed turn request binding에 포함한다. legacy/default `conversation` binding shape는 그대로 유지하고 `single_turn`만 explicit discriminator를 추가해 같은 idempotency key로 mode를 바꾸는 replay를 `409 CHAT_IDEMPOTENCY_CONFLICT`로 거절한다.
- attachment capacity는 admission 전에 reserve한다. admission 뒤 sanitization, user persistence, history preparation 또는 activation이 실패하면 local reservation을 반드시 해제한다. safety block은 이미 Gateway terminal이므로 cancel하지 않고, 그 밖의 pre-completion 실패만 admission과 turn을 best effort cancel한다.
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
