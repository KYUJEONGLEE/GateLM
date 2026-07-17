-- Preserve the employee weekly ledger identity once a reservation is linked.
-- This is a follow-up migration so environments that already applied the
-- weekly quota migration keep a stable Prisma migration checksum.
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
        IF (OLD.employee_id IS NOT NULL OR NEW.employee_id IS NOT NULL)
           AND (
               OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
               OR OLD.employee_id IS DISTINCT FROM NEW.employee_id
               OR OLD.employee_weekly_period_start IS DISTINCT FROM NEW.employee_weekly_period_start
           ) THEN
            RAISE EXCEPTION 'tenant chat employee weekly reservation identity is immutable';
        END IF;
        IF NEW.employee_id IS NULL THEN
            RETURN NEW;
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

DROP TRIGGER tenant_chat_reservation_employee_weekly_token_sync
    ON tenant_chat_usage_reservations;

CREATE TRIGGER tenant_chat_reservation_employee_weekly_token_sync
AFTER INSERT OR UPDATE OF tenant_id, employee_id, employee_weekly_period_start,
    reserved_tokens, confirmed_input_tokens, confirmed_output_tokens,
    unconfirmed_tokens ON tenant_chat_usage_reservations
FOR EACH ROW EXECUTE FUNCTION sync_tenant_chat_employee_weekly_token_period();
