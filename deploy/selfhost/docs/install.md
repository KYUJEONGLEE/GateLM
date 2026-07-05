# GateLM Self-host Install Guide

Status: draft. This guide describes the intended customer-managed single-node Docker Compose path, but `v0.1.0` does not declare self-hosting as a verified production support path.

Run all commands from:

```bash
deploy/selfhost
```

## What You Install

The self-host bundle runs:

| Service | Image |
|---|---|
| Web Console | `gatelm/web:<published-release-tag>` |
| Control Plane API | `gatelm/control-plane-api:<published-release-tag>` |
| Gateway Core | `gatelm/gateway-core:<published-release-tag>` |
| AI Service | `gatelm/ai-service:<published-release-tag>` |
| PostgreSQL | `postgres:16` |
| Redis | `redis:7-alpine` |
| Mock Provider | `python:3.12-alpine` |

The app images are pulled from a registry. Customers do not need to build source code.

## Prerequisites

- Linux server, macOS, or Windows with Docker Desktop
- Docker Engine with Docker Compose v2
- `bash`
- `curl`
- Access to the image registry that hosts `gatelm/<service>:<published-release-tag>`

Check Docker:

```bash
docker version
docker compose version
```

## 1. Registry Login

If your registry requires authentication, login before running install:

```bash
docker login <registry-host>
```

Examples:

```bash
docker login ghcr.io
docker login registry.example.com
```

Do not paste registry passwords, provider keys, API keys, app tokens, or Authorization headers into support tickets or shared logs.

## 2. Create `.env`

Copy the example file:

```bash
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` before production exposure.

Minimum values to review:

| Variable | Purpose |
|---|---|
| `GATELM_IMAGE_REGISTRY` | Image registry namespace, default `gatelm` |
| `GATELM_IMAGE_TAG` | Image version. The draft `.env.example` uses `unpublished-draft`; replace it with a published release image tag after images exist. |
| `GATELM_PUBLIC_DOMAIN` | Public hostname |
| `GATELM_PUBLIC_BASE_URL` | Public Web Console base URL |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | PostgreSQL database name |
| `GATEWAY_EXACT_CACHE_KEY_SECRET` | Secret used for exact cache key derivation |
| `GATELM_DEMO_API_KEY` | Demo Gateway API key for the MVP path |
| `GATELM_DEMO_APP_TOKEN` | Demo app token for the MVP path |

For the current MVP, keep the demo UUID values unchanged unless you also customize the seed path:

```text
GATELM_DEMO_TENANT_ID
GATELM_DEMO_PROJECT_ID
GATELM_DEMO_APPLICATION_ID
GATELM_DEMO_API_KEY_ID
GATELM_DEMO_APP_TOKEN_ID
```

## 3. Pull And Start

Use the install script:

```bash
bash scripts/install.sh
```

What it does:

- checks `.env`
- checks Docker and Compose
- warns if placeholder secrets remain
- pulls images
- starts the Compose stack

Manual equivalent:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

Use the script for normal installs because it gives safer beginner-friendly error messages.

## 4. Run Migrations

Run:

```bash
bash scripts/migrate.sh
```

This applies:

- Control Plane Prisma migrations
- Gateway runtime SQL in `deploy/selfhost/migrations/`

If migration fails, do not run seed yet. Fix the migration issue first.

## 5. Seed The Demo Runtime

Run:

```bash
bash scripts/seed.sh
```

This creates the first demo:

- tenant
- project
- application
- Gateway credential metadata
- provider configuration
- active RuntimeSnapshot pointer

The seed path stores credential hashes and previews, not plaintext secrets.

## 6. Smoke Test

Run:

```bash
bash scripts/smoke-test.sh
```

The smoke test checks:

- PostgreSQL readiness
- Redis readiness
- service health endpoints
- one Gateway `/v1/chat/completions` request
- Request Log lookup for that request

The script does not print request body, response body, Authorization header, API key, app token, provider key, or raw model output.

## 7. Open The Services

Default local URLs:

| Surface | URL |
|---|---|
| Web Console | `http://localhost:3000` |
| Control Plane API | `http://localhost:3001` |
| Gateway Core | `http://localhost:8080` |
| AI Service | `http://localhost:8001` |
| Mock Provider | `http://localhost:8090` |

For production, put TLS and public routing in front of the stack with your reverse proxy or load balancer.

## 8. Daily Operations

Check service status:

```bash
docker compose --env-file .env ps
```

View logs without sharing secrets:

```bash
docker compose --env-file .env logs --tail=100 gateway-core
docker compose --env-file .env logs --tail=100 control-plane-api
```

Restart one service:

```bash
docker compose --env-file .env restart gateway-core
```

Stop the stack:

```bash
docker compose --env-file .env down
```

Named volumes keep PostgreSQL and Redis data unless explicitly removed.
