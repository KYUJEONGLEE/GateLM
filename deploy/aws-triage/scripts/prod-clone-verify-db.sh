#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

offline=false
while (( $# > 0 )); do
  case "$1" in
    --offline)
      offline=true
      shift
      ;;
    *) clone_fail "Unknown option: $1" ;;
  esac
done

perf_check_docker
clone_load_env
clone_validate_env
clone_assert_role_host data
clone_assert_db_attestation

offline_started=false
cleanup() {
  if [[ "${offline_started}" == "true" ]]; then
    clone_restore_compose down --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ "${offline}" == "true" ]]; then
  clone_restore_compose up -d postgres-restore >/dev/null
  offline_started=true
  container_id="$(clone_restore_compose ps -q postgres-restore)"
  for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
    [[ "${status}" == "healthy" ]] && break
    [[ "${status}" == "unhealthy" || "${status}" == "exited" ]] && clone_fail "Offline verification PostgreSQL became ${status}."
    sleep 2
  done
  [[ "${status}" == "healthy" ]] || clone_fail "Offline verification PostgreSQL did not become healthy."
  psql_exec=(clone_restore_compose exec -T postgres-restore)
else
  clone_wait_for_service data postgres
  clone_wait_for_service data redis
  psql_exec=(clone_compose --profile data exec -T postgres)
fi

sql_output="$("${psql_exec[@]}" \
  psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" -At -F '|' <<'SQL'
select 'completed_migrations', count(*) from "_prisma_migrations" where finished_at is not null and rolled_back_at is null
union all select 'failed_migrations', count(*) from "_prisma_migrations" where finished_at is null and rolled_back_at is null
union all select 'tenants', count(*) from tenants
union all select 'projects', count(*) from projects
union all select 'applications', count(*) from applications
union all select 'active_runtime_snapshots', count(*) from active_runtime_snapshots
union all select 'provider_connections', count(*) from provider_connections
union all select 'provider_credentials', count(*) from provider_credentials
union all
select 'provider_connection_' || lower(regexp_replace(provider, '[^a-zA-Z0-9_-]', '_', 'g')), count(*)
from provider_connections
group by 1
union all
select 'application_provider_' || lower(regexp_replace(connection.provider, '[^a-zA-Z0-9_-]', '_', 'g')), count(*)
from application_provider_connections assignment
join provider_connections connection on connection.id = assignment."providerConnectionId"
group by 1
union all select 'model_catalog', count(*) from model_catalog
union all select 'model_pricing_rules', count(*) from model_pricing_rules
union all select 'tenant_chat_conversations', count(*) from tenant_chat_conversations
union all select 'tenant_chat_messages', count(*) from tenant_chat_messages
union all select 'rag_knowledge_bases', count(*) from rag_knowledge_bases
union all select 'rag_documents', count(*) from rag_documents
union all select 'rag_chunks', count(*) from rag_chunks
union all select 'rag_jobs', count(*) from rag_jobs
union all select 'rag_jobs_active', count(*) from rag_jobs where status in ('PENDING', 'RUNNING', 'RETRY_WAIT')
union all
select 'runtime_provider_' || lower(regexp_replace(coalesce(provider_entry->>'provider', 'unknown'), '[^a-zA-Z0-9_-]', '_', 'g')), count(*)
from active_runtime_snapshots active
join runtime_snapshots snapshot on snapshot.id = active."runtimeSnapshotId"
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(snapshot."snapshotBody"->'providers') = 'array'
    then snapshot."snapshotBody"->'providers'
    else '[]'::jsonb
  end
) provider_entry
group by 1
order by 1;
SQL
)"

failed_migrations="$(awk -F '|' '$1 == "failed_migrations" {print $2}' <<< "${sql_output}")"
active_snapshots="$(awk -F '|' '$1 == "active_runtime_snapshots" {print $2}' <<< "${sql_output}")"
[[ "${failed_migrations}" == "0" ]] || clone_fail "The restored database has ${failed_migrations} failed/incomplete migrations."
[[ "${active_snapshots}" =~ ^[1-9][0-9]*$ ]] || clone_fail "No active RuntimeSnapshot was restored."

printf '%s\n' "${sql_output}"
if [[ "${offline}" == "false" ]]; then
  redis_keys="$(clone_compose --profile data exec -T redis redis-cli DBSIZE | tr -d '[:space:]')"
  [[ "${redis_keys}" =~ ^[0-9]+$ ]] || clone_fail "Redis DBSIZE did not return an integer."
  printf '%s\n' "redis_keys|${redis_keys}"

  clone_wait_for_service data control-plane-api
  control_plane_id="$(clone_compose --profile data ps -q control-plane-api)"
  credential_output="$(docker exec -i "${control_plane_id}" node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const {
  decryptProviderCredential,
} = require('./dist/src/common/security/provider-credential-encryption.js');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.providerCredential.findMany({
    select: {
      credentialRefId: true,
      encryptedValue: true,
      encryptionNonce: true,
      encryptionTag: true,
      encryptionKeyVersion: true,
    },
  });

  for (const row of rows) {
    let plaintext = decryptProviderCredential(row);
    if (typeof plaintext !== 'string' || plaintext.trim().length === 0) {
      throw new Error('empty_provider_credential');
    }
    plaintext = '';
  }
  process.stdout.write(`provider_credentials_decrypted|${rows.length}\n`);
}

main()
  .catch(() => {
    process.stderr.write('provider_credential_decryption=failed\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
NODE
)"
  decrypted_credentials="$(awk -F '|' '$1 == "provider_credentials_decrypted" {print $2}' <<< "${credential_output}")"
  stored_credentials="$(awk -F '|' '$1 == "provider_credentials" {print $2}' <<< "${sql_output}")"
  [[ "${decrypted_credentials}" =~ ^[0-9]+$ && "${decrypted_credentials}" == "${stored_credentials}" ]] || \
    clone_fail "Stored Provider Credential decryption count did not match the restored database."
  printf '%s\n' "provider_credentials_decrypted|${decrypted_credentials}"
fi

if [[ "${offline_started}" == "true" ]]; then
  clone_restore_compose down --remove-orphans >/dev/null
  offline_started=false
fi
clone_log "Database, RuntimeSnapshot, Provider Catalog, RAG counts, and online Provider Credential decryption verified."
