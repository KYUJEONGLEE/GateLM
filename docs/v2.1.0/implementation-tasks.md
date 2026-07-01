# GateLM v2.1.0 Self-host Implementation Tasks

This document is the coding task plan for `docs/v2.1.0/implementation-plan.md`.

`docs/v2.0.0/contracts.md` remains the source of truth for Gateway behavior, RuntimeSnapshot, Provider, Observability, API, DB, Event, Metrics, and Security-sensitive fields. v2.1.0 tasks must not redefine those contracts.

## 0. Global Rules

- Do not change API/DB/Event/Metrics/Security-sensitive contract shape inside a packaging PR without a contract PR first.
- Do not store or expose raw prompt, raw response, raw detected value, raw prompt fragment, API Key, App Token, Provider Key, Authorization header, provider raw error body, or actual secret.
- Do not bake `.env`, customer config, provider keys, local credentials, private keys, or generated secrets into Docker images.
- Do not require customers to mount the source repo into app containers.
- Keep dev toolbox Dockerfiles separate from customer delivery images.
- Keep Provider/Model as catalog/config data.
- Keep Gateway RuntimeSnapshot consumption aligned with v2.0.0.

## PR-0. v2.1 Self-host Documentation Baseline

Branch:

```text
docs/v2.1-selfhost-plan
```

Purpose:

- Define v2.1.0 as Single-node Docker Compose self-host installable MVP.
- Keep v2.0.0 behavioral contracts intact.

Likely files:

| Area | Paths |
|---|---|
| docs | `docs/v2.1.0/contracts.md`, `docs/v2.1.0/implementation-plan.md`, `docs/v2.1.0/implementation-tasks.md`, `docs/v2.1.0/acceptance-test-matrix.md` |

Tasks:

- Document self-host package shape.
- Document image requirements.
- Document install, migrate, seed, smoke-test target flow.
- Document non-goals: Helm, HA, air-gap, mandatory ClickHouse/Redpanda, mandatory AWS Secrets Manager/KMS.
- Document forbidden sensitive exposure rules for images, scripts, logs, docs, and env examples.

Verification:

- `git diff --check`
- `corepack pnpm run verify:v2-docs`

## PR-1. Production Docker Images

Branch:

```text
build/selfhost-production-images
```

Purpose:

- Build production images for app services that start without source volume mounts.

Likely files:

| Service | Paths |
|---|---|
| Web | `infra/docker/web.Dockerfile`, `apps/web/next.config.ts` if standalone output is chosen |
| Control Plane API | `infra/docker/control-plane-api.Dockerfile`, `apps/control-plane-api/package.json` if production scripts need adjustment |
| Gateway Core | `infra/docker/gateway-core.Dockerfile`, `apps/gateway-core/cmd/gateway/main.go` only if startup config needs safe alignment |
| AI Service | `infra/docker/ai-service.Dockerfile`, `apps/ai-service/pyproject.toml` if package install metadata needs adjustment |
| root | `.dockerignore`, `package.json` if image build scripts are added |

Tasks:

- Add production Dockerfiles separate from `infra/docker/node`, `infra/docker/go`, and `infra/docker/python` toolbox images.
- Build Web with production Next.js output and start with `next start` or a documented standalone server.
- Build Control Plane API with compiled NestJS output and Prisma client generation.
- Build Gateway Core as a compiled Go binary.
- Build AI Service with pinned Python dependencies from `pyproject.toml`.
- Set non-interactive container commands.
- Use explicit service ports.
- Avoid copying `.env`, node_modules cache, local build cache, credentials, or secret files.
- Add image labels or docs for `gatelm/<service>:2.1.0` tags.

Verification:

- Image build for each app service.
- Container starts and exposes health endpoint where applicable.
- `docker history` or image build review shows no `.env` or secret file copied.
- Forbidden sensitive exposure search in Dockerfiles.

## PR-2. Self-host Compose Bundle

Branch:

```text
feat/selfhost-compose-bundle
```

Purpose:

- Add the customer-facing Docker Compose bundle.

Likely files:

| Area | Paths |
|---|---|
| bundle | `deploy/selfhost/docker-compose.yml`, `deploy/selfhost/.env.example`, `deploy/selfhost/README.md` |
| reverse proxy | `deploy/selfhost/reverse-proxy/caddy/Caddyfile`, `deploy/selfhost/reverse-proxy/nginx/default.conf` |

Tasks:

- Define services: `web`, `control-plane-api`, `gateway-core`, `ai-service`, `postgres`, `redis`, `mock-provider`.
- Use `image:` references for customer path; support local `build:` only via optional override file if needed.
- Use named volumes for PostgreSQL and Redis.
- Add health checks for app services and dependencies.
- Use Compose service names for internal URLs.
- Keep public ports configurable.
- Keep optional services out of the default path.
- Document public route intent for Web, API, and Gateway.

Verification:

- `docker compose -f deploy/selfhost/docker-compose.yml config`
- Compose config includes no source repo volume mount for app services.
- `.env.example` contains placeholders only.
- Health check commands do not print credentials.

## PR-3. Self-host Config And Secret Boundaries

Branch:

```text
feat/selfhost-config-and-secrets
```

Purpose:

- Make self-host environment configuration explicit and safe.

Likely files:

| Area | Paths |
|---|---|
| env examples | `deploy/selfhost/.env.example`, root `.env.example` only if pointers are needed |
| Gateway config docs/code | `apps/gateway-core/internal/config/config.go`, self-host README/docs |
| Web config docs/code | `apps/web/src/lib/gateway/live-gateway-config.ts`, self-host README/docs |
| Control Plane config docs/code | `apps/control-plane-api/src/config/env.schema.ts`, self-host README/docs |

Tasks:

- Separate public URLs from internal URLs.
- Ensure Gateway uses Control Plane URL only from trusted server-side config.
- Document provider credential resolver env map.
- Ensure `.env.example` does not contain real or secret-shaped values.
- Add startup validation only where it does not break dev/local workflows.
- Document safe mock mode and actual provider mode.
- Ensure scripts redact env values in output.

Verification:

- Config review against v2.0.0 forbidden data list.
- Self-host `.env.example` review.
- Gateway actual provider credential resolution smoke with safe placeholders or mock mode.

## PR-4. Migration And Bootstrap Scripts

Branch:

```text
feat/selfhost-bootstrap-scripts
```

Purpose:

- Provide deterministic install, migration, and bootstrap commands.

Likely files:

| Area | Paths |
|---|---|
| scripts | `deploy/selfhost/scripts/install.sh`, `deploy/selfhost/scripts/migrate.sh`, `deploy/selfhost/scripts/seed.sh` |
| Control Plane seed | `apps/control-plane-api/prisma/seed.ts` or new self-host seed wrapper |
| SQL migration bridge | `db/migrations/*.sql`, `apps/control-plane-api/prisma/migrations/**` only if compatibility fixes are needed |

Tasks:

- `install.sh`: validate Docker/Compose, validate `.env`, pull images, start dependency/app services.
- `migrate.sh`: apply Control Plane Prisma migrations and Gateway-required SQL migrations in explicit order.
- `seed.sh`: create or verify minimum tenant/project/application/API credential/App Token/Mock Provider/runtime execution state.
- Ensure bootstrap creates or publishes the RuntimeSnapshot state required by Gateway.
- Make scripts idempotent.
- Fail fast on missing DB/Redis.
- Do not echo raw API Key, App Token, Provider Key, or Authorization header.

Verification:

- Run scripts against an empty local database.
- Rerun scripts and confirm idempotency.
- Confirm active RuntimeSnapshot or documented equivalent runtime execution view exists.
- Confirm no forbidden sensitive value appears in script output.

## PR-5. Self-host Smoke Test

Branch:

```text
feat/selfhost-smoke-test
```

Purpose:

- Prove a fresh self-host install works end to end.

Likely files:

| Area | Paths |
|---|---|
| smoke | `deploy/selfhost/scripts/smoke-test.sh` |
| possible helpers | `scripts/dev/v2-demo-evidence.ps1` only as reference, not customer script |

Tasks:

- Check Web HTTP reachability.
- Check Control Plane `/healthz` and `/readyz`.
- Check Gateway `/healthz` and `/readyz`.
- Check AI Service `/healthz`.
- Check DB/Redis readiness through service health or Compose exec.
- Send one synthetic `/v1/chat/completions` request through Gateway.
- Verify Request Log read path contains the request.
- Print request ID but not raw prompt/response or credential headers.
- Provide clear failure messages.

Verification:

- Smoke passes after fresh install.
- Smoke fails with clear error when a dependency is down.
- Smoke output contains no Authorization header, API Key, App Token, Provider Key, raw prompt, raw response, or actual secret.

## PR-6. Self-host Operations Runbook

Branch:

```text
docs/selfhost-ops-runbook
```

Purpose:

- Make the customer-facing install and operations path reproducible.

Likely files:

| Area | Paths |
|---|---|
| docs | `deploy/selfhost/docs/install.md`, `deploy/selfhost/docs/upgrade.md`, `deploy/selfhost/docs/backup-restore.md`, `deploy/selfhost/docs/troubleshooting.md` |
| README | `deploy/selfhost/README.md` |

Tasks:

- Document prerequisites: host, Docker, Docker Compose, domain/TLS recommendation.
- Document registry login and image tag policy.
- Document `.env` setup.
- Document install, migrate, seed, smoke flow.
- Document PostgreSQL backup/restore.
- Document image tag upgrade and rollback.
- Document common failures: port conflict, DB not ready, migration failure, Gateway not ready, provider credential missing.
- Document support boundary for Compose MVP vs Helm/HA future.

Verification:

- A teammate follows docs on a clean machine or clean local Docker environment.
- Docs do not include real secrets or secret-shaped examples.
- Docs do not require source repo development commands for customer path.

## Cross-PR Review Checklist

Every PR description should answer:

- Which v2.0.0 contract sections are preserved?
- Does this PR add/change API, DB, Event, Metrics, or Security-sensitive fields?
- Does this PR expose any forbidden sensitive data?
- Does this PR require source repo volume mounts in customer path?
- Which image(s), script(s), or compose service(s) changed?
- Which fresh-install or smoke checks were run?
- What is the rollback path?

