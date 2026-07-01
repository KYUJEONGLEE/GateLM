-- Re-point the P0 invocation log API key foreign key to the v2 Control Plane
-- credential table without rewriting the already-created table.
--
-- This file intentionally uses a forward migration instead of relying on edits
-- to 006_create_p0_invocation_logs_fallback.sql. Existing local/shared DBs may
-- already have p0_llm_invocation_logs_api_key_id_fkey pointing at legacy
-- api_keys(id), while fresh v2 DBs should point at gateway_api_keys(id).
--
-- The migration is idempotent:
-- - no-op when p0_llm_invocation_logs or gateway_api_keys is absent
-- - no-op when the final FK already points at gateway_api_keys
-- - validate the temporary FK before dropping the old FK

do $$
declare
  logs_table regclass := to_regclass('public.p0_llm_invocation_logs');
  gateway_keys_table regclass := to_regclass('public.gateway_api_keys');
  final_constraint_name text := 'p0_llm_invocation_logs_api_key_id_fkey';
  temp_constraint_name text := 'p0_llm_invocation_logs_api_key_id_gateway_api_keys_fkey';
  existing_target_table text;
begin
  if logs_table is null or gateway_keys_table is null then
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'p0_llm_invocation_logs'
      and column_name = 'api_key_id'
  ) then
    return;
  end if;

  select c.confrelid::regclass::text
    into existing_target_table
  from pg_constraint c
  where c.conrelid = logs_table
    and c.conname = final_constraint_name
    and c.contype = 'f';

  if existing_target_table in ('gateway_api_keys', 'public.gateway_api_keys') then
    if exists (
      select 1
      from pg_constraint
      where conrelid = logs_table
        and conname = temp_constraint_name
    ) then
      alter table p0_llm_invocation_logs
        drop constraint p0_llm_invocation_logs_api_key_id_gateway_api_keys_fkey;
    end if;

    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = logs_table
      and conname = temp_constraint_name
  ) then
    alter table p0_llm_invocation_logs
      add constraint p0_llm_invocation_logs_api_key_id_gateway_api_keys_fkey
      foreign key (api_key_id)
      references gateway_api_keys(id)
      not valid;
  end if;
end $$;

do $$
declare
  logs_table regclass := to_regclass('public.p0_llm_invocation_logs');
  gateway_keys_table regclass := to_regclass('public.gateway_api_keys');
  final_constraint_name text := 'p0_llm_invocation_logs_api_key_id_fkey';
  temp_constraint_name text := 'p0_llm_invocation_logs_api_key_id_gateway_api_keys_fkey';
  existing_target_table text;
begin
  if logs_table is null or gateway_keys_table is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = logs_table
      and conname = temp_constraint_name
  ) then
    return;
  end if;

  alter table p0_llm_invocation_logs
    validate constraint p0_llm_invocation_logs_api_key_id_gateway_api_keys_fkey;

  select c.confrelid::regclass::text
    into existing_target_table
  from pg_constraint c
  where c.conrelid = logs_table
    and c.conname = final_constraint_name
    and c.contype = 'f';

  if existing_target_table is not null then
    alter table p0_llm_invocation_logs
      drop constraint p0_llm_invocation_logs_api_key_id_fkey;
  end if;

  alter table p0_llm_invocation_logs
    rename constraint p0_llm_invocation_logs_api_key_id_gateway_api_keys_fkey
    to p0_llm_invocation_logs_api_key_id_fkey;
end $$;
