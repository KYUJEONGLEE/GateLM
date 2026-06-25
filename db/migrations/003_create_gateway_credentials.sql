create table if not exists api_keys (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  application_id uuid null references applications(id),
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  expires_at timestamptz null,
  last_used_at timestamptz null,
  created_by_user_id uuid null references users(id),
  revoked_by_user_id uuid null references users(id),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_api_keys_key_hash
  on api_keys (key_hash);

create index if not exists ix_api_keys_prefix
  on api_keys (key_prefix);

create index if not exists ix_api_keys_tenant_project_status
  on api_keys (tenant_id, project_id, status);

create table if not exists app_tokens (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  application_id uuid not null references applications(id),
  name text not null,
  token_prefix text not null,
  token_hash text not null,
  scopes jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  expires_at timestamptz null,
  last_used_at timestamptz null,
  created_by_user_id uuid null references users(id),
  revoked_by_user_id uuid null references users(id),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_app_tokens_token_hash
  on app_tokens (token_hash);

create index if not exists ix_app_tokens_prefix
  on app_tokens (token_prefix);

create index if not exists ix_app_tokens_tenant_project_status
  on app_tokens (tenant_id, project_id, status);
