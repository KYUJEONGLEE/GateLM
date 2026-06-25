create table if not exists provider_connections (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid null references projects(id),
  name text not null,
  provider text not null,
  base_url text null,
  status text not null default 'active',
  default_model text null,
  secret_ref text not null,
  credential_preview text null,
  config jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists ix_provider_connections_tenant_project_status
  on provider_connections (tenant_id, project_id, status);

create index if not exists ix_provider_connections_provider_status
  on provider_connections (provider, status);

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

create index if not exists ix_model_pricing_rules_lookup
  on model_pricing_rules (provider, model, effective_from desc, effective_to);
