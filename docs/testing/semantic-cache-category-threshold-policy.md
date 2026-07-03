# Semantic Cache Category Threshold 정책 검토

## 목적

이 문서는 Semantic Cache의 `categoryThreshold`를 category별로 분리할 필요가 있는지 검토한 결과다.

이번 작업은 production runtime 기본값 변경이 아니다. OpenAI embedding eval 결과를 근거로 `semantic_cache_policy_ko_v1.json` test policy material에 beta 후보 threshold를 반영하고, production 적용 전 남은 검증 조건을 정리한다.

## 전제

threshold는 단독 hit 조건이 아니다.

Semantic Cache hit는 반드시 아래 순서를 통과한 뒤에만 허용한다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ hardNegativeGuard pass
+ similarity >= categoryThreshold
```

따라서 `categoryThreshold`를 낮추더라도 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`를 우회하면 안 된다.

## Current Beta Policy

현재 test policy material에는 OpenAI eval 결과를 반영한 beta 후보 threshold를 적용한다.

- 파일: `apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json`
- `defaultThreshold`: `0.92`

현재 category 설정:

| category | mode | categoryThreshold | requiresIntent | requiresRequiredSlots | requiresHardNegative |
| --- | --- | ---: | --- | --- | --- |
| `account_access` | `strict_hit` | 0.50 | true | true | true |
| `general` | `strict_hit` | 0.50 | true | true | true |
| `support_refund` | `strict_hit` | 0.70 | true | true | true |
| `translation` | `disabled` | 없음 | - | - | - |
| `code` | `disabled` | 없음 | - | - | - |
| `unknown` | `disabled` | 없음 | - | - | - |

기존 일괄 `0.92`는 fake embedding test에서는 의미가 있지만, 실제 OpenAI embedding 한국어 eval에서는 너무 높았다. `text-embedding-3-small`, `text-embedding-3-large` 모두 `0.80` 이상에서 positive pair가 0건이었다.

중요한 점은 `categoryThreshold`를 낮췄더라도 hit 허용 조건은 그대로다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ hardNegativeGuard pass
+ similarity >= categoryThreshold
```

## Evaluation Basis

OpenAI eval 문서:

- `docs/testing/semantic-cache-openai-embedding-eval.md`

사용 모델:

- `text-embedding-3-small`
- `text-embedding-3-large`

평가 pair 구성:

- positive 4개
- hard negative 2개
- unrelated 3개

category별로 보면 아래 한계가 있다.

- `account_access`: positive 2개는 측정됨. 같은 category hard negative는 이번 OpenAI eval에 직접 포함되지 않았고, cross-category unrelated만 있다.
- `general`: positive 1개는 측정됨. 같은 category hard negative는 직접 측정되지 않았다.
- `support_refund`: positive 1개와 hard negative 2개가 직접 측정됨.

따라서 production threshold 확정 전에는 category별 expanded eval set이 더 필요하다.

## OpenAI Eval 요약

### `text-embedding-3-small`

| category | positive score | hard negative score | unrelated score |
| --- | --- | --- | --- |
| `account_access` | 0.355520, 0.776339 | 직접 측정 없음 | 0.246612, 0.144123 |
| `general` | 0.589263 | 직접 측정 없음 | 0.246612, 0.222343 |
| `support_refund` | 0.571208 | 0.442448, 0.345092 | 0.144123, 0.222343 |

### `text-embedding-3-large`

| category | positive score | hard negative score | unrelated score |
| --- | --- | --- | --- |
| `account_access` | 0.517135, 0.743104 | 직접 측정 없음 | 0.296511, 0.256464 |
| `general` | 0.522061 | 직접 측정 없음 | 0.296511, 0.193894 |
| `support_refund` | 0.776243 | 0.371424, 0.438555 | 0.256464, 0.193894 |

## Threshold 후보 비교

### `account_access`

`account_access`는 password reset, API Key/App Token 생성 같은 FAQ성 workflow가 많지만 credential 실제 값이 포함되면 store/hit 금지여야 한다.

`text-embedding-3-small`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 2/2 | 직접 측정 없음 | 0/2 | password reset까지 잡지만 margin이 낮음 |
| 0.45 | 1/2 | 직접 측정 없음 | 0/2 | password reset miss |
| 0.50 | 1/2 | 직접 측정 없음 | 0/2 | password reset miss |
| 0.60 | 1/2 | 직접 측정 없음 | 0/2 | recall 낮음 |
| 0.70 | 1/2 | 직접 측정 없음 | 0/2 | recall 낮음 |
| 0.80 이상 | 0/2 | 직접 측정 없음 | 0/2 | 실사용 hit 어려움 |

`text-embedding-3-large`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 2/2 | 직접 측정 없음 | 0/2 | recall은 좋지만 낮은 threshold라 guard 필수 |
| 0.45 | 2/2 | 직접 측정 없음 | 0/2 | demo/local 후보 |
| 0.50 | 2/2 | 직접 측정 없음 | 0/2 | production 후보 시작점 |
| 0.60 | 1/2 | 직접 측정 없음 | 0/2 | password reset miss |
| 0.70 | 1/2 | 직접 측정 없음 | 0/2 | recall 낮음 |
| 0.80 이상 | 0/2 | 직접 측정 없음 | 0/2 | 실사용 hit 어려움 |

권장:

- `text-embedding-3-large` 기준 `0.50`
- `text-embedding-3-small`은 password reset score가 낮아 production 기본 후보로 추천하지 않음
- API Key/App Token 실제 값이 포함된 요청은 threshold 이전에 forbidden data guard로 store/hit 금지

### `general`

`general`은 usage FAQ처럼 비교적 안전한 요청이 있지만, 사용자별 동적 정보가 들어가면 이전 응답 재사용이 위험하다. 예를 들어 "이번 달 사용량"이 실제 계정별 수치를 반환하는 응답이면 response cacheability guard가 필요하다.

`text-embedding-3-small`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.45 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.50 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.60 이상 | 0/1 | 직접 측정 없음 | 0/2 | usage pair miss |

`text-embedding-3-large`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.45 | 1/1 | 직접 측정 없음 | 0/2 | demo/local 후보 |
| 0.50 | 1/1 | 직접 측정 없음 | 0/2 | production 후보 시작점 |
| 0.60 이상 | 0/1 | 직접 측정 없음 | 0/2 | usage pair miss |

권장:

- `text-embedding-3-large` 기준 `0.50`
- response가 정적 FAQ인지, 사용자별 동적 데이터인지 구분하는 response cacheability guard가 필요
- `general`을 너무 넓게 allow하지 말고 `canonicalIntent`가 있는 FAQ/usage 계열부터 제한적으로 허용

### `support_refund`

`support_refund`는 같은 category 안에서도 배송비 환불, 주문 취소, 교환 신청, 환불 접수가 서로 다른 답을 요구한다. false positive 비용이 크므로 가장 보수적으로 유지한다.

`text-embedding-3-small`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 1/2 | 0/2 | raw similarity 단독으로 위험 |
| 0.45 | 1/1 | 0/2 | 0/2 | raw risk는 낮지만 margin 작음 |
| 0.50 | 1/1 | 0/2 | 0/2 | demo/local 후보 |
| 0.60 이상 | 0/1 | 0/2 | 0/2 | support positive miss |

`text-embedding-3-large`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 2/2 | 0/2 | raw similarity 단독으로 매우 위험 |
| 0.45 | 1/1 | 0/2 | 0/2 | demo/local 후보 |
| 0.50 | 1/1 | 0/2 | 0/2 | 가능하지만 support에는 낮은 편 |
| 0.60 | 1/1 | 0/2 | 0/2 | 보수 후보 |
| 0.70 | 1/1 | 0/2 | 0/2 | production 후보 시작점 |
| 0.80 이상 | 0/1 | 0/2 | 0/2 | support positive miss |

권장:

- `text-embedding-3-large` 기준 `0.70`
- `support_refund`는 `0.45~0.50`까지 낮추면 demo/local에서는 hit가 잘 보이지만 production 기본값으로는 아직 이르다.
- `support_refund`는 반드시 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`를 통과해야 하며, 다른 intent면 similarity가 높아도 miss다.

## Category Recommendation

세 category를 같은 threshold로 두는 것은 권장하지 않는다.

- `account_access`: measured positive가 `0.517~0.743`으로 갈라진다. `0.50`이 최소 후보.
- `general`: measured positive가 `0.522` 수준이라 `0.50`이 최소 후보.
- `support_refund`: measured positive는 높지만 false positive 비용이 크다. `0.70`처럼 더 보수적인 threshold가 맞다.

권장안은 `text-embedding-3-large`를 전제로 한다.

```json
{
  "defaultThreshold": 0.92,
  "categories": {
    "account_access": {
      "mode": "strict_hit",
      "categoryThreshold": 0.50,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "general": {
      "mode": "strict_hit",
      "categoryThreshold": 0.50,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "support_refund": {
      "mode": "strict_hit",
      "categoryThreshold": 0.70,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    }
  }
}
```

## Policy Guard 적용 전/후 위험

policy guard 적용 전:

- `support_refund`에서 threshold `0.35`는 hard negative까지 통과한다.
- `text-embedding-3-small`은 password reset positive가 `0.355520`이라 낮은 threshold를 요구하는데, 이 값은 support hard negative score와도 가깝다.
- threshold만 낮추면 서로 다른 workflow의 응답을 재사용할 위험이 있다.

policy guard 적용 후:

- 같은 `canonicalIntent`가 아니면 miss
- `requiredSlots`가 다르면 miss
- `forbiddenIntentPairs`에 걸리면 miss
- 따라서 hard negative가 threshold 이상이어도 hit하지 않는다.

## 결론

질문별 답변:

- 세 category가 같은 threshold를 써도 되는가?
  - 아니다. `support_refund`는 false positive 비용이 높아 더 보수적이어야 한다.

- `support_refund` threshold를 낮춰도 되는가?
  - demo/local에서는 `0.50`까지 낮출 수 있지만, production 기본값으로 바로 낮추면 안 된다. `text-embedding-3-large` 기준 `0.70`부터 추가 검증하는 것이 안전하다.

- demo/local threshold와 production threshold를 분리해야 하는가?
  - 분리해야 한다. demo/local은 hit 관찰 목적이고, production은 false positive 방지가 우선이다.

- threshold 조정만으로 충분한가?
  - 충분하지 않다. threshold는 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard` 이후의 마지막 조건이다.

- policy guard 없이 threshold를 낮추면 어떤 위험이 생기는가?
  - 배송비 환불과 주문 취소, 반품 배송비와 교환 신청처럼 같은 support category 안의 다른 workflow가 hit될 수 있다.
  - API Key/App Token/계정 관련 workflow도 실제 credential 또는 계정 상태가 얽히면 잘못된 응답 재사용 위험이 있다.

## Production 적용 전 남은 조건

- category별 expanded eval set 추가
- `account_access` hard negative의 실제 OpenAI similarity 측정
- `general`의 동적 응답 cacheability guard 정의
- `support_refund` positive/hard negative 확대
- 실제 응답이 정적 FAQ인지 동적 사용자 데이터인지 구분하는 store policy 추가
- `OPENAI_API_KEY`, App Token, Provider Key, Authorization header, raw prompt가 cache/log/test output에 남지 않는지 지속 검증
