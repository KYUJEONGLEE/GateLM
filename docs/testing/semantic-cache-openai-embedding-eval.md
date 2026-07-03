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
