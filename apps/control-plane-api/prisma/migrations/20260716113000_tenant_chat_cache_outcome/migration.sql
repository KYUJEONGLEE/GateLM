ALTER TABLE tenant_chat_usage_reservations
  ADD COLUMN cache_outcome text;

UPDATE tenant_chat_usage_reservations AS reservation
SET cache_outcome = CASE
  WHEN runtime_snapshot.snapshot_body #>> '{policies,cache,enabled}' = 'true'
   AND runtime_snapshot.snapshot_body #>> '{policies,cache,strategy}' = 'exact'
    THEN 'miss'
  ELSE 'off'
END
FROM tenant_chat_runtime_snapshots AS runtime_snapshot
WHERE runtime_snapshot.tenant_id = reservation.tenant_id
  AND runtime_snapshot.version = reservation.snapshot_version;

UPDATE tenant_chat_usage_reservations
SET cache_outcome = 'off'
WHERE cache_outcome IS NULL;

ALTER TABLE tenant_chat_usage_reservations
  ALTER COLUMN cache_outcome SET NOT NULL,
  ADD CONSTRAINT tenant_chat_reservation_cache_outcome_check
    CHECK (cache_outcome IN ('off', 'miss'));

UPDATE tenant_chat_invocation_logs AS invocation
SET cache_outcome = 'off'
FROM tenant_chat_usage_reservations AS reservation
WHERE reservation.request_id = invocation.request_id
  AND reservation.cache_outcome = 'off'
  AND invocation.cache_outcome = 'miss';
