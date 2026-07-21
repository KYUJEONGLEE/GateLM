-- Policy Impact breakdown reads only the bounded policy_outcome dimension.
CREATE INDEX CONCURRENTLY dashboard_rollup_policy_outcome_idx
    ON dashboard_rollup_dimensions (
        tenant_id, surface, grain, bucket_start, dimension_value
    )
    WHERE dimension_type = 'policy_outcome';
