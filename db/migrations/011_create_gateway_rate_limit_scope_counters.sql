create table if not exists gateway_rate_limit_scope_counters (
  tenant_id uuid not null references tenants(id) on delete cascade,
  scope_type text not null,
  scope_id text not null,
  window_start timestamptz not null,
  window_seconds int not null,
  limit_value int not null,
  request_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, scope_type, scope_id, window_start),
  constraint ck_gateway_rate_limit_scope_type check (scope_type in ('application', 'project')),
  constraint ck_gateway_rate_limit_scope_id_non_empty check (length(trim(scope_id)) > 0),
  constraint ck_gateway_rate_limit_scope_window_seconds_positive check (window_seconds > 0),
  constraint ck_gateway_rate_limit_scope_limit_value_positive check (limit_value > 0),
  constraint ck_gateway_rate_limit_scope_request_count_non_negative check (request_count >= 0)
);

create index if not exists ix_gateway_rate_limit_scope_counters_scope_updated
  on gateway_rate_limit_scope_counters (tenant_id, scope_type, scope_id, updated_at desc);

create index if not exists ix_gateway_rate_limit_scope_counters_updated
  on gateway_rate_limit_scope_counters (updated_at);
