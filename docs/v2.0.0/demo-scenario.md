# GateLM v2.0.0 Demo Scenario Evidence

This runbook freezes the PR-6 demo evidence path. The goal is not to narrate safety
features, but to prove a preset run by following its real `requestId` into Request
Detail, Dashboard, and k6 evidence.

## Scope

- Primary presets: `redaction`, `safety_block`
- Optional Semantic Cache work is evidence-only and must not be included in Exact Cache
  `cacheHitRate`, `savedCost`, or provider bypass metrics.
- Audience free input stays disabled unless sandbox guardrails are implemented.

## Redaction Preset

1. Run `redaction` from the customer demo.
2. Copy the returned `requestId`.
3. Open Request Detail from the demo link.
4. Confirm `domainOutcomes.safety.outcome = redacted`.
5. Confirm detector evidence is category/count only:
   - `detectedCount`
   - `detectorCategories`
6. Confirm no raw prompt, raw detected value, raw prompt fragment, raw response,
   credential, authorization header, provider raw error body, or actual secret appears
   in UI, API response, log output, fixture, or this runbook.

## Safety Block Preset

1. Run `safety_block` from the customer demo.
2. Copy the returned `requestId`.
3. Open Request Detail from the demo link.
4. Confirm:
   - `terminalStatus = blocked`
   - `domainOutcomes.safety.outcome = blocked`
   - `domainOutcomes.provider.outcome = not_called`
   - no cache write is recorded
   - `domainOutcomes.streaming.outcome = not_streaming`
5. Open Dashboard from the demo link.
6. Confirm the request is counted in `blockedCount` or the safety outcome breakdown.
7. Confirm it is not counted in `failedCount` or `systemErrorRate`.

## k6 Evidence

Run the k6 baseline with the Gateway demo environment configured. The
`safety_block` scenario must prove:

- block response is expected traffic, not a k6/system failure
- provider metric does not increment
- cache write metric does not increment
- Gateway request metric records `status=blocked`
- forbidden terminal status values such as `cache_hit`, `error`, and
  `partial_success` are absent

## Semantic Cache Evidence-Only

If a Semantic Cache scenario is added, keep it in a separate Evaluation Lab section.
Use redacted/normalized inputs only. Do not report Semantic Cache as live response
path behavior, actual provider bypass, Exact Cache hit rate, or cost saving.
