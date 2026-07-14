package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type dashboardRollupCoverage struct {
	ExpectedBuckets  int64
	ReadyBuckets     int64
	DirtyBuckets     int64
	LastSourceAt     *time.Time
	LastAggregatedAt *time.Time
}

func (coverage dashboardRollupCoverage) Complete() bool {
	return coverage.ExpectedBuckets > 0 &&
		coverage.ReadyBuckets == coverage.ExpectedBuckets &&
		coverage.DirtyBuckets == 0
}

func (r *QueryReader) getDashboardRollupCoverage(
	ctx context.Context,
	filter invocationlog.DashboardOverviewFilter,
	segment dashboardRollupSegment,
) (dashboardRollupCoverage, error) {
	query, args := buildDashboardRollupCoverageQuery(filter, segment)
	var coverage dashboardRollupCoverage
	var lastSourceAt sql.NullTime
	var lastAggregatedAt sql.NullTime
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&coverage.ExpectedBuckets,
		&coverage.ReadyBuckets,
		&coverage.DirtyBuckets,
		&lastSourceAt,
		&lastAggregatedAt,
	); err != nil {
		return dashboardRollupCoverage{}, err
	}
	if lastSourceAt.Valid {
		value := lastSourceAt.Time.UTC()
		coverage.LastSourceAt = &value
	}
	if lastAggregatedAt.Valid {
		value := lastAggregatedAt.Time.UTC()
		coverage.LastAggregatedAt = &value
	}
	return coverage, nil
}

func buildDashboardRollupCoverageQuery(
	filter invocationlog.DashboardOverviewFilter,
	segment dashboardRollupSegment,
) (string, []any) {
	step := dashboardRollupInterval(segment.Grain)
	query := fmt.Sprintf(`
with source_cursor as (
  select caught_up_through
  from dashboard_rollup_source_cursors
  where source = 'project_application'
), unprocessed_source as (
  select exists (
    select 1
    from p0_llm_invocation_logs source
    cross join source_cursor
    where source.tenant_id = $1::uuid
      and source.created_at >= $3
      and source.created_at < $4
      and source.ingested_at > source_cursor.caught_up_through
  ) as has_unprocessed
), expected as (
  select generate_series($3::timestamptz, $4::timestamptz - '%s'::interval, '%s'::interval) as bucket_start
), covered as (
  select
    expected.bucket_start,
    state.state,
    state.source_max_at,
    state.aggregated_at,
    state.histogram_version
  from expected
  left join dashboard_rollup_bucket_states state
    on state.tenant_id = $1::uuid
   and state.surface = 'project_application'
   and state.grain = $2
   and state.bucket_start = expected.bucket_start
), dirty as (
  select count(*)::bigint as dirty_count
  from dashboard_rollup_dirty_buckets
  where tenant_id = $1::uuid
    and surface = 'project_application'
    and (
      grain = $2
      or ($2 = 'day' and grain = 'hour')
      or ($2 = 'month' and grain in ('hour', 'day'))
    )
    and bucket_start >= $3
    and bucket_start < $4
)
select
  count(*)::bigint as expected_buckets,
  count(*) filter (
    where (select caught_up_through from source_cursor) is not null
      and not (select has_unprocessed from unprocessed_source)
      and (
        (
          covered.state = 'ready'
          and covered.histogram_version = %d
        ) or (
          covered.state is null
          and not exists (
            select 1
            from p0_llm_invocation_logs raw_source
            where raw_source.tenant_id = $1::uuid
              and raw_source.created_at >= covered.bucket_start
              and raw_source.created_at < covered.bucket_start + '%s'::interval
          )
        )
    )
  )::bigint as ready_buckets,
  dirty.dirty_count,
  max(covered.source_max_at) as last_source_at,
  max(covered.aggregated_at) as last_aggregated_at
from covered
cross join dirty
group by dirty.dirty_count`, step, step, dashboardHistogramVersion, step)
	return query, []any{
		filter.TenantID,
		segment.Grain,
		segment.From.UTC(),
		segment.To.UTC(),
	}
}

func dashboardRollupInterval(grain string) string {
	switch grain {
	case "month":
		return "1 month"
	case "day":
		return "1 day"
	default:
		return "1 hour"
	}
}
