# Semantic Cache Flow Integration 검증 문서

## 목표

이번 단계의 목표는 Semantic Cache foundation을 `/v1/chat/completions` Gateway flow에 연결하는 것이다.

Semantic Cache는 Exact Cache 뒤, Provider 호출 전에 위치한다. Exact Cache hit가 나면 Semantic Cache lookup은 하지 않는다. Semantic Cache hit가 나면 provider를 호출하지 않고 저장된 `CachedResponse`를 반환한다. Semantic Cache miss면 기존 provider 호출 흐름을 그대로 탄다.

## dev merge 후 재검증 결과

2026-07-02 dev 기준으로 PR #142 merge 이후 Semantic Cache 정책을 재검증했다.

확인한 내용:

- Semantic Cache 기본값은 disabled다.
- `SEMANTIC_CACHE_ENABLED=true`에서도 위험 category는 lookup/store 모두 bypass된다.
- `general`, `support_refund`는 allow category로 semantic hit 후보가 될 수 있다.
- Exact Cache hit가 나면 Semantic Cache lookup을 호출하지 않는다.
- `applicationId`, `selectedProviderId`, `selectedModelId`, `routingPolicyHash`, `routingDecisionKeyHash`, `promptCategory`가 다르면 semantic hit가 나지 않는다.
- raw prompt, API Key, App Token, Provider Key, Authorization header, provider raw body/error marker는 Semantic Cache key/value/log에 남기지 않는다.
- `OpenAIEmbeddingProvider`는 opt-in으로 지원한다. 기본 provider는 계속 `fake`이고, 일반 테스트는 OpenAI API를 호출하지 않는다.

## 1단계 Foundation과의 차이

1단계 foundation은 아래 부품만 준비했다.

- `SemanticCacheConfig`
- `EmbeddingProvider` interface
- `FakeEmbeddingProvider`
- `SemanticCacheStore` interface
- `InMemorySemanticCacheStore`
- `SemanticCacheBoundary`
- `SemanticCacheEntry`
- `SemanticCacheSearchResult`
- `SemanticCacheDecision`
- category policy

이번 단계는 위 부품을 handler flow에 연결한다. OpenAI embedding provider는 별도 opt-in provider로 붙었지만, 아래는 여전히 제외한다.

- 기본 테스트에서 OpenAI API 호출
- pgvector, Redis Vector Search, Qdrant, Pinecone
- frontend 변경
- production vector DB 운영 검증

## Gateway Flow 삽입 위치

변경 후 주요 흐름은 아래다.

```text
auth/app-token 검증
-> tenant/project/application 식별
-> RuntimeSnapshot load
-> request-side masking/block
-> category/routing/provider/model 결정
-> exact cache lookup
-> exact cache hit이면 응답 반환
-> semantic cache lookup
-> semantic cache hit이면 provider 호출 없이 cached response 반환
-> semantic cache miss이면 provider 호출
-> provider 성공 응답이면 exact cache store
-> provider 성공 응답이면 semantic cache store
-> request log 저장
```

`stream=true`, safety block, auth failure는 Semantic Cache lookup/store에 도달하지 않는다.

## Hit / Miss / Bypass / Store 조건

### Lookup 조건

- `SEMANTIC_CACHE_ENABLED=true`
- `stream=false`
- safety block 아님
- auth failure 아님
- Exact Cache hit 아님
- category allowlist
- boundary 생성 성공
- masking 이후 normalized text 생성 성공
- embedding 생성 성공

### Hit 조건

- 같은 `SemanticCacheBoundary`
- similarity가 `SEMANTIC_CACHE_THRESHOLD` 이상
- `SemanticCacheStore.Search`가 matched entry 반환

hit 시 기대 결과:

- `cacheType=semantic`
- `cacheOutcome=hit`
- `providerCalled=false`
- `semanticCacheHit=true`
- `semanticMatchedRequestId`가 원본 requestId를 가리킴

### Miss 조건

- boundary는 유효하지만 matched entry 없음
- similarity가 threshold 미만
- 같은 prompt라도 selected provider/model/routing material 등이 다름

miss 시 provider 호출 흐름을 유지한다.

### Bypass 조건

- `SEMANTIC_CACHE_ENABLED=false`
- Exact Cache hit
- `stream=true`
- safety block
- auth failure
- category denylist 또는 `unknown`
- boundary 생성 실패
- normalized embedding input 생성 실패
- embedding 생성 실패

`OpenAIEmbeddingProvider` 사용 중 embedding 생성이 실패해도 Gateway 요청은 실패하지 않는다. 이 경우 Semantic Cache는 `embedding_failure`로 miss/bypass 성격의 decision을 남기고 provider 호출 흐름을 계속 탄다.

### Store 조건

- Semantic Cache enabled
- category allowlist
- exact cache miss
- semantic cache miss
- `stream=false`
- safety block 아님
- provider 성공 응답
- fallback 발생 아님
- provider error 아님
- cached response payload 안전성 검사 통과

Store 금지:

- `stream=true`
- fallback response
- provider error
- safety block
- auth failure
- category denylist
- raw PII/secret/provider raw body 위험 payload

## Category Policy

MVP allowlist:

- `general`
- `support_refund`

MVP denylist:

- `code`
- `translation`
- `reasoning`
- `sensitive`
- `tool_call`
- `unknown`

category가 비어 있거나 애매하면 `unknown`으로 보고 bypass한다.

## Category 평가셋 계약

Routing category classifier는 dev merge 후 아래 fixture로 최소 평가셋을 고정한다.

```text
apps/gateway-core/internal/domain/routing/testdata/category_eval_cases.json
```

canonical category:

- `general`
- `code`
- `translation`
- `support_refund`
- `unknown`

우선순위:

```text
code -> translation -> support_refund -> general -> unknown
```

평가셋은 한국어 demo 기준 요청을 포함한다.

- `general`: 비밀번호 재설정, API Key 발급, 사용량 확인, 계정 설정, 대시보드 위치
- `support_refund`: 배송비 환불, 반품 배송비, 주문 취소, 결제 취소, 교환/환불, 환불 정책
- `code`: 코드 설명, 함수 error, 컴파일 오류, 실행 bug, SQL query, code block
- `translation`: 영어/한국어/일본어/중국어 번역, 영문 변환
- `unknown`: 빈 문자열, 공백 문자열, user message 없음

priority case:

- `환불 정책을 영어로 번역해줘` -> `translation`
- `이 코드를 영어로 번역해줘` -> `code`

검증 테스트:

- `TestCategoryEvalCasesFromFixture`
- `TestSimpleRouterClassifiesRoutingCategory`
- `TestKoreanCategoryClassifierCoverage`

## Semantic Cache ON 위험 category bypass

`SEMANTIC_CACHE_ENABLED=true` 상태에서도 아래 category는 Semantic Cache lookup/store를 호출하지 않는다.

- `code`
- `translation`
- `reasoning`
- `sensitive`
- `tool_call`
- `unknown`

통과 기준:

- `SemanticCacheService.Search` 호출 없음
- `SemanticCacheService.Upsert` 호출 없음
- provider flow는 유지되어 `providerCalled=true`
- request log에는 `semanticCacheDecisionReason=semantic_category_disabled`
- deny category는 `cacheType=semantic`으로 혼동 기록되지 않음

검증 테스트:

- `TestChatCompletionsSemanticCacheCategoryDenylistBypasses`
- `TestChatCompletionsSemanticCacheKoreanRequests/code category bypasses`
- `TestChatCompletionsSemanticCacheKoreanRequests/translation category bypasses`

## Allow category 재검증

`general`과 `support_refund`는 Semantic Cache 후보가 될 수 있다.

`general` hit pair:

- 첫 요청: `비밀번호 재설정 방법 알려줘`
- 두 번째 요청: `패스워드 초기화는 어떻게 해?`

기대:

- 첫 요청 `providerCalled=true`
- 두 번째 요청 `providerCalled=false`
- 두 번째 요청 `cacheType=semantic`
- 두 번째 요청 `semanticCacheHit=true`
- `semanticMatchedRequestId`가 첫 요청 requestId

`support_refund` hit pair:

- 첫 요청: `배송비도 환불되나요?`
- 두 번째 요청: `반품하면 배송비도 돌려받나요?`

기대:

- 같은 boundary 안에서 fake embedding similarity가 threshold 이상
- 두 번째 요청 `providerCalled=false`
- 두 번째 요청 `cacheType=semantic`

검증 테스트:

- `TestChatCompletionsSemanticCacheSimilarSecondRequestHits`
- `TestChatCompletionsSemanticCacheKoreanRequests/similar requests hit`
- `TestChatCompletionsSemanticCacheKoreanRequests/support refund similar requests hit`

## Boundary Fields

Semantic Cache boundary는 routing-aware material만 사용한다.

| Field | 설명 |
| --- | --- |
| `tenantId` | tenant 경계 |
| `projectId` | project 경계 |
| `applicationId` | application 경계 |
| `promptCategory` | `RoutingDecisionMaterial.Category` |
| `selectedProviderId` | routing 이후 확정된 provider stable identity |
| `selectedModelId` | routing 이후 확정된 model stable identity |
| `providerCatalogContentHash` | provider catalog 변경 감지 |
| `routingPolicyHash` | routing policy 변경 감지 |
| `routingDecisionKeyHash` | canonical routing decision material hash |
| `semanticCachePolicyHash` | Semantic Cache policy version/hash |
| `safetyPolicyHash` | safety policy 변경 감지 |
| `maskingPolicyHash` | masking policy 변경 감지 |
| `requestParamsHash` | temperature 등 응답 영향 parameter 변경 감지 |
| `cacheVersion` | Semantic Cache key/material version |

raw prompt, raw PII, API Key, App Token, Provider Key, Authorization header, provider raw error, provider raw response body는 boundary에 넣지 않는다.

dev merge 후 boundary isolation 재검증 범위:

- `applicationId` 다르면 hit 금지
- `selectedProviderId` 다르면 hit 금지
- `selectedModelId` 다르면 hit 금지
- `routingPolicyHash` 다르면 hit 금지
- `routingDecisionKeyHash` 다르면 hit 금지
- `promptCategory` 다르면 hit 금지

검증 테스트:

- `TestChatCompletionsSemanticCacheTenantProjectApplicationIsolation`
- `TestChatCompletionsSemanticCacheSelectedProviderIdIsolation`
- `TestChatCompletionsSemanticCacheSelectedModelIdIsolation`
- `TestChatCompletionsSemanticCacheRoutingPolicyHashIsolation`
- `TestChatCompletionsSemanticCacheRoutingDecisionKeyHashIsolation`
- `TestChatCompletionsSemanticCachePromptCategoryIsolation`
- domain boundary 전체 field 검증은 `TestSemanticInMemoryStoreMissByBoundary`

## Request Log / Detail Fields

Request Log metadata와 Request Detail에서 아래 정보를 확인할 수 있어야 한다.

- `cacheType`
- `cacheOutcome`
- `providerCalled`
- `semanticCacheHit`
- `semanticSimilarity`
- `semanticMatchedRequestId`
- `semanticCacheThreshold`
- `semanticCachePolicyVersion`
- `semanticCacheDecisionReason`
- `embeddingProvider`
- `promptCategory`
- `selectedProviderId`
- `selectedModelId`
- `routingPolicyHash`
- `routingDecisionKeyHash`

`semanticCacheDecisionReason`은 사람이 hit/miss/bypass/store 이유를 확인하기 위한 sanitized low-cardinality 값이다.

## Handler Integration Test 목록

| ID | 테스트 |
| --- | --- |
| SC-HANDLER-001 | `TestChatCompletionsSemanticCacheDisabledKeepsExistingFlow` |
| SC-HANDLER-002 | `TestChatCompletionsSemanticCacheFirstRequestMissThenStores` |
| SC-HANDLER-003 | `TestChatCompletionsSemanticCacheSimilarSecondRequestHits` |
| SC-HANDLER-004 | `TestChatCompletionsSemanticCacheThresholdMissCallsProvider` |
| SC-HANDLER-005 | `TestChatCompletionsSemanticCacheExactHitHasPriority` |
| SC-HANDLER-006 | `TestChatCompletionsSemanticCacheCategoryDenylistBypasses` |
| SC-HANDLER-007 | `TestChatCompletionsSemanticCacheTenantProjectApplicationIsolation` |
| SC-HANDLER-008 | `TestChatCompletionsSemanticCacheSelectedProviderIdIsolation` |
| SC-HANDLER-009 | `TestChatCompletionsSemanticCacheSelectedModelIdIsolation` |
| SC-HANDLER-010 | `TestChatCompletionsSemanticCacheRoutingPolicyHashIsolation` |
| SC-HANDLER-011 | `TestChatCompletionsSemanticCacheRoutingDecisionKeyHashIsolation` |
| SC-HANDLER-012 | `TestChatCompletionsSemanticCachePromptCategoryIsolation` |
| SC-HANDLER-013 | `TestChatCompletionsSemanticCacheStreamBypassesLookupAndStore` |
| SC-HANDLER-014 | `TestChatCompletionsSemanticCacheFallbackResponseDoesNotStore` |
| SC-HANDLER-015 | `TestChatCompletionsSemanticCacheProviderErrorDoesNotStore` |
| SC-HANDLER-016 | `TestChatCompletionsSemanticCacheSafetyBlockBypassesLookupAndStore` |
| SC-HANDLER-017 | `TestChatCompletionsSemanticCacheDoesNotPersistRawPromptOrSecrets` |
| SC-HANDLER-018 | `TestChatCompletionsSemanticCacheOpenAIEmbeddingFailureContinuesProviderFlow` |

추가로 `TestChatCompletionsSemanticCacheAuthFailureBypassesLookupAndStore`에서 auth failure가 Semantic Cache에 도달하지 않는 것도 확인한다.

## 수동 검증 방법

### 1. Semantic Cache OFF

설정:

```dotenv
SEMANTIC_CACHE_ENABLED=false
```

절차:

1. `비밀번호 재설정 방법 알려줘` 요청
2. `패스워드 초기화는 어떻게 해?` 요청
3. 두 요청 모두 provider가 호출되는지 확인

통과 기준:

- `providerCalled=true`
- `cacheType`이 `semantic` hit로 표시되지 않음

### 2. Semantic Cache ON + first miss

설정:

```dotenv
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_STORE=in_memory
SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake
```

절차:

1. `비밀번호 재설정 방법 알려줘` 요청
2. Request Detail 확인

통과 기준:

- `providerCalled=true`
- `cacheType=semantic`
- `cacheOutcome=miss`
- `semanticCacheDecisionReason=stored` 또는 miss/store에 해당하는 low-cardinality reason

### 2-1. Semantic Cache ON + OpenAI Embedding opt-in

설정:

```dotenv
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_STORE=in_memory
SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai
SEMANTIC_CACHE_EMBEDDING_MODEL=text-embedding-3-small
SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS=3000
SEMANTIC_CACHE_OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=실제 키
```

통과 기준:

- `OPENAI_API_KEY`는 Authorization header에만 사용
- OpenAI raw request/response/error body는 log/cache material에 저장하지 않음
- OpenAI embedding 실패 시 Gateway provider flow는 유지
- 실제 OpenAI 호출 smoke는 `SEMANTIC_CACHE_OPENAI_SMOKE=1`일 때만 실행

### 3. Semantic Cache ON + similar hit

절차:

1. first miss 요청 후 같은 application/provider/model/routing boundary 유지
2. `패스워드 초기화는 어떻게 해?` 요청
3. Request Detail 확인

통과 기준:

- `providerCalled=false`
- `cacheType=semantic`
- `semanticCacheHit=true`
- `semanticMatchedRequestId`가 첫 요청 requestId

### 4. Category deny

절차:

1. code 또는 translation 요청 전송
2. Request Detail 확인

통과 기준:

- semantic lookup/store 없음
- `semanticCacheDecisionReason=semantic_category_disabled`
- provider flow 유지

### 5. Boundary isolation

절차:

1. allow category 요청으로 semantic entry 생성
2. `selectedModelId` 또는 `applicationId`를 바꿔 유사 요청 전송

통과 기준:

- semantic hit 금지
- `providerCalled=true`

## Security / Privacy

Semantic Cache는 아래 값을 key/value/log/metric label에 평문 저장하지 않는다.

- raw prompt
- raw PII
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error
- provider raw response body

Boundary는 stable execution identity와 policy hash/version만 포함한다. Cached response는 store 전에 unsafe payload marker 검사를 통과해야 한다.

## 한계

- `OpenAIEmbeddingProvider`는 opt-in으로만 지원한다.
- `InMemorySemanticCacheStore`는 운영용 persistence나 cross-instance 공유를 보장하지 않는다.
- production vector DB는 아직 도입하지 않았다.
- 기본 테스트는 fake embedding으로 hit/miss flow를 검증한다. 실제 semantic similarity 품질은 opt-in smoke와 별도 평가가 필요하다.

## 다음 단계

- pgvector 또는 production vector DB store 검토
- semantic similarity 품질과 threshold tuning 검증
