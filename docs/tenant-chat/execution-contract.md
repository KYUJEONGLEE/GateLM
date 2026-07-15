# Tenant Chat Executable Integration Contract

상태: **Active**
revision: `tenant-chat/v1`
의미 계약: [`contracts.md`](./contracts.md)

이 문서는 `contracts.md`의 의미를 API, DB, digest, key operation, event ordering과 구현 소유권으로 구체화한다. 이 문서와 machine-readable artifact가 충돌하면 구현을 멈추고 같은 PR에서 둘을 함께 수정한다.

## 1. 실행 artifact

| 범위 | 기준 |
|---|---|
| Browser/session auth wire | [`openapi/chat-auth.openapi.json`](./openapi/chat-auth.openapi.json) |
| Private Control Plane metadata wire | [`openapi/private-control-plane.openapi.json`](./openapi/private-control-plane.openapi.json) |
| Admin Runtime wire | [`openapi/admin-runtime.openapi.json`](./openapi/admin-runtime.openapi.json) |
| Conversation/turn wire | [`openapi/chat-conversation.openapi.json`](./openapi/chat-conversation.openapi.json) |
| Private Gateway wire contract | [`openapi/private-gateway.openapi.json`](./openapi/private-gateway.openapi.json) |
| Content DB record | [`db/tenant-chat-content.sql`](./db/tenant-chat-content.sql) |
| Usage DB record | [`db/tenant-chat-usage.sql`](./db/tenant-chat-usage.sql) |
| RuntimeSnapshot | [`schemas/tenant-runtime-snapshot.schema.json`](./schemas/tenant-runtime-snapshot.schema.json) |
| Workload JWT | [`schemas/workload-jwt-claims.schema.json`](./schemas/workload-jwt-claims.schema.json) |
| Request context | [`schemas/gateway-request-context.schema.json`](./schemas/gateway-request-context.schema.json) |
| SSE | [`schemas/completion-sse-event.schema.json`](./schemas/completion-sse-event.schema.json) |
| Chat API-facing SSE | [`schemas/chat-turn-sse-event.schema.json`](./schemas/chat-turn-sse-event.schema.json) |
| Conversation resource | [`schemas/chat-conversation.schema.json`](./schemas/chat-conversation.schema.json) |
| Usage outbox payload | [`schemas/usage-settlement-event.schema.json`](./schemas/usage-settlement-event.schema.json) |
| Pre-ledger terminal payload | [`schemas/invocation-terminal-event.schema.json`](./schemas/invocation-terminal-event.schema.json) |
| Mixed/late usage outbox payload | [`schemas/usage-settlement-event-v2.schema.json`](./schemas/usage-settlement-event-v2.schema.json) |
| Pre-ledger terminal payload v2 | [`schemas/invocation-terminal-event-v2.schema.json`](./schemas/invocation-terminal-event-v2.schema.json) |
| Binding vectors | [`vectors/binding-digest-vectors.json`](./vectors/binding-digest-vectors.json) |
| Event transition vectors | [`vectors/usage-event-vectors.json`](./vectors/usage-event-vectors.json) |
| Mixed/late event vectors | [`vectors/usage-event-v2-vectors.json`](./vectors/usage-event-v2-vectors.json) |

## 2. API idempotency와 retry

- Chat API는 logical turn에 `turnId`, Gateway execution에 `requestId`, logical retry에 `idempotencyKey`를 한 번 생성한다.
- Chat conversation create/turn API는 actor-bound keyed request MAC을 PostgreSQL에 먼저 reserve해 concurrent duplicate가 같은 logical IDs를 사용하게 한다. MAC, canonical bytes와 content는 log/response/metric에 넣지 않는다.
- transport retry는 세 값을 유지하고 새 `jti`, `iat`, `nbf`, `exp`로 JWT만 다시 발급한다.
- Chat API transport는 최대 2회 시도한다. response header 전 network/timeout 또는 짧은 `503`만 한 번 재시도하고, `4xx`, `429`, Provider terminal 오류는 재시도하지 않는다.
- completion stream이 final 전에 비정상 종료되면 같은 실행 ID로 한 번만 reattach한다. reattach도 새 JWT/JTI를 사용한다.
- caller abort는 transport failure로 재시도하거나 reattach하지 않는다. Chat API private client는 내부 `499 CHAT_REQUEST_CANCELLED`로 즉시 중단하고 execution bridge가 admission/Provider cancel을 best effort로 시도한다.
- 같은 `(tenantId,userId,idempotencyKey)`와 같은 binding은 provider를 다시 호출하지 않는다.
- admission 최초 생성은 `201`, 같은 binding replay는 `200`과 `replayed=true`다.
- cancel 최초·동일 replay는 모두 `200`이다. 이미 consume/expire된 admission의 첫 cancel은 `409 CHAT_ADMISSION_EXPIRED`다.
- completion의 in-flight replay는 같은 실행 stream에 attach한다. terminal replay는 provider 호출 없이 final event만 다시 보낸다. 둘 다 `200`이며 `Idempotency-Replayed: true`다.
- Chat API는 같은 logical turn의 concurrent HTTP attachment를 하나의 completion promise와 AbortSignal로 fan-out한다. attachment는 기본 4개이며 `TENANT_CHAT_MAX_ATTACHMENTS_PER_TURN`으로 1~16개 범위에서 제한하고, 초과 요청은 stream header 전 `429 CHAT_CONCURRENCY_LIMITED`로 거절한다. 늦게 attach한 응답은 이미 관측된 bounded delta부터 순서대로 replay하며 별도 Provider call을 만들지 않는다. 느린 attachment의 response backpressure는 해당 응답에만 적용하고 공유 Provider stream과 final persistence를 막지 않는다.
- Chat API는 attachment capacity를 admission 전에 reserve한다. admission 이후 준비 실패는 local reservation을 항상 해제하고, 다른 attachment가 없는 경우에만 admission과 turn을 best effort cancel한다.
- process recovery 중 안전한 attach/replay를 증명할 수 없으면 `503 CHAT_USAGE_GUARD_UNAVAILABLE`와 bounded `retryAfterSeconds`를 반환한다.
- 같은 key와 다른 binding은 항상 `409 CHAT_IDEMPOTENCY_CONFLICT`이며 기존 request 상태를 노출하지 않는다.
- 오류 body는 OpenAPI의 `ErrorResponse`만 사용한다. Provider raw error, request body, JWT, 내부 stack과 비용 금액을 넣지 않는다.

## 3. SSE wire 규칙

- response는 UTF-8 `text/event-stream`이며 각 event는 `id`, `event`, 단일-line JSON `data`와 빈 줄로 끝난다.
- stream 시작·event 사이·종료의 field 없는 빈 event block은 무시한다. 공백, comment, unknown/duplicate field가 있는 frame은 빈 event로 취급하지 않고 거부한다.
- `id`는 `<requestId>:<sequence>`다. sequence는 request별 1부터 단조 증가한다.
- `tenant_chat.delta`는 ephemeral display payload이며 DB, structured log, metric에 저장하지 않는다.
- `tenant_chat.final`은 request마다 exactly once 생성하고 schema validation 후 Chat API가 final assistant ciphertext를 저장한다.
- Chat API는 public turn request에서 `estimatedInputTokens`를 받지 않는다. private completion에 실제 포함되는 bounded message content의 UTF-8 byte length 합계(최소 1)를 계산해 completion `usageIntent`와 binding에 사용한다.
- successful final 저장의 retryable PostgreSQL timeout/connection/transaction conflict는 동일 assistant content를 유지한 채 최대 3회 재시도한다. unique `(turn_id,role)`와 decrypt/compare가 commit 후 응답 유실도 same-content replay로 수렴시킨다.
- terminal replay는 새로운 Provider call 없이 동일한 terminal facts로 `tenant_chat.final`을 재생하며 `replayed=true`다.
- DOC-013은 Chat API의 encrypted final을 authoritative replay source로 사용해 닫는다. local final이 있으면 `accepted`, bounded reconstructed `delta`, `final`을 재생한다. Gateway terminal replay만 있고 local final이 없으면 `CHAT_TERMINAL_REPLAY_UNAVAILABLE`로 fail closed하며 성공 content를 만들지 않는다.
- Chat API-facing fresh success `chat.turn.final`은 private final의 bounded `quotaState`와 `budgetState`를 그대로 전달한다. local encrypted replay는 해당 usage state를 DB에 중복 저장하지 않으므로 두 필드를 생략할 수 있고, browser는 마지막으로 확인한 상태만 유지한다.
- Chat API-facing fresh success `chat.turn.final`은 private final의 bounded `cacheOutcome`도 전달한다. exact cache hit에서는 모델 호출을 표시하지 않으며, local encrypted replay에서는 해당 필드를 생략할 수 있다.
- client disconnect는 local attachment handle을 즉시 해제하고 best-effort Provider cancel을 시도하지만 이미 발생한 billable usage의 정산을 취소하지 않는다.
- HTTP status는 stream header를 보내기 전 실패에만 적용한다. `200` stream 시작 뒤의 Provider timeout/failure/cancel은 safe `error`를 가진 `tenant_chat.final`로 종료한다.
- Chat API private client는 redirect를 금지하고 JSON 64 KiB, request 4 MiB, SSE frame 64 KiB, 전체 stream 8 MiB를 기본 상한으로 둔다. 기본 timeout은 Control Plane 1.5초, admission/cancel 2초, completion 130초이며 환경 설정은 bounded range만 허용한다.
- Chat API `readyz`는 DB와 workload signing/binding/private Gateway 설정을 함께 검사한다. key file, active `kid`, matching HMAC key 또는 Gateway URL이 없거나 잘못되면 `healthz`는 유지하되 readiness와 execution을 `503`으로 닫는다.
- workload signing/binding credential은 최초 검증 성공 전까지 `readyz`와 execution 호출에서 fail closed로 다시 로드하며, 성공하면 private `KeyObject`, active `kid`, HMAC key만 프로세스 수명 동안 로컬 메모리에 캐시한다. 기존 프로세스는 재시작 전까지 캐시한 key를 계속 사용한다.
- signing/binding key 변경은 새 `kid`를 포함한 Chat API rolling restart로 적용한다. 실행 중 file watch, TTL/mtime polling, Redis cache 또는 hot reload는 이 계약에 포함하지 않는다.

## 3.1 Active RuntimeSnapshot metadata reader

- Chat API는 admission 전에 service token으로 보호된 `GET /internal/v1/tenant-chat/runtime/snapshots/{tenantId}/active`를 호출한다. wire shape는 [`openapi/private-control-plane.openapi.json`](./openapi/private-control-plane.openapi.json)을 따른다.
- Control Plane은 기존 active pointer와 `TenantChatRuntimeService`를 재사용하며 `tenantId`, `version`, `digest`, `policyVersion`, `employeeNoticeVersion`, `pricingVersion`만 반환한다. snapshot body, Provider credential 또는 policy detail을 반환하지 않는다.
- active snapshot이 없거나 tenant가 다르거나 저장 body가 active schema에 맞지 않으면 `503 CHAT_RUNTIME_UNAVAILABLE`로 fail closed한다. Chat API는 이 metadata와 authoritative entitlement를 admission handle에 immutable하게 pin한다.

## 4. `bindingDigest`

### 4.1 Payload digest

1. admission과 cancel의 `payloadDigest`는 zero-length byte string의 SHA-256이다.
2. completion의 `payloadDigest`는 request의 `input` object를 RFC 8785 JSON Canonicalization Scheme(JCS)로 직렬화한 UTF-8 bytes의 SHA-256이다.
3. 표현은 `sha256:` + unpadded base64url digest다.
4. Gateway는 수신 body로 payload digest를 다시 계산한다. Chat API가 보낸 digest 값을 신뢰하지 않는다.

### 4.2 Binding object

아래 필드만 포함한다. `admissionId`가 없는 admission은 JSON `null`을 넣고 `usageIntent`는 completion phase에만 포함한다.

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
  "turnId": "<opaque>",
  "usageIntent": {
    "estimatedInputTokens": 1,
    "maxOutputTokens": 1,
    "requestedTier": "standard",
    "cacheStrategy": "exact"
  }
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

### 5.1 Content wrapping/integrity key 운영

Chat API만 `TENANT_CHAT_CONTENT_KEYS_FILE=/run/secrets/tenant-chat/content-keys.json`을 읽는다. Gateway, Control Plane, Chat Web에는 mount하지 않는다. repository에는 실제 value를 두지 않으며 local helper가 다른 Tenant Chat secret과 함께 원자적으로 생성하고 기존 directory를 덮어쓰지 않는다.

```json
{
  "schemaVersion": 1,
  "activeVersion": 2,
  "keys": [
    { "version": 1, "wrappingKey": "<32-byte-base64url>", "integrityKey": "<32-byte-base64url>" },
    { "version": 2, "wrappingKey": "<32-byte-base64url>", "integrityKey": "<32-byte-base64url>" }
  ]
}
```

- key set은 1~8개 unique positive version만 허용하고 active version이 반드시 포함돼야 한다.
- `wrappingKey`는 tenant DEK wrapping에만, `integrityKey`는 cursor/create/turn binding MAC에만 사용한다. 목적 간 key reuse를 하지 않는다.
- DEK wrapping AAD는 `schemaVersion`, `tenantId`, `contentKeyVersion`, `wrappingKeyVersion`, `contentKind=tenant_dek` exact key set을 JCS canonicalize한 UTF-8 bytes다.
- create/turn row는 binding MAC과 함께 `bindingKeyVersion`을 저장한다. replay는 저장된 grace integrity key로 검증하며 active key로 다시 계산해 conflict를 만들지 않는다.
- 새 version을 모든 reader에 먼저 배포하고 active version을 올린다. Chat API는 DEK rewrap과 DB rollback floor 증가를 같은 짧은 transaction으로 적용하며 crypto 연산 중 transaction을 열어두지 않는다.
- active version이 DB floor보다 낮거나 필요한 grace key가 file에 없으면 readiness, encrypt/decrypt, cursor/idempotency를 fail closed한다.

## 6. RuntimeSnapshot digest와 pricing

- Tenant Chat snapshot lookup key는 `tenantId` 하나이며 Project/Application field를 허용하지 않는다.
- snapshot digest payload는 snapshot object에서 `digest`, `publishedAt`, `publishedBy`를 제거한 object다. `tenantId`, `version`, 모든 policy와 pricing provenance는 포함한다.
- payload를 RFC 8785 JCS UTF-8 bytes로 만들고 SHA-256 후 `sha256:<unpadded-base64url>`로 표현한다.
- Gateway는 DB body를 다시 digest하고 요청의 version/digest와 exact match할 때만 실행한다.
- pricing은 snapshot에 `version`, `digest`, `effectiveAt`, USD micro-unit 단가를 immutable하게 pin한다. pricing digest는 pricing object에서 `digest`를 제거한 뒤 같은 RFC 8785/SHA-256/base64url 규칙으로 계산한다.
- 각 price route는 Routing v2 snapshot에서 `pricingStatus=available|unavailable`과 `pricingSource=model_pricing_rules|bundled|unavailable`을 명시한다. unavailable은 모든 monetary rate 0이며 “무료”를 뜻하지 않고 정확한 금액을 계산할 수 없다는 뜻이다.
- attempt row에는 `pricing_version`과 실제 계산에 쓴 regular input/output/provider cache-read 단가를 복사해 catalog 변경 후에도 재현 가능하게 한다.
- `policies.safety.detectorSet`은 detector별 `allow|redact|block` 실행 규칙이며 mandatory secret detector는 `allow`를 거부한다. safety는 routing/cache/Provider보다 먼저 실행하고 redacted input만 다음 단계에 전달한다.
- `policies.routing.policy`가 있으면 Gateway는 기존 deterministic rule-based classifier로 category `general|code|translation|summarization|reasoning`과 difficulty `simple|complex`를 계산하고 cell의 ordered `modelRefs`를 concrete enabled route로 resolve한다. offline shadow Routing AI service는 이 경로를 변경하지 않는다.
- routing decision은 cache lookup과 usage reservation 전에 고정한다. exact-cache fingerprint는 snapshot digest와 선택 `modelRef`를 포함하므로 같은 prompt라도 다른 routing target의 response를 재사용하지 않는다.
- `routingMode=manual`은 `manualModelRef`를 선택하고, `routingMode=auto`는 5×2 matrix를 선택한다. budget/quota의 `economy` 상태를 difficulty 또는 modelRef로 암묵 변환하지 않는다.
- `policies.cache.keySetId`는 Gateway-local cache keyset의 logical ID다. fingerprint HMAC key와 AES-256-GCM key material은 snapshot이나 DB에 넣지 않는다.
- `policies.providerTokenRate.providers`는 routed provider별 `limitTokens/windowSeconds`를 모두 정의한다. 호출 직전의 weight는 `estimatedInputTokens + maxOutputTokens`다.
- 관리자 최초 발행 기본값은 request rate `60/60s`, user concurrency `2`와 admission TTL `30s`, 월 token limit `1,000,000` 및 `80/100/120`, 월 budget `1,000,000,000 microUSD` 및 `80/90/100`, timezone `Asia/Seoul`, provider token rate `120,000/60s`, exact cache off, email redact/API-key block safety, streaming `120s`와 required final이다.
- 관리자 재발행은 active snapshot의 비라우팅 정책과 `employeeNoticeVersion`을 보존한다. 5×2 policy가 참조하는 unique modelRefs의 concrete routes, ordered fallback attempts, provider token rate와 pinned pricing만 교체한다.
- Admin Runtime publisher는 full-session tenant admin의 server-side user ID를 `publishedBy`로 사용하며 client가 publisher를 공급하지 못하게 한다.

예약 계산은 integer arithmetic만 사용한다.

```text
reservedTokens = estimatedInputTokens + maxOutputTokens
inputExposureMicroUsd = ceil(estimatedInputTokens * inputMicroUsdPerMillionTokens / 1_000_000)
outputExposureMicroUsd = ceil(maxOutputTokens * outputMicroUsdPerMillionTokens / 1_000_000)
reservedCostMicroUsd = inputExposureMicroUsd + outputExposureMicroUsd
```

`pricingStatus=unavailable` route는 input/output monetary rate가 0이므로 `reservedCostMicroUsd=0`이다. token quota와 provider token-rate는 정상 적용하고, 기존 tenant cost period가 이미 `blocked`면 새 호출을 허용하지 않는다. 이후 가격 catalog가 생겨도 과거 snapshot/attempt를 소급 가격 책정하지 않으며 새 snapshot을 발행한다.

fallback 전에는 현재 routing cell의 다음 ordered modelRef route에 대한 exposure 전체를 추가 top-up한다. legacy snapshot은 기존 `fallback.routeIds` 순서를 유지한다. 예약은 cache discount를 가정하지 않는다. 정산에서 Provider prompt-cache read token이 확인되면 `regularInput=inputTokens-cacheReadInputTokens`로 두고 regular input, cache-read input, output 항목을 각각 pinned 단가로 계산해 올림한 뒤 합한다. cache-read 단가가 없으면 모든 input을 regular input으로 계산한다. `cacheReadInputTokens <= inputTokens`, `cacheReadInputPrice <= regularInputPrice`를 publish/settlement에서 검증한다. Provider cache creation/write token과 가격은 이 read 필드에 넣지 않으며, 지원할 때 5분/1시간 write field를 별도 contract revision으로 추가한다. Provider가 total cost를 authoritative하게 제공하더라도 token과 pinned price로 계산한 값과 차이를 기록해 검토하며, MVP ledger의 confirmed cost는 pinned price 계산값을 사용한다. GateLM Exact Cache hit과 pre-call failure는 Provider를 호출하지 않으므로 0이다.

GateLM Exact Cache와 Provider prompt cache는 별도 기능이다. Exact Cache는 GateLM이 응답을 반환해 Provider 호출 자체가 없고, Provider cache-read는 Provider 호출 안에서 input 일부가 재사용되는 과금 provenance다.

`defaultMonthlyTokenLimit=0` 또는 `monthlyLimitMicroUsd=0`은 무제한이 아니라 즉시 `blocked`다. 이때 materialized warning/economy/hard-stop absolute threshold는 모두 0이고 period row의 state도 `blocked`여야 한다. 양수 limit에서만 threshold를 strict increasing으로 materialize한다.

월 기간은 tenant-configured IANA timezone의 현지 월 1일 00:00 inclusive부터 다음 달 1일 00:00 exclusive까지이며 DB에는 두 경계를 UTC `timestamptz`로 저장한다. timezone 변경은 다음 period부터 적용한다.

## 7. Usage state와 outbox ordering

Reservation transition:

```text
admitted -> reserved -> settled
                    -> released
                    -> pending_unconfirmed(reserved + usage_pending_at)
                    -> unconfirmed
```

- top-up은 `reserved` self-transition이며 ledger version을 증가시킨다.
- `pending_unconfirmed`은 별도 reservation state가 아니라 unresolved attempt의 `usage_quality`와 reservation의 `usage_pending_at`으로 표현한다. 이 동안 reserved balance와 ledger version은 유지한다.
- Gateway reconciliation worker는 `usage_pending_at <= now()-15m` row를 bounded batch와 `FOR UPDATE SKIP LOCKED`로 claim한다.
- terminal state에서 다른 terminal state로 전이하지 않는다. late provider usage는 `unconfirmed`의 incident exposure를 역분개하고 original period/pricing으로 별도 exactly-once settle한다.
- writer는 period rows와 reservation을 lock하고 expected `ledgerVersion` CAS, ledger insert, outbox insert를 한 transaction에서 수행한다.
- provider attempt와 ledger row는 `(reservationId,requestId)` 복합 FK로 reservation identity를 검증한다. 두 ID를 각각 다른 reservation에 연결하는 독립 FK는 허용하지 않는다.
- outbox idempotency key는 `(aggregateId=requestId,eventType,eventVersion=ledgerVersion)`다.
- consumer는 version이 현재 이하이면 duplicate로 no-op한다. 정확히 `current+1`만 적용한다.
- version gap이면 뒤 event를 적용하지 않고 aggregate replay를 요청한다. 재시도 후에도 gap이면 DLQ/incident로 보내며 quota correctness source에는 영향이 없다.
- v1 event 의미는 변경하지 않는다. mixed confirmed/unconfirmed deadline transition과 late negative unconfirmed delta만 schemaVersion 2를 사용하며 signed delta 조건은 v2 schema/vector를 따른다.
- projector는 일반 terminal event를 snapshot 값으로 투영하고, `schemaVersion=2`, `eventType=usage_settled`, `lateUsage=true`에 한해 기존 confirmed 합계에 delta를 누적한다.
- ledger 이전 rate/concurrency/policy/runtime block은 `invocation_terminal`을 admission transaction의 outbox에 기록한다. content와 usage delta는 없으며 Dashboard projector만 소비한다.

Transaction 경계는 `BeginExecution`(admission consume, period reservation, reservation, primary attempt, `usage_reserved` ledger/outbox), `BeginFallback`(이전 attempt 결과, fallback top-up, fallback attempt), terminal/reconciliation transaction으로 나눈다. Provider, Redis, safety, 암호화 연산 중에는 DB transaction을 열어두지 않는다.

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
| Tenant Chat session/refresh family | Chat API | Chat API auth service | Chat API auth service |
| Browser auth cookie/CSRF boundary | Chat Web BFF | Chat Web BFF | Browser and Chat API proxy only |
| conversation/message/turn/content-key record | Chat API workstream | Chat API only | Chat API only |
| Workload JWT | Chat API | Chat API signer | Gateway verifier |

Chat API는 8개 usage table을 직접 갱신하지 않는다. Gateway는 conversation ciphertext나 Employee record를 쓰지 않는다. 모든 usage record는 `tenant_id`를 가지며 writer query와 update predicate는 항상 tenant ID를 포함한다.

Chat API는 Control Plane-owned identity table을 직접 읽지 않는다. session/refresh table만 직접 읽고 쓰며, identity authentication·invitation binding·entitlement는 전용 Tenant Chat service token으로 보호된 Control Plane private API를 사용한다. Gateway용 internal token은 이 mutation route에 허용하지 않는다.

### 8.1 Content transaction ordering

- new turn reserve는 actor-scoped active conversation을 `FOR UPDATE`로 잠근 같은 transaction에서 content-free `tenant_chat_turns` row만 만든다. unique `(tenant_id,user_id,idempotency_key)`와 keyed request MAC이 logical IDs를 고정하며 delete가 lock을 먼저 획득하면 insert하지 않는다.
- admission 성공 뒤 user ciphertext insert와 turn admission metadata update를 한 transaction에서 수행한다. transaction 실패 시 Gateway cancel을 best effort로 호출하고 completion을 호출하지 않는다.
- assistant final은 conversation row를 `FOR UPDATE`로 잠그고 `deleted_at IS NULL`, captured `cache_epoch`, turn state를 확인한 뒤 message insert, next sequence increment, turn completed transition을 한 transaction에서 수행한다.
- assistant insert unique key는 `(turn_id,role)`다. duplicate는 기존 ciphertext를 decrypt/compare한 뒤 same content만 replay하고, mismatch는 integrity failure다.
- delete는 conversation lock, tombstone/version/cache epoch update, message ciphertext delete, unfinished turn cancel transition을 한 transaction에서 수행한다. 외부 Gateway cancel은 commit 뒤 best effort다.
- retention은 마지막 ciphertext commit 기준 sliding expiry와 같은 delete primitive의 bounded batch다. selection cutoff를 고정하고 conversation lock 안에서 expiry를 다시 확인해 그 사이 연장된 row를 건너뛴다. active in-process handle은 commit 뒤 best-effort cancel하며 worker crash/replay가 content를 복구하거나 epoch를 낮추지 않는다.

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
