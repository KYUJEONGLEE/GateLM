#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

MIGRATIONS_DIR="${SELFHOST_DIR}/migrations"

gatelm_log "Starting GateLM self-host database migration."
gatelm_load_env
gatelm_require_env_vars \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB
gatelm_check_docker
gatelm_validate_compose

gatelm_log "Ensuring PostgreSQL is running."
if ! gatelm_compose up -d postgres; then
  gatelm_fail "PostgreSQL could not be started. Check the postgres service logs before retrying."
fi
gatelm_wait_for_postgres

gatelm_log "Applying Control Plane Prisma migrations."
if ! gatelm_compose run --rm --no-deps control-plane-api ./node_modules/.bin/prisma migrate deploy >/dev/null 2>&1; then
  gatelm_fail "Control Plane migration failed. Make sure the images were pulled with install.sh and PostgreSQL is healthy. Command output is hidden to avoid printing secrets."
fi

gatelm_require_file \
  "${MIGRATIONS_DIR}/001_gateway_runtime_tables.sql" \
  "Gateway runtime migration file is missing from deploy/selfhost/migrations. Re-download the self-host bundle."

for migration in "${MIGRATIONS_DIR}"/*.sql; do
  [[ -f "${migration}" ]] || continue
  gatelm_log "Applying Gateway runtime migration: $(basename "${migration}")"
  if ! gatelm_compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -q < "${migration}" >/dev/null 2>&1; then
    gatelm_fail "Gateway runtime migration failed at $(basename "${migration}"). The database may be partially initialized; check PostgreSQL logs, then retry this script."
  fi
done

gatelm_log "Database migration finished. Next run: bash scripts/seed.sh"
