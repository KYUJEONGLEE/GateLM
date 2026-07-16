-- Tenant employee cost policies are independent from Project employee assignment
-- budgets and Tenant Chat user/tenant quota records. The migration is additive.

CREATE TABLE tenant_employee_cost_policies (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    daily_enabled boolean NOT NULL DEFAULT false,
    daily_limit_micro_usd bigint NOT NULL DEFAULT 0,
    weekly_enabled boolean NOT NULL DEFAULT false,
    weekly_limit_micro_usd bigint NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'USD',
    period_timezone text NOT NULL DEFAULT 'Asia/Seoul',
    warning_threshold_percent integer NOT NULL DEFAULT 80,
    enforcement_mode text NOT NULL DEFAULT 'monitor',
    version integer NOT NULL DEFAULT 1,
    updated_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_employee_cost_policies_pkey
        PRIMARY KEY (tenant_id, employee_id),
    CONSTRAINT tenant_employee_cost_policies_employee_tenant_key
        UNIQUE (employee_id, tenant_id),
    CONSTRAINT tenant_employee_cost_policies_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT tenant_employee_cost_policies_employee_tenant_fkey
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, "tenantId") ON DELETE RESTRICT,
    CONSTRAINT tenant_employee_cost_policies_daily_limit_check CHECK (
        (daily_enabled AND daily_limit_micro_usd > 0)
        OR (NOT daily_enabled AND daily_limit_micro_usd = 0)
    ),
    CONSTRAINT tenant_employee_cost_policies_weekly_limit_check CHECK (
        (weekly_enabled AND weekly_limit_micro_usd > 0)
        OR (NOT weekly_enabled AND weekly_limit_micro_usd = 0)
    ),
    CONSTRAINT tenant_employee_cost_policies_currency_check
        CHECK (currency = 'USD'),
    CONSTRAINT tenant_employee_cost_policies_timezone_check
        CHECK (char_length(period_timezone) BETWEEN 1 AND 64),
    CONSTRAINT tenant_employee_cost_policies_warning_check
        CHECK (warning_threshold_percent BETWEEN 1 AND 99),
    CONSTRAINT tenant_employee_cost_policies_mode_check
        CHECK (enforcement_mode IN ('monitor', 'restrict_high_cost')),
    CONSTRAINT tenant_employee_cost_policies_version_check CHECK (version > 0)
);

CREATE INDEX tenant_employee_cost_policies_mode_idx
    ON tenant_employee_cost_policies (tenant_id, enforcement_mode);

CREATE TABLE tenant_employee_cost_policy_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    policy_version integer NOT NULL,
    action text NOT NULL DEFAULT 'policy_updated',
    previous_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    next_policy jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_employee_cost_policy_audits_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT tenant_employee_cost_policy_audits_employee_tenant_fkey
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, "tenantId") ON DELETE RESTRICT,
    CONSTRAINT tenant_employee_cost_policy_audits_policy_fkey
        FOREIGN KEY (tenant_id, employee_id)
        REFERENCES tenant_employee_cost_policies(tenant_id, employee_id)
        ON DELETE RESTRICT,
    CONSTRAINT tenant_employee_cost_policy_audits_version_check
        CHECK (policy_version > 0),
    CONSTRAINT tenant_employee_cost_policy_audits_action_check
        CHECK (action IN ('policy_created', 'policy_updated')),
    CONSTRAINT tenant_employee_cost_policy_audits_version_key
        UNIQUE (tenant_id, employee_id, policy_version)
);

CREATE INDEX tenant_employee_cost_policy_audits_tenant_created_idx
    ON tenant_employee_cost_policy_audits (tenant_id, created_at);

CREATE INDEX tenant_employee_cost_policy_audits_employee_created_idx
    ON tenant_employee_cost_policy_audits (tenant_id, employee_id, created_at);
