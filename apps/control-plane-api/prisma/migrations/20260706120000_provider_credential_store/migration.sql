CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "provider_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "providerConnectionId" UUID NOT NULL,
  "credentialRefId" TEXT NOT NULL,
  "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "encryptedValue" TEXT NOT NULL,
  "encryptionNonce" TEXT NOT NULL,
  "encryptionTag" TEXT NOT NULL,
  "encryptionKeyVersion" TEXT NOT NULL DEFAULT 'v1',
  "credentialPrefix" TEXT,
  "credentialLast4" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rotatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "provider_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_credentials_credentialRefId_key"
  ON "provider_credentials"("credentialRefId");

CREATE INDEX "provider_credentials_tenantId_idx"
  ON "provider_credentials"("tenantId");

CREATE INDEX "provider_credentials_providerConnectionId_idx"
  ON "provider_credentials"("providerConnectionId");

CREATE INDEX "provider_credentials_status_idx"
  ON "provider_credentials"("status");

ALTER TABLE "provider_credentials"
  ADD CONSTRAINT "provider_credentials_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "provider_credentials"
  ADD CONSTRAINT "provider_credentials_providerConnectionId_fkey"
  FOREIGN KEY ("providerConnectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
