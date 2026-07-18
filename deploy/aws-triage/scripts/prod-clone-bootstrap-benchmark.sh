#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

perf_check_docker
clone_load_env
clone_validate_env
clone_assert_role_host data
[[ "${GATELM_PROD_CLONE_PHASE}" == "benchmark" ]] || \
  clone_fail "Synthetic benchmark bootstrap is allowed only in benchmark phase."
clone_assert_db_attestation
clone_wait_for_service data postgres
clone_wait_for_service data control-plane-api

clone_require_env \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN \
  GATELM_DEMO_TENANT_ID \
  GATELM_DEMO_PROJECT_ID \
  GATELM_DEMO_APPLICATION_ID \
  GATELM_DEMO_API_KEY_ID \
  GATELM_DEMO_APP_TOKEN_ID

original_active_count="$(clone_compose --profile data exec -T postgres \
  psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" -At \
  -c "select count(*) from active_runtime_snapshots where not (\"tenantId\" = '${GATELM_DEMO_TENANT_ID}'::uuid and \"projectId\" = '${GATELM_DEMO_PROJECT_ID}'::uuid and \"applicationId\" = '${GATELM_DEMO_APPLICATION_ID}'::uuid);")"
[[ "${original_active_count}" =~ ^[1-9][0-9]*$ ]] || \
  clone_fail "No original production RuntimeSnapshot exists before benchmark bootstrap."

clone_log "Publishing an isolated synthetic Mock RuntimeSnapshot without changing original production applications."
if ! clone_compose --profile data run --rm --no-deps \
  -e NODE_ENV=development \
  -e GATELM_DEPLOYMENT_ENV=perf \
  -e GATELM_DEMO_PROVIDER_MODE=mock \
  -e GATELM_DEMO_MOCK_PROVIDER_BASE_URL="http://${GATELM_PROD_CLONE_AI_PRIVATE_IP}:8090" \
  -e GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT=100000 \
  control-plane-api node dist/prisma/seed.js >/dev/null 2>&1; then
  clone_fail "Synthetic benchmark bootstrap failed. Output was hidden to avoid credential disclosure."
fi

# The 13d2964f seed assigns the balanced cost tier to every Mock model while
# the same release's runtime service derives the unused mock-fast model as
# premium. Recompute only the isolated synthetic snapshot with the exact
# running 13d2964f service implementation so its Provider Catalog reference is
# internally consistent. Original production snapshots are never selected.
if ! clone_compose --profile data exec -T \
  -e GATELM_DEMO_TENANT_ID="${GATELM_DEMO_TENANT_ID}" \
  -e GATELM_DEMO_PROJECT_ID="${GATELM_DEMO_PROJECT_ID}" \
  -e GATELM_DEMO_APPLICATION_ID="${GATELM_DEMO_APPLICATION_ID}" \
  control-plane-api node <<'NODE' >/dev/null 2>&1
const { PrismaClient } = require('@prisma/client');
const {
  RuntimeConfigsService,
} = require('./dist/src/modules/runtime-configs/runtime-configs.service.js');

async function reconcileSyntheticSnapshot() {
  const prisma = new PrismaClient();
  try {
    const scope = {
      tenantId: process.env.GATELM_DEMO_TENANT_ID,
      projectId: process.env.GATELM_DEMO_PROJECT_ID,
      applicationId: process.env.GATELM_DEMO_APPLICATION_ID,
    };
    if (!scope.tenantId || !scope.projectId || !scope.applicationId) {
      throw new Error('synthetic scope is missing');
    }

    const active = await prisma.activeRuntimeSnapshot.findUnique({
      where: {
        tenantId_projectId_applicationId: scope,
      },
    });
    const row = await prisma.runtimeSnapshot.findFirst({
      where: scope,
      orderBy: { version: 'desc' },
      include: { runtimeConfig: true },
    });
    if (!active || !row || !row.runtimeConfig || active.runtimeSnapshotId !== row.id) {
      throw new Error('active synthetic snapshot is missing or ambiguous');
    }

    const service = Object.create(RuntimeConfigsService.prototype);
    const snapshot = service.toPersistedRuntimeSnapshotResponse(row);
    const document = service.withProviderCredentialRefBridge(
      service.toRuntimeConfigDocument(row.runtimeConfig.document),
    );
    const catalog = service.toProviderCatalogResponse(row.runtimeConfig, document);
    const providerCatalogRef = {
      catalogId: catalog.catalogId,
      catalogVersion: catalog.catalogVersion,
      contentHash: catalog.contentHash,
    };

    if (!service.providerCatalogMatchesRef(catalog, snapshot.providerCatalogRef)) {
      const snapshotWithoutContentHash = {
        ...snapshot,
        contentHash: undefined,
        providerCatalogRef,
      };
      const repairedSnapshot = {
        ...snapshotWithoutContentHash,
        contentHash: service.sha256(
          service.canonicalJson(snapshotWithoutContentHash),
        ),
      };
      await prisma.runtimeSnapshot.update({
        where: { id: row.id },
        data: {
          contentHash: repairedSnapshot.contentHash,
          snapshotBody: repairedSnapshot,
        },
      });
    }

    const verified = await prisma.runtimeSnapshot.findUnique({
      where: { id: row.id },
      include: { runtimeConfig: true },
    });
    if (!verified || !verified.runtimeConfig) {
      throw new Error('reconciled synthetic snapshot is missing');
    }
    const verifiedSnapshot = service.toPersistedRuntimeSnapshotResponse(verified);
    const verifiedDocument = service.withProviderCredentialRefBridge(
      service.toRuntimeConfigDocument(verified.runtimeConfig.document),
    );
    const verifiedCatalog = service.toProviderCatalogResponse(
      verified.runtimeConfig,
      verifiedDocument,
    );
    if (!service.providerCatalogMatchesRef(
      verifiedCatalog,
      verifiedSnapshot.providerCatalogRef,
    )) {
      throw new Error('synthetic Provider Catalog reconciliation failed');
    }
  } finally {
    await prisma.$disconnect();
  }
}

reconcileSyntheticSnapshot().catch(() => process.exit(1));
NODE
then
  clone_fail "Synthetic Provider Catalog reconciliation failed. Output was hidden to avoid data disclosure."
fi

verification="$(clone_compose --profile data exec -T postgres \
  psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" -At -F '|' <<SQL
select concat_ws('|',
  (select count(*) from active_runtime_snapshots where "tenantId" = '${GATELM_DEMO_TENANT_ID}'::uuid and "projectId" = '${GATELM_DEMO_PROJECT_ID}'::uuid and "applicationId" = '${GATELM_DEMO_APPLICATION_ID}'::uuid),
  (select count(*) from active_runtime_snapshots where not ("tenantId" = '${GATELM_DEMO_TENANT_ID}'::uuid and "projectId" = '${GATELM_DEMO_PROJECT_ID}'::uuid and "applicationId" = '${GATELM_DEMO_APPLICATION_ID}'::uuid)),
  (select count(*) from application_provider_connections assignment join provider_connections connection on connection.id = assignment."providerConnectionId" where assignment."applicationId" = '${GATELM_DEMO_APPLICATION_ID}'::uuid and connection.provider = 'mock' and connection."baseUrl" = 'http://${GATELM_PROD_CLONE_AI_PRIVATE_IP}:8090'),
  (select count(*) from application_provider_connections assignment join provider_connections connection on connection.id = assignment."providerConnectionId" where assignment."applicationId" = '${GATELM_DEMO_APPLICATION_ID}'::uuid and connection.provider <> 'mock'),
  (select count(*) from gateway_api_keys where id = '${GATELM_DEMO_API_KEY_ID}'::uuid and "projectId" = '${GATELM_DEMO_PROJECT_ID}'::uuid and status = 'ACTIVE'),
  (select count(*) from app_tokens where id = '${GATELM_DEMO_APP_TOKEN_ID}'::uuid and "applicationId" = '${GATELM_DEMO_APPLICATION_ID}'::uuid and status = 'ACTIVE'),
  (select snapshot."snapshotBody" #>> '{policies,rateLimit,limit}' from active_runtime_snapshots active join runtime_snapshots snapshot on snapshot.id = active."runtimeSnapshotId" where active."tenantId" = '${GATELM_DEMO_TENANT_ID}'::uuid and active."projectId" = '${GATELM_DEMO_PROJECT_ID}'::uuid and active."applicationId" = '${GATELM_DEMO_APPLICATION_ID}'::uuid)
);
SQL
)"

expected="1|${original_active_count}|1|0|1|1|100000"
[[ "$(perf_trim "${verification}")" == "${expected}" ]] || \
  clone_fail "Synthetic Mock application verification failed."

clone_log "Synthetic benchmark application verified: one Mock route, zero live routes, reconciled Provider Catalog, original snapshots preserved, limit=100000."
