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

Keep app service image tags aligned. Do not upgrade only one of `web`, `control-plane-api`, `gateway-core`, or `ai-service` unless GateLM support explicitly tells you to.

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

If pull fails, check:

- `GATELM_IMAGE_REGISTRY`
- `GATELM_IMAGE_TAG`
- registry login state
- outbound network access from the server

## 5. Restart The Stack

```bash
docker compose --env-file .env up -d
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

## Rollback

If the upgrade fails before migrations changed production data:

1. Set `GATELM_IMAGE_TAG` back to the previous version.
2. Pull the previous images.
3. Restart the stack.
4. Run smoke test.

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
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
