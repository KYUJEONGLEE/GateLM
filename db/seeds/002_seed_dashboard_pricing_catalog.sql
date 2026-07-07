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
  '00000000-0000-4000-8000-000000000711',
  'mock',
  '00000000-0000-4000-8000-000000000600:mock-fast',
  'Mock Fast',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed","aliasOf":"mock-fast"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000712',
  'mock',
  '00000000-0000-4000-8000-000000000600:mock-balanced',
  'Mock Balanced',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed","aliasOf":"mock-balanced"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000713',
  'mock',
  'mock-fast',
  'Mock Fast',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000714',
  'mock',
  'mock-balanced',
  'Mock Balanced',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000715',
  'mock',
  'mock-smart',
  'Mock Smart',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000716',
  'openai-main',
  'gpt-4o-mini',
  'GPT-4o mini',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000717',
  'openai-main',
  '00000000-0000-4000-8000-000000000601:gpt-4o-mini',
  'GPT-4o mini',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed","aliasOf":"gpt-4o-mini"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000718',
  'openai-main',
  'gpt-4o',
  'GPT-4o',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000719',
  'openai-main',
  '00000000-0000-4000-8000-000000000601:gpt-4o',
  'GPT-4o',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed","aliasOf":"gpt-4o"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000720',
  'gemini',
  'gemini-2.5-flash-lite',
  'Gemini 2.5 Flash Lite',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed"}'::jsonb
),
(
  '00000000-0000-4000-8000-000000000721',
  'gemini',
  '8befb678-8d4b-4654-89ec-3d90e6f92d74:gemini-2.5-flash-lite',
  'Gemini 2.5 Flash Lite',
  '["chat"]'::jsonb,
  'active',
  '{"pricingBasis":"demo_seed","aliasOf":"gemini-2.5-flash-lite"}'::jsonb
)
on conflict (provider, model) do update set
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
  '00000000-0000-4000-8000-000000000821',
  'mock',
  '00000000-0000-4000-8000-000000000600:mock-fast',
  'USD',
  100000,
  400000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000822',
  'mock',
  '00000000-0000-4000-8000-000000000600:mock-balanced',
  'USD',
  300000,
  800000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000823',
  'mock',
  'mock-fast',
  'USD',
  100000,
  400000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000824',
  'mock',
  'mock-balanced',
  'USD',
  300000,
  800000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000825',
  'mock',
  'mock-smart',
  'USD',
  1000000,
  3000000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000826',
  'openai-main',
  'gpt-4o-mini',
  'USD',
  150000,
  600000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000827',
  'openai-main',
  '00000000-0000-4000-8000-000000000601:gpt-4o-mini',
  'USD',
  150000,
  600000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000828',
  'openai-main',
  'gpt-4o',
  'USD',
  2500000,
  10000000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000829',
  'openai-main',
  '00000000-0000-4000-8000-000000000601:gpt-4o',
  'USD',
  2500000,
  10000000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000830',
  'gemini',
  'gemini-2.5-flash-lite',
  'USD',
  100000,
  400000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
),
(
  '00000000-0000-4000-8000-000000000831',
  'gemini',
  '8befb678-8d4b-4654-89ec-3d90e6f92d74:gemini-2.5-flash-lite',
  'USD',
  100000,
  400000,
  'dashboard-demo-2026-07-06',
  '2026-07-01 00:00:00+00',
  'local_demo_seed'
)
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
