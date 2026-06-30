-- CreateTable
CREATE TABLE "runtime_snapshots" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "runtimeConfigId" UUID,
    "version" BIGINT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "snapshotBody" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runtime_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_runtime_snapshots" (
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "runtimeSnapshotId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,

    CONSTRAINT "active_runtime_snapshots_pkey" PRIMARY KEY ("tenantId", "projectId", "applicationId")
);

-- CreateIndex
CREATE INDEX "runtime_snapshots_tenantId_idx" ON "runtime_snapshots"("tenantId");

-- CreateIndex
CREATE INDEX "runtime_snapshots_projectId_idx" ON "runtime_snapshots"("projectId");

-- CreateIndex
CREATE INDEX "runtime_snapshots_applicationId_idx" ON "runtime_snapshots"("applicationId");

-- CreateIndex
CREATE INDEX "runtime_snapshots_tenantId_projectId_applicationId_version_idx" ON "runtime_snapshots"("tenantId", "projectId", "applicationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_snapshots_applicationId_version_key" ON "runtime_snapshots"("applicationId", "version");

-- CreateIndex
CREATE INDEX "active_runtime_snapshots_runtimeSnapshotId_idx" ON "active_runtime_snapshots"("runtimeSnapshotId");

-- AddForeignKey
ALTER TABLE "runtime_snapshots" ADD CONSTRAINT "runtime_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_snapshots" ADD CONSTRAINT "runtime_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_snapshots" ADD CONSTRAINT "runtime_snapshots_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_snapshots" ADD CONSTRAINT "runtime_snapshots_runtimeConfigId_fkey" FOREIGN KEY ("runtimeConfigId") REFERENCES "runtime_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_runtime_snapshots" ADD CONSTRAINT "active_runtime_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_runtime_snapshots" ADD CONSTRAINT "active_runtime_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_runtime_snapshots" ADD CONSTRAINT "active_runtime_snapshots_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_runtime_snapshots" ADD CONSTRAINT "active_runtime_snapshots_runtimeSnapshotId_fkey" FOREIGN KEY ("runtimeSnapshotId") REFERENCES "runtime_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
