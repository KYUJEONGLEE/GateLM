# GateLM Self-host Backup And Restore

Status: draft. This guide covers PostgreSQL backup and restore for the intended self-host Docker Compose bundle. `v0.1.0` does not declare self-hosting as a verified production support path.

Run all commands from:

```bash
deploy/selfhost
```

## What To Backup

Back up PostgreSQL for:

- tenants, projects, applications
- provider configuration metadata
- RuntimeConfig and RuntimeSnapshot records
- Gateway credential metadata and hashes
- Request Log and dashboard source data
- Gateway rate limit counters

Redis is runtime cache/state. For the current draft, PostgreSQL is the critical durable backup target.

## Before You Start

Confirm the stack is running:

```bash
docker compose --env-file .env ps
```

Confirm PostgreSQL is reachable:

```bash
docker compose --env-file .env exec -T postgres pg_isready -U "$(grep '^POSTGRES_USER=' .env | cut -d= -f2-)" -d "$(grep '^POSTGRES_DB=' .env | cut -d= -f2-)"
```

If this command is awkward in your shell, `bash scripts/smoke-test.sh` is the easier full readiness check.

## Create A Backup

Create a backups directory:

```bash
mkdir -p backups
```

Create a compressed custom-format PostgreSQL dump:

```bash
docker compose --env-file .env exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/gatelm-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Verify the file is not empty:

```bash
ls -lh backups/
```

Store backups in your approved secure backup system. Backup files may contain customer metadata, request log metadata, hashes, and configuration data.

## Restore Into A Fresh Database

Restore is safest into a fresh PostgreSQL volume or a new server.

1. Stop app services so they do not write during restore:

```bash
docker compose --env-file .env stop web gateway-core control-plane-api ai-service
```

2. Start PostgreSQL:

```bash
docker compose --env-file .env up -d postgres
```

3. Restore the backup:

```bash
docker compose --env-file .env exec -T postgres sh -lc 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < backups/<backup-file>.dump
```

4. Start the stack:

```bash
docker compose --env-file .env up -d
```

5. Run migrations for the current image version:

```bash
bash scripts/migrate.sh
```

6. Run smoke test:

```bash
bash scripts/smoke-test.sh
```

## Restore Notes

- Restore replaces database objects in the target database.
- Use the same or newer compatible GateLM release bundle after restore.
- Keep `.env` values consistent with the restored database.
- Do not share backup files through email or chat.
- Do not paste provider keys, API keys, app tokens, Authorization headers, raw prompts, or raw responses into incident notes.

## Scheduled Backups

For production, schedule the backup command with your platform scheduler, for example cron or a managed backup runner.

Recommended baseline:

- daily PostgreSQL backup
- backup before every image tag upgrade
- backup retention aligned with your company policy
- periodic restore test in a non-production environment

Example cron command wrapper:

```bash
cd /opt/gatelm/deploy/selfhost
mkdir -p backups
docker compose --env-file .env exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/gatelm-$(date -u +%Y%m%dT%H%M%SZ).dump
```

## Checking Backup Health

List dump contents without restoring:

```bash
docker compose --env-file .env exec -T postgres sh -lc 'pg_restore --list' < backups/<backup-file>.dump
```

If the command fails, treat the backup as invalid and create a new one.
