-- Monthly budget usage ledger written by Gateway terminal logs.
CREATE TABLE IF NOT EXISTS "budget_ledger_entries" (
    "request_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id"),
    "project_id" UUID NOT NULL REFERENCES "projects"("id"),
    "application_id" UUID REFERENCES "applications"("id"),
    "budget_scope_type" TEXT NOT NULL,
    "budget_scope_id" TEXT NOT NULL,
    "month_start" DATE NOT NULL,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'request_log',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_ledger_entries_pkey" PRIMARY KEY ("request_id")
);

CREATE INDEX IF NOT EXISTS "budget_ledger_entries_scope_month_idx"
    ON "budget_ledger_entries"("tenant_id", "budget_scope_type", "budget_scope_id", "month_start");

CREATE INDEX IF NOT EXISTS "budget_ledger_entries_project_month_idx"
    ON "budget_ledger_entries"("tenant_id", "project_id", "month_start");

CREATE INDEX IF NOT EXISTS "budget_ledger_entries_application_month_idx"
    ON "budget_ledger_entries"("tenant_id", "application_id", "month_start");

-- Optional monthly quota override. Gateway can also derive project/application limits from existing budget fields.
CREATE TABLE IF NOT EXISTS "budget_quotas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id"),
    "budget_scope_type" TEXT NOT NULL,
    "budget_scope_id" TEXT NOT NULL,
    "month_start" DATE NOT NULL,
    "limit_micro_usd" BIGINT NOT NULL,
    "warning_threshold_percent" INTEGER NOT NULL DEFAULT 80,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_quotas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "budget_quotas_warning_threshold_check" CHECK ("warning_threshold_percent" >= 0 AND "warning_threshold_percent" <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "budget_quotas_tenant_scope_month_key"
    ON "budget_quotas"("tenant_id", "budget_scope_type", "budget_scope_id", "month_start");

CREATE INDEX IF NOT EXISTS "budget_quotas_tenant_month_status_idx"
    ON "budget_quotas"("tenant_id", "month_start", "status");