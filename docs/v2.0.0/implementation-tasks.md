# GateLM v2.0.0 Implementation Tasks

This document is the coding task plan for `docs/v2.0.0/implementation-plan.md`.

`contracts.md`, schemas, and fixtures are still the contract source of truth. This file names likely modules and files to touch so each PR can start quickly.

## 0. Global Rules

- Do not change API/DB/Event/Metrics/Security-sensitive contract shape inside a feature PR without a contract PR first.
- Do not store or expose raw prompt, raw response, API Key, App Token, Provider Key, Authorization header, provider raw error body, or actual secret.
- Do not make Provider/Model DB or code enums.
- Do not make optional services mandatory in Gateway hot path unless the contract requires it.
- Keep v1 baseline smoke green where applicable.

## PR-0. Environment And Documentation Baseline

Branch:

```text
docs/v2-environment-and-plan-baseline
```

Purpose:

- Make local, CI, and agent verification reproducible.
- Ensure docs/agent entrypoints point to v2 source of truth.

Likely files:

| Area | Paths |
|---|---|
| root runtime | `.nvmrc`, `.node-version`, `package.json`, `pnpm-lock.yaml` |
| CI | `.github/workflows/ci.yml`, `scripts/verify-v2-docs.mjs` |
| docs | `docs/README.md`, `docs/v2.0.0/implementation-plan.md`, `docs/v2.0.0/implementation-tasks.md` |
| app docs | `apps/control-plane-api/README.md`, app-level README files if present |
| agent docs | `AGENTS.md` or repo agent instruction file if present |

Tasks:

- Keep Node `22` version files in `.nvmrc` and `.node-version`.
- Keep `engines.node: ">=22 <23"` in root `package.json`.
- Keep `packageManager` as `pnpm@9.15.0`.
- Keep `verify:v2-docs` script wired to `scripts/verify-v2-docs.mjs`.
- Run v2 document verification in CI for `main` and `dev`.
- Document official install check: `pnpm install --frozen-lockfile`.
- Update docs so v2 source order is `contracts.md -> schemas/fixtures -> implementation-plan.md -> implementation-tasks.md`.

Verification:

- `git diff --check`
- `corepack pnpm run verify:v2-docs`
- `pnpm install --frozen-lockfile`
- `pnpm --version`
- `node --version`

## PR-1. Gateway Outcome Adoption Gate

Branch:

```text
feat/gateway-outcome-adoption-gate
```

Purpose:

- Make Gateway-produced `terminalStatus + domainOutcomes` the canonical outcome source.
- Keep legacy `status/cacheStatus/maskingAction` compatibility-only.

Likely files:

| Area | Paths |
|---|---|
| Gateway request context | `apps/gateway-core/internal/domain/request/context.go`, `apps/gateway-core/internal/pipeline/context.go` |
| Gateway outcome/log domain | `apps/gateway-core/internal/domain/invocationlog/terminal_log.go`, `apps/gateway-core/internal/domain/invocationlog/query_models.go` |
| Gateway handlers | `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`, `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go`, `apps/gateway-core/internal/http/handlers/errors.go` |
| Gateway metrics | `apps/gateway-core/internal/domain/metrics/recorder.go`, `apps/gateway-core/internal/http/handlers/metrics_handler.go` |
| Gateway persistence | `apps/gateway-core/internal/adapters/invocationlog/postgres/terminal_writer.go`, `apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go` |
| Web read models | `apps/web/src/lib/gateway/live-request-logs.ts`, `apps/web/src/lib/gateway/live-request-detail.ts`, `apps/web/src/features/request-logs/components/request-log-table.tsx`, `apps/web/src/features/request-logs/components/request-log-detail.tsx` |
| Tests | existing `*_test.go` under the same Gateway packages |
| Contracts | `docs/v2.0.0/schemas/gateway-stage-outcomes.schema.json`, `docs/v2.0.0/fixtures/gateway-stage-outcomes.fixture.json` only if contract-approved drift is needed |

Tasks:

- Ensure exact cache hit maps to `success + cache.hit + provider.not_called`.
- Ensure provider fallback success maps to `success + provider.timeout + fallback.success` or `success + provider.error + fallback.success`.
- Ensure auth failure maps to `blocked` with HTTP 401/403 error code.
- Ensure Observability does not infer stage outcomes from legacy status.
- Ensure metrics status labels use canonical terminal status only.

Verification:

- Gateway Go tests for auth failure, cache hit, fallback success, provider failure.
- Metrics forbidden label test.
- Web Request Log/Detail smoke or component-level read model check.

## PR-2A. Actual OpenAI Provider And Mock Fallback

Branch:

```text
feat/provider-adapter-openai-and-mock-fallback
```

Purpose:

- Connect the first real provider path through OpenAI.
- Keep Mock fallback as resiliency/evidence path.

Likely files:

| Area | Paths |
|---|---|
| Gateway provider domain | `apps/gateway-core/internal/domain/provider/types.go`, `apps/gateway-core/internal/domain/provider/registry.go` |
| Gateway provider adapters | `apps/gateway-core/internal/adapters/providers/mock/adapter.go`, new `apps/gateway-core/internal/adapters/providers/openai/*` |
| Gateway routing/provider call | `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`, `apps/gateway-core/internal/domain/routing/*`, `apps/gateway-core/internal/pipeline/*` |
| Gateway config | `apps/gateway-core/internal/config/config.go`, `apps/gateway-core/cmd/gateway/main.go` |
| Control Plane provider catalog | `apps/control-plane-api/src/modules/provider-connections/**`, `apps/control-plane-api/src/modules/runtime-configs/**` |
| Control Plane DB | `apps/control-plane-api/prisma/schema.prisma`, `apps/control-plane-api/prisma/migrations/**`, `db/migrations/004_create_provider_and_models.sql` |
| Env examples | `apps/control-plane-api/.env.example`, Gateway env docs/config if present |
| Docs/schema | `docs/v2.0.0/schemas/provider-catalog.schema.json`, `docs/v2.0.0/fixtures/provider-catalog.fixture.json` |

Tasks:

- Add OpenAI adapter behind Provider Adapter interface.
- Consume Provider Catalog body through RuntimeSnapshot `providerCatalogRef`.
- Verify catalog `catalogId`, `catalogVersion`, and `contentHash` match the RuntimeSnapshot reference before using it.
- Dispatch adapters by `adapterType`, not by `providerName`.
- Use catalog execution config: `baseUrl`, `timeoutMs`, `credentialRef`, and allowlisted `adapterConfig`.
- Use server-side env/secret/credential reference only; never persist plaintext key in DB/log/fixture/UI.
- Support at least two model entries through catalog/config data.
- Treat `modelId` as GateLM internal identity and `modelName` as the provider API model name.
- Keep Mock fallback path available.
- Distinguish provider success, timeout, error, unauthorized, fallback disabled/success/failed.
- Record provider 401/403 as `provider.outcome=unauthorized`; record pre-call credential resolution failure as a sanitized provider failure without a provider call.
- Sanitize provider error body into safe error code.

Verification:

- Unit tests for provider registry and adapter behavior using fake/synthetic client.
- Catalog mismatch test for RuntimeSnapshot `providerCatalogRef` vs Provider Catalog body.
- Handler/pipeline test for provider success and fallback success.
- Search for forbidden key/header/error body exposure.

## PR-2B. RuntimeSnapshot Live Thin Slice

Branch:

```text
feat/runtime-snapshot-live-thin-slice
```

Purpose:

- Make Gateway consume published RuntimeSnapshot execution view instead of editable RuntimeConfig.

Likely files:

| Area | Paths |
|---|---|
| Control Plane runtime config | `apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts`, `.controller.ts`, `.module.ts`, `dto/runtime-config.dto.ts` |
| Control Plane DB | `apps/control-plane-api/prisma/schema.prisma`, `apps/control-plane-api/prisma/migrations/**` |
| Gateway runtime domain | `apps/gateway-core/internal/domain/runtimeconfig/config.go`, `apps/gateway-core/internal/pipeline/stages/runtimeconfig/stage.go` |
| Gateway runtime adapter | `apps/gateway-core/internal/adapters/runtimeconfig/static/provider.go`, possible new RuntimeSnapshot provider adapter |
| Gateway request context | `apps/gateway-core/internal/domain/request/context.go`, `apps/gateway-core/internal/pipeline/context.go` |
| Gateway logs/read model | `apps/gateway-core/internal/domain/invocationlog/*`, `apps/gateway-core/internal/adapters/invocationlog/postgres/*` |
| Web provenance display | `apps/web/src/features/request-logs/components/request-log-detail.tsx`, `apps/web/src/lib/gateway/live-request-detail.ts` |
| Docs/schema | `docs/v2.0.0/schemas/runtime-snapshot.schema.json`, `docs/v2.0.0/fixtures/runtime-snapshot.fixture.json` |

Tasks:

- Add RuntimeSnapshot execution view provider.
- Lookup by `tenantId/projectId/applicationId`.
- Keep `budgetScopeType/budgetScopeId` out of lookup key.
- Keep RuntimeSnapshot body limited to `providerCatalogRef`; do not embed full Provider Catalog body.
- Add or align Provider Catalog body read model/endpoint so Gateway can fetch the catalog referenced by RuntimeSnapshot.
- Ensure active catalog convenience reads still allow Gateway to verify `catalogId/catalogVersion/contentHash` against RuntimeSnapshot `providerCatalogRef`.
- Map provider display name and adapter kind separately: `providerName` remains catalog/display data and `adapterType` is the Gateway adapter kind.
- Include Provider Catalog execution config fields required by Gateway: `baseUrl`, `timeoutMs`, `credentialRef`, allowlisted `adapterConfig`, and model capability/routing fields.
- Record provenance: `runtimeSnapshotId/runtimeSnapshotVersion/contentHash/runtimeState/publishedAt/publishedBy/gatewayInstanceId`.
- Implement load/reload failure behavior with last loaded snapshot when contractually allowed.
- Keep `legacyHashes` as compatibility bridge only.
- Treat missing required `credentialRef` or provider credential binding as a distinct validation failure during RuntimeSnapshot publish validation.

Verification:

- RuntimeSnapshot active path test.
- Missing snapshot failure path test.
- Reload failure / last loaded snapshot test.
- Request Detail provenance read model check.

## PR-3. Budget, Request-Side Safety, Routing, Exact Cache

Branch:

```text
feat/v2-budget-safety-cache-routing
```

Purpose:

- Enforce pre-provider controls in the correct order.

Likely files:

| Area | Paths |
|---|---|
| Budget | `apps/gateway-core/internal/domain/budget/scope.go`, request context/log/read models |
| Rate limit | `apps/gateway-core/internal/domain/ratelimit/types.go`, `apps/gateway-core/internal/pipeline/stages/ratelimit/stage.go`, `apps/gateway-core/internal/adapters/ratelimit/postgres/*` |
| Safety/masking | `apps/gateway-core/internal/domain/masking/*`, `apps/gateway-core/internal/pipeline/stages/masking/stage.go`, `apps/ai-service/app/schemas/safety.py`, `apps/ai-service/app/tests/fixtures/safety_eval/*` |
| Cache | `apps/gateway-core/internal/domain/cache/*`, `apps/gateway-core/internal/pipeline/stages/cache/stage.go`, `apps/gateway-core/internal/adapters/cache/*` |
| Routing | `apps/gateway-core/internal/domain/routing/*`, `apps/gateway-core/internal/pipeline/stages/routing/stage.go` |
| Handler/pipeline | `apps/gateway-core/internal/pipeline/*`, `apps/gateway-core/internal/http/handlers/chat_completions_handler.go` |
| Web | `apps/web/src/features/request-logs/components/request-log-detail.tsx`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx` |
| Docs/schema | `docs/v2.0.0/schemas/safety-domain-outcome.schema.json`, `docs/v2.0.0/fixtures/safety-domain-outcome.fixture.json` |

Tasks:

- Enforce order: auth/context -> RuntimeSnapshot -> budget/rate limit -> safety -> exact cache -> routing -> provider/fallback.
- Budget block returns `terminalStatus=blocked`, `budget.outcome=blocked`, `provider.outcome=not_called`.
- Safety block prevents provider call, cache write, streaming start.
- Exact cache hit bypasses provider and logs provider not called.
- `model=auto` records selectedProvider/selectedModel/routingReason.
- Semantic Cache remains evidence only.

Verification:

- Pipeline order tests.
- Safety block provider-bypass test.
- Budget block provider-bypass test.
- Exact cache hit provider-bypass test.
- Routing decision test.

## PR-4. Streaming Thin Slice

Branch:

```text
feat/streaming-thin-slice
```

Purpose:

- Improve perceived response speed while keeping logging simple and contract-safe.

Likely files:

| Area | Paths |
|---|---|
| Gateway handler | `apps/gateway-core/internal/http/handlers/chat_completions_handler.go` |
| Provider adapter | `apps/gateway-core/internal/domain/provider/types.go`, `apps/gateway-core/internal/adapters/providers/*` |
| Request logging | `apps/gateway-core/internal/domain/invocationlog/*`, `apps/gateway-core/internal/adapters/invocationlog/postgres/*` |
| Web chat | `apps/web/src/app/(chat)/tenants/[tenantId]/chat/page.tsx`, Employee Chat components if split later |
| Demo app | `apps/web/src/features/customer-demo/components/customer-demo-app.tsx`, `apps/web/src/app/api/customer-demo/chat/route.ts` |

Tasks:

- Start streaming only after request-side safety and budget checks.
- Record final status and streaming outcome.
- Handle client abort as `terminalStatus=cancelled`.
- Do not log token chunks.
- Do not add response-side safety scan to core path.

Verification:

- Streaming completed test.
- Client abort/cancelled test.
- Safety block before streaming start test.

## PR-5. Observability, Dashboard, Metrics, k6

Branch:

```text
feat/v2-observability-dashboard-k6
```

Purpose:

- Show v2 request lifecycle in Request Detail, Dashboard, metrics, and k6 evidence.

Likely files:

| Area | Paths |
|---|---|
| Gateway log reader/writer | `apps/gateway-core/internal/domain/invocationlog/query_models.go`, `apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go`, `terminal_writer.go` |
| Gateway handlers | `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go`, `metrics_handler.go` |
| Metrics | `apps/gateway-core/internal/domain/metrics/*` |
| Web Request Log/Detail | `apps/web/src/lib/gateway/live-request-logs.ts`, `apps/web/src/lib/gateway/live-request-detail.ts`, `apps/web/src/features/request-logs/components/*` |
| Web Dashboard | `apps/web/src/lib/gateway/live-dashboard-overview.ts`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx`, `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/page.tsx` |
| k6/perf | `scripts/perf/k6-gateway-baseline.js`, `scripts/dev/v1-k6-baseline.ps1` if retained as compatibility wrapper |
| Docs/schema | `docs/v2.0.0/schemas/request-detail.schema.json`, `docs/v2.0.0/schemas/dashboard-overview.schema.json`, fixtures with same basenames |

Tasks:

- Request Detail shows identity, budget scope, terminal status, domain outcomes, runtime provenance, routing, cache, provider, fallback, streaming, safety, cost/usage/latency.
- Dashboard shows freshness/query budget and bounded grain.
- p95 Gateway internal latency and p95 Provider latency are separated.
- system error rate excludes safety block, budget block, rate limited.
- Metrics labels reject request/trace IDs, hashes, credential IDs, auth headers, provider keys, raw error detail.
- k6 scenarios include baseline success, cache hit, provider call, safety block, rate limit, fallback, streaming, mixed demo traffic.

Verification:

- Request Detail fixture/read model validation.
- Dashboard fixture/read model validation.
- Metrics forbidden label tests.
- k6 baseline smoke.

## PR-6. Demo Freeze And Evidence

Branch:

```text
feat/v2-demo-evidence
```

Purpose:

- Make the presentation prove implemented behavior, not feature narration.

Likely files:

| Area | Paths |
|---|---|
| Demo UI | `apps/web/src/features/customer-demo/components/customer-demo-app.tsx`, `apps/web/src/lib/gateway/customer-demo-client.ts`, `apps/web/src/lib/gateway/customer-demo-live-model.ts` |
| Employee Chat | `apps/web/src/app/(chat)/tenants/[tenantId]/chat/page.tsx` |
| Demo API | `apps/web/src/app/api/customer-demo/chat/route.ts` |
| Dashboard/Request Detail | Web files listed in PR-5 |
| Evidence docs | `docs/v2.0.0/demo-scenario.md` if the team creates it |
| Perf | `scripts/perf/k6-gateway-baseline.js` |

Tasks:

- Presets: safe request, exact cache hit, redaction, safety block, rate limit, provider timeout, provider error + Mock fallback, streaming thin slice.
- Add operator-visible requestId and dashboard update path.
- Keep audience free input out of core demo unless sandbox guardrails are ready.
- Add emergency stop if sandbox mode is enabled.

Verification:

- Manual demo runbook.
- Screenshot or short evidence notes.
- k6 report aligned with demo scenarios.

## Cross-PR Review Checklist

Every PR description should answer:

- Which `contracts.md` section is consumed?
- Which schema/fixture is consumed or changed?
- Does this PR add/change API, DB, Event, Metrics, or Security-sensitive fields?
- Does this PR expose any forbidden sensitive data?
- Which tests/smokes were run?
- Which role consumes this output next?
