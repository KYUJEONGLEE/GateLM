CREATE TABLE IF NOT EXISTS "employees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "userId" UUID,
  "email" TEXT NOT NULL,
  "name" TEXT,
  "department" TEXT,
  "jobTitle" TEXT,
  "status" TEXT NOT NULL DEFAULT 'staged',
  "invitationStatus" TEXT NOT NULL DEFAULT 'not_sent',
  "invitedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "employees_tenantId_email_active_key"
  ON "employees"("tenantId", LOWER("email"))
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "employees_tenantId_status_idx"
  ON "employees"("tenantId", "status");

CREATE INDEX IF NOT EXISTS "employees_tenantId_department_idx"
  ON "employees"("tenantId", "department");

CREATE INDEX IF NOT EXISTS "employees_userId_idx"
  ON "employees"("userId");

CREATE TABLE IF NOT EXISTS "project_employee_assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "monthlyBudgetLimitMicroUsd" BIGINT NOT NULL DEFAULT 0,
  "warningThresholdPercent" INTEGER NOT NULL DEFAULT 80,
  "policy" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_employee_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_employee_assignments_budget_nonnegative_check"
    CHECK ("monthlyBudgetLimitMicroUsd" >= 0),
  CONSTRAINT "project_employee_assignments_warning_threshold_check"
    CHECK ("warningThresholdPercent" >= 0 AND "warningThresholdPercent" <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_employee_assignments_projectId_employeeId_key"
  ON "project_employee_assignments"("projectId", "employeeId");

CREATE INDEX IF NOT EXISTS "project_employee_assignments_tenantId_idx"
  ON "project_employee_assignments"("tenantId");

CREATE INDEX IF NOT EXISTS "project_employee_assignments_projectId_status_idx"
  ON "project_employee_assignments"("projectId", "status");

CREATE INDEX IF NOT EXISTS "project_employee_assignments_employeeId_status_idx"
  ON "project_employee_assignments"("employeeId", "status");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_employee_assignments"
  ADD CONSTRAINT "project_employee_assignments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_employee_assignments"
  ADD CONSTRAINT "project_employee_assignments_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_employee_assignments"
  ADD CONSTRAINT "project_employee_assignments_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
