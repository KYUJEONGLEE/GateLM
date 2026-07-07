CREATE TABLE "tenant_admins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tenant_admins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_admins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_admins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_admin_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "invitedByUserId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "project_admin_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_admins_tenantId_userId_key" ON "tenant_admins"("tenantId", "userId");
CREATE INDEX "tenant_admins_userId_idx" ON "tenant_admins"("userId");

CREATE UNIQUE INDEX "project_admins_projectId_userId_key" ON "project_admins"("projectId", "userId");
CREATE INDEX "project_admins_tenantId_idx" ON "project_admins"("tenantId");
CREATE INDEX "project_admins_userId_idx" ON "project_admins"("userId");

CREATE UNIQUE INDEX "project_admin_invitations_tokenHash_key" ON "project_admin_invitations"("tokenHash");
CREATE INDEX "project_admin_invitations_tenantId_status_idx" ON "project_admin_invitations"("tenantId", "status");
CREATE INDEX "project_admin_invitations_projectId_status_idx" ON "project_admin_invitations"("projectId", "status");
CREATE INDEX "project_admin_invitations_email_status_idx" ON "project_admin_invitations"("email", "status");

ALTER TABLE "tenant_admins"
  ADD CONSTRAINT "tenant_admins_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_admins"
  ADD CONSTRAINT "tenant_admins_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_admins"
  ADD CONSTRAINT "project_admins_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_admins"
  ADD CONSTRAINT "project_admins_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_admins"
  ADD CONSTRAINT "project_admins_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_admin_invitations"
  ADD CONSTRAINT "project_admin_invitations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_admin_invitations"
  ADD CONSTRAINT "project_admin_invitations_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_admin_invitations"
  ADD CONSTRAINT "project_admin_invitations_invitedByUserId_fkey"
  FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "tenant_admins" ("tenantId", "userId", "createdAt", "updatedAt")
SELECT "tenantId", "userId", COALESCE("joinedAt", "createdAt"), CURRENT_TIMESTAMP
FROM "tenant_memberships"
WHERE "role" = 'tenant_admin'
  AND "status" = 'active'
  AND "deletedAt" IS NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;
