-- Additive observability field. Existing invocation rows keep a NULL TTFT and
-- are intentionally rendered as an unavailable value rather than backfilled.
ALTER TABLE tenant_chat_invocation_logs
  ADD COLUMN IF NOT EXISTS ttft_ms BIGINT;
