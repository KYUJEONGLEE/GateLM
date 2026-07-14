-- This index is built separately so existing Tenant Chat projection writes are
-- not blocked while PostgreSQL scans an already-populated invocation log table.
CREATE INDEX CONCURRENTLY tenant_chat_log_rollup_discovery_idx
    ON tenant_chat_invocation_logs (updated_at, request_id);
