# GateLM v2.0.0 Implementation Plan

## 1. Goal

This document is the final alignment plan after the P0 legacy cleanup stack.

It is still not a v2 feature implementation plan. Its purpose is to lock what PR-1 through PR-5 cleaned up, what remains deferred, and what must be true before v2 implementation PRs start.

Source of truth order for v2 implementation remains:

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/p0-legacy-field-cleanup.md`
5. `docs/v2.0.0/p0-contract-decisions.md`
6. `docs/README.md`

If implementation pressure conflicts with these documents, stop and create a contract/schema decision PR before changing code.

## 2. Non-Goals

The completed P0 cleanup stack and the next v2 implementation PRs must not smuggle in the following:

- RuntimeSnapshot live reload outside a dedicated RuntimeSnapshot implementation PR
- Actual Provider integration outside a dedicated provider PR
- Streaming outside a dedicated thin-slice PR
- Semantic Cache core response path
- DB table/column physical rename
- raw prompt storage
- raw response storage
- API Key/App Token/Provider Key/Authorization header storage or exposure
- actual secret storage or exposure
- `contracts.md` edits from implementation PRs
- schema/fixture edits without a prior contract decision
- new API route creation outside frozen contracts
- new DB table/column creation outside an explicit migration plan
- Web Console or Employee Chat direct Provider call

Semantic Cache remains an evidence track. DB physical rename remains deferred.

## 3. PR-1 To PR-5 Cleanup Summary

| PR | Status in cleanup stack | Main result | Still not included |
|---|---|---|---|
| PR-1 Outcome bridge cleanup | Completed in stack | Legacy terminal status conflicts were normalized. `cache_hit` and `error` are no longer treated as canonical terminal statuses; exact cache hit is represented as success with cache/provider evidence in existing read paths. | Full new domainOutcomes storage/event model, DB physical rename |
| PR-2 Budget scope propagation cleanup | Completed in stack | Gateway context, Request Log, Request Detail, and Dashboard read paths now carry resolved `budgetScopeType/budgetScopeId/resolvedBy` with `default_application` fallback. | New quota engine, Control Plane budget editor, `department` scope |
| PR-3 RuntimeSnapshot provenance cleanup | Completed in stack | v2-facing provenance uses RuntimeSnapshot primary fields, integer version, actual runtime states only, and `legacyHashes` for v1 hash trio compatibility. `credentialRef` is introduced as v2-facing provider credential reference metadata. | RuntimeSnapshot live reload, DB table split, provider key storage changes |
| PR-4 Verification hardening | Completed in stack | Tests, smoke checks, metrics expectations, and k6 expectations guard the P0 cleanup contracts. Forbidden metrics labels and legacy terminal status regressions are covered. | New production behavior, schema/fixture changes |
| PR-5 Compatibility bridge cleanup | Completed in stack | Remaining compatibility mappers are named/commented as bridges. Legacy `status/cacheStatus/maskingAction`, `secretRef`, hash trio, and runtime state compatibility are not presented as new canonical v2 fields. | Legacy bridge removal, API response shape changes |

These PRs are cleanup only. They do not mean v2 RuntimeSnapshot live, Actual Provider, Streaming, or Dashboard freshness features are implemented.

## 4. Completed P0 Cleanup Items

The following items are aligned enough for v2 feature work to start after the cleanup stack is merged and verified:

- Canonical terminal status values are limited to `success`, `blocked`, `rate_limited`, `failed`, and `cancelled` in v2-facing paths.
- Exact cache hit is not a terminal status. It is represented as successful completion with cache hit and provider not-called evidence.
- Invalid API Key/App Token paths are policy/auth blocks, not generic system errors.
- Metrics and k6 expectations no longer rely on `status=cache_hit` or `status=error`.
- Request Log, Request Detail, Gateway context, and Dashboard read paths carry resolved budget scope.
- Client-provided budget scope is not treated as an authority.
- RuntimeSnapshot provenance is separated from full RuntimeSnapshot body.
- `runtimeSnapshotVersion` is treated as an integer in v2-facing paths.
- Actual RuntimeSnapshot provenance state is limited to `snapshot_active`, `last_known_safe_used`, and `stale_snapshot_used`.
- `no_snapshot` and `not_checked` remain stage outcome/read model concepts, not actual provenance states.
- v1 `configHash/securityPolicyHash/routingPolicyHash` are compatibility `legacyHashes`, not primary provenance.
- Provider credential plaintext is not added to RuntimeSnapshot provenance or Provider Catalog paths.
- `credentialRef` is the v2-facing provider credential reference term; `secretRef` remains compatibility terminology where legacy APIs still expose it.
- Tests guard against forbidden metrics labels such as request/trace IDs, hash labels, credential IDs, authorization labels, provider key labels, and raw error detail labels.
- Compatibility bridges are now explicit in mapper/helper names or short comments.

## 5. Deferred Items

The cleanup stack intentionally does not decide or implement these items:

- Physical rename of `p0_llm_invocation_logs` or its `status` column.
- Full `domainOutcomes` storage/event/API response redesign beyond compatibility mapping.
- `cacheHitRequestId` visibility in Request Detail.
- Admin-only visibility of `apiKeyId` and `appTokenId`.
- Admin UI visibility of `promptHash`, `requestBodyHash`, and `cacheKeyHash`.
- RuntimeConfig/RuntimeSnapshot physical DB table/document/publish model.
- Provider/model Prometheus label cardinality final policy.
- Whether average latency remains a core Dashboard KPI.
- Audience-specific final policy for `detectedTypes` and `redactedPromptPreview`.
- Semantic Cache live response path.
- Employee Chat/browser direct Gateway call security model.
- Streaming final logging granularity.

If one of these becomes necessary, mark it as `contract-change-needed` and update `contracts.md` first. Do not decide it inside an implementation cleanup PR.

## 6. Do Not Re-Decide During V2 Implementation

Implementation PRs must treat the following as already frozen:

- `terminalStatus + domainOutcomes` is the v2 canonical outcome model.
- Legacy `status/cacheStatus/maskingAction` are compatibility/read model bridge fields only.
- Gateway-produced outcomes are the source consumed by Observability. Observability must not infer stage outcomes.
- `teamId` is an organization entity, not a Gateway core identity key.
- Cost, quota, and Dashboard ownership use resolved `budgetScopeType/budgetScopeId`.
- Allowed `budgetScopeType` values are `application`, `project`, and `team`.
- Allowed `resolvedBy` values are `default_application`, `runtime_snapshot`, and `control_plane_rule`.
- RuntimeSnapshot primary provenance is `runtimeSnapshotId/runtimeSnapshotVersion/contentHash/runtimeState/publishedAt/publishedBy/gatewayInstanceId`.
- v1 hash trio stays under `legacyHashes` compatibility.
- RuntimeSnapshot provenance does not carry raw prompt, raw response, credential plaintext, Authorization header, provider raw error body, or actual secret.
- Provider/Model must not be hard-coded as DB or code enums.
- Request-side safety must complete before cache, routing, provider call, and streaming start.
- Semantic Cache is evidence-only for v2.0.0 core.

## 7. V2 Implementation Start Conditions

Start v2 feature implementation only when all of the following are true:

- PR-1 through PR-6 are merged in order into the chosen v2 cleanup base.
- CI or local equivalent tests are green for the touched areas.
- `docs/v2.0.0/contracts.md` remains the accepted contract source.
- Final schema/fixture files match the accepted contracts.
- The implementation PR names the contract section it consumes.
- The implementation PR does not change `contracts.md` unless it is explicitly a contract PR.
- The implementation PR does not add schema/fixture fields before the contract is accepted.
- The implementation PR keeps v1.0.0 baseline behavior working.
- The implementation PR has a verification checklist that includes security exposure search and metrics label guard checks.
- The working tree is clean before push.

## 8. Next Implementation PR Candidates

### PR-A. RuntimeSnapshot live thin slice

- Goal: Gateway consumes a published RuntimeSnapshot execution view instead of editable RuntimeConfig for the hot path.
- Include: active snapshot lookup by `tenantId/projectId/applicationId`, provenance propagation, last-known-safe/stale state handling, compatibility with existing RuntimeConfig source.
- Exclude: physical DB table split unless separately approved, broad policy editor redesign, provider integration.
- Contract dependency: RuntimeConfig/RuntimeSnapshot storage and publish model must stay aligned with `contracts.md`.
- Completion criteria: Gateway logs actual RuntimeSnapshot provenance for a request and never consumes draft config as authority.

### PR-B. Actual Provider 1종 + 모델 2개

- Goal: Add one actual provider adapter with at least two model entries while keeping Mock fallback.
- Include: Provider Adapter boundary, Control Plane catalog/read model compatibility, selected provider/model logging, provider timeout/error handling.
- Exclude: provider-specific logic in Gateway handler, provider/model enums, raw provider error body exposure.
- Contract dependency: provider credential must be referenced through `credentialRef` or equivalent metadata, not plaintext.
- Completion criteria: normal provider success, provider timeout, provider error with Mock fallback, and provider error without fallback are observable with v2 terminal/domain outcomes.

### PR-C. Request-side safety thin slice

- Goal: Make request-side safety a clear pre-provider, pre-cache, pre-streaming gate for v2.
- Include: safety outcome propagation, redaction/block behavior, sanitized summary, cache/provider bypass on block.
- Exclude: response-side safety scan, token-level streaming scan, raw detected value/offset/prompt fragment storage.
- Contract dependency: `safety.outcome` is canonical; `maskingAction/detectedTypes/redactedPromptPreview` remain sanitized display candidates.
- Completion criteria: safety block prevents provider call, cache write, and streaming start.

### PR-D. Dashboard freshness/read model 보강

- Goal: Align Dashboard read model with v2 freshness, query budget, resolved budget scope, p95 latency split, and domain outcome breakdown.
- Include: `lastIngestedAt/lastAggregatedAt/source/isStale`, query budget status, resolved budget scope filter/breakdown, Gateway vs Provider latency separation.
- Exclude: unlimited auto-polling, ClickHouse/Redpanda requirement, Semantic Cache actual-cache metric mixing.
- Contract dependency: query budget states and metrics label safety must follow `contracts.md`.
- Completion criteria: Dashboard can explain freshness, query budget, exact cache, fallback, policy outcomes, and system failures without using forbidden metrics labels.

## 9. Verification Checklist

Every v2 implementation PR must document the checks it ran.

Required for all PRs:

- Relevant unit/integration tests for touched packages.
- `git diff --check`.
- No unrelated file churn.
- No contract/schema/fixture drift unless the PR is explicitly scoped for that.
- Search for forbidden raw/sensitive exposure:
  - raw prompt
  - raw response
  - API Key
  - App Token
  - Provider Key
  - Authorization header
  - actual secret
  - provider raw error body
- Search for forbidden metrics labels:
  - `request_id`
  - `trace_id`
  - `prompt_hash`
  - `request_body_hash`
  - `cache_key_hash`
  - `api_key_id`
  - `app_token_id`
  - `authorization`
  - `provider_key`
  - raw error detail

Additional checks by area:

- Outcome/log PRs: verify exact cache hit is `success + cache.hit + provider.not_called`.
- Budget PRs: verify no `client_provided` budget source is introduced.
- RuntimeSnapshot PRs: verify actual provenance never uses `no_snapshot` or `not_checked`.
- Credential PRs: verify `credentialRef` metadata does not expose credential material.
- Metrics PRs: verify system error rate is separate from safety block, budget block, and rate limited outcomes.
- Dashboard PRs: verify p95 and Gateway/Provider latency split are visible where required.
- Safety PRs: verify raw detected values, raw offsets, and raw prompt fragments are not persisted or displayed.

## 10. Completion Criteria

The P0 cleanup phase is complete when:

- PR-1 through PR-6 are merged in order.
- This plan reflects completed, deferred, and next implementation work.
- Existing legacy status handling no longer conflicts with canonical v2 terminal status.
- Existing Request Log/Detail/Dashboard paths consistently carry resolved budget scope where required.
- Existing RuntimeSnapshot-facing provenance uses integer `runtimeSnapshotVersion`, valid actual runtime states, and `legacyHashes` compatibility.
- Compatibility bridges are explicit and do not look like new canonical contracts.
- Sensitive, raw, and high-cardinality values do not leak into API responses, structured logs, fixtures, metrics labels, or Employee UI.
- Code, migrations, schema/fixture, `contracts.md`, legacy cleanup inventories, and decision documents are not modified by this PR.
- Working tree is clean after push.
