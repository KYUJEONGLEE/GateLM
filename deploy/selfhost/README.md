# GateLM Self-host Compose Bundle

This bundle is the v2.1.0 single-node Docker Compose path.

It runs these services:

| Service | Image |
|---|---|
| Web Console | `gatelm/web:2.1.0` |
| Control Plane API | `gatelm/control-plane-api:2.1.0` |
| Gateway Core | `gatelm/gateway-core:2.1.0` |
| AI Service | `gatelm/ai-service:2.1.0` |
| PostgreSQL | `postgres:16` |
| Redis | `redis:7-alpine` |
| Mock Provider | `python:3.12-alpine` |

The app services use `image:` references only. Customers do not need to build from source or mount the source repository.

## Quick Start

Run from `deploy/selfhost`:

```powershell
Copy-Item .env.example .env
bash scripts/install.sh
bash scripts/migrate.sh
bash scripts/smoke-test.sh
```

On Linux or macOS:

```bash
cp .env.example .env
bash scripts/install.sh
bash scripts/migrate.sh
bash scripts/smoke-test.sh
```

Before exposing the stack, edit `.env` and replace placeholder secret values. Keep runtime credentials in `.env` or a customer-managed secret system. Do not bake them into images.

If your shell says `permission denied`, keep using the explicit `bash scripts/<name>.sh` form. The scripts intentionally avoid printing secret values, request bodies, and response bodies.

Before running smoke tests, create a real tenant, project, application, Gateway API key, provider connection, and published RuntimeSnapshot through the Console or admin API. Demo seed is disabled for self-host/prod-like deployments.

## URLs

Default local ports:

| Surface | URL |
|---|---|
| Web Console | `http://localhost:3000` |
| Control Plane API | `http://localhost:3001` |
| Gateway Core | `http://localhost:8080` |
| AI Service | `http://localhost:8001` |
| Mock Provider | `http://localhost:8090` |

Production deployments should route public traffic through a reverse proxy and TLS. Internal service-to-service traffic uses Compose service names such as `control-plane-api`, `gateway-core`, `postgres`, and `redis`.

## Configuration

`.env` controls:

- image registry and tag
- public domain/base URL
- host port bindings
- PostgreSQL database settings
- Redis connection through Compose service name
- Gateway cache and rate limit settings
- provider mode, defaulting to mock mode
- AI Service mode

PostgreSQL and Redis use named volumes:

```text
postgres_data
redis_data
```

## Health Checks

The Compose file includes health checks for all services:

- PostgreSQL readiness through `pg_isready`
- Redis readiness through `redis-cli ping`
- Web Console HTTP response
- Control Plane `/healthz`
- Gateway process liveness
- AI Service `/healthz`
- Mock Provider `/healthz`

The full Gateway `/healthz`, `/readyz`, request, and Request Log smoke path is handled by:

```bash
bash scripts/smoke-test.sh
```

## Script Steps

| Step | Script | What it does |
|---|---|---|
| 1 | `scripts/install.sh` | validates `.env`, pulls images, and starts the Compose stack |
| 2 | `scripts/migrate.sh` | runs Control Plane Prisma migrations and Gateway runtime table SQL |
| 3 | `scripts/smoke-test.sh` | checks health endpoints, sends one Gateway request, and verifies the Request Log after real runtime resources exist |

The Gateway runtime SQL lives in:

```text
deploy/selfhost/migrations/
```

Run the scripts from `deploy/selfhost`. They use `.env` for configuration and do not require customers to build source code.

## Operations Docs

Detailed operating guides:

- `docs/install.md`
- `docs/upgrade.md`
- `docs/backup-restore.md`
- `docs/troubleshooting.md`
