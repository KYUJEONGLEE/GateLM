# apps/web Route Compile Baseline

## Goal

This document fixes the current `apps/web` route compile baseline so later frontend performance work can compare the same cold-start flow before and after implementation.

This is evidence guidance, not a hard performance gate. Local route compile time is affected by machine load, cache state, antivirus, and concurrent services. The main comparison is whether the initial route compile scope shrinks and whether the user sees the console shell sooner.

## Baseline Source

| Item | Value |
|---|---|
| Source log | `.codex-web-3000-policy-fix.out.log` |
| Log filesystem timestamp | `2026-07-08 20:57:34 Asia/Seoul` |
| Next.js version in log | `15.5.19` |
| Node baseline | `22` |
| pnpm baseline | `9.15.0` |
| Cold-start definition | Fresh `apps/web` dev server process, route not previously visited in that process |

## Recorded Baseline

| Route | Compile result | Request result | Notes |
|---|---:|---:|---|
| `/` | `20.8s`, `659 modules` | `GET / 200 in 622ms` | First route compile after middleware |
| `/tenants/[tenantId]/projects/[projectId]/policies` | `23.6s`, `1236 modules` | `GET .../policies 307 in 26938ms` | Redirect is accepted as evidence because the route compile completed |
| `/tenants/[tenantId]/projects/[projectId]/applications/[applicationId]/policies` | Not recorded | Not recorded | Added to the repeatable measurement set |

Baseline lines:

```text
Compiled /middleware in 4.3s (115 modules)
Compiled / in 20.8s (659 modules)
GET / 200 in 622ms
Compiled /tenants/[tenantId]/projects/[projectId]/policies in 23.6s (1236 modules)
GET /tenants/1a13c59c-16d6-4936-bb1e-ba4ee7c79f47/projects/25063263-346d-4f65-a554-82e08a9db714/policies 307 in 26938ms
```

## Repeatable Measurement

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/web-route-compile-measure.ps1
```

The script starts `corepack pnpm --filter @gatelm/web dev`, waits for `Ready in ...`, requests these routes in order, and writes a markdown report under `reports/web-route-compile/`:

1. `/`
2. `/tenants/{tenantId}/projects/{projectId}/policies`
3. `/tenants/{tenantId}/projects/{projectId}/applications/{applicationId}/policies`

Protected console routes use a non-secret probe cookie so middleware lets the route module compile before the auth layout redirects. The probe is not a valid user session and is not authentication evidence. Reports record only that the console probe was enabled; they must not record the cookie value or any other header value.

To reproduce the unauthenticated redirect behavior without the probe, pass `-DisableConsoleProbeCookie`.

Default IDs match the seed defaults:

| Scope | Default ID |
|---|---|
| Tenant | `00000000-0000-4000-8000-000000000100` |
| Project | `00000000-0000-4000-8000-000000000200` |
| Application | `00000000-0000-4000-8000-000000000300` |

## Comparison Rule

Do not fail the work only because one timing number is above or below a fixed threshold. Compare:

- same-route first compile module count
- same-route first compile duration, treated as a noisy signal
- whether route compile scope moved out of the initial shell path
- whether the user can see shell or fallback UI sooner

The report intentionally stores only route compile and request summary lines. It must not include raw prompts, raw responses, API keys, app tokens, provider keys, Authorization headers, provider raw error bodies, or secret plaintext.
