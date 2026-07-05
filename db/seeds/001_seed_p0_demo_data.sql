insert into users (
  id,
  email,
  name,
  password_hash,
  auth_provider,
  status,
  metadata
) values (
  '00000000-0000-4000-8000-000000000110',
  'admin@example.com',
  'P0 Admin',
  null,
  'local',
  'active',
  '{"seedAlias":"admin_p0","notice":"demo placeholder user; no plaintext password in seed"}'::jsonb
)
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  auth_provider = excluded.auth_provider,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now(),
  deleted_at = null;

insert into tenants (
  id,
  name,
  slug,
  plan,
  status,
  default_timezone,
  default_currency,
  settings,
  created_by_user_id
) values (
  '00000000-0000-4000-8000-000000000100',
  'Acme Corp',
  'acme',
  'starter',
  'active',
  'Asia/Seoul',
  'USD',
  '{"seedAlias":"tenant_acme_p0"}'::jsonb,
  '00000000-0000-4000-8000-000000000110'
)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  plan = excluded.plan,
  status = excluded.status,
  default_timezone = excluded.default_timezone,
  default_currency = excluded.default_currency,
  settings = excluded.settings,
  created_by_user_id = excluded.created_by_user_id,
  updated_at = now(),
  deleted_at = null;

insert into tenant_memberships (
  id,
  tenant_id,
  user_id,
  role,
  status,
  joined_at
) values (
  '00000000-0000-4000-8000-000000000120',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000110',
  'tenant_admin',
  'active',
  now()
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  user_id = excluded.user_id,
  role = excluded.role,
  status = excluded.status,
  updated_at = now(),
  deleted_at = null;

insert into projects (
  id,
  tenant_id,
  name,
  slug,
  description,
  status,
  default_provider,
  default_model,
  settings,
  created_by_user_id
) values (
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000100',
  'CampaignBot',
  'campaign-bot',
  'P0 demo project for GateLM gateway flow',
  'active',
  'mock',
  'mock-balanced',
  '{"seedAlias":"project_campaign_p0","securityPolicyHash":"sec_p0_v1","routingPolicyHash":"route_p0_v1","cachePolicyHash":"cache_p0_v1"}'::jsonb,
  '00000000-0000-4000-8000-000000000110'
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  status = excluded.status,
  default_provider = excluded.default_provider,
  default_model = excluded.default_model,
  settings = excluded.settings,
  created_by_user_id = excluded.created_by_user_id,
  updated_at = now(),
  deleted_at = null;

insert into project_memberships (
  id,
  tenant_id,
  project_id,
  user_id,
  role,
  status
) values (
  '00000000-0000-4000-8000-000000000210',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000110',
  'project_admin',
  'active'
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  user_id = excluded.user_id,
  role = excluded.role,
  status = excluded.status,
  updated_at = now(),
  deleted_at = null;

insert into applications (
  id,
  tenant_id,
  project_id,
  name,
  slug,
  type,
  status,
  metadata
) values (
  '00000000-0000-4000-8000-000000000300',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  'CampaignBot Web',
  'campaign-web',
  'customer_app',
  'active',
  '{"seedAlias":"app_campaign_web_p0"}'::jsonb
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  name = excluded.name,
  slug = excluded.slug,
  type = excluded.type,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now(),
  deleted_at = null;

insert into api_keys (
  id,
  tenant_id,
  project_id,
  application_id,
  name,
  key_prefix,
  key_hash,
  scopes,
  status,
  created_by_user_id
) values (
  '00000000-0000-4000-8000-000000000400',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000300',
  'CampaignBot Gateway Key',
  'glm_api_p0_demo',
  'local-demo-api-key-hash-placeholder',
  '["gateway:chat","gateway:models"]'::jsonb,
  'active',
  '00000000-0000-4000-8000-000000000110'
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  application_id = excluded.application_id,
  name = excluded.name,
  key_prefix = excluded.key_prefix,
  key_hash = excluded.key_hash,
  scopes = excluded.scopes,
  status = excluded.status,
  created_by_user_id = excluded.created_by_user_id,
  updated_at = now(),
  deleted_at = null;

insert into app_tokens (
  id,
  tenant_id,
  project_id,
  application_id,
  name,
  token_prefix,
  token_hash,
  scopes,
  status,
  created_by_user_id
) values (
  '00000000-0000-4000-8000-000000000500',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  '00000000-0000-4000-8000-000000000300',
  'CampaignBot App Token',
  'glm_app_p0_demo',
  'local-demo-app-token-hash-placeholder',
  '["app:invoke"]'::jsonb,
  'active',
  '00000000-0000-4000-8000-000000000110'
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  application_id = excluded.application_id,
  name = excluded.name,
  token_prefix = excluded.token_prefix,
  token_hash = excluded.token_hash,
  scopes = excluded.scopes,
  status = excluded.status,
  created_by_user_id = excluded.created_by_user_id,
  updated_at = now(),
  deleted_at = null;

insert into provider_connections (
  id,
  tenant_id,
  project_id,
  name,
  provider,
  base_url,
  status,
  default_model,
  secret_ref,
  credential_preview,
  config,
  created_by_user_id
) values (
  '00000000-0000-4000-8000-000000000600',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000200',
  'P0 Mock Provider',
  'mock',
  'http://mock-provider:8090',
  'active',
  'mock-balanced',
  'local/mock-provider/no-secret-required',
  'mock-provider',
  '{"baseUrlInDocker":"http://mock-provider:8090","baseUrlOnHost":"http://localhost:8090"}'::jsonb,
  '00000000-0000-4000-8000-000000000110'
)
on conflict (id) do update set
  tenant_id = excluded.tenant_id,
  project_id = excluded.project_id,
  name = excluded.name,
  provider = excluded.provider,
  base_url = excluded.base_url,
  status = excluded.status,
  default_model = excluded.default_model,
  secret_ref = excluded.secret_ref,
  credential_preview = excluded.credential_preview,
  config = excluded.config,
  created_by_user_id = excluded.created_by_user_id,
  updated_at = now(),
  deleted_at = null;

insert into model_catalog (
  id,
  provider,
  model,
  display_name,
  capabilities,
  status,
  metadata
) values
(
  '00000000-0000-4000-8000-000000000701',
  'mock',
  'mock-fast',
  'Mock Fast',
  '["chat"]'::jsonb,
  'active',
  '{"purpose":"low-cost / short prompt"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000702',
  'mock',
  'mock-balanced',
  'Mock Balanced',
  '["chat"]'::jsonb,
  'active',
  '{"purpose":"default model"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000703',
  'mock',
  'mock-smart',
  'Mock Smart',
  '["chat"]'::jsonb,
  'active',
  '{"purpose":"optional high-quality demo"}'::jsonb
)
on conflict (id) do update set
  provider = excluded.provider,
  model = excluded.model,
  display_name = excluded.display_name,
  capabilities = excluded.capabilities,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

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
) values
(
  '00000000-0000-4000-8000-000000000801',
  'mock',
  'mock-fast',
  'USD',
  100000,
  400000,
  'p0-demo',
  '2024-01-01 00:00:00+00',
  'p0_seed'
),
(
  '00000000-0000-4000-8000-000000000802',
  'mock',
  'mock-balanced',
  'USD',
  300000,
  800000,
  'p0-demo',
  '2024-01-01 00:00:00+00',
  'p0_seed'
),
(
  '00000000-0000-4000-8000-000000000803',
  'mock',
  'mock-smart',
  'USD',
  1000000,
  3000000,
  'p0-demo',
  '2024-01-01 00:00:00+00',
  'p0_seed'
),
(
  '00000000-0000-4000-8000-000000000804',
  'openai-main',
  'gpt-4o-mini',
  'USD',
  150000,
  600000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000805',
  'openai-main',
  'gpt-4o',
  'USD',
  2500000,
  10000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000806',
  'openai',
  'gpt-4o-mini',
  'USD',
  150000,
  600000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000807',
  'openai',
  'gpt-4o',
  'USD',
  2500000,
  10000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000808',
  'gemini',
  'gemini-1.5-flash',
  'USD',
  75000,
  300000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000809',
  'gemini',
  'gemini-1.5-pro',
  'USD',
  1250000,
  5000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000810',
  'claude',
  'claude-3-5-haiku-latest',
  'USD',
  800000,
  4000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000811',
  'claude',
  'claude-3-5-sonnet-latest',
  'USD',
  3000000,
  15000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000812',
  'anthropic',
  'claude-3-5-haiku-latest',
  'USD',
  800000,
  4000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000813',
  'anthropic',
  'claude-3-5-sonnet-latest',
  'USD',
  3000000,
  15000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000814',
  'claude-main',
  'claude-3-5-haiku-latest',
  'USD',
  800000,
  4000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000815',
  'claude-main',
  'claude-3-5-sonnet-latest',
  'USD',
  3000000,
  15000000,
  '2026-07-foundation-demo-v1',
  '2026-07-01 00:00:00+00',
  'foundation_demo_seed'
)
on conflict (id) do update set
  provider = excluded.provider,
  model = excluded.model,
  currency = excluded.currency,
  input_micro_usd_per_1m_tokens = excluded.input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens = excluded.output_micro_usd_per_1m_tokens,
  pricing_version = excluded.pricing_version,
  effective_from = excluded.effective_from,
  source = excluded.source;
