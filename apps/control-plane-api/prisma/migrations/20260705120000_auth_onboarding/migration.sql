CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "passwordHash" TEXT,
  "authProvider" TEXT NOT NULL DEFAULT 'local',
  "status" TEXT NOT NULL DEFAULT 'pending_email_verification',
  "emailVerifiedAt" TIMESTAMP(3),
  "lastLoginAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_active_key"
  ON "users"(LOWER("email"))
  WHERE "deletedAt" IS NULL;

CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");

CREATE TABLE "email_verification_codes" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_verification_codes_userId_consumedAt_idx"
  ON "email_verification_codes"("userId", "consumedAt");

CREATE INDEX "email_verification_codes_expiresAt_idx"
  ON "email_verification_codes"("expiresAt");

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_sessionTokenHash_key"
  ON "auth_sessions"("sessionTokenHash");

CREATE INDEX "auth_sessions_userId_kind_revokedAt_idx"
  ON "auth_sessions"("userId", "kind", "revokedAt");

CREATE INDEX "auth_sessions_expiresAt_idx"
  ON "auth_sessions"("expiresAt");

CREATE TABLE "oauth_accounts" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_accounts_provider_providerSubject_key"
  ON "oauth_accounts"("provider", "providerSubject");

CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");
CREATE INDEX "oauth_accounts_email_idx" ON "oauth_accounts"("email");

CREATE TABLE "tenant_memberships" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "joinedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_memberships_tenantId_userId_active_key"
  ON "tenant_memberships"("tenantId", "userId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX "tenant_memberships_tenantId_userId_idx"
  ON "tenant_memberships"("tenantId", "userId");

CREATE INDEX "tenant_memberships_userId_status_idx"
  ON "tenant_memberships"("userId", "status");

CREATE INDEX "tenant_memberships_tenantId_role_status_idx"
  ON "tenant_memberships"("tenantId", "role", "status");

ALTER TABLE "email_verification_codes"
  ADD CONSTRAINT "email_verification_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_memberships"
  ADD CONSTRAINT "tenant_memberships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
