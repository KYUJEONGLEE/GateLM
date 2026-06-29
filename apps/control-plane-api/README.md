# GateLM Control Plane API

NestJS workspace for 재혁님's Control Plane and Runtime Policy scope.

Start GateLM work from `docs/README.md`. For v2.0.0, `docs/v2.0.0/contracts.md` is the contract authority, followed by schemas/fixtures, `implementation-plan.md`, and `implementation-tasks.md`. This app README is only an operational pointer and does not redefine RuntimeSnapshot, API, DB, Event, Metrics, or security-sensitive contracts.

## Scope

- Project, Application, Provider Connection
- API Key and App Token lifecycle
- RuntimeConfig validation and RuntimeSnapshot publishing
- Gateway-facing published RuntimeSnapshot shape

## Local Commands

Install dependencies from the repo root:

```bash
docker compose run --rm node-toolbox pnpm install
```

Start local infrastructure:

```bash
docker compose up -d postgres redis mock-provider
```

Generate Prisma client and run migrations:

```bash
docker compose run --rm node-toolbox pnpm --filter @gatelm/control-plane-api db:generate
docker compose run --rm node-toolbox pnpm --filter @gatelm/control-plane-api db:migrate
```

If your local `gatelm` database already contains older P0 tables, Prisma may report drift.
Do not reset the shared local database unless you intentionally want to delete local data.
For a clean Control Plane schema check, use a fresh database or reset the Docker volume deliberately.

Seed demo data:

```bash
docker compose run --rm node-toolbox pnpm --filter @gatelm/control-plane-api db:seed
```

The seed is idempotent. It prepares the fixed demo Tenant, Project,
Application, Mock Provider, API Key, App Token, and one active Runtime Config
(`runtime_config_v1_demo_001`) for Gateway demo readiness.

Run the API:

```bash
docker compose run --rm --service-ports node-toolbox pnpm --filter @gatelm/control-plane-api dev
```

Health check:

```bash
curl http://localhost:3001/healthz
```

Expected response:

```json
{"status":"ok"}
```
