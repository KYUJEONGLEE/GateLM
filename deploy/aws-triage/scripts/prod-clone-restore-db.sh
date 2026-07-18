#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

dump_path=""
sha256_path=""
while (( $# > 0 )); do
  case "$1" in
    --dump)
      [[ $# -ge 2 ]] || clone_fail "--dump requires a custom-format pg_dump path."
      dump_path="$2"
      shift 2
      ;;
    --sha256-file)
      [[ $# -ge 2 ]] || clone_fail "--sha256-file requires a path."
      sha256_path="$2"
      shift 2
      ;;
    *) clone_fail "Unknown option: $1" ;;
  esac
done

[[ -f "${dump_path}" && ! -L "${dump_path}" ]] || clone_fail "Dump file is missing or is a symlink."
[[ -f "${sha256_path}" && ! -L "${sha256_path}" ]] || clone_fail "SHA-256 file is missing or is a symlink."

perf_check_docker
clone_load_env
clone_validate_env
clone_assert_role_host data

expected_sha="$(awk 'NR == 1 {print $1}' "${sha256_path}")"
[[ "${expected_sha}" =~ ^[a-f0-9]{64}$ ]] || clone_fail "SHA-256 file does not contain a valid digest."
actual_sha="$(sha256sum "${dump_path}" | awk '{print $1}')"
[[ "${actual_sha}" == "${expected_sha}" ]] || clone_fail "Database dump SHA-256 mismatch."

if docker volume inspect "${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME}" >/dev/null 2>&1; then
  clone_fail "${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME} already exists. Refusing to overwrite it."
fi
if clone_restore_compose ps -q postgres-restore 2>/dev/null | grep -q .; then
  clone_fail "A production-clone restore container is already present."
fi

docker volume create "${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME}" >/dev/null
restore_started=false
cleanup() {
  if [[ "${restore_started}" == "true" ]]; then
    clone_restore_compose down --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

clone_log "Starting isolated PostgreSQL restore container without host ports."
clone_restore_compose up -d postgres-restore
restore_started=true

container_id="$(clone_restore_compose ps -q postgres-restore)"
[[ -n "${container_id}" ]] || clone_fail "Restore container did not start."
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
  [[ "${status}" == "healthy" ]] && break
  [[ "${status}" == "unhealthy" || "${status}" == "exited" ]] && clone_fail "Restore PostgreSQL became ${status}."
  sleep 2
done
[[ "${status}" == "healthy" ]] || clone_fail "Restore PostgreSQL did not become healthy."

clone_log "Restoring verified custom-format dump into the new encrypted-host volume."
if ! clone_restore_compose exec -T postgres-restore \
  pg_restore \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --no-owner \
    --no-privileges \
    --exit-on-error < "${dump_path}" >/dev/null; then
  clone_fail "pg_restore failed. The new volume was retained for forensic inspection and will not be reused automatically."
fi

migration_count="$(clone_restore_compose exec -T postgres-restore \
  psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" -At \
  -c 'select count(*) from "_prisma_migrations" where finished_at is not null and rolled_back_at is null;')"
[[ "${migration_count}" =~ ^[1-9][0-9]*$ ]] || clone_fail "Restored database has no completed Prisma migrations."

umask 077
mkdir -p "${PROD_CLONE_STATE_DIR}"
tmp_attestation="$(mktemp "${PROD_CLONE_STATE_DIR}/db-restore.XXXXXX")"
printf '%s\n' \
  'GATELM_PROD_CLONE_DB_ATTESTATION_SCHEMA=gatelm.prod-clone-db.v1' \
  "GATELM_PROD_CLONE_DB_SOURCE_SHA=${GATELM_PROD_CLONE_DB_SOURCE_SHA}" \
  "GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME=${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME}" \
  "GATELM_PROD_CLONE_DUMP_SHA256=${actual_sha}" \
  "GATELM_PROD_CLONE_COMPLETED_MIGRATIONS=${migration_count}" \
  "GATELM_PROD_CLONE_RESTORED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "${tmp_attestation}"
chmod 600 "${tmp_attestation}"
mv "${tmp_attestation}" "${PROD_CLONE_DB_ATTESTATION}"

clone_restore_compose down --remove-orphans >/dev/null
restore_started=false
clone_log "Database restore passed (dump_sha256=${actual_sha}, migrations=${migration_count})."
