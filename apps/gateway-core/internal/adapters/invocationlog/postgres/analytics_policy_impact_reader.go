package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func (r *QueryReader) GetAnalyticsPolicyImpact(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) (invocationlog.AnalyticsPolicyImpactFields, error) {
	if r == nil || r.db == nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, errors.New("query reader requires a database queryer")
	}
	normalized, err := invocationlog.NormalizeAnalyticsPolicyImpactFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}
	if r.analyticsPolicyImpactReadMode == "rollup" {
		config := policyImpactBucketConfig(normalized)
		if config.Interval == 0 || config.Interval >= time.Minute {
			return r.getAnalyticsPolicyImpactFromRollup(ctx, normalized)
		}
	}
	return r.getAnalyticsPolicyImpactFromRaw(ctx, normalized)
}

func (r *QueryReader) getAnalyticsPolicyImpactFromRaw(
	ctx context.Context,
	normalized invocationlog.AnalyticsPolicyImpactFilter,
) (invocationlog.AnalyticsPolicyImpactFields, error) {
	snapshot, err := r.queryAnalyticsPolicyImpactSnapshot(ctx, normalized)
	if err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}

	config := policyImpactBucketConfig(normalized)
	totals, coverage, lastEventAt := aggregatePolicyImpactSurfaceTotals(snapshot.SurfaceTotals)
	generatedAt := time.Now().UTC()
	source := "postgresql_unified_policy_impact_raw"
	if normalized.ProjectID != "" {
		source = "postgresql_project_application_policy_impact_raw"
	}
	return invocationlog.AnalyticsPolicyImpactFields{
		Period:              normalized.Period,
		BucketInterval:      config.IntervalLabel,
		ExpectedBucketCount: config.ExpectedBucketCount,
		Totals:              totals,
		SurfaceTotals:       snapshot.SurfaceTotals,
		PolicyOutcomes:      snapshot.PolicyOutcomes,
		RoutingRoles:        snapshot.RoutingRoles,
		ModelBuckets:        snapshot.ModelBuckets,
		UsageSources:        snapshot.UsageSources,
		MetricCoverage:      coverage,
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           source,
			RecordCount:      totals.RequestCount,
			LastLogCreatedAt: lastEventAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: generatedAt,
		},
	}, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactSurfaceTotals(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) ([]invocationlog.AnalyticsPolicyImpactSurfaceTotal, error) {
	cte, args := buildAnalyticsPolicyImpactFilteredCTE(filter)
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
%s
select
  surface,
  count(*)::bigint,
  coalesce(sum(cost_micro_usd), 0)::bigint,
  coalesce(sum(saved_cost_micro_usd) filter (where saved_cost_micro_usd is not null), 0)::bigint,
  count(*) filter (where saved_cost_micro_usd is not null)::bigint,
  count(*) filter (where saved_cost_micro_usd is null)::bigint,
  count(*) filter (where avoided_provider_call)::bigint,
  count(*) filter (where protected_request)::bigint,
  count(*) filter (where routing_role = 'complex')::bigint,
  count(*) filter (where routing_role is not null)::bigint,
  count(*) filter (where masking_action is not null)::bigint,
  count(*) filter (where masking_action is null)::bigint,
  count(*) filter (where routing_role is not null)::bigint,
  count(*) filter (where routing_role is null)::bigint,
  count(*) filter (where model_observation_eligible and provider_key is not null and model_key is not null)::bigint,
  count(*) filter (where model_observation_eligible and (provider_key is null or model_key is null))::bigint,
  max(occurred_at)
from filtered
group by surface
order by surface`, cte), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []invocationlog.AnalyticsPolicyImpactSurfaceTotal{}
	for rows.Next() {
		var item invocationlog.AnalyticsPolicyImpactSurfaceTotal
		var lastEventAt sql.NullTime
		if err := rows.Scan(
			&item.Surface,
			&item.RequestCount,
			&item.CostMicroUSD,
			&item.KnownSavedCostMicroUSD,
			&item.SavedCostKnownRequests,
			&item.SavedCostUnknownRequests,
			&item.AvoidedProviderCallRequests,
			&item.ProtectedRequests,
			&item.HighPerformanceRequests,
			&item.HighPerformanceEligibleRequests,
			&item.MaskingKnownRequests,
			&item.MaskingUnknownRequests,
			&item.RoutingKnownRequests,
			&item.RoutingUnknownRequests,
			&item.ModelKnownRequests,
			&item.ModelUnknownRequests,
			&lastEventAt,
		); err != nil {
			return nil, err
		}
		if item.SavedCostUnknownRequests == 0 {
			value := item.KnownSavedCostMicroUSD
			item.SavedCostMicroUSD = &value
		}
		if lastEventAt.Valid {
			value := lastEventAt.Time.UTC()
			item.LastEventAt = &value
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactOutcomes(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) ([]invocationlog.AnalyticsPolicyImpactOutcome, error) {
	cte, args := buildAnalyticsPolicyImpactFilteredCTE(filter)
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
%s
select surface, outcome, count(*)::bigint
from filtered
cross join lateral (values
  ('cache_hit', is_cache_hit),
  ('pii_masked', is_pii_masked),
  ('safety_blocked', is_safety_blocked),
  ('rate_limited', is_rate_limited),
  ('fallback_success', is_fallback_success),
  ('quota_blocked', is_quota_blocked),
  ('budget_blocked', is_budget_blocked),
  ('concurrency_limited', is_concurrency_limited),
  ('policy_ack_required', is_policy_ack_required)
) as policy_outcome(outcome, matched)
where matched
group by surface, outcome
order by count(*) desc, surface, outcome`, cte), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []invocationlog.AnalyticsPolicyImpactOutcome{}
	for rows.Next() {
		var item invocationlog.AnalyticsPolicyImpactOutcome
		if err := rows.Scan(&item.Surface, &item.Outcome, &item.RequestCount); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactRoutingRoles(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) ([]invocationlog.AnalyticsPolicyImpactRoutingRole, error) {
	cte, args := buildAnalyticsPolicyImpactFilteredCTE(filter)
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
%s
select surface, routing_scheme, routing_role, count(*)::bigint
from filtered
where routing_role is not null
group by surface, routing_scheme, routing_role
order by surface, routing_scheme, routing_role`, cte), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []invocationlog.AnalyticsPolicyImpactRoutingRole{}
	for rows.Next() {
		var item invocationlog.AnalyticsPolicyImpactRoutingRole
		if err := rows.Scan(&item.Surface, &item.Scheme, &item.Role, &item.RequestCount); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactModelBuckets(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) ([]invocationlog.AnalyticsPolicyImpactModelBucket, error) {
	cte, args := buildAnalyticsPolicyImpactFilteredCTE(filter)
	bucketExpression := strings.ReplaceAll(costReportBucketExpression(invocationlog.CostReportFilter{
		Period: filter.Period, From: filter.From, To: filter.To,
	}), "created_at", "occurred_at")
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
%s,
top_models as (
  select surface, provider_key, model_key, count(*)::bigint as request_count
  from filtered
  where provider_key is not null and model_key is not null
  group by surface, provider_key, model_key
  order by request_count desc, surface, provider_key, model_key
  limit 50
)
select filtered.surface, %s as period_start, filtered.provider_key, filtered.model_key, count(*)::bigint
from filtered
join top_models
  on top_models.surface = filtered.surface
 and top_models.provider_key = filtered.provider_key
 and top_models.model_key = filtered.model_key
group by filtered.surface, period_start, filtered.provider_key, filtered.model_key
order by period_start, filtered.surface, filtered.provider_key, filtered.model_key`, cte, bucketExpression), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []invocationlog.AnalyticsPolicyImpactModelBucket{}
	for rows.Next() {
		var item invocationlog.AnalyticsPolicyImpactModelBucket
		if err := rows.Scan(&item.Surface, &item.PeriodStart, &item.Provider, &item.Model, &item.RequestCount); err != nil {
			return nil, err
		}
		item.PeriodStart = item.PeriodStart.UTC()
		item.PeriodEnd = costReportBucketEnd(item.PeriodStart, filter.Period)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (r *QueryReader) queryAnalyticsPolicyImpactUsageSources(
	ctx context.Context,
	filter invocationlog.AnalyticsPolicyImpactFilter,
) ([]invocationlog.AnalyticsPolicyImpactUsageSource, error) {
	cte, args := buildAnalyticsPolicyImpactFilteredCTE(filter)
	rows, err := r.db.Query(ctx, fmt.Sprintf(`
%s
select surface, coalesce(project_id, ''), count(*)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint
from filtered
group by surface, project_id
order by count(*) desc, surface, project_id`, cte), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []invocationlog.AnalyticsPolicyImpactUsageSource{}
	for rows.Next() {
		var item invocationlog.AnalyticsPolicyImpactUsageSource
		if err := rows.Scan(&item.Surface, &item.ProjectID, &item.RequestCount, &item.CostMicroUSD); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func buildAnalyticsPolicyImpactFilteredCTE(filter invocationlog.AnalyticsPolicyImpactFilter) (string, []any) {
	args := []any{filter.From.UTC(), filter.To.UTC()}
	projectWhere := []string{"logs.created_at >= $1", "logs.created_at < $2"}
	tenantChatWhere := []string{
		"completed_at >= $1", "completed_at < $2",
		"surface = 'tenant_chat'", "execution_scope_kind = 'tenant_chat'",
	}
	if isPostgresUUID(filter.TenantID) {
		args = append(args, filter.TenantID)
		placeholder := fmt.Sprintf("$%d", len(args))
		projectWhere = append(projectWhere, "logs.tenant_id = "+placeholder)
		tenantChatWhere = append(tenantChatWhere, "tenant_id = "+placeholder)
	} else {
		projectWhere = append(projectWhere, "1 = 0")
		tenantChatWhere = append(tenantChatWhere, "1 = 0")
	}
	includeTenantChat := filter.ProjectID == ""
	if !includeTenantChat {
		addUUIDWhere(&projectWhere, &args, "logs.project_id", filter.ProjectID)
	}

	safetyOutcome := `coalesce(
      nullif(meta."domainOutcomes" #>> '{safety,outcome}', ''),
      nullif(meta."gatewayStageOutcomes" #>> '{domainOutcomes,safety,outcome}', ''),
      case coalesce(nullif(logs.masking_action, ''), 'none')
        when 'blocked' then 'blocked'
        when 'redacted' then 'redacted'
        else 'passed'
      end
    )`
	terminalStatus := `coalesce(
      nullif(meta."terminalStatus", ''),
      nullif(meta."gatewayStageOutcomes" #>> '{terminalStatus}', ''),
      logs.status
    )`
	fallbackOutcome := `coalesce(
      nullif(meta."domainOutcomes" #>> '{fallback,outcome}', ''),
      nullif(meta."gatewayStageOutcomes" #>> '{domainOutcomes,fallback,outcome}', ''),
      'not_called'
    )`
	budgetOutcome := `coalesce(
      nullif(meta."domainOutcomes" #>> '{budget,outcome}', ''),
      nullif(meta."gatewayStageOutcomes" #>> '{domainOutcomes,budget,outcome}', ''),
      'not_checked'
    )`
	projectSource := fmt.Sprintf(`
project_source as materialized (
  /* Parse the TOASTed metadata object once before policy expressions reuse its fields. */
  select
    logs.project_id::text as project_id,
    logs.created_at as occurred_at,
    nullif(logs.provider, '') as provider_key,
    nullif(logs.model, '') as model_key,
    lower(nullif(meta."promptDifficulty", '')) as prompt_difficulty,
    case lower(nullif(meta."providerCalled", ''))
      when 'true' then true
      when '1' then true
      else false
    end as provider_called,
    logs.cost_micro_usd::bigint as cost_micro_usd,
    logs.saved_cost_micro_usd::bigint as saved_cost_micro_usd,
    coalesce(nullif(logs.masking_action, ''), 'none') as masking_action,
    coalesce(nullif(logs.cache_status, ''), 'bypass') as cache_status,
    %s as safety_outcome,
    %s as terminal_status,
    %s as fallback_outcome,
    %s as budget_outcome
  from p0_llm_invocation_logs logs
  cross join lateral jsonb_to_record(logs.metadata) as meta(
    "promptDifficulty" text,
    "providerCalled" text,
    "terminalStatus" text,
    "domainOutcomes" jsonb,
    "gatewayStageOutcomes" jsonb
  )
  where %s
)`, safetyOutcome, terminalStatus, fallbackOutcome, budgetOutcome, strings.Join(projectWhere, " and "))

	projectBranch := fmt.Sprintf(`
  select
    '%s'::text as surface,
    project_id,
    occurred_at,
    provider_key,
    model_key,
    'difficulty'::text as routing_scheme,
    case prompt_difficulty
      when 'simple' then 'simple'
      when 'complex' then 'complex'
      else null
    end as routing_role,
    cost_micro_usd,
    saved_cost_micro_usd,
    masking_action,
    cache_status = 'hit' as is_cache_hit,
    masking_action = 'redacted' as is_pii_masked,
    safety_outcome = 'blocked' as is_safety_blocked,
    terminal_status = 'rate_limited' as is_rate_limited,
    fallback_outcome = 'success' as is_fallback_success,
    false as is_quota_blocked,
    budget_outcome in ('blocked', 'hard_limit_exceeded', 'exceeded') as is_budget_blocked,
    false as is_concurrency_limited,
    false as is_policy_ack_required,
    (
      cache_status = 'hit'
      or safety_outcome = 'blocked'
      or terminal_status = 'rate_limited'
      or budget_outcome in ('blocked', 'hard_limit_exceeded', 'exceeded')
    ) as avoided_provider_call,
    (masking_action in ('redacted', 'blocked') or safety_outcome = 'blocked') as protected_request,
    (
      provider_called
      or provider_key is not null
      or model_key is not null
    ) as model_observation_eligible
  from project_source`, invocationlog.AnalyticsSurfaceProjectApplication)

	branches := []string{projectBranch}
	if includeTenantChat {
		branches = append(branches, fmt.Sprintf(`
  select
    '%s'::text as surface,
    null::text as project_id,
    completed_at as occurred_at,
    nullif(effective_provider_id::text, '') as provider_key,
    nullif(effective_model_key, '') as model_key,
    'difficulty'::text as routing_scheme,
    case routing_difficulty
      when 'simple' then 'simple'
      when 'complex' then 'complex'
      else null
    end as routing_role,
    confirmed_cost_micro_usd::bigint as cost_micro_usd,
    saved_cost_micro_usd::bigint as saved_cost_micro_usd,
    masking_action,
    (cache_outcome = 'hit' or terminal_outcome = 'cache_hit') as is_cache_hit,
    masking_action = 'redacted' as is_pii_masked,
    (masking_action = 'blocked' or terminal_outcome = 'safety_blocked') as is_safety_blocked,
    terminal_outcome = 'rate_limited' as is_rate_limited,
    exists (
      select 1 from tenant_chat_provider_attempts attempt
      where attempt.tenant_id = tenant_chat_invocation_logs.tenant_id
        and attempt.request_id = tenant_chat_invocation_logs.request_id
        and attempt.kind = 'fallback' and attempt.outcome = 'succeeded'
    ) as is_fallback_success,
    terminal_outcome = 'quota_blocked' as is_quota_blocked,
    terminal_outcome = 'budget_blocked' as is_budget_blocked,
    terminal_outcome = 'concurrency_limited' as is_concurrency_limited,
    terminal_outcome = 'policy_ack_required' as is_policy_ack_required,
    terminal_outcome in (
      'cache_hit', 'safety_blocked', 'rate_limited', 'quota_blocked',
      'budget_blocked', 'concurrency_limited', 'policy_ack_required'
    ) as avoided_provider_call,
    (masking_action in ('redacted', 'blocked') or terminal_outcome = 'safety_blocked') as protected_request,
    (
      nullif(effective_provider_id::text, '') is not null
      or nullif(effective_model_key, '') is not null
      or terminal_outcome in ('succeeded', 'cache_hit', 'provider_failed', 'provider_timeout')
    ) as model_observation_eligible
  from tenant_chat_invocation_logs
  where %s`, invocationlog.AnalyticsSurfaceTenantChat, strings.Join(tenantChatWhere, " and ")))
	}
	return "with " + projectSource + ",\nfiltered as not materialized (" + strings.Join(branches, "\nunion all\n") + "\n)", args
}

func policyImpactBucketConfig(filter invocationlog.AnalyticsPolicyImpactFilter) invocationlog.TimeSeriesBucketConfig {
	return costReportBucketConfig(invocationlog.CostReportFilter{
		Period: filter.Period,
		From:   filter.From,
		To:     filter.To,
	})
}

func aggregatePolicyImpactSurfaceTotals(
	items []invocationlog.AnalyticsPolicyImpactSurfaceTotal,
) (invocationlog.AnalyticsPolicyImpactTotals, []invocationlog.AnalyticsMetricCoverage, *time.Time) {
	totals := invocationlog.AnalyticsPolicyImpactTotals{}
	coverage := make([]invocationlog.AnalyticsMetricCoverage, 0, len(items)*4)
	savedComplete := true
	var lastEventAt *time.Time
	for _, item := range items {
		totals.RequestCount += item.RequestCount
		totals.CostMicroUSD += item.CostMicroUSD
		totals.KnownSavedCostMicroUSD += item.KnownSavedCostMicroUSD
		totals.AvoidedProviderCallRequests += item.AvoidedProviderCallRequests
		totals.ProtectedRequests += item.ProtectedRequests
		totals.HighPerformanceRequests += item.HighPerformanceRequests
		totals.HighPerformanceEligibleRequests += item.HighPerformanceEligibleRequests
		if item.SavedCostUnknownRequests > 0 {
			savedComplete = false
		}
		coverage = append(coverage,
			metricCoverage("saved_cost", item.Surface, item.SavedCostKnownRequests, item.SavedCostUnknownRequests),
			metricCoverage("pii_masking", item.Surface, item.MaskingKnownRequests, item.MaskingUnknownRequests),
			metricCoverage("high_performance", item.Surface, item.RoutingKnownRequests, item.RoutingUnknownRequests),
			metricCoverage("model_flow", item.Surface, item.ModelKnownRequests, item.ModelUnknownRequests),
		)
		if item.LastEventAt != nil && (lastEventAt == nil || item.LastEventAt.After(*lastEventAt)) {
			value := item.LastEventAt.UTC()
			lastEventAt = &value
		}
	}
	if savedComplete {
		value := totals.KnownSavedCostMicroUSD
		totals.SavedCostMicroUSD = &value
	}
	return totals, coverage, lastEventAt
}

func metricCoverage(metric string, surface string, known int64, unknown int64) invocationlog.AnalyticsMetricCoverage {
	status := invocationlog.AnalyticsCoverageComplete
	if unknown > 0 {
		status = invocationlog.AnalyticsCoveragePartial
		if known == 0 {
			status = invocationlog.AnalyticsCoverageUnavailable
		}
	}
	return invocationlog.AnalyticsMetricCoverage{
		Metric: metric, Surface: surface, Status: status,
		KnownRequestCount: known, UnknownRequestCount: unknown,
	}
}
