create table if not exists model_catalog (
  id uuid primary key,
  provider text not null,
  model text not null,
  display_name text null,
  capabilities jsonb not null default '[]'::jsonb,
  context_window_tokens int null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table model_catalog
  add column if not exists display_name text null,
  add column if not exists capabilities jsonb not null default '[]'::jsonb,
  add column if not exists context_window_tokens int null,
  add column if not exists status text not null default 'active',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists ux_model_catalog_provider_model
  on model_catalog (provider, model);

create table if not exists model_pricing_rules (
  id uuid primary key,
  provider text not null,
  model text not null,
  currency text not null default 'USD',
  input_micro_usd_per_1m_tokens bigint not null,
  output_micro_usd_per_1m_tokens bigint not null,
  pricing_version text not null default 'p0',
  effective_from timestamptz not null default now(),
  effective_to timestamptz null,
  source text null,
  created_at timestamptz not null default now()
);

alter table model_pricing_rules
  add column if not exists currency text not null default 'USD',
  add column if not exists input_micro_usd_per_1m_tokens bigint not null default 0,
  add column if not exists output_micro_usd_per_1m_tokens bigint not null default 0,
  add column if not exists pricing_version text not null default 'p0',
  add column if not exists effective_from timestamptz not null default now(),
  add column if not exists effective_to timestamptz null,
  add column if not exists source text null,
  add column if not exists created_at timestamptz not null default now();

create index if not exists ix_model_pricing_rules_lookup
  on model_pricing_rules (provider, model, effective_from desc, effective_to);

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
  '00000000-0000-4000-8000-000000000840',
  'openai-main',
  'gpt-5.5',
  'GPT-5.5',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000841',
  'openai-main',
  'gpt-5.5-pro',
  'GPT-5.5 Pro',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000842',
  'openai-main',
  'gpt-5.4',
  'GPT-5.4',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000843',
  'openai-main',
  'gpt-5.4-mini',
  'GPT-5.4 mini',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000844',
  'openai-main',
  'gpt-5.4-nano',
  'GPT-5.4 nano',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000845',
  'openai-main',
  'gpt-5.4-pro',
  'GPT-5.4 Pro',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000846',
  'openai',
  'gpt-5.5',
  'GPT-5.5',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","compatAliasOf":"openai-main","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000847',
  'openai',
  'gpt-5.5-pro',
  'GPT-5.5 Pro',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","compatAliasOf":"openai-main","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000848',
  'openai',
  'gpt-5.4',
  'GPT-5.4',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","compatAliasOf":"openai-main","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000849',
  'openai',
  'gpt-5.4-mini',
  'GPT-5.4 mini',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","compatAliasOf":"openai-main","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000850',
  'openai',
  'gpt-5.4-nano',
  'GPT-5.4 nano',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","compatAliasOf":"openai-main","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000851',
  'openai',
  'gpt-5.4-pro',
  'GPT-5.4 Pro',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"official_pricing","pricingMode":"standard_short_context","compatAliasOf":"openai-main","source":"https://developers.openai.com/api/docs/pricing"}'::jsonb
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
  '00000000-0000-4000-8000-000000000860',
  'openai-main',
  'gpt-5.5',
  'USD',
  5000000,
  30000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000861',
  'openai-main',
  'gpt-5.5-pro',
  'USD',
  30000000,
  180000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000862',
  'openai-main',
  'gpt-5.4',
  'USD',
  2500000,
  15000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000863',
  'openai-main',
  'gpt-5.4-mini',
  'USD',
  750000,
  4500000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000864',
  'openai-main',
  'gpt-5.4-nano',
  'USD',
  200000,
  1250000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000865',
  'openai-main',
  'gpt-5.4-pro',
  'USD',
  30000000,
  180000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000866',
  'openai',
  'gpt-5.5',
  'USD',
  5000000,
  30000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000867',
  'openai',
  'gpt-5.5-pro',
  'USD',
  30000000,
  180000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000868',
  'openai',
  'gpt-5.4',
  'USD',
  2500000,
  15000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000869',
  'openai',
  'gpt-5.4-mini',
  'USD',
  750000,
  4500000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000870',
  'openai',
  'gpt-5.4-nano',
  'USD',
  200000,
  1250000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
),
(
  '00000000-0000-4000-8000-000000000871',
  'openai',
  'gpt-5.4-pro',
  'USD',
  30000000,
  180000000,
  'official-pricing-2026-07-08-v1',
  '2026-07-05 00:00:00+00',
  'https://developers.openai.com/api/docs/pricing'
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
