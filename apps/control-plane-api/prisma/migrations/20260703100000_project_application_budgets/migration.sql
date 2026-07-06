-- Project budget defaults to 100 USD for existing and future rows.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "totalBudgetUsd" DECIMAL(12,2);
UPDATE "projects" SET "totalBudgetUsd" = 100.00 WHERE "totalBudgetUsd" IS NULL;
ALTER TABLE "projects" ALTER COLUMN "totalBudgetUsd" SET DEFAULT 100.00;

-- Application budgets can be a fixed amount or a percentage of the project budget.
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "budgetLimitUsd" DECIMAL(12,2);
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "budgetLimitMode" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "budgetLimitPercent" DECIMAL(5,2);

UPDATE "applications"
SET "budgetLimitMode" = 'FIXED'
WHERE "budgetLimitMode" IS NULL OR "budgetLimitMode" = 'AUTO';

UPDATE "applications"
SET "budgetLimitUsd" = 0.00
WHERE "budgetLimitUsd" IS NULL AND "budgetLimitMode" = 'FIXED';

ALTER TABLE "applications" ALTER COLUMN "budgetLimitMode" SET DEFAULT 'FIXED';
