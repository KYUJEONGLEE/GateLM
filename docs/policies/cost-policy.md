# GateLM Cost Policy

## 문서 목적

이 문서는 GateLM에서 LLM 요청 비용을 계산하고, 예산/Quota 사전 차단, Dashboard 비용 분석, Request Log Detail, Usage Ledger, 향후 과금/정산 기능을 구현할 때 기준으로 삼는 비용 계산 정책 문서다.

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. 비용 계산도 MVP에서 몇 개 모델만 하드코딩하는 방식이 아니라, Provider, Model, Processing Mode, Context Tier, Modality, Cache, Batch, Enterprise Contract, 환율, 과금 정책이 늘어나도 기존 로그와 API 계약을 깨지 않도록 설계한다.

---

# 0. 최상위 원칙

## 0.1 확장 가능성은 기본값이다

비용 계산은 아래 전제를 따른다.

- Provider와 Model은 enum으로 닫지 않는다.
- 모델 가격은 코드 상수로 하드코딩하지 않는다.
- 가격표는 DB의 versioned price catalog로 관리한다.
- 같은 모델이라도 `processingMode`, `contextTier`, `modality`, `region`, `tenantContract`에 따라 가격이 달라질 수 있다.
- 가격표가 변경되어도 과거 요청 로그의 비용은 덮어쓰지 않는다.
- 예상 비용과 실제 비용은 반드시 구분한다.
- 비용 집계는 float가 아니라 정수 단위인 `costMicroUsd`를 기준으로 한다.
- 환율은 표시와 정산 정책의 문제이며, LLM Provider 비용 계산의 canonical currency는 USD다.

## 0.2 비용 계산 기준 문서 우선순위

비용 관련 구현은 아래 문서 순서를 따른다.

```text
master-spec.md
-> project-overview.md
-> architecture.md
-> gateway-flow.md
-> pii-masking-policy.md
-> cost-policy.md
-> llm-log-schema.md
-> db-schema.md
-> api-spec.md
-> coding-convention.md
-> ai-coding-rules.md
-> 실제 구현
```

충돌 시 아래 기준을 따른다.

1. 비용 계산 공식과 가격 정책은 이 문서를 따른다.
2. 비용 로그 필드와 status 의미는 `llm-log-schema.md`를 따른다.
3. 비용 저장 테이블과 column type은 `db-schema.md`를 따른다.
4. 비용 조회/분석 API의 response shape은 `api-spec.md`를 따른다.
5. Gateway에서 비용을 계산하고 이벤트로 넘기는 흐름은 `gateway-flow.md`를 따른다.
6. 민감정보 block 요청의 Provider 미호출 비용 처리 기준은 `pii-masking-policy.md`, `llm-log-schema.md`, 이 문서를 함께 따른다.

## 0.3 MVP 기본 범위

MVP에서 비용 계산은 아래 범위를 우선 구현한다.

- Text-only LLM 요청 비용 계산
- OpenAI-compatible Chat Completion 요청 비용 계산
- Provider 응답의 token usage 기반 actual cost 계산
- Provider 응답에 usage가 없을 때 tokenizer 기반 estimated fallback 계산
- Gateway cache hit 시 actual provider cost 0 처리
- Gateway cache로 절감된 추정 비용 계산
- Project/User/Application/App Token 단위 예산 pre-check
- Request Log / Dashboard / Usage Ledger에 비용 반영

MVP에서는 아래는 확장 구조만 둔다.

- 고객사 과금 invoice 생성
- markup / discount / reseller margin
- multi-currency 정산
- 음성/이미지/파일/툴 사용량 과금
- Provider invoice reconciliation 자동화

---

# 1. 가격 단위와 공통 필드

## 1.1 기본 단위

모든 모델 가격은 기본적으로 **USD per 1M tokens**로 저장한다.

```text
1M tokens = 1,000,000 tokens
MTok = Million tokens
```

DB와 event에서는 계산 안정성을 위해 아래 단위를 사용한다.

| 필드 | 의미 | 단위 |
|---|---|---:|
| `costUsd` | 표시용 비용 | decimal string |
| `costMicroUsd` | 집계용 비용 | integer, 1 USD = 1,000,000 micro USD |
| `unitPriceUsdPer1MTokens` | 가격표 표시용 단가 | decimal string |
| `unitPriceMicroUsdPer1MTokens` | 내부 계산용 단가 | integer, micro USD / 1M tokens |

JavaScript/TypeScript의 `number`로 비용을 누적 집계하지 않는다. 비용 집계는 `BigInt`, decimal library, DB decimal, 또는 micro USD 정수로 처리한다. 가격 단가는 per-token float가 아니라 per-1M-token 정수 단위로 보관한다.

## 1.2 가격 catalog 필드

가격 catalog row는 최소 아래 필드를 가진다.

| 필드 | 타입 | 필수 | 설명 |
|---|---|---:|---|
| `pricingRuleId` | string | Y | 가격 rule ID |
| `pricingVersionId` | string | Y | 가격표 버전 ID |
| `provider` | string | Y | `openai`, `anthropic`, `gemini`, `local` 등. enum 고정 금지 |
| `model` | string | Y | Provider model ID. enum 고정 금지 |
| `displayName` | string | N | UI 표시용 이름 |
| `processingMode` | string | Y | `standard`, `batch`, `flex`, `priority`, `data_residency`, `fast_mode`, `tenant_contract` 등 |
| `contextTier` | string | Y | `default`, `under_200k`, `over_200k`, `under_270k`, `long_context` 등 |
| `modality` | string | Y | `text`, `audio`, `image`, `video`, `mixed` 등 |
| `inputUsdPer1MTokens` | decimal string | Y | input token 단가 |
| `outputUsdPer1MTokens` | decimal string | Y | output token 단가 |
| `cachedInputUsdPer1MTokens` | decimal string | N | cached input 단가 |
| `cacheWrite5mUsdPer1MTokens` | decimal string | N | 5분 cache write 단가 |
| `cacheWrite1hUsdPer1MTokens` | decimal string | N | 1시간 cache write 단가 |
| `cacheReadUsdPer1MTokens` | decimal string | N | cache hit/read 단가 |
| `contextCacheStorageUsdPer1MTokensHour` | decimal string | N | context cache storage 단가 |
| `toolUnitPrice` | json | N | web search, code execution 등 token 외 과금 |
| `multiplier` | decimal string | N | data residency, regional, fast mode 등 배율 |
| `currency` | string | Y | 기본값 `USD` |
| `sourceName` | string | Y | 가격 출처명 |
| `sourceCheckedAt` | timestamptz | Y | 가격 확인 시각 |
| `effectiveFrom` | timestamptz | Y | 적용 시작 시각 |
| `effectiveTo` | timestamptz | N | 적용 종료 시각 |
| `isActive` | boolean | Y | 현재 활성 여부 |
| `metadata` | json | N | provider-specific 확장 필드 |

## 1.3 가격 version 규칙

가격표는 append-only에 가깝게 관리한다.

```text
가격 변경 감지
-> 새 pricingVersionId 생성
-> 새 model pricing rows insert
-> active version 교체
-> Gateway/Worker cache refresh
-> 이후 요청부터 새 가격 적용
```

금지:

- 기존 pricing row를 직접 수정해서 과거 계산 기준을 바꾸는 것
- 모델 가격을 코드에 하드코딩하는 것
- 알 수 없는 모델을 0원으로 처리하는 것
- 가격표 source 없이 임의 가격을 넣는 것

---

# 2. 모델별 가격 스냅샷

이 장의 가격은 문서 작성 시점의 **공식 공개 가격 확인용 스냅샷**이다.

운영 계산은 이 표를 직접 읽지 않고 DB의 active price catalog를 사용한다. 가격은 Provider가 수시로 바꿀 수 있으므로, 운영 환경에서는 `sourceCheckedAt`, `pricingVersionId`, `effectiveFrom`, `effectiveTo`로 관리한다.

```text
checkedAt: 2026-06-22
currency: USD
unit: per 1M tokens
scope: public API pricing snapshot
```

공식 출처:

| Provider | Source |
|---|---|
| OpenAI | https://developers.openai.com/api/docs/pricing |
| Anthropic | https://platform.claude.com/docs/en/about-claude/pricing |
| Google Gemini | https://ai.google.dev/gemini-api/docs/pricing |
| Google Gemini Billing | https://ai.google.dev/gemini-api/docs/billing |

## 2.1 OpenAI 가격 스냅샷

MVP의 기본 대상은 text/chat 요청이다. OpenAI 가격표는 같은 모델이라도 Batch, Data Residency, Flex, Priority 등 processing mode에 따라 달라질 수 있으므로 catalog에서 `processingMode`를 반드시 분리한다.

| Provider | Model | Processing mode | Context tier | Input | Cached input | Output | 비고 |
|---|---|---|---|---:|---:|---:|---|
| OpenAI | `gpt-5.5` | `standard` | `<270k` | 5.00 | 0.50 | 30.00 | flagship |
| OpenAI | `gpt-5.4` | `standard` | `<270k` | 2.50 | 0.25 | 15.00 | flagship |
| OpenAI | `gpt-5.4-mini` | `standard` | `<270k` | 0.75 | 0.075 | 4.50 | low-cost routing 후보 |
| OpenAI | `gpt-5.4-nano` | `standard` | `<270k` | 0.20 | 0.02 | 1.25 | ultra low-cost routing 후보 |

OpenAI Batch는 input/output 50% 할인으로 별도 `processingMode=batch` row를 둔다. Data Residency는 별도 premium이 있을 수 있으므로 `processingMode=data_residency` 또는 `multiplier`로 분리한다.

## 2.2 Anthropic Claude 가격 스냅샷

Claude는 prompt caching 가격이 별도 column으로 존재한다. Gateway cache와 Provider-side prompt cache는 다른 개념이므로 로그와 비용 필드를 분리한다.

| Provider | Model | Processing mode | Input | 5m cache write | 1h cache write | Cache read/hit | Output | 비고 |
|---|---|---|---:|---:|---:|---:|---:|---|
| Anthropic | `claude-fable-5` | `standard` | 10.00 | 12.50 | 20.00 | 1.00 | 50.00 | availability 확인 필요 |
| Anthropic | `claude-mythos-5` | `standard` | 10.00 | 12.50 | 20.00 | 1.00 | 50.00 | limited availability |
| Anthropic | `claude-opus-4-8` | `standard` | 5.00 | 6.25 | 10.00 | 0.50 | 25.00 | 고성능 모델 |
| Anthropic | `claude-opus-4-7` | `standard` | 5.00 | 6.25 | 10.00 | 0.50 | 25.00 | 고성능 모델 |
| Anthropic | `claude-opus-4-6` | `standard` | 5.00 | 6.25 | 10.00 | 0.50 | 25.00 | 고성능 모델 |
| Anthropic | `claude-sonnet-4-6` | `standard` | 3.00 | 3.75 | 6.00 | 0.30 | 15.00 | 일반 production 후보 |
| Anthropic | `claude-sonnet-4-5` | `standard` | 3.00 | 3.75 | 6.00 | 0.30 | 15.00 | 일반 production 후보 |
| Anthropic | `claude-haiku-4-5` | `standard` | 1.00 | 1.25 | 2.00 | 0.10 | 5.00 | low-cost routing 후보 |

Anthropic Batch API는 input/output 50% 할인으로 별도 row를 둔다. `inference_geo=us_only` 같은 data residency option은 1.1x multiplier로 별도 row 또는 multiplier로 저장한다. Fast mode는 모델별 input/output 가격이 다르므로 `processingMode=fast_mode`로 분리한다.

## 2.3 Google Gemini 가격 스냅샷

Google Gemini는 모델별로 Free/Paid tier, Standard/Batch/Flex/Priority, modality, context threshold에 따라 가격이 달라질 수 있다. GateLM 운영 계산에는 무료 tier를 사용하지 않고, production 기준의 paid 또는 tenant contract 가격을 사용한다.

| Provider | Model | Processing mode | Context tier | Input | Output | Context cache | Storage | 비고 |
|---|---|---|---|---:|---:|---:|---:|---|
| Gemini | `gemini-3.5-flash` | `standard` | `default` | 1.50 | 9.00 | 0.15 | 1.00 / 1M token-hour | output includes thinking tokens |
| Gemini | `gemini-3.5-flash` | `batch` | `default` | 0.75 | 4.50 | 0.075 | 1.00 / 1M token-hour | batch |
| Gemini | `gemini-3.1-flash-lite` | `standard` | text/image/video | 0.25 | 1.50 | 0.025 | 1.00 / 1M token-hour | audio input/cache 별도 |
| Gemini | `gemini-3.1-pro-preview` | `standard` | `<=200k` | 2.00 | 12.00 | 0.20 | 4.50 / 1M token-hour | preview, prompt <= 200k |
| Gemini | `gemini-3.1-pro-preview` | `standard` | `>200k` | 4.00 | 18.00 | 0.40 | 4.50 / 1M token-hour | preview, prompt > 200k |
| Gemini | `gemini-2.5-pro` | `standard` | `<=200k` | 1.25 | 10.00 | 0.125 | 4.50 / 1M token-hour | output includes thinking tokens |
| Gemini | `gemini-2.5-pro` | `standard` | `>200k` | 2.50 | 15.00 | 0.25 | 4.50 / 1M token-hour | long context |
| Gemini | `gemini-2.5-flash` | `standard` | text/image/video | 0.30 | 2.50 | 0.03 | 1.00 / 1M token-hour | audio input/cache 별도 |
| Gemini | `gemini-2.5-flash-lite` | `standard` | text/image/video | 0.10 | 0.40 | 0.01 | 1.00 / 1M token-hour | low-cost routing 후보 |

Google의 Grounding with Google Search/Maps, image output, audio token, live API, TTS 등은 token price 외 별도 과금이 붙을 수 있다. MVP text-only 범위에서는 제외하지만, catalog에는 `toolUnitPrice`, `modality`, `metadata`로 확장 가능하게 둔다.

---

# 3. 비용 계산 공식

## 3.1 기본 공식

Provider 호출 1회에 대한 비용은 token component별 **분자값**을 먼저 합산한 뒤 마지막에 한 번만 반올림한다. component별로 먼저 반올림한 값을 더하면 작은 요청이 많은 tenant에서 누적 오차가 생긴다.

가격 catalog는 USD per 1M tokens 단위를 사용한다.

```text
pricingUnitTokens = 1_000_000
microUsdPerUsd = 1_000_000
```

각 component의 numerator는 아래처럼 계산한다.

```text
inputCostNumerator = promptTokens * inputPriceMicroUsdPer1MTokens
outputCostNumerator = completionTokens * outputPriceMicroUsdPer1MTokens
cachedInputCostNumerator = cachedInputTokens * cachedInputPriceMicroUsdPer1MTokens
cacheWriteCostNumerator = cacheWriteTokens * cacheWritePriceMicroUsdPer1MTokens
cacheReadCostNumerator = cacheReadTokens * cacheReadPriceMicroUsdPer1MTokens
```

Provider attempt 비용은 아래처럼 계산한다.

```text
providerAttemptCostMicroUsd = roundHalfUp(
  (
    inputCostNumerator
  + outputCostNumerator
  + cachedInputCostNumerator
  + cacheWriteCostNumerator
  + cacheReadCostNumerator
  + contextCacheStorageCostNumerator
  + toolCostMicroUsd * pricingUnitTokens
  + fixedRequestCostMicroUsd * pricingUnitTokens
  ) / pricingUnitTokens
)
```

표시용 component cost가 필요하면 같은 공식으로 component별 값을 계산할 수 있다. 단, ledger와 budget 집계의 source of truth는 component별 반올림값의 합이 아니라 `providerAttemptCostMicroUsd`다.

Request 전체 actual cost는 billable provider attempt 비용의 합이다.

```text
requestActualCostMicroUsd = sum(providerAttemptCostMicroUsd for billable attempts)
```

Retry, fallback이 발생하면 실제로 billable한 Provider attempt 비용을 모두 더한다. 최종 응답이 실패하더라도 Provider가 token을 처리했다면 비용이 발생할 수 있다.

## 3.2 표시용 USD 변환

API와 Dashboard에서 보여주는 USD 값은 `costMicroUsd`에서 변환한다.

```text
costUsd = decimalString(costMicroUsd / 1_000_000)
```

`costUsd`는 표시용이다. 집계, budget, ledger, alert threshold 계산에는 `costMicroUsd`를 사용한다.

## 3.3 Gateway cache hit 비용

Gateway cache hit는 외부 Provider 호출을 하지 않으므로 actual provider cost는 0이다.

```text
actualCostMicroUsd = 0
costSource = "gateway_cache_hit"
savedCostMicroUsd = estimatedProviderCostWithoutGatewayCache
```

`costMicroUsd`와 `savedCostMicroUsd`를 섞지 않는다.

- `costMicroUsd`: 실제 발생 비용
- `savedCostMicroUsd`: Gateway cache로 절감했다고 추정되는 비용

Dashboard의 Total Cost에는 `costMicroUsd`만 포함한다. Cost Saved 지표에는 `savedCostMicroUsd`를 사용한다.

## 3.4 Provider-side cache 비용

Provider-side prompt cache는 Gateway cache와 다르다.

- Gateway cache hit: Provider를 호출하지 않음
- Provider-side cache read/write: Provider를 호출하지만 일부 input이 할인 단가로 청구됨

Provider usage에서 cache token을 제공하면 아래처럼 분리 계산한다.

```text
uncachedInputCostNumerator = uncachedInputTokens * inputPriceMicroUsdPer1MTokens
cacheReadCostNumerator = cacheReadTokens * cacheReadPriceMicroUsdPer1MTokens
cacheWriteCostNumerator = cacheWriteTokens * cacheWritePriceMicroUsdPer1MTokens
outputCostNumerator = completionTokens * outputPriceMicroUsdPer1MTokens
```

Provider가 cache token을 별도로 제공하지 않으면 전체 input을 일반 input 단가로 계산한다.

## 3.5 Batch / Flex / Priority / Region / Fast mode

Processing mode가 바뀌면 가격 rule도 별도 row를 사용한다.

```text
price = findActivePricingRule(
  provider,
  model,
  processingMode,
  contextTier,
  modality,
  tenantContract
)
```

예시:

```text
openai/gpt-5.4-mini/standard/text/default
openai/gpt-5.4-mini/batch/text/default
anthropic/claude-sonnet-4-6/standard/text/default
anthropic/claude-sonnet-4-6/batch/text/default
gemini/gemini-2.5-pro/standard/text/<=200k
gemini/gemini-2.5-pro/standard/text/>200k
```

가격 multiplier를 적용하는 경우에는 원본 가격과 적용된 multiplier를 로그에 남긴다.

```text
baseCostMicroUsd
multiplier
actualCostMicroUsd
pricingRuleId
pricingVersionId
```

## 3.6 Context tier 선택

모델 가격이 context length에 따라 달라지는 경우, Gateway는 Provider 호출 전에 추정 prompt token 수로 tier를 선택하고, 응답 후 실제 usage 기준으로 검증한다.

```text
if promptTokens <= 200_000:
  contextTier = "<=200k"
else:
  contextTier = ">200k"
```

실제 token usage가 예상 tier와 다르면 actual cost는 실제 usage 기준 tier로 재계산한다. 이 경우 `estimatedContextTier`, `actualContextTier`를 metadata에 남긴다.

## 3.7 Blocked request 비용

Provider 호출 전에 정책, Rate Limit, Quota, Budget, Masking 정책으로 차단된 요청은 실제 Provider 비용이 없다.

```text
status = "blocked"
actualCostMicroUsd = 0
estimatedCostMicroUsd = calculatedEstimate or null
costSource = "blocked_before_provider"
```

blocked request도 로그에 남겨야 한다. 그래야 정책 효과와 사용자 경험을 추적할 수 있다.

## 3.8 Streaming 비용

Streaming 요청은 응답이 완료되기 전까지 completion token과 실제 비용이 확정되지 않는다.

```text
stream_start:
  estimatedCostMicroUsd 기록 가능

stream_finish:
  provider usage 수집
  actualCostMicroUsd 계산
  costFinalizedAt 기록

stream_error:
  provider usage가 있으면 actual cost 계산
  provider usage가 없으면 estimated fallback 사용 여부 기록
```

Streaming 중간 chunk마다 비용 ledger를 update하지 않는다. 완료 또는 종료 이벤트 기준으로 확정한다.

---

# 4. 예상 비용과 실제 비용 구분

## 4.1 Estimated cost

Estimated cost는 Provider 호출 전 또는 실제 usage 수집 전의 비용 예측값이다.

사용 목적:

- Budget pre-check
- Quota pre-check
- Routing candidate 비교
- Dashboard 진행 중 요청 표시
- 사용자에게 예상 비용 header 제공

필드:

| 필드 | 설명 |
|---|---|
| `estimatedPromptTokens` | tokenizer 또는 provider token count API로 예측한 prompt token 수 |
| `estimatedCompletionTokens` | `max_tokens`, historical average, policy default 등으로 예측한 completion token 수 |
| `estimatedTotalTokens` | 예상 총 token 수 |
| `estimatedCostMicroUsd` | 예상 비용 |
| `estimatedCostUsd` | 표시용 예상 비용 decimal string |
| `estimateSource` | `tokenizer`, `provider_token_count`, `historical_average`, `max_tokens`, `manual_default` 등 |
| `estimatedPricingRuleId` | 예상 계산에 사용한 pricing rule |
| `estimatedPricingVersionId` | 예상 계산에 사용한 pricing version |
| `estimatedAt` | 예상 계산 시각 |

Estimated cost는 최종 비용 집계에 포함하지 않는다.

## 4.2 Actual cost

Actual cost는 Provider 호출 후 실제 usage를 기반으로 계산한 비용이다.

필드:

| 필드 | 설명 |
|---|---|
| `promptTokens` | Provider 또는 Gateway가 확정한 input token 수 |
| `completionTokens` | Provider 또는 Gateway가 확정한 output token 수 |
| `totalTokens` | 확정 총 token 수 |
| `actualCostMicroUsd` | 실제 발생 비용 |
| `costMicroUsd` | 집계 기준 실제 비용. `actualCostMicroUsd`와 동일 의미로 사용 가능 |
| `actualCostUsd` | 표시용 실제 비용 decimal string |
| `costSource` | 실제 비용 산출 근거 |
| `pricingRuleId` | 실제 계산에 사용한 pricing rule |
| `pricingVersionId` | 실제 계산에 사용한 pricing version |
| `costCalculatedAt` | 비용 계산 시각 |
| `costFinalizedAt` | 비용 확정 시각 |

Actual cost는 Dashboard Total Cost, Usage Ledger, Budget Ledger의 기준이다.

## 4.3 Billed cost

Billed cost는 고객에게 실제 청구할 금액이다.

MVP에서는 billing을 구현하지 않으므로 아래처럼 처리한다.

```text
billedCostMicroUsd = actualCostMicroUsd
billingPolicy = "pass_through"
```

향후 과금 기능을 추가하면 아래 요소가 들어갈 수 있다.

- markup
- discount
- volume discount
- enterprise contract
- reseller margin
- free credit
- committed-use discount
- tax
- invoice currency

Billed cost를 추가하더라도 `actualCostMicroUsd`를 덮어쓰면 안 된다.

## 4.4 Estimated / Actual / Billed 비교

| 구분 | 계산 시점 | 사용처 | 집계 포함 | 수정 가능 여부 |
|---|---|---|---:|---|
| `estimatedCostMicroUsd` | Provider 호출 전 | Budget pre-check, routing, UI 예상 | N | 재계산 가능 |
| `actualCostMicroUsd` | Provider 응답 후 | Dashboard, usage ledger, 장애 추적 | Y | 원칙적으로 immutable |
| `billedCostMicroUsd` | 정산 시점 | Invoice, 고객 과금 | 별도 | billing ledger로 조정 |

---

# 5. 환율 적용 정책

## 5.1 Canonical currency

GateLM의 LLM Provider 비용 계산 기준 통화는 **USD**다.

```text
canonicalCurrency = "USD"
canonicalCostField = "costMicroUsd"
```

Provider가 USD가 아닌 통화로 과금하는 경우에도 Gateway 내부 canonical ledger는 USD 기준으로 정규화한다. 단, Provider별 실제 invoice currency는 metadata 또는 reconciliation table에 따로 보관할 수 있다.

## 5.2 MVP 환율 정책

MVP에서는 환율을 비용 계산과 예산 차단의 필수 요소로 넣지 않는다.

- Cost 계산: USD 기준
- Budget pre-check: USD 기준
- Usage ledger: USD 기준
- Dashboard 기본 표시: USD 기준
- KRW 표시: 선택 기능

KRW 표시가 필요한 경우 아래 공식으로 표시값만 계산한다.

```text
displayCostKrw = costMicroUsd / 1_000_000 * usdKrwRate
```

이 값은 UI 표시용이며 canonical ledger를 바꾸지 않는다.

## 5.3 환율 저장 기준

환율을 저장할 경우 immutable FX rate snapshot을 사용한다.

| 필드 | 설명 |
|---|---|
| `fxRateId` | 환율 row ID |
| `baseCurrency` | 예: `USD` |
| `quoteCurrency` | 예: `KRW` |
| `rate` | 예: `1390.25` |
| `rateDate` | 환율 기준일 |
| `sourceName` | 환율 출처 |
| `fetchedAt` | 수집 시각 |
| `effectiveFrom` | 적용 시작 |
| `effectiveTo` | 적용 종료 |

과거 비용을 오늘 환율로 임의 재계산하지 않는다. 과거 KRW 표시가 필요하면 당시 적용된 `fxRateId`를 기준으로 다시 표시한다.

## 5.4 향후 multi-currency 정산

향후 고객별 정산 통화를 지원하려면 아래 구조를 추가한다.

```text
tenant_billing_profiles.default_currency
billing_periods.fx_rate_snapshot_id
invoice_items.billed_cost_micro_usd
invoice_items.billed_cost_minor_unit
invoice_items.fx_rate_id
```

예산 정책도 USD canonical budget과 display currency budget을 분리해야 한다.

---

# 6. Cost source 기준

`costSource`는 비용이 어떤 근거로 계산되었는지 나타낸다.

| 값 | 의미 | 신뢰도 | 사용처 |
|---|---|---:|---|
| `provider_usage` | Provider 응답 usage 기반 | 높음 | 기본 actual cost |
| `provider_invoice` | Provider invoice/export 기준 | 가장 높음 | reconciliation |
| `gateway_tokenizer` | Gateway tokenizer 계산 | 중간 | estimate 또는 usage 누락 fallback |
| `provider_token_count_api` | Provider token count API 기반 | 중간~높음 | estimate |
| `historical_average` | 과거 평균 기반 | 낮음 | pre-check 보조 |
| `max_tokens_estimate` | max_tokens 상한 기반 | 낮음 | 보수적 pre-check |
| `gateway_cache_hit` | Gateway cache로 Provider 호출 없음 | 높음 | actual 0, saved cost 별도 |
| `blocked_before_provider` | Provider 호출 전 차단 | 높음 | actual 0 |
| `manual_adjustment` | 운영자 정정 | 별도 관리 | correction ledger |
| `unknown` | 산출 근거 없음 | 사용 금지 | 저장 금지 또는 경고 |

`costSource=unknown`으로 request log를 정상 저장하지 않는다. 최소한 `estimated_fallback` 또는 `manual_adjustment`처럼 근거를 명시한다.

---

# 7. Budget / Quota 연동

## 7.1 사전 차단

Gateway는 Provider 호출 전에 estimated cost로 예산 초과 가능성을 확인한다.

```text
remainingBudgetMicroUsd = projectMonthlyBudgetMicroUsd - consumedCostMicroUsd

if estimatedCostMicroUsd > remainingBudgetMicroUsd:
  block request before provider call
```

사전 차단은 과소 예측보다 과대 예측이 낫다. 단, 너무 보수적으로 잡아 정상 요청을 자주 막으면 안 되므로 `estimateSource`와 `estimatedCompletionTokens` 기준을 로그로 남긴다.

## 7.2 실제 비용 반영

Provider 호출 후에는 actual cost를 ledger에 반영한다.

```text
usageLedger += actualCostMicroUsd
budgetLedger += actualCostMicroUsd
```

actual cost가 estimated cost보다 커져 예산을 초과하더라도 이미 완료된 요청을 실패 처리하지 않는다. 대신 아래를 수행한다.

- budget exceeded event 발행
- 이후 요청 pre-check에서 차단
- Dashboard alert 표시

## 7.3 Cache 절감액 반영

Gateway cache hit은 실제 비용 0이므로 budget을 소모하지 않는다.

```text
budgetConsumedMicroUsd += 0
savedCostMicroUsd += estimatedProviderCostWithoutGatewayCache
```

절감액은 Dashboard의 Cost Saved 지표로만 사용하고, 실제 비용 감소분을 과금 또는 ledger에 직접 음수로 넣지 않는다.

---

# 8. 로그와 저장 필드

비용 계산 결과는 request log, provider attempt log, usage ledger에 일관되게 남긴다.

## 8.1 Request log 필드

| 필드 | 필수 | 설명 |
|---|---:|---|
| `requestId` | Y | GateLM request ID |
| `tenantId` | Y | Tenant ID |
| `projectId` | Y | Project ID |
| `provider` | Y | 실제 호출 Provider |
| `model` | Y | 실제 호출 Model |
| `requestedProvider` | N | 요청 또는 정책에서 희망한 Provider |
| `requestedModel` | N | 요청 또는 정책에서 희망한 Model |
| `promptTokens` | Y | 확정 input token |
| `completionTokens` | Y | 확정 output token |
| `totalTokens` | Y | 확정 total token |
| `estimatedCostMicroUsd` | N | 예상 비용 |
| `costMicroUsd` | Y | actual cost 기준 비용 |
| `savedCostMicroUsd` | N | Gateway cache 절감 추정액 |
| `pricingVersionId` | Y | 가격표 버전 |
| `pricingRuleId` | Y | 가격 rule |
| `costSource` | Y | 비용 산출 근거 |
| `currency` | Y | 기본값 `USD` |
| `costCalculatedAt` | Y | 비용 계산 시각 |
| `costFinalizedAt` | N | 비용 확정 시각 |

## 8.2 Provider attempt log 필드

Retry/fallback이 있을 수 있으므로 Provider attempt별 비용도 남긴다.

| 필드 | 설명 |
|---|---|
| `attemptId` | Provider attempt ID |
| `requestId` | GateLM request ID |
| `attemptIndex` | 0부터 시작 |
| `provider` | 호출 Provider |
| `model` | 호출 Model |
| `status` | success/error/timeout/cancelled 등 |
| `promptTokens` | attempt input token |
| `completionTokens` | attempt output token |
| `costMicroUsd` | attempt actual cost |
| `pricingVersionId` | attempt 가격 버전 |
| `pricingRuleId` | attempt 가격 rule |
| `costSource` | attempt 비용 산출 근거 |

최종 request cost는 billable provider attempt 비용의 합이다.

## 8.3 Usage ledger 필드

Usage ledger는 append-only로 관리한다.

| 필드 | 설명 |
|---|---|
| `ledgerEntryId` | ledger row ID |
| `tenantId` | Tenant ID |
| `projectId` | Project ID |
| `applicationId` | Application ID |
| `userId` | User ID |
| `requestId` | Request ID |
| `entryType` | `usage`, `adjustment`, `refund`, `credit` 등 |
| `costMicroUsd` | ledger 반영 비용 |
| `tokenCount` | token 합계 |
| `pricingVersionId` | 가격표 버전 |
| `costSource` | 산출 근거 |
| `createdAt` | 생성 시각 |

비용 정정은 기존 row update가 아니라 `adjustment` row 추가로 처리한다.

---

# 9. 예외 상황 처리

## 9.1 Provider usage가 없는 경우

일부 Provider error, streaming interruption, SDK 오류에서는 usage가 없을 수 있다.

처리 순서:

```text
1. Provider response usage 확인
2. Provider billing/usage API에서 requestId 매칭 가능 여부 확인
3. Gateway tokenizer로 promptTokens 계산
4. completion chunk 누적량으로 completionTokens 추정
5. estimated fallback cost 계산
6. costSource = "gateway_tokenizer" 또는 "estimated_fallback" 기록
```

usage가 없다고 비용을 0으로 처리하지 않는다. 실제 Provider 비용이 발생했을 수 있다.

## 9.2 Unknown model

가격 catalog에 없는 모델이 선택되면 기본 정책은 차단이다.

```text
if no active pricing rule:
  block request
  errorCode = "PRICING_RULE_NOT_FOUND"
```

개발 환경에서는 fallback estimate를 허용할 수 있지만, production에서는 unknown model을 0원으로 처리하지 않는다.

## 9.3 Local model

Local model은 Provider token 비용이 0일 수 있지만, compute 비용이 존재할 수 있다.

MVP에서는 local model을 0으로 둘 수 있으나 아래를 명확히 기록한다.

```text
provider = "local"
costSource = "local_policy"
pricingRuleId = "local-zero-cost-v1"
costMicroUsd = 0
```

향후 GPU 시간, memory, queue time 기반 비용을 추가할 수 있도록 `toolUnitPrice` 또는 `computeCostPolicy` metadata를 둔다.

## 9.4 Enterprise contract

고객사별 계약 가격이 있는 경우 public pricing row를 수정하지 않는다.

```text
public price rule
tenant contract price rule
```

Gateway는 아래 우선순위로 가격을 선택한다.

```text
1. tenant-specific contract price
2. project-specific override
3. active public price
4. block if no price
```

---

# 10. Dashboard 표시 정책

## 10.1 기본 표시

Dashboard 기본 비용 표시는 USD decimal string을 사용한다.

```text
$12.34
$0.001240
```

내부 집계는 항상 `costMicroUsd`로 처리한다.

## 10.2 Estimated 표시

진행 중 요청 또는 pre-check 화면에서는 estimated cost를 표시할 수 있다.

표시 규칙:

- estimated 값에는 `Estimated` badge를 붙인다.
- actual 값과 같은 차트에 섞지 않는다.
- 실제 비용 확정 후에는 actual cost를 기본 표시한다.
- estimated와 actual 차이는 분석용으로 보관할 수 있다.

## 10.3 Cache 절감 표시

Dashboard의 비용 절감 지표는 아래처럼 구분한다.

| 지표 | 계산 |
|---|---|
| Total Cost | `sum(costMicroUsd)` |
| Estimated Cost | `sum(estimatedCostMicroUsd)` 단, 별도 카드 |
| Cost Saved by Gateway Cache | `sum(savedCostMicroUsd)` |
| Provider-side Cache Cost | `sum(cachedCostMicroUsd)` 또는 attempt metadata |
| Cache Hit Rate | cache event 기준 |

---

# 11. API 정책

## 11.1 Request Log API

Request Log API는 비용 필드를 아래처럼 반환한다.

```json
{
  "requestId": "req_01J...",
  "provider": "openai",
  "model": "gpt-5.4-mini",
  "promptTokens": 1200,
  "completionTokens": 420,
  "totalTokens": 1620,
  "estimatedCostUsd": "0.002790",
  "costUsd": "0.002790",
  "costMicroUsd": 2790,
  "savedCostMicroUsd": 0,
  "currency": "USD",
  "pricingVersionId": "pricing_2026_06_22_v1",
  "pricingRuleId": "openai_gpt_5_4_mini_standard_text_v1",
  "costSource": "provider_usage",
  "costCalculatedAt": "2026-06-22T08:00:00.000Z"
}
```

## 11.2 Cost Analytics API

비용 분석 API는 `costMicroUsd`를 기준으로 집계하고, 응답에서 표시용 decimal string을 함께 반환한다.

```json
{
  "totalCostMicroUsd": 12345678,
  "totalCostUsd": "12.345678",
  "currency": "USD"
}
```

## 11.3 Price Catalog API

MVP에서 Price Catalog 관리 API는 필수가 아니다. 추가할 경우 아래 API를 고려한다.

```text
GET  /api/pricing/versions
GET  /api/pricing/versions/:pricingVersionId/rules
POST /api/pricing/versions
POST /api/pricing/versions/:pricingVersionId/publish
```

이 API를 추가하기 전에는 `api-spec.md`와 `db-schema.md`를 먼저 수정한다.

---

# 12. 구현 금지 사항

아래 구현은 금지한다.

- 모델별 가격을 코드 상수로 하드코딩한다.
- Provider/Model을 enum으로 고정한다.
- unknown model 비용을 0으로 처리한다.
- 비용을 JavaScript `number` float로 누적 집계한다.
- estimated cost를 actual cost로 저장한다.
- Gateway cache saved cost를 actual cost에서 음수로 차감한다.
- 과거 request log 비용을 가격표 변경 후 재계산해서 덮어쓴다.
- 환율 변경으로 과거 USD 비용을 수정한다.
- Request Log API에서 raw prompt/raw response를 비용 계산 근거로 노출한다.
- Provider invoice와 Gateway log 불일치를 무시한다.
- 가격 출처와 확인 시각 없이 pricing row를 추가한다.
- 가격표 변경 없이 새로운 모델을 라우팅 정책에 추가한다.

---

# 13. 테스트 기준

비용 계산 테스트는 최소 아래 케이스를 포함한다.

## 13.1 단위 테스트

```text
- input/output token 기본 비용 계산
- cached input 비용 계산
- provider-side cache read/write 비용 계산
- gateway cache hit actual cost 0 처리
- savedCostMicroUsd 계산
- batch/flex/priority pricing rule 선택
- context tier별 pricing rule 선택
- retry/fallback attempt 비용 합산
- blocked request cost 0 처리
- provider usage 누락 시 fallback estimate 처리
- unknown model 차단
- micro USD rounding
- decimal string 변환
```

## 13.2 통합 테스트

```text
- Gateway request -> Provider usage -> request_completed event -> Worker -> ClickHouse
- Budget pre-check에서 estimated cost 사용
- Actual cost가 estimated cost보다 큰 경우 ledger 반영
- Cache hit에서 budget 미소모, saved cost 기록
- Pricing version 변경 후 새 요청만 새 가격 적용
- 과거 로그 비용 불변성 확인
```

## 13.3 회귀 테스트

```text
- 가격표 변경 후 기존 dashboard query가 깨지지 않는다.
- 새 model 추가 시 migration 없이 pricing row 추가만으로 처리된다.
- 새 provider 추가 시 cost calculator core를 수정하지 않는다.
```

---

# 14. AI 구현자 지침

AI가 비용 관련 코드를 작성하거나 수정할 때는 아래 순서를 따른다.

```text
1. 변경하려는 비용 정책이 이 문서에 있는지 확인한다.
2. 없으면 먼저 cost-policy.md 수정안을 제시한다.
3. llm-log-schema.md 필드 영향 여부를 확인한다.
4. db-schema.md pricing/log/ledger table 영향 여부를 확인한다.
5. api-spec.md response field 영향 여부를 확인한다.
6. gateway-flow.md에서 비용 계산 stage 위치를 확인한다.
7. 작은 단위로 구현한다.
8. 테스트를 추가한다.
```

AI는 아래 요청을 받으면 바로 구현하지 말고 먼저 설명해야 한다.

```text
가격표를 코드에 박아줘
일단 gpt만 하드코딩해줘
모델 enum으로 막아줘
unknown model은 0원으로 처리해줘
과거 로그 비용도 최신 가격으로 다시 계산해줘
환율 바뀌면 과거 KRW 비용도 업데이트해줘
estimated cost만 있으면 actual로 저장해줘
```

---

# 15. MVP 체크리스트

MVP 비용 계산은 아래를 만족해야 한다.

```text
[ ] active pricing version을 조회한다.
[ ] 모델 가격을 코드 상수로 하드코딩하지 않는다.
[ ] Provider/Model을 string으로 처리한다.
[ ] input/output token 비용을 계산한다.
[ ] cached input 또는 provider cache 비용 확장 필드를 둔다.
[ ] estimatedCostMicroUsd와 costMicroUsd를 구분한다.
[ ] Gateway cache hit actual cost를 0으로 기록한다.
[ ] savedCostMicroUsd를 별도로 기록한다.
[ ] Budget pre-check는 estimated cost를 사용한다.
[ ] Dashboard Total Cost는 actual cost만 사용한다.
[ ] costMicroUsd는 정수로 저장한다.
[ ] costUsd는 표시용 decimal string으로만 사용한다.
[ ] pricingVersionId와 pricingRuleId를 event/log에 남긴다.
[ ] costSource를 event/log에 남긴다.
[ ] unknown model은 차단한다.
[ ] 가격 변경은 새 pricing version으로 처리한다.
[ ] 과거 로그 비용을 덮어쓰지 않는다.
```

---

# 16. 최종 기준

GateLM의 비용 정책은 아래 문장으로 요약한다.

```text
GateLM은 실제 비용을 USD micro unit으로 정확하게 기록하고,
예상 비용은 차단과 예측에만 사용하며,
가격표는 versioned catalog로 관리하고,
Provider/Model/정산 방식 확장을 막는 하드코딩을 금지한다.
```

---

# 15. PII Masking과 비용 계산

민감정보 정책으로 `maskingAction = blocked`가 된 요청은 외부 Provider를 호출하지 않는다.

비용 기준:

- actual provider cost는 `0`이다.
- estimated pre-check cost가 계산되었더라도 actual cost로 저장하지 않는다.
- Dashboard에서는 block count와 cost saved를 구분한다.
- block으로 인한 절감액은 실제 Provider invoice가 발생하지 않았다는 의미이지, cache savings와 섞지 않는다.
- `api_key`, `authorization_header`, `jwt`, `resident_registration_number` 차단은 비용 최적화가 아니라 보안 정책 적용 결과다.

민감정보 detector/action 기준은 `pii-masking-policy.md`를 따른다.

