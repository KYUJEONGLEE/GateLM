package postgres

import (
	"context"
	"fmt"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func (r *QueryReader) getDashboardRawRangesSnapshot(
	ctx context.Context,
	filter invocationlog.DashboardOverviewFilter,
	ranges []dashboardTimeRange,
) (dashboardRollupSnapshot, error) {
	snapshot := newDashboardRollupSnapshot()
	if len(ranges) == 0 {
		return snapshot, nil
	}

	projectRows := map[string]*dashboardProjectRollup{}
	applicationRows := map[string]*dashboardApplicationRollup{}
	budgetRows := map[string]*dashboardBudgetRollup{}
	modelRows := map[string]*dashboardModelRollup{}
	routingRows := map[string]*dashboardRoutingRollup{}

	totalsQuery, totalsArgs := buildDashboardRawRangeTotalsQuery(filter, ranges)
	totals, err := r.db.Query(ctx, totalsQuery, totalsArgs...)
	if err != nil {
		return dashboardRollupSnapshot{}, err
	}
	defer totals.Close()
	for totals.Next() {
		row, scanErr := scanDashboardRollupTotal(totals)
		if scanErr != nil {
			return dashboardRollupSnapshot{}, scanErr
		}
		if mergeErr := mergeDashboardRollupTotal(&snapshot, row, projectRows, applicationRows, budgetRows); mergeErr != nil {
			return dashboardRollupSnapshot{}, mergeErr
		}
	}
	if err := totals.Err(); err != nil {
		return dashboardRollupSnapshot{}, err
	}

	dimensionsQuery, dimensionsArgs := buildDashboardRawRangeDimensionsQuery(filter, ranges)
	dimensions, err := r.db.Query(ctx, dimensionsQuery, dimensionsArgs...)
	if err != nil {
		return dashboardRollupSnapshot{}, err
	}
	defer dimensions.Close()
	for dimensions.Next() {
		var dimensionType string
		var value string
		var value2 string
		var value3 string
		var requestCount int64
		var totalTokens int64
		var costMicroUSD int64
		if err := dimensions.Scan(
			&dimensionType,
			&value,
			&value2,
			&value3,
			&requestCount,
			&totalTokens,
			&costMicroUSD,
		); err != nil {
			return dashboardRollupSnapshot{}, err
		}
		mergeDashboardRollupDimension(
			&snapshot.Aggregate,
			dimensionType,
			value,
			value2,
			value3,
			requestCount,
			totalTokens,
			costMicroUSD,
			modelRows,
			routingRows,
		)
	}
	if err := dimensions.Err(); err != nil {
		return dashboardRollupSnapshot{}, err
	}

	finalizeDashboardRollupSnapshot(&snapshot, projectRows, applicationRows, budgetRows, modelRows, routingRows)
	return snapshot, nil
}

func buildDashboardRawRangeTotalsQuery(
	filter invocationlog.DashboardOverviewFilter,
	ranges []dashboardTimeRange,
) (string, []any) {
	where, args := buildDashboardRawRangeWhere(filter, ranges)
	latencyFilter := "terminal_status in ('success', 'failed')"
	providerLatencyFilter := latencyFilter + " and provider_latency_ms is not null"
	ttftFilter := "stream and ttft_ms is not null"

	query := fmt.Sprintf(`
with filtered as (
  select
    project_id::text as project_id,
    coalesce(application_id::text, '') as application_id,
    %[1]s as budget_scope_type,
    %[2]s as budget_scope_id,
    %[3]s as budget_scope_resolved_by,
    %[4]s as terminal_status,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_micro_usd,
    saved_cost_micro_usd,
    latency_ms,
    greatest(latency_ms - coalesce(provider_latency_ms, 0), 0) as gateway_internal_latency_ms,
    provider_latency_ms,
    stream,
    ttft_ms,
    cache_status,
    cache_type,
    %[5]s as cache_outcome,
    %[6]s as fallback_outcome,
    created_at
  from p0_llm_invocation_logs
  where %[7]s
)
select
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  budget_scope_resolved_by,
  count(*)::bigint as request_count,
  count(*) filter (where terminal_status = 'success')::bigint as successful_request_count,
  count(*) filter (where terminal_status = 'failed')::bigint as failed_request_count,
  count(*) filter (where terminal_status = 'blocked')::bigint as blocked_request_count,
  count(*) filter (where terminal_status = 'rate_limited')::bigint as rate_limited_request_count,
  count(*) filter (where terminal_status = 'cancelled')::bigint as cancelled_request_count,
  count(*) filter (
    where cache_outcome = 'hit'
      and coalesce(nullif(cache_type, ''), 'none') = 'exact'
  )::bigint as cache_hit_request_count,
  count(*) filter (
    where cache_outcome in ('hit', 'miss', 'error')
      and coalesce(nullif(cache_type, ''), 'none') = 'exact'
  )::bigint as cache_eligible_request_count,
  count(*) filter (where fallback_outcome = 'success')::bigint as fallback_success_request_count,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd,
  count(*) filter (where %[8]s)::bigint as latency_count,
  coalesce(sum(latency_ms) filter (where %[8]s), 0)::bigint as latency_sum_ms,
  %[9]s as latency_histogram,
  count(*) filter (where %[8]s)::bigint as gateway_internal_latency_count,
  coalesce(sum(gateway_internal_latency_ms) filter (where %[8]s), 0)::bigint as gateway_internal_latency_sum_ms,
  %[10]s as gateway_internal_latency_histogram,
  count(*) filter (where %[11]s)::bigint as provider_latency_count,
  coalesce(sum(provider_latency_ms) filter (where %[11]s), 0)::bigint as provider_latency_sum_ms,
  %[12]s as provider_latency_histogram,
  count(*) filter (where stream)::bigint as stream_request_count,
  count(*) filter (where %[13]s)::bigint as ttft_count,
  coalesce(sum(ttft_ms) filter (where %[13]s), 0)::bigint as ttft_sum_ms,
  %[14]s as ttft_histogram,
  %[15]d::integer as histogram_version,
  max(created_at) as source_max_at
from filtered
group by
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  budget_scope_resolved_by`,
		budgetScopeTypeSQL,
		budgetScopeIDSQL,
		budgetScopeResolvedBySQL,
		terminalStatusSQL,
		metadataOutcomeSQL("cache", `case coalesce(nullif(cache_status, ''), 'bypass') when 'hit' then 'hit' when 'miss' then 'miss' when 'error' then 'error' when 'bypass' then 'bypassed' else 'not_used' end`),
		metadataOutcomeSQL("fallback", `'not_called'`),
		strings.Join(where, " and "),
		latencyFilter,
		dashboardHistogramSQL("latency_ms", latencyFilter),
		dashboardHistogramSQL("gateway_internal_latency_ms", latencyFilter),
		providerLatencyFilter,
		dashboardHistogramSQL("provider_latency_ms", providerLatencyFilter),
		ttftFilter,
		dashboardHistogramSQL("ttft_ms", ttftFilter),
		dashboardHistogramVersion,
	)
	return query, args
}

func buildDashboardRawRangeDimensionsQuery(
	filter invocationlog.DashboardOverviewFilter,
	ranges []dashboardTimeRange,
) (string, []any) {
	where, args := buildDashboardRawRangeWhere(filter, ranges)
	safetyOutcomeSQL := metadataOutcomeSQL("safety", `case coalesce(nullif(masking_action, ''), 'none') when 'blocked' then 'blocked' when 'redacted' then 'redacted' else 'passed' end`)
	cacheOutcomeSQL := metadataOutcomeSQL("cache", `case coalesce(nullif(cache_status, ''), 'bypass') when 'hit' then 'hit' when 'miss' then 'miss' when 'error' then 'error' when 'bypass' then 'bypassed' else 'not_used' end`)
	fallbackOutcomeSQL := metadataOutcomeSQL("fallback", `'not_called'`)
	budgetOutcomeSQL := metadataOutcomeSQL("budget", `'not_checked'`)

	query := fmt.Sprintf(`
with filtered as (
  select
    %[1]s as terminal_status,
    coalesce(nullif(masking_action, ''), 'none') as masking_action,
    %[2]s as safety_outcome,
    %[3]s as cache_outcome,
    %[4]s as fallback_outcome,
    %[5]s as budget_outcome,
    coalesce(nullif(provider, ''), '') as provider,
    coalesce(nullif(model, ''), '') as model,
    case lower(coalesce(nullif(metadata->>'promptCategory', ''), 'general'))
      when 'code' then 'code'
      when 'translation' then 'translation'
      when 'summarization' then 'summarization'
      when 'reasoning' then 'reasoning'
      else 'general'
    end as prompt_category,
    case lower(coalesce(nullif(metadata->>'promptDifficulty', ''), 'simple'))
      when 'complex' then 'complex'
      else 'simple'
    end as prompt_difficulty,
    coalesce(nullif(routing_reason, ''), '') as routing_reason,
    total_tokens,
    cost_micro_usd
  from p0_llm_invocation_logs
  where %[6]s
), dimensions as (
  select 'terminal_status'::text as dimension_type, terminal_status as dimension_value, ''::text as dimension_value_2, ''::text as dimension_value_3, count(*)::bigint as request_count, coalesce(sum(total_tokens), 0)::bigint as total_tokens, coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd from filtered group by terminal_status
  union all
  select 'masking_action', masking_action, '', '', count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered group by masking_action
  union all
  select 'safety_outcome', safety_outcome, '', '', count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered group by safety_outcome
  union all
  select 'cache_outcome', cache_outcome, '', '', count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered group by cache_outcome
  union all
  select 'fallback_outcome', fallback_outcome, '', '', count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered group by fallback_outcome
  union all
  select 'budget_outcome', budget_outcome, '', '', count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered group by budget_outcome
  union all
  select 'routing', prompt_category, prompt_difficulty, routing_reason, count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered group by prompt_category, prompt_difficulty, routing_reason
  union all
  select 'provider_model', provider, model, '', count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(cost_micro_usd), 0)::bigint from filtered where provider <> '' and model <> '' group by provider, model
)
select
  dimension_type,
  dimension_value,
  dimension_value_2,
  dimension_value_3,
  request_count,
  total_tokens,
  cost_micro_usd
from dimensions`,
		terminalStatusSQL,
		safetyOutcomeSQL,
		cacheOutcomeSQL,
		fallbackOutcomeSQL,
		budgetOutcomeSQL,
		strings.Join(where, " and "),
	)
	return query, args
}

func buildDashboardRawRangeWhere(
	filter invocationlog.DashboardOverviewFilter,
	ranges []dashboardTimeRange,
) ([]string, []any) {
	where := []string{}
	args := []any{}
	addUUIDWhere(&where, &args, "tenant_id", filter.TenantID)
	addUUIDWhere(&where, &args, "project_id", filter.ProjectID)
	rangeWhere := make([]string, 0, len(ranges))
	for _, item := range ranges {
		fromIndex := len(args) + 1
		args = append(args, item.From.UTC())
		toIndex := len(args) + 1
		args = append(args, item.To.UTC())
		rangeWhere = append(rangeWhere, fmt.Sprintf("(created_at >= $%d and created_at < $%d)", fromIndex, toIndex))
	}
	where = append(where, "("+strings.Join(rangeWhere, " or ")+")")
	addOptional := func(expression string, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s = $%d", expression, len(args)))
	}
	addOptional(budgetScopeTypeSQL, filter.BudgetScope.Type)
	addOptional(budgetScopeIDSQL, filter.BudgetScope.ID)
	addOptional(budgetScopeResolvedBySQL, filter.BudgetScope.ResolvedBy)
	return where, args
}

func dashboardHistogramSQL(expression string, predicate string) string {
	buckets := make([]string, 0, len(dashboardHistogramUpperBoundsMs))
	for index := range dashboardHistogramUpperBoundsMs {
		bucketPredicate := ""
		switch {
		case index == 0:
			bucketPredicate = fmt.Sprintf("%s <= %.0f", expression, dashboardHistogramUpperBoundsMs[index])
		case index == len(dashboardHistogramUpperBoundsMs)-1:
			bucketPredicate = fmt.Sprintf("%s > %.0f", expression, dashboardHistogramUpperBoundsMs[index-1])
		default:
			bucketPredicate = fmt.Sprintf(
				"%s > %.0f and %s <= %.0f",
				expression,
				dashboardHistogramUpperBoundsMs[index-1],
				expression,
				dashboardHistogramUpperBoundsMs[index],
			)
		}
		buckets = append(buckets, fmt.Sprintf("count(*) filter (where (%s) and (%s))::bigint", predicate, bucketPredicate))
	}
	return "array[" + strings.Join(buckets, ",") + "]::bigint[]"
}
