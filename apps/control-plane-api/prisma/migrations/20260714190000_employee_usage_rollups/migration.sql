-- Employee usage is a high-cardinality read model and stays separate from the
-- bounded dashboard_rollup_dimensions table. This migration is additive.

CREATE UNIQUE INDEX employees_identity_tenant_key
    ON employees (id, "tenantId");

ALTER TABLE dashboard_rollup_bucket_states
    ADD COLUMN employee_usage_ready boolean NOT NULL DEFAULT false,
    ADD COLUMN employee_usage_row_count integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT dashboard_rollup_bucket_states_employee_usage_count_check
        CHECK (employee_usage_row_count >= 0);

CREATE TABLE employee_usage_rollups (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    surface text NOT NULL,
    grain text NOT NULL,
    bucket_start timestamptz NOT NULL,
    project_id text NOT NULL DEFAULT '',
    request_count bigint NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    total_tokens bigint NOT NULL DEFAULT 0,
    cost_micro_usd bigint NOT NULL DEFAULT 0,
    source_max_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_usage_rollups_pkey PRIMARY KEY (
        tenant_id, employee_id, surface, grain, bucket_start, project_id
    ),
    CONSTRAINT employee_usage_rollups_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT employee_usage_rollups_employee_tenant_fkey
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, "tenantId") ON DELETE RESTRICT,
    CONSTRAINT employee_usage_rollups_surface_check
        CHECK (surface IN ('project_application', 'tenant_chat')),
    CONSTRAINT employee_usage_rollups_grain_check
        CHECK (grain IN ('hour', 'day', 'month')),
    CONSTRAINT employee_usage_rollups_metrics_check CHECK (
        request_count >= 0
        AND input_tokens >= 0
        AND output_tokens >= 0
        AND total_tokens >= 0
        AND cost_micro_usd >= 0
    )
);

CREATE INDEX employee_usage_rollups_ranking_idx
    ON employee_usage_rollups (
        tenant_id, grain, bucket_start, total_tokens DESC
    );

CREATE INDEX employee_usage_rollups_period_idx
    ON employee_usage_rollups (
        tenant_id, surface, grain, bucket_start
    );

CREATE INDEX employee_usage_rollups_employee_idx
    ON employee_usage_rollups (
        tenant_id, employee_id, grain, bucket_start
    );
