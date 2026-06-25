create table if not exists projects (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  name text not null,
  slug text not null,
  description text null,
  status text not null default 'active',
  default_provider text null,
  default_model text null,
  settings jsonb not null default '{}'::jsonb,
  created_by_user_id uuid null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_projects_tenant_slug_active
  on projects (tenant_id, slug)
  where deleted_at is null;

create index if not exists ix_projects_tenant_status
  on projects (tenant_id, status);

create table if not exists project_memberships (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  user_id uuid not null references users(id),
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_project_memberships_project_user_active
  on project_memberships (project_id, user_id)
  where deleted_at is null;

create index if not exists ix_project_memberships_tenant_user
  on project_memberships (tenant_id, user_id, status);

create table if not exists applications (
  id uuid primary key,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  name text not null,
  slug text not null,
  type text not null default 'customer_app',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create unique index if not exists ux_applications_project_slug_active
  on applications (project_id, slug)
  where deleted_at is null;

create index if not exists ix_applications_tenant_project_status
  on applications (tenant_id, project_id, status);
