-- Stage A for a later online conversion of p0_llm_invocation_logs to monthly
-- range partitions. This migration keeps the legacy heap in place and is safe
-- for Gateway versions that still use ON CONFLICT (request_id) DO NOTHING.

create table if not exists p0_llm_invocation_log_keys (
  request_id text primary key,
  log_id uuid not null unique,
  created_at timestamptz not null,
  first_seen_at timestamptz not null default now()
);

create table if not exists p0_llm_invocation_log_partition_migrations (
  stage text primary key,
  completed_at timestamptz not null default now(),
  source_row_count bigint not null,
  constraint ck_p0_llm_invocation_log_partition_migration_stage
    check (stage in ('key_registry_backfill')),
  constraint ck_p0_llm_invocation_log_partition_migration_count
    check (source_row_count >= 0)
);

create or replace function capture_p0_llm_invocation_log_key()
returns trigger
language plpgsql
as $$
begin
  insert into p0_llm_invocation_log_keys (request_id, log_id, created_at)
  values (new.request_id, new.id, new.created_at)
  on conflict (request_id) do nothing;

  if not exists (
    select 1
    from p0_llm_invocation_log_keys keys
    where keys.request_id = new.request_id
      and keys.log_id = new.id
      and keys.created_at = new.created_at
  ) then
    raise exception using
      errcode = '23505',
      message = 'p0 invocation log request identity conflicts with the global key registry';
  end if;

  return new;
end
$$;

do $$
begin
  if to_regclass('public.p0_llm_invocation_logs') is null then
    return;
  end if;

  if (
    select relkind
    from pg_class
    where oid = 'public.p0_llm_invocation_logs'::regclass
  ) <> 'r' then
    return;
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.p0_llm_invocation_logs'::regclass
      and tgname = 'trg_capture_p0_llm_invocation_log_key'
      and not tgisinternal
  ) then
    create trigger trg_capture_p0_llm_invocation_log_key
      after insert on p0_llm_invocation_logs
      for each row
      execute function capture_p0_llm_invocation_log_key();
  end if;
end
$$;

do $$
declare
  source_count bigint;
begin
  if exists (
    select 1
    from p0_llm_invocation_log_partition_migrations
    where stage = 'key_registry_backfill'
  ) then
    return;
  end if;

  insert into p0_llm_invocation_log_keys (request_id, log_id, created_at)
  select request_id, id, created_at
  from p0_llm_invocation_logs
  on conflict do nothing;

  if exists (
    select 1
    from p0_llm_invocation_logs logs
    left join p0_llm_invocation_log_keys keys
      on keys.request_id = logs.request_id
     and keys.log_id = logs.id
     and keys.created_at = logs.created_at
    where keys.request_id is null
  ) then
    raise exception 'p0 invocation log key registry parity check failed';
  end if;

  select count(*) into source_count from p0_llm_invocation_logs;
  insert into p0_llm_invocation_log_partition_migrations (
    stage,
    source_row_count
  ) values (
    'key_registry_backfill',
    source_count
  );
end
$$;
