insert into model_catalog (
  id,
  provider,
  model,
  display_name,
  capabilities,
  status,
  metadata
) values
(
  '00000000-0000-4000-8000-000000000722',
  'openai',
  'gpt-4o-mini',
  'GPT-4o mini',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"pricing_catalog","compatAliasOf":"openai-main"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000723',
  'openai',
  'gpt-4o',
  'GPT-4o',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"pricing_catalog","compatAliasOf":"openai-main"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000724',
  'openai',
  'gpt-5.4-mini',
  'GPT-5.4 mini',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"pricing_catalog","compatAliasOf":"openai-main","source":"https://platform.openai.com/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000725',
  'openai',
  'gpt-5.4',
  'GPT-5.4',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"pricing_catalog","compatAliasOf":"openai-main","source":"https://platform.openai.com/docs/pricing"}'::jsonb
)
on conflict (provider, model) do update set
  display_name = excluded.display_name,
  capabilities = excluded.capabilities,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

insert into model_pricing_rules (
  id,
  provider,
  model,
  currency,
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  pricing_version,
  effective_from,
  source
) values
(
  '00000000-0000-4000-8000-000000000832',
  'openai',
  'gpt-4o-mini',
  'USD',
  150000,
  600000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'canonical_provider_alias_from_openai-main'
),
(
  '00000000-0000-4000-8000-000000000833',
  'openai',
  'gpt-4o',
  'USD',
  2500000,
  10000000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'canonical_provider_alias_from_openai-main'
),
(
  '00000000-0000-4000-8000-000000000834',
  'openai',
  'gpt-5.4-mini',
  'USD',
  750000,
  4500000,
  'official-pricing-2026-07-05-v1',
  '2026-07-05 00:00:00+00',
  'canonical_provider_alias_from_openai-main'
),
(
  '00000000-0000-4000-8000-000000000835',
  'openai',
  'gpt-5.4',
  'USD',
  2500000,
  15000000,
  'official-pricing-2026-07-05-v1',
  '2026-07-05 00:00:00+00',
  'canonical_provider_alias_from_openai-main'
)
on conflict (id) do update set
  provider = excluded.provider,
  model = excluded.model,
  currency = excluded.currency,
  input_micro_usd_per_1m_tokens = excluded.input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens = excluded.output_micro_usd_per_1m_tokens,
  pricing_version = excluded.pricing_version,
  effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  source = excluded.source;
