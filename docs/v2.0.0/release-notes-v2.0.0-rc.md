# GateLM v2.0.0 RC Release Notes Draft

## Status

Candidate status: not tagged yet.

This draft is prepared for the v2.0.0 RC decision. It must be updated with actual PR numbers, evidence paths, and reviewer sign-off before tagging.

## What Is Included

| Area | Included |
|---|---|
| Gateway main path | Customer request through Gateway, auth, RuntimeSnapshot, policy stages, provider or fallback, request log |
| Provider | OpenAI-compatible adapter path and Mock fallback path |
| Runtime policy | RuntimeConfig publish to RuntimeSnapshot execution view |
| Outcomes | `terminalStatus + domainOutcomes` in Request Detail / Logs / Dashboard read model |
| Cache | Exact cache path and cache outcome visibility |
| Safety | Request-side safety before provider call |
| Budget | RuntimeSnapshot budget policy and budget outcome path |
| Rate Limit | Gateway pre-provider rate limit stage |
| Evidence | Provider E2E, Request Log consistency, k6 smoke, final hardening, RC freeze gate |

## Known Limits

| Area | Limit |
|---|---|
| Real OpenAI live | Must be explicitly verified with a real OpenAI API key before calling it production evidence |
| Budget hard block | If Budget Ledger PR is not merged, budget remains policy/outcome thin slice |
| Rate Limit project scope | If scope PR is not merged, application scope remains the stable path |
| RuntimeSnapshot strict mode | If strict mode PR is not merged, demo/static fallback remains available |
| Production readiness | RC does not mean production-ready self-host operation |

## Evidence To Attach

| Evidence | Path Pattern |
|---|---|
| Provider E2E | `reports/e2e/v2-provider-e2e-*.json` |
| Request Log consistency | `reports/e2e/v2-request-log-consistency-*.json` |
| k6 smoke | `reports/e2e/v2-k6-smoke-*-summary.json` |
| Final hardening | `reports/e2e/v2-final-hardening-*.json` |
| RC freeze | `reports/e2e/v2-rc-freeze-*.json` |

Evidence files must not include raw prompts, raw responses, credentials, provider keys, Authorization headers, or actual secrets.

## Tagging Notes

Before creating a tag:

```powershell
corepack pnpm v2:final:hardening -- -RunFullVerify
corepack pnpm v2:rc:freeze -- -RunFullVerify -RequireLiveEvidence
```

Then update this draft with:

- final commit SHA
- evidence file paths
- reviewer names
- remaining known risks
- tag name

