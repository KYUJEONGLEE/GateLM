-- Hot-path read models for one-second dashboard polling.
--
-- PostgreSQL and analytics.llm_invocations remain the canonical audit path.
-- Existing data is intentionally not backfilled here: on an existing volume,
-- pause the ClickHouse mirror and run maintenance/backfill_dashboard_rollups.sql
-- once before enabling the new reader.

CREATE TABLE IF NOT EXISTS analytics.llm_invocations_by_time
AS analytics.llm_invocations
ENGINE = ReplacingMergeTree(ingest_version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, created_at, request_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.llm_invocations_by_time_mv
TO analytics.llm_invocations_by_time
AS
SELECT *
FROM analytics.llm_invocations;

CREATE TABLE IF NOT EXISTS analytics.llm_invocations_dashboard_second_rollup
(
    tenant_id UUID,
    bucket DateTime('UTC'),
    project_id UUID,
    application_id UUID,
    provider LowCardinality(String),
    model LowCardinality(String),
    requested_model LowCardinality(String),
    terminal_status LowCardinality(String),
    cache_outcome LowCardinality(String),
    cache_type LowCardinality(String),
    fallback_outcome LowCardinality(String),
    safety_outcome LowCardinality(String),
    budget_outcome LowCardinality(String),
    masking_action LowCardinality(String),
    routing_category LowCardinality(String),
    routing_difficulty LowCardinality(String),
    routing_reason LowCardinality(String),
    budget_scope_type LowCardinality(String),
    budget_scope_id String CODEC(ZSTD(3)),
    budget_scope_resolved_by LowCardinality(String),
    latency_eligible UInt8,
    provider_latency_eligible UInt8,
    ttft_eligible UInt8,

    requests SimpleAggregateFunction(sum, UInt64),
    prompt_tokens SimpleAggregateFunction(sum, UInt64),
    completion_tokens SimpleAggregateFunction(sum, UInt64),
    total_tokens SimpleAggregateFunction(sum, UInt64),
    cost_micro_usd SimpleAggregateFunction(sum, Int64),
    saved_cost_micro_usd SimpleAggregateFunction(sum, Int64),
    saved_cost_known_requests SimpleAggregateFunction(sum, UInt64),
    system_error_requests SimpleAggregateFunction(sum, UInt64),
    stream_requests SimpleAggregateFunction(sum, UInt64),
    latency_sum_ms SimpleAggregateFunction(sum, UInt64),
    ttft_sum_ms SimpleAggregateFunction(sum, UInt64),
    last_created_at SimpleAggregateFunction(max, DateTime64(3, 'UTC')),

    latency_quantiles AggregateFunction(
        quantilesTDigest(0.50, 0.95, 0.99),
        UInt64
    ),
    gateway_latency_quantiles AggregateFunction(
        quantilesTDigest(0.50, 0.95, 0.99),
        UInt64
    ),
    provider_latency_quantiles AggregateFunction(
        quantilesTDigest(0.50, 0.95, 0.99),
        UInt64
    ),
    ttft_quantiles AggregateFunction(
        quantilesTDigest(0.50, 0.95, 0.99),
        UInt64
    )
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY
(
    tenant_id,
    bucket,
    project_id,
    application_id,
    provider,
    model,
    requested_model,
    terminal_status,
    cache_outcome,
    cache_type,
    fallback_outcome,
    safety_outcome,
    budget_outcome,
    masking_action,
    routing_category,
    routing_difficulty,
    routing_reason,
    budget_scope_type,
    budget_scope_id,
    budget_scope_resolved_by,
    latency_eligible,
    provider_latency_eligible,
    ttft_eligible
)
TTL bucket + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.llm_invocations_dashboard_second_rollup_mv
TO analytics.llm_invocations_dashboard_second_rollup
AS
SELECT
    tenant_id,
    toStartOfSecond(created_at, 'UTC') AS bucket,
    project_id,
    application_id,
    provider,
    model,
    requested_model,
    terminal_status,
    multiIf(
        cache_status = 'hit', 'hit',
        cache_status = 'miss', 'miss',
        cache_status = 'error', 'error',
        cache_status = 'bypass', 'bypassed',
        'not_used'
    ) AS cache_outcome,
    cache_type,
    fallback_outcome,
    safety_outcome,
    budget_outcome,
    masking_action,
    routing_category,
    routing_difficulty,
    routing_reason,
    budget_scope_type,
    budget_scope_id,
    budget_scope_resolved_by,
    toUInt8(terminal_status IN ('success', 'failed')) AS latency_eligible,
    toUInt8(
        terminal_status IN ('success', 'failed')
        AND provider_latency_ms IS NOT NULL
    ) AS provider_latency_eligible,
    toUInt8(stream = 1 AND ttft_ms IS NOT NULL) AS ttft_eligible,

    count() AS requests,
    sum(toUInt64(prompt_tokens)) AS prompt_tokens,
    sum(toUInt64(completion_tokens)) AS completion_tokens,
    sum(toUInt64(total_tokens)) AS total_tokens,
    sum(cost_micro_usd) AS cost_micro_usd,
    sum(ifNull(saved_cost_micro_usd, 0)) AS saved_cost_micro_usd,
    countIf(src.saved_cost_micro_usd IS NOT NULL) AS saved_cost_known_requests,
    countIf(http_status >= 500 OR terminal_status = 'failed') AS system_error_requests,
    countIf(stream = 1) AS stream_requests,
    sum(latency_ms) AS latency_sum_ms,
    sum(ifNull(ttft_ms, 0)) AS ttft_sum_ms,
    max(created_at) AS last_created_at,

    quantilesTDigestState(0.50, 0.95, 0.99)(latency_ms) AS latency_quantiles,
    quantilesTDigestState(0.50, 0.95, 0.99)(
        gateway_internal_latency_ms
    ) AS gateway_latency_quantiles,
    quantilesTDigestState(0.50, 0.95, 0.99)(
        ifNull(provider_latency_ms, 0)
    ) AS provider_latency_quantiles,
    quantilesTDigestState(0.50, 0.95, 0.99)(
        ifNull(ttft_ms, 0)
    ) AS ttft_quantiles
FROM analytics.llm_invocations AS src
GROUP BY
    tenant_id,
    bucket,
    project_id,
    application_id,
    provider,
    model,
    requested_model,
    terminal_status,
    cache_outcome,
    cache_type,
    fallback_outcome,
    safety_outcome,
    budget_outcome,
    masking_action,
    routing_category,
    routing_difficulty,
    routing_reason,
    budget_scope_type,
    budget_scope_id,
    budget_scope_resolved_by,
    latency_eligible,
    provider_latency_eligible,
    ttft_eligible;
