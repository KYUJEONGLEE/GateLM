# GateLM Control Plane API

NestJS workspace for 재혁님's Control Plane and Runtime Policy scope.

## Scope

- Project, Application, Provider Connection
- API Key and App Token lifecycle
- Active Runtime Config publishing
- Gateway-facing runtime config shape

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
