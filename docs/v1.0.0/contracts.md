# GateLM v1.0.0 Contracts

## 1. Status

이 문서는 GateLM v1.0.0 구현자가 따라야 하는 고정 계약이다.

`implementation-plan.md`는 실행 계획이고, 이 문서는 구현 경계와 데이터 계약이다. 계약 변경은 기능 PR과 섞지 않고 별도 docs PR에서 처리한다.

As of 2026-06-27, this file is the canonical v1 contract freeze document. Role-specific notes such as `additional-contracts-by-role.md` are supporting coordination notes; if they conflict with this file, this file wins.

## 2. Frozen Decisions

| Decision | Value |
|---|---|
| Product shape | B2B LLM Gateway |
| Main client | Customer Demo App |
| Gateway API | OpenAI-compatible `/v1/chat/completions`, `/v1/models` |
| Streaming | v1 main path 제외 |
| RAG | GateLM core 제외. 향후 고객사 앱 예시 가능 |
| Safety | v1 main path는 rule-based redaction/block |
| Python/FastAPI AI service | optional/shadow/evaluation path |
| Rate Limit scope | `applicationId` |
| Rate Limit algorithm | PostgreSQL-backed fixed window |
| Rate Limit window | 60 seconds |
| Exact Cache | Redis |
| Request log canonical source | PostgreSQL in v1 |
| Metrics | Prometheus-compatible `/metrics` |
| Load test | k6 baseline |
| Provider main path | Mock Provider |
| Actual Provider | candidate with Mock fallback |
| Redpanda/ClickHouse | v2 evidence path |
| Raw prompt/response storage | prohibited |
| Provider/Model DB enum | prohibited |

## 3. Service Boundaries

| Context | Owner | Produces | Consumes |
|---|---|---|---|
| Product Experience & Demo | 김규민 | Demo UI, Dashboard UI, Customer Demo App, UI fixtures | Dashboard API, Request Detail API, smoke scenario |
| Control Plane & Runtime Policy | 재혁님 | Project/Application/Provider/API Key/App Token, ActiveRuntimeConfig | none for runtime decision |
| Gateway Data Plane & Governance | 이지섭 | GatewayContext, auth decision, rate limit decision, provider result | ActiveRuntimeConfig |
| AI Safety & Evaluation Lab | 이윤지 | safety corpus, detector evaluation, optional RemoteSafetyEngine contract | safety policy, Gateway safety output |
| Observability & Performance | 이규정 | Invocation Log schema/query, Dashboard aggregation, metrics, k6 report | GatewayContext, Invocation Log events |

Boundary rules:

- Control Plane creates configuration. Gateway executes configuration.
- Gateway hot path must not depend on Web Console, Dashboard UI, Python AI service, Redpanda, or ClickHouse.
- Observability stores and aggregates metadata. It does not invent stage outcomes.
- Frontend displays API results. It does not calculate canonical cost or call providers.

### 3.1 Gateway Data Plane Contract Freeze (이지섭)

Gateway Data Plane owns runtime execution and governance metadata production. It does not own Control Plane authoring, Dashboard aggregation, or Safety Lab evaluation, but it must produce stable outputs those owners can consume.

For v1 freeze, 이지섭 must lock the following contracts before Gateway implementation work:

| Contract | Gateway responsibility | Cross-owner alignment |
|---|---|---|
| Active runtime consumption | Load `ActiveRuntimeConfig` through `RuntimeConfigProvider`; keep `configHash`, `securityPolicyHash`, and `routingPolicyHash` on `GatewayContext` | 재혁님: publish criteria, provider/model config shape, credential hash verification basis |
| Auth and scope decision | Hash raw API Key/App Token, discard raw values, resolve tenant/project/application IDs, set stable auth failure outcomes | 재혁님: key/token status, scope, rotation/revocation semantics |
| GatewayContext terminal snapshot | Produce the terminal `GatewayContext` handed to `InvocationLogWriter` with all required groups and nullable skipped-stage values | 이규정: Invocation Log mapping, auth failure log behavior, aggregation inputs |
| Rate limit decision | Enforce PostgreSQL fixed window by `applicationId`, set `rateLimitDecision`, and terminal `status=rate_limited` on limit exceed | 이규정: rate limit aggregation and metrics interpretation |
| Safety runtime output | Apply rule-based redaction/block in the hot path and set masking fields, `promptHash`, redacted preview, and `securityPolicyHash` | 이윤지: detector type, action, placeholder, corpus expectations |
| Routing/cache/provider outcome | Keep provider-specific behavior inside adapters; produce selected provider/model, cache metadata, usage, cost, latency, and terminal status | 김규민: response metadata and demo-visible behavior; 이규정: log/dashboard fields |

Gateway must not add API, DB, event/log, metric, or security-sensitive fields as an implementation shortcut. Any new field or changed meaning requires a separate contract docs change before feature implementation.

## 4. Required Interfaces

Names may differ by language, but responsibilities must match.

### 4.1 RuntimeConfigProvider

Producer: 재혁님  
Consumer: 이지섭

```text
GetActiveConfig(ctx, tenantId, projectId, applicationId) -> ActiveRuntimeConfig
```

Gateway must depend on this interface, not Control Plane service internals or DB schema directly.

### 4.2 RateLimiter

Producer: 이지섭  
Consumer: Gateway pipeline, 이규정

```text
Check(ctx, input) -> RateLimitDecision
```

v1 implementation must be PostgreSQL-backed and atomic under concurrent requests.

### 4.3 SafetyEngine

Producer: 이지섭 for v1 runtime, 이윤지 for evaluation/optional remote prototype  
Consumer: Gateway pipeline

```text
Evaluate(ctx, input) -> SafetyDecision
```

Required implementations:

```text
RuleBasedSafetyEngine   # v1 main path
RemoteSafetyEngine      # optional, disabled by default
```

Python/FastAPI RemoteSafetyEngine must not be required for v1 smoke.

### 4.4 ProviderAdapter

Producer: 이지섭  
Consumer: Gateway pipeline

```text
ListModels(ctx, input) -> ModelList
ChatCompletion(ctx, input) -> ProviderResult
HealthCheck(ctx) -> HealthResult
```

Provider-specific logic belongs inside adapters, not handlers.

### 4.5 InvocationLogWriter

Producer: 이규정  
Consumer: Gateway pipeline

```text
WriteTerminal(ctx, GatewayContext) -> error
```

Log write failure must be recorded as runtime log/metric. It should not turn an already successful client response into failure unless explicitly configured.

## 5. Gateway API Contract

### 5.1 Endpoints

| Method | Endpoint | Required |
|---|---|---:|
| GET | `/healthz` | Y |
| GET | `/readyz` | Y |
| GET | `/metrics` | Y |
| GET | `/v1/models` | Y |
| POST | `/v1/chat/completions` | Y |

### 5.2 Request Headers

| Header | Required | Notes |
|---|---:|---|
| `Authorization: Bearer <gateway_api_key>` | Y | raw value is hashed and discarded |
| `X-GateLM-App-Token` | Y | Application access token |
| `X-GateLM-End-User-Id` | N | opaque customer user id |
| `X-GateLM-Feature-Id` | N | customer feature id |
| `X-GateLM-Request-Id` | N | accepted if valid, otherwise generated |
| `Content-Type: application/json` | Y for POST | JSON only |

MUST NOT log or store raw header credentials.

### 5.3 Response Headers

All Gateway responses should include:

```text
X-GateLM-Request-Id
X-GateLM-Cache-Status: hit | miss | bypass | error
X-GateLM-Cache-Type: none | exact
X-GateLM-Masking-Action: none | redacted | blocked
X-GateLM-Routed-Provider
X-GateLM-Routed-Model
```

### 5.4 Chat Request

`POST /v1/chat/completions` accepts text-only OpenAI-compatible JSON.

| Field | Required | Rule |
|---|---:|---|
| `model` | Y | `auto` or allowed configured model |
| `messages` | Y | `messages[].content` must be JSON string |
| `stream` | N | `true` returns `400 streaming_not_supported` |
| `metadata` | N | non-sensitive only |
| `gate_lm` | N | extension object |

Invalid `messages[].content`:

```text
missing, null, object, array, image/file/audio part -> 400 invalid_request_error
```

Prompt text may exist in memory only. It must not be persisted raw.

### 5.5 Error Contract

Gateway error response uses OpenAI-compatible shape.

```json
{
  "error": {
    "message": "Request blocked by GateLM security policy.",
    "type": "gatelm_policy_error",
    "param": null,
    "code": "sensitive_data_blocked",
    "request_id": "request_..."
  }
}
```

| HTTP | Code | Provider called | Cache lookup | Terminal status |
|---:|---|---:|---:|---|
| 400 | `invalid_request_error` | N | N | `error` |
| 400 | `streaming_not_supported` | N | N | `error` |
| 413 | `request_body_too_large` | N | N | `error` |
| 401 | `invalid_api_key` | N | N | `error` |
| 403 | `invalid_app_token` | N | N | `error` |
| 403 | `scope_mismatch` | N | N | `error` |
| 403 | `sensitive_data_blocked` | N | N | `blocked` |
| 429 | `rate_limited` | N | N | `rate_limited` |
| 502 | `provider_error` | Y | after miss | `error` |
| 504 | `provider_timeout` | Y | after miss | `error` |
| 500 | `internal_error` | depends | depends | `error` |

Credential authentication failures must not reveal the internal credential state to callers. Missing, malformed, mismatched, revoked, disabled, or expired API Keys all return `401 invalid_api_key`; missing, malformed, mismatched, revoked, disabled, or expired App Tokens all return `403 invalid_app_token`. Implementations may keep an internal reason for logs/metrics, but raw credentials, Authorization headers, App Token headers, and credential hashes must not be emitted in responses, logs, metrics, cache entries, or fixtures.

If existing code cannot store `status=rate_limited` yet, it may store `status=error` with `errorCode=rate_limited` during migration. New v1 work should use first-class `rate_limited`.

## 6. ActiveRuntimeConfig Contract

Canonical artifacts:

```text
docs/v1.0.0/schemas/runtime-config.schema.json
docs/v1.0.0/fixtures/runtime-config.fixture.json
```

Required fields:

```text
configVersion
configHash
tenantId
tenantStatus
projectId
projectStatus
applicationId
applicationStatus
apiKeyId
apiKeyStatus
appTokenId
appTokenStatus
providers[]
models[]
defaultProvider
defaultModel
lowCostProvider
lowCostModel
fallbackProvider
fallbackModel
rateLimit
safetyPolicy
cachePolicy
routingPolicy
pricingRules[]
```

Minimal rate limit config:

```json
{
  "enabled": true,
  "scope": "application",
  "algorithm": "fixed_window",
  "windowSeconds": 60,
  "limit": 60
}
```

Minimal routing config:

```json
{
  "type": "simple",
  "autoModel": "auto",
  "defaultProvider": "mock",
  "defaultModel": "mock-balanced",
  "lowCostProvider": "mock",
  "lowCostModel": "mock-fast",
  "shortPromptMaxChars": 500,
  "routingPolicyHash": "hash_..."
}
```

Minimal cache config:

```json
{
  "enabled": true,
  "type": "exact",
  "ttlSeconds": 3600
}
```

Execution rules:

- Credential Lifecycle v1 source of truth is this section plus `docs/v1.0.0/fixtures/credential-lifecycle.fixture.json` and `docs/v1.0.0/schemas/credential-lifecycle.schema.json`.
- Raw API Key and raw App Token values must never be stored, logged, emitted in list/detail responses, metrics, cache entries, GatewayContext, or Invocation Logs.
- Issue and rotate responses are the only places where plaintext credentials may be returned, and only once with `plaintextShownOnce=true`.
- `secretHash` means `sha256(trim_utf8(plaintext))`. `secretHash` is the logical API/contract field; physical DB columns may be named `key_hash`, `token_hash`, or `secretHash` depending on the service.
- Credential issue binding is resolved from route parameters plus DB lookup, never from untrusted request body context fields. API Keys bind from `projectId`; App Tokens bind from `applicationId`.
- Credential rotation is allowed only when `status=active && (expiresAt=null || expiresAt>now)`. Revoked, disabled, expired, or already-expired active credentials fail with `409 conflict`.
- Credential revoke is a final disposal command and may target active, disabled, expired, or already revoked credentials. If the target is already revoked, Control Plane must not update DB state and must return the existing `revokedAt`.
- Gateway external credential errors must hide internal credential state. API Key problems return `401 invalid_api_key`; App Token problems return `403 invalid_app_token`.
- Gateway consumes only an active published runtime config. `publishState=active` and active tenant/project/application/key/token status are required for the hot path.
- Draft, superseded, rolled back, disabled, revoked, or missing runtime config must not be silently executed.
- Gateway may use a fixture/static `RuntimeConfigProvider` during the first implementation PR, but the interface boundary must match this contract.
- Runtime config must not contain raw API Key, raw App Token, raw Provider Key, Authorization header, raw prompt, or raw response.
- Provider credentials are referenced by `secretRef` and optional `credentialPreview` only. Gateway resolves provider credentials through the configured resolver/adapter and must not copy raw provider credentials into `GatewayContext`, logs, metrics, cache, or fixtures.
- `configHash`, `securityPolicyHash`, and `routingPolicyHash` are runtime provenance values. They must be copied into `GatewayContext.runtime` and stored in Invocation Log `metadata.runtime`.
- If runtime config fetch or provider secret resolution fails before a safe fallback is selected, Gateway fails closed before provider call with `status=error`, `httpStatus=500`, `errorCode=internal_error`, and the relevant `errorStage`.

## 7. GatewayContext Contract

Gateway stages share one in-memory context.

Required groups:

```text
request:
  requestId, traceId, startedAt, endpoint, method, source, stream, requestBodyHash

identity:
  tenantId, projectId, applicationId, apiKeyId, appTokenId, endUserId, featureId

runtime:
  configHash, securityPolicyHash, routingPolicyHash

governance:
  rateLimitDecision

safety:
  maskingAction, maskingDetectedTypes, maskingDetectedCount, redactedPromptPreview, promptHash

routing:
  requestedProvider, requestedModel, selectedProvider, selectedModel, routingReason

cache:
  cacheStatus, cacheType, cacheKeyHash, cacheHitRequestId

usage:
  promptTokens, completionTokens, totalTokens, costMicroUsd, savedCostMicroUsd

latency:
  latencyMs, providerLatencyMs

status:
  status, httpStatus, errorCode, errorMessage, errorStage

time:
  completedAt
```

The canonical JSON Schema for the terminal GatewayContext snapshot and its fixture wrapper is `docs/v1.0.0/schemas/gateway-context.schema.json`. The canonical fixture example is `docs/v1.0.0/fixtures/gateway-context.fixture.json`.

The schema accepts the fixture wrapper and the nested `gatewayContext` object. The nested context describes the terminal snapshot handed to `InvocationLogWriter`. In-progress stage implementations may use typed optional fields internally, but the writer input must include the required groups and keys; values for stages that did not run may be `null`.

MUST NOT store in GatewayContext:

```text
raw API Key
raw App Token
Provider Key
Authorization header
Cookie
raw provider error body
raw detected sensitive value
```

## 8. Pipeline Order

Gateway chat completion order:

```text
receive_request
-> assign_request_id
-> enforce_body_limit
-> parse_openai_compatible_payload
-> validate_text_only_request
-> authenticate_api_key
-> validate_app_token
-> resolve_tenant_project_application
-> load_active_runtime_config
-> check_rate_limit
-> evaluate_safety
-> mask_or_block
-> decide_model_route
-> build_exact_cache_key
-> exact_cache_lookup
-> resolve_provider
-> call_provider_with_timeout
-> compute_usage_cost_latency
-> write_cache_if_eligible
-> build_client_response
-> write_invocation_log
-> record_metrics
```

Rules:

- Auth, scope, rate limit, and block failures stop before cache/provider.
- Safety happens before routing/cache/provider.
- Routing happens before cache key build.
- Cache hit stops before provider.
- Cache lookup/decode failure is fail-open to provider with `cacheStatus=error`.

## 9. Rate Limit Contract

```text
scope: applicationId
algorithm: fixed_window
window: 60 seconds
storage: PostgreSQL
```

Decision fields:

```text
allowed
scope
scopeId
limit
remaining
windowSeconds
windowStart
resetAt
retryAfterSeconds
reason
durationMs
```

Allowed reasons:

```text
within_limit
limit_exceeded
rate_limit_disabled
config_missing
internal_error
```

PostgreSQL implementation must be atomic under concurrent requests.

Recommended counter key:

```text
tenantId + applicationId + windowStart
```

Ownership boundary:

- Control Plane owns rate limit configuration in `ActiveRuntimeConfig.rateLimit`.
- Gateway owns the PostgreSQL counter table and atomic check-and-increment execution.
- Observability consumes `rateLimitDecision` and terminal status for logs, dashboard, metrics, and k6 interpretation.

Execution rules:

- `enabled=false` allows the request, does not increment a counter, and records reason `rate_limit_disabled`.
- Missing required rate limit config after active runtime config load is a fail-closed governance error, not an implicit unlimited mode.
- PostgreSQL counter errors fail closed before cache/provider with `status=error`, `httpStatus=500`, `errorCode=internal_error`, `errorStage=check_rate_limit`, and `rateLimitDecision.reason=internal_error` when a decision object can be produced.
- Limit exceeded fails before safety/cache/provider with first-class terminal `status=rate_limited`.

Rate-limited response:

```text
HTTP 429
errorCode=rate_limited
cacheStatus=bypass
cacheType=none
providerLatencyMs=null
costMicroUsd=0
Provider called: no
```

## 10. Safety Contract

v1 main path uses rule-based detection.

| Detector type | Action | Placeholder |
|---|---|---|
| `email` | redact | `[EMAIL_REDACTED]` |
| `phone_number` | redact | `[PHONE_NUMBER_REDACTED]` |
| `resident_registration_number` | block | `[RESIDENT_REGISTRATION_NUMBER_REDACTED]` |
| `api_key` | block | `[API_KEY_REDACTED]` |
| `authorization_header` | block | `[AUTHORIZATION_HEADER_REDACTED]` |
| `jwt` | block | `[JWT_REDACTED]` |
| `private_key` | block | `[SECRET_REDACTED]` |

SafetyDecision:

```text
action: none | redacted | blocked
detectedTypes[]
detectedCount
redactedPromptPreview
blockReason
securityPolicyHash
```

RemoteSafetyEngine:

- disabled by default.
- may run in shadow/evaluation mode.
- must not decide v1 production blocking unless contract is changed.
- failure must not break v1 smoke.

## 11. Routing and Cache Contract

Routing must distinguish:

```text
requestedProvider
requestedModel
selectedProvider
selectedModel
routingReason
```

Default simple routing:

```text
requestedModel != "auto" -> pinned
model=auto and short prompt -> short_prompt_low_cost
model=auto otherwise -> default_model
```

Cache values:

```text
cacheStatus: hit | miss | bypass | error
cacheType: none | exact
```

Cache key material must include:

```text
tenantId
projectId
applicationId
selectedProvider
selectedModel
normalizedRedactedPrompt
securityPolicyHash
routingPolicyHash
```

Cache key material must not include raw prompt or credentials.

Cache hit:

```text
status=cache_hit
httpStatus=200
providerLatencyMs=null
totalTokens=0
costMicroUsd=0
Provider called: no
```

## 12. Invocation Log Contract

Allowed terminal status:

```text
success
cache_hit
blocked
rate_limited
error
cancelled
```

Required log fields:

```text
requestId, traceId
tenantId, projectId, applicationId, apiKeyId, appTokenId
endUserId, featureId
endpoint, method, source, stream
requestBodyHash, promptHash, redactedPromptPreview
requestedProvider, requestedModel, selectedProvider, selectedModel, routingReason
cacheStatus, cacheType, cacheKeyHash, cacheHitRequestId
maskingAction, maskingDetectedTypes, maskingDetectedCount
rateLimitDecision
promptTokens, completionTokens, totalTokens
costMicroUsd, savedCostMicroUsd
latencyMs, providerLatencyMs
status, httpStatus, errorCode, errorMessage, errorStage
createdAt, completedAt
metadata
```

### 12.1 GatewayContext -> Invocation Log Mapping

`GatewayContext` is the in-memory request context used by Gateway stages. Invocation Log is the terminal record written after request handling finishes.

| GatewayContext field | Producer | Invocation Log storage |
|---|---|---|
| `request.requestId`, `request.traceId` | `assign_request_id` | `requestId`, `traceId` |
| `request.startedAt` | `receive_request` | `createdAt` |
| `time.completedAt` | terminal response/log stage | `completedAt` |
| `request.endpoint`, `request.method`, `request.source`, `request.stream` | HTTP receive / request classification | `endpoint`, `method`, `source`, `stream` |
| `request.requestBodyHash` | `parse_openai_compatible_payload` after normalized JSON parse | `requestBodyHash` |
| `identity.*` | auth, app token validation, context resolver | matching identity fields |
| `runtime.configHash` | `load_active_runtime_config` / `RuntimeConfigProvider` | `metadata.runtime.configHash` |
| `runtime.securityPolicyHash` | `evaluate_safety` from active safety policy | `metadata.runtime.securityPolicyHash` |
| `runtime.routingPolicyHash` | `load_active_runtime_config` or `decide_model_route` | `metadata.runtime.routingPolicyHash` |
| `governance.rateLimitDecision` | `check_rate_limit` | `rateLimitDecision` |
| `safety.promptHash` | `evaluate_safety` / `mask_or_block` using the normalized redacted prompt | `promptHash` |
| `safety.redactedPromptPreview` | `mask_or_block` | `redactedPromptPreview` |
| `safety.maskingAction`, `safety.maskingDetectedTypes`, `safety.maskingDetectedCount` | `evaluate_safety` / `mask_or_block` | matching masking fields |
| `routing.*` | `decide_model_route` | matching routing fields |
| `cache.*` | `build_exact_cache_key`, `exact_cache_lookup` | matching cache fields |
| `usage.*` | `compute_usage_cost_latency`, cache hit handling | matching usage fields |
| `latency.*` | pipeline timing / provider adapter timing | matching latency fields |
| `status.*` | terminal stage or failing stage | matching status/error fields |

`startedAt` MUST be stored as Invocation Log `createdAt`. `completedAt` MUST be stored as Invocation Log `completedAt`.

`requestBodyHash` is produced from the normalized request body, never from raw credentials. `promptHash` is produced from the normalized redacted prompt. `redactedPromptPreview` is produced only after safety redaction. `configHash`, `securityPolicyHash`, and `routingPolicyHash` are runtime provenance values and MUST be stored under Invocation Log `metadata.runtime`.

`InvocationLogWriter` serializes terminal outcomes already present in `GatewayContext`. It MUST NOT invent or infer stage outcomes that are missing from `GatewayContext`.

Required Invocation Log fields are required as keys. Values produced by stages that did not run MAY be `null`. Pre-cache terminal outcomes MUST use `cacheStatus=bypass` and `cacheType=none`. The failing or terminal stage MUST set `status`, `httpStatus`, `errorCode`, and `errorStage`.

This mapping MUST NOT store raw prompt, raw response, raw API Key, raw App Token, raw Provider Key, Authorization header, or raw detected sensitive values.

PostgreSQL is the v1 canonical source. Existing `p0_llm_invocation_logs` may be reused only if migration notes document the v1 mapping.

Auth failure logging:

- Auth failures before tenant/project/application context is known may be written to a sanitized auth failure log path instead of the default invocation log path.
- If an auth failure is written into the invocation log table, unavailable identity fields must be `null`; `InvocationLogWriter` must not guess tenant/project/application from raw credentials.
- Default Dashboard Overview excludes unauthenticated auth failures unless a later contract explicitly adds an auth/security view.
- Raw Authorization header, API Key, App Token, credential hash, and plaintext credential must not be stored in auth failure logs.

MUST NOT create/store:

```text
raw_prompt
raw_response
api_key_plaintext
app_token_plaintext
provider_api_key
authorization_header
raw_provider_error_body
```

## 13. Dashboard and Detail Contract

Request Log list item must include:

```text
requestId
projectId
applicationId
status
httpStatus
requestedModel
selectedProvider
selectedModel
cacheStatus
cacheType
maskingAction
routingReason
totalTokens
costMicroUsd
costUsd
latencyMs
createdAt
```

Request Detail must group:

```text
identity
request
status
usage
cost
latency
rateLimit
safety
routing
cache
provider
error
timestamps
```

Dashboard Overview must include:

```text
totalRequests
successfulRequests
failedRequests
blockedRequests
rateLimitedRequests
cacheHitRequests
cacheEligibleRequests
cacheHitRate
promptTokens
completionTokens
totalTokens
totalCostMicroUsd
totalCostUsd
savedCostMicroUsd
savedCostUsd
averageLatencyMs
p95LatencyMs
maskingActionCounts
routingCountByModel
statusCounts
costByModel
dataFreshness
```

`blocked` and `rate_limited` are policy outcomes, not product failures.

Fixture files may include `requestIds` for cross-checking Request Log and Dashboard consistency. Production Dashboard Overview API does not need to expose `requestIds` by default.

## 14. Metrics Contract

Gateway exposes:

```text
GET /metrics
```

Required metrics:

```text
gatelm_gateway_requests_total
gatelm_gateway_request_duration_seconds
gatelm_gateway_inflight_requests
gatelm_provider_requests_total
gatelm_provider_request_duration_seconds
gatelm_cache_operations_total
gatelm_rate_limit_decisions_total
gatelm_rate_limit_decision_duration_seconds
gatelm_masking_actions_total
gatelm_log_writes_total
gatelm_log_write_duration_seconds
```

Allowed labels:

```text
endpoint
method
status
http_status
error_code
cache_status
cache_type
masking_action
rate_limit_allowed
selected_provider
selected_model
operation
```

Forbidden labels:

```text
request_id
trace_id
tenant_id
project_id
application_id
api_key_id
app_token_id
end_user_id
feature_id
prompt
prompt_hash
cache_key_hash
authorization
```

## 15. BDD Test Contract

Acceptance and integration tests should use Given/When/Then structure. No new BDD framework is required.

Pattern:

```text
Given <initial state>
When <action>
Then <observable outcome>
And <security/side-effect assertion>
```

Required examples:

```text
Given valid API Key and App Token
When customer app sends a safe chat completion request
Then Gateway returns 200
And Request Log stores status=success
```

```text
Given the same safe request was cached
When customer app sends the request again
Then Gateway returns cacheStatus=hit
And provider call count does not increase
```

```text
Given an application has exceeded its rate limit
When customer app sends another request
Then Gateway returns 429 rate_limited
And provider call count does not increase
```

## 16. v1 Smoke Contract

Final smoke must verify:

```text
healthz
readyz
metrics
models
valid safe request -> 200 success
same safe request -> 200 cache_hit
invalid API Key -> 401 invalid_api_key
invalid App Token -> 403 invalid_app_token
scope mismatch -> 403 scope_mismatch
rate limit exceeded -> 429 rate_limited
email/phone request -> 200 redacted
credential/JWT/RRN/private key request -> 403 sensitive_data_blocked
model=auto -> selectedProvider/selectedModel/routingReason
requestId -> Request Log
requestId -> Request Detail
Dashboard Overview count matches Request Log
Metrics expose request/cache/masking/rate limit/latency counters
```

Smoke must assert:

```text
no raw prompt in logs/detail/dashboard
no raw response in logs/detail/dashboard
no API Key/App Token/Provider Key plaintext
cache hit does not call provider
blocked/rate_limited requests do not call provider
Python/FastAPI safety service disabled still passes v1 smoke
```

## 17. Contract Change Process

Any contract change must answer:

```text
What changes?
Why is it needed?
Which owner produces it?
Which owners consume it?
API changed?
DB changed?
Event/log changed?
Metrics changed?
Security impact?
Migration/backfill needed?
Smoke scenario changed?
Backward compatible?
```

## 18. JSON Contract Artifacts

Canonical v1 contract artifacts live under `docs/v1.0.0`:

| Directory | Purpose |
|---|---|
| `docs/v1.0.0/fixtures/` | Concrete examples used by demo, smoke, UI, and aggregation checks |
| `docs/v1.0.0/schemas/` | JSON Schema files that define fixture or payload shape |
| `docs/v1.0.0/checks/` | Optional checklists or smoke notes when they are added |

`packages/contracts` is reserved for implementation-importable shared contract code after a contract is frozen. v1 freeze fixtures and schemas must not be duplicated under `packages/contracts/examples`.

Schemas define shape and allowed values. Fixtures provide representative examples. A fixture may be updated to add a new scenario only after the corresponding schema/contract change is agreed.

Frozen v1 artifacts:

```text
fixtures/runtime-config.fixture.json
fixtures/gateway-context.fixture.json
fixtures/invocation-log.fixture.json
fixtures/dashboard-overview.fixture.json
fixtures/safety-eval-corpus.jsonl
fixtures/credential-lifecycle.fixture.json
fixtures/control-plane-admin-api.fixture.json
schemas/runtime-config.schema.json
schemas/gateway-context.schema.json
schemas/safety-eval-corpus.schema.json
schemas/credential-lifecycle.schema.json
schemas/control-plane-admin-api.schema.json
```
