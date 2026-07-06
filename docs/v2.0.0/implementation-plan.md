# GateLM v2.0.0 Implementation Plan

## 1. Purpose

This document is the top-level implementation plan for GateLM v2.0.0.

v2.0.0 extends the v1.0.0 baseline into an organization-based LLMOps Gateway MVP. The goal is one explainable operating flow:

```text
Customer App / Employee Chat
-> Gateway
-> RuntimeSnapshot policy
-> budget / safety / routing / exact cache
-> Actual Provider or Mock fallback
-> Request Log / Detail / Dashboard / Metrics / k6 evidence
```

This file stays intentionally short. Concrete PR-by-PR file work is in `docs/v2.0.0/implementation-tasks.md`.

## 2. Source Of Truth

Read `docs/README.md` first when starting work.

If documents conflict, use this Source Of Truth priority order:

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/implementation-plan.md`
5. `docs/v2.0.0/implementation-tasks.md`

Rules:

- If code pressure conflicts with `contracts.md`, stop and make a contract PR first.
- Feature PRs must not silently define API routes, DB columns, Event fields, Metrics labels, or Security-sensitive fields.
- Provider and Model are catalog/config data, not DB/code enums.
- Gateway handler must not branch directly on provider name.
- Raw prompt, raw response, raw detected value, raw prompt fragment, API Key, App Token, Provider Key, Authorization header, provider raw error body, and actual secrets must not be exposed in DB/log/fixture/API response/metrics label/UI.

Reference / Draft documents:

- `docs/v2.0.0/p0-legacy-field-cleanup.md` is legacy cleanup reference.
- `docs/v2.0.0/p0-contract-decisions.md` is a team review draft, not an official contract.
- Candidate terms in reference/draft documents must not be promoted into API, DB, Event, Metrics, or Schema fields without a contract update.

## 3. P0 Gates Before Feature Code

| Gate | Decision / Baseline | Safe Default |
|---|---|---|
| Environment | Official local/CI/agent baseline | Node `22`, pnpm `9.15.0`, `pnpm install --frozen-lockfile`, TypeScript from lockfile |
| Documentation | README/AGENTS source order | Point to `contracts.md`, schemas/fixtures, this plan, and task plan without redefining contracts |
| Outcome bridge | Canonical request outcome shape | `terminalStatus + domainOutcomes`; legacy `status/cacheStatus/maskingAction` are compatibility only |
| Runtime policy | Editable vs runtime authority | RuntimeConfig is editable; RuntimeSnapshot is immutable published runtime state |
| Runtime provenance | Actual snapshot state | `runtimeSnapshotId/runtimeSnapshotVersion/contentHash/runtimeState/publishedAt/publishedBy/gatewayInstanceId`; no `no_snapshot/not_checked` inside actual provenance |
| Budget scope | Cost/quota/dashboard attribution | Gateway resolves `budgetScopeType/budgetScopeId/resolvedBy`; client-provided scope is not trusted |
| Credential reference | Provider credential boundary | v2 exposes `credentialRef`; `secretRef` stays legacy compatibility |
| Hash visibility | Hash/correlation values | Internal/evidence only by default; never metrics labels, dashboard aggregate labels, or Employee UI |

## 4. Main Path

v2.0.0 is healthy when this flow works end to end:

1. Admin prepares Organization / Project / Application / Provider / API Key / App Token.
2. Admin validates editable RuntimeConfig and publishes immutable RuntimeSnapshot.
3. Customer App or Employee Chat sends a request through Web BFF/server-side boundary.
4. Gateway verifies API Key and App Token.
5. Gateway resolves `tenantId/projectId/applicationId`.
6. Gateway loads RuntimeSnapshot by `tenantId/projectId/applicationId`.
7. Gateway resolves trusted budget scope and applies budget/rate limit.
8. request-side safety runs before routing, exact cache, provider call, and streaming start.
9. Routing/category/provider/model decision runs before Exact Cache key generation and lookup.
10. Routing-aware Exact Cache may bypass provider call.
11. `model=auto` records selected provider/model and routing reason.
12. Actual Provider responds, or Mock fallback responds when policy allows.
13. Streaming thin slice records final outcome without token-level logging.
14. Gateway produces terminal status and domain outcomes.
15. Request Log / Detail / Dashboard / Metrics / k6 consume Gateway-produced outcomes.

## 5. Scope

| Area | v2.0.0 Main Path |
|---|---|
| Control Plane | RuntimeConfig validation/publish, RuntimeSnapshot, Provider/Model catalog, `credentialRef`, budget policy source |
| Gateway | auth/context, RuntimeSnapshot load, budget/rate limit, request-side safety, routing, routing-aware exact cache, provider, fallback, streaming, logging outcomes |
| Product Experience | Admin/Developer/Employee surfaces, Employee Chat through Application boundary, Request Detail, Dashboard, Demo Scenario Runner |
| Safety | request-side safety and sanitized evidence; no response-side safety main path |
| Observability | Gateway-produced outcomes, Request Log/Detail read model, Dashboard aggregation, metrics guardrail, k6 baseline |
| Provider | Actual Provider 1+ and model 2+ via Provider Adapter; Mock fallback remains |

Non-goals for v2.0.0 core:

- raw prompt/raw response storage opt-in
- Semantic Cache live response path
- token-level streaming logging
- response-side safety scan main path
- Employee Chat Provider direct call
- Web Console user request Provider proxy
- `department` budget scope
- provider/model DB enum locking
- ClickHouse/Redpanda mandatory adoption

## 6. Team Ownership

| Owner | Owns | Produces |
|---|---|---|
| 김규민 | Product Experience & Demo | Employee Chat surface, Request Detail UI, Dashboard UX, Demo Scenario Runner, frontend read model fixture |
| 재혁님 | Control Plane & Runtime Policy | RuntimeSnapshot publish path, Provider/Model catalog, `credentialRef`, budget policy source |
| 이지섭 | Gateway Data Plane & Governance | Gateway pipeline, stage outcomes, Provider Adapter boundary, Mock fallback, request context |
| 이윤지 | AI Safety & Evaluation Lab | request-side safety outcome, sanitized detector summary, synthetic corpus, Semantic Cache evidence only |
| 이규정 | Observability, Data Platform & Performance | Request Log/Detail read model, Dashboard aggregate, metrics label guard, k6/query profile |

## 7. Work Plan

### Phase 0. Contract And Environment Freeze

- Confirm `contracts.md`, schemas, fixtures, and this plan point in the same direction.
- Add repo-declared Node/pnpm baseline.
- Confirm demo preset direction.

Done when:

- Every role can start from the same contract and verification baseline.

### Phase 1. Outcome Bridge Adoption

- Verify or complete Gateway-produced `terminalStatus + domainOutcomes`.
- Do not duplicate already completed P0 cleanup work.

Done when:

- Request Log, Request Detail, Dashboard, Metrics, and k6 consume Gateway outcomes without guessing.

### Phase 2A. Actual Provider And Mock Fallback

- Add Actual Provider Adapter with at least two model entries.
- Keep Mock fallback.
- Keep Provider/Model catalog-driven.

Done when:

- provider success/error/timeout/unauthorized and fallback success/failed/disabled are distinguishable.

### Phase 2B. RuntimeSnapshot Live Thin Slice

- Gateway consumes published RuntimeSnapshot instead of editable RuntimeConfig.
- RuntimeSnapshot lookup uses `tenantId/projectId/applicationId`.
- Request Detail can show actual runtime provenance.

Done when:

- reload failure can keep last loaded snapshot when contractually allowed and logs actual provenance.

Phase 2A and Phase 2B may land in either order or in parallel if Provider Adapter and RuntimeSnapshot fixture/catalog contracts are stable.

### Phase 3. Budget, Safety, Routing, Exact Cache

- budget/rate limit, request-side safety, exact cache, and `model=auto` routing execute before provider call in the agreed order.

Done when:

- budget block, safety block, rate limit, exact cache bypass, and routing evidence are observable.

### Phase 4. Streaming Thin Slice

- Streaming starts only after request-side gates.
- Request Log/Detail record final status, not token-level lifecycle.

Done when:

- streaming started/completed/interrupted/cancelled outcomes are visible.

### Phase 5. Observability, Dashboard, Metrics

- Dashboard shows freshness, query budget, resolved budget scope, exact cache, fallback, safety outcome, cost, and p95 Gateway/Provider latency split.
- Metrics guard rejects forbidden labels.

Done when:

- system error rate is separate from safety block, budget block, and rate limit.

### Phase 6. Demo And k6 Evidence

- Preset demo proves implemented behavior.
- k6 separates baseline, cache hit, provider call, safety block, rate limit, fallback, streaming, and mixed demo traffic.

## 8. First Merge Units

| Unit | Branch | Purpose |
|---|---|---|
| 0 | `docs/v2-environment-and-plan-baseline` | Node/pnpm baseline, README/AGENTS pointers, plan/task docs |
| 1 | `feat/gateway-outcome-adoption-gate` | Canonical Gateway outcome producer/mapper and read model consumption |
| 2A | `feat/provider-adapter-openai-and-mock-fallback` | Actual OpenAI Provider Adapter, model catalog entries, Mock fallback |
| 2B | `feat/runtime-snapshot-live-thin-slice` | RuntimeSnapshot execution view, lookup, provenance, reload failure behavior |
| 3 | `feat/v2-budget-safety-cache-routing` | budget/rate limit, request-side safety, routing-aware exact cache order |
| 4 | `feat/streaming-thin-slice` | streaming feel and final status logging |
| 5 | `feat/v2-observability-dashboard-k6` | Request Detail, Dashboard, metrics guard, k6 baseline |
| 6 | `feat/v2-demo-evidence` | Demo Scenario Runner, preset evidence, final presentation proof |

## 9. Verification

Common checks:

- `git diff --check`
- `pnpm install --frozen-lockfile`
- `corepack pnpm run verify:v2-final`
- impacted TypeScript typecheck
- impacted Go tests
- impacted app smoke tests
- schema/fixture drift check
- forbidden sensitive exposure search
- forbidden metrics-label search
- v1 baseline smoke remains green where applicable

Scenario checks:

- Actual Provider success
- provider error with Mock fallback success
- provider error with fallback disabled
- safety block before provider call
- budget block before provider call
- exact cache hit with provider not called
- published RuntimeSnapshot used by Gateway
- reload failure uses last loaded snapshot when allowed
- dashboard aggregate reads bounded grain
- streaming response completes with final request log

## 10. Completion Criteria

v2.0.0 is implementation-complete when:

- v1.0.0 baseline main path remains working.
- Employee Chat uses the Application-boundary Gateway path.
- Gateway never consumes editable RuntimeConfig directly.
- RuntimeSnapshot lookup key is `tenantId/projectId/applicationId`.
- Actual Provider 1+ and model 2+ are connected through Provider Adapter.
- Mock fallback remains.
- Provider/Model are not DB/code enums.
- request-side safety and budget guard stop before provider call.
- Exact Cache hit bypasses provider call.
- Streaming thin slice records final status.
- Gateway produces canonical terminal status and domain outcomes.
- Observability consumes Gateway outcomes without guessing.
- Dashboard shows freshness, query budget, resolved budget scope, cost, and p95 latency split.
- k6 baseline separates the agreed v2 scenarios.
- forbidden sensitive values are absent from DB/log/fixture/API response/metrics label/UI.
