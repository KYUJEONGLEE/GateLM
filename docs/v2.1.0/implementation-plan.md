# GateLM v2.1.0 Self-host Implementation Plan

> [!NOTE]
> **문서 상태: Versioned self-host plan.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 실제 산출물과 acceptance evidence를 확인하지 않고 current backlog 또는 release-complete 상태로 간주하지 않는다.

## 1. Purpose

This document is the top-level implementation plan for GateLM v2.1.0.

v2.1.0 makes the v2.0.0 LLMOps Gateway MVP installable on a customer-owned single host using Docker Compose.

The target customer journey is:

```text
download self-host bundle
-> configure .env
-> pull images
-> start containers
-> run migrations
-> run bootstrap seed
-> run smoke test
-> send one Gateway request
-> verify Request Log
```

This file stays intentionally short. Concrete file work is in `docs/v2.1.0/implementation-tasks.md`.

## 2. Source Of Truth

Read `docs/README.md` first when starting work.

For Gateway behavior, RuntimeSnapshot, Provider Adapter, Observability, API, DB, Event, Metrics, and Security-sensitive fields, `docs/v2.0.0/contracts.md` remains the source of truth.

For v2.1.0 self-host packaging and installability, use:

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.1.0/contracts.md`
3. `docs/v2.1.0/implementation-plan.md`
4. `docs/v2.1.0/implementation-tasks.md`

Rules:

- v2.1.0 must not weaken v2.0.0 forbidden-data rules.
- v2.1.0 must not make Redpanda, ClickHouse, S3, Kubernetes, AWS Secrets Manager, or KMS mandatory.
- Feature PRs must not silently define new API routes, DB columns, Event fields, Metrics labels, or Security-sensitive fields.
- Self-host packaging must not require customers to clone the repo and run dev toolbox containers.

## 3. Goal

v2.1.0 is healthy when this flow works on a fresh host:

1. Customer prepares Docker and Docker Compose.
2. Customer unpacks `deploy/selfhost` bundle.
3. Customer copies `.env.example` to `.env`.
4. Customer fills domain, DB, Redis, and required secret/config values.
5. Customer pulls versioned GateLM images.
6. Customer starts the stack with Docker Compose.
7. Customer applies migrations.
8. Customer runs bootstrap seed.
9. Customer runs smoke test.
10. Smoke test sends one Gateway request.
11. Request Log shows the request without exposing forbidden data.

## 4. Scope

| Area | v2.1.0 target |
|---|---|
| Delivery | Docker images and `deploy/selfhost` bundle |
| Runtime | Single-node Docker Compose |
| Services | Web, Control Plane API, Gateway Core, AI Service, PostgreSQL, Redis, Mock Provider |
| Configuration | `.env` driven, with safe `.env.example` |
| Secrets | environment-backed or customer-managed resolver references |
| Database | deterministic migrate/bootstrap path |
| Smoke | health checks, Gateway request, Request Log verification |
| Operations | install, upgrade, backup/restore, troubleshooting docs |

## 5. Non-goals

- Kubernetes Helm chart
- multi-node HA
- air-gapped bundle
- production SSO/identity overhaul
- mandatory external managed DB/Redis
- mandatory ClickHouse/Redpanda
- Semantic Cache live response path
- response-side safety main path
- raw prompt/raw response storage opt-in
- broad product feature expansion unrelated to installability

## 6. Work Plan

### Phase 0. v2.1 Documentation Baseline

- Add v2.1.0 self-host contract, implementation plan, task plan, and acceptance matrix.
- Keep v2.0.0 contracts as behavioral source of truth.
- Document that v2.1.0 is delivery/installability work, not a Gateway contract rewrite.

Done when:

- The team can review self-host scope before production image or compose work starts.

### Phase 1. Production Images

- Add production image definitions for Web, Control Plane API, Gateway Core, and AI Service.
- Keep existing toolbox Dockerfiles for development only.
- Ensure images start app processes directly.
- Ensure images do not contain `.env`, real credentials, or local secret files.

Done when:

- Each image can be built locally with an explicit version tag and has a documented run command.

### Phase 2. Self-host Compose Bundle

- Add `deploy/selfhost/docker-compose.yml`.
- Add `deploy/selfhost/.env.example`.
- Add service health checks and named volumes.
- Use versioned image references.
- Include PostgreSQL, Redis, and Mock Provider for single-host installability.

Done when:

- `docker compose` can start the self-host topology without source volume mounts.

### Phase 3. Config And Secret Boundaries

- Normalize self-host env names and defaults.
- Separate internal service URLs from public URLs.
- Configure Gateway credential resolver through server-side env mappings.
- Ensure `.env.example` uses placeholders and safe defaults only.

Done when:

- A reviewer can see where every required self-host value comes from and no forbidden value is committed.

### Phase 4. Migration And Bootstrap

- Add install/migrate/seed scripts under `deploy/selfhost/scripts`.
- Make migration order explicit.
- Make bootstrap idempotent.
- Ensure bootstrap creates or verifies the minimum runtime state needed for one Gateway request.

Done when:

- Running migrate and seed on an empty DB prepares the self-host smoke path.

### Phase 5. Self-host Smoke

- Add smoke script that checks Web, Control Plane, Gateway, AI Service, DB, Redis, Gateway request, and Request Log.
- Keep output redacted.
- Fail fast with actionable messages.

Done when:

- A fresh install can prove one request through Gateway and one Request Log record.

### Phase 6. Operations Runbook

- Add install, upgrade, backup/restore, and troubleshooting docs.
- Include registry login and image tag guidance.
- Include reverse proxy/TLS examples or references.

Done when:

- A teammate can follow the docs on a new host without using repo-internal development commands.

## 7. First Merge Units

| Unit | Branch | Purpose |
|---|---|---|
| 0 | `docs/v2.1-selfhost-plan` | v2.1.0 self-host contract, plan, tasks, acceptance |
| 1 | `build/selfhost-production-images` | Production image definitions for app services |
| 2 | `feat/selfhost-compose-bundle` | `deploy/selfhost` Compose bundle and env example |
| 3 | `feat/selfhost-config-and-secrets` | Self-host env/config/credential resolver boundaries |
| 4 | `feat/selfhost-bootstrap-scripts` | install, migrate, seed scripts |
| 5 | `feat/selfhost-smoke-test` | end-to-end self-host smoke script |
| 6 | `docs/selfhost-ops-runbook` | install, upgrade, backup/restore, troubleshooting docs |

## 8. Verification

Common checks:

- `git diff --check`
- `corepack pnpm run verify:v2-docs`
- impacted image build
- impacted service health check
- impacted migration/seed smoke
- forbidden sensitive exposure search
- v2.0.0 Gateway contract review for touched files

Release smoke:

```text
fresh self-host directory
-> copy .env.example .env
-> configure safe local values
-> docker compose pull or build
-> docker compose up -d
-> migrate
-> seed
-> smoke-test
```

Expected result:

- Web reachable
- Control Plane reachable
- Gateway reachable and ready
- AI Service reachable
- PostgreSQL and Redis reachable
- one Gateway request succeeds
- Request Log contains the request
- no forbidden sensitive values are exposed

## 9. Completion Criteria

v2.1.0 is implementation-complete when:

- v2.0.0 main Gateway path remains working.
- Self-host bundle exists under `deploy/selfhost`.
- Production images exist for required app services.
- Compose starts the required single-node topology.
- Migration and seed scripts prepare a fresh database.
- Smoke test proves one Gateway request and Request Log visibility.
- Container restart preserves PostgreSQL-backed data.
- `.env.example`, docs, scripts, images, logs, API responses, UI, and metrics labels do not expose forbidden sensitive values.
- Helm, HA, air-gap, and optional analytics services remain explicitly out of MVP scope.
