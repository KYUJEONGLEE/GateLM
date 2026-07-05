# GateLM LLM 사용 비용 추정 기반 계획

## 1. 문서 상태

이 문서는 고객사가 등록한 Provider API Key로 발생할 수 있는 LLM 사용량 기반 예상 비용을 계산하고, 팀/프로젝트 예산 가드레일로 연결하기 위한 계획서다.

공식 계약 문서가 아니며, 새 API, DB 컬럼, 이벤트 필드, 메트릭 라벨, 스키마 필드를 확정하지 않는다. 아래 내용 중 새 필드나 저장 구조는 모두 후보안으로 본다.

기존 계약과 충돌하면 아래 문서를 우선한다.

1. `specs/gateway/v2.0.0/contracts.md`
2. `specs/gateway/v2.0.0/schemas/*.schema.json`
3. `specs/gateway/v2.0.0/fixtures/*.fixture.json`
4. `docs/releases/v0.1.0.md`
5. archive/draft가 아닌 현재 공개 문서
6. `docs/policies/cost-policy.md`

### 1.1 돈의 흐름과 용어

현재 GateLM의 기본 전제는 고객사가 자기 Provider API Key를 등록하고, Gateway는 그 credential을 `credentialRef`로만 참조해 provider를 호출한다는 것이다. 따라서 이 문서의 비용은 GateLM이 고객에게 청구할 금액도 아니고, GateLM이 provider에 직접 지불하는 원가도 아니다.

이 문서에서 말하는 비용은 아래 의미로 제한한다.

```text
고객사 provider 계정에서 발생할 수 있는 예상 LLM 사용 비용
```

용어 기준:

| 쓰는 표현 | 의미 |
|---|---|
| `estimated provider usage cost` | provider usage token과 가격표로 계산한 예상 사용 비용 |
| `budget usage estimate` | 팀/프로젝트 예산 차단 판단에 쓰는 예상 비용 |
| `provider public list price` | provider 공식 공개 가격표 기준 단가 |
| `tenant contract price` | 고객사와 provider 사이의 별도 계약 단가 후보 |
| `approved estimate` | 공식/계약 가격이 없을 때 관리자가 승인한 임시 추정 단가 |

피해야 할 표현:

| 피하는 표현 | 이유 |
|---|---|
| `billing amount` | GateLM이 고객에게 청구하는 금액으로 오해될 수 있다. |
| `invoice amount` | provider 또는 GateLM 청구서 금액과 다를 수 있다. |
| `actual cost` | 고객사 provider 계정의 실제 청구액과 다를 수 있다. |
| `our provider cost` | provider 비용 주체가 GateLM이 아니라 고객사일 수 있다. |

로그와 대시보드는 반드시 `estimated` 성격을 유지한다. hard block은 실제 청구액 정산이 아니라 고객사가 설정한 팀/프로젝트별 예산 가드레일로 본다.

## 2. 기존 계약 위배 여부 확인

현재 계획은 아래 기존 계약과 맞춰야 한다.

| 영역 | 기존 규칙 | 계획 정합성 |
|---|---|---|
| 프로바이더/모델 | DB enum 또는 코드 enum으로 고정하지 않는다. | 가격 조회는 프로바이더/모델 enum이 아니라 Provider Catalog 데이터와 가격표 행을 기준으로 한다. |
| 런타임 기준 | Gateway는 편집 중인 RuntimeConfig를 직접 소비하지 않고 배포된 RuntimeSnapshot만 소비한다. | Gateway 실행 경로는 RuntimeSnapshot의 `providerCatalogRef`로 검증된 Provider Catalog 실행 뷰를 사용한다. |
| 예산 귀속 | 비용/쿼터/대시보드 귀속은 `budgetScopeType/budgetScopeId/resolvedBy`다. | 예상 provider 사용 비용과 원장 항목은 `tenantId/projectId/applicationId/budgetScopeType/budgetScopeId/resolvedBy`를 함께 사용한다. |
| 민감 정보 | 원본 프롬프트, 원본 응답, 키, 토큰, Authorization 헤더, 프로바이더 원본 오류 본문 저장 금지. | 가격/비용 메타데이터에는 토큰 수, 안전한 모델 식별자, 가격표 버전만 저장한다. |
| 요청 상세 | `usageSummary.예상비용MicroUsd`가 존재한다. | 첫 단계에서는 기존 `cost_micro_usd`를 provider usage 기반 예상 비용 읽기 모델로 일관되게 매핑한다. |
| Provider Catalog | 현재 스키마에는 모델 라우팅 `costTier`만 있고 가격 단가 필드는 없다. | 가격 단가는 Provider Catalog 스키마에 바로 끼워 넣지 않고 별도 가격표 후보로 둔다. |
| DB 마이그레이션 | `p0_llm_invocation_logs` physical rename은 deferred다. | 기존 log table의 `cost_micro_usd`를 유지하고 rename을 하지 않는다. |
| 예산 강제 차단 | 원장/검사 어댑터 계약 전까지 확정된 `blocked`로 위장하지 않는다. | 이번 foundation은 계산/귀속까지만 다루고 hard block은 후속으로 분리한다. |

## 3. 현재 구현 상태 조사

현재 repo에는 비용 기능의 조각이 이미 있다.

| 영역 | 현재 상태 |
|---|---|
| SQL 가격표 테이블 | `db/migrations/004_create_provider_and_models.sql`에 `model_pricing_rules`가 있다. `provider`, `model`, `currency`, `input_micro_usd_per_1m_tokens`, `output_micro_usd_per_1m_tokens`, `pricing_version`, `effective_from`, `effective_to`를 가진다. |
| 요청 로그 테이블 | `db/migrations/006_create_p0_invocation_logs_fallback.sql`에 `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_micro_usd`, `saved_cost_micro_usd`가 있다. |
| 예산 원장 | `db/migrations/010_create_budget_ledger.sql`에 `budget_quotas`, `budget_ledger_entries`가 있다. `budget_ledger_entries`는 request_id 기준으로 비용을 월별 예산 범위에 귀속한다. |
| Gateway 로그 저장기 | `apps/gateway-core/internal/adapters/invocationlog/postgres/terminal_writer.go`가 `cost_micro_usd > 0`일 때 `budget_ledger_entries`에 갱신/삽입한다. |
| Gateway 프로바이더 사용량 | OpenAI-compatible, Anthropic, Mock adapters가 usage token을 `PromptTokens/CompletionTokens/TotalTokens`로 전달하는 흐름이 있다. |
| Provider Catalog 도메인 | `apps/gateway-core/internal/domain/providercatalog/catalog.go`는 provider/model identity, capability, routing hint를 가진다. 가격 단가 필드는 없다. |
| Control Plane RuntimeConfig DTO | `pricingRules`와 `costing` 응답 타입 흔적이 있다. 현재 formula는 per-token micro USD 후보처럼 보인다. |
| Prisma 스키마 | ProviderConnection, RuntimeConfig, RuntimeSnapshot은 있으나 `model_pricing_rules`에 대응하는 Prisma model은 없다. SQL migration path와 Prisma path가 정렬되지 않았다. |
| 비용 정책 | `docs/policies/cost-policy.md`는 versioned price catalog, USD canonical currency, micro USD 정수 계산, 사전 예상값과 provider usage 기반 계산값의 구분 원칙을 이미 제시한다. |

## 4. 현재 문제

지금 부족한 것은 테이블 존재 여부가 아니라, 아래 기준을 하나의 안전한 흐름으로 고정하는 것이다.

- 어떤 프로바이더/모델 가격 행를 적용할지
- 프로바이더 사용량 토큰과 Gateway 사전 추정 토큰을 어떻게 구분할지
- `cost_micro_usd`가 어디에서 계산되어 요청 로그에 들어가는지
- 예산 범위와 비용 귀속이 항상 같은 기준을 쓰는지
- 원장이 계산 결과를 재사용하는지, 별도 추측을 하지 않는지
- pricing 정보가 Provider/Model enum 고정이나 RuntimeConfig draft 직접 소비로 흐르지 않는지

## 5. 제안 구조

### 5.1 가격표 기준

가격표는 별도의 버전 관리 가격표로 둔다.

첫 구현에서는 기존 SQL `model_pricing_rules`를 compatibility source로 사용할 수 있다. 다만 Control Plane/Prisma 쪽과 정합성을 맞추기 전에는 이 테이블을 최종 공식 계약으로 간주하지 않는다.

조회 키 후보:

```text
providerCatalogContentHash
providerId or providerName compatibility key
modelId or provider-facing modelName compatibility key
pricingVersion
effectiveAt
```

가격 행 후보:

| 필드 | 의미 |
|---|---|
| `pricingRuleId` | pricing row id |
| `pricingVersion` | active price catalog version |
| `providerKey` | provider catalog data key, enum 아님 |
| `modelKey` | model catalog data key, enum 아님 |
| `currency` | MVP canonical value: `USD` |
| `inputMicroUsdPer1MTokens` | input token price, integer |
| `outputMicroUsdPer1MTokens` | output token price, integer |
| `effectiveFrom` | 적용 시작 |
| `effectiveTo` | 적용 종료, null이면 활성 후보 |
| `source` | 가격 출처 URL 또는 seed 출처명. official/contract/estimate 구분은 후속 명시 필드 후보로 분리한다. |

### 5.2 비용 계산기

Gateway에 작은 cost calculator domain을 둔다.

입력:

```text
selectedProvider / selectedProviderId
selectedModel / selectedModelId
providerCatalogContentHash
promptTokens
completionTokens
totalTokens
completedAt
pricing rule
```

출력:

```text
costMicroUsd
pricingVersion
pricingRuleId
costSource
tokenCountSource
```

비용 계산식 후보:

```text
costMicroUsd =
  roundHalfUp(
    (
      promptTokens * inputMicroUsdPer1MTokens
    + completionTokens * outputMicroUsdPer1MTokens
    ) / 1_000_000
  )
```

메모:

- 계산은 float가 아니라 int64 기반으로 한다.
- 단가는 per 1M tokens 기준 integer micro USD로 둔다.
- 프로바이더 사용량이 있으면 `tokenCountSource=provider_usage`.
- 프로바이더 사용량이 없으면 첫 PR에서는 `costMicroUsd=0`과 `costSource=unknown`으로 두고, 토크나이저 추정은 후속으로 분리한다.
- 가격표가 없으면 조용히 0원 처리하지 않는다. 첫 구현에서는 provider call은 성공하더라도 `costSource=pricing_missing` 후보 outcome/metadata를 남기는 방향을 검토한다.

### 5.3 요청 로그와 메타데이터

기존 physical columns는 유지한다.

| 기존 컬럼 | 계획 |
|---|---|
| `prompt_tokens` | 프로바이더 사용량의 프롬프트 토큰 |
| `completion_tokens` | 프로바이더 사용량의 응답 토큰 |
| `total_tokens` | 프로바이더 사용량의 전체 토큰 |
| `cost_micro_usd` | Gateway가 계산한 요청별 예상 provider 사용 비용 |
| `saved_cost_micro_usd` | 정확 캐시 절감 비용만 |
| `metadata` | 가격표 버전, 가격 행 ID, 토큰 수 출처, 비용 출처 후보 저장 |

메타데이터 후보:

```json
{
  "costing": {
    "schemaVersion": 1,
    "amountType": "estimated_provider_usage_cost",
    "credentialOwner": "tenant",
    "billableByGateLM": false,
    "pricingVersion": "candidate",
    "pricingRuleId": "candidate",
    "tokenCountSource": "provider_usage",
    "costSource": "pricing_catalog",
    "currency": "USD"
  }
}
```

이 메타데이터에는 원본 프롬프트, 원본 응답, 원본 인증 정보, 프로바이더 원본 오류 본문을 넣지 않는다.

### 5.4 예산 원장

첫 기반 작업에서는 원장 기반 강제 차단을 구현하지 않는다.

다만 요청 로그 저장 후 `cost_micro_usd > 0`일 때 기존 `budget_ledger_entries` 갱신/삽입 흐름을 유지한다. 이 원장은 고객 청구 원장이 아니라 팀/프로젝트 예산 사용량 원장이다.

원장 귀속 키:

```text
tenantId
projectId
applicationId
budgetScopeType
budgetScopeId
monthStart
requestId
```

원장은 요청 로그에 저장된 계산 결과를 재사용해야 한다. 원장이 프로바이더/모델 가격을 다시 추측하면 요청 로그와 예산 대시보드가 어긋난다.

## 6. 단계별 계획

### 1단계. 현재 상태 문서화

목표:

- 현재 비용/가격/토큰/예산/원장 구현 지점을 문서화한다.
- SQL 경로와 Prisma 경로의 차이를 표시한다.

산출물:

- 이 문서 보강 또는 별도 현황 조사 섹션

검증:

- 문서만 변경하므로 `git diff --check`

### 2단계. 가격표 계약 초안

목표:

- 프로바이더/모델별 토큰 가격 후보 계약을 정리한다.
- Provider Catalog 스키마에 바로 넣을지, 별도 Pricing Catalog schema로 둘지 결정한다.

권장 결정:

- 별도 `pricing-catalog` 후보 계약을 둔다.
- Provider Catalog에는 라우팅/기능만 유지하고, 가격 정보는 버전 관리 가격표로 분리한다.

이유:

- 가격은 프로바이더/모델 기능보다 변경 주기가 빠르다.
- 테넌트 계약, 지역, 배치, 캐시 입력 같은 변형이 늘어날 수 있다.
- Provider Catalog 콘텐츠 해시와 가격표 버전을 분리하면 가격 변경이 라우팅/캐시 식별자를 불필요하게 흔들지 않는다.

### 3단계. Gateway 비용 계산기

목표:

- 프로바이더 사용량 토큰과 pricing rule로 `costMicroUsd`를 계산한다.
- 프로바이더/모델 enum 없이 카탈로그 데이터 기반으로 조회한다.

후보 파일:

```text
apps/gateway-core/internal/domain/costing/*
apps/gateway-core/internal/adapters/pricing/*
apps/gateway-core/internal/http/handlers/chat_completions_handler.go
apps/gateway-core/internal/domain/invocationlog/terminal_log.go
```

완료 기준:

- 프롬프트 토큰 2개, 응답 토큰 3개 같은 작은 입력에서도 결정적으로 비용을 계산한다.
- 가격표 누락을 조용한 0원 성공으로 숨기지 않는다.
- 원본 프롬프트/키/헤더를 저장하지 않는다.

### 4단계. 요청 로그 일관성

목표:

- `cost_micro_usd`, `saved_cost_micro_usd`, `metadata.costing`이 일관되게 저장된다.
- Request Detail `usageSummary.예상비용MicroUsd`와 DB column mapping이 일관된다.

후보 파일:

```text
apps/gateway-core/internal/adapters/invocationlog/postgres/terminal_writer.go
apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go
apps/gateway-core/internal/domain/invocationlog/query_models.go
apps/web/src/lib/gateway/live-request-detail.ts
```

완료 기준:

- 프로바이더 성공 요청의 비용이 음수가 아니다.
- 정확 캐시 적중은 provider 호출 비용 추정값 0과 절감 비용을 분리한다.
- 대시보드 집계는 `cost_micro_usd`를 합산한다.

### 5단계. 예산 원장 준비

목표:

- 원장이 요청 로그와 같은 비용/예산 범위 기준을 사용한다.
- 월별 강제 차단을 붙일 수 있도록 quota lookup 경계를 정리한다.

이번 단계 제외 범위:

- 월별 강제 차단
- GateLM 고객 청구서/정산
- GateLM 고객용 과금
- provider 실제 청구서 매칭

## 7. 중단 조건

작업 중 아래 상황이 보이면 구현을 멈추고 계약/설계 PR로 분리한다.

- Provider/Model enum이 필요해 보이는 경우
- RuntimeSnapshot 조회 키에 예산 범위 또는 가격표 버전을 넣어야 할 것처럼 보이는 경우
- Gateway가 RuntimeConfig draft의 pricingRules를 직접 읽어야 할 것처럼 보이는 경우
- 요청 로그에 원본 프롬프트/응답/인증 정보/헤더/프로바이더 원본 오류 본문가 필요해 보이는 경우
- 가격표 누락을 0원 성공으로 처리해야 할 것처럼 보이는 경우
- `cost_micro_usd`와 `budget_ledger_entries.cost_micro_usd`가 서로 다른 계산 경로를 요구하는 경우

## 8. 남은 질문

| 질문 | 현재 권장안 |
|---|---|
| 가격표를 Prisma 출처로도 올릴까? | 필요하다. 지금은 SQL migration에만 `model_pricing_rules`가 있어 Control Plane과 Gateway의 출처가 갈라진다. |
| Provider Catalog 스키마에 가격 필드를 넣을까? | 첫 단계에서는 넣지 않는다. 별도 pricing catalog로 분리하는 편이 가격 변경과 라우팅/캐시 식별자를 덜 흔든다. |
| 사전 예상값과 provider usage 기반 계산값을 분리할까? | 스키마에는 `예상비용MicroUsd`가 있으나 DB 컬럼은 `cost_micro_usd`다. 첫 단계에서는 프로바이더 사용량 기반 계산값을 저장하고, 이름 정리는 계약 PR에서 다룬다. |
| 프로바이더 사용량이 없으면 어떻게 할까? | 첫 구현에서는 알 수 없음으로 남기고 토크나이저 추정은 후속 단계로 분리한다. |
| 강제 차단은 언제 붙일까? | 비용 계산, 요청 로그 일관성, 원장 귀속이 안정화된 뒤 별도 PR로 진행한다. |

## 9. 첫 PR 권장 범위

첫 PR은 작게 가져간다.

포함 범위:

- 이 계획서 추가
- 현재 구현 현황 보강
- 가격표 후보 계약 초안
- 비용 계산기 인터페이스 설계

제외 범위:

- DB migration 추가
- Prisma schema 변경
- Provider Catalog 스키마 변경
- Budget hard block
- 실제 provider 가격 seed 확정
- 대시보드 UI 변경

첫 구현 PR로 넘어갈 때는 `specs/gateway/v2.0.0/contracts.md`와 schema 변경 필요 여부를 다시 확인한다.

## 10. 일반 PR 계획

현재 목표는 프론트를 건드리지 않고 백엔드/데이터 플레인 중심으로 비용책정 흐름을 연결하는 것이다.

대상 프로바이더:

```text
openai
gemini
claude
```

중요 제품 요구사항:

- 프로바이더/모델별 토큰 단가로 예상 provider 사용 비용을 계산한다.
- 계산된 비용은 요청 로그에 남는다.
- 대시보드가 읽을 수 있는 백엔드 읽기 모델/API에는 비용 집계가 있어야 한다.
- 프론트 페이지/컴포넌트는 이 작업에서 수정하지 않는다.
- 프로젝트별, 팀별 비용 조회가 가능해야 한다.
- 예산 한도에 임박하거나 해당 요청으로 초과할 것으로 예상되면 프로바이더 호출 전에 막을 수 있어야 한다.
- 한국어 프롬프트/응답가 99%일 가능성을 고려해 사전 토큰 추정는 보수적으로 잡는다.

### PR-0. 비용책정 현황 조사와 계약 초안

브랜치:

```text
feat/cost-pricing-foundation
```

목적:

- 현재 비용 관련 구현 상태를 문서화한다.
- 기존 계약과 충돌하지 않는 provider/model pricing 후보 계약을 정한다.

예상 수정 파일:

```text
docs/reference/cost-pricing-foundation-plan.md
docs/policies/cost-policy.md 명확화가 필요할 때만
```

완료 기준:

- Provider/Model enum 금지 원칙을 다시 명시한다.
- RuntimeSnapshot 조회 키에 budget/pricing을 넣지 않는다고 명시한다.
- 프론트 제외 범위를 명시한다.
- `git diff --check` 통과.

### PR-1. 가격표 백엔드 출처

목적:

- OpenAI, Gemini, Claude의 토큰 단가를 백엔드가 조회할 수 있는 출처를 만든다.
- 기존 SQL `model_pricing_rules`와 Control Plane/Prisma 경로의 불일치를 줄인다.

권장 방향:

- 기존 SQL `model_pricing_rules`를 버리지 않는다.
- Prisma에도 대응 모델을 추가하거나, Control Plane 시드/런타임 문서가 같은 형태를 만들도록 정렬한다.
- 가격 행는 provider/model enum이 아니라 catalog data로 관리한다.

후보 파일:

```text
apps/control-plane-api/prisma/schema.prisma
apps/control-plane-api/prisma/migrations/*
apps/control-plane-api/prisma/seed.ts
apps/control-plane-api/src/modules/runtime-configs/**
db/migrations/004_create_provider_and_models.sql 호환 마이그레이션이 필요할 때만
docs/reference/cost-pricing-foundation-plan.md
```

가격 행 후보 형태:

```text
providerKey
modelKey
currency = USD
inputMicroUsdPer1MTokens
outputMicroUsdPer1MTokens
pricingVersion
effectiveFrom
effectiveTo
source
```

완료 기준:

- OpenAI/Gemini/Claude 공식 pricing 문서에서 확인한 가격 행을 시드로 넣을 수 있다.
- 알 수 없는 프로바이더/모델을 조용히 0원으로 처리하지 않는다.
- 원본 프로바이더 키나 인증 재료를 저장하지 않는다.
- 프로바이더/모델은 enum이 아니라 텍스트/카탈로그 데이터로 유지한다.
- Control Plane 테스트가 가격 행 검증을 포함한다.

### PR-2. Gateway 비용 계산기와 요청 로그 저장

목적:

- 프로바이더 응답의 사용량 토큰으로 provider usage 기반 예상 사용 비용을 계산한다.
- 계산 결과를 `p0_llm_invocation_logs.cost_micro_usd`와 메타데이터에 저장한다.
- 기존 `budget_ledger_entries` 갱신/삽입 경로가 같은 계산값을 쓰게 한다.

후보 파일:

```text
apps/gateway-core/internal/domain/costing/*
apps/gateway-core/internal/adapters/pricing/*
apps/gateway-core/internal/domain/providercatalog/catalog.go
apps/gateway-core/internal/http/handlers/chat_completions_handler.go
apps/gateway-core/internal/domain/invocationlog/terminal_log.go
apps/gateway-core/internal/adapters/invocationlog/postgres/terminal_writer.go
apps/gateway-core/internal/adapters/invocationlog/postgres/terminal_writer_test.go
```

비용 계산 규칙:

```text
costMicroUsd =
  roundHalfUp(
    (
      promptTokens * inputMicroUsdPer1MTokens
    + completionTokens * outputMicroUsdPer1MTokens
    ) / 1_000_000
  )
```

메타데이터 후보:

```json
{
  "costing": {
    "pricingVersion": "pricing_2026_07_demo",
    "pricingRuleId": "price_openai_gpt_4o_mini_v1",
    "tokenCountSource": "provider_usage",
    "costSource": "pricing_catalog",
    "currency": "USD"
  }
}
```

완료 기준:

- OpenAI 호환 응답 사용량으로 비용이 계산된다.
- Claude 사용량 매핑의 입력/출력 토큰으로 비용이 계산된다.
- Gemini가 OpenAI 호환 경로를 쓰는 경우 프로바이더/모델 카탈로그 데이터 기준으로 계산된다.
- 프로바이더 사용량이 없으면 `costSource=unknown` 후보 메타데이터로 남기고, 유료 요청을 조용한 0원 처리로 위장하지 않는다.
- 요청 로그와 예산 원장의 비용이 같은 값이다.
- 프론트 파일은 수정하지 않는다.

### PR-3. 프로젝트/팀 비용 백엔드 읽기 모델

목적:

- 프론트가 나중에 사용할 수 있도록 백엔드 읽기 모델에서 프로젝트별, 팀별 비용 조회가 가능하게 한다.
- 프론트 페이지/컴포넌트는 수정하지 않는다.

권장 방향:

- 기존 Gateway 로그 조회기/대시보드 쿼리에 프로젝트와 예산 범위 집계를 보강한다.
- 팀 비용은 `budgetScopeType=team` 원장/로그 기준으로 집계한다.
- 프로젝트 비용은 `project_id`와 `budgetScopeType=project` 두 관점을 구분해 문서화한다.

후보 파일:

```text
apps/gateway-core/internal/domain/invocationlog/query_models.go
apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go
apps/gateway-core/internal/http/handlers/invocation_logs_handler.go
apps/gateway-core/internal/http/handlers/*dashboard*
docs/reference/cost-pricing-foundation-plan.md
```

백엔드 응답 후보:

```text
costByProject
costByBudgetScope
costByTeamBudgetScope
costByModel
monthlyCostMicroUsd
```

완료 기준:

- 프로젝트별 비용 합계는 `cost_micro_usd` 기준이다.
- 팀별 비용 합계는 신뢰된 `budgetScopeType=team/budgetScopeId` 기준이다.
- request ID, trace ID, credential ID, raw prompt, raw response는 집계 라벨로 쓰지 않는다.
- 프론트 파일은 수정하지 않는다.

### PR-4. 사전 토큰 추정과 예산 차단

목적:

- 프로바이더 호출 전 예상 토큰/예상 provider 사용 비용으로 예산 초과 여부를 판단한다.
- 초과가 확실하거나 해당 요청으로 한도를 넘는다고 판단되면 프로바이더를 호출하지 않는다.

중요한 주의점:

- 실제 프로바이더 실제 사용량이 사전 추정보다 클 수 있다.
- 그래서 사전 추정은 보수적으로 잡고, 실제 사용 후 원장이 초과 상태가 되면 다음 요청부터 막는다.

한국어 중심 예상 계산:

- 한국어 요청이 99%일 수 있으므로 ASCII 단어 수 기반 추정은 사용하지 않는다.
- 첫 구현에서는 프로바이더별 토크나이저를 완벽히 재현하기보다, 유니코드 문자/rune 길이와 설정된 응답 상한을 사용한 보수적 추정을 둔다.
- 계산식 후보:

```text
예상프롬프트토큰 = ceil(koreanRuneCount * koreanTokenRatio)
예상응답토큰 = min(request.max_tokens, model.maxOutputTokens, configuredBudgetEstimateMaxOutputTokens)
예상비용MicroUsd = pricing(prompt estimate + completion estimate)
safetyMargin = providerSpecificMarginPercent
projectedCost = currentMonthCost + 예상비용MicroUsd * (1 + safetyMargin)
```

기본 안전 마진 후보:

| 프로바이더 | 후보 마진 |
|---|---:|
| OpenAI | 20% |
| Gemini | 25% |
| Claude | 25% |

후보 파일:

```text
apps/gateway-core/internal/domain/costing/*
apps/gateway-core/internal/domain/budget/*
apps/gateway-core/internal/adapters/budget/postgres/*
apps/gateway-core/internal/pipeline/stages/budget/stage.go
apps/gateway-core/internal/http/handlers/chat_completions_handler.go
db/migrations/010_create_budget_ledger.sql 조회용 인덱스가 필요할 때만
```

완료 기준:

- 예산 기능이 꺼져 있으면 차단하지 않고 결과는 `not_used`로 둔다.
- 쿼터 행이 없으면 확정 차단하지 않고, 기존 계약에 맞춰 `not_checked` 또는 안전한 허용 경로로 둔다.
- 예상 비용이 한도보다 낮으면 프로바이더 호출을 진행할 수 있다.
- 예상 비용이 한도를 넘으면 `terminalStatus=blocked`, `provider=not_called`로 끝낸다.
- 경고 임계치를 넘으면 결과는 `warned`로 남기되 프로바이더 호출은 진행할 수 있다.
- 프로바이더 호출 후 provider usage 기반 계산 비용은 요청 로그와 원장을 갱신한다.
- 프론트 파일은 수정하지 않는다.

### PR-5. 월별 예산 차단 강화

목적:

- 월별 누적 비용이 limit을 넘은 이후에는 후속 요청을 막는다.
- PR-4의 사전 추정과 PR-2의 provider usage 기반 계산값 저장을 하나의 운영 흐름으로 검증한다.

후보 파일:

```text
apps/gateway-core/internal/adapters/budget/postgres/checker.go
apps/gateway-core/internal/adapters/budget/postgres/checker_test.go
apps/gateway-core/internal/pipeline/stages/budget/stage_test.go
apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader_test.go
scripts/dev/*cost* or *budget* 증거 스크립트가 필요할 때만
```

완료 기준:

- 현재 월 원장 합계가 한도 이상이면 프로바이더를 호출하지 않는다.
- 현재 합계와 예상 provider 사용 비용의 합이 한도를 넘으면 프로바이더를 호출하지 않는다.
- 현재 합계가 경고 임계치보다 낮으면 허용한다.
- 현재 합계가 경고 임계치를 넘으면 경고 상태로 둔다.
- 정확 캐시 적중으로 비용이 0원인 경로는 예산을 추가 소비하지 않고, 절감 비용은 별도로 남긴다.
- 요청 로그, 원장, 대시보드 읽기 모델이 일관된다.
- 프론트 파일은 수정하지 않는다.

### PR-6. 증거 정리와 릴리즈 안전성

목적:

- OpenAI/Gemini/Claude 카탈로그 데이터, 비용 계산, 예산 차단, 원장/읽기 모델 일관성을 증거로 남긴다.

검증 후보:

```text
go test ./apps/gateway-core/...
pnpm --filter @gatelm/control-plane-api test
corepack pnpm run verify:v2-docs
git diff --check
```

증거 시나리오:

- OpenAI 저비용 모델 예상 사용 비용이 계산된다.
- Gemini 균형형 모델 예상 사용 비용이 계산된다.
- Claude 고품질 모델 예상 사용 비용이 계산된다.
- 프로젝트 월별 비용 집계.
- 팀 예산 범위 비용 집계.
- 경고 임계치 요청.
- 하드 차단 요청.
- Exact Cache hit 비용 0과 절감 비용 분리.

완료 기준:

- 로그/픽스처/리포트에 금지된 민감값이 없다.
- 프론트 변경이 없다.
- 프로바이더/모델 enum 고정이 없다.
- Gateway가 RuntimeConfig 초안을 직접 소비하지 않는다.

## 11. 일반 PR 개수

일반론으로 쪼개면 7개까지 가능하지만, 현재 마감 일정에서는 아래 빠른 3개 PR 계획을 기준으로 한다.

| PR | 주제 | 분리 이유 |
|---|---|---|
| PR-0 | 문서/현황 조사 | 구현 전에 계약 충돌을 줄인다. |
| PR-1 | 가격표 출처 | DB/Control Plane/seed 변경은 독립 검토가 필요하다. |
| PR-2 | Gateway usage 기반 비용 | 프로바이더 사용량 기반 예상 비용 계산과 요청 로그 저장을 먼저 안정화한다. |
| PR-3 | 백엔드 읽기 모델 | 프론트 없이도 대시보드/API용 집계 계약을 준비한다. |
| PR-4 | 사전 예산 차단 | 예상 토큰/비용로 프로바이더 호출 전 차단을 구현한다. |
| PR-5 | 월별 차단 강화 | 초과 이후 후속 요청 차단과 edge case를 굳힌다. |
| PR-6 | 증거 정리 | 세 provider와 예산 흐름을 검증 자료로 묶는다. |

PR-3과 PR-6은 팀 일정에 따라 PR-5에 합칠 수 있지만, 재혁님이 크래프톤 정글 18주차에 발표/협업까지 고려해야 하는 시점이라면 검토 부담을 낮추기 위해 분리하는 편이 안전하다.


## 12. 마감용 빠른 진행 계획

내일 마감 기준에서는 PR-0~PR-6의 7개 PR 분리는 너무 느리다. 실제 진행은 아래 3개 PR로 압축한다.

빠른 진행 규칙:

- 프론트 파일은 수정하지 않는다.
- 프로바이더/모델 enum 고정은 계속 금지한다.
- 원본 프롬프트, 원본 응답, API key, app token, provider key, Authorization 헤더, 프로바이더 원본 오류 본문은 계속 저장 금지다.
- RuntimeSnapshot/Provider Catalog 기준은 유지한다.
- 예산 강제 차단은 완벽한 정산 시스템이 아니라 MVP 보호 장치로 구현한다.

### 빠른 PR-1. 가격표 기준과 Gateway 비용 로그 저장

목적:

- OpenAI/Gemini/Claude 공식 pricing 문서 기준 가격표 snapshot을 만든다.
- 프로바이더 사용량 토큰으로 `cost_micro_usd`를 계산한다.
- 요청 로그와 기존 예산 원장에 같은 cost를 남긴다.

기존 계획에서 합칠 범위:

```text
PR-1 가격표 백엔드 기준
PR-2 Gateway 비용 계산기와 요청 로그 저장
```

후보 파일:

```text
apps/control-plane-api/prisma/seed.ts
apps/control-plane-api/src/modules/runtime-configs/**
apps/gateway-core/internal/domain/costing/*
apps/gateway-core/internal/adapters/pricing/*
apps/gateway-core/internal/http/handlers/chat_completions_handler.go
apps/gateway-core/internal/domain/invocationlog/terminal_log.go
apps/gateway-core/internal/adapters/invocationlog/postgres/terminal_writer.go
```

완료 기준:

- OpenAI 호환 경로, Gemini, Claude 모델 비용 계산 경로가 있다.
- 프로바이더 사용량 토큰 기반으로 요청 로그 `cost_micro_usd`가 0보다 큰 값으로 저장될 수 있다.
- `budget_ledger_entries.cost_micro_usd`는 요청 로그와 같은 값을 쓴다.
- 가격표가 없으면 조용히 유료 요청을 0원으로 숨기지 않는다.
- 프론트 파일은 수정하지 않는다.

### 빠른 PR-2. 백엔드 비용 집계와 예산 차단 MVP

목적:

- 프로젝트/팀 비용 조회를 백엔드 읽기 모델에서 가능하게 한다.
- 월별 현재 예산 사용량과 사전 예상 비용을 보고, 프로바이더 호출 전에 차단할 수 있게 한다.

기존 계획에서 합칠 범위:

```text
PR-3 프로젝트/팀 비용 백엔드 읽기 모델
PR-4 사전 토큰 추정과 예산 차단
PR-5 월별 예산 차단 강화
```

MVP 예상 계산 규칙:

```text
예상프롬프트토큰 = 한국어 문자 수 기반 보수적 토큰 추정
예상응답토큰 = min(request.max_tokens, model.maxOutputTokens, 설정된 상한)
예상비용MicroUsd = 프로바이더별 안전 마진을 적용한 비용 추정
예상월간비용 = 현재월원장비용 + 예상비용MicroUsd
```

기본 안전 마진 후보:

| 프로바이더 | 마진 |
|---|---:|
| OpenAI | 20% |
| Gemini | 25% |
| Claude | 25% |

후보 파일:

```text
apps/gateway-core/internal/domain/costing/*
apps/gateway-core/internal/domain/budget/*
apps/gateway-core/internal/adapters/budget/postgres/*
apps/gateway-core/internal/pipeline/stages/budget/stage.go
apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go
apps/gateway-core/internal/domain/invocationlog/query_models.go
apps/gateway-core/internal/http/handlers/*dashboard*
```

완료 기준:

- 프로젝트별 월간 비용 합계를 백엔드에서 조회할 수 있다.
- 팀별 월간 비용 합계는 신뢰된 `budgetScopeType=team` 기준으로 조회할 수 있다.
- 경고 임계치에 도달하면 `budget.outcome=warned` 후보 흐름으로 남긴다.
- 예상 월간 비용이 한도를 넘으면 프로바이더를 호출하지 않고 `terminalStatus=blocked`로 끝낸다.
- 이미 월간 원장이 한도 이상이면 다음 요청부터 차단한다.
- Exact Cache hit의 비용 0원 경로는 추가 예산을 소비하지 않는다.
- 프론트 파일은 수정하지 않는다.

### 빠른 PR-3. 증거 정리와 마감용 정리

목적:

- 내일 발표/마감에 필요한 증거를 한 번에 모은다.
- 과한 완성도보다 OpenAI/Gemini/Claude 비용계산과 예산 차단의 흐름을 보여준다.

기존 계획에서 합칠 범위:

```text
PR-6 증거 정리와 릴리즈 안전성
PR-0 문서의 작은 정리
```

증거 시나리오:

- OpenAI 요청: 토큰 사용량 -> 비용 -> 요청 로그 -> 원장.
- Gemini 요청: 토큰 사용량 -> 비용 -> 요청 로그 -> 원장.
- Claude 요청: 토큰 사용량 -> 비용 -> 요청 로그 -> 원장.
- 프로젝트 월별 비용 집계.
- 팀 예산 범위 비용 집계.
- 경고 임계치 요청.
- 하드 차단 요청.
- Exact Cache hit 비용 0과 절감 비용 분리.

완료 기준:

- `git diff --check` 통과.
- 영향받은 Gateway Go 테스트 통과.
- Control Plane을 건드렸다면 영향받은 테스트 통과.
- 프론트 파일 변경 없음.
- 문서/테스트/증거 자료에 금지된 민감값 없음.

## 13. 마감용 권장 순서

마감이 내일이라면 아래 순서로 간다.

| 순서 | PR | 목표 |
|---:|---|---|
| 1 | 빠른 PR-1 | 비용이 실제로 계산되고 로그/원장에 남는 최소 흐름 |
| 2 | 빠른 PR-2 | 프로젝트/팀 조회와 예산 사전 차단 MVP |
| 3 | 빠른 PR-3 | 세 프로바이더 증거와 마감용 정리 |

가능하면 빠른 PR-1과 빠른 PR-2는 같은 날 연속으로 구현하되, PR은 분리한다. 문제가 생기면 빠른 PR-1만이라도 머지 가능한 상태로 남기는 것이 최우선이다.
## 14. 빠른 PR-1 실제 구현 범위

이번 빠른 PR-1은 문서상 `가격표 출처`와 `Gateway 비용 계산기/요청 로그 저장`을 한 번에 묶는다.

포함한 내용:

1. Gateway에 `costing` 도메인 계산기를 추가한다.
2. 기존 SQL `model_pricing_rules`를 읽는 Postgres pricing reader를 추가한다.
3. 프로바이더 응답 usage token을 기준으로 `cost_micro_usd`를 계산한다.
4. 계산 결과를 요청 로그의 `cost_micro_usd`와 `metadata.costing`에 남긴다.
5. 기존 terminal writer가 `cost_micro_usd > 0`일 때 원장에 쓰는 흐름을 그대로 사용한다.
6. OpenAI/Gemini/Claude 공식 pricing 문서에서 확인한 가격 rows를 `model_pricing_rules` seed에 추가한다. Claude는 현재 코드/문서의 provider key 후보를 맞추기 위해 `claude`, `anthropic`, `claude-main` 별칭을 함께 둔다.

의도적으로 제외한 내용:

1. 프론트 파일 수정.
2. Budget hard block.
3. Control Plane/Prisma 가격 관리 화면 또는 API 확정.
4. 가격 자동 동기화. 현재 seed는 공식 문서를 2026-07-05에 확인한 snapshot이며, provider 가격 변경 자동 추적은 후속 작업이다.
5. provider/model enum 고정.
6. raw prompt, raw response, API key, app token, provider key, Authorization header 저장.

이번 PR 이후 빠른 PR-2에서 이어갈 내용:

1. 프로젝트별/팀별 비용 조회용 백엔드 집계.
2. 현재 월 원장 합계 조회.
3. 한국어 입력을 보수적으로 잡는 사전 토큰 추정.
4. 예상 비용 + 현재 월 비용 기준 예산 초과 전 차단.

## 15. 공식 가격 seed 기준

빠른 PR-1의 가격 seed는 임의 demo 값이 아니라, 2026-07-05에 각 provider 공식 pricing 문서를 확인한 snapshot으로 둔다. 자동 동기화가 아니므로 가격 변경 시 새 `pricingVersion`과 `effectiveFrom`으로 갱신해야 한다.

이 seed 값은 고객사 provider 계정의 실제 청구 금액이 아니다. 기본 의미는 provider 공개 가격표 기반의 예상 사용 비용이며, 고객사가 provider와 별도 계약 단가를 가진 경우 실제 청구 금액과 달라질 수 있다.

공식 출처:

| Provider | 공식 문서 | seed 기준 |
|---|---|---|
| OpenAI | https://developers.openai.com/api/docs/pricing | `gpt-5.4-mini`, `gpt-5.4` Standard short context 가격 |
| Gemini | https://ai.google.dev/gemini-api/docs/pricing | `gemini-2.5-flash`, `gemini-2.5-pro` Standard text/short context 가격 |
| Claude | https://platform.claude.com/docs/en/about-claude/pricing | `claude-haiku-4-5`, `claude-sonnet-4-6` Claude API 가격 |

현재 seed 버전:

```text
pricingVersion = official-pricing-2026-07-05-v1
effectiveFrom = 2026-07-05 00:00:00+00
source = provider 공식 pricing 문서 URL
```

의도적으로 뺀 것:

1. 현재 공식 pricing 표에서 바로 검증하지 못한 구버전 모델 가격.
2. OpenAI/Gemini/Claude 외 provider 가격.
3. 무료 티어, 배치, flex, priority, cache hit/write, regional premium, audio/image 전용 가격.
4. 가격 자동 수집/동기화.
5. 고객사별 provider 계약 단가.
6. GateLM 고객 청구/정산 금액.

후속 가격 신뢰도 후보:

```text
sourceType = official | tenant_contract | approved_estimate | estimate | demo
pricingBasis = public_list_price | tenant_contract_price | manual_estimate | demo_seed
credentialOwner = tenant | gatelm
billableByGateLM = false
```

MVP에서는 공식 공개 가격을 우선 사용한다. 공식 가격을 찾지 못했지만 운영상 계산이 필요한 모델은 `approved_estimate`처럼 명시적으로 승인된 추정 단가로만 예산 차단에 사용한다. 단순 추정값은 대시보드 참고용으로만 쓰고 hard block 근거로 사용하지 않는다.
