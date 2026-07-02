# Semantic Cache Foundation 검증 문서

## 목적

이 문서는 GateLM v2 릴리즈 전 Semantic Cache foundation 단계의 구현 범위와 검증 기준을 정리한다.

현재 단계의 목표는 Semantic Cache의 config, domain contract, embedding provider contract, in-memory store, cosine similarity, 단위 테스트를 준비하는 것이다. `/v1/chat/completions` 실행 경로에는 아직 연결하지 않는다.

## 범위

포함 범위:

- `SemanticCacheConfig` env 로딩과 기본값 검증
- `SemanticCacheBoundary`, `SemanticCacheEntry`, `SemanticCacheSearchResult`, `SemanticCacheDecision`
- `SemanticCacheStore` interface
- `EmbeddingProvider` interface
- `FakeEmbeddingProvider`
- `CosineSimilarity`
- `InMemorySemanticCacheStore`
- `SemanticCacheService`
- Semantic Cache foundation 단위 테스트

제외 범위:

- `/v1/chat/completions` handler 연결
- provider bypass 구현
- fallback 응답의 semantic cache store/bypass 연결
- `OpenAIEmbeddingProvider`
- OpenAI API 호출
- vector DB, pgvector, Redis vector, Qdrant, Pinecone
- frontend 변경

## 설정

`.env.example`에는 아래 env를 추가한다. 기본값은 Semantic Cache 비활성화다.

```dotenv
SEMANTIC_CACHE_ENABLED=false
SEMANTIC_CACHE_THRESHOLD=0.92
SEMANTIC_CACHE_TOP_K=3
SEMANTIC_CACHE_TTL_SECONDS=3600
SEMANTIC_CACHE_STORE=in_memory
SEMANTIC_CACHE_MAX_ENTRIES=1000
SEMANTIC_CACHE_POLICY_VERSION=v1
SEMANTIC_CACHE_KEY_VERSION=v1

SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake
SEMANTIC_CACHE_EMBEDDING_MODEL=text-embedding-3-small
SEMANTIC_CACHE_EMBEDDING_DIMENSIONS=
SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS=3000
SEMANTIC_CACHE_OPENAI_BASE_URL=https://api.openai.com/v1

SEMANTIC_CACHE_ALLOW_CATEGORIES=general,support_refund
SEMANTIC_CACHE_DENY_CATEGORIES=code,translation,reasoning,sensitive,tool_call,unknown
```

현재 지원값:

- `SEMANTIC_CACHE_STORE=in_memory`
- `SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake`

다른 값은 명시 에러로 처리한다.

`SEMANTIC_CACHE_OPENAI_BASE_URL`과 `SEMANTIC_CACHE_EMBEDDING_MODEL`은 향후 OpenAI embedding provider 연결을 위한 설정 자리만 마련한 것이다. 현재 구현은 `FakeEmbeddingProvider`만 사용하며 OpenAI API를 호출하지 않는다.

## Routing Category 정렬

현재 RoutingDecisionKey material의 `category`는 자유 문자열이 아니라 routing 계약의 낮은 cardinality 값으로 canonical 처리한다. `apps/gateway-core/internal/domain/routing/decision.go`의 canonical category 기준은 아래다.

- `general`
- `code`
- `translation`
- `support_refund`
- `unknown`

`SimpleRouter.DecideRoute`는 Semantic Cache flow 연결 전에 최소 rule-based category classifier를 먼저 실행한다. classifier가 없으면 모든 요청이 `unknown`이 되고, Semantic Cache policy가 `unknown`을 deny하므로 `/v1/chat/completions`에 Semantic Cache를 연결해도 모든 요청이 bypass되는 문제가 생긴다.

현재 classifier는 LLM 호출 없이 prompt text에 대한 cheap rule만 사용한다. category 우선순위는 아래처럼 보수적으로 둔다.

```text
code
-> translation
-> support_refund
-> general
-> unknown
```

`code`, `translation`은 Semantic Cache deny category이므로 먼저 잡는다. `support_refund`는 allow category지만 의미 범위가 좁을 때만 선택한다. `general`은 위 category에 해당하지 않는 일반 자연어 요청의 fallback이며, MVP에서 기존 `faq`, `simple_chat` 역할을 임시로 담당한다. 빈 메시지나 분류에 필요한 입력이 없으면 `unknown`으로 둔다.

예시:

- `배송비도 환불되나요?` -> `support_refund`
- `비밀번호 재설정 방법 알려줘` -> `general`
- `이 문장을 영어로 번역해줘` -> `translation`
- code block, `function`, `class`, `SELECT` 등 코드성 signal 포함 -> `code`
- `환불 정책을 영어로 번역해줘` -> `translation`
- 빈 문자열 -> `unknown`

후속으로 더 정교한 classifier가 붙더라도 `RoutingDecisionMaterial.Category`의 canonical category 계약과 우선순위의 보수적 방향은 유지해야 한다.

Semantic Cache category 정책은 이 routing category와 맞춘다. 이전 foundation 초안의 `faq`, `simple_chat`은 현재 routing 쪽에서 명확히 내보내는 category가 아니므로 MVP 기본 allowlist에서 제외한다.

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

`support_refund`는 의미 범위가 좁아 Semantic Cache 데모에 적합하다. `general`은 현재 MVP에서 `faq`, `simple_chat` 역할을 임시로 대신하는 category다. 후속으로 routing classifier가 `faq`, `simple_chat`을 명확히 내보내게 되면 allowlist를 다시 세분화할 수 있다.

`code`, `translation`, `reasoning`, `sensitive`, `tool_call`, `unknown`은 MVP에서 Semantic Cache 비활성 대상이다. 특히 category가 애매하면 `unknown`으로 보고 bypass한다. allowlist/denylist에 없는 임의 category도 `unknown`으로 canonical 처리하여 cache 허용으로 승격하지 않는다.

## Boundary Material

Semantic Cache는 exact cache와 별도 material을 사용한다. cache boundary에는 아래 값만 포함한다.

| Field | 설명 |
| --- | --- |
| `tenantId` | tenant 경계 |
| `projectId` | project 경계 |
| `applicationId` | application 경계 |
| `promptCategory` | routing/safety 이후의 낮은 cardinality category. MVP allowlist는 `general`, `support_refund`다. |
| `selectedProviderId` | 실행 provider stable identity |
| `selectedModelId` | 실행 model stable identity |
| `providerCatalogContentHash` | provider catalog 변경 감지 |
| `routingPolicyHash` | routing policy 변경 감지 |
| `routingDecisionKeyHash` | canonical RoutingDecisionKey material hash |
| `semanticCachePolicyHash` | Semantic Cache 정책 변경 감지 |
| `safetyPolicyHash` | safety 정책 변경 감지 |
| `maskingPolicyHash` | masking 정책 변경 감지 |
| `requestParamsHash` | temperature 등 응답 영향 parameter 변경 감지 |
| `cacheVersion` | Semantic Cache key/material version |

raw prompt, prompt fragment, detected value, secret, provider raw error는 boundary material에 포함하지 않는다.

## 설계

### Gateway flow에 아직 연결하지 않은 이유

이번 단계는 Semantic Cache 부품의 안전성과 확장성을 먼저 검증하는 foundation 단계다. `/v1/chat/completions`에 바로 연결하면 exact cache miss 이후 semantic lookup, provider 호출 생략, provider 성공 응답 store, request log/detail decision 기록까지 한 번에 변경되어 검증 범위가 커진다.

따라서 현재 PR에서는 Gateway 실행 경로를 바꾸지 않고, 다음 단계에서 연결할 수 있는 domain contract와 테스트 가능한 store/provider만 준비한다.

### `EmbeddingProvider` interface

`EmbeddingProvider`는 normalized text를 embedding vector로 바꾸는 domain interface다.

현재 책임:

- `Embed(ctx, input)`
- `ProviderName()`
- `ModelName()`

주의:

- raw prompt, raw PII, API Key, App Token, Provider Key는 input으로 받지 않는다.
- 실제 provider 호출은 이번 단계에서 하지 않는다.
- `FakeEmbeddingProvider`만 구현한다.

### `FakeEmbeddingProvider`

`FakeEmbeddingProvider`는 테스트용 deterministic fake다.

- 네트워크 호출이 없다.
- API Key가 필요 없다.
- 같은 입력은 항상 같은 vector를 반환한다.
- `"비밀번호 재설정 방법 알려줘"`와 `"패스워드 초기화는 어떻게 해?"`는 threshold 이상 유사도가 나오도록 고정한다.
- `"이번 달 사용량 통계를 보여줘"`는 위 password reset pair와 threshold 미만이 나오도록 고정한다.

이 fake vector는 실제 OpenAI embedding 결과가 아니다. 실제 OpenAI embedding은 고차원 float vector이며, provider/model별 출력 특성과 차원이 다르다. 이 구현은 Semantic Cache hit/miss/threshold 로직을 deterministic하게 테스트하기 위한 테스트 대역이다.

### `SemanticCacheStore` interface

`SemanticCacheStore`는 특정 인프라 이름을 드러내지 않는 domain interface다.

현재 책임:

- `Search(ctx, boundary, vector, threshold, topK)`
- `Upsert(ctx, entry)`

Redis, Postgres, pgvector, Qdrant 같은 구현체 이름은 interface 메서드에 포함하지 않는다.

`SemanticCacheService`는 `SemanticCacheStore` interface와 `EmbeddingProvider` interface에만 의존한다. 따라서 handler가 향후 연결되더라도 `InMemorySemanticCacheStore` 구현체를 직접 알 필요가 없다.

현재 store factory는 `in_memory`만 생성한다. 향후 pgvector store를 추가할 때는 `SemanticCacheStore` interface를 유지하고, factory 선택지만 확장한다.

현재 embedding provider factory는 `fake`만 생성한다. 향후 OpenAI embedding provider를 추가할 때는 `EmbeddingProvider` interface를 구현하고, normalized input만 받도록 유지한다.

## InMemory Store 한계

`InMemorySemanticCacheStore`는 foundation 테스트용 구현이다.

- 프로세스 로컬 메모리만 사용한다.
- 운영용 persistence를 보장하지 않는다.
- 재시작 시 데이터가 사라진다.
- 여러 gateway instance 간 공유되지 않는다.
- 대규모 vector search 성능을 보장하지 않는다.
- vector index가 없고 linear scan을 사용한다.
- `maxEntries` 초과 시 `CreatedAt`이 가장 오래된 entry부터 제거한다.
- 이번 단계에서는 provider bypass를 구현하지 않는다. 다만 다음 단계에서 provider bypass 연결을 검증할 때 사용할 MVP store 구현체다.

pgvector store를 붙일 때 예상 변경 범위:

- 새 migration 추가
- `PgVectorSemanticCacheStore` 구현 추가
- config/factory에 `pgvector` 등록
- pgvector 전용 integration test 추가
- TTL/eviction을 DB 또는 vector store 정책에 맞게 위임
- similarity search를 DB/vector index로 대체

목표:

- handler 수정 최소화
- `SemanticCacheService` 핵심 로직 수정 최소화
- `SemanticCacheBoundary`, `SemanticCacheDecision` 타입 재사용
- 기존 Fake/InMemory 테스트 유지

## 보안 / 개인정보

현재 구현은 아래 값을 Semantic Cache key/value/log material로 사용하지 않는다는 전제를 둔다.

- raw prompt
- raw PII
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- provider raw response body
- actual secret

`InMemorySemanticCacheStore.Upsert`는 `CachedResponse`에 위 금지 marker가 포함되면 `ErrSemanticCachePayloadUnsafe`로 저장을 거부한다.

## 테스트 매핑

| ID | 검증 내용 | 테스트 |
| --- | --- | --- |
| SC-FOUNDATION-001 | config 기본값과 disabled default | `TestSemanticCacheConfigDefaults` |
| SC-FOUNDATION-002 | config invalid value 처리 | `TestSemanticCacheConfigInvalidValues` |
| SC-FOUNDATION-003 | fake embedding deterministic | `TestSemanticFakeEmbeddingProviderDeterministic` |
| SC-FOUNDATION-004 | cosine similarity 안전 처리 | `TestSemanticCosineSimilarity` |
| SC-FOUNDATION-005 | in-memory semantic hit | `TestSemanticInMemoryStoreHit` |
| SC-FOUNDATION-006 | threshold miss | `TestSemanticInMemoryStoreMissByThreshold` |
| SC-FOUNDATION-007 | boundary miss | `TestSemanticInMemoryStoreMissByBoundary` |
| SC-FOUNDATION-008 | TTL expired miss | `TestSemanticInMemoryStoreTTLExpired` |
| SC-FOUNDATION-009 | topK ordering | `TestSemanticInMemoryStoreTopKOrdering` |
| SC-FOUNDATION-010 | maxEntries eviction | `TestSemanticInMemoryStoreMaxEntriesPolicy` |
| SC-FOUNDATION-011 | raw secret 저장 차단 | `TestSemanticInMemoryStoreRejectsForbiddenSensitivePayload` |
| SC-CATEGORY-001 | config default category가 routing category 계약과 정렬됨 | `TestSemanticCacheConfigDefaultCategoriesUseRoutingContract` |
| SC-CATEGORY-002 | `general`, `support_refund`는 Semantic Cache 후보가 될 수 있음 | `TestSemanticCacheCategoryPolicyAllowsRoutingMVPAllowlist` |
| SC-CATEGORY-003 | 위험 category는 bypass 대상임 | `TestSemanticCacheCategoryPolicyDeniesRiskyCategories` |
| SC-CATEGORY-004 | 알 수 없는 category는 안전하게 bypass됨 | `TestSemanticCacheCategoryPolicyDeniesUnknownCategoryValues` |
| RT-CATEGORY-001 | 환불 요청은 `support_refund`로 분류됨 | `TestSimpleRouterClassifiesRoutingCategory` |
| RT-CATEGORY-002 | 일반 자연어 요청은 `general`로 분류됨 | `TestSimpleRouterClassifiesRoutingCategory` |
| RT-CATEGORY-003 | 번역 요청은 `translation`으로 분류됨 | `TestSimpleRouterClassifiesRoutingCategory` |
| RT-CATEGORY-004 | 코드성 요청은 `code`로 분류됨 | `TestSimpleRouterClassifiesRoutingCategory` |
| RT-CATEGORY-005 | 빈 입력은 `unknown`으로 분류됨 | `TestSimpleRouterClassifiesRoutingCategory` |
| RT-CATEGORY-006 | 위험 category가 allow category보다 우선됨 | `TestSimpleRouterClassifiesRoutingCategory` |
| RT-CATEGORY-007 | category가 바뀌면 `routingDecisionKeyHash`도 바뀜 | `TestRoutingDecisionKeyHashChangesWhenCategoryChanges` |
| RT-CATEGORY-008 | routing stage와 기존 exact cache routing-aware 테스트 유지 | `TestStageWritesRoutingCategoryMaterial`, `TestChatCompletionsExactCacheRoutingAware*` |

## 검증 명령

```powershell
go test -v ./apps/gateway-core/internal/domain/cache -run 'Test.*Semantic.*' -count=1
go test -v ./apps/gateway-core/internal/config -run 'Test.*Semantic.*' -count=1
go test ./apps/gateway-core/... -count=1
```

문서와 전체 v2 검증은 아래 명령으로 확인한다.

```powershell
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

## 다음 단계

다음 단계에서는 Gateway 실행 경로에 Semantic Cache를 연결한다.

- `/v1/chat/completions` flow에서 exact cache miss 이후 semantic cache lookup 연결
- semantic cache hit 시 provider 호출 생략
- provider 성공 응답 semantic cache store
- request log/detail에 semantic cache decision 추가
- 이후 `OpenAIEmbeddingProvider` optional smoke test 추가
