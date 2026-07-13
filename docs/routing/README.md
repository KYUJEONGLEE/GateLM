# GateLM Active Routing Contract

| Field | Value |
|---|---|
| Status | Active scoped contract |
| Applies to | General Gateway routing, Control Plane routing policy, published RuntimeSnapshot routing |
| Schema version | `gatelm.routing-policy.v2` |
| Active entrypoint | [`../current/README.md`](../current/README.md) |
| Last verified | 2026-07-13 |

이 폴더는 일반 Gateway 라우팅의 현재 기준이다. [`contracts.md`](contracts.md)가 의미 계약이고, `schemas/`와 `fixtures/`는 그 계약의 machine-readable pairing이다.

## Contract Artifacts

| Path | Role |
|---|---|
| [`contracts.md`](contracts.md) | category, difficulty, auto/manual, migration, event/log 경계 |
| [`schemas/routing-policy.schema.json`](schemas/routing-policy.schema.json) | 5 category × 2 difficulty routing policy v2 schema |
| [`fixtures/routing-policy.fixture.json`](fixtures/routing-policy.fixture.json) | 모든 셀이 `mock-balanced`인 안전한 bootstrap fixture |
| [`schemas/runtime-snapshot-routing.schema.json`](schemas/runtime-snapshot-routing.schema.json) | published RuntimeSnapshot routing v2 section schema |
| [`fixtures/runtime-snapshot-routing.fixture.json`](fixtures/runtime-snapshot-routing.fixture.json) | routingPolicyHash를 포함한 RuntimeSnapshot routing bootstrap fixture |

## Authority And Boundaries

이 계약은 일반 Gateway 라우팅 범위에서 `docs/v2.0.0`의 `category -> tier -> model`, legacy `routingPolicy` provider/model 필드, `selectedProvider`/`selectedModel` 의미를 대체한다. `docs/v2.0.0` 원문은 historical baseline으로 보존하며 이 문서로 새 의미를 읽는다.

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
