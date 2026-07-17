# GateLM Self-host Upgrade Guide

This guide explains how to upgrade a single-node GateLM self-host installation by changing Docker image tags and running migrations.

Run all commands from:

```bash
deploy/selfhost
```

## Upgrade Rule

Use this order:

1. Read release notes for the target version.
2. Backup PostgreSQL.
3. Update `GATELM_IMAGE_TAG`.
4. Pull images.
5. Restart services.
6. Run migrations.
7. Run smoke test.

Do not skip the backup step for production data.

If optional PII models are enabled, read the target release notes for its model
release id and obtain a fresh approved HTTPS bundle URL before restarting. Keep
at least 4 GiB of temporary free space. Model release descriptors are pinned to
the matching AI Service image and Self-host Compose bundle; do not override
their hashes in `.env`.

## 1. Backup First

Create a PostgreSQL backup before changing images:

```bash
bash scripts/smoke-test.sh
mkdir -p backups
docker compose --env-file .env exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/gatelm-before-upgrade.dump
```

The backup file may contain customer metadata and request log metadata. Store it in your approved backup location.

## 2. Update Image Tag

Edit `.env`:

```text
GATELM_IMAGE_TAG=2.1.0
```

Change it to the target version:

```text
GATELM_IMAGE_TAG=<target-version>
```

Keep app service image tags aligned. Do not upgrade only one of `web`,
`control-plane-api`/`rag-worker`, `gateway-core`, `ai-service`, `chat-api`, or
`chat-web` unless GateLM support explicitly tells you to.

## 3. Registry Login

If the new image tag is in a private registry, login again:

```bash
docker login <registry-host>
```

Do not put registry passwords or tokens in `.env`.

## 4. Pull New Images

```bash
docker compose --env-file .env pull
```

If RAG is enabled, include `-f docker-compose.yml -f docker-compose.rag.yml`,
or use `bash scripts/install.sh` as described below so the overlay and secret
preflight are selected automatically.

If pull fails, check:

- `GATELM_IMAGE_REGISTRY`
- `GATELM_IMAGE_TAG`
- registry login state
- outbound network access from the server

## 5. Restart The Stack

If the target release uses a new PII model bundle, edit the existing secret file
with a fresh presigned HTTPS URL. Never put that URL in `.env` or a command
argument. The previous versioned model directory remains in `pii_model_data`
for rollback until an operator deliberately removes it.
Use the idempotent installer. It preserves the base non-RAG service set when
the flag is false; when the flag is true it validates role-separated Tenant
Chat/RAG secrets and includes `rag-worker`, `chat-api`, and `chat-web`:

```bash
bash scripts/install.sh
docker compose --env-file .env ps
```

Wait until PostgreSQL and Redis are healthy before continuing.

## 6. Run Migrations

```bash
bash scripts/migrate.sh
```

Migration must be run after the target image version is available. If migration fails, stop and review logs before serving traffic.

## 7. Run Smoke Test

```bash
bash scripts/smoke-test.sh
```

Upgrade is complete only after the smoke test confirms:

- health endpoints are reachable
- Gateway request succeeds
- Request Log contains the smoke request

When PII models are enabled, also run:

```bash
bash scripts/pii-model-smoke.sh
```

## Rollback

If the upgrade fails before migrations changed production data:

1. Set `GATELM_IMAGE_TAG` back to the previous version.
2. Pull the previous images.
3. Restart the stack.
4. Run smoke test.

```bash
bash scripts/install.sh
bash scripts/smoke-test.sh
```

If migrations ran and the application is not healthy, restore from the backup created before the upgrade. See `backup-restore.md`.

## Version Compatibility

For v2.1.0 MVP:

- single-node Docker Compose is the supported self-host shape
- PostgreSQL is the source of truth for Control Plane and Gateway logs
- Redis is used by Gateway runtime features
- source-code builds are not required on customer servers

Keep `docker-compose.yml`, scripts, migrations, and image tags from the same release bundle.
