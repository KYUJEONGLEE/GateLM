insert into provider_presets (
  "providerKey",
  "displayName",
  "adapterType",
  "baseUrl",
  "modelsEndpointPath",
  "credentialRequired",
  "defaultResolver",
  "defaultTimeoutMs",
  "status",
  "sortOrder",
  "providerConfig",
  "createdAt",
  "updatedAt"
)
values
  (
    'groq',
    'Groq',
    'openai_compatible',
    'https://api.groq.com/openai/v1',
    '/models',
    true,
    'environment',
    30000,
    'ACTIVE',
    30,
    '{"providerKey":"groq","providerFamily":"groq","adapterType":"openai_compatible","requestFormat":"openai_chat_completions","models":["llama-3.1-8b-instant","llama-3.3-70b-versatile","openai/gpt-oss-20b","openai/gpt-oss-120b"],"modelMetadata":{"llama-3.1-8b-instant":{"contextWindowTokens":131072,"displayName":"Llama 3.1 8B Instant","maxOutputTokens":131072,"supportsJsonMode":true,"supportsStreaming":true},"llama-3.3-70b-versatile":{"contextWindowTokens":131072,"displayName":"Llama 3.3 70B Versatile","maxOutputTokens":32768,"supportsJsonMode":true,"supportsStreaming":true},"openai/gpt-oss-20b":{"contextWindowTokens":131072,"displayName":"GPT-OSS 20B","maxOutputTokens":65536,"supportsJsonMode":true,"supportsStreaming":true},"openai/gpt-oss-120b":{"contextWindowTokens":131072,"displayName":"GPT-OSS 120B","maxOutputTokens":65536,"supportsJsonMode":true,"supportsStreaming":true}},"modelsEndpointPath":"/models","credentialRequired":true,"modelDiscovery":{"type":"openai_compatible_models","cacheTtlSeconds":3600}}'::jsonb,
    now(),
    now()
  ),
  (
    'cerebras',
    'Cerebras',
    'openai_compatible',
    'https://api.cerebras.ai/v1',
    '/models',
    true,
    'environment',
    30000,
    'ACTIVE',
    40,
    '{"providerKey":"cerebras","providerFamily":"cerebras","adapterType":"openai_compatible","requestFormat":"openai_chat_completions","models":["gpt-oss-120b"],"modelMetadata":{"gpt-oss-120b":{"contextWindowTokens":131072,"displayName":"GPT-OSS 120B","maxOutputTokens":40960,"supportsJsonMode":true,"supportsStreaming":true}},"modelsEndpointPath":"/models","credentialRequired":true,"modelDiscovery":{"type":"openai_compatible_models","cacheTtlSeconds":3600}}'::jsonb,
    now(),
    now()
  ),
  (
    'mistral',
    'Mistral AI',
    'openai_compatible',
    'https://api.mistral.ai/v1',
    '/models',
    true,
    'environment',
    30000,
    'ACTIVE',
    50,
    '{"providerKey":"mistral","providerFamily":"mistral","adapterType":"openai_compatible","requestFormat":"openai_chat_completions","models":["mistral-small-latest","mistral-medium-latest","mistral-large-latest"],"modelMetadata":{"mistral-small-latest":{"contextWindowTokens":256000,"displayName":"Mistral Small","supportsJsonMode":true,"supportsStreaming":true},"mistral-medium-latest":{"contextWindowTokens":256000,"displayName":"Mistral Medium","supportsJsonMode":true,"supportsStreaming":true},"mistral-large-latest":{"contextWindowTokens":256000,"displayName":"Mistral Large","supportsJsonMode":true,"supportsStreaming":true}},"modelsEndpointPath":"/models","credentialRequired":true,"modelDiscovery":{"type":"openai_compatible_models","cacheTtlSeconds":3600}}'::jsonb,
    now(),
    now()
  )
on conflict ("providerKey") do update set
  "displayName" = excluded."displayName",
  "adapterType" = excluded."adapterType",
  "baseUrl" = excluded."baseUrl",
  "modelsEndpointPath" = excluded."modelsEndpointPath",
  "credentialRequired" = excluded."credentialRequired",
  "defaultResolver" = excluded."defaultResolver",
  "defaultTimeoutMs" = excluded."defaultTimeoutMs",
  "status" = excluded."status",
  "sortOrder" = excluded."sortOrder",
  "providerConfig" = excluded."providerConfig",
  "updatedAt" = now();

with provider_model_seed (
  provider_family,
  model,
  display_name,
  context_window_tokens,
  max_output_tokens,
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  source
) as (
  values
    ('groq', 'llama-3.1-8b-instant', 'Llama 3.1 8B Instant', 131072, 131072, 50000, 80000, 'https://groq.com/pricing'),
    ('groq', 'llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile', 131072, 32768, 590000, 790000, 'https://groq.com/pricing'),
    ('groq', 'openai/gpt-oss-20b', 'GPT-OSS 20B', 131072, 65536, 75000, 300000, 'https://groq.com/pricing'),
    ('groq', 'openai/gpt-oss-120b', 'GPT-OSS 120B', 131072, 65536, 150000, 600000, 'https://groq.com/pricing'),
    ('cerebras', 'gpt-oss-120b', 'GPT-OSS 120B', 131072, 40960, 350000, 750000, 'https://inference-docs.cerebras.ai/api-reference/models/public-models'),
    ('mistral', 'mistral-small-latest', 'Mistral Small', 256000, null, 150000, 600000, 'https://mistral.ai/pricing/api/'),
    ('mistral', 'mistral-medium-latest', 'Mistral Medium', 256000, null, 1500000, 7500000, 'https://mistral.ai/pricing/api/'),
    ('mistral', 'mistral-large-latest', 'Mistral Large', 256000, null, 500000, 1500000, 'https://mistral.ai/pricing/api/')
),
catalog_rows as (
  select
    row_number() over (order by provider, model) as ordinal,
    provider,
    seed.*
  from provider_model_seed seed
  cross join lateral (
    values (seed.provider_family), (seed.provider_family || '-main')
  ) as aliases(provider)
)
insert into model_catalog (
  id,
  provider,
  model,
  display_name,
  capabilities,
  context_window_tokens,
  status,
  metadata
)
select
  ('00000000-0000-4000-8000-' || lpad((2000 + ordinal)::text, 12, '0'))::uuid,
  provider,
  model,
  display_name,
  '["chat","streaming","json_mode"]'::jsonb,
  context_window_tokens,
  'active',
  jsonb_build_object(
    'providerFamily', provider_family,
    'pricingBasis', 'official_pricing',
    'source', source,
    'supportsJsonMode', true,
    'supportsStreaming', true
  ) || case
    when max_output_tokens is null then '{}'::jsonb
    else jsonb_build_object('maxOutputTokens', max_output_tokens)
  end
from catalog_rows
on conflict (provider, model) do update set
  display_name = excluded.display_name,
  capabilities = excluded.capabilities,
  context_window_tokens = excluded.context_window_tokens,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

with provider_model_seed (
  provider_family,
  model,
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  source
) as (
  values
    ('groq', 'llama-3.1-8b-instant', 50000, 80000, 'https://groq.com/pricing'),
    ('groq', 'llama-3.3-70b-versatile', 590000, 790000, 'https://groq.com/pricing'),
    ('groq', 'openai/gpt-oss-20b', 75000, 300000, 'https://groq.com/pricing'),
    ('groq', 'openai/gpt-oss-120b', 150000, 600000, 'https://groq.com/pricing'),
    ('cerebras', 'gpt-oss-120b', 350000, 750000, 'https://inference-docs.cerebras.ai/api-reference/models/public-models'),
    ('mistral', 'mistral-small-latest', 150000, 600000, 'https://mistral.ai/pricing/api/'),
    ('mistral', 'mistral-medium-latest', 1500000, 7500000, 'https://mistral.ai/pricing/api/'),
    ('mistral', 'mistral-large-latest', 500000, 1500000, 'https://mistral.ai/pricing/api/')
),
pricing_rows as (
  select
    row_number() over (order by provider, model) as ordinal,
    provider,
    seed.*
  from provider_model_seed seed
  cross join lateral (
    values (seed.provider_family), (seed.provider_family || '-main')
  ) as aliases(provider)
)
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
)
select
  ('00000000-0000-4000-8000-' || lpad((2100 + ordinal)::text, 12, '0'))::uuid,
  provider,
  model,
  'USD',
  input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens,
  'official-pricing-2026-07-15-v1',
  '2026-07-15 00:00:00+00',
  source
from pricing_rows
on conflict (id) do update set
  provider = excluded.provider,
  model = excluded.model,
  currency = excluded.currency,
  input_micro_usd_per_1m_tokens = excluded.input_micro_usd_per_1m_tokens,
  output_micro_usd_per_1m_tokens = excluded.output_micro_usd_per_1m_tokens,
  pricing_version = excluded.pricing_version,
  effective_from = excluded.effective_from,
  effective_to = excluded.effective_to,
  source = excluded.source;
