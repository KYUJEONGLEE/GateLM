-- Provider prompt-cache read/hit pricing is a discount price. Provider cache
-- creation/write pricing requires separate fields in a future contract revision.
-- Probe existing shared data before enforcing the final tenant-chat/v1 invariant.

DO $migration$
DECLARE
  violation_count bigint;
  violation_examples text;
BEGIN
  SELECT count(*)
    INTO violation_count
  FROM tenant_chat_provider_attempts
  WHERE cache_read_input_micro_usd_per_million_tokens IS NOT NULL
    AND cache_read_input_micro_usd_per_million_tokens > input_micro_usd_per_million_tokens;

  IF violation_count > 0 THEN
    SELECT string_agg(
      format('tenant_id=%s request_id=%s attempt_no=%s', tenant_id, request_id, attempt_no),
      ', '
    )
      INTO violation_examples
    FROM (
      SELECT tenant_id, request_id, attempt_no
      FROM tenant_chat_provider_attempts
      WHERE cache_read_input_micro_usd_per_million_tokens IS NOT NULL
        AND cache_read_input_micro_usd_per_million_tokens > input_micro_usd_per_million_tokens
      ORDER BY tenant_id, request_id, attempt_no
      LIMIT 10
    ) AS invalid_attempts;

    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'tenant_chat cache-read price invariant failed for %s provider attempt(s); examples: %s',
        violation_count,
        coalesce(violation_examples, 'unavailable')
      );
  END IF;
END
$migration$;

DO $migration$
DECLARE
  violation_count bigint;
  violation_examples text;
BEGIN
  SELECT count(*)
    INTO violation_count
  FROM tenant_chat_active_runtime_snapshots AS active_snapshot
  JOIN tenant_chat_runtime_snapshots AS runtime_snapshot
    ON runtime_snapshot.snapshot_id = active_snapshot.snapshot_id
   AND runtime_snapshot.tenant_id = active_snapshot.tenant_id
  WHERE jsonb_path_exists(
    runtime_snapshot.snapshot_body,
    '$.pricing.routes[*] ? (@.cacheReadInputMicroUsdPerMillionTokens > @.inputMicroUsdPerMillionTokens)'::jsonpath,
    '{}'::jsonb,
    true
  );

  IF violation_count > 0 THEN
    SELECT string_agg(
      format('tenant_id=%s snapshot_id=%s', tenant_id, snapshot_id),
      ', '
    )
      INTO violation_examples
    FROM (
      SELECT active_snapshot.tenant_id, active_snapshot.snapshot_id
      FROM tenant_chat_active_runtime_snapshots AS active_snapshot
      JOIN tenant_chat_runtime_snapshots AS runtime_snapshot
        ON runtime_snapshot.snapshot_id = active_snapshot.snapshot_id
       AND runtime_snapshot.tenant_id = active_snapshot.tenant_id
      WHERE jsonb_path_exists(
        runtime_snapshot.snapshot_body,
        '$.pricing.routes[*] ? (@.cacheReadInputMicroUsdPerMillionTokens > @.inputMicroUsdPerMillionTokens)'::jsonpath,
        '{}'::jsonb,
        true
      )
      ORDER BY active_snapshot.tenant_id, active_snapshot.snapshot_id
      LIMIT 10
    ) AS invalid_snapshots;

    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'tenant_chat cache-read price invariant failed for %s active RuntimeSnapshot(s); examples: %s',
        violation_count,
        coalesce(violation_examples, 'unavailable')
      );
  END IF;
END
$migration$;

ALTER TABLE tenant_chat_provider_attempts
  ADD CONSTRAINT tenant_chat_attempt_cache_read_price_check CHECK (
    cache_read_input_micro_usd_per_million_tokens IS NULL
    OR cache_read_input_micro_usd_per_million_tokens <= input_micro_usd_per_million_tokens
  );
