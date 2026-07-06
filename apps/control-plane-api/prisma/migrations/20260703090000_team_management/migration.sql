-- CreateTable
CREATE TABLE IF NOT EXISTS "teams" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "monthlyBudgetUsd" DECIMAL(12,2),
    "budgetWarningThresholdPercent" INTEGER NOT NULL DEFAULT 80,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_team_assignments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_team_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "teams_tenantId_idx" ON "teams"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "teams_tenantId_status_idx" ON "teams"("tenantId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_team_assignments_tenantId_idx" ON "project_team_assignments"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_team_assignments_projectId_idx" ON "project_team_assignments"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_team_assignments_teamId_idx" ON "project_team_assignments"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "project_team_assignments_projectId_teamId_key" ON "project_team_assignments"("projectId", "teamId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'teams_tenantId_fkey'
    ) THEN
        ALTER TABLE "teams" ADD CONSTRAINT "teams_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'project_team_assignments_tenantId_fkey'
    ) THEN
        ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'project_team_assignments_projectId_fkey'
    ) THEN
        ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'project_team_assignments_teamId_fkey'
    ) THEN
        ALTER TABLE "project_team_assignments" ADD CONSTRAINT "project_team_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
