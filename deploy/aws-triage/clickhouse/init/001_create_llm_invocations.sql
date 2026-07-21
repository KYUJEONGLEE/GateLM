CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.llm_invocations
(
    request_id String CODEC(ZSTD(3)),
    tenant_id UUID,
    project_id UUID,
    application_id UUID,
    employee_identity_hash String CODEC(ZSTD(3)),

    provider LowCardinality(String),
    model LowCardinality(String),
    status LowCardinality(String),
    http_status UInt16,

    prompt_tokens UInt32,
    completion_tokens UInt32,
    total_tokens UInt32,
    cost_micro_usd Int64,
    saved_cost_micro_usd Nullable(Int64),
    latency_ms UInt64,

    cache_status LowCardinality(String),
    routing_category LowCardinality(String),
    routing_difficulty LowCardinality(String),
    terminal_status LowCardinality(String),
    fallback_outcome LowCardinality(String),
    safety_outcome LowCardinality(String),
    budget_outcome LowCardinality(String),
    masking_action LowCardinality(String),
    provider_called UInt8,
    budget_scope_type LowCardinality(String),
    budget_scope_id String CODEC(ZSTD(3)),
    budget_scope_resolved_by LowCardinality(String),

    created_at DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
    ingested_at DateTime64(3, 'UTC') CODEC(Delta, ZSTD(3)),
    ingest_version UInt64
)
ENGINE = ReplacingMergeTree(ingest_version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, request_id)
TTL toDateTime(created_at) + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192;
