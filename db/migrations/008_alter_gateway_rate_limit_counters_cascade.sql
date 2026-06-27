-- Add cascade foreign keys with NOT VALID first so existing-row validation is
-- separated from the metadata change. The DO blocks also keep local repeated
-- SQL-file runs safe while the project does not have a shared migration runner.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'gateway_rate_limit_counters'::regclass
      and conname = 'gateway_rate_limit_counters_tenant_id_fkey'
      and confdeltype = 'c'
  ) then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'gateway_rate_limit_counters'::regclass
        and conname = 'gateway_rate_limit_counters_tenant_id_fkey_cascade'
    ) then
      alter table gateway_rate_limit_counters
        drop constraint gateway_rate_limit_counters_tenant_id_fkey_cascade;
    end if;
  elsif not exists (
    select 1
    from pg_constraint
    where conrelid = 'gateway_rate_limit_counters'::regclass
      and conname = 'gateway_rate_limit_counters_tenant_id_fkey_cascade'
  ) then
    alter table gateway_rate_limit_counters
      add constraint gateway_rate_limit_counters_tenant_id_fkey_cascade
      foreign key (tenant_id)
      references tenants(id)
      on delete cascade
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'gateway_rate_limit_counters'::regclass
      and conname = 'gateway_rate_limit_counters_tenant_id_fkey_cascade'
  ) then
    alter table gateway_rate_limit_counters
      validate constraint gateway_rate_limit_counters_tenant_id_fkey_cascade;

    if exists (
      select 1
      from pg_constraint
      where conrelid = 'gateway_rate_limit_counters'::regclass
        and conname = 'gateway_rate_limit_counters_tenant_id_fkey'
    ) then
      alter table gateway_rate_limit_counters
        drop constraint gateway_rate_limit_counters_tenant_id_fkey;
    end if;

    alter table gateway_rate_limit_counters
      rename constraint gateway_rate_limit_counters_tenant_id_fkey_cascade
      to gateway_rate_limit_counters_tenant_id_fkey;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'gateway_rate_limit_counters'::regclass
      and conname = 'gateway_rate_limit_counters_application_id_fkey'
      and confdeltype = 'c'
  ) then
    if exists (
      select 1
      from pg_constraint
      where conrelid = 'gateway_rate_limit_counters'::regclass
        and conname = 'gateway_rate_limit_counters_application_id_fkey_cascade'
    ) then
      alter table gateway_rate_limit_counters
        drop constraint gateway_rate_limit_counters_application_id_fkey_cascade;
    end if;
  elsif not exists (
    select 1
    from pg_constraint
    where conrelid = 'gateway_rate_limit_counters'::regclass
      and conname = 'gateway_rate_limit_counters_application_id_fkey_cascade'
  ) then
    alter table gateway_rate_limit_counters
      add constraint gateway_rate_limit_counters_application_id_fkey_cascade
      foreign key (application_id)
      references applications(id)
      on delete cascade
      not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'gateway_rate_limit_counters'::regclass
      and conname = 'gateway_rate_limit_counters_application_id_fkey_cascade'
  ) then
    alter table gateway_rate_limit_counters
      validate constraint gateway_rate_limit_counters_application_id_fkey_cascade;

    if exists (
      select 1
      from pg_constraint
      where conrelid = 'gateway_rate_limit_counters'::regclass
        and conname = 'gateway_rate_limit_counters_application_id_fkey'
    ) then
      alter table gateway_rate_limit_counters
        drop constraint gateway_rate_limit_counters_application_id_fkey;
    end if;

    alter table gateway_rate_limit_counters
      rename constraint gateway_rate_limit_counters_application_id_fkey_cascade
      to gateway_rate_limit_counters_application_id_fkey;
  end if;
end $$;
