# GateLM v2.0.0 RC Checklist

## Purpose

This checklist defines the minimum evidence required before calling a branch a v2.0.0 release candidate.

It does not replace `contracts.md`. If this document conflicts with the v2 contracts, `docs/v2.0.0/contracts.md` wins.

## Required Gates

| Gate | Command or Evidence | Required For RC | Notes |
|---|---|---:|---|
| Docs contract check | `corepack pnpm verify:v2-docs` | Yes | Confirms contracts/schema/fixture guardrails. Runs `scripts/verify-v2-docs.mjs`. |
| Final verification | `corepack pnpm verify:v2-final` | Yes | Run through `corepack`, not bare pnpm. Runs `scripts/verify-v2-final.mjs`. |
| Final hardening wrapper | `corepack pnpm v2:final:hardening -- -RunFullVerify` | Yes | Stores sanitized hardening evidence. Runs `scripts/dev/v2-final-hardening.ps1`. |
| Provider E2E | `corepack pnpm v2:provider:e2e` | Yes | Must be either real OpenAI live or explicitly labeled local mock-provider evidence. Runs `scripts/dev/v2-provider-e2e-main-path.ps1`. |
| Request log consistency | `corepack pnpm v2:request-log:consistency` | Yes | Same requestId must match Detail, Logs, Dashboard. Runs `scripts/dev/v2-request-log-outcome-consistency.ps1`. |
| k6 smoke | `corepack pnpm v2:k6:smoke` | Yes | Target checks: 100% checks, 0% unexpected HTTP failures. Runs `scripts/dev/v2-k6-smoke.ps1`. |
| RC freeze gate | `corepack pnpm v2:rc:freeze -- -RunFullVerify -RequireLiveEvidence` | Yes | Scans latest evidence for sensitive markers. Runs `scripts/dev/v2-rc-freeze.ps1`. |

## Must Not Be In Evidence

- raw prompt
- raw response
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

## RuntimeSnapshot Requirement

For RC evidence, Gateway should run with published RuntimeSnapshot as the execution source.

If strict mode is available, use:

```powershell
$env:GATEWAY_RUNTIME_SNAPSHOT_MODE="strict"
$env:GATEWAY_CONTROL_PLANE_BASE_URL="http://localhost:3001"
```

Demo/static fallback evidence is acceptable only when clearly labeled as demo evidence.

## Budget And Rate Limit Requirement

Budget and Rate Limit evidence must keep domain outcomes canonical:

| Domain | Required Outcome Shape |
|---|---|
| Budget allowed | `budget.outcome=allowed` or `not_checked` when quota is intentionally absent |
| Budget warned | `budget.outcome=warned` |
| Budget blocked | `terminalStatus=blocked`, `budget.outcome=blocked`, `provider.outcome=not_called` |
| Rate limit allowed | `rateLimit.outcome=allowed` |
| Rate limited | `terminalStatus=rate_limited`, `rateLimit.outcome=rate_limited` |

Do not introduce `limited` or other non-contract outcome values.

## RC Decision

RC can be proposed only when:

1. All required gates pass.
2. Evidence reports are sanitized.
3. Known remaining gaps are explicitly listed in the release note.
4. Team reviewers agree that remaining gaps are not demo blockers.

