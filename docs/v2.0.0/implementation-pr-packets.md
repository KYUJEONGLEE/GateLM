# GateLM v2.0.0 Implementation PR Packets

이 문서는 `docs/v2.0.0/implementation-tasks.md`를 에이전트가 바로 실행할 수 있는 PR 단위 작업 패킷으로 쪼갠다.

공식 계약 우선순위는 항상 아래를 따른다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/implementation-plan.md`
5. `docs/v2.0.0/implementation-tasks.md`

이 문서는 구현 실행 보조 문서다. API, DB, Event, Metrics, Security-sensitive field를 새로 확정하지 않는다.

## Global Stop Conditions

아래 상황이 나오면 구현을 멈추고 계약/계획 PR로 분리한다.

- `contracts.md`에 없는 API route, DB column, Event field, Metrics label이 필요하다.
- raw prompt, raw response, API Key, App Token, Provider Key, Authorization header, provider raw error body, actual secret 저장이 필요해 보인다.
- Provider/Model을 DB enum 또는 code enum으로 고정해야 할 것처럼 보인다.
- Gateway가 editable RuntimeConfig를 직접 소비해야 할 것처럼 보인다.
- RuntimeSnapshot lookup key에 `budgetScopeType/budgetScopeId`를 넣어야 할 것처럼 보인다.
- client-provided budget scope를 신뢰해야 할 것처럼 보인다.
- Observability가 Gateway-produced outcome을 추측해야 한다.
- schema/fixture가 `contracts.md`와 충돌한다.

## PR-0. Environment And Documentation Baseline

Branch:

```text
docs/v2-environment-and-plan-baseline
```

Goal:

- 팀원, CI, 에이전트가 같은 문서/런타임 기준에서 시작한다.

Primary files:

- `.nvmrc`
- `.node-version`
- `package.json`
- `.github/workflows/ci.yml`
- `scripts/verify-v2-docs.mjs`
- `docs/README.md`
- `AGENTS.md`
- `README.md`
- `docs/v2.0.0/implementation-plan.md`
- `docs/v2.0.0/implementation-tasks.md`

Consumes:

- `docs/v2.0.0/contracts.md`
- v2 schema/fixture directory

Produces:

- 문서 진입점
- Node `22` / pnpm `9.15.0` baseline
- v2 document verification script
- CI gate for v2 document verification
- PR 단위 task map

Implementation order:

1. Reading order와 Source Of Truth를 분리한다.
2. Node/pnpm baseline 파일을 확인한다.
3. `scripts/verify-v2-docs.mjs`로 schema/fixture/entry 문서 guardrail을 강제한다.
4. CI가 `main`과 `dev` PR에서 v2 문서 검증을 실행하게 한다.
5. Entry 문서가 v2 source order를 재정의하지 않고 참조하게 한다.
6. `implementation-plan.md`는 상위 계획으로 유지한다.
7. 실제 작업 위치는 `implementation-tasks.md`와 이 문서에 둔다.

Acceptance:

- 모든 entry 문서가 `docs/README.md`를 먼저 읽으라고 말한다.
- 충돌 판단 우선순위는 `contracts -> schemas/fixtures -> plan -> tasks`다.
- Node `22`, pnpm `9.15.0` 기준이 문서와 파일에 모두 있다.
- `corepack pnpm run verify:v2-docs`가 통과한다.
- CI가 `dev` 대상 PR에서도 v2 문서 검증을 실행한다.
- `p0-contract-decisions.md`는 Source Of Truth가 아니라 Reference/Draft다.

Verification:

```powershell
git diff --check
corepack pnpm run verify:v2-docs
node --version
corepack pnpm --version
```

Rollback:

- 문서/환경 기준 파일 커밋만 revert한다.

## PR-1. Gateway Outcome Adoption Gate

Branch:

```text
feat/gateway-outcome-adoption-gate
```

Goal:

- Gateway-produced `terminalStatus + domainOutcomes`를 canonical source로 만든다.

Primary files:

- `apps/gateway-core/internal/domain/request/context.go`
- `apps/gateway-core/internal/pipeline/context.go`
- `apps/gateway-core/internal/domain/invocationlog/terminal_log.go`
- `apps/gateway-core/internal/domain/invocationlog/query_models.go`
- `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`
- `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go`
- `apps/gateway-core/internal/domain/metrics/*`
- `apps/web/src/lib/gateway/live-request-logs.ts`
- `apps/web/src/lib/gateway/live-request-detail.ts`
- `scripts/perf/k6-gateway-baseline.js`

Consumes:

- `contracts.md` section 6, Gateway Outcome Contract
- `docs/v2.0.0/schemas/gateway-stage-outcomes.schema.json`
- `docs/v2.0.0/fixtures/gateway-stage-outcomes.fixture.json`

Produces:

- canonical terminal status mapper
- domain outcome propagation path
- compatibility bridge for legacy status fields

Implementation order:

1. Add or verify a single Gateway-owned outcome mapper.
2. Map exact cache hit to `terminalStatus=success`, `cache.outcome=hit`, `provider.outcome=not_called`.
3. Map invalid API Key/App Token to `terminalStatus=blocked`.
4. Map provider failure without fallback to `terminalStatus=failed`.
5. Keep legacy `status/cacheStatus/maskingAction` as compatibility output only.
6. Make Web/metrics/k6 consume Gateway outcome instead of guessing.

Acceptance:

- `cache_hit`, `error`, `partial_success` are not used as v2 terminal status.
- Provider fallback success can show `provider.outcome=timeout` or `provider.outcome=error` with `fallback.outcome=success`.
- Metrics status labels use only terminal status values.
- No raw prompt/response/credential/header appears in logs, fixtures, or metrics labels.

Verification:

```powershell
go test ./apps/gateway-core/...
git diff --check
```

Rollback:

- Keep legacy compatibility mapper and revert only the new canonical consumption path.

## PR-2A. Actual OpenAI Provider And Mock Fallback

Branch:

```text
feat/provider-adapter-openai-and-mock-fallback
```

Goal:

- Actual Provider 1종 이상과 모델 2개 이상을 Provider Adapter 뒤에 연결하고 Mock fallback을 유지한다.

Primary files:

- `apps/gateway-core/internal/domain/provider/**`
- `apps/gateway-core/internal/adapters/providers/mock/adapter.go`
- `apps/gateway-core/internal/adapters/providers/openai/**`
- `apps/gateway-core/internal/domain/routing/**`
- `apps/gateway-core/internal/config/config.go`
- `apps/control-plane-api/src/modules/provider-connections/**`
- `docs/v2.0.0/schemas/provider-catalog.schema.json`
- `docs/v2.0.0/fixtures/provider-catalog.fixture.json`

Consumes:

- `contracts.md` section 7, Provider, Model, Routing, Fallback
- Provider catalog schema/fixture

Produces:

- OpenAI provider adapter
- catalog-driven provider/model lookup
- Mock fallback path

Implementation order:

1. Keep provider/model as catalog/config data, not enum.
2. Add OpenAI adapter behind Provider Adapter interface.
3. Keep Mock adapter available.
4. Load Provider Catalog body through RuntimeSnapshot `providerCatalogRef`.
5. Verify catalog `catalogId`, `catalogVersion`, and `contentHash` match the RuntimeSnapshot reference before using it.
6. Dispatch by Provider Catalog `adapterType`, not by `providerName`.
7. Use catalog execution config: `baseUrl`, `timeoutMs`, `credentialRef`, and allowlisted `adapterConfig`.
8. Treat `modelId` as GateLM internal identity and `modelName` as the provider API model name.
9. Load credential through server-side reference only.
10. Distinguish success, timeout, error, unauthorized, fallback disabled, fallback success, fallback failed.
11. Sanitize provider raw errors before any response/log/metric.

Acceptance:

- At least two model entries are data-driven.
- Gateway handler does not branch directly on provider name.
- Gateway does not use a Provider Catalog body whose `catalogId/catalogVersion/contentHash` differs from the RuntimeSnapshot `providerCatalogRef`.
- Gateway adapter dispatch uses `adapterType`; `providerName` remains display/catalog data.
- Provider 401/403 maps to `provider.outcome=unauthorized`; pre-call credential resolution failure is sanitized and does not expose credential material.
- Raw provider key and Authorization header never enter DB/log/fixture/UI.
- Fallback success is observable as degraded but successful user outcome.

Verification:

```powershell
go test ./apps/gateway-core/...
git diff --check
```

Rollback:

- Disable Actual Provider adapter by config and keep Mock provider path.

## PR-2B. RuntimeSnapshot Live Thin Slice

Branch:

```text
feat/runtime-snapshot-live-thin-slice
```

Goal:

- Gateway가 editable RuntimeConfig 대신 published RuntimeSnapshot execution view를 소비한다.

Primary files:

- `apps/control-plane-api/src/modules/runtime-configs/**`
- `apps/control-plane-api/prisma/schema.prisma`
- `apps/gateway-core/internal/domain/runtimeconfig/**`
- `apps/gateway-core/internal/pipeline/stages/runtimeconfig/stage.go`
- `apps/gateway-core/internal/adapters/runtimeconfig/**`
- `apps/gateway-core/internal/domain/request/context.go`
- `apps/gateway-core/internal/domain/invocationlog/**`
- `apps/web/src/lib/gateway/live-request-detail.ts`
- `apps/web/src/features/request-logs/components/request-log-detail.tsx`

Consumes:

- `contracts.md` section 5, RuntimeConfig And RuntimeSnapshot
- `docs/v2.0.0/schemas/runtime-snapshot.schema.json`
- `docs/v2.0.0/fixtures/runtime-snapshot.fixture.json`
- `docs/v2.0.0/db-migration-plan.md`

Produces:

- RuntimeSnapshot execution view
- active snapshot lookup by `tenantId/projectId/applicationId`
- runtime provenance in Request Detail

Implementation order:

1. Add RuntimeSnapshot read model without deleting RuntimeConfig.
2. Lookup active snapshot by `tenantId/projectId/applicationId`.
3. Keep `budgetScopeType/budgetScopeId` out of lookup key.
4. Keep RuntimeSnapshot limited to `providerCatalogRef`; do not embed full Provider Catalog body.
5. Add or align Provider Catalog body read model/endpoint for the referenced catalog.
6. Ensure active catalog convenience reads still expose `catalogId/catalogVersion/contentHash` so Gateway can verify them against RuntimeSnapshot `providerCatalogRef`.
7. Map provider display/catalog name and adapter kind separately: `providerName` is not the Gateway adapter dispatch key; `adapterType` is.
8. Include Provider Catalog execution config fields required by Gateway: `baseUrl`, `timeoutMs`, `credentialRef`, allowlisted `adapterConfig`, and model capability/routing fields.
9. Validate required `credentialRef` or provider credential binding before publishing snapshot.
10. Store provenance only, not full snapshot body, in Request Detail/log read model.
11. Implement Gateway load/reload failure behavior with last loaded snapshot when allowed.

Acceptance:

- Gateway never consumes editable RuntimeConfig directly.
- RuntimeSnapshot contains Provider Catalog reference/provenance, not full catalog body.
- Provider Catalog body can be fetched and verified against `providerCatalogRef`.
- Validation failure creates no RuntimeSnapshot.
- Publish failure does not change active pointer.
- Reload failure can continue with last loaded snapshot.
- Request Detail shows actual snapshot provenance.

Verification:

```powershell
pnpm --filter @gatelm/control-plane-api test
go test ./apps/gateway-core/...
git diff --check
```

Rollback:

- Keep RuntimeConfig source records.
- Repoint active snapshot pointer to previous snapshot or disable RuntimeSnapshot live adapter behind config.

## PR-3. Budget, Request-Side Safety, Exact Cache, Routing

Branch:

```text
feat/v2-budget-safety-cache-routing
```

Goal:

- Provider 호출 전에 budget/rate limit, request-side safety, exact cache, routing 순서를 고정한다.

Primary files:

- `apps/gateway-core/internal/domain/budget/**`
- `apps/gateway-core/internal/domain/ratelimit/**`
- `apps/gateway-core/internal/pipeline/stages/ratelimit/**`
- `apps/gateway-core/internal/domain/masking/**`
- `apps/gateway-core/internal/pipeline/stages/masking/**`
- `apps/gateway-core/internal/domain/cache/**`
- `apps/gateway-core/internal/pipeline/stages/cache/**`
- `apps/gateway-core/internal/domain/routing/**`
- `apps/gateway-core/internal/pipeline/stages/routing/**`

Consumes:

- `contracts.md` sections 3, 6, 8
- safety/cache/outcome schema fixtures

Produces:

- pre-provider gate order
- budget/safety/cache/routing domain outcomes

Implementation order:

1. Execute auth/context.
2. Load RuntimeSnapshot.
3. Resolve budget scope and apply budget/rate limit.
4. Run request-side safety.
5. Check Exact Cache.
6. Run routing for provider/model.
7. Call provider/fallback only after all gates pass or cache misses.

Acceptance:

- Budget block prevents provider call.
- Safety block prevents provider call, cache write, and streaming start.
- Exact cache hit bypasses provider.
- `model=auto` records selected provider/model and routing reason.
- Semantic Cache remains evidence-only.

Verification:

```powershell
go test ./apps/gateway-core/...
git diff --check
```

Rollback:

- Disable new budget/safety/cache/routing stage wiring behind config while keeping domain types.

## PR-4. Streaming Thin Slice

Branch:

```text
feat/streaming-thin-slice
```

Goal:

- 응답 체감 속도만 개선하고, token-level logging이나 response-side safety는 core에 넣지 않는다.

Primary files:

- `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`
- `apps/gateway-core/internal/domain/provider/**`
- `apps/gateway-core/internal/domain/invocationlog/**`
- `apps/web/src/app/(chat)/tenants/[tenantId]/chat/page.tsx`
- `apps/web/src/features/customer-demo/components/customer-demo-app.tsx`

Consumes:

- `contracts.md` section 9, Streaming Thin Slice

Produces:

- streaming final status logging
- client abort/cancelled outcome

Acceptance:

- Streaming starts only after budget and request-side safety.
- Token chunks are not logged.
- Client abort maps to `terminalStatus=cancelled`.
- Request Log/Detail records final outcome only.

Verification:

```powershell
go test ./apps/gateway-core/...
pnpm --filter @gatelm/web typecheck
git diff --check
```

Rollback:

- Disable streaming mode and fall back to non-streaming response path.

## PR-5. Observability, Dashboard, Metrics, k6

Branch:

```text
feat/v2-observability-dashboard-k6
```

Goal:

- Request Detail, Dashboard, metrics, k6가 Gateway-produced outcomes를 같은 방식으로 소비한다.

Primary files:

- `apps/gateway-core/internal/domain/invocationlog/**`
- `apps/gateway-core/internal/adapters/invocationlog/postgres/**`
- `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go`
- `apps/gateway-core/internal/domain/metrics/**`
- `apps/web/src/lib/gateway/live-request-logs.ts`
- `apps/web/src/lib/gateway/live-request-detail.ts`
- `apps/web/src/lib/gateway/live-dashboard-overview.ts`
- `apps/web/src/features/dashboard/components/dashboard-overview.tsx`
- `scripts/perf/k6-gateway-baseline.js`

Consumes:

- request-detail schema/fixture
- dashboard-overview schema/fixture
- gateway-stage-outcomes schema/fixture

Produces:

- v2 Request Detail read model
- Dashboard freshness/query budget
- metrics forbidden label guard
- k6 scenario evidence

Acceptance:

- System error rate excludes safety block, budget block, and rate limit.
- Dashboard shows freshness/query budget.
- p95 Gateway internal latency and p95 Provider latency are separated.
- Metrics labels do not include raw IDs, hashes, credential IDs, auth headers, provider keys, or raw error detail.

Verification:

```powershell
go test ./apps/gateway-core/...
pnpm --filter @gatelm/web typecheck
git diff --check
```

Rollback:

- Keep writer compatibility and revert only new read-model fields/UI displays.

## PR-6. Demo Freeze And Evidence

Branch:

```text
feat/v2-demo-evidence
```

Goal:

- 발표가 기능 나열이 아니라 구현된 운영 증거를 보여주게 한다.

Primary files:

- `apps/web/src/features/customer-demo/components/customer-demo-app.tsx`
- `apps/web/src/app/api/customer-demo/chat/route.ts`
- `apps/web/src/app/(chat)/tenants/[tenantId]/chat/page.tsx`
- `scripts/perf/k6-gateway-baseline.js`
- `docs/v2.0.0/demo-scenario.md` if created later

Consumes:

- implemented PR-1 through PR-5 outcomes
- demo scenario decision, if created later

Produces:

- preset demo path
- evidence notes/screenshots/runbook

Acceptance:

- Presets cover safe request, exact cache hit, redaction, safety block, rate limit, provider timeout, provider error plus Mock fallback, streaming thin slice.
- Operator can connect requestId to Request Detail and Dashboard.
- Audience free input is disabled unless sandbox guardrails exist.

Verification:

```powershell
pnpm --filter @gatelm/web typecheck
git diff --check
```

Rollback:

- Hide or disable demo presets without changing Gateway core behavior.
