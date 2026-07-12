-- Contract DDL for tenant-chat/v1. This file is not an applied migration.
-- The implementation migration must preserve these names, types, constraints,
-- indexes, tenant predicates, and additive/expand-first semantics.

CREATE TABLE tenant_chat_request_admissions (
  admission_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employee_id uuid NULL REFERENCES employees(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL,
  request_id text NOT NULL,
  turn_id text NOT NULL,
  idempotency_key text NOT NULL,
  binding_digest text NOT NULL,
  snapshot_version bigint NOT NULL,
  state text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  slot_released_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_admission_request_key UNIQUE (request_id),
  CONSTRAINT tenant_chat_admission_idempotency_key UNIQUE (tenant_id, user_id, idempotency_key),
  CONSTRAINT tenant_chat_admission_actor_check CHECK (
    (actor_kind = 'employee' AND employee_id IS NOT NULL)
    OR (actor_kind = 'tenant_admin')
  ),
  CONSTRAINT tenant_chat_admission_state_check CHECK (state IN ('active', 'consumed', 'cancelled', 'expired')),
  CONSTRAINT tenant_chat_admission_snapshot_version_check CHECK (snapshot_version > 0),
  CONSTRAINT tenant_chat_admission_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT tenant_chat_admission_id_length_check CHECK (
    char_length(request_id) BETWEEN 1 AND 128
    AND char_length(turn_id) BETWEEN 1 AND 128
    AND char_length(idempotency_key) BETWEEN 1 AND 128
  )
);

CREATE INDEX tenant_chat_admission_tenant_state_expiry_idx
  ON tenant_chat_request_admissions (tenant_id, state, expires_at);
CREATE INDEX tenant_chat_admission_tenant_user_created_idx
  ON tenant_chat_request_admissions (tenant_id, user_id, created_at DESC);
CREATE INDEX tenant_chat_admission_user_idx
  ON tenant_chat_request_admissions (user_id);
CREATE INDEX tenant_chat_admission_employee_idx
  ON tenant_chat_request_admissions (employee_id) WHERE employee_id IS NOT NULL;

CREATE TABLE tenant_chat_user_token_periods (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  period_timezone text NOT NULL,
  limit_tokens bigint NOT NULL,
  warning_threshold_tokens bigint NOT NULL,
  economy_threshold_tokens bigint NOT NULL,
  hard_stop_tokens bigint NOT NULL,
  reserved_tokens bigint NOT NULL DEFAULT 0,
  confirmed_input_tokens bigint NOT NULL DEFAULT 0,
  confirmed_output_tokens bigint NOT NULL DEFAULT 0,
  confirmed_total_tokens bigint NOT NULL DEFAULT 0,
  unconfirmed_tokens bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'normal',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, period_start),
  CONSTRAINT tenant_chat_user_period_range_check CHECK (period_end > period_start),
  CONSTRAINT tenant_chat_user_period_limits_check CHECK (
    limit_tokens >= 0
    AND (
      (
        limit_tokens = 0
        AND warning_threshold_tokens = 0
        AND economy_threshold_tokens = 0
        AND hard_stop_tokens = 0
        AND state = 'blocked'
      )
      OR (
        limit_tokens > 0
        AND warning_threshold_tokens >= 0
        AND warning_threshold_tokens < economy_threshold_tokens
        AND economy_threshold_tokens < hard_stop_tokens
      )
    )
  ),
  CONSTRAINT tenant_chat_user_period_balances_check CHECK (
    reserved_tokens >= 0
    AND confirmed_input_tokens >= 0
    AND confirmed_output_tokens >= 0
    AND confirmed_total_tokens = confirmed_input_tokens + confirmed_output_tokens
    AND unconfirmed_tokens >= 0
  ),
  CONSTRAINT tenant_chat_user_period_state_check CHECK (state IN ('normal', 'warning', 'economy', 'blocked')),
  CONSTRAINT tenant_chat_user_period_version_check CHECK (version > 0)
);

CREATE INDEX tenant_chat_user_period_tenant_state_idx
  ON tenant_chat_user_token_periods (tenant_id, state, period_start DESC);
CREATE INDEX tenant_chat_user_period_user_idx
  ON tenant_chat_user_token_periods (user_id, period_start DESC);

CREATE TABLE tenant_chat_tenant_cost_periods (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  period_timezone text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  limit_micro_usd bigint NOT NULL,
  warning_threshold_micro_usd bigint NOT NULL,
  economy_threshold_micro_usd bigint NOT NULL,
  hard_stop_micro_usd bigint NOT NULL,
  reserved_cost_micro_usd bigint NOT NULL DEFAULT 0,
  confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
  unconfirmed_exposure_micro_usd bigint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'normal',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_start, currency),
  CONSTRAINT tenant_chat_cost_period_range_check CHECK (period_end > period_start),
  CONSTRAINT tenant_chat_cost_period_currency_check CHECK (currency = 'USD'),
  CONSTRAINT tenant_chat_cost_period_limits_check CHECK (
    limit_micro_usd >= 0
    AND (
      (
        limit_micro_usd = 0
        AND warning_threshold_micro_usd = 0
        AND economy_threshold_micro_usd = 0
        AND hard_stop_micro_usd = 0
        AND state = 'blocked'
      )
      OR (
        limit_micro_usd > 0
        AND warning_threshold_micro_usd >= 0
        AND warning_threshold_micro_usd < economy_threshold_micro_usd
        AND economy_threshold_micro_usd < hard_stop_micro_usd
        AND hard_stop_micro_usd = limit_micro_usd
      )
    )
  ),
  CONSTRAINT tenant_chat_cost_period_balances_check CHECK (
    reserved_cost_micro_usd >= 0
    AND confirmed_cost_micro_usd >= 0
    AND unconfirmed_exposure_micro_usd >= 0
  ),
  CONSTRAINT tenant_chat_cost_period_state_check CHECK (state IN ('normal', 'warning', 'economy', 'blocked')),
  CONSTRAINT tenant_chat_cost_period_version_check CHECK (version > 0)
);

CREATE INDEX tenant_chat_cost_period_state_idx
  ON tenant_chat_tenant_cost_periods (tenant_id, state, period_start DESC);

CREATE TABLE tenant_chat_usage_reservations (
  reservation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  request_id text NOT NULL,
  turn_id text NOT NULL,
  idempotency_key text NOT NULL,
  user_period_start timestamptz NOT NULL,
  tenant_period_start timestamptz NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  snapshot_version bigint NOT NULL,
  snapshot_digest text NOT NULL,
  pricing_version bigint NOT NULL,
  state text NOT NULL DEFAULT 'reserved',
  reserved_tokens bigint NOT NULL DEFAULT 0,
  reserved_cost_micro_usd bigint NOT NULL DEFAULT 0,
  confirmed_input_tokens bigint NOT NULL DEFAULT 0,
  confirmed_output_tokens bigint NOT NULL DEFAULT 0,
  confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
  unconfirmed_tokens bigint NOT NULL DEFAULT 0,
  unconfirmed_exposure_micro_usd bigint NOT NULL DEFAULT 0,
  ledger_version bigint NOT NULL DEFAULT 0,
  reserved_at timestamptz NOT NULL,
  terminal_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_reservation_request_key UNIQUE (request_id),
  CONSTRAINT tenant_chat_reservation_identity_key UNIQUE (reservation_id, request_id, tenant_id),
  CONSTRAINT tenant_chat_reservation_idempotency_key UNIQUE (tenant_id, user_id, idempotency_key),
  -- The referenced user-period row already has direct tenant/user FKs;
  -- duplicate direct FKs on this reservation are intentionally omitted.
  CONSTRAINT tenant_chat_reservation_user_period_fkey
    FOREIGN KEY (tenant_id, user_id, user_period_start)
    REFERENCES tenant_chat_user_token_periods (tenant_id, user_id, period_start) ON DELETE RESTRICT,
  CONSTRAINT tenant_chat_reservation_cost_period_fkey
    FOREIGN KEY (tenant_id, tenant_period_start, currency)
    REFERENCES tenant_chat_tenant_cost_periods (tenant_id, period_start, currency) ON DELETE RESTRICT,
  CONSTRAINT tenant_chat_reservation_state_check CHECK (state IN ('reserved', 'settled', 'released', 'unconfirmed')),
  CONSTRAINT tenant_chat_reservation_currency_check CHECK (currency = 'USD'),
  CONSTRAINT tenant_chat_reservation_balances_check CHECK (
    reserved_tokens >= 0
    AND reserved_cost_micro_usd >= 0
    AND confirmed_input_tokens >= 0
    AND confirmed_output_tokens >= 0
    AND confirmed_cost_micro_usd >= 0
    AND unconfirmed_tokens >= 0
    AND unconfirmed_exposure_micro_usd >= 0
    AND ledger_version >= 0
  ),
  CONSTRAINT tenant_chat_reservation_version_check CHECK (snapshot_version > 0 AND pricing_version > 0),
  CONSTRAINT tenant_chat_reservation_terminal_check CHECK (
    (state = 'reserved' AND terminal_at IS NULL)
    OR (state IN ('settled', 'released', 'unconfirmed') AND terminal_at IS NOT NULL)
  )
);

CREATE INDEX tenant_chat_reservation_tenant_state_created_idx
  ON tenant_chat_usage_reservations (tenant_id, state, created_at);
CREATE INDEX tenant_chat_reservation_user_period_idx
  ON tenant_chat_usage_reservations (tenant_id, user_id, user_period_start);
CREATE INDEX tenant_chat_reservation_cost_period_idx
  ON tenant_chat_usage_reservations (tenant_id, tenant_period_start, currency);

CREATE TABLE tenant_chat_provider_attempts (
  request_id text NOT NULL,
  attempt_no smallint NOT NULL,
  reservation_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  provider_id text NOT NULL,
  model_key text NOT NULL,
  pricing_version bigint NOT NULL,
  input_micro_usd_per_million_tokens bigint NOT NULL,
  output_micro_usd_per_million_tokens bigint NOT NULL,
  cache_read_input_micro_usd_per_million_tokens bigint NULL,
  estimated_input_tokens bigint NOT NULL,
  max_output_tokens bigint NOT NULL,
  reserved_cost_micro_usd bigint NOT NULL,
  confirmed_input_tokens bigint NOT NULL DEFAULT 0,
  confirmed_output_tokens bigint NOT NULL DEFAULT 0,
  confirmed_cache_read_input_tokens bigint NOT NULL DEFAULT 0,
  confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
  outcome text NULL,
  usage_quality text NOT NULL DEFAULT 'not_available',
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, attempt_no),
  CONSTRAINT tenant_chat_attempt_reservation_request_fkey
    FOREIGN KEY (reservation_id, request_id, tenant_id)
    REFERENCES tenant_chat_usage_reservations (reservation_id, request_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_chat_attempt_number_check CHECK (attempt_no BETWEEN 1 AND 4),
  CONSTRAINT tenant_chat_attempt_kind_check CHECK (kind IN ('primary', 'fallback')),
  CONSTRAINT tenant_chat_attempt_outcome_check CHECK (
    outcome IS NULL OR outcome IN ('succeeded', 'failed_pre_delta', 'failed_post_delta', 'cancelled', 'timed_out')
  ),
  CONSTRAINT tenant_chat_attempt_usage_quality_check CHECK (usage_quality IN ('confirmed', 'pending_unconfirmed', 'not_available')),
  CONSTRAINT tenant_chat_attempt_amounts_check CHECK (
    pricing_version > 0
    AND input_micro_usd_per_million_tokens >= 0
    AND output_micro_usd_per_million_tokens >= 0
    AND (
      cache_read_input_micro_usd_per_million_tokens IS NULL
      OR cache_read_input_micro_usd_per_million_tokens >= 0
    )
    AND estimated_input_tokens >= 0
    AND max_output_tokens > 0
    AND reserved_cost_micro_usd >= 0
    AND confirmed_input_tokens >= 0
    AND confirmed_output_tokens >= 0
    AND confirmed_cache_read_input_tokens >= 0
    AND confirmed_cache_read_input_tokens <= confirmed_input_tokens
    AND confirmed_cost_micro_usd >= 0
  )
);

CREATE INDEX tenant_chat_attempt_reservation_idx
  ON tenant_chat_provider_attempts (reservation_id, request_id, tenant_id, attempt_no);
CREATE INDEX tenant_chat_attempt_tenant_completed_idx
  ON tenant_chat_provider_attempts (tenant_id, completed_at DESC);

CREATE TABLE tenant_chat_usage_ledger_entries (
  request_id text NOT NULL,
  ledger_version bigint NOT NULL,
  event_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  reserved_tokens_delta bigint NOT NULL DEFAULT 0,
  confirmed_input_tokens_delta bigint NOT NULL DEFAULT 0,
  confirmed_output_tokens_delta bigint NOT NULL DEFAULT 0,
  unconfirmed_tokens_delta bigint NOT NULL DEFAULT 0,
  reserved_cost_micro_usd_delta bigint NOT NULL DEFAULT 0,
  confirmed_cost_micro_usd_delta bigint NOT NULL DEFAULT 0,
  unconfirmed_exposure_micro_usd_delta bigint NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, ledger_version),
  CONSTRAINT tenant_chat_ledger_event_key UNIQUE (event_id),
  CONSTRAINT tenant_chat_ledger_reservation_request_fkey
    FOREIGN KEY (reservation_id, request_id, tenant_id)
    REFERENCES tenant_chat_usage_reservations (reservation_id, request_id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT tenant_chat_ledger_version_check CHECK (ledger_version > 0),
  CONSTRAINT tenant_chat_ledger_event_type_check CHECK (
    event_type IN ('usage_reserved', 'usage_topped_up', 'usage_settled', 'usage_released', 'usage_unconfirmed')
  ),
  CONSTRAINT tenant_chat_ledger_confirmed_delta_check CHECK (
    confirmed_input_tokens_delta >= 0
    AND confirmed_output_tokens_delta >= 0
    AND confirmed_cost_micro_usd_delta >= 0
  )
);

CREATE INDEX tenant_chat_ledger_tenant_occurred_idx
  ON tenant_chat_usage_ledger_entries (tenant_id, occurred_at DESC);
CREATE INDEX tenant_chat_ledger_reservation_idx
  ON tenant_chat_usage_ledger_entries (reservation_id, request_id, tenant_id, ledger_version);

CREATE TABLE tenant_chat_invocation_outbox (
  event_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  event_version bigint NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  delivery_attempts integer NOT NULL DEFAULT 0,
  last_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_outbox_idempotency_key UNIQUE (aggregate_id, event_type, event_version),
  CONSTRAINT tenant_chat_outbox_event_version_check CHECK (event_version > 0),
  CONSTRAINT tenant_chat_outbox_event_type_check CHECK (
    event_type IN (
      'usage_reserved',
      'usage_topped_up',
      'usage_settled',
      'usage_released',
      'usage_unconfirmed',
      'invocation_terminal'
    )
  ),
  CONSTRAINT tenant_chat_outbox_attempts_check CHECK (delivery_attempts >= 0),
  CONSTRAINT tenant_chat_outbox_payload_check CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload->>'requestId' = aggregate_id
    AND payload->>'eventType' = event_type
  )
);

CREATE INDEX tenant_chat_outbox_delivery_idx
  ON tenant_chat_invocation_outbox (published_at, available_at, created_at);
CREATE INDEX tenant_chat_outbox_tenant_created_idx
  ON tenant_chat_invocation_outbox (tenant_id, created_at DESC);

CREATE TABLE tenant_chat_invocation_logs (
  request_id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  employee_id uuid NULL REFERENCES employees(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL,
  turn_id text NOT NULL,
  surface text NOT NULL DEFAULT 'tenant_chat',
  execution_scope_kind text NOT NULL DEFAULT 'tenant_chat',
  snapshot_version bigint NOT NULL,
  snapshot_digest text NOT NULL,
  pricing_version bigint NOT NULL,
  terminal_outcome text NOT NULL,
  effective_provider_id text NULL,
  effective_model_key text NULL,
  attempt_count smallint NOT NULL DEFAULT 0,
  confirmed_input_tokens bigint NOT NULL DEFAULT 0,
  confirmed_output_tokens bigint NOT NULL DEFAULT 0,
  confirmed_total_tokens bigint NOT NULL DEFAULT 0,
  confirmed_cost_micro_usd bigint NOT NULL DEFAULT 0,
  quota_state text NOT NULL,
  budget_state text NOT NULL,
  cache_outcome text NOT NULL,
  latency_ms bigint NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  projected_event_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_chat_log_actor_check CHECK (
    (actor_kind = 'employee' AND employee_id IS NOT NULL)
    OR (actor_kind = 'tenant_admin')
  ),
  CONSTRAINT tenant_chat_log_scope_check CHECK (surface = 'tenant_chat' AND execution_scope_kind = 'tenant_chat'),
  CONSTRAINT tenant_chat_log_outcome_check CHECK (
    terminal_outcome IN (
      'succeeded',
      'failed',
      'cancelled',
      'cache_hit',
      'rate_limited',
      'concurrency_limited',
      'safety_blocked',
      'policy_ack_required',
      'quota_blocked',
      'budget_blocked',
      'runtime_unavailable',
      'no_eligible_route',
      'provider_failed',
      'provider_timeout'
    )
  ),
  CONSTRAINT tenant_chat_log_policy_state_check CHECK (
    quota_state IN ('normal', 'warning', 'economy', 'blocked')
    AND budget_state IN ('normal', 'warning', 'economy', 'blocked')
  ),
  CONSTRAINT tenant_chat_log_cache_check CHECK (cache_outcome IN ('off', 'hit', 'miss')),
  CONSTRAINT tenant_chat_log_amounts_check CHECK (
    snapshot_version > 0
    AND pricing_version > 0
    AND attempt_count BETWEEN 0 AND 4
    AND confirmed_input_tokens >= 0
    AND confirmed_output_tokens >= 0
    AND confirmed_total_tokens = confirmed_input_tokens + confirmed_output_tokens
    AND confirmed_cost_micro_usd >= 0
    AND latency_ms >= 0
    AND projected_event_version > 0
    AND completed_at >= started_at
  )
);

CREATE INDEX tenant_chat_log_tenant_completed_idx
  ON tenant_chat_invocation_logs (tenant_id, completed_at DESC);
CREATE INDEX tenant_chat_log_tenant_user_completed_idx
  ON tenant_chat_invocation_logs (tenant_id, user_id, completed_at DESC);
CREATE INDEX tenant_chat_log_tenant_outcome_completed_idx
  ON tenant_chat_invocation_logs (tenant_id, terminal_outcome, completed_at DESC);
CREATE INDEX tenant_chat_log_user_idx
  ON tenant_chat_invocation_logs (user_id, completed_at DESC);
CREATE INDEX tenant_chat_log_employee_idx
  ON tenant_chat_invocation_logs (employee_id) WHERE employee_id IS NOT NULL;

-- No DROP/DOWN statement belongs in the implementation migration. Runtime roles
-- receive only the table privileges required by the ownership matrix; DDL stays
-- with the migration role. Raw content, JWTs, secrets, provider error bodies,
-- canonical bytes, and HMAC keys are forbidden in every table above.
