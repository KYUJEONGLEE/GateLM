-- Keep the canonical TenantMembership and the legacy Dashboard TenantAdmin
-- projection aligned without creating Employee records or granting by email.

UPDATE "tenant_memberships" AS membership
SET
  "role" = 'tenant_admin',
  "status" = 'active',
  "joinedAt" = COALESCE(membership."joinedAt", admin."createdAt"),
  "updatedAt" = CURRENT_TIMESTAMP,
  "deletedAt" = NULL
FROM "tenant_admins" AS admin
WHERE membership."tenantId" = admin."tenantId"
  AND membership."userId" = admin."userId"
  AND (
    membership."role" IS DISTINCT FROM 'tenant_admin'
    OR membership."status" IS DISTINCT FROM 'active'
    OR membership."deletedAt" IS NOT NULL
  );

INSERT INTO "tenant_memberships" (
  "id",
  "tenantId",
  "userId",
  "role",
  "status",
  "joinedAt",
  "createdAt",
  "updatedAt",
  "deletedAt"
)
SELECT
  gen_random_uuid(),
  admin."tenantId",
  admin."userId",
  'tenant_admin',
  'active',
  admin."createdAt",
  admin."createdAt",
  CURRENT_TIMESTAMP,
  NULL
FROM "tenant_admins" AS admin
WHERE NOT EXISTS (
  SELECT 1
  FROM "tenant_memberships" AS membership
  WHERE membership."tenantId" = admin."tenantId"
    AND membership."userId" = admin."userId"
)
ON CONFLICT ("tenantId", "userId") DO NOTHING;

INSERT INTO "tenant_admins" (
  "tenantId",
  "userId",
  "createdAt",
  "updatedAt"
)
SELECT
  membership."tenantId",
  membership."userId",
  COALESCE(membership."joinedAt", membership."createdAt"),
  CURRENT_TIMESTAMP
FROM "tenant_memberships" AS membership
WHERE membership."role" = 'tenant_admin'
  AND membership."status" = 'active'
  AND membership."deletedAt" IS NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;