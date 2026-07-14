# GateLM Active Routing Contract

| Field | Value |
|---|---|
| Status | Active scoped contract |
| Applies to | General Gateway routing, Control Plane routing policy, published RuntimeSnapshot routing |
| Schema version | `gatelm.routing-policy.v2` |
| Active entrypoint | [`../current/README.md`](../current/README.md) |
| Last verified | 2026-07-14 |

이 폴더는 일반 Gateway 라우팅의 현재 기준이다. [`contracts.md`](contracts.md)가 의미 계약이고, [`classification-pipeline.md`](classification-pipeline.md)가 category·difficulty 분류의 active 구현 구조이며, `schemas/`와 `fixtures/`는 정책 계약의 machine-readable pairing이다.

## Contract Artifacts

| Path | Role |
|---|---|
| [`contracts.md`](contracts.md) | category, difficulty, auto/manual, migration, event/log 경계 |
| [`classification-pipeline.md`](classification-pipeline.md) | 공통 feature 추출, category 결과, category-aware difficulty 분류의 canonical 내부 구조 |
| [`difficulty-feature-vector-v1.md`](difficulty-feature-vector-v1.md) | `difficulty-feature-vector.v1`의 42차원 순서, scaling, enum과 zero-fill 계약 |
| [`difficulty-logistic-training.md`](difficulty-logistic-training.md) | 500건 smoke-only pilot, 향후 approved-family split, offline Python 학습과 generated Go artifact의 비활성 준비 경계 |
| [`schemas/routing-policy.schema.json`](schemas/routing-policy.schema.json) | 전역 Simple/Complex/단일 fallback을 5 category × 2 difficulty에 투영하는 routing policy v2 schema |
| [`fixtures/routing-policy.fixture.json`](fixtures/routing-policy.fixture.json) | 모든 셀이 `mock-balanced`인 안전한 bootstrap fixture |
| [`schemas/runtime-snapshot-routing.schema.json`](schemas/runtime-snapshot-routing.schema.json) | published RuntimeSnapshot routing v2 section schema |
| [`fixtures/runtime-snapshot-routing.fixture.json`](fixtures/runtime-snapshot-routing.fixture.json) | routingPolicyHash를 포함한 RuntimeSnapshot routing bootstrap fixture |

## Non-active Proposals

| Path | Status | Scope |
|---|---|---|
| [`difficulty-feature-vector-v2-proposal.md`](difficulty-feature-vector-v2-proposal.md) | Proposed; not active | Exact v1 42D를 보존하고 `instructionText` projection과 4-head/12D probability를 분리해 비교하는 offline/shadow difficulty candidate |
| [`../testing/difficulty-semantic-encoder-selection.md`](../testing/difficulty-semantic-encoder-selection.md) | Provisional offline evidence; not active | Immutable local multilingual encoder, QInt8 runtime variant, `P=64` projection과 재현 가능한 CPU benchmark lock |

이 표의 문서는 active contract가 아니다. 별도 승인과 source-of-truth 승격 전에는 Gateway hot path, routing policy 또는 제품 surface의 근거로 사용할 수 없다.

## Authority And Boundaries

이 계약은 일반 Gateway 라우팅 범위에서 `docs/v2.0.0`의 `category -> tier -> model`, legacy `routingPolicy` provider/model 필드, `selectedProvider`/`selectedModel` 의미를 대체한다. `docs/v2.0.0` 원문은 historical baseline으로 보존하며 이 문서로 새 의미를 읽는다.

현재 authoring profile은 Simple, Complex와 선택 사항인 전역 fallback 하나만 노출한다. 저장·발행 shape는 향후 category별 또는 검증된 ML 기반 routing으로 확장할 수 있도록 완전한 5 × 2 matrix를 유지한다.

다음은 이 계약의 범위 밖이다.

- [`../tenant-chat/README.md`](../tenant-chat/README.md)의 별도 Tenant Chat tier
- Provider Catalog metadata의 `routing.costTier`
- provider adapter 자체의 wire protocol과 credential resolution

## Verification

```powershell
corepack pnpm run verify:routing-contract
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:v2-docs
```
