-- Add first and validate separately so PostgreSQL releases the ADD
-- transaction's AccessExclusiveLock before scanning existing provider attempts.

DO $tenant_chat_cache_read_price_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tenant_chat_provider_attempts
    WHERE cache_read_input_micro_usd_per_million_tokens IS NOT NULL
      AND cache_read_input_micro_usd_per_million_tokens > input_micro_usd_per_million_tokens
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Tenant Chat cache-read price preflight failed: provider attempt data violates the active pricing contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tenant_chat_active_runtime_snapshots AS active_snapshot
    JOIN tenant_chat_runtime_snapshots AS runtime_snapshot
      ON runtime_snapshot.snapshot_id = active_snapshot.snapshot_id
     AND runtime_snapshot.tenant_id = active_snapshot.tenant_id
    WHERE jsonb_path_exists(
      runtime_snapshot.snapshot_body,
      '$.pricing.routes[*] ? (@.cacheReadInputMicroUsdPerMillionTokens > @.inputMicroUsdPerMillionTokens)'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Tenant Chat cache-read price preflight failed: an active RuntimeSnapshot violates the active pricing contract.';
  END IF;
END
$tenant_chat_cache_read_price_preflight$;

ALTER TABLE tenant_chat_provider_attempts
  ADD CONSTRAINT tenant_chat_attempt_cache_read_price_check
  CHECK (
    cache_read_input_micro_usd_per_million_tokens IS NULL
    OR cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens
  ) NOT VALID;
