package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type dashboardRollupSnapshot struct {
	Aggregate invocationlog.DashboardOverviewAggregate

	LatencyCount                int64
	LatencySumMs                int64
	LatencyHistogram            []int64
	GatewayInternalLatencyCount int64
	GatewayInternalLatencySumMs int64
	GatewayInternalHistogram    []int64
	ProviderLatencyCount        int64
	ProviderLatencySumMs        int64
	ProviderLatencyHistogram    []int64
	TTFTCount                   int64
	TTFTSumMs                   int64
	TTFTHistogram               []int64
}

type dashboardRollupTotalRow struct {
	ProjectID             string
	ApplicationID         string
	BudgetScopeType       string
	BudgetScopeID         string
	BudgetScopeResolvedBy string

	RequestCount                int64
	SuccessfulRequestCount      int64
	FailedRequestCount          int64
	BlockedRequestCount         int64
	RateLimitedRequestCount     int64
	CancelledRequestCount       int64
	CacheHitRequestCount        int64
	CacheEligibleRequestCount   int64
	FallbackSuccessRequestCount int64
	PromptTokens                int64
	CompletionTokens            int64
	TotalTokens                 int64
	CostMicroUSD                int64
	SavedCostMicroUSD           int64

	LatencyCount                    int64
	LatencySumMs                    int64
	LatencyHistogram                []int64
	GatewayInternalLatencyCount     int64
	GatewayInternalLatencySumMs     int64
	GatewayInternalLatencyHistogram []int64
	ProviderLatencyCount            int64
	ProviderLatencySumMs            int64
	ProviderLatencyHistogram        []int64
	StreamRequestCount              int64
	TTFTCount                       int64
	TTFTSumMs                       int64
	TTFTHistogram                   []int64
	HistogramVersion                int
	SourceMaxAt                     *time.Time
}

type dashboardProjectRollup struct {
	ProjectID        string
	RequestCount     int64
	PromptTokens     int64
	CompletionTokens int64
	TotalTokens      int64
	CostMicroUSD     int64
}

type dashboardApplicationRollup struct {
	ApplicationID string
	RequestCount  int64
	CostMicroUSD  int64
}

type dashboardBudgetRollup struct {
	Scope        budget.Scope
	RequestCount int64
	CostMicroUSD int64
}

type dashboardModelRollup struct {
	Provider     string
	Model        string
	RequestCount int64
	TotalTokens  int64
	CostMicroUSD int64
}

type dashboardRoutingRollup struct {
	Category      string
	Difficulty    string
	RoutingReason string
	RequestCount  int64
}

func (r *QueryReader) getDashboardRollupSnapshot(
	ctx context.Context,
	filter invocationlog.DashboardOverviewFilter,
	plan dashboardRollupPlan,
) (dashboardRollupSnapshot, error) {
	if r == nil || r.db == nil {
		return dashboardRollupSnapshot{}, errors.New("query reader requires a database queryer")
	}
	if len(plan.Segments) == 0 {
		return dashboardRollupSnapshot{}, errors.New("dashboard rollup plan requires at least one segment")
	}

	snapshot := newDashboardRollupSnapshot()
	projectRows := map[string]*dashboardProjectRollup{}
	applicationRows := map[string]*dashboardApplicationRollup{}
	budgetRows := map[string]*dashboardBudgetRollup{}
	modelRows := map[string]*dashboardModelRollup{}
	routingRows := map[string]*dashboardRoutingRollup{}

	totalsQuery, totalsArgs := buildDashboardRollupTotalsQuery(filter, plan.Segments)
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

	dimensionsQuery, dimensionsArgs := buildDashboardRollupDimensionsQuery(filter, plan.Segments)
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

func newDashboardRollupSnapshot() dashboardRollupSnapshot {
	histogramSize := len(dashboardHistogramUpperBoundsMs)
	return dashboardRollupSnapshot{
		Aggregate: invocationlog.DashboardOverviewAggregate{
			StatusCounts:          map[string]int64{},
			MaskingActionCounts:   map[string]int64{},
			SafetyOutcomeCounts:   map[string]int64{},
			CacheOutcomeCounts:    map[string]int64{},
			FallbackOutcomeCounts: map[string]int64{},
			BudgetOutcomeCounts:   map[string]int64{},
		},
		LatencyHistogram:         make([]int64, histogramSize),
		GatewayInternalHistogram: make([]int64, histogramSize),
		ProviderLatencyHistogram: make([]int64, histogramSize),
		TTFTHistogram:            make([]int64, histogramSize),
	}
}

func scanDashboardRollupTotal(row Row) (dashboardRollupTotalRow, error) {
	var result dashboardRollupTotalRow
	var sourceMaxAt sql.NullTime
	if err := row.Scan(
		&result.ProjectID,
		&result.ApplicationID,
		&result.BudgetScopeType,
		&result.BudgetScopeID,
		&result.BudgetScopeResolvedBy,
		&result.RequestCount,
		&result.SuccessfulRequestCount,
		&result.FailedRequestCount,
		&result.BlockedRequestCount,
		&result.RateLimitedRequestCount,
		&result.CancelledRequestCount,
		&result.CacheHitRequestCount,
		&result.CacheEligibleRequestCount,
		&result.FallbackSuccessRequestCount,
		&result.PromptTokens,
		&result.CompletionTokens,
		&result.TotalTokens,
		&result.CostMicroUSD,
		&result.SavedCostMicroUSD,
		&result.LatencyCount,
		&result.LatencySumMs,
		&result.LatencyHistogram,
		&result.GatewayInternalLatencyCount,
		&result.GatewayInternalLatencySumMs,
		&result.GatewayInternalLatencyHistogram,
		&result.ProviderLatencyCount,
		&result.ProviderLatencySumMs,
		&result.ProviderLatencyHistogram,
		&result.StreamRequestCount,
		&result.TTFTCount,
		&result.TTFTSumMs,
		&result.TTFTHistogram,
		&result.HistogramVersion,
		&sourceMaxAt,
	); err != nil {
		return dashboardRollupTotalRow{}, err
	}
	if sourceMaxAt.Valid {
		value := sourceMaxAt.Time.UTC()
		result.SourceMaxAt = &value
	}
	return result, nil
}

func mergeDashboardRollupTotal(
	snapshot *dashboardRollupSnapshot,
	row dashboardRollupTotalRow,
	projectRows map[string]*dashboardProjectRollup,
	applicationRows map[string]*dashboardApplicationRollup,
	budgetRows map[string]*dashboardBudgetRollup,
) error {
	if row.HistogramVersion != dashboardHistogramVersion {
		return fmt.Errorf("unsupported dashboard histogram version %d", row.HistogramVersion)
	}
	if !addDashboardHistograms(snapshot.LatencyHistogram, row.LatencyHistogram) ||
		!addDashboardHistograms(snapshot.GatewayInternalHistogram, row.GatewayInternalLatencyHistogram) ||
		!addDashboardHistograms(snapshot.ProviderLatencyHistogram, row.ProviderLatencyHistogram) ||
		!addDashboardHistograms(snapshot.TTFTHistogram, row.TTFTHistogram) {
		return errors.New("dashboard rollup histogram is invalid")
	}

	aggregate := &snapshot.Aggregate
	aggregate.TotalRequests += row.RequestCount
	aggregate.SuccessfulRequests += row.SuccessfulRequestCount
	aggregate.FailedRequests += row.FailedRequestCount
	aggregate.BlockedRequests += row.BlockedRequestCount
	aggregate.RateLimitedRequests += row.RateLimitedRequestCount
	aggregate.CancelledRequests += row.CancelledRequestCount
	aggregate.CacheHitRequests += row.CacheHitRequestCount
	aggregate.CacheEligibleRequests += row.CacheEligibleRequestCount
	aggregate.FallbackSuccessCount += row.FallbackSuccessRequestCount
	aggregate.PromptTokens += row.PromptTokens
	aggregate.CompletionTokens += row.CompletionTokens
	aggregate.TotalTokens += row.TotalTokens
	aggregate.TotalCostMicroUSD += row.CostMicroUSD
	aggregate.SavedCostMicroUSD += row.SavedCostMicroUSD
	aggregate.EligibleStreamRequests += row.StreamRequestCount
	aggregate.ObservedTTFTRequests += row.TTFTCount

	snapshot.LatencyCount += row.LatencyCount
	snapshot.LatencySumMs += row.LatencySumMs
	snapshot.GatewayInternalLatencyCount += row.GatewayInternalLatencyCount
	snapshot.GatewayInternalLatencySumMs += row.GatewayInternalLatencySumMs
	snapshot.ProviderLatencyCount += row.ProviderLatencyCount
	snapshot.ProviderLatencySumMs += row.ProviderLatencySumMs
	snapshot.TTFTCount += row.TTFTCount
	snapshot.TTFTSumMs += row.TTFTSumMs
	if row.SourceMaxAt != nil && (aggregate.LastLogCreatedAt == nil || row.SourceMaxAt.After(*aggregate.LastLogCreatedAt)) {
		value := *row.SourceMaxAt
		aggregate.LastLogCreatedAt = &value
	}

	if row.ProjectID != "" {
		item := projectRows[row.ProjectID]
		if item == nil {
			item = &dashboardProjectRollup{ProjectID: row.ProjectID}
			projectRows[row.ProjectID] = item
		}
		item.RequestCount += row.RequestCount
		item.PromptTokens += row.PromptTokens
		item.CompletionTokens += row.CompletionTokens
		item.TotalTokens += row.TotalTokens
		item.CostMicroUSD += row.CostMicroUSD
	}
	if row.ApplicationID != "" {
		item := applicationRows[row.ApplicationID]
		if item == nil {
			item = &dashboardApplicationRollup{ApplicationID: row.ApplicationID}
			applicationRows[row.ApplicationID] = item
		}
		item.RequestCount += row.RequestCount
		item.CostMicroUSD += row.CostMicroUSD
	}
	if row.BudgetScopeID != "" {
		key := strings.Join([]string{row.BudgetScopeType, row.BudgetScopeID, row.BudgetScopeResolvedBy}, "\x00")
		item := budgetRows[key]
		if item == nil {
			item = &dashboardBudgetRollup{Scope: budget.Scope{
				Type:       row.BudgetScopeType,
				ID:         row.BudgetScopeID,
				ResolvedBy: row.BudgetScopeResolvedBy,
			}}
			budgetRows[key] = item
		}
		item.RequestCount += row.RequestCount
		item.CostMicroUSD += row.CostMicroUSD
	}
	return nil
}

func mergeDashboardRollupDimension(
	aggregate *invocationlog.DashboardOverviewAggregate,
	dimensionType string,
	value string,
	value2 string,
	value3 string,
	requestCount int64,
	totalTokens int64,
	costMicroUSD int64,
	modelRows map[string]*dashboardModelRollup,
	routingRows map[string]*dashboardRoutingRollup,
) {
	switch dimensionType {
	case "terminal_status":
		aggregate.StatusCounts[value] += requestCount
	case "masking_action":
		aggregate.MaskingActionCounts[value] += requestCount
	case "safety_outcome":
		aggregate.SafetyOutcomeCounts[value] += requestCount
	case "cache_outcome":
		aggregate.CacheOutcomeCounts[value] += requestCount
	case "fallback_outcome":
		aggregate.FallbackOutcomeCounts[value] += requestCount
	case "budget_outcome":
		aggregate.BudgetOutcomeCounts[value] += requestCount
	case "provider_model":
		key := value + "\x00" + value2
		item := modelRows[key]
		if item == nil {
			item = &dashboardModelRollup{Provider: value, Model: value2}
			modelRows[key] = item
		}
		item.RequestCount += requestCount
		item.TotalTokens += totalTokens
		item.CostMicroUSD += costMicroUSD
	case "routing":
		key := strings.Join([]string{value, value2, value3}, "\x00")
		item := routingRows[key]
		if item == nil {
			item = &dashboardRoutingRollup{Category: value, Difficulty: value2, RoutingReason: value3}
			routingRows[key] = item
		}
		item.RequestCount += requestCount
	}
}

func finalizeDashboardRollupSnapshot(
	snapshot *dashboardRollupSnapshot,
	projectRows map[string]*dashboardProjectRollup,
	applicationRows map[string]*dashboardApplicationRollup,
	budgetRows map[string]*dashboardBudgetRollup,
	modelRows map[string]*dashboardModelRollup,
	routingRows map[string]*dashboardRoutingRollup,
) {
	aggregate := &snapshot.Aggregate
	if snapshot.LatencyCount > 0 {
		average := float64(snapshot.LatencySumMs) / float64(snapshot.LatencyCount)
		aggregate.AverageLatencyMs = &average
		aggregate.P95LatencyMs = dashboardHistogramPercentile(snapshot.LatencyHistogram, 0.95)
	}
	if snapshot.GatewayInternalLatencyCount > 0 {
		aggregate.P95GatewayInternalLatencyMs = dashboardHistogramPercentile(snapshot.GatewayInternalHistogram, 0.95)
		aggregate.P99GatewayInternalLatencyMs = dashboardHistogramPercentile(snapshot.GatewayInternalHistogram, 0.99)
	}
	if snapshot.ProviderLatencyCount > 0 {
		aggregate.P95ProviderLatencyMs = dashboardHistogramPercentile(snapshot.ProviderLatencyHistogram, 0.95)
		aggregate.P99ProviderLatencyMs = dashboardHistogramPercentile(snapshot.ProviderLatencyHistogram, 0.99)
	}
	if snapshot.TTFTCount > 0 {
		average := float64(snapshot.TTFTSumMs) / float64(snapshot.TTFTCount)
		aggregate.AverageTTFTMs = &average
		aggregate.P50TTFTMs = dashboardHistogramPercentile(snapshot.TTFTHistogram, 0.50)
		aggregate.P95TTFTMs = dashboardHistogramPercentile(snapshot.TTFTHistogram, 0.95)
		aggregate.P99TTFTMs = dashboardHistogramPercentile(snapshot.TTFTHistogram, 0.99)
	}

	for _, row := range projectRows {
		aggregate.ProjectBreakdown = append(aggregate.ProjectBreakdown, invocationlog.ProjectBreakdown{
			ProjectID:        row.ProjectID,
			RequestCount:     row.RequestCount,
			PromptTokens:     row.PromptTokens,
			CompletionTokens: row.CompletionTokens,
			TotalTokens:      row.TotalTokens,
			CostMicroUSD:     row.CostMicroUSD,
		})
	}
	for _, row := range applicationRows {
		aggregate.ApplicationBreakdown = append(aggregate.ApplicationBreakdown, invocationlog.ApplicationBreakdown{
			ApplicationID: row.ApplicationID,
			RequestCount:  row.RequestCount,
			CostMicroUSD:  row.CostMicroUSD,
		})
	}
	for _, row := range budgetRows {
		aggregate.BudgetScopeBreakdown = append(aggregate.BudgetScopeBreakdown, invocationlog.BudgetScopeBreakdown{
			BudgetScope:  row.Scope,
			RequestCount: row.RequestCount,
			CostMicroUSD: row.CostMicroUSD,
		})
	}
	for _, row := range modelRows {
		aggregate.CostByModel = append(aggregate.CostByModel, invocationlog.CostByModel{
			Provider:     row.Provider,
			Model:        row.Model,
			RequestCount: row.RequestCount,
			TotalTokens:  row.TotalTokens,
			CostMicroUSD: row.CostMicroUSD,
		})
	}
	for _, row := range routingRows {
		aggregate.RoutingCountByModel = append(aggregate.RoutingCountByModel, invocationlog.RoutingCountByModel{
			Category:      row.Category,
			Difficulty:    row.Difficulty,
			RoutingReason: row.RoutingReason,
			RequestCount:  row.RequestCount,
		})
	}
}

func buildDashboardRollupTotalsQuery(
	filter invocationlog.DashboardOverviewFilter,
	segments []dashboardRollupSegment,
) (string, []any) {
	where, args := buildDashboardRollupWhere(filter, segments)
	return `select
  project_id,
  application_id,
  budget_scope_type,
  budget_scope_id,
  budget_scope_resolved_by,
  request_count,
  successful_request_count,
  failed_request_count,
  blocked_request_count,
  rate_limited_request_count,
  cancelled_request_count,
  cache_hit_request_count,
  cache_eligible_request_count,
  fallback_success_request_count,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  cost_micro_usd,
  saved_cost_micro_usd,
  latency_count,
  latency_sum_ms,
  latency_histogram,
  gateway_internal_latency_count,
  gateway_internal_latency_sum_ms,
  gateway_internal_latency_histogram,
  provider_latency_count,
  provider_latency_sum_ms,
  provider_latency_histogram,
  stream_request_count,
  ttft_count,
  ttft_sum_ms,
  ttft_histogram,
  histogram_version,
  source_max_at
from dashboard_rollup_totals
where ` + where, args
}

func buildDashboardRollupDimensionsQuery(
	filter invocationlog.DashboardOverviewFilter,
	segments []dashboardRollupSegment,
) (string, []any) {
	where, args := buildDashboardRollupWhere(filter, segments)
	return `select
  dimension_type,
  dimension_value,
  dimension_value_2,
  dimension_value_3,
  request_count,
  total_tokens,
  cost_micro_usd
from dashboard_rollup_dimensions
where ` + where, args
}

func buildDashboardRollupWhere(
	filter invocationlog.DashboardOverviewFilter,
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
	if filter.ProjectID != "" {
		args = append(args, filter.ProjectID)
		where = append(where, fmt.Sprintf("project_id = $%d", len(args)))
	}
	if filter.BudgetScope.Type != "" {
		args = append(args, filter.BudgetScope.Type)
		where = append(where, fmt.Sprintf("budget_scope_type = $%d", len(args)))
	}
	if filter.BudgetScope.ID != "" {
		args = append(args, filter.BudgetScope.ID)
		where = append(where, fmt.Sprintf("budget_scope_id = $%d", len(args)))
	}
	if filter.BudgetScope.ResolvedBy != "" {
		args = append(args, filter.BudgetScope.ResolvedBy)
		where = append(where, fmt.Sprintf("budget_scope_resolved_by = $%d", len(args)))
	}
	return strings.Join(where, " and "), args
}
