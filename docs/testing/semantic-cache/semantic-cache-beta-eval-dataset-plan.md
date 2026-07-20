# Semantic Cache Beta Eval Dataset Plan

이 문서는 Semantic Cache를 beta 수준으로 올리기 위한 intent taxonomy와 evaluation dataset 확장 계획이다.

이번 문서는 구현 변경이 아니라 평가셋/테스트 계약 정리다. 대량 평가 데이터를 바로 생성하지 않고, 50개 cacheable intents와 500~1,000개 eval pairs까지 확장할 때 사용할 파일 구조, field 계약, 테스트 실행 방식을 먼저 고정한다.

## 현재 상태

현재 기본 평가셋:

```text
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_intent_eval_cases.json
```

현재 규모:

| 항목 | 개수 |
| --- | ---: |
| 전체 cases | 30 |
| `account_access` | 10 |
| `general` | 2 |
| `support_refund` | 12 |
| `translation` | 2 |
| `code` | 2 |
| `unknown` | 2 |
| `hit_candidate` | 8 |
| `strict_hit_candidate` | 6 |
| `miss` | 10 |
| `bypass` | 6 |

현재 평가셋은 한국어 중심의 core contract로는 의미가 있지만, beta 기준으로는 부족하다.

부족한 점:

- cacheable intent 수가 50개에 못 미침
- `general`/billing/usage 계열 coverage가 작음
- 같은 category 안 hard negative가 더 필요함
- store eligibility eval과 hit policy eval이 아직 분리되어 있지 않음
- extended regression runner가 아직 없음

## Beta 목표

Beta 목표는 production 완성판이 아니라, 안전한 provider bypass 후보를 제한적으로 검증할 수 있는 수준이다.

| 목표 | 기준 |
| --- | ---: |
| cacheable intents | 최소 50개 |
| eval pairs | 500~1,000개 |
| core eval pairs | 50~100개 |
| extended eval pairs | 450~900개 |
| OpenAI eval | opt-in 유지 |
| 기본 테스트 | `OPENAI_API_KEY` 없이 통과 |

성공 기준:

```text
sameAnswerReusable=true
+ category allowed
+ canonicalIntent match
+ requiredSlots compatible
+ hardNegative=false
+ similarity >= categoryThreshold
=> hit candidate
```

금지 기준:

```text
sameAnswerReusable=false
OR hardNegative=true
OR denyCategory=true
OR requiredSlots mismatch
OR canonicalIntent mismatch
=> hit 금지
```

## 파일 분리 전략

단일 JSON 파일에 500~1,000개 pair를 모두 넣지 않는다. 기본 테스트와 확장 테스트의 목적이 다르기 때문이다.

권장 구조:

```text
apps/gateway-core/internal/domain/cache/testdata/
  semantic_cache_intent_eval_core_ko_v1.json
  semantic_cache_intent_eval_account_access_ko_v1.json
  semantic_cache_intent_eval_general_billing_usage_ko_v1.json
  semantic_cache_intent_eval_support_refund_ko_v1.json
  semantic_cache_intent_eval_deny_restricted_ko_v1.json
  semantic_cache_store_eval_core_ko_v1.json
```

기존 파일 처리:

```text
semantic_cache_intent_eval_cases.json
=> 당장은 core compatibility 파일로 유지
=> 다음 PR에서 semantic_cache_intent_eval_core_ko_v1.json로 rename 또는 copy 후 runner가 여러 파일을 읽도록 전환
```

## 파일별 책임

| 파일 | 기본 테스트 | 목적 | 목표 pair 수 |
| --- | ---: | --- | ---: |
| `semantic_cache_intent_eval_core_ko_v1.json` | 예 | release gate용 핵심 회귀 | 50~100 |
| `semantic_cache_intent_eval_account_access_ko_v1.json` | 아니오 | 계정/credential workflow 확장 | 150~250 |
| `semantic_cache_intent_eval_general_billing_usage_ko_v1.json` | 아니오 | 사용량, billing, dashboard, 설정 FAQ | 120~200 |
| `semantic_cache_intent_eval_support_refund_ko_v1.json` | 아니오 | 환불, 반품, 취소, 교환 hard negative | 180~300 |
| `semantic_cache_intent_eval_deny_restricted_ko_v1.json` | 아니오 | deny category, sensitive, tool_call, unknown | 80~150 |
| `semantic_cache_store_eval_core_ko_v1.json` | 예 | store allowed/bypass 회귀 | 30~80 |

기본 테스트에는 작고 안정적인 core만 포함한다. Extended eval은 opt-in으로 돌린다.

## Dataset 공통 Schema 후보

Intent hit policy eval 파일은 아래 top-level 구조를 따른다.

```json
{
  "datasetId": "semantic-cache-intent-eval-account-access-ko-v1",
  "datasetType": "intent_hit_policy",
  "language": "ko",
  "policyVersion": "semantic-cache-policy-ko-v1",
  "canonicalizationVersion": "ko-canon-v1",
  "owner": "gateway-core",
  "defaultRunMode": "extended",
  "cases": []
}
```

`cases[]` field 후보:

| field | 필수 | 설명 |
| --- | ---: | --- |
| `caseId` | 예 | low-cardinality case id |
| `pairType` | 예 | `positive`, `positive_strict`, `hard_negative`, `deny_category`, `slot_mismatch` |
| `category` | 예 | `account_access`, `general`, `support_refund`, `translation`, `code`, `unknown` 등 |
| `canonicalIntent` | 조건부 | positive pair의 기대 intent |
| `firstCanonicalIntent` | 조건부 | negative pair의 첫 번째 기대 intent |
| `secondCanonicalIntent` | 조건부 | negative pair의 두 번째 기대 intent |
| `first` | 예 | synthetic Korean request text |
| `second` | 예 | synthetic Korean request text |
| `requiredSlots` | 조건부 | positive pair의 required slot map |
| `firstRequiredSlots` | 조건부 | negative pair의 첫 번째 slot map |
| `secondRequiredSlots` | 조건부 | negative pair의 두 번째 slot map |
| `optionalSlots` | 아니오 | optional slot map |
| `sameAnswerReusable` | 예 | 같은 답 재사용 가능 여부 |
| `hardNegative` | 예 | 높은 similarity에도 hit 금지 여부 |
| `denyCategory` | 예 | category policy상 lookup/store bypass 여부 |
| `expectedDecision` | 예 | `hit_candidate`, `strict_hit_candidate`, `miss`, `bypass` |
| `riskLevel` | 예 | `low`, `medium`, `high` |
| `reason` | 예 | 사람이 읽는 low-cardinality 이유 |

주의:

- `first`, `second`는 synthetic Korean example만 사용한다.
- 실제 고객 요청, 주문번호, 이메일, 전화번호, credential, secret, token, Authorization header 값은 넣지 않는다.
- `requiredSlots`에는 raw detected value를 넣지 않는다.
- identifier가 필요한 경우 `unknown`, `present`, `absent`, `policy_only` 같은 low-cardinality enum으로 표현한다.

## Store Eval Schema 후보

Store eligibility eval은 hit policy eval과 분리한다.

Top-level:

```json
{
  "datasetId": "semantic-cache-store-eval-core-ko-v1",
  "datasetType": "store_eligibility",
  "language": "ko",
  "storePolicyVersion": "semantic-cache-store-policy-ko-v1",
  "cases": []
}
```

`cases[]` field 후보:

| field | 필수 | 설명 |
| --- | ---: | --- |
| `caseId` | 예 | low-cardinality case id |
| `category` | 예 | request category |
| `canonicalIntent` | 조건부 | request intent |
| `requiredSlots` | 조건부 | request required slot map |
| `responseCacheabilityClass` | 예 | `static_guidance`, `policy_summary`, `dynamic_user_state`, `credential_or_secret`, `provider_error`, `unsafe_or_unknown` |
| `providerOutcome` | 예 | `success`, `error` |
| `fallbackUsed` | 예 | fallback 여부 |
| `stream` | 예 | stream 여부 |
| `containsForbiddenPayload` | 예 | forbidden payload marker 여부 |
| `expectedStoreDecision` | 예 | `store_allowed`, `store_bypass` |
| `expectedReason` | 예 | store decision reason enum |
| `riskLevel` | 예 | `low`, `medium`, `high` |
| `reason` | 예 | 사람이 읽는 low-cardinality 이유 |

응답 원문은 넣지 않는다. 필요한 경우 synthetic response class와 marker boolean만 둔다.

## Intent 목표 분배

50개 cacheable intents 목표는 아래처럼 나눈다.

| domain | 목표 intents | 예시 |
| --- | ---: | --- |
| `account_access` | 15 | password reset, API Key create, App Token create, credential rotation guide, account settings |
| `general` | 15 | dashboard location, docs lookup, usage page, model catalog guide, project settings |
| `billing_usage` | 8 | monthly usage guide, quota page guide, invoice page guide, budget alert guide |
| `support_refund` | 12 | shipping fee refund, return request, order cancel, exchange request, refund request |

합계 50개다.

`billing_usage`는 별도 category로 바로 추가한다는 뜻이 아니다. beta eval 파일에서는 `general` 내부 세부 domain으로 다루고, production category 확장은 별도 계약에서 결정한다.

## Pair 생성 비율

각 cacheable intent는 최소 아래 pair를 가진다.

| pair 유형 | intent당 최소 |
| --- | ---: |
| positive paraphrase | 4 |
| slot variant positive | 1 |
| same category hard negative | 3 |
| cross category hard negative | 1 |
| deny/restricted neighbor | 1 |

50 intents 기준 최소 500 pairs가 된다.

권장 비율:

| pairType | 비율 |
| --- | ---: |
| `positive` | 35~45% |
| `positive_strict` | 10~15% |
| `hard_negative` | 30~40% |
| `slot_mismatch` | 5~10% |
| `deny_category` | 10~15% |

`support_refund`는 hard negative 비율을 다른 domain보다 높게 둔다.

## Core Eval 기준

Core eval은 기본 `go test`에서 항상 실행한다.

Core에 들어갈 조건:

- product demo에서 반드시 보여줄 한국어 케이스
- security-critical deny case
- support_refund hard negative 대표 case
- threshold 변경 때 깨지면 즉시 알아야 하는 case
- OpenAI API 없이 deterministic fake vector로 검증 가능한 case

Core에 넣지 않는 것:

- 표현만 다른 대량 paraphrase
- 운영 로그에서 추출한 문장
- OpenAI score distribution 측정용 pair
- 비용이 큰 extended eval

## Extended Eval 기준

Extended eval은 opt-in으로 실행한다.

권장 env:

```text
SEMANTIC_CACHE_EXTENDED_EVAL=1
```

권장 명령:

```powershell
$env:SEMANTIC_CACHE_EXTENDED_EVAL="1"
go test -v ./apps/gateway-core/internal/domain/cache -run "TestSemanticCacheIntentExtendedEval" -count=1
```

Extended eval 책임:

- 500~1,000 pair 전체 검증
- domain별 pass/fail summary 출력
- `expectedDecision`별 pass/fail summary 출력
- hard negative hit 발생 시 실패
- deny category hit 발생 시 실패
- OpenAI API 호출 없음

## OpenAI Eval 분리

OpenAI embedding score 측정은 extended eval과도 분리한다.

기존 opt-in:

```text
SEMANTIC_CACHE_OPENAI_EVAL=1
```

원칙:

- `OPENAI_API_KEY`가 없으면 skip
- 기본 테스트에서는 절대 호출하지 않음
- API Key, App Token, Provider Key, Authorization header, provider raw error body를 출력하지 않음
- test output에는 `caseId`, `pairType`, `score`, threshold summary만 남김

## Runner 설계 초안

### 기본 runner

```text
TestSemanticCacheIntentEvalCasesMatchHitPolicyContract
=> core dataset만 로드
=> 기본 go test에서 실행
```

### extended runner

```text
TestSemanticCacheIntentExtendedEval
=> SEMANTIC_CACHE_EXTENDED_EVAL=1일 때만 실행
=> account_access/general/support_refund/deny 파일 로드
=> summary 출력
```

### store runner

```text
TestSemanticCacheStoreEvalCases
=> store core dataset 로드
=> OPENAI_API_KEY 없이 실행
=> store_allowed/store_bypass 검증
=> bypass case에서 embedding 호출 없음 검증
```

## Threshold Summary 출력 설계

Threshold summary는 OpenAI eval 전용이 아니라, beta runner에서도 policy 변경 영향을 빠르게 보려고 남긴다.

출력 원칙:

- case text를 출력하지 않는다.
- `caseId`, `category`, `pairType`, `expectedDecision`, score bucket, pass/fail count만 출력한다.
- API Key, App Token, Provider Key, Authorization header, provider raw error body를 출력하지 않는다.
- 기본 `go test`에서는 너무 긴 summary를 출력하지 않는다.

권장 threshold 후보:

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

Extended runner summary 후보:

```text
dataset=semantic-cache-intent-eval-account-access-ko-v1
threshold=0.50
positivePass=...
hardNegativeHit=0
denyCategoryHit=0
slotMismatchHit=0
policyGuardMiss=...
```

OpenAI eval summary 후보:

```text
model=text-embedding-3-large
threshold=0.50
positiveAbove=...
hardNegativeAbove=...
unrelatedAbove=...
policyGuardHitPossible=...
```

판정 기준:

| 항목 | 실패 조건 |
| --- | --- |
| `hardNegativeHit` | 1건 이상 |
| `denyCategoryHit` | 1건 이상 |
| `slotMismatchHit` | 1건 이상 |
| `positivePass` | domain별 최소 기준 미달 |
| `policyGuardHitPossible` | hard negative 또는 deny category에서 true |

OpenAI eval의 `hardNegativeAbove`는 바로 실패가 아닐 수 있다. embedding score만 높아도 `hardNegativeGuard`가 miss시키면 policy는 정상이다. 다만 이 값이 높으면 threshold만 낮추는 정책이 위험하다는 evidence로 본다.

## Release Gate 후보

Beta release gate:

- core eval 100% 통과
- store core eval 100% 통과
- hard negative hit 0건
- deny category hit 0건
- forbidden data scan 통과
- OpenAI eval은 최소 1회 수동 evidence로만 요구

Production 전 gate:

- extended eval 100% 통과
- 각 domain별 최소 pair 수 충족
- category별 threshold 근거 최신화
- support_refund expanded hard negative 100% miss
- store eligibility eval 100% 통과
- request/log/detail/cache forbidden data 검증 자동화

## 다음 작업 순서

1. 기존 `semantic_cache_intent_eval_cases.json`를 core 파일로 분리할지 결정
2. extended eval file loader 설계
3. `SEMANTIC_CACHE_EXTENDED_EVAL=1` runner 추가
4. store eval core dataset 추가
5. domain별 eval file skeleton 추가
6. 이후 실제 500~1,000 pair를 단계적으로 채움

지금 단계에서는 5번까지의 구조만 만들고, 대량 pair 생성은 별도 PR로 분리한다.
