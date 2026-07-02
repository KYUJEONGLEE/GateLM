-- CreateTable
CREATE TABLE "provider_presets" (
    "providerKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "modelsEndpointPath" TEXT NOT NULL DEFAULT '/models',
    "credentialRequired" BOOLEAN NOT NULL DEFAULT true,
    "defaultResolver" TEXT NOT NULL DEFAULT 'environment',
    "defaultTimeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "providerConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_presets_pkey" PRIMARY KEY ("providerKey")
);

-- CreateIndex
CREATE INDEX "provider_presets_status_sortOrder_idx" ON "provider_presets"("status", "sortOrder");
