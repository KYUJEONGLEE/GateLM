\set ON_ERROR_STOP on

-- This is an explicitly approved Stage B maintenance operation, not an
-- automatically applied migration. Run it only after every active Gateway has
-- the Stage A target-less ON CONFLICT writer.
\if :{?partition_cutover_approved}
\else
  \echo 'partition_cutover_approved is required'
  \quit 3
\endif

\if :partition_cutover_approved
\else
  \echo 'partition_cutover_approved must be true'
  \quit 3
\endif

do $$
declare
  source_kind "char";
begin
  select relkind
    into source_kind
  from pg_class
  where oid = to_regclass('public.p0_llm_invocation_logs');

  if source_kind is null then
    raise exception 'p0_llm_invocation_logs does not exist';
  end if;
end
$$;

select (relkind = 'p')::text as already_partitioned
from pg_class
where oid = 'public.p0_llm_invocation_logs'::regclass
\gset

\if :already_partitioned
  \echo 'p0_llm_invocation_logs is already partitioned; no cutover was performed'
  \quit 0
\endif

select pg_advisory_lock(hashtextextended('gatelm:p0-invocation-log-monthly-cutover', 0));

do $$
begin
  if to_regclass('public.p0_llm_invocation_log_keys') is null then
    raise exception 'Stage A key registry is missing';
  end if;

  if to_regclass('public.p0_llm_invocation_log_partition_migrations') is null
     or not exists (
       select 1
       from p0_llm_invocation_log_partition_migrations
       where stage = 'key_registry_backfill'
     ) then
    raise exception 'Stage A key registry backfill is not marked complete';
  end if;

  if to_regclass('public.p0_llm_invocation_logs_legacy_unpartitioned') is not null then
    raise exception 'legacy backup table already exists; inspect the previous cutover before retrying';
  end if;

  if exists (
    select 1
    from p0_llm_invocation_logs logs
    left join p0_llm_invocation_log_keys keys
      on keys.request_id = logs.request_id
     and keys.log_id = logs.id
     and keys.created_at = logs.created_at
    where keys.request_id is null
  ) then
    raise exception 'Stage A key registry parity check failed';
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.p0_llm_invocation_logs'::regclass
      and not tgisinternal
      and tgname not in (
        'trg_capture_p0_llm_invocation_log_key',
        'trg_mirror_p0_llm_invocation_logs_to_partitioned'
      )
  ) then
    raise exception 'unexpected user trigger exists on p0_llm_invocation_logs';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.p0_llm_invocation_logs'::regclass
      and tgname = 'trg_capture_p0_llm_invocation_log_key'
      and not tgisinternal
      and tgenabled = 'O'
  ) then
    raise exception 'Stage A key-capture trigger is missing or disabled';
  end if;

  if exists (
    select 1
    from pg_class
    where oid = 'public.p0_llm_invocation_logs'::regclass
      and relrowsecurity
  ) then
    raise exception 'row-level security must be reviewed before partition cutover';
  end if;

  if exists (
    select 1
    from pg_depend dependency
    join pg_rewrite rewrite on rewrite.oid = dependency.objid
    join pg_class dependent on dependent.oid = rewrite.ev_class
    where dependency.refobjid = 'public.p0_llm_invocation_logs'::regclass
      and dependent.relkind in ('v', 'm')
  ) then
    raise exception 'a view or materialized view depends on p0_llm_invocation_logs';
  end if;
end
$$;

drop trigger if exists trg_mirror_p0_llm_invocation_logs_to_partitioned
  on p0_llm_invocation_logs;
drop function if exists mirror_p0_llm_invocation_log_to_partitioned();
drop table if exists p0_llm_invocation_logs_partitioned cascade;

create table p0_llm_invocation_logs_partitioned (
  like p0_llm_invocation_logs
    including defaults
    including generated
    including identity
    including storage
    including comments
) partition by range (created_at);

alter table p0_llm_invocation_logs_partitioned
  add constraint p0_llm_invocation_logs_partitioned_pkey
    primary key (id, created_at),
  add constraint ck_p0_llm_invocation_logs_partitioned_ttft_non_negative
    check (ttft_ms is null or ttft_ms >= 0);

-- Preserve the deployed database's exact FK delete/update actions instead of
-- assuming that every historical installation started from the same bootstrap.
do $$
declare
  source_constraint record;
  partitioned_name text;
begin
  for source_constraint in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.p0_llm_invocation_logs'::regclass
      and contype = 'f'
    order by conname
  loop
    partitioned_name := 'partitioned_' || source_constraint.conname;
    if length(partitioned_name) > 63 then
      raise exception 'foreign-key constraint name is too long to preserve: %', source_constraint.conname;
    end if;

    execute format(
      'alter table p0_llm_invocation_logs_partitioned add constraint %I %s',
      partitioned_name,
      source_constraint.definition
    );
  end loop;
end
$$;

create unique index ux_p0_llm_invocation_logs_partitioned_request_created
  on p0_llm_invocation_logs_partitioned (request_id, created_at);

create index ix_p0_llm_invocation_logs_partitioned_project_created
  on p0_llm_invocation_logs_partitioned (
    tenant_id,
    project_id,
    created_at desc
  );

create index ix_p0_llm_invocation_logs_partitioned_status_created
  on p0_llm_invocation_logs_partitioned (
    tenant_id,
    status,
    created_at desc
  );

create index ix_p0_llm_invocation_logs_partitioned_employee_usage
  on p0_llm_invocation_logs_partitioned (
    tenant_id,
    project_id,
    end_user_id,
    created_at desc
  );

create index ix_p0_llm_invocation_logs_partitioned_ingested_request
  on p0_llm_invocation_logs_partitioned (ingested_at, request_id);

create index ix_p0_llm_invocation_logs_partitioned_tenant_created
  on p0_llm_invocation_logs_partitioned (tenant_id, created_at);

do $$
declare
  first_month date;
  final_month date;
  month_start date;
  next_month date;
  partition_name text;
begin
  select coalesce(
    date_trunc('month', min(created_at) at time zone 'UTC')::date,
    date_trunc('month', now() at time zone 'UTC')::date
  )
    into first_month
  from p0_llm_invocation_logs;

  select greatest(
    coalesce(
      date_trunc('month', max(created_at) at time zone 'UTC')::date,
      date_trunc('month', now() at time zone 'UTC')::date
    ),
    (date_trunc('month', now() at time zone 'UTC') + interval '1 month')::date
  )
    into final_month
  from p0_llm_invocation_logs;

  month_start := first_month;
  while month_start <= final_month loop
    next_month := (month_start + interval '1 month')::date;
    partition_name := 'p0_llm_invocation_logs_y' || to_char(month_start, 'YYYYMM');

    execute format(
      'create table %I partition of p0_llm_invocation_logs_partitioned for values from (%L) to (%L)',
      partition_name,
      month_start::text || ' 00:00:00+00',
      next_month::text || ' 00:00:00+00'
    );

    month_start := next_month;
  end loop;

  create table p0_llm_invocation_logs_default
    partition of p0_llm_invocation_logs_partitioned default;
end
$$;

create or replace function mirror_p0_llm_invocation_log_to_partitioned()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from p0_llm_invocation_logs_partitioned
    where request_id = old.request_id
      and created_at = old.created_at;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    insert into p0_llm_invocation_logs_partitioned
    select new.*
    on conflict do nothing;
    return new;
  end if;

  return old;
end
$$;

create trigger trg_mirror_p0_llm_invocation_logs_to_partitioned
  after insert or update or delete on p0_llm_invocation_logs
  for each row
  execute function mirror_p0_llm_invocation_log_to_partitioned();

insert into p0_llm_invocation_logs_partitioned
select *
from p0_llm_invocation_logs
on conflict do nothing;

analyze p0_llm_invocation_logs_partitioned;

do $$
declare
  source_count bigint;
  target_count bigint;
begin
  select count(*) into source_count from p0_llm_invocation_logs;
  select count(*) into target_count from p0_llm_invocation_logs_partitioned;

  if source_count <> target_count then
    raise exception 'shadow row-count mismatch: source %, target %', source_count, target_count;
  end if;

  if exists (
    select 1
    from p0_llm_invocation_logs legacy_log
    full join p0_llm_invocation_logs_partitioned partitioned_log
      on partitioned_log.request_id = legacy_log.request_id
    where legacy_log.request_id is null
       or partitioned_log.request_id is null
       or to_jsonb(legacy_log) is distinct from to_jsonb(partitioned_log)
  ) then
    raise exception 'shadow full-row parity check failed';
  end if;
end
$$;

create or replace function claim_p0_llm_invocation_log_key()
returns trigger
language plpgsql
as $$
declare
  claimed_request_id text;
begin
  insert into p0_llm_invocation_log_keys (
    request_id,
    log_id,
    created_at
  ) values (
    new.request_id,
    new.id,
    new.created_at
  )
  on conflict (request_id) do nothing
  returning request_id into claimed_request_id;

  if claimed_request_id is null then
    return null;
  end if;

  return new;
end
$$;

begin;
set local lock_timeout = '15s';
lock table p0_llm_invocation_logs in access exclusive mode;

insert into p0_llm_invocation_logs_partitioned
select *
from p0_llm_invocation_logs
on conflict do nothing;

do $$
declare
  source_count bigint;
  target_count bigint;
begin
  select count(*) into source_count from p0_llm_invocation_logs;
  select count(*) into target_count from p0_llm_invocation_logs_partitioned;

  if source_count <> target_count then
    raise exception 'final row-count mismatch: source %, target %', source_count, target_count;
  end if;

  if exists (
    select 1
    from p0_llm_invocation_logs legacy_log
    full join p0_llm_invocation_logs_partitioned partitioned_log
      on partitioned_log.request_id = legacy_log.request_id
    where legacy_log.request_id is null
       or partitioned_log.request_id is null
  ) then
    raise exception 'final request identity parity check failed';
  end if;

  if exists (
    select 1
    from p0_llm_invocation_logs logs
    left join p0_llm_invocation_log_keys keys
      on keys.request_id = logs.request_id
     and keys.log_id = logs.id
     and keys.created_at = logs.created_at
    where keys.request_id is null
  ) then
    raise exception 'final key registry parity check failed';
  end if;
end
$$;

drop trigger trg_mirror_p0_llm_invocation_logs_to_partitioned
  on p0_llm_invocation_logs;
drop trigger trg_capture_p0_llm_invocation_log_key
  on p0_llm_invocation_logs;

alter table p0_llm_invocation_logs
  rename constraint p0_llm_invocation_logs_pkey
  to p0_llm_invocation_logs_legacy_pkey;

alter index ux_p0_llm_invocation_logs_request_id
  rename to ux_p0_llm_invocation_logs_legacy_request_id;
alter index ix_p0_llm_invocation_logs_project_created
  rename to ix_p0_llm_invocation_logs_legacy_project_created;
alter index ix_p0_llm_invocation_logs_status_created
  rename to ix_p0_llm_invocation_logs_legacy_status_created;

do $$
begin
  if to_regclass('public.ix_p0_llm_invocation_logs_employee_usage') is not null then
    alter index ix_p0_llm_invocation_logs_employee_usage
      rename to ix_p0_llm_invocation_logs_legacy_employee_usage;
  end if;

  if to_regclass('public.ix_p0_llm_invocation_logs_ingested_request') is not null then
    alter index ix_p0_llm_invocation_logs_ingested_request
      rename to ix_p0_llm_invocation_logs_legacy_ingested_request;
  end if;

  if to_regclass('public.ix_p0_llm_invocation_logs_tenant_created') is not null then
    alter index ix_p0_llm_invocation_logs_tenant_created
      rename to ix_p0_llm_invocation_logs_legacy_tenant_created;
  end if;
end
$$;

alter table p0_llm_invocation_logs
  rename to p0_llm_invocation_logs_legacy_unpartitioned;
alter table p0_llm_invocation_logs_partitioned
  rename to p0_llm_invocation_logs;

alter table p0_llm_invocation_logs
  rename constraint p0_llm_invocation_logs_partitioned_pkey
  to p0_llm_invocation_logs_pkey;
alter table p0_llm_invocation_logs
  rename constraint ck_p0_llm_invocation_logs_partitioned_ttft_non_negative
  to ck_p0_llm_invocation_logs_ttft_non_negative;

do $$
declare
  partitioned_constraint record;
  original_name text;
begin
  for partitioned_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.p0_llm_invocation_logs'::regclass
      and contype = 'f'
      and conname like 'partitioned\_%' escape '\'
    order by conname
  loop
    original_name := substr(
      partitioned_constraint.conname,
      length('partitioned_') + 1
    );
    execute format(
      'alter table p0_llm_invocation_logs rename constraint %I to %I',
      partitioned_constraint.conname,
      original_name
    );
  end loop;
end
$$;

alter index ux_p0_llm_invocation_logs_partitioned_request_created
  rename to ux_p0_llm_invocation_logs_request_id;
alter index ix_p0_llm_invocation_logs_partitioned_project_created
  rename to ix_p0_llm_invocation_logs_project_created;
alter index ix_p0_llm_invocation_logs_partitioned_status_created
  rename to ix_p0_llm_invocation_logs_status_created;
alter index ix_p0_llm_invocation_logs_partitioned_employee_usage
  rename to ix_p0_llm_invocation_logs_employee_usage;
alter index ix_p0_llm_invocation_logs_partitioned_ingested_request
  rename to ix_p0_llm_invocation_logs_ingested_request;
alter index ix_p0_llm_invocation_logs_partitioned_tenant_created
  rename to ix_p0_llm_invocation_logs_tenant_created;

create trigger trg_claim_p0_llm_invocation_log_key
  before insert on p0_llm_invocation_logs
  for each row
  execute function claim_p0_llm_invocation_log_key();

commit;

drop function mirror_p0_llm_invocation_log_to_partitioned();

create or replace function ensure_p0_llm_invocation_log_month(target_month date)
returns text
language plpgsql
as $$
declare
  month_start date := date_trunc('month', target_month)::date;
  next_month date := (date_trunc('month', target_month) + interval '1 month')::date;
  partition_name text := 'p0_llm_invocation_logs_y' || to_char(month_start, 'YYYYMM');
begin
  perform pg_advisory_xact_lock(
    hashtextextended('gatelm:p0-invocation-log-partition:' || month_start::text, 0)
  );

  if to_regclass('public.' || partition_name) is not null then
    return partition_name;
  end if;

  if exists (
    select 1
    from p0_llm_invocation_logs_default
    where created_at >= (month_start::text || ' 00:00:00+00')::timestamptz
      and created_at < (next_month::text || ' 00:00:00+00')::timestamptz
  ) then
    raise exception 'default partition contains rows for %, controlled recovery is required', month_start;
  end if;

  execute format(
    'create table %I partition of p0_llm_invocation_logs for values from (%L) to (%L)',
    partition_name,
    month_start::text || ' 00:00:00+00',
    next_month::text || ' 00:00:00+00'
  );

  return partition_name;
end
$$;

select ensure_p0_llm_invocation_log_month(
  (date_trunc('month', now() at time zone 'UTC') + interval '2 months')::date
);

analyze p0_llm_invocation_logs;

do $$
begin
  if not exists (
    select 1
    from pg_partitioned_table
    where partrelid = 'public.p0_llm_invocation_logs'::regclass
  ) then
    raise exception 'partitioned parent verification failed';
  end if;

  if exists (
    select 1
    from p0_llm_invocation_logs logs
    left join p0_llm_invocation_log_keys keys
      on keys.request_id = logs.request_id
     and keys.log_id = logs.id
     and keys.created_at = logs.created_at
    where keys.request_id is null
  ) then
    raise exception 'post-cutover key registry parity check failed';
  end if;
end
$$;

select pg_advisory_unlock(hashtextextended('gatelm:p0-invocation-log-monthly-cutover', 0));
