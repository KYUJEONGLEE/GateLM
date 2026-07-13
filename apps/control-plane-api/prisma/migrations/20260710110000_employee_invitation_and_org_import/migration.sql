ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "invitationTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "invitationExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "invitationRevokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "employees_invitationTokenHash_key"
  ON "employees"("invitationTokenHash");

CREATE INDEX IF NOT EXISTS "employees_tenantId_invitationStatus_idx"
  ON "employees"("tenantId", "invitationStatus");
