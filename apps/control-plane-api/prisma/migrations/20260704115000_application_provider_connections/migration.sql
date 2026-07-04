-- Provider registry is tenant-scoped; applications explicitly opt into providers.
-- Existing project-scoped rows are kept for compatibility and backfilled into
-- application_provider_connections for applications in the same project.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "provider_connections"
  ALTER COLUMN "projectId" DROP NOT NULL;

CREATE UNIQUE INDEX "provider_connections_tenantId_provider_tenant_scope_key"
  ON "provider_connections"("tenantId", "provider")
  WHERE "projectId" IS NULL;

CREATE TABLE "application_provider_connections" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "applicationId" UUID NOT NULL,
  "providerConnectionId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "application_provider_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "application_provider_connections_tenantId_idx"
  ON "application_provider_connections"("tenantId");

CREATE INDEX "application_provider_connections_projectId_idx"
  ON "application_provider_connections"("projectId");

CREATE INDEX "application_provider_connections_applicationId_idx"
  ON "application_provider_connections"("applicationId");

CREATE INDEX "application_provider_connections_providerConnectionId_idx"
  ON "application_provider_connections"("providerConnectionId");

CREATE UNIQUE INDEX "application_provider_connections_applicationId_providerConnectionId_key"
  ON "application_provider_connections"("applicationId", "providerConnectionId");

ALTER TABLE "application_provider_connections"
  ADD CONSTRAINT "application_provider_connections_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "application_provider_connections"
  ADD CONSTRAINT "application_provider_connections_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "application_provider_connections"
  ADD CONSTRAINT "application_provider_connections_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "application_provider_connections"
  ADD CONSTRAINT "application_provider_connections_providerConnectionId_fkey"
  FOREIGN KEY ("providerConnectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "application_provider_connections" (
  "id",
  "tenantId",
  "projectId",
  "applicationId",
  "providerConnectionId"
)
SELECT
  gen_random_uuid(),
  application."tenantId",
  application."projectId",
  application."id",
  provider_connection."id"
FROM "applications" application
JOIN "provider_connections" provider_connection
  ON provider_connection."tenantId" = application."tenantId"
 AND provider_connection."projectId" = application."projectId"
ON CONFLICT ("applicationId", "providerConnectionId") DO NOTHING;
