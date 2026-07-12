# Tenant Chat Executable Integration Contract

상태: **Active**
revision: `tenant-chat/v1`
의미 계약: [`contracts.md`](./contracts.md)

이 문서는 `contracts.md`의 의미를 API, DB, digest, key operation, event ordering과 구현 소유권으로 구체화한다. 이 문서와 machine-readable artifact가 충돌하면 구현을 멈추고 같은 PR에서 둘을 함께 수정한다.

## 1. 실행 artifact

| 범위 | 기준 |
|---|---|
| Private Gateway wire contract | [`openapi/private-gateway.openapi.json`](./openapi/private-gateway.openapi.json) |
| Usage DB record | [`db/tenant-chat-usage.sql`](./db/tenant-chat-usage.sql) |
| RuntimeSnapshot | [`schemas/tenant-runtime-snapshot.schema.json`](./schemas/tenant-runtime-snapshot.schema.json) |
| Workload JWT | [`schemas/workload-jwt-claims.schema.json`](./schemas/workload-jwt-claims.schema.json) |
| Request context | [`schemas/gateway-request-context.schema.json`](./schemas/gateway-request-context.schema.json) |
| SSE | [`schemas/completion-sse-event.schema.json`](./schemas/completion-sse-event.schema.json) |
| Usage outbox payload | [`schemas/usage-settlement-event.schema.json`](./schemas/usage-settlement-event.schema.json) |
| Pre-ledger terminal payload | [`schemas/invocation-terminal-event.schema.json`](./schemas/invocation-terminal-event.schema.json) |
| Binding vectors | [`vectors/binding-digest-vectors.json`](./vectors/binding-digest-vectors.json) |
| Event transition vectors | [`vectors/usage-event-vectors.json`](./vectors/usage-event-vectors.json) |

## 2. API idempotency와 retry

- Chat API는 logical turn에 `turnId`, Gateway execution에 `requestId`, logical retry에 `idempotencyKey`를 한 번 생성한다.
- transport retry는 세 값을 유지하고 새 `jti`, `iat`, `nbf`, `exp`로 JWT만 다시 발급한다.
- 같은 `(tenantId,userId,idempotencyKey)`와 같은 binding은 provider를 다시 호출하지 않는다.
- admission 최초 생성은 `201`, 같은 binding replay는 `200`과 `replayed=true`다.
- cancel 최초·동일 replay는 모두 `200`이다. 이미 consume/expire된 admission의 첫 cancel은 `409 CHAT_ADMISSION_EXPIRED`다.
- completion의 in-flight replay는 같은 실행 stream에 attach한다. terminal replay는 provider 호출 없이 final event만 다시 보낸다. 둘 다 `200`이며 `Idempotency-Replayed: true`다.
- process recovery 중 안전한 attach/replay를 증명할 수 없으면 `503 CHAT_USAGE_GUARD_UNAVAILABLE`와 bounded `retryAfterSeconds`를 반환한다.
- 같은 key와 다른 binding은 항상 `409 CHAT_IDEMPOTENCY_CONFLICT`이며 기존 request 상태를 노출하지 않는다.
- 오류 body는 OpenAPI의 `ErrorResponse`만 사용한다. Provider raw error, request body, JWT, 내부 stack과 비용 금액을 넣지 않는다.

## 3. SSE wire 규칙

- response는 UTF-8 `text/event-stream`이며 각 event는 `id`, `event`, 단일-line JSON `data`와 빈 줄로 끝난다.
- `id`는 `<requestId>:<sequence>`다. sequence는 request별 1부터 단조 증가한다.
- `tenant_chat.delta`는 ephemeral display payload이며 DB, structured log, metric에 저장하지 않는다.
- `tenant_chat.final`은 request마다 exactly once 생성하고 schema validation 후 Chat API가 final assistant ciphertext를 저장한다.
- terminal replay는 새로운 Provider call 없이 동일한 terminal facts로 `tenant_chat.final`을 재생하며 `replayed=true`다.
- client disconnect는 best-effort Provider cancel을 시도하지만 이미 발생한 billable usage의 정산을 취소하지 않는다.
- HTTP status는 stream header를 보내기 전 실패에만 적용한다. `200` stream 시작 뒤의 Provider timeout/failure/cancel은 safe `error`를 가진 `tenant_chat.final`로 종료한다.

## 4. `bindingDigest`

### 4.1 Payload digest

1. admission과 cancel의 `payloadDigest`는 zero-length byte string의 SHA-256이다.
2. completion의 `payloadDigest`는 request의 `input` object를 RFC 8785 JSON Canonicalization Scheme(JCS)로 직렬화한 UTF-8 bytes의 SHA-256이다.
3. 표현은 `sha256:` + unpadded base64url digest다.
4. Gateway는 수신 body로 payload digest를 다시 계산한다. Chat API가 보낸 digest 값을 신뢰하지 않는다.

### 4.2 Binding object

아래 필드만 포함한다. `admissionId`가 없는 admission은 JSON `null`을 넣는다.

```json
{
  "admissionId": null,
  "executionScope": {},
  "idempotencyKey": "<opaque>",
  "payloadDigest": "sha256:<base64url>",
  "phase": "admission|completion|cancel",
  "requestId": "<opaque>",
  "snapshotDigest": "sha256:<base64url>",
  "snapshotVersion": 1,
  "turnId": "<opaque>"
}
```

- 위 object를 RFC 8785 JCS로 canonicalize한다.
- JOSE header `kid`와 같은 ID의 binding HMAC key를 선택한다.
- `HMAC-SHA-256(key, UTF8(canonicalBindingObject))`을 계산한다.
- 표현은 `hmac-sha256:` + unpadded base64url digest다.
- JWT의 `bindingDigest`와 body context의 `bindingDigest`가 모두 계산 결과와 같아야 한다.
- Gateway는 JWT의 request/turn/idempotency/tenant/user/actor/employee/snapshot/admission claim을 body context와 field-by-field exact 비교한다.
- `jti`, JWT 시간 claim과 Authorization header는 binding에 포함하지 않아 transport retry가 가능하다.
- 운영 HMAC key, canonical bytes, payload content와 digest는 저장·로그하지 않는다. repository에는 synthetic vector만 둔다.

## 5. Workload JWT key 운영

| Consumer | 설정 | 내용 |
|---|---|---|
| Chat API | `TENANT_CHAT_WORKLOAD_ACTIVE_KID` | 현재 서명·binding key ID |
| Chat API | `TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE` | Ed25519 private JWK file |
| Chat API | `TENANT_CHAT_BINDING_HMAC_KEYS_FILE` | `kid -> base64url 32-byte key` map |
| Gateway | `TENANT_CHAT_WORKLOAD_JWKS_FILE` | active+grace Ed25519 public JWKS |
| Gateway | `TENANT_CHAT_BINDING_HMAC_KEYS_FILE` | 같은 `kid`의 verification HMAC key map |
| Gateway | `TENANT_CHAT_WORKLOAD_JTI_REDIS_PREFIX` | default `tenant-chat:workload-jti:` |

Compose secret mount 이름은 각각 `tenant_chat_workload_signing_jwk`, `tenant_chat_workload_jwks`, `tenant_chat_binding_hmac_keys`다. repository에는 secret value를 넣지 않고 local operator가 gitignored `.secrets/tenant-chat/` 아래에 생성한다. private JWK는 Chat API에만, public JWKS는 Gateway에만 mount한다. HMAC key map은 두 서비스에만 mount한다.

Secret file shape는 다음과 같다. 아래 value는 shape 설명이며 repository fixture로 만들지 않는다.

Signing JWK (`/run/secrets/tenant_chat_workload_signing_jwk`):

```json
{"kty":"OKP","crv":"Ed25519","alg":"EdDSA","use":"sig","kid":"<kid>","x":"<base64url>","d":"<base64url>"}
```

Public JWKS (`/run/secrets/tenant_chat_workload_jwks`):

```json
{"keys":[{"kty":"OKP","crv":"Ed25519","alg":"EdDSA","use":"sig","kid":"<kid>","x":"<base64url>"}]}
```

Binding keys (`/run/secrets/tenant_chat_binding_hmac_keys`):

```json
{"keys":[{"kid":"<kid>","key":"<32-byte-base64url>"}]}
```

Local Compose는 `.secrets/tenant-chat/signing.jwk.json`, `jwks.json`, `binding-hmac-keys.json`을 위 세 secret에 file source로 연결한다. key generation helper는 private/public/HMAC 세 파일을 한 번에 원자적으로 쓰고 기존 파일을 덮어쓰지 않아야 하며, 구현 PR 04의 acceptance에 포함한다.

정상 rotation:

1. 새 `kid`의 Ed25519 key pair와 별도 32-byte HMAC key를 생성한다.
2. Gateway JWKS/HMAC map에 새 key를 추가하고 readiness로 검증한다.
3. Chat API key files에 새 key를 추가하고 `ACTIVE_KID`를 전환한다.
4. 최대 TTL 60초 + skew 5초가 지난 뒤 이전 public/HMAC verification key를 제거한다.
5. private key를 제거하고 key metadata audit를 남긴다. key material은 audit하지 않는다.

Compromise revoke는 Gateway에서 해당 `kid`를 즉시 제거하고 readiness를 fail closed로 바꾼 뒤 새 `kid`로 재배포한다. 이미 발급된 token은 남은 TTL과 무관하게 거부한다.

## 6. RuntimeSnapshot digest와 pricing

- Tenant Chat snapshot lookup key는 `tenantId` 하나이며 Project/Application field를 허용하지 않는다.
- snapshot digest payload는 snapshot object에서 `digest`, `publishedAt`, `publishedBy`를 제거한 object다. `tenantId`, `version`, 모든 policy와 pricing provenance는 포함한다.
- payload를 RFC 8785 JCS UTF-8 bytes로 만들고 SHA-256 후 `sha256:<unpadded-base64url>`로 표현한다.
- Gateway는 DB body를 다시 digest하고 요청의 version/digest와 exact match할 때만 실행한다.
- pricing은 snapshot에 `version`, `digest`, `effectiveAt`, USD micro-unit 단가를 immutable하게 pin한다. pricing digest는 pricing object에서 `digest`를 제거한 뒤 같은 RFC 8785/SHA-256/base64url 규칙으로 계산한다.
- attempt row에는 `pricing_version`과 실제 계산에 쓴 regular input/output/provider cache-read 단가를 복사해 catalog 변경 후에도 재현 가능하게 한다.

예약 계산은 integer arithmetic만 사용한다.

```text
reservedTokens = estimatedInputTokens + maxOutputTokens
inputExposureMicroUsd = ceil(estimatedInputTokens * inputMicroUsdPerMillionTokens / 1_000_000)
outputExposureMicroUsd = ceil(maxOutputTokens * outputMicroUsdPerMillionTokens / 1_000_000)
reservedCostMicroUsd = inputExposureMicroUsd + outputExposureMicroUsd
```

fallback 전에는 fallback route의 위 exposure 전체를 추가 top-up한다. 예약은 cache discount를 가정하지 않는다. 정산에서 Provider prompt-cache read token이 확인되면 `regularInput=inputTokens-cacheReadInputTokens`로 두고 regular input, cache-read input, output 항목을 각각 pinned 단가로 계산해 올림한 뒤 합한다. cache-read 단가가 없으면 모든 input을 regular input으로 계산한다. `cacheReadInputTokens <= inputTokens`, `cacheReadInputPrice <= regularInputPrice`를 publish/settlement에서 검증한다. Provider cache creation/write token과 가격은 이 read 필드에 넣지 않으며, 지원할 때 5분/1시간 write field를 별도 contract revision으로 추가한다. Provider가 total cost를 authoritative하게 제공하더라도 token과 pinned price로 계산한 값과 차이를 기록해 검토하며, MVP ledger의 confirmed cost는 pinned price 계산값을 사용한다. GateLM Exact Cache hit과 pre-call failure는 Provider를 호출하지 않으므로 0이다.

GateLM Exact Cache와 Provider prompt cache는 별도 기능이다. Exact Cache는 GateLM이 응답을 반환해 Provider 호출 자체가 없고, Provider cache-read는 Provider 호출 안에서 input 일부가 재사용되는 과금 provenance다.

`defaultMonthlyTokenLimit=0` 또는 `monthlyLimitMicroUsd=0`은 무제한이 아니라 즉시 `blocked`다. 이때 materialized warning/economy/hard-stop absolute threshold는 모두 0이고 period row의 state도 `blocked`여야 한다. 양수 limit에서만 threshold를 strict increasing으로 materialize한다.

월 기간은 tenant-configured IANA timezone의 현지 월 1일 00:00 inclusive부터 다음 달 1일 00:00 exclusive까지이며 DB에는 두 경계를 UTC `timestamptz`로 저장한다. timezone 변경은 다음 period부터 적용한다.

## 7. Usage state와 outbox ordering

Reservation transition:

```text
admitted -> reserved -> settled
                    -> released
                    -> unconfirmed
```

- top-up은 `reserved` self-transition이며 ledger version을 증가시킨다.
- terminal state에서 다른 terminal state로 전이하지 않는다. late provider usage는 `unconfirmed`의 incident exposure를 역분개하고 original period/pricing으로 별도 exactly-once settle한다.
- writer는 period rows와 reservation을 lock하고 expected `ledgerVersion` CAS, ledger insert, outbox insert를 한 transaction에서 수행한다.
- provider attempt와 ledger row는 `(reservationId,requestId)` 복합 FK로 reservation identity를 검증한다. 두 ID를 각각 다른 reservation에 연결하는 독립 FK는 허용하지 않는다.
- outbox idempotency key는 `(aggregateId=requestId,eventType,eventVersion=ledgerVersion)`다.
- consumer는 version이 현재 이하이면 duplicate로 no-op한다. 정확히 `current+1`만 적용한다.
- version gap이면 뒤 event를 적용하지 않고 aggregate replay를 요청한다. 재시도 후에도 gap이면 DLQ/incident로 보내며 quota correctness source에는 영향이 없다.
- event별 signed delta 조건은 schema와 `usage-event-vectors.json`을 따른다.
- ledger 이전 rate/concurrency/policy/runtime block은 `invocation_terminal`을 admission transaction의 outbox에 기록한다. content와 usage delta는 없으며 Dashboard projector만 소비한다.

## 8. 구현 소유권

| Record/capability | Migration owner | Writer | Reader |
|---|---|---|---|
| 8개 admission/period/reservation/attempt/ledger/outbox/log table | GateLM Gateway workstream | Gateway | Gateway, projector, Dashboard reader |
| `TenantChatRequestAdmission` | Gateway | Gateway private admission/cancel/completion | Gateway |
| user/tenant period | Gateway | Gateway transaction | Gateway, admin aggregate reader |
| reservation/attempt/ledger/outbox | Gateway | Gateway transaction | Gateway/projector |
| invocation log | Gateway | outbox projector | Request Detail/Dashboard |
| RuntimeConfig/Snapshot/pricing catalog | Control Plane | Control Plane publisher | Gateway, Chat API metadata reader |
| User/Tenant/Membership/Employee entitlement | Control Plane/Auth | Auth/admin flows | Chat API entitlement resolver |
| conversation/message ciphertext | Chat API | Chat API only | Chat API only |
| Workload JWT | Chat API | Chat API signer | Gateway verifier |

Chat API는 8개 usage table을 직접 갱신하지 않는다. Gateway는 conversation ciphertext나 Employee record를 쓰지 않는다. 모든 usage record는 `tenant_id`를 가지며 writer query와 update predicate는 항상 tenant ID를 포함한다.

## 9. 구현 및 연동 순서

1. 이 실행 계약 merge
2. Control Plane tenant RuntimeSnapshot/pricing publish와 reader
3. Gateway-owned additive usage migration과 least-privilege role
4. Gateway private listener, JWT/digest verifier, admission/ledger transaction
5. Chat API signer와 private client, encrypted conversation transaction
6. outbox projector와 Dashboard reader
7. Compose secret/network wiring과 idempotent seed
8. admission→completion→fallback→settlement contract/E2E test
9. tenant feature flag enable, legacy `/v1` regression
