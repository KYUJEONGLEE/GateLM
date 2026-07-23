-- ONE-TIME OPERATOR ACTION FOR AN EXISTING CLICKHOUSE VOLUME.
--
-- 1. Keep PostgreSQL logging online.
-- 2. Pause only the Gateway -> ClickHouse mirror writers.
-- 3. Apply init/004_create_dashboard_rollups.sql.
-- 4. Run this file once.
-- 5. Compare raw FINAL and rollup totals for the same closed interval.
-- 6. Re-enable the mirror writers.
--
-- Pausing the mirror closes the gap between the historical backfill and the
-- incremental materialized views. Do not run this script twice.

INSERT INTO analytics.llm_invocations_by_time
SELECT *
FROM analytics.llm_invocations FINAL;

INSERT INTO analytics.llm_invocations_dashboard_second_rollup
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
    quantilesTDigestState(0.50, 0.95, 0.99)(latency_ms),
    quantilesTDigestState(0.50, 0.95, 0.99)(
        gateway_internal_latency_ms
    ),
    quantilesTDigestState(0.50, 0.95, 0.99)(
        ifNull(provider_latency_ms, 0)
    ),
    quantilesTDigestState(0.50, 0.95, 0.99)(
        ifNull(ttft_ms, 0)
    )
FROM
(
    SELECT *
    FROM analytics.llm_invocations FINAL
) AS src
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
