\set ON_ERROR_STOP on

-- Queue exactly one closed UTC hour for parent rebuilding after the writer has
-- switched to DASHBOARD_ROLLUP_BUILD_MODE=minute. This deliberately includes
-- existing legacy hour rows even when that hour has no raw/minute source rows,
-- so clearBucket() can remove stale parent data before day/month are rebuilt.
\if :{?parent_rebuild_approved}
\else
  \echo 'parent_rebuild_approved is required'
  \quit 3
\endif

\if :parent_rebuild_approved
\else
  \echo 'parent_rebuild_approved must be true'
  \quit 3
\endif

\if :{?minute_mode_confirmed}
\else
  \echo 'minute_mode_confirmed is required'
  \quit 3
\endif

\if :minute_mode_confirmed
\else
  \echo 'minute_mode_confirmed must be true'
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
  :'from_utc'::timestamptz = date_trunc('hour', :'from_utc'::timestamptz)
  and :'to_utc'::timestamptz = :'from_utc'::timestamptz + interval '1 hour'
  and :'to_utc'::timestamptz <= date_trunc('hour', now())
)::text as valid_parent_range
\gset

\if :valid_parent_range
\else
  \echo 'range must be exactly one closed UTC hour aligned to hour boundaries'
  \quit 3
\endif

begin;
set local statement_timeout = '30s';
set local lock_timeout = '2s';

with parent_sources as materialized (
  select tenant_id, surface, date_trunc('hour', bucket_start) as bucket_start
  from dashboard_rollup_bucket_states
  where grain in ('minute', 'hour')
    and bucket_start >= :'from_utc'::timestamptz
    and bucket_start < :'to_utc'::timestamptz

  union

  select tenant_id, surface, date_trunc('hour', bucket_start) as bucket_start
  from dashboard_rollup_totals
  where grain in ('minute', 'hour')
    and bucket_start >= :'from_utc'::timestamptz
    and bucket_start < :'to_utc'::timestamptz

  union

  select tenant_id, 'project_application'::text, date_trunc('hour', created_at)
  from p0_llm_invocation_logs
  where created_at >= :'from_utc'::timestamptz
    and created_at < :'to_utc'::timestamptz

  union

  select tenant_id, 'tenant_chat'::text, date_trunc('hour', completed_at)
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
    'hour',
    bucket_start,
    'CHILD_REBUILT',
    now(),
    0,
    now(),
    now()
  from parent_sources
  on conflict (tenant_id, surface, grain, bucket_start)
  do update set
    reason_code = excluded.reason_code,
    available_at = least(dashboard_rollup_dirty_buckets.available_at, now()),
    updated_at = now()
  returning 1
)
select count(*)::bigint as queued_parent_buckets from queued;

commit;
