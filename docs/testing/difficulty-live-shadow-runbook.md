# Difficulty Live Shadow Runbook

| Field | Value |
|---|---|
| Status | One-time owner-approved v3 baseline E2E shadow waiver; opt-in only |
| Applies to | Limited development tenant/application request shadow |
| Product routing | Rule-based and authoritative |
| Active contract | [`../routing/contracts.md`](../routing/contracts.md) |
| Last reviewed | 2026-07-15 |

## 1. Scope And Safety Boundary

Live shadow is observation-only. It does not change category, authoritative difficulty, routing matrix lookup, ordered `modelRefs`, decision key, cache, provider resolution, retry, fallback, quota or cost.

The owner guardrails approved, live evidence pending state originally applied to the historical `payload-empty / separate score-3` decision boundary. The Gateway now uses `semantic-empty / combined score-8`, so [`difficulty-live-shadow-boundary-supersession.json`](difficulty-live-shadow-boundary-supersession.json) still makes that approval alone insufficient. The routing owner subsequently approved [`difficulty-live-shadow-baseline-e2e-waiver.json`](difficulty-live-shadow-baseline-e2e-waiver.json) as a one-time exception for the exact immutable v3 identity. The exception acknowledges the boundary mismatch and the failed promotion gate; its only purpose is to exercise tokenizer → encoder → pooling → PCA → 118D → score → aggregate metric wiring. Product routing remains rule-based.

The waiver ID is `difficulty-shadow-baseline-e2e-v3.2026-07-15.v1`. Gateway accepts it only while the checked-in v3 artifact version, bundle hash, content hash, threshold policy `difficulty-threshold-v1 = 0.45`, historical boundary and current boundary all match the pinned values. Empty, misspelled or future artifact waiver values fail closed before encoder creation.

The optional profile allows at most `30s` for cold startup bundle verification and the first inference smoke. This startup-only bound does not change the per-request shadow timeout, which remains `100ms` by default and is bounded to `1..1000ms`.

Activation requires all three settings:

```dotenv
GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=true
GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES=tenant_dev_a/application_dev_a
GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER=difficulty-shadow-baseline-e2e-v3.2026-07-15.v1
```

Use exact development tenant/application pairs supplied through deployment-local configuration. Do not commit real IDs. Wildcards, tenant-only entries, application-only entries and independent-list cross-products are invalid. Empty or malformed input disables the whole request shadow without failing Gateway startup.

Rollback clears the allowlist and `GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER`, or sets `GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=false`, then restarts the Gateway process.

## 2. Owner-Approved Guardrails

The routing owner approved the historical exact artifact, threshold and runtime guardrails in [`difficulty-live-shadow-owner-approval.json`](difficulty-live-shadow-owner-approval.json) on 2026-07-15, then explicitly reconfirmed those limits for the one-time baseline E2E waiver. The untouched promotion Holdout accuracy `0.70` remains below `0.91`; the failed promotion gate is not changed or relabeled. This exception never approves ML-authoritative routing, product model selection changes, production/global enablement or release.

Before enabling any pair, the deployment platform must enforce a container memory hard limit of `2 GiB` (`2147483648` bytes). The diagnostic three-run replay observed peak process RSS `1008566272` bytes and peak cgroup current `1540128768` bytes; these measurements are runtime context, not promotion evidence.

Rollback immediately when any one of these occurs:

- container OOM or Gateway restart
- one or more authoritative rule routing or `modelRef` mismatches
- one or more sensitive-data exposures
- one or more cases where shadow failure affects the request or provider path

Rollback when either memory condition persists for 5 minutes:

- process RSS greater than `1.25 GiB` (`1342177280` bytes)
- cgroup current greater than `1.75 GiB` (`1879048192` bytes)

To roll back, clear `GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES` and `GATEWAY_DIFFICULTY_E5_SHADOW_BASELINE_WAIVER`, or set `GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=false`, restart Gateway, and confirm rule-only routing and provider health before re-enabling. Memory and restart observations come from deployment-platform operational telemetry; this runbook does not add a product metric contract.

## 3. Rollout

The following sequence is authorized only for the exact v3 baseline plus the pinned waiver:

1. Deploy the candidate image with shadow disabled and a `2 GiB` hard memory limit.
2. Set the exact waiver and enable one exact development tenant/application pair.
3. Observe isolation and metric cardinality for 24 hours.
4. If the Gateway remains stable, expand to at most two or three development pairs.
5. Collect at least seven days and 1,000 `ready` comparisons overall.
6. Mark a category with fewer than 100 `ready` comparisons as `insufficient_evidence`.

Do not set a disagreement pass threshold in this phase. Live observations do not promote the model, calibrator or threshold.

## 4. Aggregate Disagreement

The denominator contains only comparable `ready` results: `match`, `rule_simple_shadow_complex` and `rule_complex_shadow_simple`. `not_compared` and non-ready statuses are excluded.

```promql
sum(
  increase(gatelm_routing_difficulty_shadow_total{
    status="ready",
    comparison=~"rule_simple_shadow_complex|rule_complex_shadow_simple"
  }[24h])
)
/
sum(
  increase(gatelm_routing_difficulty_shadow_total{
    status="ready",
    comparison=~"match|rule_simple_shadow_complex|rule_complex_shadow_simple"
  }[24h])
)
```

## 5. Category Direction

```promql
sum by (category, comparison) (
  increase(gatelm_routing_difficulty_shadow_total{
    status="ready",
    comparison=~"rule_simple_shadow_complex|rule_complex_shadow_simple"
  }[24h])
)
/
on (category) group_left
sum by (category) (
  increase(gatelm_routing_difficulty_shadow_total{
    status="ready",
    comparison=~"match|rule_simple_shadow_complex|rule_complex_shadow_simple"
  }[24h])
)
```

Live requests do not have ground-truth difficulty labels. Report these values as baseline-relative directional disagreement, not accuracy, false-positive rate or false-negative rate.

## 6. Evidence Record

Record only:

- observation start and end time
- source commit and image identity
- frozen artifact, bundle and threshold policy versions
- overall comparable count, disagreement count and rate
- per-category comparable count and the two directional count/rates
- categories marked `insufficient_evidence`

Do not record tenant/application IDs, request/trace IDs, prompt or response content, tokens, embedding/vector material, score, modelRef, provider/model or error detail.

Existing shadow status and duration metrics may be used only as operational isolation guardrails. They are not model-quality outcomes. The owner-approved triggers in section 2 stop the rollout and require rollback. Every future artifact must pass accuracy `>= 0.91`, `complex -> simple <= 1`, category non-regression, untouched Holdout and owner approval; this one-time live-shadow waiver cannot be reused to bypass those gates.
