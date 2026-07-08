with openai_gpt_model_seed(model, seed_order) as (
  values
    ('gpt-4o-mini', 1),
    ('gpt-4o', 2),
    ('gpt-5.5', 3),
    ('gpt-5.5-pro', 4),
    ('gpt-5.4', 5),
    ('gpt-5.4-mini', 6),
    ('gpt-5.4-nano', 7),
    ('gpt-5.4-pro', 8),
    ('gpt-5.3-codex', 9),
    ('gpt-5.2', 10),
    ('gpt-5.2-pro', 11),
    ('gpt-5.2-codex', 12),
    ('gpt-5.1', 13),
    ('gpt-5.1-codex', 14),
    ('gpt-5.1-codex-mini', 15),
    ('gpt-5.1-codex-max', 16),
    ('gpt-5', 17),
    ('gpt-5-mini', 18),
    ('gpt-5-nano', 19),
    ('gpt-5-pro', 20),
    ('gpt-4.5-preview', 21),
    ('gpt-4.1', 22),
    ('gpt-4.1-mini', 23),
    ('gpt-4.1-nano', 24),
    ('gpt-3.5-turbo', 25),
    ('chat-latest', 26)
)
update provider_connections pc
set "providerConfig" = coalesce(pc."providerConfig", '{}'::jsonb) || jsonb_build_object(
  'models',
  (
    select jsonb_agg(model order by first_order)
    from (
      select model, min(model_order) as first_order
      from (
        select existing_model.model, existing_model.ordinality::int as model_order
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(pc."providerConfig", '{}'::jsonb)->'models') = 'array'
              then coalesce(pc."providerConfig", '{}'::jsonb)->'models'
            else '[]'::jsonb
          end
        ) with ordinality as existing_model(model, ordinality)
        union all
        select seed.model, 100000 + seed.seed_order
        from openai_gpt_model_seed seed
      ) merged_models
      where btrim(model) <> ''
      group by model
    ) deduped_models
  )
)
where pc.provider in ('openai', 'openai-main');

with openai_gpt_model_seed(model, seed_order) as (
  values
    ('gpt-4o-mini', 1),
    ('gpt-4o', 2),
    ('gpt-5.5', 3),
    ('gpt-5.5-pro', 4),
    ('gpt-5.4', 5),
    ('gpt-5.4-mini', 6),
    ('gpt-5.4-nano', 7),
    ('gpt-5.4-pro', 8),
    ('gpt-5.3-codex', 9),
    ('gpt-5.2', 10),
    ('gpt-5.2-pro', 11),
    ('gpt-5.2-codex', 12),
    ('gpt-5.1', 13),
    ('gpt-5.1-codex', 14),
    ('gpt-5.1-codex-mini', 15),
    ('gpt-5.1-codex-max', 16),
    ('gpt-5', 17),
    ('gpt-5-mini', 18),
    ('gpt-5-nano', 19),
    ('gpt-5-pro', 20),
    ('gpt-4.5-preview', 21),
    ('gpt-4.1', 22),
    ('gpt-4.1-mini', 23),
    ('gpt-4.1-nano', 24),
    ('gpt-3.5-turbo', 25),
    ('chat-latest', 26)
)
update provider_presets preset
set "providerConfig" = coalesce(preset."providerConfig", '{}'::jsonb) || jsonb_build_object(
  'models',
  (
    select jsonb_agg(model order by first_order)
    from (
      select model, min(model_order) as first_order
      from (
        select existing_model.model, existing_model.ordinality::int as model_order
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(coalesce(preset."providerConfig", '{}'::jsonb)->'models') = 'array'
              then coalesce(preset."providerConfig", '{}'::jsonb)->'models'
            else '[]'::jsonb
          end
        ) with ordinality as existing_model(model, ordinality)
        union all
        select seed.model, seed.seed_order
        from openai_gpt_model_seed seed
      ) merged_models
      where btrim(model) <> ''
      group by model
    ) deduped_models
  )
)
where preset."providerKey" = 'openai';
