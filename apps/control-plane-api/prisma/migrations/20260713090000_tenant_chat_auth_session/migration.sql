ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "actorAuthzVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "authzVersion" INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION tenant_chat_bump_user_authz_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."actorAuthzVersion" = OLD."actorAuthzVersion" AND (
    NEW."email" IS DISTINCT FROM OLD."email" OR
    NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash" OR
    NEW."authProvider" IS DISTINCT FROM OLD."authProvider" OR
    NEW."status" IS DISTINCT FROM OLD."status" OR
    NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt"
  ) THEN
    NEW."actorAuthzVersion" := OLD."actorAuthzVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_chat_user_authz_version ON "users";
CREATE TRIGGER tenant_chat_user_authz_version
BEFORE UPDATE ON "users"
FOR EACH ROW EXECUTE FUNCTION tenant_chat_bump_user_authz_version();

CREATE OR REPLACE FUNCTION tenant_chat_bump_tenant_authz_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."authzVersion" = OLD."authzVersion" AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    NEW."authzVersion" := OLD."authzVersion" + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_chat_tenant_authz_version ON "tenants";
CREATE TRIGGER tenant_chat_tenant_authz_version
BEFORE UPDATE ON "tenants"
FOR EACH ROW EXECUTE FUNCTION tenant_chat_bump_tenant_authz_version();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tenant_memberships"
    GROUP BY "tenantId", "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'tenant_memberships contains duplicate tenantId/userId rows';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_memberships_tenantId_userId_key"
  ON "tenant_memberships"("tenantId", "userId");

DROP INDEX IF EXISTS "tenant_memberships_tenantId_userId_idx";

CREATE OR REPLACE FUNCTION tenant_chat_bump_membership_actor_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1 WHERE "id" = OLD."userId";
    RETURN OLD;
  END IF;
  UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1 WHERE "id" = NEW."userId";
  IF TG_OP = 'UPDATE' AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1 WHERE "id" = OLD."userId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_chat_membership_actor_version ON "tenant_memberships";
CREATE TRIGGER tenant_chat_membership_actor_version
AFTER INSERT OR UPDATE OR DELETE ON "tenant_memberships"
FOR EACH ROW EXECUTE FUNCTION tenant_chat_bump_membership_actor_version();

CREATE OR REPLACE FUNCTION tenant_chat_bump_employee_actor_version()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."userId" IS NOT NULL THEN
      UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1 WHERE "id" = OLD."userId";
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."userId" IS NOT NULL THEN
    UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1 WHERE "id" = NEW."userId";
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."userId" IS NOT NULL AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1 WHERE "id" = OLD."userId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_chat_employee_actor_version ON "employees";
CREATE TRIGGER tenant_chat_employee_actor_version
AFTER INSERT OR UPDATE OR DELETE ON "employees"
FOR EACH ROW EXECUTE FUNCTION tenant_chat_bump_employee_actor_version();

CREATE TABLE IF NOT EXISTS "tenant_chat_sessions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "selectedTenantId" UUID,
  "deviceIdHash" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL DEFAULT 1,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_chat_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_chat_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_chat_sessions_selectedTenantId_fkey" FOREIGN KEY ("selectedTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "tenant_chat_sessions_userId_revokedAt_idx"
  ON "tenant_chat_sessions"("userId", "revokedAt");
CREATE INDEX IF NOT EXISTS "tenant_chat_sessions_selectedTenantId_revokedAt_idx"
  ON "tenant_chat_sessions"("selectedTenantId", "revokedAt");
CREATE INDEX IF NOT EXISTS "tenant_chat_sessions_expiresAt_idx"
  ON "tenant_chat_sessions"("expiresAt");

CREATE TABLE IF NOT EXISTS "tenant_chat_refresh_tokens" (
  "id" UUID NOT NULL,
  "sessionId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "parentTokenId" UUID,
  "replacedByTokenId" UUID,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_chat_refresh_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_chat_refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "tenant_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_chat_refresh_tokens_tokenHash_key"
  ON "tenant_chat_refresh_tokens"("tokenHash");
CREATE INDEX IF NOT EXISTS "tenant_chat_refresh_tokens_sessionId_familyId_idx"
  ON "tenant_chat_refresh_tokens"("sessionId", "familyId");
CREATE INDEX IF NOT EXISTS "tenant_chat_refresh_tokens_familyId_revokedAt_idx"
  ON "tenant_chat_refresh_tokens"("familyId", "revokedAt");
CREATE INDEX IF NOT EXISTS "tenant_chat_refresh_tokens_expiresAt_idx"
  ON "tenant_chat_refresh_tokens"("expiresAt");
