ALTER TABLE tenant_chat_invocation_logs
  ADD COLUMN effective_route_tier text,
  ADD COLUMN saved_cost_micro_usd bigint,
  ADD COLUMN masking_action text;

ALTER TABLE tenant_chat_invocation_logs
  ADD CONSTRAINT tenant_chat_log_effective_route_tier_check
    CHECK (effective_route_tier IS NULL OR effective_route_tier IN ('high_quality', 'standard', 'economy')),
  ADD CONSTRAINT tenant_chat_log_saved_cost_nonnegative_check
    CHECK (saved_cost_micro_usd IS NULL OR saved_cost_micro_usd >= 0),
  ADD CONSTRAINT tenant_chat_log_masking_action_check
    CHECK (masking_action IS NULL OR masking_action IN ('none', 'redacted', 'blocked'));

WITH matched AS (
  SELECT invocation.request_id, min(route ->> 'tier') AS route_tier
  FROM tenant_chat_invocation_logs AS invocation
  JOIN tenant_chat_runtime_snapshots AS snapshot
    ON snapshot.tenant_id = invocation.tenant_id
   AND snapshot.version = invocation.snapshot_version
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(snapshot.snapshot_body #> '{policies,routing,routes}') = 'array'
        THEN snapshot.snapshot_body #> '{policies,routing,routes}'
      ELSE '[]'::jsonb
    END
  ) AS route
  WHERE invocation.effective_route_tier IS NULL
    AND route ->> 'providerId' = invocation.effective_provider_id
    AND route ->> 'modelKey' = invocation.effective_model_key
    AND route ->> 'tier' IN ('high_quality', 'standard', 'economy')
  GROUP BY invocation.request_id
)
UPDATE tenant_chat_invocation_logs AS invocation
SET effective_route_tier = matched.route_tier
FROM matched
WHERE matched.request_id = invocation.request_id;

UPDATE tenant_chat_invocation_logs
SET saved_cost_micro_usd = 0
WHERE cache_outcome <> 'hit';

UPDATE tenant_chat_invocation_logs
SET masking_action = 'blocked'
WHERE terminal_outcome = 'safety_blocked';

CREATE INDEX tenant_chat_log_policy_impact_idx
  ON tenant_chat_invocation_logs (tenant_id, completed_at DESC, effective_route_tier);
