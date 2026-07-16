-- Authoritative tenant employee cost accounting is additive and remains
-- traffic-off until a tenant rollout row is explicitly promoted from `off`.
-- All correctness relations use RESTRICT so usage evidence cannot disappear
-- through an unrelated employee, tenant, rollout, or parent-row deletion.

CREATE TABLE tenant_employee_cost_ledger_rollouts (
    tenant_id uuid PRIMARY KEY,
    mode text NOT NULL DEFAULT 'off',
    activation_boundary_at timestamptz NULL,
    project_application_covered_from timestamptz NULL,
    tenant_chat_covered_from timestamptz NULL,
    coverage_invalidated_at timestamptz NULL,
    coverage_error_code text NULL,
    version bigint NOT NULL DEFAULT 1,
    updated_by_kind text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_cost_rollouts_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_rollouts_mode_check
        CHECK (mode IN ('off', 'shadow', 'enforce')),
    CONSTRAINT employee_cost_rollouts_activation_check CHECK (
        mode <> 'enforce' OR activation_boundary_at IS NOT NULL
    ),
    CONSTRAINT employee_cost_rollouts_invalidation_check CHECK (
        (coverage_invalidated_at IS NULL AND coverage_error_code IS NULL)
        OR (
            coverage_invalidated_at IS NOT NULL
            AND coverage_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
        )
    ),
    CONSTRAINT employee_cost_rollouts_version_check
        CHECK (version BETWEEN 1 AND 9007199254740991),
    CONSTRAINT employee_cost_rollouts_actor_check CHECK (
        updated_by_kind IN ('admin', 'system')
        AND char_length(updated_by) BETWEEN 1 AND 128
        AND (
            (
                updated_by_kind = 'admin'
                AND updated_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            )
            OR (
                updated_by_kind = 'system'
                AND updated_by ~ '^[a-z][a-z0-9_-]{0,63}$'
            )
        )
    )
);

CREATE INDEX employee_cost_rollouts_mode_activation_idx
    ON tenant_employee_cost_ledger_rollouts (mode, activation_boundary_at);

CREATE INDEX employee_cost_rollouts_invalidated_idx
    ON tenant_employee_cost_ledger_rollouts (coverage_invalidated_at, tenant_id)
    WHERE coverage_invalidated_at IS NOT NULL;

CREATE TABLE tenant_employee_cost_ledger_rollout_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    actor_kind text NOT NULL,
    actor_id text NOT NULL,
    rollout_version bigint NOT NULL,
    action text NOT NULL,
    previous_rollout jsonb NOT NULL DEFAULT '{}'::jsonb,
    next_rollout jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_cost_rollout_audits_rollout_fkey
        FOREIGN KEY (tenant_id)
        REFERENCES tenant_employee_cost_ledger_rollouts(tenant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_rollout_audits_version_key
        UNIQUE (tenant_id, rollout_version),
    CONSTRAINT employee_cost_rollout_audits_version_check
        CHECK (rollout_version BETWEEN 1 AND 9007199254740991),
    CONSTRAINT employee_cost_rollout_audits_action_check
        CHECK (action IN (
            'rollout_created',
            'rollout_updated',
            'coverage_invalidated'
        )),
    CONSTRAINT employee_cost_rollout_audits_document_check CHECK (
        jsonb_typeof(previous_rollout) = 'object'
        AND jsonb_typeof(next_rollout) = 'object'
        AND octet_length(previous_rollout::text) <= 16384
        AND octet_length(next_rollout::text) <= 16384
    ),
    CONSTRAINT employee_cost_rollout_audits_actor_check CHECK (
        actor_kind IN ('admin', 'system')
        AND char_length(actor_id) BETWEEN 1 AND 128
        AND (
            (
                actor_kind = 'admin'
                AND actor_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            )
            OR (
                actor_kind = 'system'
                AND actor_id ~ '^[a-z][a-z0-9_-]{0,63}$'
            )
        )
    )
);

CREATE INDEX employee_cost_rollout_audits_tenant_created_idx
    ON tenant_employee_cost_ledger_rollout_audits (tenant_id, created_at DESC);

CREATE TABLE tenant_employee_cost_periods (
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    period_kind text NOT NULL,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    period_timezone text NOT NULL,
    currency char(3) NOT NULL DEFAULT 'USD',
    created_policy_version integer NOT NULL DEFAULT 0,
    last_evaluated_policy_version integer NOT NULL DEFAULT 0,
    confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
    reserved_cost_micro_usd bigint NOT NULL DEFAULT 0,
    unconfirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'not_configured',
    version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_cost_periods_pkey
        PRIMARY KEY (
            tenant_id,
            employee_id,
            period_kind,
            period_start,
            currency
        ),
    CONSTRAINT employee_cost_periods_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_periods_rollout_fkey
        FOREIGN KEY (tenant_id)
        REFERENCES tenant_employee_cost_ledger_rollouts(tenant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_periods_employee_tenant_fkey
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, "tenantId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_periods_kind_check
        CHECK (period_kind IN ('day', 'week')),
    CONSTRAINT employee_cost_periods_range_check
        CHECK (period_end > period_start),
    CONSTRAINT employee_cost_periods_timezone_check
        CHECK (char_length(period_timezone) BETWEEN 1 AND 64),
    CONSTRAINT employee_cost_periods_currency_check
        CHECK (currency = 'USD'),
    CONSTRAINT employee_cost_periods_policy_version_check CHECK (
        created_policy_version >= 0
        AND last_evaluated_policy_version >= created_policy_version
    ),
    CONSTRAINT employee_cost_periods_balances_check CHECK (
        confirmed_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND reserved_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND unconfirmed_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND (
            confirmed_cost_micro_usd::numeric
            + reserved_cost_micro_usd::numeric
            + unconfirmed_cost_micro_usd::numeric
        ) <= 9007199254740991
    ),
    CONSTRAINT employee_cost_periods_state_check
        CHECK (state IN ('not_configured', 'normal', 'warning', 'exceeded')),
    CONSTRAINT employee_cost_periods_version_check
        CHECK (version BETWEEN 1 AND 9007199254740991)
);

CREATE INDEX employee_cost_periods_tenant_employee_current_idx
    ON tenant_employee_cost_periods (
        tenant_id,
        employee_id,
        period_kind,
        period_end DESC
    );

CREATE INDEX employee_cost_periods_tenant_state_idx
    ON tenant_employee_cost_periods (
        tenant_id,
        period_kind,
        state,
        period_end DESC
    );

CREATE TABLE tenant_employee_cost_reservations (
    reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    surface text NOT NULL,
    request_id text NOT NULL,
    day_period_kind text NOT NULL DEFAULT 'day',
    day_period_start timestamptz NOT NULL,
    week_period_kind text NOT NULL DEFAULT 'week',
    week_period_start timestamptz NOT NULL,
    currency char(3) NOT NULL DEFAULT 'USD',
    pinned_policy_version integer NOT NULL DEFAULT 0,
    enforcement_mode text NOT NULL,
    daily_enabled boolean NOT NULL,
    daily_limit_micro_usd bigint NOT NULL,
    daily_warning_micro_usd bigint NOT NULL,
    daily_state text NOT NULL,
    weekly_enabled boolean NOT NULL,
    weekly_limit_micro_usd bigint NOT NULL,
    weekly_warning_micro_usd bigint NOT NULL,
    weekly_state text NOT NULL,
    enforcement_outcome text NOT NULL,
    pricing_rule_id text NOT NULL,
    pricing_version text NOT NULL,
    estimate_version text NOT NULL,
    reserved_cost_micro_usd bigint NOT NULL DEFAULT 0,
    confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
    unconfirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
    state text NOT NULL DEFAULT 'reserved',
    ledger_version bigint NOT NULL DEFAULT 0,
    reserved_at timestamptz NOT NULL,
    usage_pending_at timestamptz NULL,
    terminal_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_cost_reservations_surface_request_key
        UNIQUE (surface, request_id),
    CONSTRAINT employee_cost_reservations_identity_key
        UNIQUE (
            reservation_id,
            surface,
            request_id,
            tenant_id,
            employee_id
        ),
    CONSTRAINT employee_cost_reservations_rollout_fkey
        FOREIGN KEY (tenant_id)
        REFERENCES tenant_employee_cost_ledger_rollouts(tenant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_reservations_employee_tenant_fkey
        FOREIGN KEY (employee_id, tenant_id)
        REFERENCES employees(id, "tenantId")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_reservations_day_period_fkey
        FOREIGN KEY (
            tenant_id,
            employee_id,
            day_period_kind,
            day_period_start,
            currency
        ) REFERENCES tenant_employee_cost_periods (
            tenant_id,
            employee_id,
            period_kind,
            period_start,
            currency
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_reservations_week_period_fkey
        FOREIGN KEY (
            tenant_id,
            employee_id,
            week_period_kind,
            week_period_start,
            currency
        ) REFERENCES tenant_employee_cost_periods (
            tenant_id,
            employee_id,
            period_kind,
            period_start,
            currency
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_reservations_surface_check
        CHECK (surface IN ('project_application', 'tenant_chat')),
    CONSTRAINT employee_cost_reservations_request_check
        CHECK (char_length(request_id) BETWEEN 1 AND 128),
    CONSTRAINT employee_cost_reservations_period_kind_check
        CHECK (day_period_kind = 'day' AND week_period_kind = 'week'),
    CONSTRAINT employee_cost_reservations_currency_check
        CHECK (currency = 'USD'),
    CONSTRAINT employee_cost_reservations_policy_check CHECK (
        pinned_policy_version >= 0
        AND enforcement_mode IN ('monitor', 'restrict_high_cost')
    ),
    CONSTRAINT employee_cost_reservations_daily_decision_check CHECK (
        daily_limit_micro_usd BETWEEN 0 AND 9007199254740991
        AND daily_warning_micro_usd BETWEEN 0 AND 9007199254740991
        AND (
            (
                daily_enabled
                AND daily_limit_micro_usd > 0
                AND daily_warning_micro_usd BETWEEN 1 AND daily_limit_micro_usd
            )
            OR (NOT daily_enabled AND daily_warning_micro_usd = 0)
        )
    ),
    CONSTRAINT employee_cost_reservations_weekly_decision_check CHECK (
        weekly_limit_micro_usd BETWEEN 0 AND 9007199254740991
        AND weekly_warning_micro_usd BETWEEN 0 AND 9007199254740991
        AND (
            (
                weekly_enabled
                AND weekly_limit_micro_usd > 0
                AND weekly_warning_micro_usd BETWEEN 1 AND weekly_limit_micro_usd
            )
            OR (NOT weekly_enabled AND weekly_warning_micro_usd = 0)
        )
    ),
    CONSTRAINT employee_cost_reservations_period_state_check CHECK (
        daily_state IN ('not_configured', 'normal', 'warning', 'exceeded')
        AND weekly_state IN ('not_configured', 'normal', 'warning', 'exceeded')
        AND (daily_enabled OR daily_state = 'not_configured')
        AND (NOT daily_enabled OR daily_state <> 'not_configured')
        AND (weekly_enabled OR weekly_state = 'not_configured')
        AND (NOT weekly_enabled OR weekly_state <> 'not_configured')
    ),
    CONSTRAINT employee_cost_reservations_outcome_check CHECK (
        enforcement_outcome IN (
            'not_configured',
            'monitored',
            'allowed',
            'restricted_to_lower_cost'
        )
    ),
    CONSTRAINT employee_cost_reservations_pricing_check CHECK (
        char_length(pricing_rule_id) BETWEEN 1 AND 128
        AND char_length(pricing_version) BETWEEN 1 AND 128
        AND pricing_version = btrim(pricing_version)
        AND char_length(estimate_version) BETWEEN 1 AND 64
    ),
    CONSTRAINT employee_cost_reservations_balances_check CHECK (
        reserved_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND confirmed_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND unconfirmed_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND (
            reserved_cost_micro_usd::numeric
            + confirmed_cost_micro_usd::numeric
            + unconfirmed_cost_micro_usd::numeric
        ) <= 9007199254740991
        AND ledger_version BETWEEN 0 AND 9007199254740991
    ),
    CONSTRAINT employee_cost_reservations_state_check
        CHECK (state IN ('reserved', 'settled', 'released', 'unconfirmed')),
    CONSTRAINT employee_cost_reservations_terminal_check CHECK (
        (
            state = 'reserved'
            AND terminal_at IS NULL
        )
        OR (
            state IN ('settled', 'released', 'unconfirmed')
            AND terminal_at IS NOT NULL
            AND usage_pending_at IS NULL
        )
    ),
    CONSTRAINT employee_cost_reservations_terminal_balances_check CHECK (
        state = 'reserved'
        OR (
            state = 'settled'
            AND reserved_cost_micro_usd = 0
            AND unconfirmed_cost_micro_usd = 0
        )
        OR (
            state = 'released'
            AND reserved_cost_micro_usd = 0
            AND confirmed_cost_micro_usd = 0
            AND unconfirmed_cost_micro_usd = 0
        )
        OR (
            state = 'unconfirmed'
            AND reserved_cost_micro_usd = 0
        )
    )
);

CREATE INDEX employee_cost_reservations_tenant_employee_state_idx
    ON tenant_employee_cost_reservations (
        tenant_id,
        employee_id,
        state,
        created_at DESC
    );

CREATE INDEX employee_cost_reservations_day_period_idx
    ON tenant_employee_cost_reservations (
        tenant_id,
        employee_id,
        day_period_start,
        currency
    );

CREATE INDEX employee_cost_reservations_week_period_idx
    ON tenant_employee_cost_reservations (
        tenant_id,
        employee_id,
        week_period_start,
        currency
    );

CREATE INDEX employee_cost_reservations_pending_idx
    ON tenant_employee_cost_reservations (usage_pending_at, reservation_id)
    WHERE state = 'reserved' AND usage_pending_at IS NOT NULL;

CREATE TABLE tenant_employee_cost_provider_attempts (
    surface text NOT NULL,
    request_id text NOT NULL,
    attempt_no smallint NOT NULL,
    reservation_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    kind text NOT NULL,
    provider_id text NOT NULL,
    model_key text NOT NULL,
    pricing_rule_id text NOT NULL,
    pricing_version text NOT NULL,
    input_micro_usd_per_million_tokens bigint NOT NULL,
    output_micro_usd_per_million_tokens bigint NOT NULL,
    cache_read_input_micro_usd_per_million_tokens bigint NULL,
    estimated_input_tokens bigint NOT NULL,
    max_output_tokens bigint NOT NULL,
    reserved_cost_micro_usd bigint NOT NULL,
    confirmed_input_tokens bigint NOT NULL DEFAULT 0,
    confirmed_cache_read_input_tokens bigint NOT NULL DEFAULT 0,
    confirmed_output_tokens bigint NOT NULL DEFAULT 0,
    confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
    unconfirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
    dispatch_state text NOT NULL DEFAULT 'not_started',
    outcome text NULL,
    usage_quality text NOT NULL DEFAULT 'not_available',
    started_at timestamptz NULL,
    usage_pending_at timestamptz NULL,
    completed_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_cost_attempts_pkey
        PRIMARY KEY (surface, request_id, attempt_no),
    CONSTRAINT employee_cost_attempts_reservation_fkey
        FOREIGN KEY (
            reservation_id,
            surface,
            request_id,
            tenant_id,
            employee_id
        ) REFERENCES tenant_employee_cost_reservations (
            reservation_id,
            surface,
            request_id,
            tenant_id,
            employee_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_attempts_number_check
        CHECK (attempt_no BETWEEN 1 AND 4),
    CONSTRAINT employee_cost_attempts_kind_check
        CHECK (kind IN ('primary', 'fallback')),
    CONSTRAINT employee_cost_attempts_identity_check CHECK (
        char_length(provider_id) BETWEEN 1 AND 128
        AND char_length(model_key) BETWEEN 1 AND 256
        AND char_length(pricing_rule_id) BETWEEN 1 AND 128
    ),
    CONSTRAINT employee_cost_attempts_pricing_check CHECK (
        char_length(pricing_version) BETWEEN 1 AND 128
        AND pricing_version = btrim(pricing_version)
        AND input_micro_usd_per_million_tokens
            BETWEEN 0 AND 9007199254740991
        AND output_micro_usd_per_million_tokens
            BETWEEN 0 AND 9007199254740991
        AND (
            cache_read_input_micro_usd_per_million_tokens IS NULL
            OR cache_read_input_micro_usd_per_million_tokens
                BETWEEN 0 AND 9007199254740991
        )
    ),
    CONSTRAINT employee_cost_attempts_cache_price_check CHECK (
        cache_read_input_micro_usd_per_million_tokens IS NULL
        OR cache_read_input_micro_usd_per_million_tokens
            <= input_micro_usd_per_million_tokens
    ),
    CONSTRAINT employee_cost_attempts_usage_check CHECK (
        estimated_input_tokens BETWEEN 1 AND 9007199254740991
        AND max_output_tokens BETWEEN 1 AND 9007199254740991
        AND confirmed_input_tokens BETWEEN 0 AND 9007199254740991
        AND confirmed_cache_read_input_tokens
            BETWEEN 0 AND 9007199254740991
        AND confirmed_cache_read_input_tokens <= confirmed_input_tokens
        AND confirmed_output_tokens BETWEEN 0 AND 9007199254740991
    ),
    CONSTRAINT employee_cost_attempts_cost_check CHECK (
        reserved_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND confirmed_cost_micro_usd BETWEEN 0 AND 9007199254740991
        AND unconfirmed_cost_micro_usd BETWEEN 0 AND 9007199254740991
    ),
    CONSTRAINT employee_cost_attempts_dispatch_check
        CHECK (dispatch_state IN ('not_started', 'started')),
    CONSTRAINT employee_cost_attempts_outcome_check CHECK (
        outcome IS NULL OR outcome IN (
            'succeeded',
            'failed_pre_delta',
            'failed_post_delta',
            'cancelled',
            'timed_out'
        )
    ),
    CONSTRAINT employee_cost_attempts_quality_check CHECK (
        usage_quality IN ('not_available', 'confirmed', 'pending_unconfirmed')
        AND (
            (
                usage_quality = 'pending_unconfirmed'
                AND usage_pending_at IS NOT NULL
                AND completed_at IS NOT NULL
            )
            OR (
                usage_quality <> 'pending_unconfirmed'
                AND usage_pending_at IS NULL
            )
        )
        AND (
            usage_quality <> 'confirmed'
            OR (completed_at IS NOT NULL AND outcome IS NOT NULL)
        )
        AND (
            usage_quality <> 'pending_unconfirmed'
            OR dispatch_state = 'started'
        )
        AND (dispatch_state <> 'started' OR started_at IS NOT NULL)
        AND (
            started_at IS NULL
            OR completed_at IS NULL
            OR completed_at >= started_at
        )
    )
);

CREATE INDEX employee_cost_attempts_reservation_idx
    ON tenant_employee_cost_provider_attempts (
        reservation_id,
        surface,
        request_id,
        tenant_id,
        employee_id,
        attempt_no
    );

CREATE INDEX employee_cost_attempts_tenant_employee_completed_idx
    ON tenant_employee_cost_provider_attempts (
        tenant_id,
        employee_id,
        completed_at DESC
    );

CREATE INDEX employee_cost_attempts_pending_idx
    ON tenant_employee_cost_provider_attempts (
        usage_pending_at,
        reservation_id,
        attempt_no
    ) WHERE usage_quality = 'pending_unconfirmed';

CREATE TABLE tenant_employee_cost_ledger_entries (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    surface text NOT NULL,
    request_id text NOT NULL,
    attempt_no smallint NULL,
    event_version bigint NOT NULL,
    event_type text NOT NULL,
    reserved_cost_micro_usd_delta bigint NOT NULL DEFAULT 0,
    confirmed_cost_micro_usd_delta bigint NOT NULL DEFAULT 0,
    unconfirmed_cost_micro_usd_delta bigint NOT NULL DEFAULT 0,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT employee_cost_ledger_reservation_version_key
        UNIQUE (reservation_id, event_version),
    CONSTRAINT employee_cost_ledger_reservation_fkey
        FOREIGN KEY (
            reservation_id,
            surface,
            request_id,
            tenant_id,
            employee_id
        ) REFERENCES tenant_employee_cost_reservations (
            reservation_id,
            surface,
            request_id,
            tenant_id,
            employee_id
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_ledger_attempt_fkey
        FOREIGN KEY (surface, request_id, attempt_no)
        REFERENCES tenant_employee_cost_provider_attempts (
            surface,
            request_id,
            attempt_no
        ) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT employee_cost_ledger_event_version_check
        CHECK (event_version BETWEEN 1 AND 9007199254740991),
    CONSTRAINT employee_cost_ledger_event_type_check CHECK (
        event_type IN (
            'reserve',
            'top_up',
            'settle',
            'release',
            'unconfirmed',
            'late_correction'
        )
    ),
    CONSTRAINT employee_cost_ledger_attempt_event_check CHECK (
        event_type NOT IN ('top_up', 'settle', 'unconfirmed', 'late_correction')
        OR attempt_no IS NOT NULL
    ),
    CONSTRAINT employee_cost_ledger_delta_check CHECK (
        reserved_cost_micro_usd_delta
            BETWEEN -9007199254740991 AND 9007199254740991
        AND confirmed_cost_micro_usd_delta
            BETWEEN -9007199254740991 AND 9007199254740991
        AND unconfirmed_cost_micro_usd_delta
            BETWEEN -9007199254740991 AND 9007199254740991
    )
);

CREATE INDEX employee_cost_ledger_reservation_idx
    ON tenant_employee_cost_ledger_entries (
        reservation_id,
        event_version
    );

CREATE INDEX employee_cost_ledger_tenant_employee_occurred_idx
    ON tenant_employee_cost_ledger_entries (
        tenant_id,
        employee_id,
        occurred_at DESC
    );
