-- Dashboard rollups are an additive PostgreSQL read model.
-- They intentionally do not reference p0_llm_invocation_logs because Control Plane
-- migrations run before Gateway runtime SQL on a fresh installation.

CREATE TABLE dashboard_rollup_source_cursors (
    source text NOT NULL,
    cursor_at timestamptz NULL,
    cursor_key text NOT NULL DEFAULT '',
    last_discovered_at timestamptz NULL,
    caught_up_at timestamptz NULL,
    caught_up_through timestamptz NULL,
    last_reconciled_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dashboard_rollup_source_cursors_pkey PRIMARY KEY (source),
    CONSTRAINT dashboard_rollup_source_cursors_source_check
        CHECK (source IN ('project_application', 'tenant_chat'))
);

CREATE TABLE dashboard_rollup_dirty_buckets (
    tenant_id uuid NOT NULL,
    surface text NOT NULL,
    grain text NOT NULL,
    bucket_start timestamptz NOT NULL,
    reason_code text NOT NULL,
    available_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dashboard_rollup_dirty_buckets_pkey
        PRIMARY KEY (tenant_id, surface, grain, bucket_start),
    CONSTRAINT dashboard_rollup_dirty_buckets_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_rollup_dirty_buckets_surface_check
        CHECK (surface IN ('project_application', 'tenant_chat')),
    CONSTRAINT dashboard_rollup_dirty_buckets_grain_check
        CHECK (grain IN ('hour', 'day', 'month')),
    CONSTRAINT dashboard_rollup_dirty_buckets_attempts_check
        CHECK (attempts >= 0)
);

CREATE INDEX dashboard_rollup_dirty_claim_idx
    ON dashboard_rollup_dirty_buckets (available_at, grain, bucket_start, tenant_id);

CREATE TABLE dashboard_rollup_bucket_states (
    tenant_id uuid NOT NULL,
    surface text NOT NULL,
    grain text NOT NULL,
    bucket_start timestamptz NOT NULL,
    state text NOT NULL,
    source_max_at timestamptz NULL,
    aggregated_at timestamptz NULL,
    histogram_version integer NOT NULL DEFAULT 1,
    last_error_code text NULL,
    total_row_count integer NOT NULL DEFAULT 0,
    dimension_row_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dashboard_rollup_bucket_states_pkey
        PRIMARY KEY (tenant_id, surface, grain, bucket_start),
    CONSTRAINT dashboard_rollup_bucket_states_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_rollup_bucket_states_surface_check
        CHECK (surface IN ('project_application', 'tenant_chat')),
    CONSTRAINT dashboard_rollup_bucket_states_grain_check
        CHECK (grain IN ('hour', 'day', 'month')),
    CONSTRAINT dashboard_rollup_bucket_states_state_check
        CHECK (state IN ('building', 'ready', 'error')),
    CONSTRAINT dashboard_rollup_bucket_states_histogram_version_check
        CHECK (histogram_version > 0),
    CONSTRAINT dashboard_rollup_bucket_states_counts_check
        CHECK (total_row_count >= 0 AND dimension_row_count >= 0)
);

CREATE TABLE dashboard_rollup_totals (
    tenant_id uuid NOT NULL,
    surface text NOT NULL,
    grain text NOT NULL,
    bucket_start timestamptz NOT NULL,
    project_id text NOT NULL DEFAULT '',
    application_id text NOT NULL DEFAULT '',
    budget_scope_type text NOT NULL DEFAULT '',
    budget_scope_id text NOT NULL DEFAULT '',
    budget_scope_resolved_by text NOT NULL DEFAULT '',

    request_count bigint NOT NULL DEFAULT 0,
    successful_request_count bigint NOT NULL DEFAULT 0,
    failed_request_count bigint NOT NULL DEFAULT 0,
    blocked_request_count bigint NOT NULL DEFAULT 0,
    rate_limited_request_count bigint NOT NULL DEFAULT 0,
    cancelled_request_count bigint NOT NULL DEFAULT 0,
    cache_hit_request_count bigint NOT NULL DEFAULT 0,
    cache_eligible_request_count bigint NOT NULL DEFAULT 0,
    fallback_success_request_count bigint NOT NULL DEFAULT 0,
    prompt_tokens bigint NOT NULL DEFAULT 0,
    completion_tokens bigint NOT NULL DEFAULT 0,
    total_tokens bigint NOT NULL DEFAULT 0,
    cost_micro_usd bigint NOT NULL DEFAULT 0,
    saved_cost_micro_usd bigint NOT NULL DEFAULT 0,
    attempt_count bigint NOT NULL DEFAULT 0,
    billable_attempt_count bigint NOT NULL DEFAULT 0,
    fallback_request_count bigint NOT NULL DEFAULT 0,

    latency_count bigint NOT NULL DEFAULT 0,
    latency_sum_ms bigint NOT NULL DEFAULT 0,
    latency_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    gateway_internal_latency_count bigint NOT NULL DEFAULT 0,
    gateway_internal_latency_sum_ms bigint NOT NULL DEFAULT 0,
    gateway_internal_latency_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    provider_latency_count bigint NOT NULL DEFAULT 0,
    provider_latency_sum_ms bigint NOT NULL DEFAULT 0,
    provider_latency_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    stream_request_count bigint NOT NULL DEFAULT 0,
    ttft_count bigint NOT NULL DEFAULT 0,
    ttft_sum_ms bigint NOT NULL DEFAULT 0,
    ttft_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    histogram_version integer NOT NULL DEFAULT 1,
    source_max_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dashboard_rollup_totals_pkey PRIMARY KEY (
        tenant_id,
        surface,
        grain,
        bucket_start,
        project_id,
        application_id,
        budget_scope_type,
        budget_scope_id,
        budget_scope_resolved_by
    ),
    CONSTRAINT dashboard_rollup_totals_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_rollup_totals_surface_check
        CHECK (surface IN ('project_application', 'tenant_chat')),
    CONSTRAINT dashboard_rollup_totals_grain_check
        CHECK (grain IN ('hour', 'day', 'month')),
    CONSTRAINT dashboard_rollup_totals_histogram_version_check
        CHECK (histogram_version > 0),
    CONSTRAINT dashboard_rollup_totals_histogram_size_check CHECK (
        cardinality(latency_histogram) = 18
        AND cardinality(gateway_internal_latency_histogram) = 18
        AND cardinality(provider_latency_histogram) = 18
        AND cardinality(ttft_histogram) = 18
    )
);

CREATE INDEX dashboard_rollup_totals_project_idx
    ON dashboard_rollup_totals (tenant_id, surface, project_id, grain, bucket_start);
CREATE INDEX dashboard_rollup_totals_application_idx
    ON dashboard_rollup_totals (tenant_id, surface, application_id, grain, bucket_start);
CREATE INDEX dashboard_rollup_totals_budget_idx
    ON dashboard_rollup_totals (
        tenant_id,
        surface,
        budget_scope_type,
        budget_scope_id,
        budget_scope_resolved_by,
        grain,
        bucket_start
    );

CREATE TABLE dashboard_rollup_dimensions (
    tenant_id uuid NOT NULL,
    surface text NOT NULL,
    grain text NOT NULL,
    bucket_start timestamptz NOT NULL,
    project_id text NOT NULL DEFAULT '',
    application_id text NOT NULL DEFAULT '',
    budget_scope_type text NOT NULL DEFAULT '',
    budget_scope_id text NOT NULL DEFAULT '',
    budget_scope_resolved_by text NOT NULL DEFAULT '',
    dimension_type text NOT NULL,
    dimension_value text NOT NULL DEFAULT '',
    dimension_value_2 text NOT NULL DEFAULT '',
    dimension_value_3 text NOT NULL DEFAULT '',

    request_count bigint NOT NULL DEFAULT 0,
    successful_request_count bigint NOT NULL DEFAULT 0,
    failed_request_count bigint NOT NULL DEFAULT 0,
    cache_hit_request_count bigint NOT NULL DEFAULT 0,
    cache_eligible_request_count bigint NOT NULL DEFAULT 0,
    fallback_success_request_count bigint NOT NULL DEFAULT 0,
    prompt_tokens bigint NOT NULL DEFAULT 0,
    completion_tokens bigint NOT NULL DEFAULT 0,
    total_tokens bigint NOT NULL DEFAULT 0,
    cost_micro_usd bigint NOT NULL DEFAULT 0,
    saved_cost_micro_usd bigint NOT NULL DEFAULT 0,
    attempt_count bigint NOT NULL DEFAULT 0,
    billable_attempt_count bigint NOT NULL DEFAULT 0,
    fallback_request_count bigint NOT NULL DEFAULT 0,

    latency_count bigint NOT NULL DEFAULT 0,
    latency_sum_ms bigint NOT NULL DEFAULT 0,
    latency_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    gateway_internal_latency_count bigint NOT NULL DEFAULT 0,
    gateway_internal_latency_sum_ms bigint NOT NULL DEFAULT 0,
    gateway_internal_latency_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    provider_latency_count bigint NOT NULL DEFAULT 0,
    provider_latency_sum_ms bigint NOT NULL DEFAULT 0,
    provider_latency_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    stream_request_count bigint NOT NULL DEFAULT 0,
    ttft_count bigint NOT NULL DEFAULT 0,
    ttft_sum_ms bigint NOT NULL DEFAULT 0,
    ttft_histogram bigint[] NOT NULL DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::bigint[],
    histogram_version integer NOT NULL DEFAULT 1,
    source_max_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT dashboard_rollup_dimensions_pkey PRIMARY KEY (
        tenant_id,
        surface,
        grain,
        bucket_start,
        project_id,
        application_id,
        budget_scope_type,
        budget_scope_id,
        budget_scope_resolved_by,
        dimension_type,
        dimension_value,
        dimension_value_2,
        dimension_value_3
    ),
    CONSTRAINT dashboard_rollup_dimensions_tenant_fkey
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT dashboard_rollup_dimensions_surface_check
        CHECK (surface IN ('project_application', 'tenant_chat')),
    CONSTRAINT dashboard_rollup_dimensions_grain_check
        CHECK (grain IN ('hour', 'day', 'month')),
    CONSTRAINT dashboard_rollup_dimensions_type_check CHECK (
        dimension_type IN (
            'terminal_status',
            'provider_model',
            'masking_action',
            'safety_outcome',
            'cache_outcome',
            'fallback_outcome',
            'budget_outcome',
            'routing',
            'quota_state',
            'budget_state',
            'snapshot_pricing'
        )
    ),
    CONSTRAINT dashboard_rollup_dimensions_histogram_version_check
        CHECK (histogram_version > 0),
    CONSTRAINT dashboard_rollup_dimensions_histogram_size_check CHECK (
        cardinality(latency_histogram) = 18
        AND cardinality(gateway_internal_latency_histogram) = 18
        AND cardinality(provider_latency_histogram) = 18
        AND cardinality(ttft_histogram) = 18
    )
);

CREATE INDEX dashboard_rollup_dimensions_lookup_idx
    ON dashboard_rollup_dimensions (
        tenant_id,
        surface,
        dimension_type,
        grain,
        bucket_start
    );
CREATE INDEX dashboard_rollup_dimensions_project_idx
    ON dashboard_rollup_dimensions (
        tenant_id,
        surface,
        project_id,
        dimension_type,
        grain,
        bucket_start
    );
CREATE INDEX dashboard_rollup_dimensions_application_idx
    ON dashboard_rollup_dimensions (
        tenant_id,
        surface,
        application_id,
        dimension_type,
        grain,
        bucket_start
    );
