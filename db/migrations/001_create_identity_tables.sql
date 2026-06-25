create table if not exists users (
  id uuid primary key,
  email text not null,
  name text null,
  password_hash text null,
  auth_provider text not null default 'local',
  status text not null default 'active',
  last_login_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_users_email_active
  on users (lower(email))
  where deleted_at is null;

create table if not exists tenants (
  id uuid primary key,
  name text not null,
  slug text not null,
  plan text not null default 'starter',
  status text not null default 'active',
  default_timezone text not null default 'Asia/Seoul',
  default_currency text not null default 'USD',
  settings jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_tenants_slug_active
  on tenants (slug)
  where deleted_at is null;

create table if not exists tenant_memberships (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role text not null,
  status text not null default 'active',
  joined_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_tenant_memberships_tenant_user_active
  on tenant_memberships (tenant_id, user_id)
  where deleted_at is null;

create index if not exists ix_tenant_memberships_user
  on tenant_memberships (user_id, status);
