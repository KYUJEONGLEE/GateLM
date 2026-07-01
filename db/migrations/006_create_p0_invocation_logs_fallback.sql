create table if not exists p0_llm_invocation_logs (
  id uuid primary key,
  request_id text not null,
  trace_id text not null,
  tenant_id uuid not null references tenants(id),
  project_id uuid not null references projects(id),
  application_id uuid null references applications(id),
  api_key_id uuid null references gateway_api_keys(id),
  app_token_id uuid null references app_tokens(id),
  end_user_id text null,
  feature_id text null,
  endpoint text not null,
  method text not null,
  source text not null,
  stream boolean not null default false,
  requested_provider text null,
  requested_model text null,
  provider text not null default '',
  model text not null default '',
  selected_provider text null,
  selected_model text null,
  routing_reason text null,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  cost_micro_usd bigint not null default 0,
  saved_cost_micro_usd bigint not null default 0,
  latency_ms int not null default 0,
  provider_latency_ms int null,
  status text not null,
  http_status int not null,
  error_code text null,
  error_message text null,
  error_stage text null,
  cache_status text not null default 'bypass',
  cache_type text not null default 'none',
  cache_key_hash text null,
  cache_hit_request_id text null,
  masking_action text not null default 'none',
  masking_detected_types jsonb not null default '[]'::jsonb,
  masking_detected_count int not null default 0,
  request_body_hash text not null,
  prompt_hash text not null,
  redacted_prompt_preview text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  completed_at timestamptz null,
  ingested_at timestamptz not null default now()
);

create unique index if not exists ux_p0_llm_invocation_logs_request_id
  on p0_llm_invocation_logs (request_id);

create index if not exists ix_p0_llm_invocation_logs_project_created
  on p0_llm_invocation_logs (tenant_id, project_id, created_at desc);

create index if not exists ix_p0_llm_invocation_logs_status_created
  on p0_llm_invocation_logs (tenant_id, status, created_at desc);
