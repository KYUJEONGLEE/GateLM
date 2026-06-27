create table if not exists gateway_rate_limit_counters (
  tenant_id uuid not null references tenants(id),
  application_id uuid not null references applications(id),
  window_start timestamptz not null,
  window_seconds int not null,
  limit_value int not null,
  request_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, application_id, window_start),
  constraint ck_gateway_rate_limit_window_seconds_positive check (window_seconds > 0),
  constraint ck_gateway_rate_limit_limit_value_positive check (limit_value > 0),
  constraint ck_gateway_rate_limit_request_count_non_negative check (request_count >= 0)
);

create index if not exists ix_gateway_rate_limit_counters_application_updated
  on gateway_rate_limit_counters (tenant_id, application_id, updated_at desc);

create index if not exists ix_gateway_rate_limit_counters_updated
  on gateway_rate_limit_counters (updated_at);
