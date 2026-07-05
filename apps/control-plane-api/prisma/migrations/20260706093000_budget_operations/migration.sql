CREATE TABLE IF NOT EXISTS "budget_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id"),
    "project_id" UUID REFERENCES "projects"("id") ON DELETE SET NULL,
    "application_id" UUID REFERENCES "applications"("id") ON DELETE SET NULL,
    "budget_scope_type" TEXT NOT NULL,
    "budget_scope_id" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'budget_updated',
    "actor_type" TEXT NOT NULL DEFAULT 'admin_placeholder',
    "actor_id" UUID,
    "old_limit_micro_usd" BIGINT,
    "new_limit_micro_usd" BIGINT,
    "old_budget_limit_mode" TEXT,
    "new_budget_limit_mode" TEXT,
    "old_budget_limit_percent" DECIMAL(5, 2),
    "new_budget_limit_percent" DECIMAL(5, 2),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "budget_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "budget_audit_logs_tenant_created_at_idx"
    ON "budget_audit_logs"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "budget_audit_logs_scope_created_at_idx"
    ON "budget_audit_logs"("tenant_id", "budget_scope_type", "budget_scope_id", "created_at");
CREATE INDEX IF NOT EXISTS "budget_audit_logs_project_created_at_idx"
    ON "budget_audit_logs"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "budget_audit_logs_application_created_at_idx"
    ON "budget_audit_logs"("application_id", "created_at");

CREATE TABLE IF NOT EXISTS "notification_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id"),
    "project_id" UUID REFERENCES "projects"("id") ON DELETE SET NULL,
    "application_id" UUID REFERENCES "applications"("id") ON DELETE SET NULL,
    "budget_scope_type" TEXT NOT NULL,
    "budget_scope_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recipient_scope_type" TEXT NOT NULL,
    "recipient_scope_id" TEXT NOT NULL,
    "recipient_role" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "limit_micro_usd" BIGINT,
    "used_micro_usd" BIGINT,
    "remaining_micro_usd" BIGINT,
    "usage_percent" DECIMAL(12, 4),
    "source_request_id" TEXT,
    "month_start" DATE NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_events_event_key_key"
    ON "notification_events"("event_key");
CREATE INDEX IF NOT EXISTS "notification_events_tenant_status_created_at_idx"
    ON "notification_events"("tenant_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "notification_events_tenant_severity_created_at_idx"
    ON "notification_events"("tenant_id", "severity", "created_at");
CREATE INDEX IF NOT EXISTS "notification_events_scope_month_idx"
    ON "notification_events"("tenant_id", "budget_scope_type", "budget_scope_id", "month_start");
CREATE INDEX IF NOT EXISTS "notification_events_project_created_at_idx"
    ON "notification_events"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "notification_events_application_created_at_idx"
    ON "notification_events"("application_id", "created_at");
