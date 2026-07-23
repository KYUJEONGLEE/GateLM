-- Run with a closed UTC interval by replacing the two timestamps below.
-- Both result rows must have identical request/token/cost totals.

WITH
    parseDateTime64BestEffort('2026-07-23T00:00:00Z', 3, 'UTC') AS from_time,
    parseDateTime64BestEffort('2026-07-24T00:00:00Z', 3, 'UTC') AS to_time
SELECT
    'raw_final' AS source,
    count() AS requests,
    sum(total_tokens) AS total_tokens,
    sum(cost_micro_usd) AS cost_micro_usd
FROM analytics.llm_invocations FINAL
WHERE created_at >= from_time AND created_at < to_time
UNION ALL
WITH
    parseDateTime64BestEffort('2026-07-23T00:00:00Z', 3, 'UTC') AS from_time,
    parseDateTime64BestEffort('2026-07-24T00:00:00Z', 3, 'UTC') AS to_time
SELECT
    'second_rollup',
    sum(requests),
    sum(total_tokens),
    sum(cost_micro_usd)
FROM analytics.llm_invocations_dashboard_second_rollup
WHERE bucket >= from_time AND bucket < to_time;
