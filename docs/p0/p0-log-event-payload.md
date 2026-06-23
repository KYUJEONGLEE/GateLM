# GateLM P0 Request Log / Event Payload Spec v0.1

## 문서 목적

이 문서는 P0에서 반드시 저장하고 조회해야 하는 LLM Request Log와 Event Payload의 최소 필드를 확정한다. 기존 `llm-log-schema.md`는 장기 스키마를 포함한다. 이 문서는 2~3주 구현용 최소 계약이다.

---

## 1. P0 원칙

```text
1. 요청 1건은 requestId 1개로 추적한다.
2. cache hit, blocked request도 request log를 남긴다.
3. raw prompt/raw response는 저장하지 않는다.
4. API Key/App Token/Provider Key 원문은 저장하지 않는다.
5. Gateway는 P0에서 direct writer를 사용할 수 있지만 event payload shape은 이 문서를 따른다.
6. 장기적으로는 Gateway -> Redpanda -> Worker -> ClickHouse/PostgreSQL 구조로 이동한다.
```

---

## 2. P0 Event 운영 방식

P0 코드에서는 하나의 DTO로 처리한다.

```text
InvocationFinishedPayload
```

다만 `eventType` 값은 기존 canonical terminal event와 호환되게 둔다.

| status | eventType |
|---|---|
| `success` | `invocation.completed` |
| `cache_hit` | `invocation.completed` |
| `blocked` | `invocation.blocked` |
| `error` | `invocation.failed` |
| `cancelled` | `invocation.cancelled` |

P0 shortcut이 필요하면 내부 코드 이름만 `invocation.finished`로 부를 수 있다. 외부 contract와 저장 payload는 위 eventType을 따른다.

---

## 3. Event Envelope

```json
{
  "eventId": "event_01J...",
  "eventType": "invocation.completed",
  "eventVersion": 1,
  "occurredAt": "2026-06-23T00:00:00.000Z",
  "request": {}
}
```

필드 기준:

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `eventId` | string | Y | event id, 중복 처리 기준 |
| `eventType` | string | Y | `invocation.completed/failed/blocked/cancelled` |
| `eventVersion` | integer | Y | P0는 `1` |
| `occurredAt` | string | Y | UTC ISO-8601 |
| `request` | object | Y | 아래 `P0 LlmRequestLog` |

---

## 4. P0 LlmRequestLog 최소 필드

### 4.1 Identity

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `schemaVersion` | integer | Y | P0는 `1` |
| `requestId` | string | Y | Gateway request id |
| `traceId` | string | Y | trace id. 없으면 requestId와 동일 가능 |
| `tenantId` | string | Y | tenant id |
| `projectId` | string | Y | project id |
| `applicationId` | string or null | Y | application id |
| `apiKeyId` | string or null | Y | 원문 key 아님 |
| `appTokenId` | string or null | Y | 원문 token 아님 |
| `endUserId` | string or null | N | `X-GateLM-End-User-Id` |
| `featureId` | string or null | N | `X-GateLM-Feature-Id` |

### 4.2 Request

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `endpoint` | string | Y | `/v1/chat/completions` |
| `method` | string | Y | `POST` |
| `source` | string | Y | `customer_app`, `chat_ui`, `developer_tool`, `internal` |
| `stream` | boolean | Y | P0는 `false` |
| `requestBodyHash` | string | Y | normalized request body hash |
| `promptHash` | string | Y | redacted prompt 기준 hash |
| `redactedPromptPreview` | string or null | N | UI preview, 길이 제한 |

### 4.3 Provider / Model / Routing

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `requestedProvider` | string or null | N | 요청자가 지정한 provider |
| `requestedModel` | string or null | Y | 요청 model. 예: `auto` |
| `provider` | string | Y | 실제 호출 provider. blocked면 빈 문자열 가능 |
| `model` | string | Y | 실제 호출/선택 model |
| `selectedProvider` | string or null | Y | routing 결과 provider |
| `selectedModel` | string or null | Y | routing 결과 model |
| `routingReason` | string or null | N | `low_cost`, `default`, `pinned`, `blocked` |
| `routingRuleId` | string or null | N | P0는 null 가능 |

### 4.4 Token / Cost / Latency

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `promptTokens` | integer | Y | Provider 또는 mock usage |
| `completionTokens` | integer | Y | Provider 또는 mock usage |
| `totalTokens` | integer | Y | prompt + completion |
| `costMicroUsd` | integer | Y | actual cost. cache/block은 0 |
| `costUsd` | string | Y | 표시용 decimal string |
| `savedCostMicroUsd` | integer | N | cache hit 절감 추정액 |
| `currency` | string | Y | `USD` |
| `latencyMs` | integer | Y | Gateway end-to-end latency |
| `providerLatencyMs` | integer or null | N | Provider 호출이 없으면 null |

### 4.5 Status / Error

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `status` | string | Y | `success`, `cache_hit`, `blocked`, `error`, `cancelled` |
| `httpStatus` | integer | Y | client에게 반환한 HTTP status |
| `errorCode` | string or null | Y | sanitized code |
| `errorMessage` | string or null | Y | sanitized message |
| `errorStage` | string or null | N | 실패 stage |
| `retryable` | boolean or null | N | 재시도 가능 여부 |

### 4.6 Cache

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `cacheStatus` | string | Y | `hit`, `miss`, `bypass`, `error` |
| `cacheType` | string | Y | `none`, `exact`, `semantic` |
| `cacheKeyHash` | string or null | N | cache key hash |
| `cacheHitRequestId` | string or null | N | hit된 원본 request id |

P0에서는 semantic cache를 disabled로 둔다. `cacheType=semantic`은 P1/P2에서 사용한다.

### 4.7 Masking

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `maskingAction` | string | Y | `none`, `redacted`, `blocked` |
| `maskingDetectedTypes` | array[string] | Y | detector type 목록 |
| `maskingDetectedCount` | integer | Y | 탐지 건수 |
| `securityPolicyVersionId` | string or null | N | P0는 config hash 가능 |

### 4.8 Time / Metadata

| Field | Type | Required | 설명 |
|---|---:|---:|---|
| `createdAt` | string | Y | 요청 시작 시각 |
| `completedAt` | string or null | Y | 요청 종료 시각 |
| `ingestedAt` | string or null | N | Worker/direct writer 저장 시각 |
| `metadata` | object | Y | 확장 정보. secret/raw payload 금지 |

---

## 5. P0 Event 예시 — 성공

```json
{
  "eventId": "event_01J_DEMO_001",
  "eventType": "invocation.completed",
  "eventVersion": 1,
  "occurredAt": "2026-06-23T00:00:00.900Z",
  "request": {
    "schemaVersion": 1,
    "requestId": "request_01J_DEMO_001",
    "traceId": "trace_01J_DEMO_001",
    "tenantId": "tenant_01J_DEMO",
    "projectId": "project_01J_DEMO",
    "applicationId": "app_01J_DEMO",
    "apiKeyId": "api_key_01J_DEMO",
    "appTokenId": "app_token_01J_DEMO",
    "endUserId": "user_demo_001",
    "featureId": "support-reply",
    "endpoint": "/v1/chat/completions",
    "method": "POST",
    "source": "customer_app",
    "stream": false,
    "requestBodyHash": "hmac-sha256:request-body-demo",
    "promptHash": "hmac-sha256:redacted-prompt-demo",
    "redactedPromptPreview": "Write a short refund response.",
    "requestedProvider": null,
    "requestedModel": "auto",
    "provider": "mock",
    "model": "mock-fast",
    "selectedProvider": "mock",
    "selectedModel": "mock-fast",
    "routingReason": "low_cost",
    "routingRuleId": null,
    "promptTokens": 32,
    "completionTokens": 24,
    "totalTokens": 56,
    "costMicroUsd": 1,
    "costUsd": "0.000001",
    "savedCostMicroUsd": 0,
    "currency": "USD",
    "latencyMs": 132,
    "providerLatencyMs": 86,
    "status": "success",
    "httpStatus": 200,
    "errorCode": null,
    "errorMessage": null,
    "errorStage": null,
    "retryable": null,
    "cacheStatus": "miss",
    "cacheType": "exact",
    "cacheKeyHash": "hmac-sha256:cache-key-demo",
    "cacheHitRequestId": null,
    "maskingAction": "none",
    "maskingDetectedTypes": [],
    "maskingDetectedCount": 0,
    "securityPolicyVersionId": "security_policy_p0_v1",
    "createdAt": "2026-06-23T00:00:00.000Z",
    "completedAt": "2026-06-23T00:00:00.132Z",
    "ingestedAt": "2026-06-23T00:00:00.950Z",
    "metadata": {
      "gatewayVersion": "0.1.0",
      "p0Shortcut": true
    }
  }
}
```

---

## 6. P0 Event 예시 — Cache Hit

```json
{
  "eventId": "event_01J_DEMO_002",
  "eventType": "invocation.completed",
  "eventVersion": 1,
  "occurredAt": "2026-06-23T00:01:00.050Z",
  "request": {
    "schemaVersion": 1,
    "requestId": "request_01J_DEMO_002",
    "traceId": "trace_01J_DEMO_002",
    "tenantId": "tenant_01J_DEMO",
    "projectId": "project_01J_DEMO",
    "applicationId": "app_01J_DEMO",
    "apiKeyId": "api_key_01J_DEMO",
    "appTokenId": "app_token_01J_DEMO",
    "endpoint": "/v1/chat/completions",
    "method": "POST",
    "source": "customer_app",
    "stream": false,
    "requestBodyHash": "hmac-sha256:request-body-demo",
    "promptHash": "hmac-sha256:redacted-prompt-demo",
    "redactedPromptPreview": "Write a short refund response.",
    "requestedProvider": null,
    "requestedModel": "auto",
    "provider": "mock",
    "model": "mock-fast",
    "selectedProvider": "mock",
    "selectedModel": "mock-fast",
    "routingReason": "cache_reuse",
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0,
    "costMicroUsd": 0,
    "costUsd": "0.000000",
    "savedCostMicroUsd": 1,
    "currency": "USD",
    "latencyMs": 18,
    "providerLatencyMs": null,
    "status": "cache_hit",
    "httpStatus": 200,
    "errorCode": null,
    "errorMessage": null,
    "cacheStatus": "hit",
    "cacheType": "exact",
    "cacheKeyHash": "hmac-sha256:cache-key-demo",
    "cacheHitRequestId": "request_01J_DEMO_001",
    "maskingAction": "none",
    "maskingDetectedTypes": [],
    "maskingDetectedCount": 0,
    "createdAt": "2026-06-23T00:01:00.000Z",
    "completedAt": "2026-06-23T00:01:00.018Z",
    "metadata": {}
  }
}
```

---

## 7. P0 Event 예시 — Sensitive Data Block

```json
{
  "eventId": "event_01J_DEMO_003",
  "eventType": "invocation.blocked",
  "eventVersion": 1,
  "occurredAt": "2026-06-23T00:02:00.020Z",
  "request": {
    "schemaVersion": 1,
    "requestId": "request_01J_DEMO_003",
    "traceId": "trace_01J_DEMO_003",
    "tenantId": "tenant_01J_DEMO",
    "projectId": "project_01J_DEMO",
    "applicationId": "app_01J_DEMO",
    "apiKeyId": "api_key_01J_DEMO",
    "appTokenId": "app_token_01J_DEMO",
    "endpoint": "/v1/chat/completions",
    "method": "POST",
    "source": "customer_app",
    "stream": false,
    "requestBodyHash": "hmac-sha256:request-body-block-demo",
    "promptHash": "hmac-sha256:redacted-prompt-block-demo",
    "redactedPromptPreview": "This message contains [SECRET_REDACTED].",
    "requestedProvider": null,
    "requestedModel": "auto",
    "provider": "",
    "model": "auto",
    "selectedProvider": null,
    "selectedModel": null,
    "routingReason": null,
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0,
    "costMicroUsd": 0,
    "costUsd": "0.000000",
    "currency": "USD",
    "latencyMs": 15,
    "providerLatencyMs": null,
    "status": "blocked",
    "httpStatus": 403,
    "errorCode": "sensitive_data_blocked",
    "errorMessage": "Request blocked by GateLM security policy.",
    "errorStage": "mask_or_block",
    "retryable": false,
    "cacheStatus": "bypass",
    "cacheType": "none",
    "cacheKeyHash": null,
    "cacheHitRequestId": null,
    "maskingAction": "blocked",
    "maskingDetectedTypes": ["api_key"],
    "maskingDetectedCount": 1,
    "securityPolicyVersionId": "security_policy_p0_v1",
    "createdAt": "2026-06-23T00:02:00.000Z",
    "completedAt": "2026-06-23T00:02:00.015Z",
    "metadata": {
      "blockedStage": "mask_or_block"
    }
  }
}
```

---

## 8. Request Log 목록 API 최소 필드

`GET /api/projects/:projectId/logs` item:

```json
{
  "requestId": "request_01J_DEMO_001",
  "projectId": "project_01J_DEMO",
  "applicationId": "app_01J_DEMO",
  "provider": "mock",
  "model": "mock-fast",
  "requestedModel": "auto",
  "selectedModel": "mock-fast",
  "status": "success",
  "httpStatus": 200,
  "promptTokens": 32,
  "completionTokens": 24,
  "totalTokens": 56,
  "costUsd": "0.000001",
  "costMicroUsd": 1,
  "latencyMs": 132,
  "cacheStatus": "miss",
  "cacheType": "exact",
  "routingReason": "low_cost",
  "maskingAction": "none",
  "createdAt": "2026-06-23T00:00:00.000Z"
}
```

목록에서 제외:

```text
redactedPromptPreview
responseSummary
metadata 전체
attempts/cacheEvents/routingEvents/maskingEvents 상세
```

---

## 9. Request Detail API 최소 필드

`GET /api/llm-requests/:requestId` response:

```json
{
  "data": {
    "requestId": "request_01J_DEMO_001",
    "traceId": "trace_01J_DEMO_001",
    "tenantId": "tenant_01J_DEMO",
    "projectId": "project_01J_DEMO",
    "applicationId": "app_01J_DEMO",
    "status": "success",
    "httpStatus": 200,
    "provider": "mock",
    "model": "mock-fast",
    "requestedModel": "auto",
    "selectedModel": "mock-fast",
    "usage": {
      "promptTokens": 32,
      "completionTokens": 24,
      "totalTokens": 56
    },
    "cost": {
      "costUsd": "0.000001",
      "costMicroUsd": 1,
      "currency": "USD"
    },
    "latency": {
      "latencyMs": 132,
      "providerLatencyMs": 86
    },
    "cache": {
      "cacheStatus": "miss",
      "cacheType": "exact",
      "cacheKeyHash": "hmac-sha256:cache-key-demo",
      "cacheHitRequestId": null
    },
    "routing": {
      "routingReason": "low_cost",
      "routingRuleId": null,
      "selectedProvider": "mock",
      "selectedModel": "mock-fast"
    },
    "masking": {
      "maskingAction": "none",
      "maskingDetectedTypes": [],
      "maskingDetectedCount": 0,
      "redactedPromptPreview": "Write a short refund response."
    },
    "error": {
      "errorCode": null,
      "errorMessage": null,
      "errorStage": null
    },
    "createdAt": "2026-06-23T00:00:00.000Z",
    "completedAt": "2026-06-23T00:00:00.132Z"
  }
}
```

---

## 10. Storage Mapping

P0 canonical source는 PostgreSQL `p0_llm_invocation_logs`다.

### P0 기준 — Postgres fallback

```text
Gateway/direct writer -> PostgreSQL p0_llm_invocation_logs
Dashboard/Logs/Detail -> PostgreSQL query
```

이 경로는 P0 shortcut이다. README와 코드 주석에 남긴다.

### Optional — ClickHouse mirror

```text
Worker/direct writer -> ClickHouse llm_invocations
Dashboard/Logs -> ClickHouse query only after numbers match PostgreSQL canonical source
```

ClickHouse를 P0에서 붙이더라도 PostgreSQL과 Dashboard 숫자가 다르면 PostgreSQL 값을 기준으로 판단한다.

---

## 11. 보안 금지 필드

아래 필드는 event/request log/detail API에 넣지 않는다.

```text
rawPrompt
rawResponse
fullRequestBody
fullResponseBody
providerApiKey
apiKeyPlaintext
appTokenPlaintext
authorizationHeader
cookie
rawProviderErrorBody
maskingSampleRawValue
```

---

## 12. P0 테스트 기준

```text
[ ] success event가 저장된다.
[ ] cache hit event가 저장된다.
[ ] blocked event가 저장된다.
[ ] requestId로 list -> detail 조회가 가능하다.
[ ] status별 dashboard count가 맞다.
[ ] raw prompt/raw response가 저장되지 않는다.
[ ] cache hit costMicroUsd=0이다.
[ ] blocked request providerLatencyMs=null, costMicroUsd=0이다.
```
