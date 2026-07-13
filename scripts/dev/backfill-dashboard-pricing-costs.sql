-- provider/model are provider-attempt execution facts used only for cost settlement.
with candidate_logs as (
  select
    l.*,
    array_remove(array[
      nullif(btrim(l.provider), ''),
      case
        when btrim(l.provider) like '%-main'
          then nullif(regexp_replace(btrim(l.provider), '-main$', ''), '')
        else null
      end,
      case
        when btrim(l.provider) <> ''
          and btrim(l.provider) not like '%-main'
          and btrim(l.provider) !~ '[:/_]'
          and btrim(l.provider) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then btrim(l.provider) || '-main'
        else null
      end
    ], null) as provider_keys,
    array_remove(array[
      nullif(btrim(l.model), ''),
      case
        when strpos(btrim(l.model), ':') > 0
          then nullif(substring(btrim(l.model) from '[^:]+$'), '')
        else null
      end
    ], null) as model_keys
  from p0_llm_invocation_logs l
  where l.status = 'success'
    and l.total_tokens > 0
    and l.cost_micro_usd = 0
),
priced_logs as (
  select
    l.id,
    l.request_id,
    l.tenant_id,
    l.project_id,
    l.application_id,
    l.created_at,
    coalesce(l.completed_at, l.created_at) as completed_at,
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
  from candidate_logs l
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
    where r.provider = any(l.provider_keys)
      and r.model = any(l.model_keys)
      and r.effective_from <= coalesce(l.completed_at, l.created_at)
      and (r.effective_to is null or r.effective_to > coalesce(l.completed_at, l.created_at))
    order by
      array_position(l.provider_keys, r.provider) asc,
      array_position(l.model_keys, r.model) asc,
      r.effective_from desc,
      r.created_at desc
    limit 1
  ) r on true
),
updated_logs as (
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
  where l.id = priced_logs.id
  returning
    priced_logs.request_id,
    priced_logs.tenant_id,
    priced_logs.project_id,
    priced_logs.application_id,
    priced_logs.created_at,
    priced_logs.completed_at,
    priced_logs.calculated_cost_micro_usd,
    l.metadata
),
ledger_rows as (
  select
    request_id,
    tenant_id,
    project_id,
    application_id,
    case
      when metadata->'budgetScope'->>'budgetScopeType' in ('application', 'project', 'team')
        then metadata->'budgetScope'->>'budgetScopeType'
      when application_id is not null
        then 'application'
      else 'project'
    end as budget_scope_type,
    case
      when metadata->'budgetScope'->>'budgetScopeId' is not null
        then metadata->'budgetScope'->>'budgetScopeId'
      when application_id is not null
        then application_id::text
      else project_id::text
    end as budget_scope_id,
    date_trunc('month', completed_at)::date as month_start,
    calculated_cost_micro_usd,
    created_at,
    completed_at
  from updated_logs
  where calculated_cost_micro_usd > 0
)
insert into budget_ledger_entries (
  request_id,
  tenant_id,
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  month_start,
  cost_micro_usd,
  source,
  created_at,
  completed_at,
  updated_at
)
select
  request_id,
  tenant_id,
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  month_start,
  calculated_cost_micro_usd,
  'request_log',
  created_at,
  completed_at,
  now()
from ledger_rows
on conflict (request_id)
do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  application_id = excluded.application_id,
  budget_scope_type = excluded.budget_scope_type,
  budget_scope_id = excluded.budget_scope_id,
  month_start = excluded.month_start,
  cost_micro_usd = excluded.cost_micro_usd,
  source = excluded.source,
  completed_at = excluded.completed_at,
  updated_at = now();
