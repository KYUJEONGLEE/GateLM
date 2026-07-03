# GateLM v2.0.0 Contracts

## 1. Status

이 문서는 GateLM v2.0.0 계약 기준 문서다.

`docs/v2.0.0` 아래의 JSON Schema, fixture, implementation plan은 이 문서를 기준으로 작성한다. API route, DB column, Event field, Metrics label을 추가하거나 변경할 때는 이 문서와 충돌하지 않아야 한다.

v2.0.0은 v1.0.0 baseline을 깨지 않고 다음을 확장한다.

- 조직 기반 LLMOps Gateway MVP
- RuntimeSnapshot 기반 live runtime policy
- Actual Provider 1종 이상과 모델 2개 이상
- Mock fallback 유지
- Streaming thin slice
- Dashboard freshness/query budget
- 강화된 k6/query profile baseline

## 2. Global Rules

### 2.1 MUST

- Provider와 Model은 DB enum 또는 코드 enum으로 고정하지 않는다.
- Gateway handler는 특정 provider 이름에 직접 의존하지 않는다.
- Provider별 호출 로직은 Provider Adapter 안에 둔다.
- Gateway는 editable RuntimeConfig를 직접 소비하지 않고 published RuntimeSnapshot만 소비한다.
- Observability는 Gateway가 생산한 outcome을 저장/집계한다. Observability가 stage outcome을 새로 추측하지 않는다.
- Request Log, Request Detail, Dashboard, Metrics는 raw prompt/raw response/raw credential을 저장하거나 출력하지 않는다. 단, Request Detail은 RuntimeSnapshot의 opt-in 정책이 켜진 경우 masking 이후 log-safe captured prompt만 표시할 수 있다.
- Client request body에서 넘어온 budget scope는 신뢰하지 않는다.

### 2.2 MUST NOT

아래 값은 API response, DB record, fixture, structured log, metric label에 평문으로 포함하지 않는다.

```text
raw prompt
raw response
raw detected value
raw prompt fragment
API Key
App Token
Provider Key
Authorization header
provider raw error body
actual secret
```

## 3. Identity And Budget Scope

### 3.1 Core Gateway Identity

Gateway hot path의 기본 요청 식별 축은 아래 세 값이다.

```text
tenantId
projectId
applicationId
```

`teamId`는 조직 구조를 표현하는 엔티티로 둔다. v2.0.0에서 `teamId`를 Gateway core identity key로 승격하지 않는다.

### 3.2 Budget Scope

비용, 쿼터, 대시보드 귀속은 `budgetScopeType`과 `budgetScopeId`로 표현한다.

```json
{
  "budgetScopeType": "application",
  "budgetScopeId": "application-id"
}
```

`budgetScopeType`의 v2.0.0 허용 값:

```text
application
project
team
```

기본값:

```text
budgetScopeType = application
budgetScopeId = applicationId
```

관리자가 Control Plane/RuntimeSnapshot 설정으로 명시한 경우에만 `project` 또는 `team` scope로 override할 수 있다.

`department`는 v2.0.0 공식 budget scope로 사용하지 않는다. 필요하면 v2.x에서 별도 계약으로 검토한다.

### 3.3 Budget Resolution Rules

- Gateway는 인증 결과와 RuntimeSnapshot/Control Plane 규칙으로 검증된 budget scope만 소비한다.
- Client가 request body에 budget scope를 보내더라도 Gateway는 이를 신뢰하지 않는다.
- GatewayContext, Request Log, Request Detail에는 resolved budget scope와 `resolvedBy`를 남긴다.
- Dashboard read model은 resolved budget scope를 filter/breakdown grain으로 사용한다.
- Budget warning threshold는 관리자가 설정할 수 있어야 한다.
- Budget warning은 기본적으로 Admin/Operator 화면에서만 표시한다.

### 3.4 Budget Resolution Source Values

`budgetScope.resolvedBy`는 아래 값만 사용한다.

| Value | Meaning |
|---|---|
| `default_application` | 별도 override가 없어서 v2.0.0 기본값인 `budgetScopeType=application`, `budgetScopeId=applicationId`를 적용했다. |
| `runtime_snapshot` | published RuntimeSnapshot이 budget scope를 명시적으로 제공했다. |
| `control_plane_rule` | Control Plane의 검증된 규칙이 budget scope를 결정했다. |

Gateway는 client-provided budget scope를 신뢰하지 않는다. `client_provided` 같은 source 값은 v2.0.0 계약에 넣지 않는다. Request Log/Detail/Dashboard에는 위 resolved source와 최종 resolved budget scope만 남긴다.

## 4. Employee Chat Boundary

Employee Chat은 별도 예외 경로가 아니라 Application boundary 안의 surface로 취급한다.

원칙:

- Employee Chat 요청도 Gateway main path를 탄다.
- Employee Chat은 Application context를 가진다.
- RuntimeSnapshot policy를 적용받는다.
- Request Log, Request Detail, Dashboard, Metrics에 포함된다.
- Employee Chat UI는 Provider를 직접 호출하지 않는다.

v2.0.0 기본 호출 방식:

```text
Employee Browser
-> Web BFF / Server-side boundary
-> Gateway
-> Provider Adapter
```

브라우저에 raw App Token을 저장하거나 노출하지 않는다. Browser direct Gateway 호출은 v2.0.0 core path가 아니며, 필요하면 별도 보안 계약 후 검토한다.

표시 수준:

| Surface | Show | Hide |
|---|---|---|
| Employee UI | response, requestId, simple status | raw token, detector detail, raw prompt/response, policy internals |
| Admin/Developer UI | routing, cache, safety, provider, latency, cost, RuntimeSnapshot provenance, opt-in log-safe captured prompt | raw secret, raw prompt/response, provider raw error body |

## 5. RuntimeConfig And RuntimeSnapshot

### 5.1 Concepts

| Concept | Contract |
|---|---|
| RuntimeConfig | 관리자가 수정하는 editable 설정 |
| RuntimeSnapshot | 검증 후 publish되어 Gateway가 실제 사용하는 immutable 실행본 |

### 5.2 RuntimeSnapshot Consumption

- Gateway는 RuntimeConfig를 직접 소비하지 않는다.
- Gateway는 published RuntimeSnapshot만 소비한다.
- RuntimeSnapshot은 immutable하다.
- 설정 변경 시 기존 snapshot을 수정하지 않고 새 snapshot을 생성한다.
- DB는 RuntimeConfig/RuntimeSnapshot의 source of truth다.
- Redis는 active snapshot pointer/cache 용도로만 사용한다.

### 5.3 Active Snapshot Lookup Key

v2.0.0의 active RuntimeSnapshot lookup key는 아래 값을 기준으로 한다.

```text
tenantId
projectId
applicationId
```

`budgetScopeType/budgetScopeId`는 active RuntimeSnapshot lookup key에 포함하지 않는다. Budget scope는 비용/쿼터/대시보드 귀속 규칙이며, 실행 정책 snapshot을 분기하는 key가 아니다.

### 5.4 RuntimeSnapshot Provenance

Request Detail과 Dashboard는 full RuntimeSnapshot body를 복사하지 않는다. 실제 요청에 적용된 snapshot을 추적할 수 있는 provenance만 저장/노출한다.

최소 provenance 필드:

```text
runtimeSnapshotId
runtimeSnapshotVersion
contentHash
runtimeState
publishedAt
publishedBy
gatewayInstanceId
```

`runtimeSnapshotVersion`은 integer monotonic version이다. UI 표시 문자열이 필요하면 UI/read model에서 format한다.

v1 계열 hash와의 연결:

```text
configHash
securityPolicyHash
routingPolicyHash
```

위 hash trio는 v2.0.0 primary provenance가 아니다. 필요하면 compatibility/read model bridge에서 `legacyHashes` 계열로 연결하되, RuntimeSnapshot lookup key나 primary runtime identity로 사용하지 않는다.

RuntimeSnapshot에는 provider credential, API Key, App Token, Authorization header, secret plaintext를 포함하지 않는다. Provider credential은 `credentialRef` 또는 metadata reference로만 연결한다. 기존 `secretRef` 이름은 legacy compatibility 후보로만 남기며, RuntimeSnapshot/Provider Catalog의 v2 계약 용어로 승격하지 않는다.

### 5.5 Publish And Reload Failure

| Situation | Contract |
|---|---|
| validation failed | RuntimeSnapshot을 생성하지 않는다. |
| publish failed | active snapshot pointer를 변경하지 않는다. |
| Gateway reload failed | Gateway는 메모리에 있던 last loaded snapshot으로 계속 처리한다. |
| partial Gateway reload | 각 request log/detail에는 실제 사용한 snapshot provenance를 남긴다. |

`lastKnownSafe`는 snapshot 자체 상태가 아니라 Gateway runtime state로 본다.

### 5.6 Runtime State Values

RuntimeSnapshot 자체와 GatewayContext의 실제 runtime provenance에는 아래 값만 사용한다.

```text
snapshot_active
last_known_safe_used
stale_snapshot_used
```

`no_snapshot`과 `not_checked`는 실제 RuntimeSnapshot 상태가 아니다. 두 값은 Gateway stage outcome, Request Detail, Dashboard 같은 read model에서만 사용한다.

실제 RuntimeSnapshot/GatewayContext provenance object에는 `no_snapshot` 또는 `not_checked`를 넣지 않는다. 적용 가능한 snapshot이 없으면 runtime domain outcome/read model에서 표현하고 provenance object는 비우거나 별도 null 상태로 둔다.

| Value | Scope |
|---|---|
| `snapshot_active` | Gateway가 최신 published RuntimeSnapshot을 사용했다. |
| `last_known_safe_used` | reload 실패 등으로 Gateway가 메모리에 있던 마지막 정상 snapshot을 사용했다. |
| `stale_snapshot_used` | 최신성은 떨어지지만 계약상 허용된 snapshot을 사용했다. |
| `no_snapshot` | stage outcome/read model 전용. 적용 가능한 snapshot이 없었다. |
| `not_checked` | stage outcome/read model 전용. 해당 stage가 실행되지 않았다. |

## 6. Gateway Outcome Contract

### 6.1 Terminal Status

`terminalStatus`는 사용자 관점의 최종 결과다. 값은 작게 유지한다.

```text
success
blocked
rate_limited
failed
cancelled
```

| terminalStatus | Meaning |
|---|---|
| `success` | 사용자에게 정상 응답이 전달됨. cache hit와 fallback success를 포함한다. |
| `blocked` | auth, safety, budget, policy 판단으로 의도적으로 차단됨. |
| `rate_limited` | rate limit 정책으로 차단됨. |
| `failed` | Gateway 또는 Provider 오류로 정상 응답을 전달하지 못함. |
| `cancelled` | client abort 또는 streaming 취소로 요청이 중단됨. |

`cache_hit`, `error`, `partial_success`는 `terminalStatus` 값으로 사용하지 않는다. Cache hit 여부, provider error 여부, fallback degraded path는 domain outcome으로 표현한다.

### 6.2 Terminal Status Decision Rules

| Condition | terminalStatus |
|---|---|
| normal provider success | `success` |
| exact cache hit | `success` |
| provider timeout/error 후 Mock fallback success | `success` |
| invalid API Key | `blocked` |
| invalid App Token | `blocked` |
| safety block | `blocked` |
| budget block | `blocked` |
| rate limit exceeded | `rate_limited` |
| provider error and no fallback success | `failed` |
| gateway internal error | `failed` |
| client abort / stream cancelled | `cancelled` |

Auth failure는 `terminalStatus=blocked`로 보되 HTTP status와 error code로 구분한다.

```text
invalid API Key -> httpStatus=401, errorCode=invalid_api_key
invalid App Token -> httpStatus=403, errorCode=invalid_app_token
```

Exact Cache hit는 `terminalStatus=success`, `cache.outcome=hit`, `provider.outcome=not_called`로 기록한다. `cache_hit`를 terminal status처럼 사용하지 않는다.

### 6.3 Domain Outcome Groups

Domain outcome은 각 stage가 왜 그렇게 끝났는지를 설명한다.

```text
auth
runtime
rateLimit
budget
safety
routing
cache
provider
fallback
streaming
logging
```

Stage가 실행되지 않은 경우를 비워두지 않는다.

| Value | Meaning |
|---|---|
| `not_checked` | 해당 판단을 수행하지 않았다. |
| `not_called` | 외부 호출 또는 stage invocation이 발생하지 않았다. |
| `not_used` | 해당 기능이 비활성화되었거나 요청에 적용 대상이 아니었다. |

### 6.4 Domain Outcome Values

| Domain | Allowed outcome values |
|---|---|
| `auth` | `passed`, `invalid_api_key`, `invalid_app_token`, `scope_mismatch`, `not_checked` |
| `runtime` | `snapshot_active`, `last_known_safe_used`, `stale_snapshot_used`, `no_snapshot`, `not_checked` |
| `rateLimit` | `allowed`, `rate_limited`, `disabled`, `error`, `not_checked` |
| `budget` | `allowed`, `warned`, `blocked`, `not_used`, `not_checked` |
| `safety` | `passed`, `redacted`, `blocked`, `not_checked` |
| `routing` | `selected`, `skipped`, `failed`, `not_checked` |
| `cache` | `hit`, `miss`, `bypassed`, `error`, `not_used` |
| `provider` | `success`, `timeout`, `error`, `unauthorized`, `not_called` |
| `fallback` | `not_needed`, `disabled`, `success`, `failed`, `not_called` |
| `streaming` | `not_streaming`, `started`, `completed`, `interrupted`, `cancelled` |
| `logging` | `written`, `failed`, `deferred`, `not_called` |

### 6.5 Required Outcome Examples

Exact cache hit:

```json
{
  "terminalStatus": "success",
  "cache": { "outcome": "hit" },
  "provider": { "outcome": "not_called" }
}
```

Provider fallback success:

```json
{
  "terminalStatus": "success",
  "provider": { "outcome": "timeout" },
  "fallback": { "outcome": "success" }
}
```

Safety block:

```json
{
  "terminalStatus": "blocked",
  "safety": { "outcome": "blocked" },
  "cache": { "outcome": "bypassed" },
  "provider": { "outcome": "not_called" },
  "streaming": { "outcome": "not_streaming" }
}
```

### 6.6 Legacy Outcome Bridge

Gateway는 canonical `terminalStatus`와 `domainOutcomes`를 생산한다. Observability, Request Detail, Dashboard는 이 값을 소비하며 stage 결과를 새로 추측하지 않는다.

Legacy `status`, `cacheStatus`, `maskingAction`은 compatibility mapper 또는 read model bridge에서만 제공할 수 있다. 새 API/Event/Metrics/Schema의 canonical field로 승격하지 않는다.

## 7. Provider, Model, Routing, Fallback

### 7.1 Provider And Model Catalog

- Actual Provider는 v2.0.0에서 최소 1종을 연결한다.
- 모델은 최소 2개 이상을 지원한다.
- Mock Provider는 fallback/evidence path로 유지한다.
- Provider/Model catalog의 source of truth는 Control Plane DB다.
- RuntimeSnapshot은 Provider Catalog 전체 body를 복사하지 않고 `providerCatalogRef`만 제공한다.
- Gateway는 RuntimeSnapshot의 `providerCatalogRef`로 Provider Catalog body를 별도 조회한다.
- Provider/Model은 enum으로 고정하지 않는다.

RuntimeSnapshot의 Provider Catalog reference 최소 shape:

```json
{
  "providerCatalogRef": {
    "catalogId": "provider_catalog_synthetic_001",
    "catalogVersion": 1,
    "contentHash": "sha256:synthetic-provider-catalog-content-hash"
  }
}
```

Provider Catalog body 조회 경로:

```text
GET admin/v1/provider-catalogs/:catalogId
GET admin/v1/applications/:applicationId/provider-catalog/active
```

원칙:

- `GET admin/v1/provider-catalogs/:catalogId`는 RuntimeSnapshot의 `providerCatalogRef.catalogId`로 조회하는 canonical path다.
- `GET admin/v1/applications/:applicationId/provider-catalog/active`는 application 기준 active catalog를 가져오는 convenience path다.
- Gateway가 active catalog convenience path를 사용하더라도 응답의 `catalogId`, `catalogVersion`, `contentHash`가 RuntimeSnapshot의 `providerCatalogRef`와 모두 일치해야 한다.
- 위 세 값 중 하나라도 일치하지 않으면 Gateway는 해당 Provider Catalog를 사용하지 않는다.
- Gateway는 현재 RuntimeSnapshot의 `providerCatalogRef`와 정확히 일치하는 previously loaded Provider Catalog body가 있으면 그 catalog body를 사용할 수 있다.
- 정확히 일치하는 Provider Catalog body를 조회하거나 재사용할 수 없으면 Gateway는 provider call과 fallback call을 시작하지 않고 요청을 실패 처리한다.
- Provider Catalog mismatch/unavailable failure는 `terminalStatus=failed`, `provider.outcome=not_called`, `fallback.outcome=not_called`, safe error code `provider_catalog_unavailable` 또는 `provider_catalog_mismatch`로 기록한다.
- Provider Catalog 조회는 Gateway 같은 server-side trusted boundary에서만 수행한다. Browser/Employee UI/Customer App이 raw catalog execution config를 직접 조회하지 않는다.
- Application 기준 조회는 tenant/project/application context를 함께 검증해야 하며, `applicationId` 단독 문자열을 client-trusted authorization boundary로 보지 않는다.

Provider Catalog provider entry는 Gateway 실행에 필요한 sanitized execution config를 제공한다.

```json
{
  "providerId": "provider_synthetic_primary",
  "providerName": "openai-main",
  "adapterType": "openai_compatible",
  "enabled": true,
  "baseUrl": "https://api.openai.com/v1",
  "timeoutMs": 30000,
  "credentialRequired": true,
  "credentialRef": {
    "credentialRefId": "credential_ref_synthetic_primary_001",
    "credentialVersion": 1,
    "credentialState": "active"
  },
  "adapterConfig": {
    "requestFormat": "openai_chat_completions"
  },
  "fallbackEligible": false
}
```

Provider entry rules:

- `providerName`은 관리자가 보는 provider/catalog 이름이며 Gateway adapter dispatch key가 아니다.
- `adapterType`은 Gateway가 Provider Adapter를 선택할 때 사용하는 adapter kind다.
- Gateway dispatch는 `providerName`이 아니라 `adapterType` 기준으로 수행한다.
- `adapterType` 값은 catalog/config data이며 DB enum 또는 code enum으로 고정하지 않는다.
- v2.0.0 fixture는 `openai_compatible`과 `mock` adapter type을 포함한다.
- `baseUrl`과 `timeoutMs`는 provider 호출 execution config다.
- `adapterConfig`는 자유 JSON이 아니라 schema allowlist field만 허용한다.
- `adapterConfig.apiVersion`은 Azure-style OpenAI-compatible endpoints 같은 versioned provider APIs를 위한 allowlisted string field다.
- `adapterConfig`는 v2.0.0 core에서 arbitrary headers나 free-form query parameters를 허용하지 않는다.
- Provider Catalog에는 raw Provider Key, Authorization header, secret plaintext, provider raw error body를 넣지 않는다.

Credential boundary:

- `credentialRequired=true`인 provider는 active `credentialRef`가 필요하다.
- `credentialRequired=false`인 provider는 `credentialRef=null`을 사용할 수 있다. 이 값은 Mock/local/no-auth provider를 위한 명시적 no-credential path이며, raw credential material을 대체하는 dummy reference를 요구하지 않는다.
- Control Plane publish validation은 selected/default/low-cost/fallback provider 중 `credentialRequired=true`인 provider의 `credentialRef` 누락, non-active credential state, 지원하지 않는 resolver configuration을 publish 전에 차단한다.
- 필수 provider credential binding 누락은 일반적인 disabled/inactive 상태로 합치지 않고 distinct validation failure로 처리한다. Safe validation error code 후보는 `missing_provider_credential_binding`이다.
- Gateway는 `credentialRef`를 server-side credential resolver로만 해석한다.
- Gateway가 provider call 전에 credential을 resolve하지 못하면 provider call은 발생하지 않으며 safe error code로 기록한다.
- 실제 provider가 401 또는 403을 반환한 경우 `provider.outcome=unauthorized`로 기록한다.
- Provider timeout은 `provider.outcome=timeout`, 기타 sanitized provider failure는 `provider.outcome=error`로 기록한다.

Model entry rules:

- `modelId`는 GateLM 내부 식별자다.
- `modelName`은 provider API에 실제로 보내는 모델명이다.
- `displayName`은 UI 표시명이다.
- Gateway가 의존할 수 있는 model fields는 `modelId`, `modelName`, `enabled`, `capabilities.streamingSupported`, `capabilities.maxInputTokens`, `capabilities.maxOutputTokens`, `capabilities.supportsJsonMode`, `routing.autoRoutingEligible`, `routing.costTier`, `routing.fallbackPriority`다.

### 7.2 Routing

Gateway는 요청 모델과 실제 선택 모델을 구분해서 기록한다.

```text
requestedModel
selectedProvider
selectedModel
routingReason
```

`model=auto`는 v2.0.0에서도 지원한다.

Routing outcome은 작게 유지하고 상세 이유는 `routingReason`으로 둔다.

```json
{
  "routing": {
    "outcome": "selected",
    "requestedModel": "auto",
    "selectedProvider": "openai-compatible",
    "selectedModel": "low-cost-chat-model",
    "routingReason": "short_prompt_low_cost"
  }
}
```

### 7.3 Fallback

Fallback은 terminal status를 대체하지 않는다. 사용자에게 정상 응답이 전달되면 `terminalStatus=success`로 기록하고, degraded path는 provider/fallback domain outcome으로 설명한다.

구분해야 하는 상태:

- primary provider success
- primary provider timeout
- primary provider error
- primary provider unauthorized
- fallback disabled
- fallback success
- fallback failed

## 8. Safety And Cache

### 8.1 Request-Side Safety

Request-side safety는 routing, exact cache, provider call, streaming start보다 먼저 끝나야 한다.

Safety block 시 아래 동작은 발생하지 않아야 한다.

```text
provider call
cache write
streaming start
```

Remote/shadow safety는 evidence track으로 분리한다. v2.0.0 Gateway core 차단 판단은 published RuntimeSnapshot policy 기준으로 수행한다.

### 8.2 Redaction

Redaction 이후 cache/evidence 입력으로 사용할 수 있는 값은 raw prompt가 아니라 normalized redacted prompt 계열이다.

Safety result는 raw value, raw offset, raw prompt fragment를 포함하지 않는다.

Prompt Capture는 RuntimeSnapshot `policies.promptCapture.enabled=true`이고 `mode=log_safe_full`일 때만 Request Detail metadata에 저장할 수 있다. 저장 대상은 request-side masking이 끝난 후의 log-safe prompt이며, raw prompt, raw detected value, raw response, provider raw error body, streaming chunk, Authorization, API/App/Provider key, actual secret은 저장하지 않는다.

`promptHash`, `requestBodyHash`, `cacheKeyHash`는 raw 값은 아니지만 high-cardinality correlation material이다. Internal Gateway context나 evidence storage 후보로만 허용하며, metrics label, Dashboard aggregate label, Employee UI에는 노출하지 않는다. Admin Request Detail 표시 여부는 v2.0.0 freeze 범위 밖의 P1 결정으로 둔다.

### 8.3 Exact Cache

Exact Cache는 v2.0.0 core cache path다.

Exact Cache key 생성과 lookup은 request-side safety 이후, routing/category/provider/model 결정 이후에 수행한다. Cache key에는 provider/model 표시명이 아니라 stable execution identity를 사용한다.

Required routing-aware exact cache material:

```text
tenantId
projectId
applicationId
category
providerId
modelId
providerCatalogHash
routingDecisionKeyHash
cachePolicyHash
normalizedRedactedPrompt
requestParamsHash
```

`providerId`가 없는 catalog-only 경로에서만 `providerCatalogStableKey`를 fallback으로 사용할 수 있다. `providerName`, display name, raw prompt, prompt fragment, raw detected value, secret, provider raw error body는 cache key material에 포함하지 않는다.

`providerCatalogHash`는 RuntimeSnapshot의 `providerCatalogRef.contentHash`와 실제 로드한 Provider Catalog body의 content hash가 일치하는 값을 사용한다. 새 API/DB 필드명이 아니라 exact cache key material 이름이다.

`routingDecisionKeyHash`는 자유 문자열이 아니라 정해진 low-cardinality material을 canonical JSON으로 만든 뒤 hash로 생성한다.

Routing decision canonical material:

```json
{
  "routingMode": "auto | pinned",
  "category": "general | code | translation | support_refund | unknown",
  "tier": "low_cost | balanced | high_quality",
  "capability": "chat | reasoning | code | translation",
  "policyVariant": "default | provider_health_fallback"
}
```

Canonical JSON은 정해진 key 순서를 사용하고, 비어 있는 값은 `unknown` 또는 `default`로 고정한다. Canonical material은 log/detail에 사람이 볼 수 있는 형태로 남길 수 있지만, cache key에는 `routingDecisionKeyHash`를 사용한다. `provider_health_fallback`은 provider/model 후보 상태가 응답 경로를 바꾼 경우에만 사용하는 low-cardinality variant다. 이 variant는 비용 통제를 깨지 않도록 `high_quality` tier로 승격하지 않고, `balanced` 또는 더 낮은 tier 후보만 선택한다.

`stream=true` 요청은 별도 streaming cache contract가 생기기 전까지 Exact Cache lookup/store를 bypass한다.

Allowed cache outcomes:

```text
hit
miss
bypassed
error
not_used
```

Exact Cache hit는 실제 provider bypass로 이어져야 한다.

### 8.4 Semantic Cache

Semantic Cache는 v2.0.0 core response path에 넣지 않는다. Safety/Evaluation evidence track으로만 둔다.

Semantic Cache evidence는 아래 지표와 섞지 않는다.

```text
actual cacheHitRate
actual savedCost
actual provider bypass
```

Semantic Cache experiment도 raw prompt를 사용하지 않는다. redaction 이후 normalized prompt만 사용한다.

### 8.5 Safety Summary Visibility

`safety.outcome`이 canonical safety 결과다.

`maskingAction`, `detectedTypes`, `redactedPromptPreview`는 sanitized summary/display 후보이며 raw detected value, raw offset, raw prompt fragment를 포함하지 않는다. Employee UI는 detector detail과 policy internals를 숨긴다. Admin/Developer UI는 계약된 sanitized summary만 볼 수 있다.

`detectedTypes`와 `detectorSummary.detectorCategories`의 값은 GateLM-normalized detector type label이다. `organization_name`은 조직명/기관명 탐지를 표현하는 v2 safety detector type이며 기본 action 후보는 `redact`다. 이 값은 조직명 원문이나 prompt fragment가 아니라 낮은 cardinality의 sanitized category label만 담는다.

## 9. Streaming Thin Slice

v2.0.0 Streaming은 thin slice로 제한한다.

MUST:

- 사용자에게 응답이 조금씩 오는 체감을 제공한다.
- request-side safety는 streaming 시작 전에 완료한다.
- Request Log/Detail은 우선 final status 중심으로 기록한다.
- client abort는 `terminalStatus=cancelled`로 기록한다.

MUST NOT:

- token별 상세 logging을 v2.0.0 core 범위에 넣지 않는다.
- response-side safety scan을 v2.0.0 main path에 넣지 않는다.
- provider별 streaming normalization을 v2.0.0 core 완료 조건으로 삼지 않는다.

## 10. Request Log, Detail, Dashboard

### 10.1 Request Log / Detail

Request Log와 Request Detail은 Gateway가 생산한 terminal status와 domain outcome을 그대로 소비한다.

Request Detail은 최소 아래 정보를 설명할 수 있어야 한다.

```text
requestId
traceId
tenantId
projectId
applicationId
budgetScopeType
budgetScopeId
budgetScopeResolvedBy
terminalStatus
httpStatus
errorCode
domain outcomes
RuntimeSnapshot provenance
requestedModel
selectedProvider
selectedModel
routingReason
cache outcome
provider outcome
fallback outcome
streaming outcome
latency summary
cost/usage summary
safety summary
promptCapture
```

Request Detail은 full RuntimeSnapshot, raw prompt, raw response, raw provider error body를 포함하지 않는다. `promptCapture.capturedPrompt`는 opt-in 정책이 켜진 경우의 masking 이후 log-safe prompt 예외이며 Request Log list, Dashboard, Metrics에는 표시하거나 집계하지 않는다.

Request Detail 기본 계약은 credential plaintext, API Key/App Token/Provider Key, Authorization header, actual secret을 포함하지 않는다. `apiKeyId`, `appTokenId` 같은 credential ID의 Admin-only 표시 여부는 v2.0.0 freeze 범위 밖의 P1 결정이다.

`cacheHitRequestId`, `promptHash`, `requestBodyHash`, `cacheKeyHash`는 v2.0.0 core Request Detail required field가 아니다. 필요하면 detail-only provenance 후보로 별도 계약에서 검토하며, metrics label이나 Dashboard aggregate label로 사용하지 않는다.

### 10.2 Dashboard Grain

v2.0.0 Dashboard는 아래 grain을 우선 지원한다.

```text
tenant 또는 organization
budget scope
application
provider/model
safety outcome
cache outcome
fallback outcome
```

### 10.3 Freshness Policy

Freshness metadata는 UI에서 숨기지 않는다.

```text
lastIngestedAt
lastAggregatedAt
source
isStale
```

화면별 refresh 정책:

| Surface | Contract |
|---|---|
| Demo Dashboard | 짧은 polling을 허용한다. |
| Operation Overview | 제한된 polling 또는 사용자 선택 refresh interval을 허용한다. |
| Request Detail | 완료된 요청은 자동 갱신하지 않아도 된다. 진행 중/streaming 요청은 짧은 polling을 허용한다. |
| Cost / Analytics / Drilldown | filter apply 또는 manual refresh 중심으로 둔다. 무거운 집계 쿼리를 무제한 자동 실행하지 않는다. |

### 10.4 Query Budget

Dashboard API/read model은 query budget 상태를 표현해야 한다.

허용 상태:

```text
ok
too_broad
partial
stale
unavailable
```

원칙:

- 기본 time range 제한을 둔다.
- 기본 grain 제한을 둔다.
- 큰 범위는 rollup을 우선한다.
- query budget 초과는 시스템 오류가 아니다. UI는 필터 축소 또는 grain 변경을 안내한다.

## 11. Metrics And Performance Interpretation

### 11.1 Metrics Label Safety

Metrics label에는 raw/high-cardinality/sensitive 값을 넣지 않는다.

MUST NOT label:

```text
request_id
trace_id
raw prompt
prompt_hash
request_body_hash
raw response
api_key_id
app_token_id
authorization
provider_key
raw error detail
cache_key_hash
```

Tenant/project/application/budgetScope 단위 분석은 기본적으로 Dashboard read model에서 처리한다. Prometheus-compatible metrics label에 raw ID를 직접 넣는 것은 v2.0.0 기본 계약으로 삼지 않는다.

Status 계열 metrics label은 canonical `terminalStatus` 허용 값만 사용한다. Cache hit, provider error, fallback success는 terminal status label로 합치지 않고 domain outcome 또는 Dashboard read model에서 표현한다.

Provider/model metrics label은 controlled low-cardinality catalog label만 허용한다. 실제 provider/model 도입 후 cardinality가 높아지는 값은 Metrics label이 아니라 Dashboard read model로 보낸다.

Streaming relay metrics는 아래 low-cardinality label만 사용한다.

```text
selected_provider
selected_model
stream_outcome
error_code
```

`stream_outcome` 허용 값:

```text
completed
interrupted
cancelled
```

Streaming metric family:

```text
gatelm_streams_active
gatelm_stream_relay_total
gatelm_stream_duration_seconds
gatelm_stream_time_to_first_token_seconds
```

`gatelm_stream_time_to_first_token_seconds`는 첫 SSE event/chunk가 아니라 Gateway가 첫 non-empty `choices[].delta.content`를 client로 flush하기까지의 시간이다. Role-only chunk, usage-only chunk, empty content chunk는 TTFT로 기록하지 않는다.

### 11.2 Performance Interpretation

- `p95`는 주 성능 기준이다.
- `p99`는 timeout, 지연, 병목 후보 확인 기준이다.
- error rate는 시스템 실패만 포함한다.
- safety block, budget block, rate limited는 정책 결과이며 시스템 실패율과 분리한다.
- Gateway internal latency와 Provider latency를 분리한다.

### 11.3 k6 Baseline Scenarios

v2.0.0 k6 baseline은 최소 아래 시나리오를 구분한다.

```text
baseline_success
cache_hit
cache_miss_provider_call
safety_redaction
safety_block_provider_bypass
rate_limited
provider_timeout
provider_error_mock_fallback
streaming_thin_slice
mixed_demo_traffic
```

## 12. Demo Contract

v2.0.0 발표 데모는 preset scenario runner 중심으로 둔다.

필수 preset:

```text
safe request
exact cache hit
redaction
safety block
rate limit
provider timeout
provider error + mock fallback
streaming thin slice
```

청중 자유 입력은 v2.0.0 core demo가 아니라 제한된 sandbox 후보로 둔다.

Sandbox mode 최소 조건:

- strong rate limit
- safety precheck
- emergency stop
- raw prompt 저장 금지
- Request Log에는 redacted preview만 표시

## 13. JSON Schema And Fixture Targets

이 문서의 현재 최종 JSON Schema와 fixture 기준본은 아래 위치에 둔다.

```text
docs/v2.0.0/schemas/
docs/v2.0.0/fixtures/
```

최종 schema 파일:

```text
dashboard-overview.schema.json
gateway-request-context.schema.json
gateway-stage-outcomes.schema.json
kyumin-frontend-read-model.schema.json
provider-catalog.schema.json
request-detail.schema.json
runtime-snapshot.schema.json
safety-domain-outcome.schema.json
```

최종 fixture 파일은 같은 basename에 `.fixture.json` suffix를 사용한다.

```text
dashboard-overview.fixture.json
gateway-request-context.fixture.json
gateway-stage-outcomes.fixture.json
kyumin-frontend-read-model.fixture.json
provider-catalog.fixture.json
request-detail.fixture.json
runtime-snapshot.fixture.json
safety-domain-outcome.fixture.json
```

규칙:

- JSON Schema dialect는 Draft 2020-12를 사용한다. 여기서 `draft`는 JSON Schema 표준명이며 GateLM 계약 초안이라는 뜻이 아니다.
- `docs/v2.0.0/schemas/draft/`와 `docs/v2.0.0/fixtures/draft/`는 더 이상 기준 위치가 아니다.
- 계약 변경이 필요하면 schema/fixture를 먼저 바꾸지 않는다. `contracts.md`를 먼저 수정하고, 그 다음 schema/fixture를 갱신한다.
- Provider/Model은 enum으로 고정하지 않는다.
- `runtimeSnapshotVersion`은 schema/fixture에서 integer monotonic version으로 통일한다.
- Fixture는 실제 개인정보, 실제 secret, 실제 Authorization header, 실제 Provider Key를 포함하지 않는다.
- `demo-scenario.md`와 demo scenario schema는 발표 동선 합의 후 별도 문서/PR에서 정의한다.

## 14. v2.0.0 Non-Goals

v2.0.0 core 범위에 넣지 않는다.

- raw prompt/raw response 저장 opt-in. masking 이후 log-safe captured prompt opt-in은 Request Detail 예외로 허용한다.
- Semantic Cache를 live response path에 자동 적용
- ClickHouse 필수화
- Redpanda event pipeline 필수화
- token별 streaming 상세 logging
- response-side safety scan main path
- Employee Chat의 Provider 직접 호출
- Web Console의 사용자 LLM 요청 Provider proxy
- department budget scope

## 15. Implementation Order

### 15.1 P0 Freeze Boundaries

v2.0.0 P0 cleanup 전에 freeze된 계약:

- `terminalStatus + domainOutcomes`가 canonical outcome이다.
- Legacy `status/cacheStatus/maskingAction`은 compatibility/read model bridge 전용이다.
- RuntimeSnapshot primary provenance는 `runtimeSnapshotId/runtimeSnapshotVersion/contentHash/runtimeState/publishedAt/publishedBy/gatewayInstanceId`다.
- v1 hash trio는 primary provenance가 아니며 compatibility/read model bridge로만 둔다.
- `runtimeSnapshotVersion`은 integer monotonic version이다.
- Actual runtime provenance state는 `snapshot_active/last_known_safe_used/stale_snapshot_used`만 사용한다.
- `budgetScopeType/budgetScopeId/resolvedBy`는 GatewayContext, Request Log, Request Detail의 resolved budget scope 계약이다.
- Metrics label에는 hash, credential ID, raw error detail, high-cardinality request/detail 값을 넣지 않는다.

v2.0.0에서 frozen 계약으로 보지 않는 항목:

- `p0_llm_invocation_logs` 또는 legacy `status` column의 물리 rename
- `cacheHitRequestId`의 Admin Request Detail 노출 여부
- `apiKeyId/appTokenId`의 Admin Request Detail 노출 여부
- hash field의 Admin Request Detail 노출 여부
- average latency를 Dashboard core KPI로 유지할지 여부
- Semantic Cache live response path

### 15.2 Documentation And Implementation Order

v2.0.0 구현 전 문서/계약 작업은 아래 순서로 진행한다.

1. P0 legacy field cleanup inventory
2. `docs/v2.0.0/implementation-plan.md` 작성
3. `docs/v2.0.0/demo-scenario.md` 작성
4. schema/fixture 변경이 필요한 경우 `contracts.md`를 먼저 수정한 뒤 schema/fixture를 갱신

권장 v1.x release train:

1. P0 legacy field cleanup
2. Actual Provider 1종 + 모델 2개 이상 + Mock fallback
3. RuntimeConfig/RuntimeSnapshot live thin slice
4. Streaming thin slice
5. Traffic simulator + stronger k6/query profile
6. v2.0.0 조직 기반 LLMOps Gateway MVP freeze
