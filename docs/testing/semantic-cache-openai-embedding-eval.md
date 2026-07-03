# Semantic Cache OpenAI Embedding Similarity 평가

## 목적

이 문서는 Semantic Cache의 `canonicalIntent` / `requiredSlots` / `hardNegative` policy를 유지한 상태에서, 실제 OpenAI embedding similarity 분포를 확인한 결과다.

이번 평가는 threshold 조정 판단을 위한 근거 수집이며, production hit policy 자체를 변경하지 않는다.

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

문서에는 raw prompt를 대량 저장하지 않고 pair label만 남긴다. 실제 테스트 입력은 `TestOpenAIEmbeddingProviderEvalKoreanSimilarityDistribution` 안에 있으며, 테스트 출력에는 pair ID와 score만 남긴다.

| kind | pair ID | 의미 |
| --- | --- | --- |
| positive | `positive_password_reset` | password reset paraphrase |
| positive | `positive_api_key_create` | API Key creation paraphrase |
| positive | `positive_usage_stats` | usage stats paraphrase |
| positive | `positive_shipping_fee_refund` | shipping fee refund paraphrase |
| hard_negative | `hard_negative_shipping_fee_vs_order_cancel` | shipping fee refund vs order cancel |
| hard_negative | `hard_negative_return_shipping_fee_vs_exchange` | return shipping fee vs exchange request |
| unrelated | `unrelated_password_reset_vs_usage` | password reset vs usage stats |
| unrelated | `unrelated_api_key_vs_shipping_fee` | API Key creation vs shipping fee refund |
| unrelated | `unrelated_usage_vs_order_cancel` | usage stats vs order cancel |

## Similarity 결과

### `text-embedding-3-small`

| pair ID | kind | similarity | policy guard 후 hit 가능 |
| --- | --- | ---: | --- |
| `positive_password_reset` | positive | 0.355520 | 가능 |
| `positive_api_key_create` | positive | 0.776339 | 가능 |
| `positive_usage_stats` | positive | 0.589263 | 가능 |
| `positive_shipping_fee_refund` | positive | 0.571208 | 가능 |
| `hard_negative_shipping_fee_vs_order_cancel` | hard_negative | 0.442448 | 불가 |
| `hard_negative_return_shipping_fee_vs_exchange` | hard_negative | 0.345092 | 불가 |
| `unrelated_password_reset_vs_usage` | unrelated | 0.246612 | 불가 |
| `unrelated_api_key_vs_shipping_fee` | unrelated | 0.144123 | 불가 |
| `unrelated_usage_vs_order_cancel` | unrelated | 0.222343 | 불가 |

| threshold | positive 이상 | hard negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: |
| 0.35 | 4/4 | 1/2 | 0/3 | 4/9 |
| 0.45 | 3/4 | 0/2 | 0/3 | 3/9 |
| 0.50 | 3/4 | 0/2 | 0/3 | 3/9 |
| 0.60 | 1/4 | 0/2 | 0/3 | 1/9 |
| 0.70 | 1/4 | 0/2 | 0/3 | 1/9 |
| 0.80 | 0/4 | 0/2 | 0/3 | 0/9 |
| 0.85 | 0/4 | 0/2 | 0/3 | 0/9 |
| 0.90 | 0/4 | 0/2 | 0/3 | 0/9 |
| 0.92 | 0/4 | 0/2 | 0/3 | 0/9 |

### `text-embedding-3-large`

| pair ID | kind | similarity | policy guard 후 hit 가능 |
| --- | --- | ---: | --- |
| `positive_password_reset` | positive | 0.517135 | 가능 |
| `positive_api_key_create` | positive | 0.743104 | 가능 |
| `positive_usage_stats` | positive | 0.522061 | 가능 |
| `positive_shipping_fee_refund` | positive | 0.776243 | 가능 |
| `hard_negative_shipping_fee_vs_order_cancel` | hard_negative | 0.371424 | 불가 |
| `hard_negative_return_shipping_fee_vs_exchange` | hard_negative | 0.438555 | 불가 |
| `unrelated_password_reset_vs_usage` | unrelated | 0.296511 | 불가 |
| `unrelated_api_key_vs_shipping_fee` | unrelated | 0.256464 | 불가 |
| `unrelated_usage_vs_order_cancel` | unrelated | 0.193894 | 불가 |

| threshold | positive 이상 | hard negative 이상 | unrelated 이상 | policy guard 후 hit 가능 |
| ---: | ---: | ---: | ---: | ---: |
| 0.35 | 4/4 | 2/2 | 0/3 | 4/9 |
| 0.45 | 4/4 | 0/2 | 0/3 | 4/9 |
| 0.50 | 4/4 | 0/2 | 0/3 | 4/9 |
| 0.60 | 2/4 | 0/2 | 0/3 | 2/9 |
| 0.70 | 2/4 | 0/2 | 0/3 | 2/9 |
| 0.80 | 0/4 | 0/2 | 0/3 | 0/9 |
| 0.85 | 0/4 | 0/2 | 0/3 | 0/9 |
| 0.90 | 0/4 | 0/2 | 0/3 | 0/9 |
| 0.92 | 0/4 | 0/2 | 0/3 | 0/9 |

## 해석

embedding similarity만 보면 threshold를 낮출수록 positive recall은 올라가지만 false positive 위험도 같이 커진다.

- `text-embedding-3-small`
  - threshold `0.35`에서는 positive 4/4가 잡히지만 hard negative 1/2도 threshold 이상이다.
  - threshold `0.45` 또는 `0.50`에서는 hard negative/unrelated는 0건이지만 positive가 3/4로 줄어든다.
  - threshold `0.80` 이상은 이번 한국어 positive pair를 사실상 잡지 못한다.

- `text-embedding-3-large`
  - threshold `0.45` 또는 `0.50`에서 positive 4/4, hard negative 0/2, unrelated 0/3이었다.
  - threshold `0.35`에서는 hard negative 2/2도 threshold 이상이라 similarity 단독 hit로는 위험하다.
  - threshold `0.80` 이상은 이번 한국어 positive pair를 잡지 못한다.

## Policy Guard 적용 전/후

raw similarity 단독 기준:

- 낮은 threshold는 hard negative를 통과시킬 수 있다.
- 특히 support/refund 계열은 문장 표면이 가까워 false positive 위험이 있다.
- threshold만 낮추는 방식은 production 기준으로 안전하지 않다.

`canonicalIntent` / `requiredSlots` / `hardNegative` policy guard 적용 후:

- positive pair만 hit 후보가 된다.
- hard negative pair는 similarity가 threshold 이상이어도 hit 불가다.
- unrelated pair도 category/intent/slot 불일치로 hit 불가다.

즉 production hit 여부는 embedding similarity 단독이 아니라 아래 조건을 모두 만족해야 한다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ hardNegative miss
+ similarity >= category threshold
```

## Threshold 후보

현재 측정 기준의 local/demo 후보:

- `text-embedding-3-large`: `0.45` 또는 `0.50`
- `text-embedding-3-small`: `0.45` 또는 `0.50`은 일부 positive를 놓치며, `0.35`는 hard negative raw risk가 있어 demo에서도 policy guard가 필수다.

production 후보:

- threshold만으로 production 적용 불가
- 최소 조건은 policy guard 필수 적용
- `text-embedding-3-large` 기준으로는 `0.50`부터 추가 평가셋을 확장해 검토할 수 있다.
- `support_refund`는 별도 category threshold와 hard negative guard를 유지해야 한다.

## 결론

이번 결과만 보면 `text-embedding-3-large`가 한국어 Semantic Cache 후보 판별에 더 안정적이다.

다만 production-ready라고 판단하기에는 평가 pair가 아직 작다. 다음 단계는 실제 도메인별 expanded eval set을 늘리고, category별 threshold를 따로 측정하는 것이다.

