-- Preserve configured limits while a period is disabled, and keep all stored
-- micro-USD values inside the JavaScript safe-integer/API contract boundary.

ALTER TABLE tenant_employee_cost_policies
    DROP CONSTRAINT tenant_employee_cost_policies_daily_limit_check,
    ADD CONSTRAINT tenant_employee_cost_policies_daily_limit_check CHECK (
        daily_limit_micro_usd >= 0
        AND daily_limit_micro_usd <= 100000000000000
        AND (NOT daily_enabled OR daily_limit_micro_usd > 0)
    ),
    DROP CONSTRAINT tenant_employee_cost_policies_weekly_limit_check,
    ADD CONSTRAINT tenant_employee_cost_policies_weekly_limit_check CHECK (
        weekly_limit_micro_usd >= 0
        AND weekly_limit_micro_usd <= 100000000000000
        AND (NOT weekly_enabled OR weekly_limit_micro_usd > 0)
    );
