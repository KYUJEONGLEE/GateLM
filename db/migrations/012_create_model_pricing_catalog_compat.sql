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

create index if not exists ix_model_catalog_provider_status
  on model_catalog (provider, status);

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
