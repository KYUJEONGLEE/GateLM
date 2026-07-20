# Semantic Cache Retrieval 품질 개선 방향

## 목적

이 문서는 GateLM v2 Semantic Cache가 실제 사용자 prompt embedding 기반으로 더 안정적으로 hit되게 하기 위한 품질 개선 방향을 정리한다.

이번 작업은 구현이 아니다. production code, API, DB, Event, Metrics 계약은 변경하지 않는다.

핵심 결론은 아래와 같다.

- `semanticSimilarity >= threshold` 단독 hit는 production 기준으로 위험하다.
- `canonical template`으로 `embedding text`를 고정해 similarity를 `1.0`에 가깝게 만드는 방식은 제외한다.
- `intent rule`을 계속 늘려서 hit를 맞추는 intent cache 방식도 제외한다.
- 우선은 raw prompt embedding의 입력 품질을 일반 전처리로 개선하고, 실제 OpenAI eval로 score 변화를 확인한다.
- 전처리만으로 부족하면 embedding top-k 후보 뒤에 `reranker`를 붙이는 방향을 검토한다.

## 현재 문제

현재 Semantic Cache는 다음 안전장치를 갖고 있다.

- `tenantId/projectId/applicationId`
- `selectedProviderId`
- `selectedModelId`
- `routingPolicyHash`
- `routingDecisionKeyHash`
- `promptCategory`
- `canonicalIntent`
- `requiredSlots`
- `hardNegative`
- deny category bypass
- `dynamic_user_state` store/hit 금지

하지만 실제 retrieval 품질은 여전히 embedding input 품질과 embedding model의 score 분포에 영향을 받는다.

예를 들어 한국어 짧은 문장은 사람이 보기에는 같은 뜻이어도 embedding score가 낮게 나올 수 있다. 반대로 사용자별 동적 데이터 조회처럼 재사용하면 안 되는 문장도 표면상 비슷해서 score가 높게 나올 수 있다.

따라서 품질 개선은 아래 두 목표를 동시에 만족해야 한다.

- 같은 답을 재사용해도 되는 prompt는 더 잘 찾는다.
- 같은 category처럼 보여도 다른 답이 필요한 prompt는 hit하지 않는다.

## 제외하는 방향

### threshold만 낮추기

threshold를 낮추면 hit 후보는 늘어난다. 하지만 false positive도 같이 늘어난다.

특히 아래 유형은 threshold만 낮추면 위험하다.

- 정적 안내 질문과 사용자별 동적 조회 질문
- 같은 `support_refund` category 안의 배송비 환불, 주문 취소, 교환 신청
- `account_access` 안의 생성, 삭제, 재설정처럼 작업 방향이 다른 질문

따라서 threshold는 마지막 보조 조건이어야 한다.

```text
category allow
+ dynamic_user_state 아님
+ canonicalIntent / requiredSlots / hardNegative guard 통과
+ semanticSimilarity >= categoryThreshold
```

### canonical template embedding

아래 방식은 제외한다.

```text
사용량은 어디서 확인해?
API 사용량 확인 화면은 어디야?

둘 다 embedding text:
API 사용량 확인 화면 위치 안내
```

이 방식은 같은 `embedding text`를 만들기 때문에 similarity가 거의 `1.0`이 된다. 겉으로는 retrieval 품질이 좋아진 것처럼 보이지만 실제로는 embedding이 의미 판단을 하는 것이 아니다.

이 방식은 Semantic Cache라기보다 intent cache에 가깝다.

문제점:

- intent rule이 틀리면 바로 오답 재사용이 된다.
- 케이스가 늘수록 policy material이 계속 커진다.
- 새로운 표현은 잡지 못한다.
- similarity score가 실제 semantic distance를 설명하지 못한다.
- threshold tuning evidence가 무의미해진다.

### synonym/template 하드코딩 확장

한국어 synonym을 계속 늘려서 hit를 맞추는 방식도 이번 방향에서 제외한다.

허용되는 것은 안전 guard에 필요한 low-cardinality material뿐이다. retrieval 성능을 올리기 위해 특정 표현을 특정 template으로 강제 변환하지 않는다.

## raw prompt embedding의 한계

raw prompt를 그대로 embedding하면 다음 문제가 생긴다.

- system/developer/assistant message가 섞이면 user intent가 흐려진다.
- multi-turn 대화 전체가 들어가면 마지막 요청의 의미가 희석된다.
- markdown/code block이 섞이면 일반 FAQ prompt와 다른 분포가 된다.
- secret/API Key/App Token/Authorization header가 masking 전 text에 남으면 보안상 위험하다.
- 너무 긴 prompt는 핵심 질의보다 주변 문맥이 vector를 지배할 수 있다.
- 한국어 짧은 문장은 paraphrase여도 score가 낮게 나올 수 있다.

따라서 raw prompt를 의미적으로 바꾸지는 않되, embedding input으로 쓰기 전에 일반 전처리를 해야 한다.

## 일반 전처리 후보

아래 전처리는 특정 intent를 맞추기 위한 하드코딩이 아니다. 모델에 들어가는 입력의 잡음을 줄이는 기본 위생 처리다.

### whitespace normalize

목표:

- 중복 공백 제거
- 불필요한 개행 접기
- 앞뒤 공백 제거

예:

```text
사용량은

어디서   확인해?
```

```text
사용량은 어디서 확인해?
```

### Unicode normalize

목표:

- 같은 문자가 다른 Unicode form으로 들어와 embedding input이 달라지는 문제 완화
- 한국어 조합 문자, full-width 문자, 호환 문자 등을 안정화

정책:

- `NFC` 또는 `NFKC` 중 하나를 명시한다.
- 보안상 의미가 달라질 수 있는 문자는 테스트로 확인한다.
- normalize 전후 text를 log에 raw로 남기지 않는다.

### masking 이후 text 사용

embedding input은 반드시 masking 이후 text를 사용한다.

금지:

- raw prompt
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- raw detected value
- raw prompt fragment

허용:

- masking token
- low-cardinality category
- safe decision reason

예:

```text
API Key sk-...로 요청했는데 안 돼
```

embedding input 후보:

```text
API Key [REDACTED_SECRET]로 요청했는데 안 돼
```

단, credential value가 포함된 요청은 Semantic Cache store/hit 자체를 금지하는 것이 기본이다.

### 마지막 user message 중심 embedding

multi-turn request에서 전체 대화를 embedding하면 마지막 질문의 의미가 흐려질 수 있다.

beta 기본 후보:

```text
last user message only
```

검토 대상:

- 마지막 user message가 너무 짧아 이전 user message가 필요한 경우
- assistant response를 embedding input에 포함할지 여부
- system/developer message가 policy instruction이라면 embedding에서 제외할지 여부

초기 원칙:

- system/developer message는 embedding input에서 제외한다.
- assistant message도 기본 제외한다.
- 마지막 user message만으로 의미가 부족한 multi-turn case는 Semantic Cache hit 후보에서 제외하거나 shadow eval에서 별도 측정한다.

### system/developer message 제외

system/developer message는 모델 동작 지시일 뿐, 사용자 질의 의미와 다르다.

포함하면 안 되는 이유:

- 모든 요청에 공통 prefix가 붙어 similarity가 왜곡된다.
- application별 instruction이 cache boundary 밖으로 새면 안 된다.
- prompt policy나 내부 운영 문구가 vector store에 남을 수 있다.

따라서 embedding input은 user-facing request content 중심으로 제한한다.

### markdown/code block 처리

code block이 있는 요청은 대부분 `code` category로 분류되어 Semantic Cache deny 대상이다.

정책:

- `code` category는 기존처럼 bypass한다.
- code block이 포함된 `general` 오분류 case는 embedding 전에 deny 또는 `category_uncertain`으로 처리하는 것을 검토한다.
- markdown bullet/list 자체는 제거하지 않는다. 단, code fence 내부는 category classifier가 `code`로 잡아야 한다.

### 긴 prompt truncate/windowing

긴 prompt는 비용과 품질 모두에 영향을 준다.

후보:

- 최대 char/token 길이 제한
- 마지막 user message 앞부분/뒷부분 windowing
- 첫 N자 + 마지막 N자 결합
- 긴 prompt는 Semantic Cache 대상에서 제외

beta 권장:

- 긴 prompt는 hit/store 후보에서 제외하거나 shadow-only로 둔다.
- truncate 정책은 OpenAI actual eval로 score 왜곡 여부를 확인한 뒤 적용한다.

## embedding model 비교

GateLM 현재 후보는 아래 두 모델이다.

- `text-embedding-3-small`
- `text-embedding-3-large`

OpenAI 공식 embedding guide 기준으로 두 모델은 third-generation embedding model이며, 기본 vector 길이는 `text-embedding-3-small`이 `1536`, `text-embedding-3-large`가 `3072`다. 공식 문서는 `dimensions` parameter로 vector 길이를 줄이는 방법도 제공한다. 참고: [OpenAI Vector embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).

비교 관점:

| model | 장점 | 단점 | GateLM 검토 방향 |
| --- | --- | --- | --- |
| `text-embedding-3-small` | 비용이 낮고 빠른 검증에 적합 | 한국어 짧은 paraphrase에서 score가 낮을 수 있음 | local/dev smoke와 비용 민감 환경 후보 |
| `text-embedding-3-large` | 품질 기대치가 더 높고 다국어 retrieval에 유리할 가능성 | 비용, vector size, 저장 비용 증가 | beta quality 후보 |
| `text-embedding-ada-002` | legacy 비교 기준 | 신규 기본 후보로 보기 어려움 | regression baseline으로만 문서 검토 |

다른 embedding provider나 모델은 이번 단계에서 구현하지 않는다. 필요하면 provider abstraction 뒤에서 별도 PR로 비교한다.

## OpenAI actual eval 계획

OpenAI API 호출은 opt-in으로만 실행한다.

필수 조건:

```text
OPENAI_API_KEY is set
SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai
SEMANTIC_CACHE_OPENAI_EVAL=1
```

비교 대상:

- raw user prompt
- current normalized text
- masking 이후 text
- last user message only
- 긴 prompt windowing 후보

pair 그룹:

- positive pair
- dynamic negative pair
- hard negative pair
- unrelated pair

문서에는 raw prompt를 대량 저장하지 않는다. 필요한 경우 sanitized 예시만 최소로 남긴다.

테스트 output에는 아래만 남긴다.

- `pairId`
- `kind`
- `model`
- `normalizationVariant`
- `similarity`
- threshold summary
- policy guard 후 hit 가능 여부

금지:

- API Key
- App Token
- Provider Key
- Authorization header
- raw prompt 대량 출력
- provider raw error body

## threshold curve 재측정 계획

threshold 후보:

```text
0.35
0.45
0.50
0.60
0.70
0.80
0.85
0.90
0.92
```

각 threshold에서 아래를 비교한다.

- positive pair 중 threshold 이상 비율
- dynamic negative pair 중 threshold 이상 비율
- hard negative pair 중 threshold 이상 비율
- unrelated pair 중 threshold 이상 비율
- policy guard 적용 전 false positive risk
- policy guard 적용 후 hit 가능 여부

중요:

- threshold는 category별로 봐야 한다.
- `general` static guidance와 `support_refund`는 같은 threshold를 쓰면 안 된다.
- `support_refund`는 score가 좋아도 false positive 비용이 크므로 보수적으로 유지한다.

## reranker 필요 여부

전처리와 모델 비교만으로 충분하지 않으면 `reranker`가 필요하다.

reranker 위치:

```text
normalized embedding input
-> embedding vector
-> top-k vector search
-> boundary/category/intent/slot/hardNegative guard
-> reranker
-> final hit decision
```

초기 판단:

- beta 기본값으로 실시간 LLM judge를 켜지 않는다.
- 먼저 deterministic fake reranker 또는 offline eval hook으로 설계한다.
- `general` static guidance부터 검토한다.
- `support_refund`는 reranker가 있어도 production enforce를 서두르지 않는다.

reranker가 해결할 수 있는 문제:

- similarity는 높지만 답 재사용 가능성이 낮은 후보 reject
- top-k 후보 중 더 적절한 cached response 선택
- threshold 주변 ambiguous band 처리

reranker가 해결하지 못하는 문제:

- raw prompt/secret 저장 문제
- dynamic_user_state store 금지
- category classifier 오분류
- tenant/project/application boundary 문제

## beta 최소 구현 범위

1차 구현 후보는 아래로 제한한다.

- `SemanticCacheEmbeddingInputNormalizer`
- `normalizationVersion`
- masking 이후 text 사용
- last user message 중심 embedding
- whitespace normalize
- Unicode normalize
- 긴 prompt 제한 또는 shadow-only
- code/translation/tool_call/unknown bypass 유지
- dynamic_user_state embedding 전 제외 유지
- OpenAI actual eval opt-in 유지

하지 않을 것:

- canonical template embedding
- intent cache 방식
- 실시간 LLM judge 기본 활성화
- pgvector migration
- multi-vector store 구조 변경
- full category enforce

## production 적용 전 남은 위험

- 한국어 실제 traffic paraphrase 평가셋이 아직 작다.
- category classifier 오분류가 있으면 retrieval 품질 이전에 잘못된 cache 후보가 생긴다.
- `general` 안에도 정적 안내와 사용자별 동적 조회가 섞인다.
- OpenAI embedding score 분포는 model, dimensions, input normalization에 따라 바뀐다.
- threshold는 dataset이 바뀌면 다시 봐야 한다.
- reranker 없이 낮은 threshold를 쓰면 false positive 위험이 남는다.
- vector store로 확장할 때 `embeddingModel`, `dimensions`, `normalizationVersion`, `policyVersion` boundary를 분리해야 한다.

## 권장 진행 순서

1. 이 문서를 기준으로 embedding input 일반 전처리 설계 문서를 작성한다.
2. production code 변경 없이 OpenAI eval variant를 먼저 준비한다.
3. `raw prompt`와 `normalized embedding input` score 차이를 측정한다.
4. 개선폭이 작으면 reranker 설계로 넘어간다.
5. `general` static guidance만 beta enforce 후보로 유지한다.
6. `support_refund`, `account_access`는 shadow/eval을 더 모은 뒤 별도 판단한다.

## 결론

Semantic Cache 품질 개선은 threshold를 낮추거나 template으로 similarity를 강제로 올리는 방향이 아니다.

현실적인 방향은 아래다.

```text
실제 사용자 prompt 의미는 유지
+ embedding input 잡음 제거
+ model별 score 분포 측정
+ threshold curve 재측정
+ 필요 시 reranker 추가
+ 좁은 category부터 beta rollout
```

이 방식은 hit율을 단기간에 크게 올리는 마법은 아니지만, production으로 갈 수 있는 안전한 방향이다.
