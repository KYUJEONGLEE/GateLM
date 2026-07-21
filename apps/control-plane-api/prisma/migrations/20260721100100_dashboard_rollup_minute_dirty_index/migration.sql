-- Keep concurrent index creation in a single-statement Prisma migration so
-- PostgreSQL does not receive it inside the multi-DDL transaction above.
CREATE INDEX CONCURRENTLY dashboard_rollup_minute_dirty_idx
    ON dashboard_rollup_dirty_buckets (available_at, bucket_start, tenant_id)
    WHERE grain = 'minute';
