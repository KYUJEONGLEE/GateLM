# Semantic Cache OpenAIEmbeddingProvider 검증 문서

## 목적

이 문서는 Semantic Cache MVP에서 `OpenAIEmbeddingProvider`를 opt-in으로 사용하는 방법과 검증 기준을 정리한다.

중요한 결론은 아래다.

- 기본값은 계속 `SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake`다.
- 기본 테스트와 로컬 부팅은 `OPENAI_API_KEY` 없이 통과해야 한다.
- `SEMANTIC_CACHE_ENABLED=true`와 `SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai`를 함께 쓰는 경우에만 `OPENAI_API_KEY`가 필수다.
- OpenAI embedding 실패는 Gateway 요청 실패가 아니다. Semantic Cache만 `embedding_failure`로 처리하고 provider flow를 계속 탄다.

## 지원 범위

이번 구현에서 지원하는 것:

- `SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai`
- OpenAI Embeddings API `POST /embeddings`
- request body의 `input`, `model`, optional `dimensions`
- response body의 `data[0].embedding`
- `InMemorySemanticCacheStore`와 기존 `SemanticCacheService` 재사용
- 실제 OpenAI API smoke test는 opt-in skip 방식

이번 구현에서 제외하는 것:

- Chat Completion model 구현
- pgvector, Redis Vector, Qdrant, Pinecone
- production vector DB 운영 검증
- frontend 변경
- raw prompt/raw response 저장 opt-in

## Env 계약

기본값:

```dotenv
SEMANTIC_CACHE_ENABLED=false
SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake
SEMANTIC_CACHE_EMBEDDING_MODEL=text-embedding-3-small
SEMANTIC_CACHE_EMBEDDING_DIMENSIONS=
SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS=3000
SEMANTIC_CACHE_OPENAI_BASE_URL=https://api.openai.com/v1
```

`SEMANTIC_CACHE_OPENAI_BASE_URL`은 그대로 사용하고 뒤에 `/embeddings`만 붙인다. 기본값은 OpenAI 공식 경로에 맞춰 `/v1`을 포함하지만, Azure OpenAI, 사내 gateway, 로컬 OpenAI-compatible endpoint처럼 다른 path를 쓰는 경우에는 필요한 path를 env 값에 직접 넣어야 한다.

OpenAI embedding을 실제로 켤 때:

```dotenv
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_STORE=in_memory
SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai
SEMANTIC_CACHE_EMBEDDING_MODEL=text-embedding-3-small
SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS=3000
SEMANTIC_CACHE_OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=실제 키
```

validation 규칙:

- `SEMANTIC_CACHE_ENABLED=false`이면 `OPENAI_API_KEY`가 없어도 config load는 성공해야 한다.
- `SEMANTIC_CACHE_ENABLED=true`이고 `SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai`이면 `OPENAI_API_KEY`가 없을 때 config load는 실패해야 한다.
- `SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake`는 `OPENAI_API_KEY`를 요구하지 않는다.
- `SEMANTIC_CACHE_STORE=pgvector`, `SEMANTIC_CACHE_STORE=redis_vector`는 아직 unsupported error다.

## 보안 규칙

`OPENAI_API_KEY`는 OpenAI request의 `Authorization: Bearer ...` header에만 사용한다.

아래 값은 cache key, cache value, structured log, metric label, test fixture에 평문으로 남기지 않는다.

- raw prompt
- raw response
- raw PII
- API Key
- App Token
- Provider Key
- Authorization header
- OpenAI raw request body
- OpenAI raw response body
- OpenAI raw error body
- actual secret

OpenAI non-2xx 응답은 status code만 포함한 안전한 error로 바꾼다. raw error body는 읽어서 버리며 error message에 포함하지 않는다.

## 실패 동작

OpenAI embedding 호출이 실패하면 `SemanticCacheService.Search` 또는 `SemanticCacheService.Upsert`는 `embedding_failure` decision을 반환한다.

Gateway handler 기대 동작:

- semantic cache hit로 처리하지 않음
- provider 호출 흐름 유지
- Gateway 응답 자체는 embedding 실패 때문에 실패하지 않음
- provider 성공 응답을 semantic cache에 store하지 않음
- request log에는 `semanticCacheDecisionReason=embedding_failure`, `embeddingProvider=openai`만 남김

## 테스트

기본 테스트:

```powershell
go test -v ./apps/gateway-core/internal/config -run 'Test.*Semantic.*|Test.*Embedding.*|Test.*OpenAI.*' -count=1
go test -v ./apps/gateway-core/internal/domain/cache -run 'Test.*Semantic.*|Test.*Embedding.*|Test.*OpenAI.*' -count=1
go test -v ./apps/gateway-core/internal/http/handlers -run 'Test.*SemanticCache.*|Test.*OpenAI.*' -count=1
go test ./apps/gateway-core/... -count=1
corepack pnpm run verify:v2-final
```

실제 OpenAI API smoke test:

```powershell
$env:SEMANTIC_CACHE_OPENAI_SMOKE="1"
$env:OPENAI_API_KEY="실제 키"
go test -v ./apps/gateway-core/internal/domain/cache -run 'TestOpenAIEmbeddingProviderSmokeKoreanSimilarity' -count=1
```

`SEMANTIC_CACHE_OPENAI_SMOKE=1`이 없으면 smoke test는 skip된다. `OPENAI_API_KEY`가 없어도 skip된다.

## 테스트 매핑

| 검증 | 테스트 |
| --- | --- |
| disabled 상태에서 openai provider config가 missing key로 실패하지 않음 | `TestSemanticCacheConfigInvalidValues/openai embedding provider is allowed while semantic cache is disabled` |
| enabled openai provider는 `OPENAI_API_KEY` 필요 | `TestSemanticCacheConfigInvalidValues/enabled openai embedding provider requires OPENAI_API_KEY` |
| OpenAI request path/body/header | `TestOpenAIEmbeddingProviderSendsExpectedRequest` |
| OpenAI raw error body/API key 미노출 | `TestOpenAIEmbeddingProviderDoesNotLeakSecretsOrRawErrorBody` |
| factory에서 openai provider 생성 | `TestOpenAIEmbeddingProviderFactoryCreatesOpenAIProvider` |
| embedding 실패 시 Gateway provider flow 유지 | `TestChatCompletionsSemanticCacheOpenAIEmbeddingFailureContinuesProviderFlow` |
| 실제 한국어 유사 pair smoke | `TestOpenAIEmbeddingProviderSmokeKoreanSimilarity` |

## 참고

OpenAI 공식 API reference 기준으로 Embeddings API는 `POST /embeddings` endpoint에 `input`, `model`, optional `dimensions`를 보내고, response의 `data[].embedding` vector를 사용한다.
