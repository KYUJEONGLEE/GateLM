# Unified Analytics Policy Impact Data Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed contract with implementation in `feat/analysis-tab` |
| Applies to | Web Analytics `impact` tab, Gateway aggregate observability, and Tenant Chat projection |
| Does not apply to | Runtime routing decisions, billing ledger enforcement, quota enforcement, or Tenant Chat RAG retrieval |
| Last reviewed | 2026-07-18 |

## 1. Goal

The Analytics policy-impact page reads one server-side aggregate for Project/Application and Tenant Chat traffic. It never reconstructs the selected range from a capped request-log list and never represents missing telemetry as zero.

Tenant-wide scope includes both surfaces. A request with `projectId` is Project/Application-only because Tenant Chat has no project identity. The implementation does not create a sentinel project for Tenant Chat.

## 2. Metric Meaning

High-performance requests use a surface-specific, server-persisted role:

| Surface | Eligible roles | High-performance role |
|---|---|---|
| `project_application` | `simple`, `complex` | `complex` |
| `tenant_chat` | `economy`, `standard`, `high_quality` | `high_quality` |

The combined numerator is `Project/Application complex + Tenant Chat high_quality`. The combined denominator contains only requests with one of the eligible roles above. Provider name, model name, price, latency, and catalog metadata are not used to infer the role.

The routing chart preserves the two schemes. It does not translate Tenant Chat tiers into `simple | complex`.

Model traffic means the final server-recorded execution model:

- Project/Application: `p0_llm_invocation_logs.provider + model`;
- Tenant Chat: `tenant_chat_invocation_logs.effective_provider_id + effective_model_key`;
- successful fallback: the final successful attempt;
- exact cache hit: the source entry's encrypted, bounded provider/model/tier provenance.

## 3. Aggregate API

`GET /api/analytics/policy-impact`

Required query parameters are `tenantId`, `from`, and `to`. `period` defaults to `hour`. `projectId` is optional and excludes Tenant Chat when present.

The additive response contract is:

```json
{
  "data": {
    "period": "hour",
    "bucketInterval": "5m",
    "totals": {
      "requestCount": 2500,
      "costMicroUsd": 9000,
      "knownSavedCostMicroUsd": 2500,
      "savedCostMicroUsd": null,
      "avoidedProviderCallRequests": 500,
      "protectedRequests": 80,
      "highPerformanceRequests": 700,
      "highPerformanceEligibleRequests": 2000
    },
    "surfaceTotals": [],
    "policyOutcomes": [],
    "routingRoles": [],
    "modelBuckets": [],
    "usageSources": [],
    "metricCoverage": [],
    "dataFreshness": {}
  }
}
```

Rules:

- `modelBuckets` aggregates source rows before applying a bounded top-50 executed-model response set. It has no 1,000-request input cap.
- Bucket timestamps are UTC, start-inclusive, and end-exclusive.
- Policy-outcome counts are not mutually exclusive.
- `usageSources` uses project IDs for Project/Application and a `tenant_chat` surface row with `projectId=null` for Tenant Chat.
- `savedCostMicroUsd` is `null` when any included request lacks authoritative savings telemetry. `knownSavedCostMicroUsd` remains available for audit and must not be presented as a complete total.
- The current implementation uses bounded aggregate SQL over the canonical raw tables. Existing dashboard and cost-report rollups remain separate contracts until the policy-impact dimensions gain explicit coverage counters.

## 4. Policy Outcomes

The response preserves these bounded outcomes:

- `cache_hit`
- `pii_masked`
- `safety_blocked`
- `rate_limited`
- `fallback_success`
- `quota_blocked`
- `budget_blocked`
- `concurrency_limited`
- `policy_ack_required`

The Web may group only presentation-equivalent outcomes. It must not collapse quota, budget, concurrency, or acknowledgement blocks into a generic zero-valued category.

## 5. Tenant Chat Projection Additions

`tenant_chat_invocation_logs` adds nullable bounded fields:

- `effective_route_tier`: `high_quality | standard | economy`
- `saved_cost_micro_usd`: non-negative micro-USD
- `masking_action`: `none | redacted | blocked`

Backfill rules are deliberately narrow:

- route tier may be derived only by matching the persisted final provider/model to the request's immutable RuntimeSnapshot;
- non-cache-hit savings are deterministically `0`;
- historical cache-hit savings remain `NULL` when the source cost was not persisted;
- `safety_blocked` deterministically maps to `masking_action=blocked`;
- historical redaction is never inferred from message content or reconstructed from encrypted text.

The v2 content-free terminal event accepts optional provider/model/tier, saved-cost, and masking fields. They contain no prompt, response, detected value, user identifier, credential, or raw error.

## 6. Exact Cache Provenance

The encrypted Tenant Chat exact-cache payload v2 contains:

- response ciphertext payload;
- effective provider ID;
- effective model key;
- effective route tier;
- source confirmed cost in micro-USD.

The Redis namespace and envelope version are bumped to v2, invalidating old entries. A cache hit fails closed when the bounded provenance is absent or invalid. The terminal projector records the source cost as saved cost while the confirmed provider cost and tokens remain zero for the cache-hit request.

## 7. Metric Coverage

Every surface reports `complete | partial | unavailable`, known request count, and unknown request count for:

- `saved_cost`
- `pii_masking`
- `high_performance`
- `model_flow`

The Web marks the policy-impact page partial when any included metric is not complete. A partial saved-cost rate is displayed as unavailable rather than `0%`.

## 8. Security And Cardinality

- Tenant and optional project predicates are applied inside every aggregate query branch.
- Only the server-side Web client sends the observability token.
- Raw prompt, raw response, raw detected values, prompt fragments, credentials, authorization, Provider raw errors, hashes, request IDs, user IDs, and employee IDs are not returned.
- Provider/model IDs and bucket timestamps are response values, not metric labels.
- Model rows are bounded after complete source aggregation; request counts are never capped by request-log pagination.

## 9. Acceptance

1. Tenant-wide policy impact includes Project/Application and Tenant Chat; project scope excludes Tenant Chat.
2. More than 1,000 source requests produce complete model bucket counts.
3. App `complex` and Tenant Chat `high_quality` form the high-performance numerator without cross-scheme coercion.
4. Final successful fallback and cache-hit source model provenance are represented.
5. Tenant Chat historical unknown savings or masking is surfaced as partial, never zero-filled.
6. Usage attribution contains a Tenant Chat surface row and no sentinel project.
7. No forbidden data is added to API, DB, event, structured log, metric, fixture, or UI.
