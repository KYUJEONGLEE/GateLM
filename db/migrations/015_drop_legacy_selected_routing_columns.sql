-- Routing contract v2 removes duplicate selected target fields.
-- Actual provider/model columns remain for provider-attempt and cost records.
alter table if exists p0_llm_invocation_logs
  drop column if exists selected_provider,
  drop column if exists selected_model;
