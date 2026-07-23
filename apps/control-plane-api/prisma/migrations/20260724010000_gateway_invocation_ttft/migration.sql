-- The Gateway terminal writer and analytics readers persist and aggregate TTFT
-- from the canonical project/application invocation log.
--
-- Existing rows intentionally remain NULL because TTFT cannot be reconstructed
-- reliably from total or provider latency.
ALTER TABLE p0_llm_invocation_logs
  ADD COLUMN IF NOT EXISTS ttft_ms BIGINT;
