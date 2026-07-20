-- Add a bounded minute grain without changing the existing hour/day/month rows.
-- Production rolls this out in legacy -> shadow -> minute mode so old readers
-- remain compatible while minute buckets are backfilled and compared.

ALTER TABLE dashboard_rollup_dirty_buckets
    DROP CONSTRAINT dashboard_rollup_dirty_buckets_grain_check,
    ADD CONSTRAINT dashboard_rollup_dirty_buckets_grain_check
        CHECK (grain IN ('minute', 'hour', 'day', 'month')) NOT VALID;

ALTER TABLE dashboard_rollup_bucket_states
    DROP CONSTRAINT dashboard_rollup_bucket_states_grain_check,
    ADD CONSTRAINT dashboard_rollup_bucket_states_grain_check
        CHECK (grain IN ('minute', 'hour', 'day', 'month')) NOT VALID;

ALTER TABLE dashboard_rollup_totals
    DROP CONSTRAINT dashboard_rollup_totals_grain_check,
    ADD CONSTRAINT dashboard_rollup_totals_grain_check
        CHECK (grain IN ('minute', 'hour', 'day', 'month')) NOT VALID;

ALTER TABLE dashboard_rollup_dimensions
    DROP CONSTRAINT dashboard_rollup_dimensions_grain_check,
    ADD CONSTRAINT dashboard_rollup_dimensions_grain_check
        CHECK (grain IN ('minute', 'hour', 'day', 'month')) NOT VALID;

ALTER TABLE employee_usage_rollups
    DROP CONSTRAINT employee_usage_rollups_grain_check,
    ADD CONSTRAINT employee_usage_rollups_grain_check
        CHECK (grain IN ('minute', 'hour', 'day', 'month')) NOT VALID;

ALTER TABLE dashboard_rollup_dirty_buckets
    VALIDATE CONSTRAINT dashboard_rollup_dirty_buckets_grain_check;
ALTER TABLE dashboard_rollup_bucket_states
    VALIDATE CONSTRAINT dashboard_rollup_bucket_states_grain_check;
ALTER TABLE dashboard_rollup_totals
    VALIDATE CONSTRAINT dashboard_rollup_totals_grain_check;
ALTER TABLE dashboard_rollup_dimensions
    VALIDATE CONSTRAINT dashboard_rollup_dimensions_grain_check;
ALTER TABLE employee_usage_rollups
    VALIDATE CONSTRAINT employee_usage_rollups_grain_check;
