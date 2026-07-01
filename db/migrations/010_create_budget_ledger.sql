create table if not exists budget_quotas (
  tenant_id uuid not null references tenants(id) on delete cascade,
  budget_scope_type text not null,
  budget_scope_id text not null,
  month_start date not null,
  limit_micro_usd bigint not null,
  warning_threshold_percent int not null default 80,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, budget_scope_type, budget_scope_id, month_start),
  constraint ck_budget_quotas_scope_type check (budget_scope_type in ('application', 'project', 'team')),
  constraint ck_budget_quotas_month_start check (date_trunc('month', month_start::timestamp)::date = month_start),
  constraint ck_budget_quotas_limit_non_negative check (limit_micro_usd >= 0),
  constraint ck_budget_quotas_warning_threshold check (warning_threshold_percent >= 0 and warning_threshold_percent <= 100),
  constraint ck_budget_quotas_status check (status in ('active', 'disabled'))
);

create index if not exists ix_budget_quotas_tenant_scope_status
  on budget_quotas (tenant_id, budget_scope_type, budget_scope_id, status);

create table if not exists budget_ledger_entries (
  request_id text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  application_id uuid null references applications(id) on delete set null,
  budget_scope_type text not null,
  budget_scope_id text not null,
  month_start date not null,
  cost_micro_usd bigint not null,
  source text not null default 'request_log',
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint ck_budget_ledger_scope_type check (budget_scope_type in ('application', 'project', 'team')),
  constraint ck_budget_ledger_month_start check (date_trunc('month', month_start::timestamp)::date = month_start),
  constraint ck_budget_ledger_cost_non_negative check (cost_micro_usd >= 0),
  constraint ck_budget_ledger_source check (source in ('request_log', 'manual_adjustment', 'import'))
);

create index if not exists ix_budget_ledger_scope_month
  on budget_ledger_entries (tenant_id, budget_scope_type, budget_scope_id, month_start);

create index if not exists ix_budget_ledger_project_completed
  on budget_ledger_entries (tenant_id, project_id, completed_at desc);
