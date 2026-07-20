-- This partial index supports minute readiness checks without blocking the
-- active Rollup writer while PostgreSQL builds it.
CREATE INDEX CONCURRENTLY dashboard_rollup_minute_state_idx
    ON dashboard_rollup_bucket_states (
        tenant_id, surface, bucket_start, state, histogram_version
    )
    WHERE grain = 'minute';
