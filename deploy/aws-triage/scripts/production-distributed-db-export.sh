#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '%s\n' "[GateLM production DB export] $*"
}

fail() {
  printf '%s\n' "[GateLM production DB export] ERROR: $*" >&2
  exit 1
}

bucket=""
kms_key_id=""
object_key=""
source_sha=""
source_checkout="/home/ubuntu/GateLM"

while (( $# > 0 )); do
  case "$1" in
    --bucket) bucket="${2:-}"; shift 2 ;;
    --kms-key-id) kms_key_id="${2:-}"; shift 2 ;;
    --object-key) object_key="${2:-}"; shift 2 ;;
    --source-sha) source_sha="${2:-}"; shift 2 ;;
    --source-checkout) source_checkout="${2:-}"; shift 2 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

[[ "${bucket}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || fail "A valid --bucket is required."
[[ -n "${kms_key_id}" ]] || fail "--kms-key-id is required."
[[ "${object_key}" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$ ]] || fail "A safe --object-key is required."
[[ "${source_sha}" =~ ^[a-f0-9]{40}$ ]] || fail "--source-sha must be a full lowercase Git SHA."
command -v aws >/dev/null 2>&1 || fail "AWS CLI is required."
command -v docker >/dev/null 2>&1 || fail "Docker is required."

actual_sha="$(git -c safe.directory="${source_checkout}" -C "${source_checkout}" rev-parse HEAD 2>/dev/null || true)"
[[ "${actual_sha}" == "${source_sha}" ]] || fail "Source checkout ${actual_sha:-missing} does not match ${source_sha}."

mapfile -t postgres_containers < <(docker ps -q --filter label=com.docker.compose.service=postgres)
(( ${#postgres_containers[@]} == 1 )) || fail "Expected exactly one running Compose postgres container."
postgres_container="${postgres_containers[0]}"
postgres_image="$(docker inspect --format '{{.Config.Image}}' "${postgres_container}")"
[[ "${postgres_image}" == pgvector/pgvector:0.8.5-pg16-trixie* ]] || \
  fail "Unexpected production PostgreSQL image: ${postgres_image}"

work_dir="$(mktemp -d /var/tmp/gatelm-production-db-export.XXXXXX)"
dump_path="${work_dir}/production.dump"
trap 'rm -rf -- "${work_dir}"' EXIT

log "Creating an online custom-format dump from the running production database."
docker exec "${postgres_container}" sh -lc \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "${dump_path}"
docker exec -i "${postgres_container}" pg_restore --list < "${dump_path}" >/dev/null

dump_sha256="$(sha256sum "${dump_path}" | awk '{print $1}')"
table_count="$(docker exec "${postgres_container}" sh -lc \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname = '\''public'\'';"')"
migration_count="$(docker exec "${postgres_container}" sh -lc \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT count(*) FROM \"_prisma_migrations\";"')"
vector_enabled="$(docker exec "${postgres_container}" sh -lc \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = '\''vector'\'');"')"
[[ "${table_count}" =~ ^[0-9]+$ ]] || fail "Could not measure the source public table count."
[[ "${migration_count}" =~ ^[0-9]+$ ]] || fail "Could not measure the source migration count."
[[ "${vector_enabled}" == "t" ]] || fail "The source database does not have pgvector enabled."

log "Uploading the dump with KMS encryption and integrity metadata."
aws s3 cp "${dump_path}" "s3://${bucket}/${object_key}" \
  --sse aws:kms \
  --sse-kms-key-id "${kms_key_id}" \
  --metadata "sha256=${dump_sha256},source-sha=${source_sha},table-count=${table_count},migration-count=${migration_count},vector-enabled=true" \
  --only-show-errors

remote_sha256="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata.sha256' --output text)"
remote_source_sha="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'Metadata."source-sha"' --output text)"
remote_encryption="$(aws s3api head-object --bucket "${bucket}" --key "${object_key}" --query 'ServerSideEncryption' --output text)"
[[ "${remote_sha256}" == "${dump_sha256}" ]] || fail "Uploaded dump checksum metadata does not match."
[[ "${remote_source_sha}" == "${source_sha}" ]] || fail "Uploaded dump source SHA metadata does not match."
[[ "${remote_encryption}" == "aws:kms" ]] || fail "Uploaded dump is not KMS encrypted."

log "Export complete: s3://${bucket}/${object_key}"
log "Dump SHA-256: ${dump_sha256}"
log "Source verification: ${table_count} public tables, ${migration_count} Prisma migrations, pgvector enabled."
