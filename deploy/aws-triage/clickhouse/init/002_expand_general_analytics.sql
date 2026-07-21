ALTER TABLE analytics.llm_invocations
    ADD COLUMN IF NOT EXISTS saved_cost_micro_usd Nullable(Int64) AFTER cost_micro_usd,
    ADD COLUMN IF NOT EXISTS terminal_status LowCardinality(String) AFTER routing_difficulty,
    ADD COLUMN IF NOT EXISTS fallback_outcome LowCardinality(String) AFTER terminal_status,
    ADD COLUMN IF NOT EXISTS safety_outcome LowCardinality(String) AFTER fallback_outcome,
    ADD COLUMN IF NOT EXISTS budget_outcome LowCardinality(String) AFTER safety_outcome,
    ADD COLUMN IF NOT EXISTS masking_action LowCardinality(String) AFTER budget_outcome,
    ADD COLUMN IF NOT EXISTS provider_called UInt8 AFTER masking_action,
    ADD COLUMN IF NOT EXISTS budget_scope_type LowCardinality(String) AFTER provider_called,
    ADD COLUMN IF NOT EXISTS budget_scope_id String CODEC(ZSTD(3)) AFTER budget_scope_type,
    ADD COLUMN IF NOT EXISTS budget_scope_resolved_by LowCardinality(String) AFTER budget_scope_id;
