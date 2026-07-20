package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type analyticsPolicyImpactSnapshot struct {
	SurfaceTotals  []invocationlog.AnalyticsPolicyImpactSurfaceTotal
	PolicyOutcomes []invocationlog.AnalyticsPolicyImpactOutcome
	RoutingRoles   []invocationlog.AnalyticsPolicyImpactRoutingRole
	ModelBuckets   []invocationlog.AnalyticsPolicyImpactModelBucket
	UsageSources   []invocationlog.AnalyticsPolicyImpactUsageSource
}

func (r *QueryReader) queryAnalyticsPolicyImpactSnapshot(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (analyticsPolicyImpactSnapshot, error) {
	query, args := buildAnalyticsPolicyImpactSnapshotQuery(filter)
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
	if err := json.Unmarshal(surfaceTotalsJSON, &snapshot.SurfaceTotals); err != nil {
		return analyticsPolicyImpactSnapshot{}, fmt.Errorf("decode analytics policy impact surface totals: %w", err)
	}
	if err := json.Unmarshal(policyOutcomesJSON, &snapshot.PolicyOutcomes); err != nil {
		return analyticsPolicyImpactSnapshot{}, fmt.Errorf("decode analytics policy impact outcomes: %w", err)
	}
	if err := json.Unmarshal(routingRolesJSON, &snapshot.RoutingRoles); err != nil {
		return analyticsPolicyImpactSnapshot{}, fmt.Errorf("decode analytics policy impact routing roles: %w", err)
	}
	if err := json.Unmarshal(modelBucketsJSON, &snapshot.ModelBuckets); err != nil {
		return analyticsPolicyImpactSnapshot{}, fmt.Errorf("decode analytics policy impact model buckets: %w", err)
	}
	if err := json.Unmarshal(usageSourcesJSON, &snapshot.UsageSources); err != nil {
		return analyticsPolicyImpactSnapshot{}, fmt.Errorf("decode analytics policy impact usage sources: %w", err)
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

func buildAnalyticsPolicyImpactSnapshotQuery(
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (string, []any) {
	filteredCTE, args := buildAnalyticsPolicyImpactFilteredCTE(filter)
	bucketExpression := costReportBucketExpression(invocationlog.CostReportFilter{
		Period: filter.Period,
		From:   filter.From,
		To:     filter.To,
	})
	bucketExpression = strings.ReplaceAll(bucketExpression, "created_at", "occurred_at")

	query := fmt.Sprintf(`
/* analytics_policy_impact_single_scan */
%s,
grouped as materialized (
  select
    surface,
    project_id,
    %s as period_start,
    provider_key,
    model_key,
    routing_scheme,
    routing_role,
    count(*)::bigint as request_count,
    coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
    coalesce(sum(saved_cost_micro_usd) filter (where saved_cost_micro_usd is not null), 0)::bigint as known_saved_cost_micro_usd,
    count(*) filter (where saved_cost_micro_usd is not null)::bigint as saved_cost_known_requests,
    count(*) filter (where saved_cost_micro_usd is null)::bigint as saved_cost_unknown_requests,
    count(*) filter (where avoided_provider_call)::bigint as avoided_provider_call_requests,
    count(*) filter (where protected_request)::bigint as protected_requests,
    count(*) filter (where routing_role = 'complex')::bigint as high_performance_requests,
    count(*) filter (where routing_role is not null)::bigint as high_performance_eligible_requests,
    count(*) filter (where masking_action is not null)::bigint as masking_known_requests,
    count(*) filter (where masking_action is null)::bigint as masking_unknown_requests,
    count(*) filter (where routing_role is not null)::bigint as routing_known_requests,
    count(*) filter (where routing_role is null)::bigint as routing_unknown_requests,
    count(*) filter (where model_observation_eligible and provider_key is not null and model_key is not null)::bigint as model_known_requests,
    count(*) filter (where model_observation_eligible and (provider_key is null or model_key is null))::bigint as model_unknown_requests,
    count(*) filter (where is_cache_hit)::bigint as cache_hit_requests,
    count(*) filter (where is_pii_masked)::bigint as pii_masked_requests,
    count(*) filter (where is_safety_blocked)::bigint as safety_blocked_requests,
    count(*) filter (where is_rate_limited)::bigint as rate_limited_requests,
    count(*) filter (where is_fallback_success)::bigint as fallback_success_requests,
    count(*) filter (where is_quota_blocked)::bigint as quota_blocked_requests,
    count(*) filter (where is_budget_blocked)::bigint as budget_blocked_requests,
    count(*) filter (where is_concurrency_limited)::bigint as concurrency_limited_requests,
    count(*) filter (where is_policy_ack_required)::bigint as policy_ack_required_requests,
    max(occurred_at) as last_event_at
  from filtered
  group by surface, project_id, period_start, provider_key, model_key, routing_scheme, routing_role
),
surface_totals as (
  select
    surface,
    coalesce(sum(request_count), 0)::bigint as request_count,
    coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
    coalesce(sum(known_saved_cost_micro_usd), 0)::bigint as known_saved_cost_micro_usd,
    coalesce(sum(saved_cost_known_requests), 0)::bigint as saved_cost_known_requests,
    coalesce(sum(saved_cost_unknown_requests), 0)::bigint as saved_cost_unknown_requests,
    coalesce(sum(avoided_provider_call_requests), 0)::bigint as avoided_provider_call_requests,
    coalesce(sum(protected_requests), 0)::bigint as protected_requests,
    coalesce(sum(high_performance_requests), 0)::bigint as high_performance_requests,
    coalesce(sum(high_performance_eligible_requests), 0)::bigint as high_performance_eligible_requests,
    coalesce(sum(masking_known_requests), 0)::bigint as masking_known_requests,
    coalesce(sum(masking_unknown_requests), 0)::bigint as masking_unknown_requests,
    coalesce(sum(routing_known_requests), 0)::bigint as routing_known_requests,
    coalesce(sum(routing_unknown_requests), 0)::bigint as routing_unknown_requests,
    coalesce(sum(model_known_requests), 0)::bigint as model_known_requests,
    coalesce(sum(model_unknown_requests), 0)::bigint as model_unknown_requests,
    max(last_event_at) as last_event_at
  from grouped
  group by surface
),
policy_outcomes as (
  select surface, outcome, sum(matched_requests)::bigint as request_count
  from grouped
  cross join lateral (values
    ('cache_hit', cache_hit_requests),
    ('pii_masked', pii_masked_requests),
    ('safety_blocked', safety_blocked_requests),
    ('rate_limited', rate_limited_requests),
    ('fallback_success', fallback_success_requests),
    ('quota_blocked', quota_blocked_requests),
    ('budget_blocked', budget_blocked_requests),
    ('concurrency_limited', concurrency_limited_requests),
    ('policy_ack_required', policy_ack_required_requests)
  ) as policy_outcome(outcome, matched_requests)
  where matched_requests > 0
  group by surface, outcome
),
routing_roles as (
  select surface, routing_scheme, routing_role, sum(request_count)::bigint as request_count
  from grouped
  where routing_role is not null
  group by surface, routing_scheme, routing_role
),
top_models as (
  select surface, provider_key, model_key, sum(request_count)::bigint as request_count
  from grouped
  where provider_key is not null and model_key is not null
  group by surface, provider_key, model_key
  order by request_count desc, surface, provider_key, model_key
  limit 50
),
model_buckets as (
  select
    grouped.surface,
    grouped.period_start,
    grouped.provider_key,
    grouped.model_key,
    sum(grouped.request_count)::bigint as request_count
  from grouped
  join top_models
    on top_models.surface = grouped.surface
   and top_models.provider_key = grouped.provider_key
   and top_models.model_key = grouped.model_key
  group by grouped.surface, grouped.period_start, grouped.provider_key, grouped.model_key
),
usage_sources as (
  select surface, coalesce(project_id, '') as project_id, sum(request_count)::bigint as request_count,
    coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd
  from grouped
  group by surface, project_id
)
select
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface,
    'RequestCount', request_count,
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
    'Surface', surface,
    'Outcome', outcome,
    'RequestCount', request_count
  ) order by request_count desc, surface, outcome) from policy_outcomes), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface,
    'Scheme', routing_scheme,
    'Role', routing_role,
    'RequestCount', request_count
  ) order by surface, routing_scheme, routing_role) from routing_roles), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface,
    'PeriodStart', period_start,
    'Provider', provider_key,
    'Model', model_key,
    'RequestCount', request_count
  ) order by period_start, surface, provider_key, model_key) from model_buckets), '[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object(
    'Surface', surface,
    'ProjectID', project_id,
    'RequestCount', request_count,
    'CostMicroUSD', cost_micro_usd
  ) order by request_count desc, surface, project_id) from usage_sources), '[]'::jsonb)
`, filteredCTE, bucketExpression)
	return query, args
}
