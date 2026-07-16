# GateLM Self-host Troubleshooting

This guide lists common self-host installation and operations issues.

Run commands from:

```bash
deploy/selfhost
```

## First Checks

Start with:

```bash
docker compose --env-file .env ps
bash scripts/smoke-test.sh
```

View recent logs:

```bash
docker compose --env-file .env logs --tail=100 gateway-core
docker compose --env-file .env logs --tail=100 control-plane-api
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml logs --tail=100 rag-worker chat-api chat-web
docker compose --env-file .env logs --tail=100 postgres
docker compose --env-file .env logs --tail=100 redis
```

Before sharing logs, remove secrets, Authorization headers, provider keys, API keys, app tokens, raw prompts, raw responses, and provider raw error bodies.

## `docker: command not found`

Cause:

Docker is not installed or not on `PATH`.

Fix:

1. Install Docker Engine or Docker Desktop.
2. Open a new terminal.
3. Run:

```bash
docker version
docker compose version
```

## `Docker daemon is not reachable`

Cause:

Docker is installed, but the daemon is not running.

Fix:

- Start Docker Desktop, or
- Start the Docker service on Linux, then rerun:

```bash
bash scripts/install.sh
```

## `pull access denied` Or Registry Auth Failure

Cause:

The server is not logged into the image registry, or `.env` points to the wrong registry/tag.

Fix:

```bash
docker login <registry-host>
docker compose --env-file .env pull
```

Check:

```text
GATELM_IMAGE_REGISTRY
GATELM_IMAGE_TAG
```

## Port Already In Use

Cause:

Another process is using one of the host ports.

Default ports:

| Variable | Default |
|---|---|
| `SELFHOST_WEB_PORT` | `3000` |
| `SELFHOST_CONTROL_PLANE_PORT` | `3001` |
| `SELFHOST_CHAT_WEB_PORT` | `3002` |
| `SELFHOST_GATEWAY_PORT` | `8080` |
| `SELFHOST_AI_SERVICE_PORT` | `8001` |
| `SELFHOST_POSTGRES_PORT` | `5432` |
| `SELFHOST_REDIS_PORT` | `6379` |
| `SELFHOST_MOCK_PROVIDER_PORT` | `8090` |

Fix:

1. Edit `.env`.
2. Change the conflicting `SELFHOST_*_PORT`.
3. Restart:

```bash
docker compose --env-file .env up -d
```

## `.env file was not found`

Cause:

The scripts expect `.env` in `deploy/selfhost`.

Fix:

```bash
cp .env.example .env
```

Then edit `.env` and rerun the script.

## Placeholder Secret Warnings

Cause:

Values such as `replace-me-*` are still present in `.env`.

Fix:

Replace at least:

```text
POSTGRES_PASSWORD
GATEWAY_EXACT_CACHE_KEY_SECRET
GATELM_DEMO_API_KEY
GATELM_DEMO_APP_TOKEN
```

Keep demo UUID values unchanged for the current MVP unless you also customize the seed path.

## PostgreSQL Did Not Become Ready

Cause:

PostgreSQL is still starting, the volume is unhealthy, or credentials/database values are wrong.

Fix:

```bash
docker compose --env-file .env ps postgres
docker compose --env-file .env logs --tail=100 postgres
```

Check `.env`:

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
SELFHOST_POSTGRES_PORT
```

Do not delete the PostgreSQL volume unless you intentionally want to discard local data.

## Migration Failed

Cause:

Common causes:

- PostgreSQL is not healthy
- app image was not pulled
- database credentials are wrong
- database schema is partially initialized from an earlier failed attempt

Fix:

```bash
docker compose --env-file .env up -d postgres
bash scripts/migrate.sh
```

If it still fails, inspect:

```bash
docker compose --env-file .env logs --tail=100 postgres
docker compose --env-file .env logs --tail=100 control-plane-api
```

Do not create runtime resources until migrations pass.

## Runtime Resources Missing

Cause:

Common causes:

- `migrate.sh` was not run first
- tenant/project/application setup has not been completed
- no Gateway API key has been issued for the runtime project
- no active RuntimeSnapshot has been published

Fix:

1. Run `bash scripts/migrate.sh`.
2. Create a real tenant, project, application, Gateway API key, provider connection, and published RuntimeSnapshot through the Console or admin API.
3. Set `GATELM_GATEWAY_API_KEY` in `.env` to the project Gateway API key and recreate `web`.

`scripts/seed.sh` is disabled for self-host/prod-like deployments.

## Smoke Test Gateway Request Failed

Cause:

Common causes:

- Gateway is not ready
- no active RuntimeSnapshot is published
- API key or app token in `.env` does not match the running Gateway container
- mock-provider is not healthy

Fix:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 gateway-core
docker compose --env-file .env logs --tail=100 mock-provider
bash scripts/smoke-test.sh
```

Do not print or share the smoke test request body or response body.

## Request Log Was Not Found

Cause:

The Gateway request succeeded, but the log write or log query path failed.

Common causes:

- Gateway runtime migration was not applied
- Gateway cannot reach PostgreSQL
- log write is delayed during startup

Fix:

```bash
bash scripts/migrate.sh
docker compose --env-file .env restart gateway-core
bash scripts/smoke-test.sh
```

Check PostgreSQL logs if the problem repeats.

## Web Console Does Not Load

Cause:

Common causes:

- web service is not running
- `GATELM_PUBLIC_BASE_URL` is wrong
- reverse proxy routing is missing

Fix:

```bash
docker compose --env-file .env ps web
docker compose --env-file .env logs --tail=100 web
```

For local install, open:

```text
http://localhost:3000
```

For production, make sure TLS and host routing point to the Web Console port.

## Control Plane `/readyz` Fails

Cause:

Control Plane cannot reach one of its dependencies, usually PostgreSQL.

Fix:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 control-plane-api
docker compose --env-file .env logs --tail=100 postgres
```

Then rerun:

```bash
bash scripts/migrate.sh
```

## Gateway `/readyz` Fails

Cause:

Gateway dependency readiness failed.

Check:

- `control-plane-api`
- `postgres`
- `redis`
- `mock-provider`

Fix:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 gateway-core
```

Then run:

```bash
bash scripts/smoke-test.sh
```

## Tenant Chat Or RAG Worker Does Not Become Ready

Cause:

Common causes:

- one or more role-specific files under `.secrets/tenant-chat` or `.secrets/rag` are missing, empty, symlinked, or have unsafe Linux ownership or permissions
- a configured active signing key ID does not match the corresponding private key or JWKS document
- `rag-worker` cannot reach the private Gateway or AI Service endpoint
- `TENANT_CHAT_RAG_ENABLED=true` is configured without a real S3 bucket, region, KMS key, or workload identity
- PostgreSQL migrations have not completed

Fix:

Run the idempotent installer again so that its configuration and secret-file preflight runs before recreating the services:

```bash
bash scripts/install.sh
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml ps rag-worker chat-api chat-web gateway-core ai-service
docker compose --env-file .env -f docker-compose.yml -f docker-compose.rag.yml logs --tail=100 rag-worker chat-api chat-web gateway-core ai-service
bash scripts/smoke-test.sh
```

Do not copy a query signer, worker signer, verification JWKS, binding, or wrapping-key projection into another role just to make a service start. Restore the role-specific file and configuration described in `docs/install.md`.

## Need A Clean Local Retry

For a non-production local retry, you can stop the stack:

```bash
docker compose --env-file .env down
```

This keeps named volumes. If you need to reset data, create a backup first and follow your team's data deletion policy.
