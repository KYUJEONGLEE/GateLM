# Semantic Cache Reranker Design

## 목적

이 문서는 GateLM v2 Semantic Cache에 `reranker`를 도입하기 전 최소 설계를 정리한다.

핵심 결론은 아래다.

- `semanticSimilarity >= threshold` 단독으로 hit하지 않는다.
- canonical template으로 embedding text를 고정해 similarity를 `1.0`에 가깝게 만드는 방식은 제외한다.
- `reranker`는 embedding top-k 후보를 찾은 뒤에만 적용한다.
- `reranker`는 policy guard를 대체하지 않는다.
- beta 기본값에서 실시간 LLM judge는 켜지지 않는다.
- OpenAI API 호출은 opt-in eval 또는 명시적 provider 설정이 있을 때만 허용한다.

이 문서는 설계 문서이며 production code, API, DB, Event, Metrics 계약을 바로 변경하지 않는다.

## 왜 Reranker가 필요한가

OpenAI actual eval 결과에서 embedding input normalization은 false positive 위험을 낮추는 데 의미가 있었다.

특히 마지막 `user` message만 embedding input으로 쓰면 `system`, `developer`, `assistant`, 이전 대화 context가 similarity를 인위적으로 끌어올리는 문제를 줄일 수 있다.

하지만 전처리만으로 충분하지는 않았다.

- `text-embedding-3-small`에서 `password reset` positive pair는 낮은 score가 나왔다.
- `text-embedding-3-large`에서도 `dynamic_usage_current_month`가 positive와 가까운 score를 냈다.
- `support_refund` hard negative는 낮은 threshold에서 통과할 수 있다.

따라서 Semantic Cache production hit는 아래 순서를 유지해야 한다.

```text
category allow
+ SemanticCacheBoundary match
+ canonicalIntent match
+ requiredSlots match
+ dynamic_user_state 아님
+ hardNegativeGuard 통과
+ semanticSimilarity >= categoryThreshold
+ reranker pass
```

`reranker`의 목적은 hit율을 무작정 올리는 것이 아니라, top-k 후보 중 실제 응답 재사용 가능성이 높은 후보만 남기는 것이다.

## Non-Goals

이번 설계에서 제외한다.

- canonical template embedding
- intent rule을 늘려 similarity를 강제로 높이는 intent cache 방식
- beta 기본값에서 실시간 LLM judge 활성화
- raw prompt 또는 raw response 저장
- provider raw error body 저장
- pgvector/vector DB 도입
- API/DB/Event/Metrics 공식 계약 변경
- `support_refund` production enforce 즉시 허용

## Reranker 위치

권장 lookup 흐름은 아래다.

```text
1. auth/app-token/context 통과
2. request-side safety/masking 적용
3. Exact Cache lookup
4. Exact Cache hit이면 Semantic Cache bypass
5. Semantic Cache enabled/mode/scope 확인
6. stream/tool_call/code/translation/unknown/dynamic_user_state bypass
7. masking 이후 last user message 중심 NormalizedEmbeddingInput 생성
8. SemanticCacheIntentMaterial 생성
9. embedding 생성
10. SemanticCacheStore.Search(boundary, vector, broadThreshold, topK)
11. candidate별 SemanticCacheHitPolicy 평가
12. policy guard 통과 candidate만 reranker input으로 전달
13. reranker decision 평가
14. pass이면 provider bypass hit
15. fail/skip/error이면 miss 또는 candidate_only로 provider 호출
```

중요한 점은 `reranker`가 top-k vector search 이전에 호출되지 않는다는 것이다.

`reranker`는 후보 생성기가 아니라 후보 검증기다.

## Policy Guard와의 순서

순서는 반드시 아래를 따른다.

```text
embedding top-k
-> boundary guard
-> category allow/deny
-> canonicalIntent guard
-> requiredSlots guard
-> hardNegativeGuard
-> categoryThreshold
-> reranker
-> final hit
```

이유:

- `category`, `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`는 deterministic policy다.
- deterministic guard에서 이미 금지된 후보를 reranker가 다시 살리면 안 된다.
- `reranker`는 애매한 후보를 reject하거나 top-k 후보 순서를 재조정하는 역할만 한다.

금지:

```text
reranker pass => category deny bypass
reranker pass => hardNegative override
reranker pass => requiredSlots mismatch override
reranker pass => dynamic_user_state override
```

## Input Material

`reranker` input은 raw prompt가 아니다.

후보 type:

```go
type SemanticCacheRerankerMaterial struct {
    Category string
    CanonicalIntent string
    RequiredSlotsHash string
    RequestIntentMaterial SemanticCacheIntentMaterial
    CandidateIntentMaterial SemanticCacheIntentMaterial
    SemanticSimilarity float64
    SemanticCachePolicyVersion string
    NormalizationVersion string
    EmbeddingProvider string
    EmbeddingModel string
    CandidateRequestIDHash string
    CandidateAgeSeconds int64
    CandidateResponseCacheabilityClass string
    CandidateProviderOutcome string
}
```

허용 field:

- `category`
- `canonicalIntent`
- `requiredSlotsHash`
- policy version
- normalization version
- embedding provider/model 이름
- candidate id hash
- candidate age
- candidate response cacheability class
- similarity score
- low-cardinality decision material

금지 field:

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
- 사용자별 고유값
- 주문번호, 이메일, 전화번호 같은 raw identifier

## Output Decision

후보 type:

```go
type SemanticCacheRerankerDecision struct {
    Enabled bool
    Applied bool
    Passed bool
    Score float64
    Threshold float64
    DecisionReason string
    ProviderBypassAllowed bool
    CandidateRequestIDHash string
    PolicyVersion string
    RerankerVersion string
}
```

권장 enum:

```text
reranker_pass
reranker_score_miss
reranker_not_applicable
reranker_disabled
reranker_policy_denied
reranker_provider_failure
reranker_timeout
reranker_input_unsafe
reranker_candidate_only
```

`rerankerDecisionReason`은 사람이 이해 가능한 low-cardinality enum이어야 한다.

금지:

- raw model output
- free-form explanation
- raw provider error
- prompt fragment
- detected raw value

## Reranker Score

`rerankerScore`는 `semanticSimilarity`와 별도 field다.

의미:

- `semanticSimilarity`: embedding vector 간 cosine similarity
- `rerankerScore`: 후보 재사용 가능성에 대한 추가 판단 score

초기 beta에서는 deterministic reranker 또는 offline eval 기반 reranker를 우선한다.

실시간 LLM judge를 쓰는 경우에도 beta 기본값은 off다.

권장 기본값:

```text
SEMANTIC_CACHE_RERANKER_ENABLED=false
SEMANTIC_CACHE_RERANKER_PROVIDER=none
SEMANTIC_CACHE_RERANKER_MODE=off
SEMANTIC_CACHE_RERANKER_THRESHOLD=0.80
SEMANTIC_CACHE_RERANKER_APPLY_CATEGORIES=general
SEMANTIC_CACHE_RERANKER_AMBIGUOUS_MIN=0.45
SEMANTIC_CACHE_RERANKER_AMBIGUOUS_MAX=0.70
```

위 env는 설계 후보이며, 이번 문서에서 공식 env 계약으로 확정하지 않는다.

## Category별 적용 전략

### `general`

beta 적용 1순위다.

허용 범위:

- static guidance
- FAQ
- 메뉴 위치 안내
- 사용 방법 안내

금지 범위:

- 사용자별 사용량 수치
- 프로젝트별 비용
- quota 상태
- 계정 상태
- 결제 상태

권장:

```text
category=general
mode=strict_hit 또는 candidate_only
reranker 적용 가능
dynamic_user_state는 reranker 전에 bypass
```

### `account_access`

초기에는 보수 적용한다.

허용 후보:

- password reset 방법 안내
- API Key 생성 위치 안내
- App Token 생성 위치 안내

금지:

- 실제 API Key 값 포함
- credential rotate/delete/revoke 같은 destructive action
- 계정 잠김, 인증 실패 상태 같은 사용자별 상태

권장:

```text
category=account_access
mode=candidate_only 우선
reranker는 shadow/eval부터
credential_or_secret guard는 reranker보다 먼저
```

### `support_refund`

초기 beta에서는 비활성 또는 shadow only를 권장한다.

이유:

- 환불, 반품, 취소, 교환은 같은 category 안에서도 workflow가 다르다.
- 사용자별 주문/결제/환불 상태가 섞일 가능성이 높다.
- false positive 비용이 크다.

권장:

```text
category=support_refund
mode=candidate_only 또는 disabled
reranker 기본 off
strict_hit 금지
hardNegativeGuard 필수
```

`support_refund`에 reranker를 적용하려면 아래 조건이 필요하다.

- hard negative false positive 0
- slot mismatch false positive 0
- category-specific eval set 확대
- 실제 traffic shadow 결과 검토
- CS/정책 담당자 확인

### `code`, `translation`, `tool_call`, `unknown`

기존처럼 bypass한다.

`reranker`로 되살리지 않는다.

## Fallback Behavior

`reranker`는 보조 안전장치다.

실패해도 Gateway 요청 자체를 실패시키면 안 된다.

처리 원칙:

| 상황 | 처리 |
| --- | --- |
| reranker disabled | 기존 Semantic Cache policy 결과만 사용하거나 candidate_only |
| reranker not applicable | provider 호출로 miss 처리 |
| reranker timeout | miss 또는 candidate_only |
| reranker provider failure | miss 또는 candidate_only |
| reranker input unsafe | bypass |
| reranker score below threshold | miss |
| reranker pass | provider bypass hit 가능 |

beta 기본값:

```text
reranker failure => providerCalled=true
semanticCacheHit=false
rerankerDecisionReason=reranker_provider_failure 또는 reranker_timeout
```

## Latency/Cost 영향

추가 비용은 reranker provider에 따라 달라진다.

### deterministic reranker

- latency 낮음
- 비용 없음
- 재현성 높음
- 품질 한계 있음

### cross-encoder 또는 external reranker

- latency 중간
- 비용 발생 가능
- score 품질은 좋아질 수 있음
- provider 장애 처리 필요

### LLM judge

- latency 큼
- 비용 큼
- prompt/log 보안 위험 큼
- output 재현성 낮음
- beta 기본값으로 금지

초기 beta는 `general` static guidance에서만 shadow 또는 limited canary로 시작한다.

## Forbidden Data 규칙

아래 값은 reranker input, output, log, detail, metric label에 평문으로 남기지 않는다.

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

reranker가 외부 provider를 호출해야 한다면 입력은 반드시 masking 이후 safe material만 사용한다.

실시간 LLM judge를 후속으로 검토하더라도 judge prompt에는 raw prompt나 raw response를 넣지 않는다.

## Log/Detail Safe Field

log/detail에 남길 수 있는 field 후보:

```text
semanticRerankerEnabled
semanticRerankerApplied
semanticRerankerPassed
semanticRerankerScore
semanticRerankerThreshold
semanticRerankerDecisionReason
semanticRerankerVersion
semanticRerankerProvider
semanticRerankerMode
semanticCandidateRank
semanticCandidateHash
semanticCanonicalIntent
semanticRequiredSlotsHash
semanticSimilarity
semanticCacheDecisionReason
```

주의:

- `semanticCandidateHash`는 request id 또는 entry id의 hash만 허용한다.
- candidate response body는 남기지 않는다.
- reranker provider raw output은 남기지 않는다.
- 사람이 읽는 설명이 필요하면 enum reason과 aggregate count만 남긴다.

## Metrics Label 금지 값

metrics label에는 high-cardinality 또는 sensitive 값을 넣지 않는다.

금지:

- raw prompt
- raw response
- candidate id
- request id
- trace id
- user id
- raw error text
- provider raw error body
- canonicalIntent 전체가 high-cardinality가 될 경우
- requiredSlotsHash
- semanticCandidateHash
- rerankerScore
- semanticSimilarity

허용 후보:

```text
semantic_cache_reranker_decisions_total{
  mode,
  category,
  reason,
  provider,
  result
}
```

`category`, `reason`, `provider`, `result`는 low-cardinality enum이어야 한다.

## 테스트 계획

### Unit Test

필수 테스트:

- reranker disabled이면 기존 flow 유지
- reranker는 top-k 후보 이후에만 호출
- category deny 후보에는 reranker 미호출
- `canonicalIntent` mismatch 후보에는 reranker 미호출
- `requiredSlots` mismatch 후보에는 reranker 미호출
- `hardNegativeGuard` hit 후보에는 reranker 미호출
- reranker pass이면 hit 가능
- reranker score miss이면 provider 호출
- reranker timeout이면 provider 호출
- reranker provider failure이면 provider 호출
- reranker input unsafe이면 bypass
- safe log/detail field만 남김
- raw prompt/API Key/App Token/Provider Key/Authorization header 미노출

### Handler Integration Test

필수 테스트:

- `general` static guidance positive top-k 후보가 reranker pass 후 hit
- `general` dynamic_user_state 후보는 reranker 전에 bypass
- `support_refund`는 reranker 설정이 있어도 default hit 금지
- `code`, `translation`, `tool_call`, `unknown`은 reranker 미호출
- shadow mode에서는 `providerCalled=true`, `semanticCacheWouldHit=true/false`만 기록
- enforce mode에서 reranker pass일 때만 `providerCalled=false`

### Eval Test

OpenAI API 없이 통과해야 하는 테스트:

- fake embedding top-k
- fake reranker pass/miss
- eval dataset 기반 positive/hard negative/dynamic negative/unrelated 검증

OpenAI opt-in 테스트:

```powershell
# OPENAI_API_KEY는 로컬 shell에만 설정한다. 값은 문서나 test output에 남기지 않는다.
$env:SEMANTIC_CACHE_OPENAI_EVAL="1"
$env:SEMANTIC_CACHE_EMBEDDING_PROVIDER="openai"
go test -v ./apps/gateway-core/internal/domain/cache -run "TestOpenAIEmbeddingProvider.*Eval.*|TestSemanticCacheReranker.*Eval.*" -count=1
```

test output에는 아래만 허용한다.

- `caseId`
- `pairKind`
- `category`
- `semanticSimilarity`
- `rerankerScore`
- threshold summary
- decision reason enum

raw prompt와 secret은 출력하지 않는다.

## OpenAI Opt-In Eval 계획

목표:

- embedding score만으로 통과하는 후보 중 reranker가 false positive를 얼마나 줄이는지 측정한다.
- `text-embedding-3-small`과 `text-embedding-3-large`에서 score band를 비교한다.
- `general` static guidance와 dynamic_user_state를 분리한다.
- `support_refund` hard negative는 계속 block되는지 확인한다.

측정 항목:

```text
positiveAbove
dynamicNegativeAbove
hardNegativeAbove
unrelatedAbove
rerankerPositivePass
rerankerDynamicNegativePass
rerankerHardNegativePass
rerankerUnrelatedPass
policyGuardHitPossible
```

threshold 후보:

```text
0.35, 0.45, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.92
```

ambiguous band 후보:

```text
0.45 <= semanticSimilarity <= 0.70
```

이 band는 `general` static guidance 기준이다. `support_refund`에는 그대로 적용하지 않는다.

## OpenAI Actual Eval 결과

2026-07-03에 `TestSemanticCacheRerankerOpenAIEvalKoreanSimilarityDistribution`으로 실제 OpenAI embedding score를 재측정했다.

실행 조건:

- `SEMANTIC_CACHE_OPENAI_EVAL=1`
- `SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai`
- `SEMANTIC_CACHE_OPENAI_EVAL_MODELS=text-embedding-3-small,text-embedding-3-large`
- `OPENAI_API_KEY`는 로컬 `.env`에서 프로세스 env로만 주입

실시간 LLM judge는 호출하지 않았다. 이번 결과의 `reranker`는 eval용 deterministic 판단이며, production 기본값을 바꾸지 않는다.

핵심 결과:

| model | threshold | raw positive | raw dynamic negative | raw hard negative | reranker positive pass | reranker negative pass |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `text-embedding-3-small` | 0.35 | 3/3 | 2/3 | 1/2 | 3/3 | 0/6 |
| `text-embedding-3-small` | 0.45 | 2/3 | 1/3 | 0/2 | 2/3 | 0/6 |
| `text-embedding-3-small` | 0.50 | 2/3 | 0/3 | 0/2 | 2/3 | 0/6 |
| `text-embedding-3-large` | 0.35 | 3/3 | 2/3 | 2/2 | 3/3 | 0/6 |
| `text-embedding-3-large` | 0.45 | 3/3 | 1/3 | 0/2 | 3/3 | 0/6 |
| `text-embedding-3-large` | 0.50 | 3/3 | 1/3 | 0/2 | 3/3 | 0/6 |

해석:

- `text-embedding-3-large`는 threshold `0.45` 또는 `0.50`에서 positive 3/3을 유지했다.
- 같은 threshold에서도 dynamic negative 1/3이 raw similarity 기준으로 통과했다.
- threshold `0.35`는 hard negative까지 통과하므로 production 후보로 부적절하다.
- reranker 이후 negative pass는 0/6이지만, 이 중 상당수는 reranker가 직접 reject한 것이 아니라 policy guard가 reranker 전 제외한 결과다.
- 따라서 `reranker`는 policy guard를 대체하지 않고, policy guard 통과 후 남은 애매한 후보를 거르는 보조 장치로 유지해야 한다.

beta 판단:

- `general` static guidance 한정이면 `text-embedding-3-large` + threshold `0.45` 또는 `0.50` 후보를 검토할 수 있다.
- `dynamic_user_state`, `support_refund`, hard negative는 계속 reranker 전 guard로 막는다.
- 실시간 LLM judge 또는 external reranker는 latency/cost가 추가되므로 기본값 off를 유지한다.

## Rollout Plan

### Step 0. 문서/계약 정리

- 이 문서로 설계 합의
- 공식 API/DB/Event/Metrics 계약 변경 없음
- PR review에서 보안/로그 field 확인

### Step 1. Shadow-only deterministic reranker

- `SEMANTIC_CACHE_RERANKER_ENABLED=false` 기본 유지
- test-only 또는 config 기반 deterministic reranker 추가
- provider bypass 없음
- log/detail에는 safe decision만 남김

### Step 2. `general` static guidance shadow eval

- `general` static guidance만 대상
- dynamic_user_state는 reranker 전 bypass
- positive/dynamic/hard negative/unrelated eval set 확대
- false positive 0 목표

### Step 3. Limited canary

- tenant/application/category allowlist 필요
- `general` static guidance만 enforce 후보
- timeout/provider failure 시 miss
- reranker fail 시 provider 호출

### Step 4. OpenAI 또는 external reranker opt-in 검토

- 기본값 off
- `OPENAI_API_KEY` 없으면 skip
- failure safe 검증
- cost/latency report 필수

### Step 5. Category 확대 검토

확대 조건:

- false positive 0
- dynamic_user_state miss 확인
- hard negative miss 확인
- Request Detail/Log/Metric safe field 확인
- 운영팀/정책팀 확인

`support_refund`는 마지막 단계까지 `candidate_only` 또는 disabled를 기본으로 둔다.

## 구현 우선순위

1. `SemanticCacheReranker` interface 후보 설계
2. `SemanticCacheRerankerMaterial` / `SemanticCacheRerankerDecision` domain type 추가
3. fake deterministic reranker test double 추가
4. `SemanticCacheService.Search`에서 policy guard 이후 reranker hook 추가
5. safe log/detail field 연결
6. eval dataset 기반 자동 검증
7. OpenAI opt-in eval
8. limited canary

## 결론

reranker는 Semantic Cache hit율을 무조건 올리는 기능이 아니다.

GateLM에서는 reranker를 아래처럼 써야 한다.

```text
embedding top-k 후보를 만든다
policy guard로 명백히 위험한 후보를 제거한다
남은 애매한 후보를 reranker가 한 번 더 거른다
pass한 후보만 provider bypass hit로 쓴다
```

beta 범위는 `general` static guidance부터가 맞다.

`support_refund`는 reranker가 있어도 기본 hit 허용으로 바로 올리면 안 된다.
