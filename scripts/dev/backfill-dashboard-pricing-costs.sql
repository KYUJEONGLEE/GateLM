with priced_logs as (
  select
    l.id,
    l.metadata as existing_metadata,
    greatest(l.prompt_tokens, 0) as prompt_tokens,
    greatest(l.completion_tokens, 0) as completion_tokens,
    greatest(l.total_tokens, 0) as total_tokens,
    r.id as pricing_rule_id,
    r.provider as pricing_provider,
    r.model as pricing_model,
    r.currency,
    r.input_micro_usd_per_1m_tokens,
    r.output_micro_usd_per_1m_tokens,
    r.pricing_version,
    r.source,
    (
      (
        greatest(l.prompt_tokens, 0) * r.input_micro_usd_per_1m_tokens
        + greatest(l.completion_tokens, 0) * r.output_micro_usd_per_1m_tokens
        + 500000
      ) / 1000000
    )::bigint as calculated_cost_micro_usd
  from p0_llm_invocation_logs l
  join lateral (
    select
      id,
      provider,
      model,
      currency,
      input_micro_usd_per_1m_tokens,
      output_micro_usd_per_1m_tokens,
      pricing_version,
      source,
      effective_from,
      effective_to,
      created_at
    from model_pricing_rules r
    where r.provider = l.selected_provider
      and r.model = l.selected_model
      and r.effective_from <= coalesce(l.completed_at, l.created_at)
      and (r.effective_to is null or r.effective_to > coalesce(l.completed_at, l.created_at))
    order by r.effective_from desc, r.created_at desc
    limit 1
  ) r on true
  where l.status = 'success'
    and l.total_tokens > 0
    and l.cost_micro_usd = 0
)
update p0_llm_invocation_logs l
set
  cost_micro_usd = priced_logs.calculated_cost_micro_usd,
  metadata = jsonb_set(
    jsonb_set(
      coalesce(l.metadata, '{}'::jsonb),
      '{costing}',
      jsonb_build_object(
        'schemaVersion', 1,
        'costMicroUsd', priced_logs.calculated_cost_micro_usd,
        'currency', coalesce(nullif(priced_logs.currency, ''), 'USD'),
        'amountType', 'estimated_provider_usage_cost',
        'credentialOwner', 'tenant',
        'billableByGateLM', false,
        'pricingRuleId', priced_logs.pricing_rule_id::text,
        'pricingVersion', priced_logs.pricing_version,
        'pricingProvider', priced_logs.pricing_provider,
        'pricingModel', priced_logs.pricing_model,
        'inputMicroUsdPer1MTokens', priced_logs.input_micro_usd_per_1m_tokens,
        'outputMicroUsdPer1MTokens', priced_logs.output_micro_usd_per_1m_tokens,
        'tokenCountSource', 'provider_usage',
        'costSource', 'pricing_catalog',
        'promptTokens', priced_logs.prompt_tokens,
        'completionTokens', priced_logs.completion_tokens,
        'totalTokens', priced_logs.total_tokens,
        'source', priced_logs.source
      ),
      true
    ),
    '{costingBackfill}',
    jsonb_build_object(
      'source', 'scripts/dev/backfill-dashboard-pricing-costs.sql',
      'previousCostSource', coalesce(priced_logs.existing_metadata->'costing'->>'costSource', ''),
      'appliedAt', now()
    ),
    true
  )
from priced_logs
where l.id = priced_logs.id;
