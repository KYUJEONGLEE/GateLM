# Semantic Cache Embedding Input 일반 전처리 설계

## 목적

이 문서는 GateLM v2 Semantic Cache에서 embedding provider에 보내기 전 수행할 일반 전처리 정책을 정의한다.

이번 작업은 구현 전 설계다. production code, API, DB, Event, Metrics 계약은 변경하지 않는다.

목표는 사용자 prompt의 의미를 강제로 바꾸는 것이 아니라, embedding input에 들어가는 잡음을 줄이는 것이다.

명시적으로 제외하는 방식:

- `canonical template`으로 모든 문장을 같은 `embedding text`로 고정
- `intent rule`로 문장을 강제로 같은 embedding input으로 변환
- 특정 문장, 특정 intent, 특정 synonym을 하드코딩해서 similarity를 올리는 방식
- 실시간 LLM 호출로 prompt를 rewrite하는 방식

허용하는 방식:

- whitespace normalize
- Unicode normalize
- masking 이후 text 사용
- 마지막 user message 중심 input 선택
- system/developer/assistant message 제외
- category deny 대상은 embedding 전 bypass
- 긴 prompt 제한 또는 windowing

## 전처리 목적과 한계

### 목적

일반 전처리의 목적은 아래다.

- 같은 사용자 의도가 불필요한 공백, 개행, Unicode form 차이 때문에 다른 vector로 흔들리는 문제를 줄인다.
- system/developer/assistant message가 user intent vector를 희석하지 않게 한다.
- masking 전 raw secret이 embedding provider로 전송되지 않게 한다.
- code/translation/tool_call/unknown 같은 deny category가 embedding provider까지 가지 않게 한다.
- 너무 긴 prompt가 핵심 요청보다 주변 문맥으로 vector를 오염시키는 일을 줄인다.

### 한계

일반 전처리는 retrieval 품질을 크게 보장하지 않는다.

- 짧은 한국어 paraphrase score가 낮게 나오는 문제를 전처리만으로 해결할 수 없다.
- 서로 다른 의도인데 표현이 비슷한 hard negative를 전처리만으로 막을 수 없다.
- category classifier 오분류를 전처리만으로 복구할 수 없다.
- response 재사용 가능성은 여전히 `category`, `canonicalIntent`, `requiredSlots`, `hardNegative`, `dynamic_user_state`, `SemanticCacheBoundary` 정책이 판단해야 한다.

즉 전처리는 성능 개선의 전부가 아니라 embedding input hygiene이다.

## 처리 순서

권장 처리 순서는 아래다.

```text
1. request auth / app token validation
2. request body parse
3. stream/tool_call/code/translation/unknown 등 bypass category 판단
4. message role 분리
5. last user message 후보 선택
6. masking/redaction 적용
7. forbidden data scan
8. Unicode normalize
9. whitespace normalize
10. markdown/code block 정책 적용
11. 길이 제한 또는 windowing
12. dynamic_user_state guard
13. safe embedding input 생성
14. OpenAI/fake embedding provider 호출
```

중요한 순서:

- masking은 embedding provider 호출보다 반드시 먼저 수행한다.
- deny category bypass는 embedding provider 호출보다 먼저 수행한다.
- `dynamic_user_state`는 embedding provider 호출보다 먼저 제외한다.
- `normalizationVersion`은 vector compatibility 판단에 포함되어야 한다.

## 입력과 출력

### 입력 material

전처리 입력 후보:

| field | 설명 | 저장 여부 |
| --- | --- | --- |
| `messages` | Chat Completions request messages | raw 저장 금지 |
| `promptCategory` | routing/category classifier 결과 | safe field |
| `stream` | streaming 여부 | safe field |
| `routingDecisionKeyHash` | routing decision hash | safe field |
| `maskingPolicyVersion` | masking policy version | safe field |
| `semanticCachePolicyVersion` | Semantic Cache policy version | safe field |

### 출력 후보

```go
type NormalizedEmbeddingInput struct {
    Text string
    NormalizationVersion string
    SourceRole string
    SourceMessageIndex int
    Truncated bool
    WindowingStrategy string
    BypassReason string
}
```

주의:

- `Text`는 embedding provider 호출에만 사용한다.
- `Text`는 cache key, metrics label, structured log, dashboard detail에 raw로 저장하지 않는다.
- log/detail에는 `normalizationVersion`, `SourceRole`, `Truncated`, `WindowingStrategy`, `BypassReason` 같은 safe field만 남긴다.

## whitespace normalize

목표:

- 앞뒤 공백 제거
- 연속 공백을 단일 공백으로 축소
- 연속 개행을 단일 공백 또는 단일 개행으로 축소
- zero-width whitespace 제거 여부 검토

권장 기본값:

```text
strings.Fields 기반 단일 공백 join
```

예:

```text
사용량은

   어디서   확인해?
```

```text
사용량은 어디서 확인해?
```

위 처리는 의미를 바꾸지 않는다.

금지:

- 특정 단어 삭제
- 특정 synonym 치환
- 특정 intent template 삽입

## Unicode normalize

목표:

- 같은 문자가 다른 Unicode form으로 들어와 vector가 달라지는 것을 줄인다.
- 한국어 조합형/완성형 차이를 안정화한다.
- full-width ASCII, 호환 문자 처리 방침을 명시한다.

후보:

- `NFC`: 의미 보존에 더 보수적
- `NFKC`: full-width/compatibility 문자까지 정규화하지만 일부 문자의 시각적 의미가 달라질 수 있음

권장 beta 기본값:

```text
NFC
```

이유:

- 한국어 입력 안정화에는 충분한 경우가 많다.
- 보안상 의미 변화 위험이 `NFKC`보다 낮다.

후속 검토:

- full-width ASCII가 실제 사용자 입력에서 많이 나오면 `NFKC` eval을 opt-in variant로 비교한다.
- Unicode normalize 전후 text를 raw log로 남기지 않는다.

## masking 이후 text 사용

embedding input은 반드시 masking 이후 text를 사용해야 한다.

금지 데이터:

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

처리 원칙:

1. raw message에서 masking/redaction 수행
2. masking 결과가 safe인지 forbidden data scan
3. safe하지 않으면 Semantic Cache lookup/store bypass
4. safe한 text만 embedding input 후보로 사용

예:

```text
API Key 값이 sk-...인데 호출이 안 돼
```

masking 이후:

```text
API Key 값이 [REDACTED_SECRET]인데 호출이 안 돼
```

단, credential-like value가 포함된 요청은 static FAQ처럼 보여도 store/hit 금지하는 것이 기본이다.

## last user message 우선 정책

Chat Completions request는 여러 role message를 포함할 수 있다.

권장 beta 기본값:

```text
embedding input = 마지막 user message
```

이유:

- 마지막 user message가 실제 요청 의도인 경우가 많다.
- 전체 대화를 embedding하면 이전 assistant 답변과 system instruction이 vector를 흐릴 수 있다.
- application별 system prompt가 vector store에 남는 위험을 줄인다.

예:

```text
system: 너는 도움말 봇이다.
assistant: 이전 답변...
user: 사용량은 어디서 확인해?
```

embedding input 후보:

```text
사용량은 어디서 확인해?
```

예외:

- 마지막 user message가 너무 짧아 의미가 없는 경우
- 마지막 user message가 "그거", "다시", "왜?"처럼 이전 맥락 없이는 불명확한 경우

예외 처리 후보:

- Semantic Cache bypass
- shadow eval only
- 향후 multi-turn condensation 검토

이번 beta 설계에서는 LLM condensation을 하지 않는다.

## system/developer/assistant message 제외 여부

### system message

기본 제외한다.

이유:

- application policy나 내부 지시가 포함될 수 있다.
- 모든 request에 같은 system prefix가 들어가면 similarity가 왜곡된다.
- raw system prompt를 embedding provider로 보내거나 vector store에 남기는 것은 보안상 위험하다.

### developer message

기본 제외한다.

이유:

- 내부 개발자 instruction일 가능성이 높다.
- user intent와 직접 관련 없는 경우가 많다.

### assistant message

기본 제외한다.

이유:

- 이전 응답 문맥이 섞이면 현재 user request retrieval 품질이 떨어질 수 있다.
- raw response 저장 금지 원칙과 충돌할 수 있다.

### user message

마지막 user message를 기본 후보로 사용한다.

단, user message도 masking 이후 safe text만 사용한다.

## markdown/code block 처리 정책

### code block

code fence가 포함된 요청은 일반적으로 `code` category여야 한다.

정책:

- `code` category는 Semantic Cache lookup/store bypass
- `general`로 오분류됐지만 code fence가 있으면 `category_uncertain` 또는 `code_like_input` reason으로 embedding 전 bypass 검토
- code block 내부만 제거하고 나머지를 embedding하는 방식은 beta에서는 사용하지 않는다

이유:

- code 요청은 문맥 의존성이 크다.
- code block을 제거하면 사용자 의도가 바뀔 수 있다.
- 제거 후 남은 자연어만으로 이전 응답을 재사용하면 오답 위험이 높다.

### markdown

일반 markdown bullet/list는 제거하지 않는다.

허용:

- bullet marker 주변 whitespace normalize
- heading marker가 의미를 크게 바꾸지 않는 수준의 공백 정리

금지:

- markdown 구조를 임의로 요약
- 특정 section만 골라 embedding
- code fence 내부를 삭제하고 cache hit 후보로 유지

## 긴 prompt truncate/windowing 정책

긴 prompt는 embedding 비용과 품질 모두에 영향을 준다.

후보 정책:

| 정책 | 설명 | 장점 | 위험 |
| --- | --- | --- | --- |
| `bypass_long_input` | 길이 초과 시 Semantic Cache bypass | 안전함 | hit 기회 감소 |
| `head_only` | 앞부분만 사용 | 구현 쉬움 | 마지막 질문 누락 가능 |
| `tail_only` | 뒷부분만 사용 | 마지막 요청 보존 가능 | 배경 조건 누락 가능 |
| `head_tail_window` | 앞/뒤 일부 결합 | 문맥 일부 보존 | 결합 방식이 score를 왜곡할 수 있음 |

beta 권장:

```text
bypass_long_input
```

또는 shadow eval 한정:

```text
tail_only
head_tail_window
```

권장 이유:

- 긴 prompt는 보통 context-specific 요청일 가능성이 높다.
- response 재사용 위험이 크다.
- truncate 방식이 의미를 바꿀 수 있다.

길이 기준 후보:

- char 기준: `SEMANTIC_CACHE_EMBEDDING_INPUT_MAX_CHARS`
- token 기준: 후속 구현에서 tokenizer 도입 여부 검토

## multi-turn request 처리

multi-turn request는 single-turn FAQ보다 위험하다.

처리 원칙:

- 마지막 user message만으로 의미가 명확하면 후보
- 이전 대화 없이는 의미가 불명확하면 bypass
- assistant message를 embedding input에 포함하지 않는다.
- system/developer message를 embedding input에 포함하지 않는다.

불명확한 마지막 user message 예:

```text
그건 어디서 해?
다시 알려줘
왜 안 돼?
그거 취소해줘
```

이런 경우 beta에서는 Semantic Cache hit/store를 금지한다.

후속 가능성:

- LLM condensation
- query rewrite
- conversation-aware retrieval

하지만 이번 설계 범위에서는 제외한다.

## category와의 관계

### `stream=true`

기존처럼 Semantic Cache lookup/store bypass한다.

이유:

- streaming 응답은 token-level logging을 하지 않는다.
- response 재사용 path와 UX가 다르다.

### `tool_call`

Semantic Cache bypass한다.

이유:

- 외부 상태, side effect, tool result가 응답을 결정할 수 있다.

### `code`

Semantic Cache bypass한다.

이유:

- code content, runtime, framework version, error context가 응답을 결정한다.

### `translation`

Semantic Cache bypass한다.

이유:

- 입력 문장 자체가 응답이다.
- 문장 일부만 달라도 재사용 위험이 크다.

### `unknown`

Semantic Cache bypass한다.

이유:

- category가 불명확하면 hit보다 miss가 안전하다.

### `general`

beta 후보 category다.

단, 아래만 후보로 둔다.

- static guidance
- FAQ성 위치/방법 안내
- 사용자별 state가 없는 요청

### `support_refund`

전처리 적용 자체는 가능하지만 beta enforce는 보수적으로 유지한다.

`support_refund`는 score가 좋아도 false positive 비용이 크므로 reranker 또는 더 넓은 eval 전에는 enforce하지 않는다.

## dynamic_user_state guard와의 관계

`dynamic_user_state`는 embedding 전 bypass가 원칙이다.

예:

- 내 이번 달 사용량 보여줘
- 현재 프로젝트별 비용 알려줘
- 오늘 토큰 사용량 몇이야
- 내 주문 상태 알려줘
- 환불 진행 상황 확인해줘
- quota 남은 양 알려줘

이런 요청은 의미가 비슷해 보여도 사용자, 시간, 계정, 주문 상태에 따라 답이 달라진다.

처리:

```text
dynamic_user_state detected
-> semantic lookup bypass
-> embedding provider 호출 안 함
-> store 후보도 아님
```

주의:

- dynamic guard는 retrieval 성능 개선 규칙이 아니다.
- 보안과 정확성을 위한 hit 금지 규칙이다.

## forbidden data 금지 규칙

아래 값은 embedding input, cache key, vector metadata, log/detail, metrics label에 남기면 안 된다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

embedding provider로 전송 가능한 것은 masking 이후 safe text뿐이다.

log/detail에 남길 수 있는 safe field:

- `normalizationVersion`
- `embeddingInputSourceRole`
- `embeddingInputTruncated`
- `embeddingInputWindowingStrategy`
- `embeddingInputBypassReason`
- `semanticCacheDecisionReason`
- `semanticSimilarity`
- `semanticCacheThreshold`
- `embeddingProvider`
- `embeddingModel`

log/detail에 남기면 안 되는 field:

- `embeddingInputText`
- raw user message
- raw prompt preview
- secret-like substring
- Authorization header
- provider raw error body

## cache key/vector/log/detail 영향

### cache key

Semantic Cache key/boundary에는 raw `embeddingInputText`를 넣지 않는다.

boundary는 기존 원칙을 유지한다.

- `tenantId`
- `projectId`
- `applicationId`
- `selectedProviderId`
- `selectedModelId`
- `providerCatalogContentHash`
- `routingPolicyHash`
- `routingDecisionKeyHash`
- `promptCategory`
- `semanticCachePolicyVersion`
- `embeddingProvider`
- `embeddingModel`

추가 검토 field:

- `normalizationVersion`

`normalizationVersion`이 바뀌면 같은 prompt도 vector 분포가 달라질 수 있으므로 boundary 또는 entry compatibility material에 포함해야 한다.

### vector

vector는 normalized embedding input에서 생성한다.

entry metadata에는 아래 safe field만 둔다.

- `normalizationVersion`
- `embeddingProvider`
- `embeddingModel`
- `embeddingDimensions`
- `semanticCachePolicyVersion`

raw text 저장은 금지한다.

### log/detail

log/detail에는 outcome과 safe metadata만 남긴다.

예:

```json
{
  "semanticCacheDecisionReason": "intent_unavailable",
  "normalizationVersion": "semantic-embedding-input-normalization-v1",
  "embeddingInputSourceRole": "user",
  "embeddingInputTruncated": false
}
```

금지:

```json
{
  "embeddingInputText": "사용량은 어디서 확인해?"
}
```

### metrics

metrics label에는 high-cardinality 값이나 hash/detail text를 넣지 않는다.

허용 후보:

- `cache_type`
- `cache_status`
- `semantic_decision_reason`
- `embedding_provider`
- `embedding_model`
- `normalization_version`

금지:

- raw text
- requestId
- prompt hash
- userId
- tenantId
- applicationId
- error body

## 기존 Semantic Cache boundary와 충돌 여부

일반 전처리는 기존 boundary를 대체하지 않는다.

전처리 적용 후에도 아래 boundary는 그대로 필요하다.

- tenant/project/application
- provider/model
- provider catalog hash
- routing policy hash
- routing decision key hash
- category
- policy version

`normalizationVersion`은 새 compatibility material로 추가하는 것이 안전하다.

권장:

```text
old entry normalizationVersion 없음
-> v0/raw-normalized로 간주
-> v1 entry와 cross-hit 금지
```

이렇게 하면 migration 없이도 기존 entry와 새 entry의 vector 분포 충돌을 피할 수 있다.

## 테스트 계획

### domain unit test

- whitespace normalize
- Unicode normalize
- masking 이후 text만 사용
- last user message 선택
- system/developer/assistant message 제외
- code fence 포함 요청 bypass
- 긴 prompt bypass 또는 truncate flag
- multi-turn ambiguous last user message bypass
- dynamic_user_state embedding 전 bypass
- forbidden data 포함 시 bypass
- `normalizationVersion`이 결과에 포함됨

### handler integration test

- Semantic Cache lookup 전에 normalization이 적용됨
- deny category는 normalizer 또는 embedding provider 호출 전 bypass
- dynamic usage query는 embedding provider 호출 전 bypass
- normalized input text가 request log/detail에 남지 않음
- 기존 exact cache priority 유지
- tenant/project/application/provider/model/routing boundary 유지

### regression

```powershell
go test ./apps/gateway-core/internal/domain/cache -count=1
go test ./apps/gateway-core/internal/http/handlers -run "TestChatCompletionsSemanticCache" -count=1
go test ./apps/gateway-core/... -count=1
corepack pnpm run verify:v2-final
```

기본 테스트는 `OPENAI_API_KEY` 없이 통과해야 한다.

## OpenAI actual eval 계획

OpenAI eval은 opt-in으로만 실행한다.

조건:

```text
OPENAI_API_KEY is set
SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai
SEMANTIC_CACHE_OPENAI_EVAL=1
```

비교 variant:

- `raw_user_prompt`
- `current_normalized_text`
- `new_normalized_embedding_input`
- `last_user_message_only`
- `masked_normalized_embedding_input`
- `long_prompt_bypass`
- `head_tail_window`

model:

- `text-embedding-3-small`
- `text-embedding-3-large`

확인 pair:

- password reset positive
- API Key creation positive
- usage static guidance positive
- usage dynamic negative
- support_refund hard negative
- unrelated pair

출력:

- `pairId`
- `kind`
- `normalizationVariant`
- `model`
- `similarity`
- threshold summary
- policy guard 후 hit 가능 여부

금지:

- API Key 출력
- Authorization header 출력
- raw prompt 대량 출력
- provider raw error body 출력

## 구현 단계 제안

1. `SemanticCacheEmbeddingInputNormalizer` domain type 추가
2. `NormalizationVersion` 상수 추가
3. whitespace normalize와 Unicode `NFC` 적용
4. message role 기반 last user message 선택
5. masking 이후 text만 normalizer input으로 전달
6. deny category/dynamic_user_state는 embedding provider 호출 전 bypass
7. log/detail에는 safe metadata만 남김
8. OpenAI opt-in eval variant 추가
9. threshold curve 재측정
10. 개선폭이 작으면 reranker 설계로 진행

## 결론

embedding input 일반 전처리는 hit율을 급격히 올리는 장치가 아니다.

역할은 명확하다.

```text
사용자 prompt 의미는 유지
+ embedding input 잡음 제거
+ forbidden data 전송 차단
+ role/message 혼입 방지
+ 긴 prompt 위험 관리
+ OpenAI eval로 실제 효과 검증
```

이 설계는 Semantic Cache를 intent cache로 바꾸지 않고, 실제 prompt embedding 기반 retrieval 품질을 안전하게 개선하기 위한 다음 단계다.
