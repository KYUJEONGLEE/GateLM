ALTER TABLE analytics.llm_invocations
    ADD COLUMN IF NOT EXISTS provider_id String CODEC(ZSTD(3)) AFTER model,
    ADD COLUMN IF NOT EXISTS model_id String CODEC(ZSTD(3)) AFTER provider_id,
    ADD COLUMN IF NOT EXISTS requested_model LowCardinality(String) AFTER model_id,
    ADD COLUMN IF NOT EXISTS model_ref LowCardinality(String) AFTER requested_model,
    ADD COLUMN IF NOT EXISTS routing_reason LowCardinality(String) AFTER model_ref,
    ADD COLUMN IF NOT EXISTS provider_latency_ms Nullable(UInt64) AFTER latency_ms,
    ADD COLUMN IF NOT EXISTS gateway_internal_latency_ms UInt64 AFTER provider_latency_ms,
    ADD COLUMN IF NOT EXISTS ttft_ms Nullable(UInt64) AFTER gateway_internal_latency_ms,
    ADD COLUMN IF NOT EXISTS stream UInt8 AFTER ttft_ms,
    ADD COLUMN IF NOT EXISTS cache_type LowCardinality(String) AFTER cache_status;
