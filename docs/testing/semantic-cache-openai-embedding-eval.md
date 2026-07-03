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
