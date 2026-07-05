-- Tenant budget is the top-level allocation pool for project budgets.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "totalBudgetUsd" DECIMAL(12,2);
UPDATE "tenants" SET "totalBudgetUsd" = 1000.00 WHERE "totalBudgetUsd" IS NULL;
ALTER TABLE "tenants" ALTER COLUMN "totalBudgetUsd" SET DEFAULT 1000.00;

-- Teams are usage grouping/reference units, not budget allocation units.
ALTER TABLE "teams" DROP COLUMN IF EXISTS "monthlyBudgetUsd";
ALTER TABLE "teams" DROP COLUMN IF EXISTS "budgetWarningThresholdPercent";
