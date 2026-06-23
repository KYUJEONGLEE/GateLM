# GateLM LLM Request Log Schema

## 문서 목적

이 문서는 GateLM의 LLM 요청 로그 스키마를 정의한다.

이 문서는 다음 작업의 기준이다.

- Gateway usage/log event payload 작성
- Worker event consume 및 ClickHouse 저장
- Request Log 목록 조회
- Request Detail Drawer 조회
- Dashboard 비용/토큰/지연시간/오류율/캐시 적중률 집계
- 장애 추적, fallback 추적, masking 추적
- API 응답 DTO와 analytics query 작성
- AI 코딩 도구가 로그 필드를 임의로 추가하거나 raw prompt를 저장하지 못하게 하는 기준

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. 로그 스키마도 MVP 화면만 맞추는 방식이 아니라 Provider, Model, Tenant 규모, Application, 정책, 배포 방식, 분석 지표가 늘어나도 깨지지 않도록 설계한다.

---

# 0. 최상위 원칙

## 0.1 확장 가능성은 기본값이다

로그 스키마는 아래 전제를 따른다.

- Provider와 Model은 enum으로 닫지 않는다.
- Status, errorCode, cacheStatus, routingReason은 최소 표준값을 두되 새 값 추가가 가능해야 한다.
- 핵심 필드는 top-level에 둔다.
- 실험적 필드나 provider-specific 필드는 `metadata`에 둔다.
- `metadata`에 핵심 비용/토큰/상태 필드를 숨기지 않는다.
- 새 로그 필드가 필요하면 먼저 이 문서를 수정한다.
- Dashboard, API, Worker, ClickHouse DDL은 이 문서와 `db-schema.md`를 함께 따른다.
- 민감정보 detector type, masking action, 저장 금지 field는 `pii-masking-policy.md`를 함께 따른다.

## 0.2 원문 저장 최소화

민감정보 detector, redaction, sampleHash, 저장 전/Provider 호출 전 마스킹 기준은 `pii-masking-policy.md`를 따른다.

LLM 로그에는 기본적으로 raw prompt와 raw response를 저장하지 않는다.

저장 가능한 payload는 아래로 제한한다.

- `redactedPrompt`
- `responseSummary`
- `promptHash`
- `responseHash`
- token/cost/latency/cache/routing/masking metadata
- masking metadata defined in `pii-masking-policy.md`
- sanitized error message
- payload reference

저장 금지 데이터:

- raw prompt
- raw response
- Provider API Key 원문
- GateLM API Key 원문
- App Token 원문
- Authorization header 원문
- Cookie 원문
- 외부 Provider raw error body 전체
- 마스킹 전 개인정보 sample
- 탐지 원본값 또는 match sample

원문 저장이 필요한 경우에는 고객사 tenant policy에서 명시적으로 허용해야 하며, 별도 암호화, 접근 제어, retention 정책을 둔다. MVP 기본값은 저장 금지다.

민감정보 detector/action/replacement/sampleHash 기준은 `pii-masking-policy.md`를 따른다.

## 0.3 응답 경로와 분석 경로를 분리한다

Gateway는 사용자 응답을 만들기 위해 필요한 최소 metadata를 request context에 모은다.

장기 저장은 Gateway가 직접 하지 않는다.

```text
Gateway RequestContext
-> Redpanda usage/log event
-> Worker
-> ClickHouse / PostgreSQL / S3-compatible Object Storage
-> Dashboard / Log API
```

Gateway가 ClickHouse에 직접 write하면 안 된다. event publish 실패는 사용자 응답을 실패시키지 않는 것이 기본이다. 단, metric과 technical log에는 반드시 남긴다.

## 0.4 단일 requestId로 끝까지 추적한다

하나의 사용자 요청은 하나의 `requestId`를 가진다.

`requestId`는 아래 위치에 모두 포함된다.

- Gateway response header
- Gateway response body의 `gate_lm.requestId`
- Redpanda event
- ClickHouse `llm_invocations`
- Provider attempt log
- cache/routing/masking event
- Request Log 목록
- Request Detail Drawer
- technical structured log

Provider가 반환한 `id`와 GateLM `requestId`를 섞지 않는다.

## 0.5 로그는 append-only가 기본이다

LLM invocation log는 감사와 분석의 기준 데이터다.

- 이미 저장된 log row를 일반 update로 수정하지 않는다.
- 보정이 필요하면 correction event 또는 재집계 ledger로 처리한다.
- retention 만료, tenant purge, 법적 삭제 요청은 별도 삭제 정책을 따른다.
- 비용 ledger와 분석 log가 다르면 reconciliation job에서 차이를 기록한다.

---

# 1. 스키마 범위

## 1.1 Canonical Log Entity

기본 엔티티는 `LlmRequestLog`다.

`LlmRequestLog`는 **Gateway 요청 1건당 1개** 생성된다.

```text
사용자 요청 1건
-> LlmRequestLog 1건
-> ProviderAttemptLog 0..N건
-> CacheEvent 0..N건
-> RoutingEvent 0..N건
-> MaskingEvent 0..N건
```

Provider를 실제로 호출하지 않는 cache hit, policy block, rate limit block도 `LlmRequestLog`를 생성한다.

## 1.2 하위 Event

하위 event는 Detail Drawer와 장애 추적에 사용한다.

| Event | 목적 | 저장소 |
|---|---|---|
| `LlmRequestLog` | 요청 1건의 최종 상태 | ClickHouse `llm_invocations` |
| `ProviderAttemptLog` | retry/fallback/provider 호출 상세 | ClickHouse `llm_provider_attempts` |
| `CacheEvent` | exact/semantic cache hit/miss/write | ClickHouse `llm_cache_events` |
| `RoutingEvent` | routing decision/fallback chain | ClickHouse `llm_routing_events` |
| `MaskingEvent` | 민감정보 탐지/마스킹/차단 | ClickHouse `llm_masking_events` |
| `UsageRollup` | Dashboard 집계 | ClickHouse `usage_daily_rollups` 또는 MV |

## 1.3 Naming 기준

| 계층 | Naming |
|---|---|
| API response | `camelCase` |
| Gateway event JSON | `camelCase` |
| TypeScript DTO | `camelCase` |
| Go struct field | `PascalCase` + json tag `camelCase` |
| Python model | `snake_case` 내부, JSON alias `camelCase` 가능 |
| ClickHouse column | `snake_case` |
| PostgreSQL column | `snake_case` |

이 문서는 API/event 기준으로 `camelCase`를 먼저 정의하고, DB mapping에서 `snake_case`를 함께 명시한다.

---

# 2. 최소 필수 필드

아래 필드는 MVP에서 반드시 있어야 한다.

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `requestId` | string | Y | GateLM Gateway request id |
| `projectId` | string | Y | 요청이 속한 project id |
| `model` | string | Y | 실제 사용된 model. cache hit/blocked면 선택된 또는 요청된 model |
| `promptTokens` | integer | Y | prompt token 수 |
| `completionTokens` | integer | Y | completion token 수 |
| `totalTokens` | integer | Y | 총 token 수 |
| `cost` | string | Y | 표시용 USD 비용. 예: `"0.000123"` |
| `costMicroUsd` | integer | Y | 저장/집계용 비용. 1 USD = 1,000,000 micro USD |
| `latencyMs` | integer | Y | 요청 전체 latency, milliseconds |
| `status` | string | Y | `success`, `error`, `blocked`, `cache_hit`, `cancelled` 등 |
| `errorMessage` | string or null | Y | sanitized error message. raw provider body 저장 금지 |
| `createdAt` | string | Y | 요청 시작 시각. ISO-8601 UTC |

주의:

- `cost`는 UI 표시용이다. 집계와 비교는 `costMicroUsd`로 한다.
- `errorMessage`는 반드시 sanitized 값이다.
- `model`은 enum으로 고정하지 않는다.
- `status`는 표준값을 두되 신규 status 추가가 가능해야 한다.

---

# 3. Canonical `LlmRequestLog` 전체 스키마

## 3.1 Identity 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `schemaVersion` | integer | Y | `schema_version` 또는 event payload | 로그 스키마 버전. MVP는 `1` |
| `requestId` | string | Y | `request_id` | GateLM request id |
| `traceId` | string | Y | `trace_id` | distributed trace id |
| `spanId` | string or null | N | `metadata` | 현재 gateway span id |
| `tenantId` | string | Y | `tenant_id` | tenant id |
| `projectId` | string | Y | `project_id` | project id |
| `applicationId` | string or null | N | `application_id` | application id |
| `userId` | string or null | N | `user_id` | end user id 또는 GateLM user id |
| `apiKeyId` | string or null | N | `api_key_id` | Gateway API Key id. 원문 key 아님 |
| `appTokenId` | string or null | N | `app_token_id` | App Token id. 원문 token 아님 |
| `sessionId` | string or null | N | `metadata` | Chat UI session id |
| `conversationId` | string or null | N | `metadata` 또는 PostgreSQL chat table | Chat conversation id |
| `parentMessageId` | string or null | N | `metadata` | Reply-to Context parent id |

`requestId` 생성 기준:

- 외부 Provider id를 재사용하지 않는다.
- 정렬 가능한 UUIDv7 또는 ULID 계열을 권장한다.
- API와 event에서는 opaque string으로 취급한다.
- 코드에서 prefix나 길이에 의존하지 않는다.

## 3.2 Request Context 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `endpoint` | string | Y | `endpoint` | Gateway endpoint. 예: `/v1/chat/completions` |
| `method` | string | Y | `metadata` | HTTP method |
| `stream` | boolean | Y | `stream` | streaming 여부 |
| `source` | string | Y | `metadata` | `customer_app`, `developer_tool`, `chat_ui`, `internal` |
| `clientType` | string or null | N | `metadata` | SDK/CLI/Web 등 |
| `clientVersion` | string or null | N | `metadata` | SDK version |
| `idempotencyKeyHash` | string or null | N | `metadata` | idempotency key hash |
| `requestBodyHash` | string | Y | `metadata` | normalized request body hash |
| `promptHash` | string | Y | `metadata` 또는 S3 index | redacted prompt 기준 hash |
| `responseHash` | string or null | N | `metadata` 또는 S3 index | redacted/normalized response hash |

`source`는 확장 가능해야 한다. enum으로 닫지 말고 validation allowlist는 Runtime Policy나 config로 관리한다.

## 3.3 Provider / Model 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `requestedProvider` | string or null | N | `requested_provider` | client가 요청한 provider |
| `requestedModel` | string or null | N | `requested_model` | client가 요청한 model |
| `provider` | string | Y | `provider` | 실제 호출 또는 cache metadata 기준 provider |
| `model` | string | Y | `model` | 실제 호출 또는 cache metadata 기준 model |
| `providerRequestId` | string or null | N | `metadata` | Provider가 반환한 request id |
| `providerResponseId` | string or null | N | `metadata` | Provider response id |
| `providerRegion` | string or null | N | `metadata` | region 또는 deployment location |
| `deploymentMode` | string | Y | `metadata` | `saas`, `hybrid`, `self_hosted` 등 |

Provider/Model 규칙:

- `provider`와 `model`은 string이다.
- `openai`, `anthropic`, `gemini`, `local` 같은 값은 예시일 뿐이다.
- Provider별 추가값은 `metadata.provider` 아래에 둔다.
- Provider credential 원문은 어떤 필드에도 넣지 않는다.

## 3.4 Token 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `promptTokens` | integer | Y | `prompt_tokens` | Provider에 전달된 prompt token 수 |
| `completionTokens` | integer | Y | `completion_tokens` | Provider completion token 수 |
| `contextTokens` | integer | Y | `context_tokens` | Reply-to Context로 추가된 token 수 |
| `totalTokens` | integer | Y | `total_tokens` | `promptTokens + completionTokens` 기준 |
| `cachedPromptTokens` | integer | N | `metadata` | Provider 또는 Gateway cache로 절감된 prompt token 수 |
| `reasoningTokens` | integer | N | `metadata` | Provider가 별도 제공하는 reasoning token 수 |
| `tokenCountSource` | string | Y | `metadata` | `provider_usage`, `gateway_estimate`, `cache_metadata`, `unknown` |

Token 계산 기준:

- Provider usage가 있으면 Provider usage를 우선한다.
- Provider usage가 없으면 Gateway tokenizer estimate를 사용하고 `tokenCountSource = "gateway_estimate"`로 남긴다.
- cache hit이면 실제 Provider token은 0일 수 있지만, 비용 절감 분석을 위해 `savedPromptTokens`, `savedCompletionTokens`를 cache event에 남긴다.
- `totalTokens`는 기본적으로 `promptTokens + completionTokens`다. `reasoningTokens`를 total에 포함할지는 provider adapter에서 명시하고 metadata에 남긴다.

## 3.5 Cost 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `cost` | string | Y | derived | UI/API 표시용 USD decimal string |
| `costMicroUsd` | integer | Y | `cost_micro_usd` | 집계 기준 비용 |
| `promptCostMicroUsd` | integer | N | `metadata` | prompt 비용 |
| `completionCostMicroUsd` | integer | N | `metadata` | completion 비용 |
| `cachedCostMicroUsd` | integer | N | `metadata` | provider-side cache 비용 |
| `savedCostMicroUsd` | integer | N | cache event | Gateway cache로 절감된 추정 비용 |
| `pricingVersionId` | string or null | N | `metadata` | 적용된 pricing config version |
| `currency` | string | Y | `metadata` | MVP는 `USD` |
| `costCalculatedAt` | string | Y | `metadata` | 비용 계산 시각 |
| `costSource` | string | Y | `metadata` | `pricing_table`, `provider_usage`, `manual_override`, `unknown` |

비용 계산 기준:

- 저장/집계는 `costMicroUsd` 정수로 한다.
- API 표시용 `cost`는 `costMicroUsd / 1_000_000`으로 만든 decimal string이다.
- JavaScript number float로 비용 집계를 하지 않는다.
- 가격표가 바뀌어도 과거 log의 비용은 재계산하지 않는다. 필요하면 correction ledger를 남긴다.

## 3.6 Latency 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `latencyMs` | integer | Y | `latency_ms` | Gateway가 요청을 받은 시점부터 client 응답 완료까지 |
| `ttftMs` | integer or null | N | `ttft_ms` | streaming first token latency |
| `providerLatencyMs` | integer or null | N | provider attempt | Provider 호출 latency |
| `queueMs` | integer or null | N | `metadata` | 내부 queue 대기 시간 |
| `policyEvalMs` | integer or null | N | `metadata` | policy 평가 시간 |
| `maskingMs` | integer or null | N | `metadata` | masking 처리 시간 |
| `cacheLookupMs` | integer or null | N | `metadata` | cache lookup 시간 |
| `routingMs` | integer or null | N | `metadata` | routing decision 시간 |
| `responseBuildMs` | integer or null | N | `metadata` | 응답 변환/빌드 시간 |

Latency 측정 기준:

```text
requestStartAt = Gateway가 HTTP request를 수신한 시각
providerStartAt = Provider 호출 직전 시각
firstTokenAt = 첫 SSE chunk 또는 첫 response byte 수신 시각
responseEndAt = client에게 응답 완료한 시각
latencyMs = responseEndAt - requestStartAt
ttftMs = firstTokenAt - requestStartAt
providerLatencyMs = providerEndAt - providerStartAt
```

차단 요청은 Provider 호출이 없으므로 `providerLatencyMs = null`이다.

## 3.7 Status / Error 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `status` | string | Y | `status` | 최종 상태 |
| `httpStatus` | integer | Y | `http_status` | client에게 반환한 HTTP status |
| `errorCode` | string or null | N | `error_code` | 표준 error code |
| `errorMessage` | string or null | Y | API derived 또는 `metadata` | sanitized error message |
| `errorMessageHash` | string or null | N | `error_message_hash` | error message hash |
| `errorStage` | string or null | N | `metadata` | 실패한 Gateway stage |
| `retryable` | boolean or null | N | `metadata` | 재시도 가능 여부 |
| `clientAborted` | boolean | Y | `metadata` | client disconnect 여부 |

표준 `status`:

| Status | 의미 |
|---|---|
| `success` | Provider 호출 또는 정상 응답 성공 |
| `cache_hit` | Gateway cache hit로 Provider 호출 생략 |
| `blocked` | 정책, 보안, quota, rate limit 등으로 사전 차단 |
| `error` | Gateway 또는 Provider 처리 실패 |
| `cancelled` | client abort 또는 server cancellation |
| `partial_success` | streaming 일부 전송 후 실패. 확장용 |

표준 `errorCode`:

| Code | HTTP | 의미 |
|---|---:|---|
| `invalid_request` | 400 | request body, endpoint, unsupported input 오류 |
| `unauthorized` | 401 | API Key 또는 token 없음/오류 |
| `forbidden` | 403 | 권한 없음 또는 policy block |
| `model_not_allowed` | 403 | 허용되지 않은 model |
| `quota_exceeded` | 402 or 429 | quota/budget 초과 |
| `rate_limited` | 429 | RPM/TPM/동시 요청 제한 초과 |
| `sensitive_data_blocked` | 403 | 민감정보 정책상 차단 |
| `provider_timeout` | 504 | provider timeout |
| `provider_error` | 502 | provider error |
| `provider_unavailable` | 503 | provider 장애 또는 circuit open |
| `gateway_error` | 500 | Gateway 내부 오류 |
| `event_publish_failed` | 200/5xx | event publish 실패. 사용자 응답은 유지될 수 있음 |
| `client_aborted` | 499 or 499-like | client disconnect |

`errorCode`도 확장 가능해야 한다. 단, 새 errorCode는 이 문서와 `api-spec.md`에 먼저 추가한다.

`errorMessage` 보안 기준:

- 사용자에게 보여도 되는 sanitized message만 저장한다.
- provider raw error body를 그대로 넣지 않는다.
- secret, prompt fragment, PII가 포함될 수 있으면 저장하지 않는다.
- 길이는 기본 512자 이하로 제한한다.
- 분석 DB에는 `errorMessageHash` 중심으로 저장하고, UI 표시가 필요한 경우 sanitized short message만 사용한다.

## 3.8 Cache 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `cacheStatus` | string | Y | `cache_status` | `hit`, `miss`, `bypass`, `error`, `write` |
| `cacheType` | string | Y | `cache_type` | `none`, `exact`, `semantic` |
| `cacheKeyHash` | string or null | N | `cache_key_hash` | cache key hash |
| `cacheScope` | string or null | N | `metadata` | tenant/project/user 등 scope |
| `similarityScore` | number or null | N | cache event | semantic cache score |
| `cacheHitRequestId` | string or null | N | `metadata` | hit된 원본 request id |
| `savedLatencyMs` | integer or null | N | cache event | 절감 추정 latency |
| `savedCostMicroUsd` | integer or null | N | cache event | 절감 추정 비용 |

Cache 기준:

- cache key에 raw prompt를 넣지 않는다.
- redacted prompt hash와 policy/model/context hash를 조합한다.
- Reply-to Context가 있으면 parent message hash를 포함한다.
- cache hit도 `LlmRequestLog`를 생성한다.
- cache hit도 비용 절감 Dashboard를 위해 cache event를 생성한다.

## 3.9 Routing 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `routingRuleId` | string or null | N | `routing_rule_id` | 적용된 routing rule id |
| `routingPolicyVersionId` | string or null | N | `routing_policy_version_id` | routing policy version |
| `routingReason` | string or null | N | routing event | `low_cost`, `policy`, `fallback`, `default` 등 |
| `fallbackCount` | integer | Y | `fallback_count` | fallback 횟수 |
| `fallbackChain` | array | N | routing event JSON | fallback provider/model chain |
| `selectedProvider` | string | Y | routing event | 최종 provider |
| `selectedModel` | string | Y | routing event | 최종 model |

Routing 기준:

- requested model과 selected model을 구분한다.
- fallback이 발생하면 attempt log와 routing event 양쪽에서 추적 가능해야 한다.
- routing reason은 확장 가능해야 한다.
- 정책 ID와 policy version을 남겨야 나중에 왜 그 모델이 선택됐는지 설명할 수 있다.

## 3.10 Masking / Security 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `maskingAction` | string | Y | `masking_action` | API 표시값은 `none`, `redacted`, `blocked`. 내부 event action은 `allow`, `redact`, `block` |
| `maskingDetectedTypes` | array[string] | Y | `masking_detected_types` | 탐지 유형 목록 |
| `maskingDetectedCount` | integer | Y | `masking_detected_count` | 탐지 건수 |
| `securityPolicyVersionId` | string or null | N | `security_policy_version_id` | 적용 security policy version |
| `redactedPromptRef` | string or null | N | `redacted_prompt_ref` | redacted prompt S3 ref |
| `responseSummaryRef` | string or null | N | `response_summary_ref` | response summary S3 ref |
| `redactedPromptPreview` | string or null | N | API only | UI preview. 길이 제한 |
| `responseSummary` | string or null | N | API only | UI summary. 길이 제한 |

Masking 기준:

- 마스킹 전 원문 sample을 저장하지 않는다.
- 탐지 sample은 `pii-masking-policy.md`의 HMAC 기반 `sampleHash`로만 저장한다.
- Detail Drawer에는 필요한 경우 redacted preview만 보여준다.
- `maskingAction = "blocked"` 또는 내부 action `block`이면 Provider 호출을 하지 않는다.

## 3.11 Time 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `createdAt` | string | Y | `event_time` | 요청 시작 시각. ISO-8601 UTC |
| `completedAt` | string or null | N | `metadata` | 요청 완료 시각 |
| `ingestedAt` | string | Y | `ingested_at` | Worker 저장 시각 |
| `updatedAt` | string or null | N | PostgreSQL mirror only | append-only ClickHouse log에서는 기본 null |
| `eventDate` | string | Y | `event_date` | partition용 date |

시간 기준:

- 모든 시간은 UTC로 저장한다.
- API response도 ISO-8601 UTC를 사용한다.
- Dashboard에서만 사용자 timezone으로 변환한다.
- `createdAt`은 요청 시작 시각이다.
- `ingestedAt`은 Worker가 저장한 시각이다.
- ClickHouse invocation log는 update하지 않으므로 `updatedAt`은 기본 사용하지 않는다.

## 3.12 Metadata 필드

| Field | Type | Required | DB Column | 설명 |
|---|---:|---:|---|---|
| `metadata` | object | Y | `metadata` JSON string | 확장 필드 |

`metadata` 허용 예시:

```json
{
  "gatewayVersion": "0.1.0",
  "route": {
    "strategy": "cost_aware",
    "reason": "low_cost"
  },
  "provider": {
    "apiVersion": "2026-06-01"
  },
  "policy": {
    "rateLimitRuleId": "...",
    "budgetPolicyId": "..."
  },
  "client": {
    "sdk": "gatelm-js",
    "version": "0.1.0"
  }
}
```

`metadata` 금지:

- raw prompt
- raw response
- full request body
- full response body
- secret 원문
- authorization header
- provider raw error body

---

# 4. `LlmRequestLog` JSON 예시

## 4.1 Provider 호출 성공

```json
{
  "schemaVersion": 1,
  "requestId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f001",
  "traceId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f002",
  "tenantId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f010",
  "projectId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f020",
  "applicationId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f030",
  "userId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f040",
  "apiKeyId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f050",
  "appTokenId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f060",
  "endpoint": "/v1/chat/completions",
  "method": "POST",
  "stream": false,
  "source": "customer_app",
  "requestedProvider": null,
  "requestedModel": "gpt-4o-mini",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "promptTokens": 120,
  "completionTokens": 80,
  "contextTokens": 0,
  "totalTokens": 200,
  "tokenCountSource": "provider_usage",
  "cost": "0.000034",
  "costMicroUsd": 34,
  "currency": "USD",
  "latencyMs": 842,
  "ttftMs": null,
  "status": "success",
  "httpStatus": 200,
  "errorCode": null,
  "errorMessage": null,
  "errorMessageHash": null,
  "cacheStatus": "miss",
  "cacheType": "exact",
  "cacheKeyHash": "sha256:...",
  "routingRuleId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f070",
  "routingPolicyVersionId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f080",
  "routingReason": "default",
  "fallbackCount": 0,
  "maskingAction": "none",
  "maskingDetectedTypes": [],
  "maskingDetectedCount": 0,
  "securityPolicyVersionId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f090",
  "redactedPromptRef": "s3://gatelm-payloads/tenants/.../redacted_prompt.json",
  "responseSummaryRef": "s3://gatelm-payloads/tenants/.../response_summary.json",
  "createdAt": "2026-06-22T07:30:00.123Z",
  "completedAt": "2026-06-22T07:30:00.965Z",
  "ingestedAt": "2026-06-22T07:30:01.210Z",
  "metadata": {
    "gatewayVersion": "0.1.0"
  }
}
```

## 4.2 Cache Hit

```json
{
  "schemaVersion": 1,
  "requestId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f101",
  "traceId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f102",
  "tenantId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f010",
  "projectId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f020",
  "applicationId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f030",
  "userId": null,
  "apiKeyId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f050",
  "appTokenId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f060",
  "endpoint": "/v1/chat/completions",
  "method": "POST",
  "stream": false,
  "source": "customer_app",
  "requestedProvider": null,
  "requestedModel": "gpt-4o-mini",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "promptTokens": 0,
  "completionTokens": 0,
  "contextTokens": 0,
  "totalTokens": 0,
  "tokenCountSource": "cache_metadata",
  "cost": "0.000000",
  "costMicroUsd": 0,
  "currency": "USD",
  "latencyMs": 32,
  "ttftMs": null,
  "status": "cache_hit",
  "httpStatus": 200,
  "errorCode": null,
  "errorMessage": null,
  "errorMessageHash": null,
  "cacheStatus": "hit",
  "cacheType": "exact",
  "cacheKeyHash": "sha256:...",
  "routingRuleId": null,
  "routingPolicyVersionId": null,
  "routingReason": null,
  "fallbackCount": 0,
  "maskingAction": "none",
  "maskingDetectedTypes": [],
  "maskingDetectedCount": 0,
  "securityPolicyVersionId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f090",
  "redactedPromptRef": "s3://gatelm-payloads/tenants/.../redacted_prompt.json",
  "responseSummaryRef": "s3://gatelm-payloads/tenants/.../response_summary.json",
  "createdAt": "2026-06-22T07:31:00.123Z",
  "completedAt": "2026-06-22T07:31:00.155Z",
  "ingestedAt": "2026-06-22T07:31:00.330Z",
  "metadata": {
    "cacheHitRequestId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f001",
    "savedCostMicroUsd": 34,
    "savedLatencyMs": 810
  }
}
```

## 4.3 Policy Block / Sensitive Data Block

```json
{
  "schemaVersion": 1,
  "requestId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f201",
  "traceId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f202",
  "tenantId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f010",
  "projectId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f020",
  "applicationId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f030",
  "userId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f040",
  "apiKeyId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f050",
  "appTokenId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f060",
  "endpoint": "/v1/chat/completions",
  "method": "POST",
  "stream": false,
  "source": "chat_ui",
  "requestedProvider": null,
  "requestedModel": "gpt-4o-mini",
  "provider": "",
  "model": "gpt-4o-mini",
  "promptTokens": 0,
  "completionTokens": 0,
  "contextTokens": 0,
  "totalTokens": 0,
  "tokenCountSource": "unknown",
  "cost": "0.000000",
  "costMicroUsd": 0,
  "currency": "USD",
  "latencyMs": 18,
  "ttftMs": null,
  "status": "blocked",
  "httpStatus": 403,
  "errorCode": "sensitive_data_blocked",
  "errorMessage": "Request blocked by sensitive data policy.",
  "errorMessageHash": "sha256:...",
  "cacheStatus": "bypass",
  "cacheType": "none",
  "cacheKeyHash": null,
  "routingRuleId": null,
  "routingPolicyVersionId": null,
  "routingReason": null,
  "fallbackCount": 0,
  "maskingAction": "blocked",
  "maskingDetectedTypes": ["email", "api_key"],
  "maskingDetectedCount": 2,
  "securityPolicyVersionId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f090",
  "redactedPromptRef": null,
  "responseSummaryRef": null,
  "createdAt": "2026-06-22T07:32:00.123Z",
  "completedAt": "2026-06-22T07:32:00.141Z",
  "ingestedAt": "2026-06-22T07:32:00.300Z",
  "metadata": {
    "blockedStage": "mask_or_block"
  }
}
```

---

# 5. Event Payload 계약

## 5.1 Terminal Invocation Event

Gateway가 요청 종료 시 Redpanda에 발행하는 terminal event다.

Event name은 MVP 기준 아래 중 하나를 사용한다.

| Event Type | 설명 |
|---|---|
| `invocation.completed` | 성공 또는 cache hit |
| `invocation.failed` | Gateway/Provider 오류 |
| `invocation.blocked` | policy/rate limit/quota/security 차단 |
| `invocation.cancelled` | client abort/cancel |

Payload는 `LlmRequestLog` 전체 또는 그와 동등한 필드를 포함한다.

```json
{
  "eventId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4fe01",
  "eventType": "invocation.completed",
  "eventVersion": 1,
  "occurredAt": "2026-06-22T07:30:00.965Z",
  "request": {
    "schemaVersion": 1,
    "requestId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f001",
    "tenantId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f010",
    "projectId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f020",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "promptTokens": 120,
    "completionTokens": 80,
    "totalTokens": 200,
    "costMicroUsd": 34,
    "latencyMs": 842,
    "status": "success",
    "createdAt": "2026-06-22T07:30:00.123Z"
  }
}
```

## 5.2 Event Versioning

- `eventVersion`은 event envelope의 버전이다.
- `schemaVersion`은 request log schema의 버전이다.
- 필드 추가는 backward-compatible 변경으로 처리한다.
- 필드 삭제/타입 변경은 breaking change다.
- breaking change가 필요하면 새 `schemaVersion`을 만든다.
- Worker는 최소한 현재 버전과 바로 이전 버전을 처리해야 한다.

## 5.3 Event Idempotency

Worker는 event를 중복 consume할 수 있다.

따라서 저장 로직은 아래 기준을 따른다.

- `eventId`는 event 중복 처리 방지용이다.
- `requestId`는 invocation 단위 dedupe 기준이다.
- `attemptId`는 provider attempt 단위 dedupe 기준이다.
- ClickHouse는 완전한 upsert DB가 아니므로, MVP에서는 event 중복을 Worker offset/idempotency store에서 방지한다.
- 중복 저장 가능성이 있으면 rollup query에서 `requestId` 기준 dedupe 전략을 명시한다.

---

# 6. Provider Attempt Log

Provider 호출 attempt 단위 로그다.

하나의 `requestId` 아래 여러 attempt가 생길 수 있다.

```text
requestId = R1
attemptNo = 1 -> openai/gpt-4o-mini timeout
attemptNo = 2 -> anthropic/claude-... success
```

## 6.1 필드

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `requestId` | string | Y | Gateway request id |
| `attemptId` | string | Y | attempt id |
| `attemptNo` | integer | Y | 1부터 시작 |
| `tenantId` | string | Y | tenant id |
| `projectId` | string | Y | project id |
| `provider` | string | Y | 호출 provider |
| `model` | string | Y | 호출 model |
| `status` | string | Y | `success`, `error`, `timeout`, `cancelled` |
| `httpStatus` | integer | Y | provider HTTP status. 없으면 0 |
| `errorCode` | string or null | N | provider/gateway normalized code |
| `errorMessageHash` | string or null | N | sanitized error hash |
| `promptTokens` | integer | Y | attempt prompt token |
| `completionTokens` | integer | Y | attempt completion token |
| `totalTokens` | integer | Y | attempt total token |
| `costMicroUsd` | integer | Y | attempt cost |
| `latencyMs` | integer | Y | attempt latency |
| `ttftMs` | integer or null | N | first token latency |
| `isFallback` | boolean | Y | fallback attempt 여부 |
| `fallbackFromProvider` | string or null | N | fallback 이전 provider |
| `fallbackFromModel` | string or null | N | fallback 이전 model |
| `createdAt` | string | Y | attempt start time |
| `completedAt` | string or null | N | attempt end time |
| `metadata` | object | Y | 확장 metadata |

## 6.2 Attempt Status

| Status | 의미 |
|---|---|
| `success` | Provider response 성공 |
| `error` | Provider error response |
| `timeout` | Gateway timeout |
| `cancelled` | client abort 또는 circuit cancellation |
| `skipped` | policy/circuit으로 attempt 생략. 확장용 |

## 6.3 Attempt Error 처리

Provider raw error를 그대로 저장하지 않는다.

저장 가능한 값:

- normalized `errorCode`
- sanitized short `errorMessage` 또는 hash
- HTTP status
- provider request id
- retry/fallback 여부

---

# 7. Cache Event Schema

Cache event는 Exact Cache와 Semantic Cache 동작을 기록한다.

## 7.1 필드

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `requestId` | string | Y | Gateway request id |
| `tenantId` | string | Y | tenant id |
| `projectId` | string | Y | project id |
| `cacheType` | string | Y | `exact`, `semantic` |
| `cacheStatus` | string | Y | `hit`, `miss`, `write`, `bypass`, `error` |
| `cacheKeyHash` | string | Y | cache key hash |
| `cacheScope` | string | N | tenant/project/user/application 등 |
| `similarityScore` | number or null | N | semantic cache score |
| `hitRequestId` | string or null | N | hit된 원본 request id |
| `savedCostMicroUsd` | integer | Y | 절감 추정 비용 |
| `latencySavedMs` | integer | Y | 절감 추정 latency |
| `createdAt` | string | Y | event time |
| `metadata` | object | Y | 확장 metadata |

## 7.2 Cache Status

| Status | 의미 |
|---|---|
| `hit` | cache 응답 사용 |
| `miss` | cache 조회했으나 없음 |
| `write` | provider 응답 cache 저장 |
| `bypass` | 정책 또는 요청 특성상 cache 미사용 |
| `error` | cache 조회/저장 실패 |

---

# 8. Routing Event Schema

Routing event는 모델 선택과 fallback 판단을 기록한다.

## 8.1 필드

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `requestId` | string | Y | Gateway request id |
| `tenantId` | string | Y | tenant id |
| `projectId` | string | Y | project id |
| `routingRuleId` | string or null | N | routing rule id |
| `policyVersionId` | string or null | N | policy version id |
| `requestedProvider` | string or null | N | 요청 provider |
| `requestedModel` | string or null | N | 요청 model |
| `selectedProvider` | string | Y | 선택 provider |
| `selectedModel` | string | Y | 선택 model |
| `decisionReason` | string | Y | 선택 이유 |
| `fallbackChain` | array | Y | fallback chain |
| `createdAt` | string | Y | event time |
| `metadata` | object | Y | 확장 metadata |

## 8.2 Decision Reason

표준값:

- `default`
- `low_cost`
- `policy`
- `tenant_preference`
- `project_preference`
- `model_not_allowed`
- `provider_health`
- `fallback`
- `quota_aware`
- `latency_aware`

새 값 추가 가능. 단, Dashboard group-by에 영향을 주므로 문서와 query를 먼저 수정한다.

---

# 9. Masking Event Schema

Masking event는 민감정보 탐지와 처리 결과를 기록한다.

## 9.1 필드

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `requestId` | string | Y | Gateway request id |
| `tenantId` | string | Y | tenant id |
| `projectId` | string | Y | project id |
| `userId` | string or null | N | user id |
| `ruleId` | string or null | N | sensitive data rule id |
| `detectorType` | string | Y | `email`, `phone_number`, `resident_registration_number`, `api_key` 등 |
| `action` | string | Y | `allow`, `redact`, `block` |
| `detectedCount` | integer | Y | 탐지 건수 |
| `severity` | string | Y | `low`, `medium`, `high`, `critical` |
| `sampleHash` | string | Y | 탐지값 hash. 원문 저장 금지 |
| `createdAt` | string | Y | event time |
| `metadata` | object | Y | 확장 metadata |

## 9.2 Detector Type

MVP 표준값은 `pii-masking-policy.md`와 동일하게 관리한다.

- `email`
- `phone_number`
- `resident_registration_number`
- `api_key`
- `access_token`
- `private_key`
- `password`
- `account_id`
- `employee_id`
- `internal_keyword`
- `custom_regex`
- `custom_keyword`
- `unknown`

Detector type은 확장 가능하다. 새 detector 추가 시 `pii-masking-policy.md`, dashboard filter, API response DTO, tests를 함께 수정한다.

---

# 10. API Response Mapping

## 10.1 Request Log 목록 item

`GET /api/projects/:projectId/logs`의 목록 item은 아래 필드를 반환한다.

```json
{
  "requestId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f001",
  "tenantId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f010",
  "projectId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f020",
  "applicationId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f030",
  "userId": "018f6c2e-9d5a-7cc1-8b3a-3e1a43f4f040",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "promptTokens": 120,
  "completionTokens": 80,
  "totalTokens": 200,
  "cost": "0.000034",
  "costMicroUsd": 34,
  "latencyMs": 842,
  "status": "success",
  "httpStatus": 200,
  "errorCode": null,
  "errorMessage": null,
  "cacheStatus": "miss",
  "cacheType": "exact",
  "maskingAction": "none",
  "routingReason": "default",
  "createdAt": "2026-06-22T07:30:00.123Z"
}
```

목록 API에서 반환하지 않는 것:

- raw prompt
- raw response
- full redacted prompt
- full response summary
- provider raw error body
- secret 관련 값

## 10.2 Detail Drawer response

`GET /api/llm-requests/:requestId`는 목록 item보다 상세한 정보를 반환한다.

추가 가능 필드:

- `traceId`
- `requestedProvider`
- `requestedModel`
- `routingRuleId`
- `routingPolicyVersionId`
- `securityPolicyVersionId`
- `fallbackCount`
- `redactedPromptPreview`
- `responseSummary`
- `metadata`
- `attempts`
- `cacheEvents`
- `routingEvents`
- `maskingEvents`

Detail Drawer도 raw prompt/response는 기본 반환하지 않는다.

## 10.3 Dashboard aggregation mapping

| Dashboard Metric | Source Field |
|---|---|
| Total Requests | count `requestId` |
| Success Count | count where `status = success` |
| Error Count | count where `status = error` |
| Blocked Count | count where `status = blocked` |
| Cache Hit Count | count where `status = cache_hit` or `cacheStatus = hit` |
| Total Tokens | sum `totalTokens` |
| Prompt Tokens | sum `promptTokens` |
| Completion Tokens | sum `completionTokens` |
| Total Cost | sum `costMicroUsd` |
| Avg Latency | avg `latencyMs` |
| P95 Latency | p95 `latencyMs` |
| Avg TTFT | avg `ttftMs` |
| Provider Cost | group by `provider` |
| Model Cost | group by `model` |
| Masking Count | sum `maskingDetectedCount` |
| Fallback Count | sum `fallbackCount` |

---

# 11. ClickHouse Mapping

`db-schema.md`의 ClickHouse 상세 스키마가 실제 DDL 기준이다. 이 문서는 API/event logical schema와 mapping을 고정한다.

## 11.1 `llm_invocations` mapping

| API/Event Field | ClickHouse Column |
|---|---|
| `createdAt` | `event_time` |
| `requestId` | `request_id` |
| `traceId` | `trace_id` |
| `tenantId` | `tenant_id` |
| `projectId` | `project_id` |
| `applicationId` | `application_id` |
| `userId` | `user_id` |
| `apiKeyId` | `api_key_id` |
| `appTokenId` | `app_token_id` |
| `endpoint` | `endpoint` |
| `stream` | `stream` |
| `requestedProvider` | `requested_provider` |
| `requestedModel` | `requested_model` |
| `provider` | `provider` |
| `model` | `model` |
| `status` | `status` |
| `httpStatus` | `http_status` |
| `errorCode` | `error_code` |
| `errorMessageHash` | `error_message_hash` |
| `promptTokens` | `prompt_tokens` |
| `completionTokens` | `completion_tokens` |
| `contextTokens` | `context_tokens` |
| `totalTokens` | `total_tokens` |
| `costMicroUsd` | `cost_micro_usd` |
| `latencyMs` | `latency_ms` |
| `ttftMs` | `ttft_ms` |
| `cacheStatus` | `cache_status` |
| `cacheType` | `cache_type` |
| `cacheKeyHash` | `cache_key_hash` |
| `routingRuleId` | `routing_rule_id` |
| `routingPolicyVersionId` | `routing_policy_version_id` |
| `securityPolicyVersionId` | `security_policy_version_id` |
| `maskingAction` | `masking_action` |
| `maskingDetectedTypes` | `masking_detected_types` |
| `maskingDetectedCount` | `masking_detected_count` |
| `fallbackCount` | `fallback_count` |
| `redactedPromptRef` | `redacted_prompt_ref` |
| `responseSummaryRef` | `response_summary_ref` |
| `metadata` | `metadata` |
| `ingestedAt` | `ingested_at` |

## 11.2 Partition / Order 기준

MVP 기준:

```text
Partition: toYYYYMM(event_time)
Order By: (tenant_id, project_id, event_time, request_id)
TTL: 기본 180일 또는 tenant retention policy 반영
```

조회가 많아지면 아래 projection 또는 materialized view를 추가한다.

- request detail: `request_id`
- user usage: `(tenant_id, user_id, event_time)`
- application usage: `(tenant_id, application_id, event_time)`
- model cost: `(tenant_id, project_id, model, event_time)`
- error search: `(tenant_id, project_id, status, error_code, event_time)`

Projection 추가도 schema 변경이므로 먼저 `db-schema.md`와 이 문서를 수정한다.

---

# 12. Index / Query 기준

## 12.1 기본 조회 패턴

| Use Case | Filter | Sort |
|---|---|---|
| Project Request Log | `tenantId`, `projectId`, date range | `createdAt desc` |
| Request Detail | `requestId` | N/A |
| User Usage | `tenantId`, `userId`, date range | `createdAt desc` |
| Application Usage | `tenantId`, `applicationId`, date range | `createdAt desc` |
| Error Search | `tenantId`, `projectId`, `status`, `errorCode` | `createdAt desc` |
| Cost by Model | `tenantId`, `projectId`, date range | group by `model` |
| Cache Hit Rate | `tenantId`, `projectId`, date range | group by `cacheStatus` |
| Masking Events | `tenantId`, `projectId`, date range | `createdAt desc` |

## 12.2 API Query Parameter 기준

Request Log API는 최소 아래 query parameter를 지원한다.

| Parameter | Type | 설명 |
|---|---:|---|
| `from` | ISO datetime | 시작 시각 |
| `to` | ISO datetime | 종료 시각 |
| `cursor` | string | pagination cursor |
| `limit` | integer | 페이지 크기 |
| `requestId` | string | request id exact search |
| `userId` | string | user filter |
| `applicationId` | string | application filter |
| `provider` | string | provider filter |
| `model` | string | model filter |
| `status` | string | status filter |
| `errorCode` | string | error code filter |
| `cacheStatus` | string | cache status filter |
| `maskingAction` | string | masking action filter |

`provider`, `model`, `status`, `errorCode` 값은 확장 가능하므로 프론트에서 하드코딩된 enum으로 막지 않는다. 서버가 내려주는 filter option API 또는 analytics query 결과를 사용한다.

---

# 13. 삭제 / Retention 정책

## 13.1 기본 retention

MVP 기본값:

| Data | Retention |
|---|---:|
| ClickHouse `llm_invocations` | 180일 |
| ClickHouse attempt/cache/routing/masking event | 180일 |
| S3 redacted prompt / response summary | 30~180일, tenant policy 기준 |
| Daily rollup | 1~3년, tenant policy 기준 |
| Cost ledger | 회계/정산 정책 기준. 별도 관리 |

## 13.2 Tenant 삭제

Tenant 삭제 시 정책:

1. active API Key / App Token 폐기
2. Provider secret reference 폐기 또는 비활성화
3. PostgreSQL control data soft delete
4. ClickHouse log는 retention 기간까지 보관 가능
5. 보관 중인 log의 tenant 식별 정보는 필요 시 anonymize
6. S3 payload는 tenant retention policy에 따라 purge
7. 비용 ledger는 정산 정책에 따라 보존

## 13.3 사용자 삭제

사용자 삭제 시:

- LLM log row 자체는 기본 보존한다.
- `userId`는 anonymized id로 대체하거나 별도 mapping을 제거한다.
- raw prompt/response를 저장하지 않았기 때문에 사용자 삭제 범위가 작아야 한다.
- S3 redacted payload에 개인정보가 남을 수 있으므로 retention/purge 정책을 적용한다.

## 13.4 로그 수정 금지

아래 작업은 금지한다.

- 비용 값을 임의 update
- status를 수동 update
- raw prompt를 나중에 추가 저장
- errorMessage를 provider raw body로 교체
- `metadata`에 원문 payload 삽입

보정이 필요하면 correction event 또는 별도 ledger를 사용한다.

---

# 14. createdAt / updatedAt 기준

## 14.1 createdAt

`createdAt`은 Gateway가 HTTP request를 수신한 시각이다.

기준:

- UTC ISO-8601 string
- millisecond precision
- ClickHouse `event_time`으로 저장
- partition용 `event_date`는 `createdAt`에서 파생

## 14.2 completedAt

`completedAt`은 Gateway가 client response를 완료한 시각이다.

- streaming이면 마지막 chunk 전송 완료 시각
- client abort면 abort 감지 시각
- blocked request면 block response 생성 완료 시각

## 14.3 ingestedAt

`ingestedAt`은 Worker가 log를 저장소에 기록한 시각이다.

- Gateway clock과 Worker clock 차이를 분석할 수 있게 보존한다.
- event lag 측정에 사용한다.

## 14.4 updatedAt

ClickHouse invocation log는 append-only이므로 기본적으로 `updatedAt`을 쓰지 않는다.

PostgreSQL mirror table이나 admin annotation table이 생기면 해당 row에는 `updatedAt`을 둘 수 있다. 단, 원본 invocation log의 `createdAt`과 구분해야 한다.

---

# 15. DTO / Type 기준

## 15.1 TypeScript DTO

```ts
export interface LlmRequestLogDto {
  schemaVersion: number;
  requestId: string;
  traceId: string;
  tenantId: string;
  projectId: string;
  applicationId: string | null;
  userId: string | null;
  apiKeyId: string | null;
  appTokenId: string | null;
  endpoint: string;
  method: string;
  stream: boolean;
  source: string;
  requestedProvider: string | null;
  requestedModel: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  contextTokens: number;
  totalTokens: number;
  tokenCountSource: string;
  cost: string;
  costMicroUsd: number;
  currency: string;
  latencyMs: number;
  ttftMs: number | null;
  status: string;
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorMessageHash: string | null;
  cacheStatus: string;
  cacheType: string;
  cacheKeyHash: string | null;
  routingRuleId: string | null;
  routingPolicyVersionId: string | null;
  routingReason: string | null;
  fallbackCount: number;
  maskingAction: string;
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
  securityPolicyVersionId: string | null;
  redactedPromptRef: string | null;
  responseSummaryRef: string | null;
  createdAt: string;
  completedAt: string | null;
  ingestedAt: string;
  metadata: Record<string, unknown>;
}
```

주의:

- 비용 집계용 `costMicroUsd`가 `number` 범위를 넘을 수 있는 대규모 집계에서는 `string` 또는 BigInt wrapper를 사용한다.
- DTO에서 `provider`/`model`을 union type으로 닫지 않는다.
- `status`는 UI 표시 helper에서만 label mapping을 둔다.

## 15.2 Go Struct

```go
type LlmRequestLog struct {
    SchemaVersion int                    `json:"schemaVersion"`
    RequestID     string                 `json:"requestId"`
    TraceID       string                 `json:"traceId"`
    TenantID      string                 `json:"tenantId"`
    ProjectID     string                 `json:"projectId"`
    ApplicationID *string                `json:"applicationId"`
    UserID        *string                `json:"userId"`
    APIKeyID      *string                `json:"apiKeyId"`
    AppTokenID    *string                `json:"appTokenId"`
    Endpoint      string                 `json:"endpoint"`
    Method        string                 `json:"method"`
    Stream        bool                   `json:"stream"`
    Source        string                 `json:"source"`
    Provider      string                 `json:"provider"`
    Model         string                 `json:"model"`
    PromptTokens  uint64                 `json:"promptTokens"`
    CompletionTokens uint64              `json:"completionTokens"`
    ContextTokens uint64                 `json:"contextTokens"`
    TotalTokens   uint64                 `json:"totalTokens"`
    CostMicroUSD  int64                  `json:"costMicroUsd"`
    LatencyMS     uint64                 `json:"latencyMs"`
    Status        string                 `json:"status"`
    HTTPStatus    uint16                 `json:"httpStatus"`
    ErrorCode     *string                `json:"errorCode"`
    ErrorMessage  *string                `json:"errorMessage"`
    CreatedAt     time.Time              `json:"createdAt"`
    CompletedAt   *time.Time             `json:"completedAt"`
    Metadata      map[string]interface{} `json:"metadata"`
}
```

주의:

- `CostMicroUSD`는 float64가 아니다.
- Provider raw error body를 struct에 보관하지 않는다.
- request context에 원문 prompt가 필요하더라도 log struct에는 넣지 않는다.

---

# 16. Validation 기준

## 16.1 Required validation

Worker는 ClickHouse 저장 전 아래를 검증한다.

- `schemaVersion` 존재
- `requestId` 존재
- `tenantId` 존재
- `projectId` 존재
- `status` 존재
- `model` 존재 또는 차단 요청에서 빈 문자열 허용 여부 명시
- token fields는 0 이상
- `costMicroUsd`는 0 이상. refund/correction은 별도 ledger
- `latencyMs`는 0 이상
- `createdAt`은 valid UTC datetime
- `errorCode`는 error/blocked 상태에서 가능하면 존재
- `errorMessage`는 sanitized 및 길이 제한 통과

## 16.2 Cross-field validation

| 조건 | 검증 |
|---|---|
| `status = success` | `httpStatus`는 2xx, `errorCode`는 null 권장 |
| `status = cache_hit` | `cacheStatus = hit`, `costMicroUsd = 0` 권장 |
| `status = blocked` | `httpStatus`는 4xx, Provider attempt 없어야 함 |
| `status = error` | `errorCode` 있어야 함 |
| `maskingAction = blocked` | `status = blocked` |
| `completionTokens > 0` | Provider success 또는 partial success |
| `fallbackCount > 0` | provider attempt가 2개 이상이거나 routing event에 fallback chain 존재 |

## 16.3 Unknown value 처리

분석 시스템은 unknown 값을 버리지 않는다.

- 알 수 없는 provider/model/status/errorCode도 저장한다.
- Dashboard label이 없으면 raw value를 표시한다.
- 알 수 없는 값이 자주 나오면 문서에 추가한다.

---

# 17. 보안 기준

## 17.1 저장 금지 필드

아래 이름의 필드는 log schema에 추가하지 않는다.

- `prompt`
- `rawPrompt`
- `messages`
- `rawMessages`
- `response`
- `rawResponse`
- `apiKey`
- `providerApiKey`
- `authorization`
- `cookie`
- `secret`
- `password`
- `tokenValue`
- `appTokenValue`

필요하면 반드시 redacted/hash/ref 형태로 설계한다.

## 17.2 Error Sanitization

Error sanitization은 Gateway 또는 Worker에서 수행한다.

규칙:

1. provider raw body에서 secret/prompt fragment 가능성이 있는 값을 제거한다.
2. 512자 이하로 자른다.
3. line break를 normalize한다.
4. PII detector를 한 번 더 적용한다.
5. 저장용 `errorMessageHash`를 만든다.
6. UI용 `errorMessage`는 안전한 generic message를 우선한다.

## 17.3 Payload Reference

S3 ref는 object key 또는 logical ref만 저장한다.

예:

```text
tenants/{tenant_id}/requests/{yyyy}/{mm}/{dd}/{request_id}/redacted_prompt.json
tenants/{tenant_id}/requests/{yyyy}/{mm}/{dd}/{request_id}/response_summary.json
```

S3 object도 raw prompt/response가 아니라 redacted/summary payload만 저장한다.

---

# 18. 구현 위치 기준

## 18.1 Gateway

Gateway는 request context에 log metadata를 모은다.

위치 기준:

```text
apps/gateway-core/internal/observability
apps/gateway-core/internal/events
apps/gateway-core/internal/pipeline/stages
```

Gateway 책임:

- requestId 생성
- stage별 metadata 수집
- token/cost/latency 계산 가능한 값 수집
- sanitized error 생성
- terminal event 발행
- provider attempt/cache/routing/masking event 발행

Gateway 비책임:

- ClickHouse 직접 저장
- Dashboard query 수행
- raw prompt 장기 저장

## 18.2 Worker

Worker 책임:

- Redpanda event consume
- schema validation
- idempotency 처리
- ClickHouse insert
- S3 redacted payload 저장
- daily rollup 갱신 또는 materialized view 보조
- failed event dead-letter 처리

위치 기준:

```text
apps/worker/src/consumers/llm-invocations
apps/worker/src/sinks/clickhouse
apps/worker/src/sinks/object-storage
```

## 18.3 Control Plane API

Control Plane API 책임:

- Request Log 목록 조회
- Request Detail Drawer 조회
- filter option 제공
- tenant/project 권한 검사
- raw prompt/response 반환 차단

위치 기준:

```text
apps/control-plane-api/src/modules/analytics
apps/control-plane-api/src/modules/llm-requests
```

## 18.4 Frontend

Frontend 책임:

- Request Log table 표시
- Detail Drawer 표시
- 비용/토큰/지연시간/상태/오류/캐시/라우팅/마스킹 시각화
- raw payload 요청 UI를 만들지 않음

위치 기준:

```text
apps/web/src/features/request-logs
apps/web/src/features/dashboard
```

---

# 19. 테스트 기준

## 19.1 Gateway unit test

필수 테스트:

- success log 생성
- cache hit log 생성
- policy block log 생성
- provider error log 생성
- provider timeout fallback log 생성
- streaming success log 생성
- client abort log 생성
- masking block log 생성
- raw prompt가 event에 포함되지 않는지 검증
- Provider API Key가 event에 포함되지 않는지 검증

## 19.2 Worker integration test

필수 테스트:

- terminal event consume 후 ClickHouse row 생성
- duplicate event 처리
- invalid schema dead-letter 처리
- costMicroUsd 정수 보존
- timestamp UTC 보존
- metadata JSON string 직렬화/역직렬화
- redacted payload S3 저장
- raw payload 저장 금지

## 19.3 API test

필수 테스트:

- Project member만 log 조회 가능
- 다른 tenant requestId 조회 차단
- 목록 pagination 동작
- status/provider/model/date filter 동작
- Detail Drawer 하위 event 조회
- raw prompt/raw response 미반환
- errorMessage sanitization 유지

## 19.4 Frontend test

필수 테스트:

- costMicroUsd를 비용 표시로 변환
- status label fallback 처리
- unknown provider/model 표시
- error/null 필드 안전 처리
- Detail Drawer에 redacted prompt만 표시

---

# 20. 구현 금지 사항

아래는 금지한다.

- PostgreSQL에 고볼륨 LLM invocation log를 기본 저장
- Gateway가 ClickHouse에 직접 insert
- raw prompt/raw response 저장
- Provider API Key/API Key/App Token 원문 저장
- Provider/Model을 enum으로 닫기
- 비용을 float로 집계
- token/cost/latency를 `metadata`에만 저장
- `requestId` 대신 Provider response id를 추적 ID로 사용
- cache hit 로그 생략
- blocked request 로그 생략
- provider attempt 로그 생략
- retry/fallback 결과를 최종 status 하나로만 뭉개기
- errorMessage에 provider raw body 저장
- 문서 수정 없이 log field 추가

---

# 21. MVP 구현 체크리스트

MVP에서는 최소 아래를 만족해야 한다.

- [ ] Gateway가 모든 요청에 `requestId`를 생성한다.
- [ ] Gateway response header에 `x-gatelm-request-id`를 포함한다.
- [ ] Gateway response body의 `gate_lm.requestId`를 포함한다.
- [ ] Success request log를 남긴다.
- [ ] Cache hit request log를 남긴다.
- [ ] Blocked request log를 남긴다.
- [ ] Provider error request log를 남긴다.
- [ ] `promptTokens`, `completionTokens`, `totalTokens`를 기록한다.
- [ ] `costMicroUsd`를 기록한다.
- [ ] `latencyMs`를 기록한다.
- [ ] `status`, `errorCode`, sanitized `errorMessage`를 기록한다.
- [ ] Provider attempt를 별도 event로 기록한다.
- [ ] Cache event를 별도 event로 기록한다.
- [ ] Routing event를 별도 event로 기록한다.
- [ ] Masking event를 별도 event로 기록한다.
- [ ] Worker가 Redpanda event를 ClickHouse에 저장한다.
- [ ] Dashboard Overview가 log/rollup 데이터를 사용한다.
- [ ] Request Log 목록 API가 동작한다.
- [ ] Request Detail Drawer API가 동작한다.
- [ ] raw prompt/raw response가 API와 log에 포함되지 않는다.

---

# 22. 변경 절차

LLM log field를 추가하거나 바꿀 때는 아래 순서를 따른다.

```text
1. llm-log-schema.md 수정
2. gateway-flow.md의 event 발행 위치 영향 확인
3. db-schema.md의 ClickHouse column 또는 metadata 저장 위치 확인
4. api-spec.md의 response body 영향 확인
5. packages/contracts/events schema 수정
6. Gateway event builder 수정
7. Worker validator/sink 수정
8. Control Plane API DTO/query 수정
9. Frontend table/detail/dashboard 수정
10. 테스트 추가
```

필드 추가 시 반드시 답해야 하는 질문:

- 이 필드는 Dashboard/장애 추적/비용 분석 중 무엇에 필요한가?
- top-level 필드인가, metadata인가?
- ClickHouse column이 필요한가?
- cardinality가 높은가?
- raw prompt/response/secret이 섞일 위험이 있는가?
- retention 대상인가?
- tenant purge 시 어떻게 처리할 것인가?
- 기존 query와 API response를 깨지 않는가?

---

# 24. PII Masking Policy 연계 기준

`pii-masking-policy.md`와의 mapping은 아래를 따른다.

| Policy 개념 | Log/Event field | Allowed values |
|---|---|---|
| Policy action | `llm_masking_events.action` | `allow`, `redact`, `block` |
| Request-level outcome | `llm_invocations.masking_action`, API `maskingAction` | `none`, `redacted`, `blocked` |
| Detector type | `detectorType`, `maskingDetectedTypes` | `email`, `phone_number`, `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `account_id`, `employee_id`, `internal_keyword`, `unknown` |

민감정보 로그에는 raw detected value를 저장하지 않는다. 중복 분석이 필요하면 `sampleHash = HMAC-SHA256(tenant_salt, normalized_sensitive_value)` 기준으로 저장한다.

