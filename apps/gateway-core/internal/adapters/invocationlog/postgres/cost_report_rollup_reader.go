package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type costReportMetrics struct {
	RequestCount      int64
	PromptTokens      int64
	CompletionTokens  int64
	TotalTokens       int64
	CostMicroUSD      int64
	SavedCostMicroUSD int64
}

type costReportAggregate struct {
	Buckets      map[time.Time]invocationlog.CostReportBucket
	Projects     map[string]invocationlog.CostReportProjectBreakdown
	Applications map[string]invocationlog.CostReportApplicationBreakdown
	Models       map[string]invocationlog.CostReportModelBreakdown
	ModelBuckets map[string]invocationlog.CostReportModelBucket
	BudgetScopes map[string]invocationlog.CostReportBudgetScopeBreakdown
	LastSourceAt *time.Time
}

func newCostReportAggregate() costReportAggregate {
	return costReportAggregate{
		Buckets:      map[time.Time]invocationlog.CostReportBucket{},
		Projects:     map[string]invocationlog.CostReportProjectBreakdown{},
		Applications: map[string]invocationlog.CostReportApplicationBreakdown{},
		Models:       map[string]invocationlog.CostReportModelBreakdown{},
		ModelBuckets: map[string]invocationlog.CostReportModelBucket{},
		BudgetScopes: map[string]invocationlog.CostReportBudgetScopeBreakdown{},
	}
}

func (aggregate *costReportAggregate) addScopedRow(
	periodStart time.Time,
	projectID string,
	applicationID string,
	scope budget.Scope,
	metrics costReportMetrics,
	lastSourceAt *time.Time,
) {
	if aggregate == nil {
		return
	}
	periodStart = periodStart.UTC()
	bucket := aggregate.Buckets[periodStart]
	bucket.PeriodStart = periodStart
	addCostReportMetricsToBucket(&bucket, metrics)
	aggregate.Buckets[periodStart] = bucket

	projectID = strings.TrimSpace(projectID)
	if projectID != "" {
		item := aggregate.Projects[projectID]
		item.ProjectID = projectID
		addCostReportMetricsToProject(&item, metrics)
		aggregate.Projects[projectID] = item
	}

	applicationID = strings.TrimSpace(applicationID)
	if applicationID != "" {
		item := aggregate.Applications[applicationID]
		item.ApplicationID = applicationID
		addCostReportMetricsToApplication(&item, metrics)
		aggregate.Applications[applicationID] = item
	}

	scope.Type = strings.TrimSpace(scope.Type)
	scope.ID = strings.TrimSpace(scope.ID)
	scope.ResolvedBy = strings.TrimSpace(scope.ResolvedBy)
	if scope.ID != "" {
		key := strings.Join([]string{scope.Type, scope.ID, scope.ResolvedBy}, "\x00")
		item := aggregate.BudgetScopes[key]
		item.BudgetScope = scope
		addCostReportMetricsToBudgetScope(&item, metrics)
		aggregate.BudgetScopes[key] = item
	}

	if lastSourceAt != nil {
		value := lastSourceAt.UTC()
		if aggregate.LastSourceAt == nil || value.After(*aggregate.LastSourceAt) {
			aggregate.LastSourceAt = &value
		}
	}
}

func (aggregate *costReportAggregate) addModelRow(
	periodStart time.Time,
	provider string,
	model string,
	metrics costReportMetrics,
) {
	if aggregate == nil {
		return
	}
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	if provider == "" || model == "" {
		return
	}
	key := provider + "\x00" + model
	item := aggregate.Models[key]
	item.Provider = provider
	item.Model = model
	item.RequestCount += metrics.RequestCount
	item.PromptTokens += metrics.PromptTokens
	item.CompletionTokens += metrics.CompletionTokens
	item.TotalTokens += metrics.TotalTokens
	item.CostMicroUSD += metrics.CostMicroUSD
	item.SavedCostMicroUSD += metrics.SavedCostMicroUSD
	aggregate.Models[key] = item

	periodStart = periodStart.UTC()
	bucketKey := periodStart.Format(time.RFC3339Nano) + "\x00" + key
	bucket := aggregate.ModelBuckets[bucketKey]
	bucket.PeriodStart = periodStart
	bucket.Provider = provider
	bucket.Model = model
	bucket.RequestCount += metrics.RequestCount
	aggregate.ModelBuckets[bucketKey] = bucket
}

func addCostReportMetricsToBucket(item *invocationlog.CostReportBucket, metrics costReportMetrics) {
	item.RequestCount += metrics.RequestCount
	item.PromptTokens += metrics.PromptTokens
	item.CompletionTokens += metrics.CompletionTokens
	item.TotalTokens += metrics.TotalTokens
	item.CostMicroUSD += metrics.CostMicroUSD
	item.SavedCostMicroUSD += metrics.SavedCostMicroUSD
}

func addCostReportMetricsToProject(item *invocationlog.CostReportProjectBreakdown, metrics costReportMetrics) {
	item.RequestCount += metrics.RequestCount
	item.PromptTokens += metrics.PromptTokens
	item.CompletionTokens += metrics.CompletionTokens
	item.TotalTokens += metrics.TotalTokens
	item.CostMicroUSD += metrics.CostMicroUSD
	item.SavedCostMicroUSD += metrics.SavedCostMicroUSD
}

func addCostReportMetricsToApplication(item *invocationlog.CostReportApplicationBreakdown, metrics costReportMetrics) {
	item.RequestCount += metrics.RequestCount
	item.PromptTokens += metrics.PromptTokens
	item.CompletionTokens += metrics.CompletionTokens
	item.TotalTokens += metrics.TotalTokens
	item.CostMicroUSD += metrics.CostMicroUSD
	item.SavedCostMicroUSD += metrics.SavedCostMicroUSD
}

func addCostReportMetricsToBudgetScope(item *invocationlog.CostReportBudgetScopeBreakdown, metrics costReportMetrics) {
	item.RequestCount += metrics.RequestCount
	item.PromptTokens += metrics.PromptTokens
	item.CompletionTokens += metrics.CompletionTokens
	item.TotalTokens += metrics.TotalTokens
	item.CostMicroUSD += metrics.CostMicroUSD
	item.SavedCostMicroUSD += metrics.SavedCostMicroUSD
}

func (r *QueryReader) addCostReportRollupRows(
	ctx context.Context,
	filter invocationlog.CostReportFilter,
	segments []dashboardRollupSegment,
	aggregate *costReportAggregate,
) error {
	totalsQuery, totalsArgs := buildCostReportRollupTotalsQuery(filter, segments)
	totalsRows, err := r.db.Query(ctx, totalsQuery, totalsArgs...)
	if err != nil {
		return err
	}
	defer totalsRows.Close()
	for totalsRows.Next() {
		var sourceBucketStart time.Time
		var projectID string
		var applicationID string
		var scope budget.Scope
		var metrics costReportMetrics
		var sourceMaxAt sql.NullTime
		if err := totalsRows.Scan(
			&sourceBucketStart,
			&projectID,
			&applicationID,
			&scope.Type,
			&scope.ID,
			&scope.ResolvedBy,
			&metrics.RequestCount,
			&metrics.PromptTokens,
			&metrics.CompletionTokens,
			&metrics.TotalTokens,
			&metrics.CostMicroUSD,
			&metrics.SavedCostMicroUSD,
			&sourceMaxAt,
		); err != nil {
			return err
		}
		var lastSourceAt *time.Time
		if sourceMaxAt.Valid {
			value := sourceMaxAt.Time.UTC()
			lastSourceAt = &value
		}
		aggregate.addScopedRow(
			costReportOutputBucketStart(filter, sourceBucketStart),
			projectID,
			applicationID,
			scope,
			metrics,
			lastSourceAt,
		)
	}
	if err := totalsRows.Err(); err != nil {
		return err
	}
	// Release the first result set before issuing the second query. The defer
	// above remains as the error-path safety net.
	totalsRows.Close()

	modelQuery, modelArgs := buildCostReportRollupModelQuery(filter, segments)
	modelRows, err := r.db.Query(ctx, modelQuery, modelArgs...)
	if err != nil {
		return err
	}
	defer modelRows.Close()
	for modelRows.Next() {
		var sourceBucketStart time.Time
		var provider string
		var model string
		var metrics costReportMetrics
		if err := modelRows.Scan(
			&sourceBucketStart,
			&provider,
			&model,
			&metrics.RequestCount,
			&metrics.PromptTokens,
			&metrics.CompletionTokens,
			&metrics.TotalTokens,
			&metrics.CostMicroUSD,
			&metrics.SavedCostMicroUSD,
		); err != nil {
			return err
		}
		aggregate.addModelRow(costReportOutputBucketStart(filter, sourceBucketStart), provider, model, metrics)
	}
	return modelRows.Err()
}

func (r *QueryReader) addCostReportRawRangeRows(
	ctx context.Context,
	filter invocationlog.CostReportFilter,
	ranges []dashboardTimeRange,
	aggregate *costReportAggregate,
) error {
	if len(ranges) == 0 {
		return nil
	}
	totalsQuery, totalsArgs := buildCostReportRawRangeTotalsQuery(filter, ranges)
	totalsRows, err := r.db.Query(ctx, totalsQuery, totalsArgs...)
	if err != nil {
		return err
	}
	defer totalsRows.Close()
	for totalsRows.Next() {
		var periodStart time.Time
		var projectID string
		var applicationID string
		var scope budget.Scope
		var metrics costReportMetrics
		var lastLogCreatedAt sql.NullTime
		if err := totalsRows.Scan(
			&periodStart,
			&projectID,
			&applicationID,
			&scope.Type,
			&scope.ID,
			&scope.ResolvedBy,
			&metrics.RequestCount,
			&metrics.PromptTokens,
			&metrics.CompletionTokens,
			&metrics.TotalTokens,
			&metrics.CostMicroUSD,
			&metrics.SavedCostMicroUSD,
			&lastLogCreatedAt,
		); err != nil {
			return err
		}
		var lastSourceAt *time.Time
		if lastLogCreatedAt.Valid {
			value := lastLogCreatedAt.Time.UTC()
			lastSourceAt = &value
		}
		aggregate.addScopedRow(
			costReportOutputBucketStart(filter, periodStart),
			projectID,
			applicationID,
			scope,
			metrics,
			lastSourceAt,
		)
	}
	if err := totalsRows.Err(); err != nil {
		return err
	}
	// Release the first result set before issuing the second query. The defer
	// above remains as the error-path safety net.
	totalsRows.Close()

	modelQuery, modelArgs := buildCostReportRawRangeModelQuery(filter, ranges)
	modelRows, err := r.db.Query(ctx, modelQuery, modelArgs...)
	if err != nil {
		return err
	}
	defer modelRows.Close()
	for modelRows.Next() {
		var periodStart time.Time
		var provider string
		var model string
		var metrics costReportMetrics
		if err := modelRows.Scan(
			&periodStart,
			&provider,
			&model,
			&metrics.RequestCount,
			&metrics.PromptTokens,
			&metrics.CompletionTokens,
			&metrics.TotalTokens,
			&metrics.CostMicroUSD,
			&metrics.SavedCostMicroUSD,
		); err != nil {
			return err
		}
		aggregate.addModelRow(costReportOutputBucketStart(filter, periodStart), provider, model, metrics)
	}
	return modelRows.Err()
}

func buildCostReportRollupTotalsQuery(
	filter invocationlog.CostReportFilter,
	segments []dashboardRollupSegment,
) (string, []any) {
	where, args := buildCostReportRollupWhere(filter, segments)
	return `select
  bucket_start,
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  budget_scope_resolved_by,
  request_count,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  saved_cost_micro_usd,
  source_max_at
from dashboard_rollup_totals
where ` + where + `
order by bucket_start`, args
}

func buildCostReportRollupModelQuery(
	filter invocationlog.CostReportFilter,
	segments []dashboardRollupSegment,
) (string, []any) {
	where, args := buildCostReportRollupWhere(filter, segments)
	return `select
  bucket_start,
  dimension_value as provider,
  dimension_value_2 as model,
  request_count,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  saved_cost_micro_usd
from dashboard_rollup_dimensions
where ` + where + `
  and dimension_type = 'provider_model'`, args
}

func buildCostReportRollupWhere(
	filter invocationlog.CostReportFilter,
	segments []dashboardRollupSegment,
) (string, []any) {
	args := []any{filter.TenantID}
	where := []string{
		"tenant_id = $1::uuid",
		"surface = 'project_application'",
		fmt.Sprintf("histogram_version = %d", dashboardHistogramVersion),
	}
	segmentPredicates := make([]string, 0, len(segments))
	for _, segment := range segments {
		grainIndex := len(args) + 1
		args = append(args, segment.Grain)
		fromIndex := len(args) + 1
		args = append(args, segment.From.UTC())
		toIndex := len(args) + 1
		args = append(args, segment.To.UTC())
		segmentPredicates = append(segmentPredicates, fmt.Sprintf(
			"(grain = $%d and bucket_start >= $%d and bucket_start < $%d)",
			grainIndex,
			fromIndex,
			toIndex,
		))
	}
	where = append(where, "("+strings.Join(segmentPredicates, " or ")+")")
	addOptional := func(column string, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s = $%d", column, len(args)))
	}
	addOptional("project_id", filter.ProjectID)
	addOptional("application_id", filter.ApplicationID)
	addOptional("budget_scope_type", filter.BudgetScope.Type)
	addOptional("budget_scope_id", filter.BudgetScope.ID)
	addOptional("budget_scope_resolved_by", filter.BudgetScope.ResolvedBy)
	return strings.Join(where, " and "), args
}

func buildCostReportRawRangeTotalsQuery(
	filter invocationlog.CostReportFilter,
	ranges []dashboardTimeRange,
) (string, []any) {
	where, args := buildCostReportRawRangeWhere(filter, ranges)
	return fmt.Sprintf(`select
  %s as period_start,
  coalesce(project_id::text, '') as project_id,
  coalesce(application_id::text, '') as application_id,
  coalesce(%s, '') as budget_scope_type,
  coalesce(%s, '') as budget_scope_id,
  coalesce(%s, '') as budget_scope_resolved_by,
  count(*)::bigint as request_count,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd,
  max(created_at) as last_log_created_at
from p0_llm_invocation_logs
where %s
group by 1, 2, 3, 4, 5, 6
order by 1`,
		costReportBucketExpression(filter),
		budgetScopeTypeSQL,
		budgetScopeIDSQL,
		budgetScopeResolvedBySQL,
		where,
	), args
}

func buildCostReportRawRangeModelQuery(
	filter invocationlog.CostReportFilter,
	ranges []dashboardTimeRange,
) (string, []any) {
	where, args := buildCostReportRawRangeWhere(filter, ranges)
	return fmt.Sprintf(`with cost_report_raw_models as (
  select
	%s as period_start,
    nullif(provider, '') as provider,
    nullif(model, '') as model,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cost_micro_usd,
    saved_cost_micro_usd
  from p0_llm_invocation_logs
  where %s
)
select
	period_start,
  provider,
  model,
  count(*)::bigint as request_count,
  coalesce(sum(prompt_tokens), 0)::bigint as prompt_tokens,
  coalesce(sum(completion_tokens), 0)::bigint as completion_tokens,
  coalesce(sum(total_tokens), 0)::bigint as total_tokens,
  coalesce(sum(cost_micro_usd), 0)::bigint as cost_micro_usd,
  coalesce(sum(saved_cost_micro_usd), 0)::bigint as saved_cost_micro_usd
from cost_report_raw_models
where provider is not null and model is not null
group by 1, 2, 3`, costReportBucketExpression(filter), where), args
}

func buildCostReportRawRangeWhere(
	filter invocationlog.CostReportFilter,
	ranges []dashboardTimeRange,
) (string, []any) {
	where := []string{}
	args := []any{}
	addUUIDWhere(&where, &args, "tenant_id", filter.TenantID)
	addUUIDWhere(&where, &args, "project_id", filter.ProjectID)
	addUUIDWhere(&where, &args, "application_id", filter.ApplicationID)

	rangePredicates := make([]string, 0, len(ranges))
	for _, item := range ranges {
		fromIndex := len(args) + 1
		args = append(args, item.From.UTC())
		toIndex := len(args) + 1
		args = append(args, item.To.UTC())
		rangePredicates = append(rangePredicates, fmt.Sprintf(
			"(created_at >= $%d and created_at < $%d)",
			fromIndex,
			toIndex,
		))
	}
	where = append(where, "("+strings.Join(rangePredicates, " or ")+")")

	addOptional := func(expression string, value string) {
		if strings.TrimSpace(value) == "" {
			return
		}
		args = append(args, value)
		where = append(where, fmt.Sprintf("%s = $%d", expression, len(args)))
	}
	addOptional("provider", filter.Provider)
	addOptional("model", filter.Model)
	addOptional(budgetScopeTypeSQL, filter.BudgetScope.Type)
	addOptional(budgetScopeIDSQL, filter.BudgetScope.ID)
	addOptional(budgetScopeResolvedBySQL, filter.BudgetScope.ResolvedBy)
	return strings.Join(where, " and "), args
}

func costReportOutputBucketStart(filter invocationlog.CostReportFilter, value time.Time) time.Time {
	value = value.UTC()
	switch filter.Period {
	case "week":
		dayStart := time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
		daysSinceMonday := (int(dayStart.Weekday()) + 6) % 7
		return dayStart.AddDate(0, 0, -daysSinceMonday)
	case "month":
		return time.Date(value.Year(), value.Month(), 1, 0, 0, 0, 0, time.UTC)
	default:
		return invocationlog.AlignTimeSeriesBucketStart(value, costReportBucketConfig(filter))
	}
}
