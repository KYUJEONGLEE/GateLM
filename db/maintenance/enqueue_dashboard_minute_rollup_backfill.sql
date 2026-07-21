\set ON_ERROR_STOP on

-- Queue at most one UTC hour of closed minute buckets. Repeat with adjacent
-- ranges while Control Plane runs in DASHBOARD_ROLLUP_BUILD_MODE=shadow.
\if :{?minute_backfill_approved}
\else
  \echo 'minute_backfill_approved is required'
  \quit 3
\endif

\if :minute_backfill_approved
\else
  \echo 'minute_backfill_approved must be true'
  \quit 3
\endif

\if :{?from_utc}
\else
  \echo 'from_utc is required'
  \quit 3
\endif

\if :{?to_utc}
\else
  \echo 'to_utc is required'
  \quit 3
\endif

select (
  :'from_utc'::timestamptz < :'to_utc'::timestamptz
  and :'to_utc'::timestamptz - :'from_utc'::timestamptz <= interval '1 hour'
  and :'to_utc'::timestamptz <= date_trunc('minute', now())
)::text as valid_backfill_range
\gset

\if :valid_backfill_range
\else
  \echo 'range must be ordered, no longer than one hour, and exclude the open UTC minute'
  \quit 3
\endif

begin;
set local statement_timeout = '30s';
set local lock_timeout = '2s';

with minute_sources as materialized (
  select distinct
    tenant_id,
    'project_application'::text as surface,
    date_trunc('minute', created_at) as bucket_start
  from p0_llm_invocation_logs
  where created_at >= :'from_utc'::timestamptz
    and created_at < :'to_utc'::timestamptz

  union

  select distinct
    tenant_id,
    'tenant_chat'::text as surface,
    date_trunc('minute', completed_at) as bucket_start
  from tenant_chat_invocation_logs
  where completed_at >= :'from_utc'::timestamptz
    and completed_at < :'to_utc'::timestamptz
    and surface = 'tenant_chat'
    and execution_scope_kind = 'tenant_chat'
), queued as (
  insert into dashboard_rollup_dirty_buckets (
    tenant_id,
    surface,
    grain,
    bucket_start,
    reason_code,
    available_at,
    attempts,
    created_at,
    updated_at
  )
  select
    tenant_id,
    surface,
    'minute',
    bucket_start,
    'SOURCE_DISCOVERED',
    now(),
    0,
    now(),
    now()
  from minute_sources
  on conflict (tenant_id, surface, grain, bucket_start)
  do update set
    reason_code = excluded.reason_code,
    available_at = least(dashboard_rollup_dirty_buckets.available_at, now()),
    updated_at = now()
  returning 1
)
select count(*)::bigint as queued_minute_buckets from queued;

commit;
