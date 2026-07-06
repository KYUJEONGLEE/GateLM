# Semantic Cache OpenAI Embedding Similarity 평가

## 목적

이 문서는 Semantic Cache의 `general` category limited enforce 기준에서 실제 OpenAI embedding similarity 분포를 확인한 결과다.

이번 평가는 threshold 조정 근거 수집이며, production hit policy 자체를 바꾸는 작업이 아니다. 특히 `usage` 계열은 “사용량 화면/메뉴 위치 안내”처럼 정적 안내성 답변만 hit 후보로 보고, “내 이번 달 사용량 보여줘”처럼 사용자별 동적 데이터가 필요한 요청은 hit 금지로 본다.

## 실행 조건

- 측정일: 2026-07-03
- 실행 방식: opt-in Go test
- opt-in env: `SEMANTIC_CACHE_OPENAI_EVAL=1`
- provider env: `SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai`
- model env:
  - `SEMANTIC_CACHE_EMBEDDING_MODEL=text-embedding-3-small`
  - `SEMANTIC_CACHE_EMBEDDING_MODEL=text-embedding-3-large`
- `OPENAI_API_KEY`는 로컬 환경에서만 사용했고 문서, 테스트 출력, git diff에 남기지 않았다.

기본 테스트에서는 `SEMANTIC_CACHE_OPENAI_EVAL=1`이 없으면 실제 OpenAI API를 호출하지 않고 skip된다.

## 평가 Pair

문서에는 pair ID와 sanitized 한국어 예시만 남긴다. 실제 테스트 출력에는 pair ID와 score만 남기며 API Key, Authorization header, App Token, Provider Key는 남기지 않는다.

| kind | pair ID | 예시 | policy guard 후 hit 가능 |
| --- | --- | --- | --- |
| positive | `positive_usage_menu_location` | 사용량 메뉴 위치 / API 사용량 확인 화면 | 가능 |
| positive | `positive_usage_stats_screen_location` | 사용량 통계 화면 위치 / 월간 사용량 대시보드 메뉴 | 가능 |
| dynamic_negative | `dynamic_usage_current_month` | 사용량 메뉴 위치 / 내 이번 달 사용량 조회 | 불가 |
| dynamic_negative | `dynamic_usage_project_cost` | API 사용량 확인 화면 / 현재 프로젝트별 비용 조회 | 불가 |
| dynamic_negative | `dynamic_usage_today_tokens` | 사용량 통계 화면 위치 / 오늘 토큰 사용량 조회 | 불가 |
| unrelated | `unrelated_usage_vs_account_setting` | 사용량 메뉴 위치 / 계정 설정 위치 | 불가 |

## Similarity 결과

### `text-embedding-3-small`

| pair ID | kind | similarity | policy guard 후 hit 가능 |
| --- | --- | ---: | --- |
| `positive_usage_menu_location` | positive | 0.548428 | 가능 |
| `positive_usage_stats_screen_location` | positive | 0.472178 | 가능 |
| `dynamic_usage_current_month` | dynamic_negative | 0.478157 | 불가 |
| `dynamic_usage_project_cost` | dynamic_negative | 0.277072 | 불가 |
| `dynamic_usage_today_tokens` | dynamic_negative | 0.383808 | 불가 |
| `unrelated_usage_vs_account_setting` | unrelated | 0.289212 | 불가 |

| threshold | positive 이상 | dynamic negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: |
| 0.35 | 2/2 | 2/3 | 0/1 | 2/6 |
| 0.45 | 2/2 | 1/3 | 0/1 | 2/6 |
| 0.50 | 1/2 | 0/3 | 0/1 | 1/6 |
| 0.60 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.70 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.80 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.85 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.90 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.92 | 0/2 | 0/3 | 0/1 | 0/6 |

### `text-embedding-3-large`

| pair ID | kind | similarity | policy guard 후 hit 가능 |
| --- | --- | ---: | --- |
| `positive_usage_menu_location` | positive | 0.483341 | 가능 |
| `positive_usage_stats_screen_location` | positive | 0.622603 | 가능 |
| `dynamic_usage_current_month` | dynamic_negative | 0.531690 | 불가 |
| `dynamic_usage_project_cost` | dynamic_negative | 0.319116 | 불가 |
| `dynamic_usage_today_tokens` | dynamic_negative | 0.381619 | 불가 |
| `unrelated_usage_vs_account_setting` | unrelated | 0.368893 | 불가 |

| threshold | positive 이상 | dynamic negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: |
| 0.35 | 2/2 | 2/3 | 1/1 | 2/6 |
| 0.45 | 2/2 | 1/3 | 0/1 | 2/6 |
| 0.50 | 1/2 | 1/3 | 0/1 | 1/6 |
| 0.60 | 1/2 | 0/3 | 0/1 | 1/6 |
| 0.70 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.80 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.85 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.90 | 0/2 | 0/3 | 0/1 | 0/6 |
| 0.92 | 0/2 | 0/3 | 0/1 | 0/6 |

## 해석

embedding similarity만 보면 threshold를 낮출수록 정적 안내 positive recall은 올라간다. 하지만 사용자별 동적 데이터 요청도 같이 threshold를 넘을 수 있다.

- `text-embedding-3-small`
  - threshold `0.45`에서는 positive 2/2가 잡히지만 dynamic negative 1/3도 threshold 이상이다.
  - threshold `0.50`에서는 dynamic negative는 0/3이지만 positive가 1/2로 줄어든다.
  - threshold `0.80` 이상은 이번 한국어 `general` positive pair를 잡지 못한다.

- `text-embedding-3-large`
  - threshold `0.45`에서는 positive 2/2가 잡히지만 dynamic negative 1/3도 threshold 이상이다.
  - threshold `0.50`에서도 dynamic negative 1/3이 threshold 이상이다.
  - threshold `0.60`에서는 dynamic negative는 0/3이지만 positive가 1/2로 줄어든다.

## Policy Guard 적용 전/후

raw similarity 단독 기준:

- 낮은 threshold는 정적 안내 요청과 동적 데이터 조회 요청을 함께 통과시킬 수 있다.
- “사용량 메뉴 위치”와 “내 이번 달 사용량”은 말은 비슷하지만 답변 재사용 가능성이 다르다.
- threshold만 낮추는 방식은 production 기준으로 안전하지 않다.

`canonicalIntent` / `requiredSlots` / `dynamic_user_state` guard 적용 후:

- `usage.monthly_usage_check`는 `usage + usage_help` material이 있어야만 hit 후보가 된다.
- `requiredSlots`는 `usageObject=api_usage`, `usageAnswerType=static_guidance`로 제한한다.
- “내 이번 달 사용량 보여줘”, “현재 프로젝트별 비용 알려줘”, “오늘 토큰 사용량 몇이야”는 `intent_unavailable`로 embedding 호출 전 제외된다.

즉 production hit 여부는 embedding similarity 단독이 아니라 아래 조건을 모두 만족해야 한다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ dynamic_user_state 아님
+ hardNegative miss
+ similarity >= category threshold
```

## Threshold 후보

local/demo 후보:

- `general` static guidance만 대상으로 할 때 `0.45`는 recall이 좋지만 policy guard가 필수다.
- dynamic usage guard 없이 `0.45` 또는 `0.50`을 쓰면 사용자별 사용량/비용 조회가 잘못 hit될 수 있다.

production 후보:

- threshold만으로 production 적용 불가
- 최소 조건은 `canonicalIntent`, `requiredSlots`, `dynamic_user_state` guard 필수 적용
- `general`도 정적 FAQ/가이드와 사용자별 상태 조회를 분리해야 한다.
- `support_refund`는 이 문서의 general-only 결과로 완화 판단하면 안 된다.

## 결론

이번 general-only 재검증의 결론은 명확하다.

`general`이라고 해서 전부 캐시하면 안 된다. “사용량 메뉴 위치” 같은 정적 안내는 Semantic Cache hit 후보가 될 수 있지만, “내 이번 달 사용량” 같은 사용자별 데이터 조회는 embedding similarity가 높아도 hit 금지다.

따라서 beta enforce는 `general` 안에서도 static guidance intent로 좁혀야 하며, threshold 조정은 policy guard 뒤에서만 의미가 있다.

---

## Embedding Input Normalization 전/후 Actual Eval

### 목적

이 섹션은 embedding input 일반 전처리 적용 전/후 similarity 분포를 비교한 기록이다.

비교 대상은 아래 다섯 가지다.

| variant | 의미 |
| --- | --- |
| `raw_user_prompt` | 사용자가 입력한 마지막 user 문장 자체 |
| `current_normalized_text` | 이전 방식에 가까운 전체 message 결합 후 normalize된 text |
| `new_normalized_embedding_input` | masking 이후 messages에서 마지막 `user` message만 고른 뒤 일반 normalize한 text |
| `last_user_message_only` | 마지막 user message만 normalize한 text |
| `masked_normalized_embedding_input` | masking 이후 마지막 user message를 normalize한 text |

이번 평가 pair에는 secret-like 값이 없어서 `new_normalized_embedding_input`, `last_user_message_only`, `masked_normalized_embedding_input`은 동일한 score가 나온다.

### 실행

실행일: 2026-07-03

실행 명령:

```powershell
$env:SEMANTIC_CACHE_OPENAI_EVAL="1"
$env:SEMANTIC_CACHE_EMBEDDING_PROVIDER="openai"
$env:SEMANTIC_CACHE_OPENAI_EVAL_MODELS="text-embedding-3-small,text-embedding-3-large"
go test -v ./apps/gateway-core/internal/domain/cache -run "TestOpenAIEmbeddingProviderNormalizationEvalKoreanSimilarityDistribution" -count=1
```

`OPENAI_API_KEY`는 로컬 `.env`에서 프로세스 env로만 주입했다. 문서, test output, git diff에는 남기지 않았다.

### Pair

| kind | pair ID | sanitized 예시 | policy guard 후 hit 가능 |
| --- | --- | --- | --- |
| positive | `positive_password_reset` | 비밀번호 재설정 / 패스워드 초기화 | 가능 |
| positive | `positive_usage_menu_location` | 사용량 확인 위치 / API 사용량 확인 화면 | 가능 |
| positive | `positive_usage_dashboard_location` | 사용량 메뉴 위치 / 월간 사용량 대시보드 메뉴 | 가능 |
| dynamic_negative | `dynamic_usage_current_month` | 사용량 메뉴 위치 / 내 이번 달 사용량 조회 | 불가 |
| dynamic_negative | `dynamic_usage_project_cost` | API 사용량 확인 화면 / 현재 프로젝트별 비용 조회 | 불가 |
| dynamic_negative | `dynamic_usage_today_tokens` | 사용량 통계 화면 위치 / 오늘 토큰 사용량 조회 | 불가 |
| hard_negative | `hard_negative_refund_vs_cancel` | 배송비 환불 / 주문 취소 | 불가 |
| hard_negative | `hard_negative_return_shipping_vs_exchange` | 반품 배송비 환불 / 교환 신청 | 불가 |
| unrelated | `unrelated_password_vs_refund` | 비밀번호 재설정 / 배송비 환불 | 불가 |

### Pair Score

#### `text-embedding-3-small`

| pair ID | kind | raw user prompt | current normalized text | new normalized input |
| --- | --- | ---: | ---: | ---: |
| `positive_password_reset` | positive | 0.355526 | 0.824718 | 0.355526 |
| `positive_usage_menu_location` | positive | 0.622342 | 0.910168 | 0.686020 |
| `positive_usage_dashboard_location` | positive | 0.517712 | 0.817093 | 0.517712 |
| `dynamic_usage_current_month` | dynamic_negative | 0.478157 | 0.912048 | 0.478157 |
| `dynamic_usage_project_cost` | dynamic_negative | 0.268391 | 0.824050 | 0.277022 |
| `dynamic_usage_today_tokens` | dynamic_negative | 0.413376 | 0.880848 | 0.413376 |
| `hard_negative_refund_vs_cancel` | hard_negative | 0.442448 | 0.883169 | 0.442448 |
| `hard_negative_return_shipping_vs_exchange` | hard_negative | 0.345092 | 0.878131 | 0.345092 |
| `unrelated_password_vs_refund` | unrelated | 0.253113 | 0.778129 | 0.253113 |

#### `text-embedding-3-large`

| pair ID | kind | raw user prompt | current normalized text | new normalized input |
| --- | --- | ---: | ---: | ---: |
| `positive_password_reset` | positive | 0.517135 | 0.917570 | 0.517135 |
| `positive_usage_menu_location` | positive | 0.591629 | 0.941380 | 0.590047 |
| `positive_usage_dashboard_location` | positive | 0.602126 | 0.919704 | 0.602126 |
| `dynamic_usage_current_month` | dynamic_negative | 0.531674 | 0.941191 | 0.531674 |
| `dynamic_usage_project_cost` | dynamic_negative | 0.348143 | 0.855295 | 0.318906 |
| `dynamic_usage_today_tokens` | dynamic_negative | 0.434929 | 0.867330 | 0.434929 |
| `hard_negative_refund_vs_cancel` | hard_negative | 0.371500 | 0.847332 | 0.371500 |
| `hard_negative_return_shipping_vs_exchange` | hard_negative | 0.439541 | 0.853755 | 0.439541 |
| `unrelated_password_vs_refund` | unrelated | 0.215265 | 0.784083 | 0.215265 |

`current_normalized_text` score가 전체적으로 높게 나온 이유는 pair 양쪽에 같은 이전 대화/assistant context가 섞였기 때문이다. 이 값은 실제 의미 유사도가 좋아진 것이 아니라 shared context contamination에 가깝다. 따라서 이 방식은 hit 품질 개선 근거가 아니라 false positive 위험 근거로 봐야 한다.

### Threshold Summary

#### `text-embedding-3-small` / `new_normalized_embedding_input`

| threshold | positive 이상 | dynamic negative 이상 | hard negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 3/3 | 2/3 | 1/2 | 0/1 | 3/9 |
| 0.45 | 2/3 | 1/3 | 0/2 | 0/1 | 2/9 |
| 0.50 | 2/3 | 0/3 | 0/2 | 0/1 | 2/9 |
| 0.60 | 1/3 | 0/3 | 0/2 | 0/1 | 1/9 |
| 0.70 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.80 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.85 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.90 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.92 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |

#### `text-embedding-3-large` / `new_normalized_embedding_input`

| threshold | positive 이상 | dynamic negative 이상 | hard negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 3/3 | 2/3 | 2/2 | 0/1 | 3/9 |
| 0.45 | 3/3 | 1/3 | 0/2 | 0/1 | 3/9 |
| 0.50 | 3/3 | 1/3 | 0/2 | 0/1 | 3/9 |
| 0.60 | 1/3 | 0/3 | 0/2 | 0/1 | 1/9 |
| 0.70 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.80 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.85 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.90 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |
| 0.92 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |

#### `text-embedding-3-small` / `current_normalized_text`

| threshold | positive 이상 | dynamic negative 이상 | hard negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.45 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.50 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.60 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.70 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.80 | 3/3 | 3/3 | 2/2 | 0/1 | 3/9 |
| 0.85 | 1/3 | 2/3 | 2/2 | 0/1 | 1/9 |
| 0.90 | 1/3 | 1/3 | 0/2 | 0/1 | 1/9 |
| 0.92 | 0/3 | 0/3 | 0/2 | 0/1 | 0/9 |

#### `text-embedding-3-large` / `current_normalized_text`

| threshold | positive 이상 | dynamic negative 이상 | hard negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.45 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.50 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.60 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.70 | 3/3 | 3/3 | 2/2 | 1/1 | 3/9 |
| 0.80 | 3/3 | 3/3 | 2/2 | 0/1 | 3/9 |
| 0.85 | 3/3 | 3/3 | 1/2 | 0/1 | 3/9 |
| 0.90 | 3/3 | 1/3 | 0/2 | 0/1 | 3/9 |
| 0.92 | 1/3 | 1/3 | 0/2 | 0/1 | 1/9 |

### 전처리 전/후 해석

positive pair:

- `text-embedding-3-large`는 `new_normalized_embedding_input` 기준 positive 3개가 모두 `0.50` 이상이다.
- `text-embedding-3-small`은 password reset pair가 `0.355526`으로 낮다. 전처리만으로 이 pair를 높게 만들지 못한다.

dynamic negative:

- `new_normalized_embedding_input`에서도 `dynamic_usage_current_month`가 `small=0.478157`, `large=0.531674`다.
- threshold를 `0.45` 또는 `0.50` 근처로 낮추면 dynamic data 요청이 같이 통과할 수 있다.
- 따라서 `dynamic_user_state` guard 없이 threshold만 낮추면 위험하다.

hard negative:

- `small`에서는 `hard_negative_refund_vs_cancel=0.442448`, `large`에서는 `hard_negative_return_shipping_vs_exchange=0.439541`이다.
- threshold `0.35`에서는 hard negative가 통과한다.
- `support_refund`는 threshold 완화 대상이 아니다.

unrelated:

- `new_normalized_embedding_input` 기준 unrelated는 `small=0.253113`, `large=0.215265`로 낮다.
- 그러나 `current_normalized_text`처럼 공통 context가 섞이면 unrelated도 `0.78` 수준까지 올라간다.

### 결론

일반 전처리는 필요하다. 특히 마지막 `user` message만 embedding input으로 쓰면 system/developer/assistant/shared previous context가 similarity를 인위적으로 끌어올리는 문제를 줄인다.

하지만 전처리만으로 충분하지 않다.

- `password reset` pair는 `small`에서 여전히 낮다.
- `dynamic_usage_current_month`는 `large`에서 positive와 가까운 점수를 낸다.
- `support_refund` hard negative는 낮은 threshold에서 통과한다.

따라서 production hit는 계속 아래 순서여야 한다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ dynamic_user_state 아님
+ hardNegative guard 통과
+ similarity >= category threshold
```

### Reranker 필요성

reranker는 필요하다. 다만 첫 단계부터 모든 요청에 붙이는 방식은 아니다.

우선순위는 아래가 맞다.

1. `general` static guidance canary는 현재 policy guard + `text-embedding-3-large` + 보수 threshold로 제한한다.
2. `dynamic_user_state`, `support_refund`, `account_access credential`은 embedding 전/후 guard로 계속 차단한다.
3. similarity가 threshold 근처인 후보나 hard negative 위험 category만 reranker/judge 대상 후보로 올린다.

즉 reranker는 threshold를 대체하는 장치가 아니라, policy guard 이후 애매한 후보를 한 번 더 거르는 장치로 설계해야 한다.

---

## Reranker Actual Eval

### 목적

이 섹션은 `reranker` hook 추가 이후 실제 OpenAI embedding score 기준으로 raw threshold 위험과 reranker 적용 후 결과를 비교한 기록이다.

이번 평가는 production code 기본값을 바꾸지 않는다.

- OpenAI API 호출은 `SEMANTIC_CACHE_OPENAI_EVAL=1`일 때만 수행한다.
- 실시간 LLM judge는 호출하지 않았다.
- `reranker`는 eval용 deterministic 판단으로만 비교했다.
- API Key, App Token, Provider Key, Authorization header는 출력/문서/git diff에 남기지 않았다.

중요한 해석 기준:

```text
embedding similarity 단독 통과
!=
Semantic Cache hit 허용
```

현재 설계상 실제 hit 후보는 아래 순서를 통과해야 한다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ dynamic_user_state 아님
+ hardNegativeGuard 통과
+ semanticSimilarity >= categoryThreshold
+ reranker pass
```

따라서 `dynamic_negative`, `hard_negative`, `unrelated` 중 일부가 raw threshold를 넘더라도, policy guard에서 먼저 제외되면 `reranker`까지 가지 않는다.

### 실행

실행일: 2026-07-03

실행 명령:

```powershell
$env:SEMANTIC_CACHE_OPENAI_EVAL="1"
$env:SEMANTIC_CACHE_EMBEDDING_PROVIDER="openai"
$env:SEMANTIC_CACHE_OPENAI_EVAL_MODELS="text-embedding-3-small,text-embedding-3-large"
go test -v ./apps/gateway-core/internal/domain/cache -run "TestSemanticCacheRerankerOpenAIEvalKoreanSimilarityDistribution" -count=1
```

`OPENAI_API_KEY`는 로컬 `.env`에서 프로세스 env로만 주입했다. 값은 출력하지 않았다.

### Pair Score

#### `text-embedding-3-small`

| pair ID | kind | similarity | policy guard 후 hit 가능 |
| --- | --- | ---: | --- |
| `positive_password_reset` | positive | 0.355538 | 가능 |
| `positive_usage_menu_location` | positive | 0.686003 | 가능 |
| `positive_usage_dashboard_location` | positive | 0.517682 | 가능 |
| `dynamic_usage_current_month` | dynamic_negative | 0.478157 | 불가 |
| `dynamic_usage_project_cost` | dynamic_negative | 0.277072 | 불가 |
| `dynamic_usage_today_tokens` | dynamic_negative | 0.413376 | 불가 |
| `hard_negative_refund_vs_cancel` | hard_negative | 0.442448 | 불가 |
| `hard_negative_return_shipping_vs_exchange` | hard_negative | 0.344937 | 불가 |
| `unrelated_password_vs_refund` | unrelated | 0.253113 | 불가 |

#### `text-embedding-3-large`

| pair ID | kind | similarity | policy guard 후 hit 가능 |
| --- | --- | ---: | --- |
| `positive_password_reset` | positive | 0.517020 | 가능 |
| `positive_usage_menu_location` | positive | 0.590545 | 가능 |
| `positive_usage_dashboard_location` | positive | 0.601903 | 가능 |
| `dynamic_usage_current_month` | dynamic_negative | 0.531593 | 불가 |
| `dynamic_usage_project_cost` | dynamic_negative | 0.319116 | 불가 |
| `dynamic_usage_today_tokens` | dynamic_negative | 0.434973 | 불가 |
| `hard_negative_refund_vs_cancel` | hard_negative | 0.371424 | 불가 |
| `hard_negative_return_shipping_vs_exchange` | hard_negative | 0.439541 | 불가 |
| `unrelated_password_vs_refund` | unrelated | 0.215274 | 불가 |

### Threshold별 Raw 위험과 Reranker 이후 결과

#### `text-embedding-3-small`

| threshold | raw positive | raw dynamic negative | raw hard negative | raw unrelated | reranker positive pass | reranker negative pass | guard before reranker |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 3/3 | 2/3 | 1/2 | 0/1 | 3/3 | 0/6 | 3/9 |
| 0.45 | 2/3 | 1/3 | 0/2 | 0/1 | 2/3 | 0/6 | 1/9 |
| 0.50 | 2/3 | 0/3 | 0/2 | 0/1 | 2/3 | 0/6 | 0/9 |
| 0.60 | 1/3 | 0/3 | 0/2 | 0/1 | 1/3 | 0/6 | 0/9 |
| 0.70 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.80 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.85 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.90 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.92 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |

#### `text-embedding-3-large`

| threshold | raw positive | raw dynamic negative | raw hard negative | raw unrelated | reranker positive pass | reranker negative pass | guard before reranker |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 3/3 | 2/3 | 2/2 | 0/1 | 3/3 | 0/6 | 4/9 |
| 0.45 | 3/3 | 1/3 | 0/2 | 0/1 | 3/3 | 0/6 | 1/9 |
| 0.50 | 3/3 | 1/3 | 0/2 | 0/1 | 3/3 | 0/6 | 1/9 |
| 0.60 | 1/3 | 0/3 | 0/2 | 0/1 | 1/3 | 0/6 | 0/9 |
| 0.70 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.80 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.85 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.90 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |
| 0.92 | 0/3 | 0/3 | 0/2 | 0/1 | 0/3 | 0/6 | 0/9 |

### 해석

positive pair 유지:

- `text-embedding-3-small`은 threshold `0.35`에서 positive 3/3, `0.45` 또는 `0.50`에서 2/3이다.
- `text-embedding-3-large`는 threshold `0.45` 또는 `0.50`에서 positive 3/3이다.
- large 모델이 이번 한국어 eval에서는 beta recall 측면에서 더 낫다.

dynamic negative:

- `text-embedding-3-small`은 threshold `0.45`에서 dynamic negative 1/3이 raw threshold를 넘는다.
- `text-embedding-3-large`는 threshold `0.45`, `0.50`에서 dynamic negative 1/3이 raw threshold를 넘는다.
- 이 케이스는 `dynamic_user_state` guard로 reranker 전 제외되어야 한다.

hard negative:

- threshold `0.35`에서는 hard negative가 raw threshold를 넘는다.
- 특히 `text-embedding-3-large`는 hard negative 2/2가 `0.35` 이상이다.
- `support_refund`는 threshold 완화 대상이 아니며, hardNegativeGuard와 보수 threshold가 필요하다.

unrelated:

- 이번 pair에서는 unrelated가 모든 threshold에서 낮게 나왔다.
- 단, unrelated 하나만으로 production 안전성을 판단하면 안 된다.

### Reranker 적용 후 false positive 감소 효과

이번 eval에서 negative pass는 0/6이다.

다만 중요한 점은, 대부분의 negative는 reranker가 직접 줄인 것이 아니라 `canonicalIntent`, `requiredSlots`, `dynamic_user_state`, `hardNegativeGuard`가 reranker 전에 먼저 제외한 것이다.

따라서 결론은 아래처럼 봐야 한다.

- raw embedding threshold만 쓰면 false positive 위험이 있다.
- policy guard를 먼저 적용하면 위험 후보가 reranker 전에 제거된다.
- reranker는 policy guard를 통과한 애매한 후보를 한 번 더 거르는 보조 장치다.
- reranker가 policy guard를 대체하면 안 된다.

### Latency / Cost 추정

이번 opt-in eval 테스트는 두 모델 합산 약 15.57초가 걸렸다.

production 관점:

- deterministic reranker는 외부 API 호출이 없으므로 embedding 호출 외 추가 OpenAI 비용이 없다.
- 현재 beta 설계에서 reranker는 top-k 후보 이후에만 동작하므로 모든 요청에 적용되는 비용이 아니다.
- 실시간 LLM judge 또는 external reranker를 붙이면 후보별 추가 latency와 비용이 생긴다.
- 이번 MVP에서는 실시간 LLM judge를 기본값으로 켜지 않는다.

정확한 비용 산정은 모델 pricing, input token 수, top-k 후보 수, reranker provider에 따라 달라지므로 이번 문서에서는 dollar 금액으로 확정하지 않는다.

### Beta Rollout 판단

가능한 범위:

- `general` static guidance
- `text-embedding-3-large`
- threshold 후보 `0.45` 또는 `0.50`
- `canonicalIntent`, `requiredSlots`, `dynamic_user_state`, `hardNegativeGuard` 통과 필수
- reranker는 shadow/eval 또는 deterministic guard 보조로 시작

아직 금지 또는 보류:

- `support_refund` enforce 확대
- dynamic usage/cost/token count 요청 cache hit
- threshold 단독 hit
- 실시간 LLM judge 기본 활성화

결론:

beta rollout은 `general` static guidance 한정으로 가능하다. 단, reranker가 있어도 policy guard 없이 threshold를 낮추면 안 된다.

---

## Reranker Actual Eval - 현실형 확장 Pair

### 목적

기존 eval pair는 의미가 너무 가까운 paraphrase가 많았다. 이번 섹션은 실제 사용자가 할 법한 표현을 더 섞어서 다시 측정한 결과다.

추가한 유형:

- `general` static guidance: 메뉴/화면/리포트 위치를 묻는 표현
- `account_access`: password reset, App Token 생성 안내
- `dynamic_negative`: 실제 사용량/비용/API Key 값처럼 사용자별 상태 또는 credential 값이 필요한 요청
- `hard_negative`: API Key 생성 vs 삭제, password reset vs account delete, refund vs exchange/cancel
- `unrelated`: 서로 다른 category의 요청

실행일: 2026-07-03

실행 명령:

```powershell
$env:SEMANTIC_CACHE_OPENAI_EVAL="1"
$env:SEMANTIC_CACHE_EMBEDDING_PROVIDER="openai"
$env:SEMANTIC_CACHE_OPENAI_EVAL_MODELS="text-embedding-3-small,text-embedding-3-large"
go test -v ./apps/gateway-core/internal/domain/cache -run "TestSemanticCacheRerankerOpenAIEvalKoreanSimilarityDistribution" -count=1
```

`OPENAI_API_KEY`는 로컬 `.env`에서 프로세스 env로만 주입했다. 값은 출력하지 않았다.

### 주요 Pair Score

#### `text-embedding-3-small`

| pair ID | kind | similarity | 해석 |
| --- | --- | ---: | --- |
| `positive_usage_token_dashboard_location_realistic` | positive | 0.546574 | static guidance hit 후보 |
| `positive_usage_cost_report_location_realistic` | positive | 0.407258 | threshold 0.50에서는 miss |
| `positive_account_password_reset_realistic` | positive | 0.434999 | threshold 0.50에서는 miss |
| `positive_account_app_token_create_realistic` | positive | 0.276981 | small 모델로는 recall 낮음 |
| `dynamic_account_api_key_create_vs_show_secret_realistic` | dynamic_negative | 0.484014 | credential 조회 위험, guard 필수 |
| `hard_negative_api_key_create_vs_delete_realistic` | hard_negative | 0.714895 | 매우 위험, threshold 단독 금지 근거 |
| `hard_negative_refund_request_vs_exchange_menu_realistic` | hard_negative | 0.330606 | 낮음 |

#### `text-embedding-3-large`

| pair ID | kind | similarity | 해석 |
| --- | --- | ---: | --- |
| `positive_usage_token_dashboard_location_realistic` | positive | 0.572901 | static guidance hit 후보 |
| `positive_usage_cost_report_location_realistic` | positive | 0.555110 | static guidance hit 후보 |
| `positive_account_password_reset_realistic` | positive | 0.533313 | shadow hit 후보 |
| `positive_account_app_token_create_realistic` | positive | 0.498377 | threshold 0.50 근처, shadow 유지 |
| `dynamic_account_api_key_create_vs_show_secret_realistic` | dynamic_negative | 0.605155 | credential 조회 위험, guard 필수 |
| `hard_negative_api_key_create_vs_delete_realistic` | hard_negative | 0.769811 | 매우 위험, account enforce 금지 근거 |
| `hard_negative_refund_request_vs_exchange_menu_realistic` | hard_negative | 0.479730 | threshold 0.45에서 raw 통과 |

### Threshold Summary

#### `text-embedding-3-small` / 확장 22 pair

| threshold | raw positive | raw dynamic negative | raw hard negative | raw unrelated | reranker positive pass | reranker negative pass | guard before reranker |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 6/7 | 3/6 | 3/6 | 0/3 | 6/7 | 0/15 | 6/22 |
| 0.45 | 3/7 | 2/6 | 1/6 | 0/3 | 3/7 | 0/15 | 3/22 |
| 0.50 | 3/7 | 0/6 | 1/6 | 0/3 | 3/7 | 0/15 | 1/22 |
| 0.60 | 1/7 | 0/6 | 1/6 | 0/3 | 1/7 | 0/15 | 1/22 |
| 0.70 | 0/7 | 0/6 | 1/6 | 0/3 | 0/7 | 0/15 | 1/22 |
| 0.80 이상 | 0/7 | 0/6 | 0/6 | 0/3 | 0/7 | 0/15 | 0/22 |

#### `text-embedding-3-large` / 확장 22 pair

| threshold | raw positive | raw dynamic negative | raw hard negative | raw unrelated | reranker positive pass | reranker negative pass | guard before reranker |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.35 | 7/7 | 3/6 | 5/6 | 0/3 | 7/7 | 0/15 | 8/22 |
| 0.45 | 7/7 | 2/6 | 2/6 | 0/3 | 7/7 | 0/15 | 4/22 |
| 0.50 | 6/7 | 2/6 | 1/6 | 0/3 | 6/7 | 0/15 | 3/22 |
| 0.60 | 1/7 | 1/6 | 1/6 | 0/3 | 1/7 | 0/15 | 2/22 |
| 0.70 | 0/7 | 0/6 | 1/6 | 0/3 | 0/7 | 0/15 | 1/22 |
| 0.80 이상 | 0/7 | 0/6 | 0/6 | 0/3 | 0/7 | 0/15 | 0/22 |

### 해석

이번 확장 eval에서 가장 중요한 결과는 `account_access` 위험이다.

- `API Key 생성` vs `API Key 삭제`가 `small=0.714895`, `large=0.769811`까지 나왔다.
- `API Key 발급 메뉴` vs `내 API Key 값 다시 보여줘`도 `small=0.484014`, `large=0.605155`다.
- 따라서 `account_access`는 threshold를 낮춰 enforce하면 안 된다. credential/action guard와 hard negative가 먼저 필요하다.

`general` static guidance는 여전히 가장 현실적인 beta 후보로 남는다.

- `large` 기준 usage/menu/report location positive는 대체로 `0.55~0.60`대다.
- `general` static guidance만 보면 `categoryThreshold=0.50`은 후보로 유지할 수 있다.
- 다만 실제 사용량/비용 수치를 묻는 dynamic query는 계속 bypass해야 한다.

`small` 모델은 beta enforce 기본 후보로 부족하다.

- realistic positive 7개 중 threshold `0.50`에서 3/7만 통과했다.
- threshold를 `0.35`까지 낮추면 positive는 6/7이지만 dynamic/hard negative도 6건 raw 통과한다.

`large` 모델도 threshold만으로 안전하지 않다.

- threshold `0.45`에서는 positive 7/7이지만 dynamic negative 2/6, hard negative 2/6도 raw 통과한다.
- threshold `0.50`에서도 dynamic negative 2/6, hard negative 1/6이 raw 통과한다.
- 따라서 `canonicalIntent`, `requiredSlots`, `dynamic_user_state`, `hardNegativeGuard`, `reranker`가 필수다.

### 정책 영향

이번 확장 eval 이후 정책 결론:

- `general` static guidance: `text-embedding-3-large`, threshold `0.50` limited enforce 후보 유지
- `account_access`: enforce 금지, shadow 유지
- `support_refund`: enforce 금지, strict shadow 또는 candidate_only 유지
- `code`, `translation`, `unknown`: deny 유지
- `dynamic_user_state`: embedding/reranker 전 bypass 유지

특히 `account_access`는 positive도 잡히지만 hard negative score가 너무 높다. 비용 절감보다 오답/credential 사고 위험이 크므로 beta enforce 대상이 아니다.
