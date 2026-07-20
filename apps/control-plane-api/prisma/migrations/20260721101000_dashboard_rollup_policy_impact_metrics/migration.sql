-- Extend the canonical rollup read model with additive Policy Impact metrics.
-- The fields preserve null/known coverage that cannot be reconstructed from a
-- numeric sum alone. No prompt, response, credential, or raw error is stored.

ALTER TABLE dashboard_rollup_totals
    ADD COLUMN saved_cost_known_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN saved_cost_unknown_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN avoided_provider_call_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN protected_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN high_performance_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN high_performance_eligible_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN masking_known_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN masking_unknown_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN routing_known_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN routing_unknown_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN model_known_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN model_unknown_request_count bigint NOT NULL DEFAULT 0,
    ADD COLUMN event_max_at timestamptz NULL,
    ADD CONSTRAINT dashboard_rollup_totals_policy_impact_counts_check CHECK (
        saved_cost_known_request_count >= 0
        AND saved_cost_unknown_request_count >= 0
        AND avoided_provider_call_request_count >= 0
        AND protected_request_count >= 0
        AND high_performance_request_count >= 0
        AND high_performance_eligible_request_count >= 0
        AND masking_known_request_count >= 0
        AND masking_unknown_request_count >= 0
        AND routing_known_request_count >= 0
        AND routing_unknown_request_count >= 0
        AND model_known_request_count >= 0
        AND model_unknown_request_count >= 0
    ) NOT VALID;

ALTER TABLE dashboard_rollup_totals
    VALIDATE CONSTRAINT dashboard_rollup_totals_policy_impact_counts_check;

ALTER TABLE dashboard_rollup_dimensions
    DROP CONSTRAINT dashboard_rollup_dimensions_type_check,
    ADD CONSTRAINT dashboard_rollup_dimensions_type_check CHECK (
        dimension_type IN (
            'terminal_status',
            'provider_model',
            'masking_action',
            'safety_outcome',
            'cache_outcome',
            'fallback_outcome',
            'budget_outcome',
            'routing',
            'quota_state',
            'budget_state',
            'snapshot_pricing',
            'policy_outcome',
            'policy_model'
        )
    ) NOT VALID;

ALTER TABLE dashboard_rollup_dimensions
    VALIDATE CONSTRAINT dashboard_rollup_dimensions_type_check;
