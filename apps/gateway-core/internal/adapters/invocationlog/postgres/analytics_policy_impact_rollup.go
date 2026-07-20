package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type analyticsPolicyImpactRollupCoverage struct {
	CaughtUpThrough   *time.Time
	LastAggregatedAt  *time.Time
	DirtyMinuteBucket int64
}

func (r *QueryReader) getAnalyticsPolicyImpactFromRollup(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (invocationlog.AnalyticsPolicyImpactFields, error) {
	coverage, err := r.queryAnalyticsPolicyImpactRollupCoverage(ctx, filter)
	if err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}

	rollupStart := ceilUTCMinute(filter.From)
	rollupEnd := floorUTCMinute(filter.To)
	if coverage.CaughtUpThrough != nil {
		caughtUp := floorUTCMinute(*coverage.CaughtUpThrough)
		if caughtUp.Before(rollupEnd) {
			rollupEnd = caughtUp
		}
	} else {
		rollupEnd = rollupStart
	}
	if rollupEnd.Before(rollupStart) {
		rollupEnd = rollupStart
	}

	snapshots := make([]analyticsPolicyImpactSnapshot, 0, 3)
	rollupUsed := rollupStart.Before(rollupEnd)
	if rollupUsed {
		rollupFilter := filter
		rollupFilter.From = rollupStart
		rollupFilter.To = rollupEnd
		snapshot, queryErr := r.queryAnalyticsPolicyImpactRollupSnapshot(
			ctx,
			rollupFilter,
		)
		if queryErr != nil {
			return invocationlog.AnalyticsPolicyImpactFields{}, queryErr
		}
		snapshots = append(snapshots, snapshot)

		if filter.From.Before(rollupStart) {
			edgeFilter := filter
			edgeFilter.To = minimumTime(rollupStart, filter.To)
			if edgeFilter.From.Before(edgeFilter.To) {
				edge, queryErr := r.queryAnalyticsPolicyImpactSnapshot(ctx, edgeFilter)
				if queryErr != nil {
					return invocationlog.AnalyticsPolicyImpactFields{}, queryErr
				}
				snapshots = append(snapshots, edge)
			}
		}
	}

	tailStart := rollupEnd
	maxTailStart := filter.To.Add(-r.analyticsPolicyImpactMaxRawTail)
	if tailStart.Before(maxTailStart) {
		tailStart = maxTailStart
	}
	if tailStart.Before(filter.From) {
		tailStart = filter.From
	}
	if tailStart.Before(filter.To) {
		tailFilter := filter
		tailFilter.From = tailStart
		tail, queryErr := r.queryAnalyticsPolicyImpactSnapshot(ctx, tailFilter)
		if queryErr != nil {
			return invocationlog.AnalyticsPolicyImpactFields{}, queryErr
		}
		snapshots = append(snapshots, tail)
	}

	merged := mergeAnalyticsPolicyImpactSnapshots(snapshots...)
	config := policyImpactBucketConfig(filter)
	totals, metricCoverage, lastEventAt := aggregatePolicyImpactSurfaceTotals(
		merged.SurfaceTotals,
	)
	generatedAt := time.Now().UTC()
	lastAggregatedAt := generatedAt
	if coverage.LastAggregatedAt != nil {
		lastAggregatedAt = coverage.LastAggregatedAt.UTC()
	}

	coveredContinuously := false
	if rollupUsed {
		coveredContinuously = !tailStart.After(rollupEnd)
	} else {
		coveredContinuously = !tailStart.After(filter.From)
	}
	isStale := coverage.DirtyMinuteBucket > 0 || !coveredContinuously
	source := "postgresql_policy_impact_bounded_raw"
	if rollupUsed {
		source = "postgresql_policy_impact_rollup_hybrid"
	}
	if isStale {
		source = "postgresql_policy_impact_rollup_partial"
	}

	return invocationlog.AnalyticsPolicyImpactFields{
		Period:              filter.Period,
		BucketInterval:      config.IntervalLabel,
		ExpectedBucketCount: config.ExpectedBucketCount,
		Totals:              totals,
		SurfaceTotals:       merged.SurfaceTotals,
		PolicyOutcomes:      merged.PolicyOutcomes,
		RoutingRoles:        merged.RoutingRoles,
		ModelBuckets:        merged.ModelBuckets,
		UsageSources:        merged.UsageSources,
		MetricCoverage:      metricCoverage,
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           source,
			RecordCount:      totals.RequestCount,
			LastLogCreatedAt: lastEventAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: lastAggregatedAt,
			IsStale:          isStale,
		},
	}, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactRollupCoverage(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (analyticsPolicyImpactRollupCoverage, error) {
	requiredSources := "('project_application'), ('tenant_chat')"
	if filter.ProjectID != "" {
		requiredSources = "('project_application')"
	}
	query := fmt.Sprintf(`
with required(source) as (values %s),
cursor_coverage as (
  select min(cursor.caught_up_through) as caught_up_through,
         count(cursor.source)::bigint as cursor_count
  from required
  left join dashboard_rollup_source_cursors cursor
    on cursor.source = required.source
), dirty as (
  select count(*)::bigint as dirty_count
  from dashboard_rollup_dirty_buckets
  where tenant_id = $3::uuid
    and grain = 'minute'
    and bucket_start >= date_trunc('minute', $1::timestamptz)
    and bucket_start < date_trunc('minute', $2::timestamptz)
    and surface in (select source from required)
), aggregated as (
  select max(aggregated_at) as last_aggregated_at
  from dashboard_rollup_bucket_states
  where tenant_id = $3::uuid
    and grain = 'minute'
    and state = 'ready'
    and bucket_start >= date_trunc('minute', $1::timestamptz)
    and bucket_start < date_trunc('minute', $2::timestamptz)
    and surface in (select source from required)
)
select case when cursor_coverage.cursor_count = (select count(*) from required)
            then cursor_coverage.caught_up_through else null end,
       dirty.dirty_count,
       aggregated.last_aggregated_at
from cursor_coverage cross join dirty cross join aggregated`, requiredSources)

	var caughtUpThrough sql.NullTime
	var lastAggregatedAt sql.NullTime
	var dirtyCount int64
	if err := r.db.QueryRow(
		ctx,
		query,
		filter.From.UTC(),
		filter.To.UTC(),
		filter.TenantID,
	).Scan(&caughtUpThrough, &dirtyCount, &lastAggregatedAt); err != nil {
		return analyticsPolicyImpactRollupCoverage{}, err
	}

	coverage := analyticsPolicyImpactRollupCoverage{DirtyMinuteBucket: dirtyCount}
	if caughtUpThrough.Valid {
		value := caughtUpThrough.Time.UTC()
		coverage.CaughtUpThrough = &value
	}
	if lastAggregatedAt.Valid {
		value := lastAggregatedAt.Time.UTC()
		coverage.LastAggregatedAt = &value
	}
	return coverage, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactRollupSnapshot(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (analyticsPolicyImpactSnapshot, error) {
	query, args := buildAnalyticsPolicyImpactRollupSnapshotQuery(filter)
	var surfaceTotalsJSON []byte
	var policyOutcomesJSON []byte
	var routingRolesJSON []byte
	var modelBucketsJSON []byte
	var usageSourcesJSON []byte
	if err := r.db.QueryRow(ctx, query, args...).Scan(
		&surfaceTotalsJSON,
		&policyOutcomesJSON,
		&routingRolesJSON,
		&modelBucketsJSON,
		&usageSourcesJSON,
	); err != nil {
		return analyticsPolicyImpactSnapshot{}, err
	}

	snapshot := analyticsPolicyImpactSnapshot{}
	for _, item := range []struct {
		payload []byte
		target  any
		label   string
	}{
		{surfaceTotalsJSON, &snapshot.SurfaceTotals, "surface totals"},
		{policyOutcomesJSON, &snapshot.PolicyOutcomes, "policy outcomes"},
		{routingRolesJSON, &snapshot.RoutingRoles, "routing roles"},
		{modelBucketsJSON, &snapshot.ModelBuckets, "model buckets"},
		{usageSourcesJSON, &snapshot.UsageSources, "usage sources"},
	} {
		if err := json.Unmarshal(item.payload, item.target); err != nil {
			return analyticsPolicyImpactSnapshot{}, fmt.Errorf(
				"decode analytics policy impact rollup %s: %w",
				item.label,
				err,
			)
		}
	}

	for index := range snapshot.SurfaceTotals {
		item := &snapshot.SurfaceTotals[index]
		if item.SavedCostUnknownRequests == 0 {
			value := item.KnownSavedCostMicroUSD
			item.SavedCostMicroUSD = &value
		}
		if item.LastEventAt != nil {
			value := item.LastEventAt.UTC()
			item.LastEventAt = &value
		}
	}
	for index := range snapshot.ModelBuckets {
		item := &snapshot.ModelBuckets[index]
		item.PeriodStart = item.PeriodStart.UTC()
		item.PeriodEnd = costReportBucketEnd(item.PeriodStart, filter.Period)
	}
	return snapshot, nil
}

func buildAnalyticsPolicyImpactRollupSnapshotQuery(
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (string, []any) {
	args := []any{filter.From.UTC(), filter.To.UTC(), filter.TenantID}
	projectPredicate := ""
	surfacePredicate := ""
	if filter.ProjectID != "" {
		args = append(args, filter.ProjectID)
		projectPredicate = fmt.Sprintf("and project_id = $%d::text", len(args))
		surfacePredicate = "and surface = 'project_application'"
	}
	bucketExpression := costReportBucketExpression(invocationlog.CostReportFilter{
		Period: filter.Period,
		From:   filter.From,
		To:     filter.To,
	})
	bucketExpression = strings.ReplaceAll(bucketExpression, "created_at", "bucket_start")

	query := fmt.Sprintf(`
with totals as materialized (
  select surface, project_id, bucket_start,
    request_count, cost_micro_usd, saved_cost_micro_usd,
    saved_cost_known_request_count, saved_cost_unknown_request_count,
    avoided_provider_call_request_count, protected_request_count,
    high_performance_request_count, high_performance_eligible_request_count,
    masking_known_request_count, masking_unknown_request_count,
    routing_known_request_count, routing_unknown_request_count,
    model_known_request_count, model_unknown_request_count,
    event_max_at
  from dashboard_rollup_totals
  where tenant_id = $3::uuid and grain = 'minute'
    and bucket_start >= $1::timestamptz and bucket_start < $2::timestamptz
    %s %s
), surface_totals as (
  select surface,
    sum(request_count)::bigint as request_count,
    sum(cost_micro_usd)::bigint as cost_micro_usd,
    sum(saved_cost_micro_usd)::bigint as known_saved_cost_micro_usd,
    sum(saved_cost_known_request_count)::bigint as saved_cost_known_requests,
    sum(saved_cost_unknown_request_count)::bigint as saved_cost_unknown_requests,
    sum(avoided_provider_call_request_count)::bigint as avoided_provider_call_requests,
    sum(protected_request_count)::bigint as protected_requests,
    sum(high_performance_request_count)::bigint as high_performance_requests,
    sum(high_performance_eligible_request_count)::bigint as high_performance_eligible_requests,
    sum(masking_known_request_count)::bigint as masking_known_requests,
    sum(masking_unknown_request_count)::bigint as masking_unknown_requests,
    sum(routing_known_request_count)::bigint as routing_known_requests,
    sum(routing_unknown_request_count)::bigint as routing_unknown_requests,
    sum(model_known_request_count)::bigint as model_known_requests,
    sum(model_unknown_request_count)::bigint as model_unknown_requests,
    max(event_max_at) as last_event_at
  from totals group by surface
), dimensions as materialized (
  select surface, project_id, bucket_start, dimension_type,
    dimension_value, dimension_value_2, request_count
  from dashboard_rollup_dimensions
  where tenant_id = $3::uuid and grain = 'minute'
    and bucket_start >= $1::timestamptz and bucket_start < $2::timestamptz
    and dimension_type in ('policy_outcome', 'routing', 'policy_model')
    %s %s
), policy_outcomes as (
  select surface, dimension_value as outcome,
    sum(request_count)::bigint as request_count
  from dimensions where dimension_type = 'policy_outcome'
  group by surface, dimension_value
), routing_roles as (
  select surface, 'difficulty'::text as routing_scheme,
    dimension_value_2 as routing_role,
    sum(request_count)::bigint as request_count
  from dimensions
  where dimension_type = 'routing' and dimension_value_2 in ('simple', 'complex')
  group by surface, dimension_value_2
), model_minutes as (
  select surface, %s as period_start,
    dimension_value as provider_key, dimension_value_2 as model_key,
    sum(request_count)::bigint as request_count
  from dimensions where dimension_type = 'policy_model'
  group by surface, period_start, dimension_value, dimension_value_2
), top_models as (
  select surface, provider_key, model_key, sum(request_count)::bigint as request_count
  from model_minutes group by surface, provider_key, model_key
  order by request_count desc, surface, provider_key, model_key limit 50
), model_buckets as (
  select model_minutes.surface, model_minutes.period_start,
    model_minutes.provider_key, model_minutes.model_key,
    sum(model_minutes.request_count)::bigint as request_count
  from model_minutes join top_models using (surface, provider_key, model_key)
  group by model_minutes.surface, model_minutes.period_start,
    model_minutes.provider_key, model_minutes.model_key
), usage_sources as (
  select surface, project_id, sum(request_count)::bigint as request_count,
    sum(cost_micro_usd)::bigint as cost_micro_usd
  from totals group by surface, project_id
)
select
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface, 'RequestCount', request_count,
    'CostMicroUSD', cost_micro_usd,
    'KnownSavedCostMicroUSD', known_saved_cost_micro_usd,
    'AvoidedProviderCallRequests', avoided_provider_call_requests,
    'ProtectedRequests', protected_requests,
    'HighPerformanceRequests', high_performance_requests,
    'HighPerformanceEligibleRequests', high_performance_eligible_requests,
    'SavedCostKnownRequests', saved_cost_known_requests,
    'SavedCostUnknownRequests', saved_cost_unknown_requests,
    'MaskingKnownRequests', masking_known_requests,
    'MaskingUnknownRequests', masking_unknown_requests,
    'RoutingKnownRequests', routing_known_requests,
    'RoutingUnknownRequests', routing_unknown_requests,
    'ModelKnownRequests', model_known_requests,
    'ModelUnknownRequests', model_unknown_requests,
    'LastEventAt', last_event_at
  ) order by surface) from surface_totals), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface, 'Outcome', outcome, 'RequestCount', request_count
  ) order by request_count desc, surface, outcome) from policy_outcomes), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface, 'Scheme', routing_scheme, 'Role', routing_role,
    'RequestCount', request_count
  ) order by surface, routing_scheme, routing_role) from routing_roles), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface, 'PeriodStart', period_start, 'Provider', provider_key,
    'Model', model_key, 'RequestCount', request_count
  ) order by period_start, surface, provider_key, model_key) from model_buckets), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface, 'ProjectID', project_id, 'RequestCount', request_count,
    'CostMicroUSD', cost_micro_usd
  ) order by request_count desc, surface, project_id) from usage_sources), '[]'::jsonb)
`, surfacePredicate, projectPredicate, surfacePredicate, projectPredicate, bucketExpression)
	return query, args
}

func mergeAnalyticsPolicyImpactSnapshots(
	snapshots ...analyticsPolicyImpactSnapshot,
) analyticsPolicyImpactSnapshot {
	result := analyticsPolicyImpactSnapshot{}
	surfaces := map[string]invocationlog.AnalyticsPolicyImpactSurfaceTotal{}
	outcomes := map[string]invocationlog.AnalyticsPolicyImpactOutcome{}
	routing := map[string]invocationlog.AnalyticsPolicyImpactRoutingRole{}
	models := map[string]invocationlog.AnalyticsPolicyImpactModelBucket{}
	usage := map[string]invocationlog.AnalyticsPolicyImpactUsageSource{}

	for _, snapshot := range snapshots {
		for _, item := range snapshot.SurfaceTotals {
			current := surfaces[item.Surface]
			current.Surface = item.Surface
			current.RequestCount += item.RequestCount
			current.CostMicroUSD += item.CostMicroUSD
			current.KnownSavedCostMicroUSD += item.KnownSavedCostMicroUSD
			current.AvoidedProviderCallRequests += item.AvoidedProviderCallRequests
			current.ProtectedRequests += item.ProtectedRequests
			current.HighPerformanceRequests += item.HighPerformanceRequests
			current.HighPerformanceEligibleRequests += item.HighPerformanceEligibleRequests
			current.SavedCostKnownRequests += item.SavedCostKnownRequests
			current.SavedCostUnknownRequests += item.SavedCostUnknownRequests
			current.MaskingKnownRequests += item.MaskingKnownRequests
			current.MaskingUnknownRequests += item.MaskingUnknownRequests
			current.RoutingKnownRequests += item.RoutingKnownRequests
			current.RoutingUnknownRequests += item.RoutingUnknownRequests
			current.ModelKnownRequests += item.ModelKnownRequests
			current.ModelUnknownRequests += item.ModelUnknownRequests
			if item.LastEventAt != nil &&
				(current.LastEventAt == nil || item.LastEventAt.After(*current.LastEventAt)) {
				value := item.LastEventAt.UTC()
				current.LastEventAt = &value
			}
			surfaces[item.Surface] = current
		}
		for _, item := range snapshot.PolicyOutcomes {
			key := item.Surface + "\x00" + item.Outcome
			current := outcomes[key]
			current.Surface, current.Outcome = item.Surface, item.Outcome
			current.RequestCount += item.RequestCount
			outcomes[key] = current
		}
		for _, item := range snapshot.RoutingRoles {
			key := item.Surface + "\x00" + item.Scheme + "\x00" + item.Role
			current := routing[key]
			current.Surface, current.Scheme, current.Role = item.Surface, item.Scheme, item.Role
			current.RequestCount += item.RequestCount
			routing[key] = current
		}
		for _, item := range snapshot.ModelBuckets {
			key := strings.Join([]string{
				item.Surface,
				item.PeriodStart.UTC().Format(time.RFC3339Nano),
				item.Provider,
				item.Model,
			}, "\x00")
			current := models[key]
			current.Surface = item.Surface
			current.PeriodStart = item.PeriodStart.UTC()
			current.PeriodEnd = item.PeriodEnd.UTC()
			current.Provider, current.Model = item.Provider, item.Model
			current.RequestCount += item.RequestCount
			models[key] = current
		}
		for _, item := range snapshot.UsageSources {
			key := item.Surface + "\x00" + item.ProjectID
			current := usage[key]
			current.Surface, current.ProjectID = item.Surface, item.ProjectID
			current.RequestCount += item.RequestCount
			current.CostMicroUSD += item.CostMicroUSD
			usage[key] = current
		}
	}

	for _, item := range surfaces {
		if item.SavedCostUnknownRequests == 0 {
			value := item.KnownSavedCostMicroUSD
			item.SavedCostMicroUSD = &value
		}
		result.SurfaceTotals = append(result.SurfaceTotals, item)
	}
	for _, item := range outcomes {
		result.PolicyOutcomes = append(result.PolicyOutcomes, item)
	}
	for _, item := range routing {
		result.RoutingRoles = append(result.RoutingRoles, item)
	}
	for _, item := range models {
		result.ModelBuckets = append(result.ModelBuckets, item)
	}
	for _, item := range usage {
		result.UsageSources = append(result.UsageSources, item)
	}

	sort.Slice(result.SurfaceTotals, func(i, j int) bool {
		return result.SurfaceTotals[i].Surface < result.SurfaceTotals[j].Surface
	})
	sort.Slice(result.PolicyOutcomes, func(i, j int) bool {
		if result.PolicyOutcomes[i].RequestCount != result.PolicyOutcomes[j].RequestCount {
			return result.PolicyOutcomes[i].RequestCount > result.PolicyOutcomes[j].RequestCount
		}
		return result.PolicyOutcomes[i].Surface+result.PolicyOutcomes[i].Outcome <
			result.PolicyOutcomes[j].Surface+result.PolicyOutcomes[j].Outcome
	})
	sort.Slice(result.RoutingRoles, func(i, j int) bool {
		return result.RoutingRoles[i].Surface+result.RoutingRoles[i].Scheme+result.RoutingRoles[i].Role <
			result.RoutingRoles[j].Surface+result.RoutingRoles[j].Scheme+result.RoutingRoles[j].Role
	})
	sort.Slice(result.ModelBuckets, func(i, j int) bool {
		if !result.ModelBuckets[i].PeriodStart.Equal(result.ModelBuckets[j].PeriodStart) {
			return result.ModelBuckets[i].PeriodStart.Before(result.ModelBuckets[j].PeriodStart)
		}
		return result.ModelBuckets[i].Surface+result.ModelBuckets[i].Provider+result.ModelBuckets[i].Model <
			result.ModelBuckets[j].Surface+result.ModelBuckets[j].Provider+result.ModelBuckets[j].Model
	})
	sort.Slice(result.UsageSources, func(i, j int) bool {
		if result.UsageSources[i].RequestCount != result.UsageSources[j].RequestCount {
			return result.UsageSources[i].RequestCount > result.UsageSources[j].RequestCount
		}
		return result.UsageSources[i].Surface+result.UsageSources[i].ProjectID <
			result.UsageSources[j].Surface+result.UsageSources[j].ProjectID
	})
	return result
}

func floorUTCMinute(value time.Time) time.Time {
	return value.UTC().Truncate(time.Minute)
}

func ceilUTCMinute(value time.Time) time.Time {
	floor := floorUTCMinute(value)
	if floor.Equal(value.UTC()) {
		return floor
	}
	return floor.Add(time.Minute)
}

func minimumTime(left time.Time, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}
