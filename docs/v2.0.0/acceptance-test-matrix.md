# GateLM v2.0.0 Acceptance Test Matrix

이 문서는 v2 구현 PR의 완료 조건을 테스트 가능한 문장으로 고정한다.

공식 계약은 `docs/v2.0.0/contracts.md`가 우선이다. 이 문서는 테스트/리뷰 보조 문서이며 새 API, DB, Event, Metrics field를 확정하지 않는다.

## Global Checks

모든 PR은 가능한 범위에서 아래를 확인한다.

| Check | Command / Evidence | Required result |
|---|---|---|
| whitespace | `git diff --check` | no errors |
| sensitive exposure | `rg "raw prompt|raw response|Authorization|Provider Key|App Token|API Key" changed files` | no new forbidden storage/exposure |
| source priority | docs review | `contracts.md` remains highest authority |
| provider/model enum | code review | provider/model are catalog/config data |
| schema drift | schema/fixture validation script when available | fixture still matches schema |

## PR-0. Environment And Documentation Baseline

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| Reading order | Open `AGENTS.md`, `README.md`, `docs/README.md`, `implementation-plan.md` | Each says read `docs/README.md` first and use Source Of Truth for conflicts | doc diff |
| Source priority | Same files | Source priority is `contracts -> schemas/fixtures -> implementation-plan -> implementation-tasks` | doc diff |
| Node version file | repo root | `.nvmrc` and `.node-version` contain `22` | file content |
| pnpm baseline | `package.json` | `packageManager` is `pnpm@9.15.0` | file content |
| engine baseline | `package.json` | `engines.node` is `>=22 <23` | file content |

## PR-1. Gateway Outcome Adoption Gate

| Scenario | Input / Setup | Expected terminalStatus | Expected domain outcomes | Evidence |
|---|---|---|---|---|
| provider success | valid auth, cache miss, provider success | `success` | provider=`success`, fallback=`not_used` or equivalent non-executed value | Gateway test |
| exact cache hit | valid auth, exact cache hit | `success` | cache=`hit`, provider=`not_called` | Gateway test |
| provider timeout fallback success | provider timeout, fallback enabled | `success` | provider=`timeout`, fallback=`success` | Gateway test |
| provider error fallback success | provider error, fallback enabled | `success` | provider=`error`, fallback=`success` | Gateway test |
| fallback disabled | provider error, fallback disabled | `failed` | provider=`error`, fallback=`disabled` | Gateway test |
| invalid API key | invalid Gateway API key | `blocked` | auth failure with HTTP 401/403 safe error code | Gateway test |
| rate limited | request exceeds rate limit | `rate_limited` | rateLimit=`limited`, provider=`not_called` | Gateway test |
| safety block | request-side safety blocks | `blocked` | safety=`blocked`, provider=`not_called` | Gateway test |

Reject:

- `terminalStatus=cache_hit`
- `terminalStatus=error`
- `terminalStatus=partial_success`
- Observability-derived stage guesses

## PR-2A. Actual OpenAI Provider And Mock Fallback

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| OpenAI success | configured `credentialRef`, provider reachable | provider adapter returns safe response metadata and usage | adapter/handler test |
| model catalog | at least two models configured as data | model list is not enum-locked | unit test or fixture |
| timeout | synthetic timeout | provider outcome is `timeout`; fallback path evaluated | handler test |
| unauthorized | invalid provider credentialRef resolution | provider outcome is `unauthorized` or safe failure outcome; raw provider body absent | adapter test |
| mock fallback | provider error with fallback enabled | terminal status remains `success`; fallback success visible | handler test |
| fallback disabled | provider error with fallback disabled | terminal status `failed`; fallback disabled visible | handler test |

Reject:

- raw provider key in DB/log/fixture/UI
- raw provider error body in API/log/metric
- direct provider-name branching in Gateway handler
- provider/model DB enum

## PR-2B. RuntimeSnapshot Live Thin Slice

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| publish valid config | valid editable RuntimeConfig | immutable RuntimeSnapshot created with monotonic integer version | Control Plane test |
| missing credentialRef | provider policy requires credential binding but `credentialRef` is absent | distinct validation failure; no RuntimeSnapshot created | Control Plane test |
| publish failure | persistence/pointer update failure | active pointer remains previous snapshot | Control Plane test |
| Gateway load | active snapshot exists for `tenantId/projectId/applicationId` | Gateway uses published RuntimeSnapshot | Gateway test |
| lookup key | budget scope override exists | lookup still uses `tenantId/projectId/applicationId`, not budget scope | Gateway test |
| reload failure | snapshot reload fails after previous success | Gateway uses last loaded snapshot when allowed | Gateway test |
| no snapshot | no active snapshot exists | runtime domain outcome/read model reports absence; provenance object is null/empty | Gateway/read model test |

Reject:

- Gateway consuming editable RuntimeConfig directly
- RuntimeSnapshot body containing provider key/API key/App Token/Authorization header
- `budgetScopeType/budgetScopeId` as active snapshot lookup key
- `no_snapshot/not_checked` inside actual RuntimeSnapshot provenance object

## PR-3. Budget, Request-Side Safety, Exact Cache, Routing

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| default budget scope | no override | `budgetScopeType=application`, `budgetScopeId=applicationId`, `resolvedBy=default_application` | Gateway test |
| runtime budget override | snapshot specifies project/team scope | resolved budget scope from trusted snapshot/rule only | Gateway test |
| client supplied budget scope | request body sends scope | ignored unless trusted rule resolves same result | Gateway test |
| budget block | quota exceeded | terminal status `blocked`, provider `not_called` | Gateway test |
| rate limit | fixed window exceeded | terminal status `rate_limited`, provider `not_called` | Gateway test |
| safety redact | detector redacts safe summary | provider can proceed with sanitized path; no raw detected value stored | safety/Gateway test |
| safety block | detector blocks | provider not called, cache not written, streaming not started | Gateway test |
| exact cache hit | exact cache contains candidate | provider bypassed and provider outcome `not_called` | cache/Gateway test |
| model auto | requested model `auto` | selected provider/model and routing reason recorded | routing test |

Execution order:

```text
auth/context -> RuntimeSnapshot -> budget/rate limit -> safety -> exact cache -> routing -> provider/fallback
```

## PR-4. Streaming Thin Slice

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| streaming success | stream enabled and gates pass | user receives chunks; final log is `success` | handler/Web smoke |
| safety block | unsafe request with stream requested | stream never starts; provider not called | Gateway test |
| budget block | quota exceeded with stream requested | stream never starts; provider not called | Gateway test |
| client abort | client disconnects | terminal status `cancelled` | handler test |
| logging | streaming response with chunks | token chunks are not stored | log inspection |

Reject:

- token-level lifecycle logging as v2 core
- response-side safety scan in v2 core
- streaming start before request-side gates

## PR-5. Observability, Dashboard, Metrics, k6

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| Request Detail | requestId from any v2 path | identity, budget scope, runtime provenance, terminal status, domain outcomes visible | UI/API smoke |
| Dashboard freshness | dashboard load | freshness and query budget visible | UI/API smoke |
| latency split | provider path request | p95 Gateway internal latency and p95 Provider latency separate | query test |
| system error rate | mix of safety block, budget block, provider failure | only system/provider failures counted as error rate | query test |
| exact cache aggregate | cache hit scenario | exact cache rate separate from semantic cache evidence | query/UI test |
| fallback aggregate | provider error plus fallback | fallback count/rate visible without changing terminal success semantics | query/UI test |
| metrics labels | scrape metrics | no request IDs, trace IDs, hashes, credential IDs, auth headers, provider keys, raw error detail | metrics test |
| k6 baseline | run baseline | scenarios separated: success, cache hit, provider call, safety block, rate limit, fallback, streaming, mixed | k6 report |

## PR-6. Demo Freeze And Evidence

| Scenario | Input / Setup | Expected result | Evidence |
|---|---|---|---|
| safe request | preset safe prompt | Request Detail and Dashboard update | demo runbook |
| exact cache hit | repeat safe request | provider bypass visible | demo runbook |
| redaction | synthetic sensitive category | sanitized safety outcome visible to Admin/Developer | demo runbook |
| safety block | blocked category | provider not called | demo runbook |
| rate limit | repeated request preset | terminal status `rate_limited` | demo runbook |
| provider timeout | synthetic timeout | fallback behavior visible | demo runbook |
| provider error fallback | synthetic provider error | terminal success with fallback success | demo runbook |
| streaming | streaming preset | perceived streaming and final status visible | demo runbook |

Reject:

- audience free input without sandbox guardrails
- raw request/response or secret-shaped value in demo fixture
- demo-only behavior that bypasses Gateway main path

## Release-Level Acceptance

v2.0.0 is ready when:

- v1.0.0 baseline main path remains working.
- Employee Chat uses Application-boundary Gateway path.
- Gateway consumes published RuntimeSnapshot only.
- Actual Provider and Mock fallback are both observable.
- request-side budget/safety gates prevent provider calls.
- Exact Cache hit bypasses provider calls.
- Streaming thin slice logs final outcome only.
- Observability consumes Gateway-produced outcomes.
- Dashboard shows resolved budget scope, freshness, query budget, cost, fallback, exact cache, and latency split.
- k6 evidence covers the agreed v2 scenarios.
- forbidden sensitive values are absent from DB/log/fixture/API response/metrics label/UI.
