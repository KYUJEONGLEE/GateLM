-- Tenant Chat employee quotas are an independent token ledger.  This is
-- expand-only: prior employee cost-policy evidence remains intact and old
-- reservations keep working without an employee weekly period reference.

CREATE TABLE tenant_chat_employee_weekly_token_policies (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    limit_tokens bigint NOT NULL DEFAULT 0,
    timezone text NOT NULL DEFAULT 'Asia/Seoul',
    version integer NOT NULL DEFAULT 1,
    updated_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_chat_employee_weekly_token_policies_pkey
        PRIMARY KEY (tenant_id, employee_id),
    CONSTRAINT tenant_chat_employee_weekly_policy_employee_tenant_key
        UNIQUE (employee_id, tenant_id),
    CONSTRAINT tenant_chat_employee_weekly_policy_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_policy_employee_fkey
        FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, "tenantId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_policy_limit_check
        CHECK (limit_tokens BETWEEN 0 AND 9007199254740991),
    CONSTRAINT tenant_chat_employee_weekly_policy_timezone_check
        CHECK (char_length(timezone) BETWEEN 1 AND 64),
    CONSTRAINT tenant_chat_employee_weekly_policy_version_check
        CHECK (version BETWEEN 1 AND 9007199254740991)
);

CREATE INDEX tenant_chat_employee_weekly_policy_enabled_idx
    ON tenant_chat_employee_weekly_token_policies (tenant_id, enabled);

CREATE TABLE tenant_chat_employee_weekly_token_policy_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    policy_version integer NOT NULL,
    action text NOT NULL DEFAULT 'policy_updated',
    previous_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    next_policy jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_chat_employee_weekly_policy_audit_policy_fkey
        FOREIGN KEY (tenant_id, employee_id)
        REFERENCES tenant_chat_employee_weekly_token_policies(tenant_id, employee_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_policy_audit_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_policy_audit_employee_fkey
        FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, "tenantId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_policy_audit_version_key
        UNIQUE (tenant_id, employee_id, policy_version),
    CONSTRAINT tenant_chat_employee_weekly_policy_audit_action_check
        CHECK (action IN ('policy_created', 'policy_updated', 'policy_disabled')),
    CONSTRAINT tenant_chat_employee_weekly_policy_audit_document_check
        CHECK (
            jsonb_typeof(previous_policy) = 'object'
            AND jsonb_typeof(next_policy) = 'object'
            AND octet_length(previous_policy::text) <= 16384
            AND octet_length(next_policy::text) <= 16384
        )
);

CREATE INDEX tenant_chat_employee_weekly_policy_audit_idx
    ON tenant_chat_employee_weekly_token_policy_audits (tenant_id, employee_id, created_at DESC);

CREATE TABLE tenant_chat_employee_weekly_token_periods (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    period_timezone text NOT NULL,
    limit_tokens bigint NOT NULL,
    reserved_tokens bigint NOT NULL DEFAULT 0,
    confirmed_input_tokens bigint NOT NULL DEFAULT 0,
    confirmed_output_tokens bigint NOT NULL DEFAULT 0,
    confirmed_total_tokens bigint NOT NULL DEFAULT 0,
    unconfirmed_tokens bigint NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'normal',
    policy_version integer NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT tenant_chat_employee_weekly_token_periods_pkey
        PRIMARY KEY (tenant_id, employee_id, period_start),
    CONSTRAINT tenant_chat_employee_weekly_period_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_period_employee_fkey
        FOREIGN KEY (employee_id, tenant_id) REFERENCES employees(id, "tenantId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT tenant_chat_employee_weekly_period_range_check
        CHECK (period_end > period_start),
    CONSTRAINT tenant_chat_employee_weekly_period_timezone_check
        CHECK (char_length(period_timezone) BETWEEN 1 AND 64),
    CONSTRAINT tenant_chat_employee_weekly_period_limit_check
        CHECK (limit_tokens BETWEEN 0 AND 9007199254740991),
    CONSTRAINT tenant_chat_employee_weekly_period_balances_check
        CHECK (
            reserved_tokens BETWEEN 0 AND 9007199254740991
            AND confirmed_input_tokens BETWEEN 0 AND 9007199254740991
            AND confirmed_output_tokens BETWEEN 0 AND 9007199254740991
            AND confirmed_total_tokens = confirmed_input_tokens + confirmed_output_tokens
            AND unconfirmed_tokens BETWEEN 0 AND 9007199254740991
            AND confirmed_total_tokens::numeric + reserved_tokens::numeric + unconfirmed_tokens::numeric
                <= 9007199254740991
        ),
    CONSTRAINT tenant_chat_employee_weekly_period_state_check
        CHECK (state IN ('normal', 'blocked')),
    CONSTRAINT tenant_chat_employee_weekly_period_policy_version_check
        CHECK (policy_version BETWEEN 1 AND 9007199254740991),
    CONSTRAINT tenant_chat_employee_weekly_period_version_check
        CHECK (version BETWEEN 1 AND 9007199254740991)
);

CREATE INDEX tenant_chat_employee_weekly_period_current_idx
    ON tenant_chat_employee_weekly_token_periods (tenant_id, employee_id, period_end DESC);

ALTER TABLE tenant_chat_usage_reservations
    ADD COLUMN employee_id uuid NULL,
    ADD COLUMN employee_weekly_period_start timestamptz NULL;

ALTER TABLE tenant_chat_usage_reservations
    ADD CONSTRAINT tenant_chat_reservation_employee_weekly_pair_check
    CHECK (
        (employee_id IS NULL AND employee_weekly_period_start IS NULL)
        OR (employee_id IS NOT NULL AND employee_weekly_period_start IS NOT NULL)
    );

ALTER TABLE tenant_chat_usage_reservations
    ADD CONSTRAINT tenant_chat_reservation_employee_weekly_period_fkey
    FOREIGN KEY (tenant_id, employee_id, employee_weekly_period_start)
    REFERENCES tenant_chat_employee_weekly_token_periods(tenant_id, employee_id, period_start)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX tenant_chat_reservation_employee_weekly_period_idx
    ON tenant_chat_usage_reservations (tenant_id, employee_id, employee_weekly_period_start)
    WHERE employee_id IS NOT NULL;

-- Every settlement/release/reconciliation path already mutates the native
-- reservation row. Mirroring its token deltas here keeps the employee week
-- ledger exactly-once without relying on projections or duplicating every
-- terminal path in application code.
CREATE OR REPLACE FUNCTION sync_tenant_chat_employee_weekly_token_period()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    delta_reserved bigint;
    delta_input bigint;
    delta_output bigint;
    delta_unconfirmed bigint;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.employee_id IS NULL THEN
            RETURN NEW;
        END IF;
        delta_reserved := NEW.reserved_tokens;
        delta_input := NEW.confirmed_input_tokens;
        delta_output := NEW.confirmed_output_tokens;
        delta_unconfirmed := NEW.unconfirmed_tokens;
    ELSE
        IF NEW.employee_id IS NULL THEN
            RETURN NEW;
        END IF;
        IF OLD.employee_id IS DISTINCT FROM NEW.employee_id
           OR OLD.employee_weekly_period_start IS DISTINCT FROM NEW.employee_weekly_period_start THEN
            RAISE EXCEPTION 'tenant chat employee weekly reservation identity is immutable';
        END IF;
        delta_reserved := NEW.reserved_tokens - OLD.reserved_tokens;
        delta_input := NEW.confirmed_input_tokens - OLD.confirmed_input_tokens;
        delta_output := NEW.confirmed_output_tokens - OLD.confirmed_output_tokens;
        delta_unconfirmed := NEW.unconfirmed_tokens - OLD.unconfirmed_tokens;
    END IF;

    UPDATE tenant_chat_employee_weekly_token_periods
    SET reserved_tokens = reserved_tokens + delta_reserved,
        confirmed_input_tokens = confirmed_input_tokens + delta_input,
        confirmed_output_tokens = confirmed_output_tokens + delta_output,
        confirmed_total_tokens = confirmed_total_tokens + delta_input + delta_output,
        unconfirmed_tokens = unconfirmed_tokens + delta_unconfirmed,
        state = CASE
            WHEN limit_tokens = 0
              OR reserved_tokens + delta_reserved
                 + confirmed_total_tokens + delta_input + delta_output
                 + unconfirmed_tokens + delta_unconfirmed >= limit_tokens
            THEN 'blocked' ELSE 'normal'
        END,
        version = version + 1,
        updated_at = now()
    WHERE tenant_id = NEW.tenant_id
      AND employee_id = NEW.employee_id
      AND period_start = NEW.employee_weekly_period_start;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'tenant chat employee weekly token period is missing';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_chat_reservation_employee_weekly_token_sync
AFTER INSERT OR UPDATE OF reserved_tokens, confirmed_input_tokens,
    confirmed_output_tokens, unconfirmed_tokens ON tenant_chat_usage_reservations
FOR EACH ROW EXECUTE FUNCTION sync_tenant_chat_employee_weekly_token_period();
