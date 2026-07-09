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

with openai_gpt_model_seed (
  model,
  display_name,
  context_window_tokens,
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  source
) as (
  values
    ('gpt-4o-mini', 'GPT-4o mini', 128000, 150000, 600000, 'https://developers.openai.com/api/docs/models/gpt-4o-mini'),
    ('gpt-4o', 'GPT-4o', 128000, 2500000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-4o'),
    ('gpt-5.5', 'GPT-5.5', 1050000, 5000000, 30000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.5-pro', 'GPT-5.5 Pro', 1050000, 30000000, 180000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4', 'GPT-5.4', 1050000, 2500000, 15000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4-mini', 'GPT-5.4 mini', 400000, 750000, 4500000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4-nano', 'GPT-5.4 nano', 400000, 200000, 1250000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4-pro', 'GPT-5.4 Pro', 1050000, 30000000, 180000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.3-codex', 'GPT-5.3-Codex', 400000, 1750000, 14000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.2', 'GPT-5.2', 400000, 1750000, 14000000, 'https://developers.openai.com/api/docs/models/gpt-5.2'),
    ('gpt-5.2-pro', 'GPT-5.2 Pro', 400000, 21000000, 168000000, 'https://developers.openai.com/api/docs/models/gpt-5.2-pro'),
    ('gpt-5.2-codex', 'GPT-5.2-Codex', 400000, 1750000, 14000000, 'https://developers.openai.com/api/docs/models/gpt-5.2-codex'),
    ('gpt-5.1', 'GPT-5.1', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5.1'),
    ('gpt-5.1-codex', 'GPT-5.1-Codex', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5.1-codex'),
    ('gpt-5.1-codex-mini', 'GPT-5.1-Codex mini', 400000, 250000, 2000000, 'https://developers.openai.com/api/docs/models/gpt-5.1-codex-mini'),
    ('gpt-5.1-codex-max', 'GPT-5.1-Codex-Max', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5.1-codex-max'),
    ('gpt-5', 'GPT-5', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5'),
    ('gpt-5-mini', 'GPT-5 mini', 400000, 250000, 2000000, 'https://developers.openai.com/api/docs/models/gpt-5-mini'),
    ('gpt-5-nano', 'GPT-5 nano', 400000, 50000, 400000, 'https://developers.openai.com/api/docs/models/gpt-5-nano'),
    ('gpt-5-pro', 'GPT-5 Pro', 400000, 15000000, 120000000, 'https://developers.openai.com/api/docs/models/gpt-5-pro'),
    ('gpt-4.5-preview', 'GPT-4.5 Preview', 128000, 75000000, 150000000, 'https://developers.openai.com/api/docs/models/gpt-4.5-preview'),
    ('gpt-4.1', 'GPT-4.1', 1047576, 2000000, 8000000, 'https://developers.openai.com/api/docs/models/gpt-4.1'),
    ('gpt-4.1-mini', 'GPT-4.1 mini', 1047576, 400000, 1600000, 'https://developers.openai.com/api/docs/models/gpt-4.1-mini'),
    ('gpt-4.1-nano', 'GPT-4.1 nano', 1047576, 100000, 400000, 'https://developers.openai.com/api/docs/models/gpt-4.1-nano'),
    ('gpt-3.5-turbo', 'GPT-3.5 Turbo', 16385, 500000, 1500000, 'https://developers.openai.com/api/docs/models/gpt-3.5-turbo'),
    ('chat-latest', 'ChatGPT chat-latest', 128000, 5000000, 30000000, 'https://developers.openai.com/api/docs/pricing')
),
provider_model_seed as (
  select providers.provider, models.*
  from (values ('openai-main'), ('openai')) as providers(provider)
  cross join openai_gpt_model_seed models
),
catalog_rows as (
  select
    row_number() over (order by provider, model) as ordinal,
    *
  from provider_model_seed
)
insert into model_catalog (
  id,
  provider,
  model,
  display_name,
  capabilities,
  context_window_tokens,
  status,
  metadata
)
select
  ('00000000-0000-4000-8000-' || lpad((1000 + ordinal)::text, 12, '0'))::uuid,
  provider,
  model,
  display_name,
  '["chat"]'::jsonb,
  context_window_tokens,
  'active',
  jsonb_build_object(
    'pricingBasis',
    'official_pricing',
    'pricingMode',
    'standard_short_context',
    'source',
    source
  ) || case
    when provider = 'openai' then jsonb_build_object('compatAliasOf', 'openai-main')
    else '{}'::jsonb
  end
from catalog_rows
on conflict (provider, model) do update set
  display_name = excluded.display_name,
  capabilities = excluded.capabilities,
  context_window_tokens = excluded.context_window_tokens,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

with openai_gpt_model_seed (
  model,
  display_name,
  context_window_tokens,
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  source
) as (
  values
    ('gpt-4o-mini', 'GPT-4o mini', 128000, 150000, 600000, 'https://developers.openai.com/api/docs/models/gpt-4o-mini'),
    ('gpt-4o', 'GPT-4o', 128000, 2500000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-4o'),
    ('gpt-5.5', 'GPT-5.5', 1050000, 5000000, 30000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.5-pro', 'GPT-5.5 Pro', 1050000, 30000000, 180000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4', 'GPT-5.4', 1050000, 2500000, 15000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4-mini', 'GPT-5.4 mini', 400000, 750000, 4500000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4-nano', 'GPT-5.4 nano', 400000, 200000, 1250000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.4-pro', 'GPT-5.4 Pro', 1050000, 30000000, 180000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.3-codex', 'GPT-5.3-Codex', 400000, 1750000, 14000000, 'https://developers.openai.com/api/docs/pricing'),
    ('gpt-5.2', 'GPT-5.2', 400000, 1750000, 14000000, 'https://developers.openai.com/api/docs/models/gpt-5.2'),
    ('gpt-5.2-pro', 'GPT-5.2 Pro', 400000, 21000000, 168000000, 'https://developers.openai.com/api/docs/models/gpt-5.2-pro'),
    ('gpt-5.2-codex', 'GPT-5.2-Codex', 400000, 1750000, 14000000, 'https://developers.openai.com/api/docs/models/gpt-5.2-codex'),
    ('gpt-5.1', 'GPT-5.1', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5.1'),
    ('gpt-5.1-codex', 'GPT-5.1-Codex', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5.1-codex'),
    ('gpt-5.1-codex-mini', 'GPT-5.1-Codex mini', 400000, 250000, 2000000, 'https://developers.openai.com/api/docs/models/gpt-5.1-codex-mini'),
    ('gpt-5.1-codex-max', 'GPT-5.1-Codex-Max', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5.1-codex-max'),
    ('gpt-5', 'GPT-5', 400000, 1250000, 10000000, 'https://developers.openai.com/api/docs/models/gpt-5'),
    ('gpt-5-mini', 'GPT-5 mini', 400000, 250000, 2000000, 'https://developers.openai.com/api/docs/models/gpt-5-mini'),
    ('gpt-5-nano', 'GPT-5 nano', 400000, 50000, 400000, 'https://developers.openai.com/api/docs/models/gpt-5-nano'),
    ('gpt-5-pro', 'GPT-5 Pro', 400000, 15000000, 120000000, 'https://developers.openai.com/api/docs/models/gpt-5-pro'),
    ('gpt-4.5-preview', 'GPT-4.5 Preview', 128000, 75000000, 150000000, 'https://developers.openai.com/api/docs/models/gpt-4.5-preview'),
    ('gpt-4.1', 'GPT-4.1', 1047576, 2000000, 8000000, 'https://developers.openai.com/api/docs/models/gpt-4.1'),
    ('gpt-4.1-mini', 'GPT-4.1 mini', 1047576, 400000, 1600000, 'https://developers.openai.com/api/docs/models/gpt-4.1-mini'),
    ('gpt-4.1-nano', 'GPT-4.1 nano', 1047576, 100000, 400000, 'https://developers.openai.com/api/docs/models/gpt-4.1-nano'),
    ('gpt-3.5-turbo', 'GPT-3.5 Turbo', 16385, 500000, 1500000, 'https://developers.openai.com/api/docs/models/gpt-3.5-turbo'),
    ('chat-latest', 'ChatGPT chat-latest', 128000, 5000000, 30000000, 'https://developers.openai.com/api/docs/pricing')
),
provider_model_seed as (
  select providers.provider, models.*
  from (values ('openai-main'), ('openai')) as providers(provider)
  cross join openai_gpt_model_seed models
),
pricing_rows as (
  select
    row_number() over (order by provider, model) as ordinal,
    *
  from provider_model_seed
)
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
)
select
  ('00000000-0000-4000-8000-' || lpad((1100 + ordinal)::text, 12, '0'))::uuid,
  provider,
  model,
  'USD',
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  'official-pricing-2026-07-08-v2',
  '2026-07-05 00:00:00+00',
  source
from pricing_rows
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
