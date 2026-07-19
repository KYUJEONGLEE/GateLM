#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/production-distributed-lib.sh
source "${SCRIPT_DIR}/production-distributed-lib.sh"

bucket=""
kms_key_id=""
object_key=""
while (( $# > 0 )); do
  case "$1" in
    --bucket) bucket="${2:-}"; shift 2 ;;
    --kms-key-id) kms_key_id="${2:-}"; shift 2 ;;
    --object-key) object_key="${2:-}"; shift 2 ;;
    *) production_fail "Unknown option: $1" ;;
  esac
done

[[ "${bucket}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || production_fail "A valid --bucket is required."
[[ -n "${kms_key_id}" ]] || production_fail "--kms-key-id is required."
[[ "${object_key}" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$ ]] || production_fail "A safe --object-key is required."

perf_check_docker
production_load_env
production_validate_env
production_assert_role_host data
production_require_active_env data POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
command -v aws >/dev/null 2>&1 || production_fail "AWS CLI is required."
aws sts get-caller-identity --output text --query Account >/dev/null

remote_sha256="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata.sha256' --output text)"
remote_source_sha="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata."source-sha"' --output text)"
remote_table_count="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata."table-count"' --output text)"
remote_migration_count="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata."migration-count"' --output text)"
remote_vector_enabled="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata."vector-enabled"' --output text)"
remote_encryption="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'ServerSideEncryption' --output text)"
remote_kms_key_id="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'SSEKMSKeyId' --output text)"

[[ "${remote_sha256}" =~ ^[a-f0-9]{64}$ ]] || production_fail "Dump SHA-256 metadata is missing or invalid."
[[ "${remote_source_sha}" == "${GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA}" ]] || \
  production_fail "Dump source SHA ${remote_source_sha} does not match ${GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA}."
[[ "${remote_table_count}" =~ ^[0-9]+$ ]] || production_fail "Source table-count metadata is invalid."
[[ "${remote_migration_count}" =~ ^[0-9]+$ ]] || production_fail "Source migration-count metadata is invalid."
[[ "${remote_vector_enabled}" == "true" ]] || production_fail "Source pgvector metadata is invalid."
[[ "${remote_encryption}" == "aws:kms" ]] || production_fail "Dump object is not KMS encrypted."
[[ "${remote_kms_key_id}" == "${kms_key_id}" ]] || production_fail "Dump object uses an unexpected KMS key."

if docker volume inspect "${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}" >/dev/null 2>&1; then
  production_fail "Target volume already exists; refusing to overwrite ${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}."
fi
[[ ! -e "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}" ]] || \
  production_fail "Restore attestation already exists; refusing to replace it."

work_dir="$(mktemp -d /var/tmp/gatelm-production-db-restore.XXXXXX)"
dump_path="${work_dir}/production.dump"
restore_container="gatelm-production-distributed-db-restore"
cleanup() {
  docker rm -f "${restore_container}" >/dev/null 2>&1 || true
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

production_log "Downloading and verifying the KMS-encrypted production dump."
aws s3 cp "s3://${bucket}/${object_key}" "${dump_path}" --only-show-errors
actual_sha256="$(sha256sum "${dump_path}" | awk '{print $1}')"
[[ "${actual_sha256}" == "${remote_sha256}" ]] || production_fail "Downloaded dump checksum does not match."

postgres_image='pgvector/pgvector:0.8.5-pg16-trixie@sha256:073acab878025cadf03fe6fed01babaaa285b8d09ddc9c43882cf02d409546d7'
docker run --rm -i "${postgres_image}" pg_restore --list < "${dump_path}" >/dev/null
docker volume create "${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}" >/dev/null

production_log "Restoring into the new isolated Docker volume ${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}."
docker run -d \
  --name "${restore_container}" \
  --network none \
  --env POSTGRES_USER \
  --env POSTGRES_PASSWORD \
  --env POSTGRES_DB \
  --volume "${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}:/var/lib/postgresql/data" \
  "${postgres_image}" >/dev/null

ready=false
for _ in $(seq 1 60); do
  if docker exec "${restore_container}" sh -lc 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "${ready}" == "true" ]] || production_fail "Temporary restore PostgreSQL did not become ready."

docker exec -i "${restore_container}" sh -lc \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error' < "${dump_path}"

restored_table_count="$(docker exec "${restore_container}" sh -lc \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\'';"')"
restored_migration_count="$(docker exec "${restore_container}" sh -lc \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM \"_prisma_migrations\";"')"
restored_vector_enabled="$(docker exec "${restore_container}" sh -lc \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = '\''vector'\'');"')"
[[ "${restored_table_count}" == "${remote_table_count}" ]] || \
  production_fail "Table count mismatch: source=${remote_table_count}, restored=${restored_table_count}."
[[ "${restored_migration_count}" == "${remote_migration_count}" ]] || \
  production_fail "Migration count mismatch: source=${remote_migration_count}, restored=${restored_migration_count}."
[[ "${restored_vector_enabled}" == "t" ]] || production_fail "Restored pgvector extension is missing."

install -d -m 700 "${PRODUCTION_DISTRIBUTED_STATE_DIR}"
attestation_tmp="${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}.tmp"
umask 077
{
  printf 'GATELM_PRODUCTION_DISTRIBUTED_DUMP_SHA256=%s\n' "${actual_sha256}"
  printf 'GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME=%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}"
  printf 'GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA=%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA}"
  printf 'GATELM_PRODUCTION_DISTRIBUTED_PUBLIC_TABLE_COUNT=%s\n' "${restored_table_count}"
  printf 'GATELM_PRODUCTION_DISTRIBUTED_PRISMA_MIGRATION_COUNT=%s\n' "${restored_migration_count}"
} > "${attestation_tmp}"
chmod 600 "${attestation_tmp}"
mv "${attestation_tmp}" "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}"

production_log "Database restore verified: ${restored_table_count} public tables, ${restored_migration_count} Prisma migrations, pgvector enabled."
production_log "Restore attestation created for dump ${actual_sha256}."
