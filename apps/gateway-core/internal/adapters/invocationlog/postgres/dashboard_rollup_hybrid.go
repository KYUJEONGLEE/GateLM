package postgres

import (
	"context"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func (r *QueryReader) tryGetDashboardOverviewFromRollups(
	ctx context.Context,
	filter invocationlog.DashboardOverviewFilter,
	now time.Time,
) (invocationlog.DashboardOverviewFields, bool, error) {
	plan, ok := buildDashboardRollupPlan(filter, now)
	if !ok {
		return invocationlog.DashboardOverviewFields{}, false, nil
	}

	var lastAggregatedAt *time.Time
	for _, segment := range plan.Segments {
		coverage, err := r.getDashboardRollupCoverage(ctx, filter, segment)
		if err != nil {
			return invocationlog.DashboardOverviewFields{}, false, err
		}
		if !coverage.Complete() {
			return invocationlog.DashboardOverviewFields{}, false, nil
		}
		if coverage.LastAggregatedAt != nil && (lastAggregatedAt == nil || coverage.LastAggregatedAt.Before(*lastAggregatedAt)) {
			value := *coverage.LastAggregatedAt
			lastAggregatedAt = &value
		}
	}

	rollupSnapshot, err := r.getDashboardRollupSnapshot(ctx, filter, plan)
	if err != nil {
		return invocationlog.DashboardOverviewFields{}, false, err
	}
	combined := rollupSnapshot
	if len(plan.RawRanges) > 0 {
		rawSnapshot, err := r.getDashboardRawRangesSnapshot(ctx, filter, plan.RawRanges)
		if err != nil {
			return invocationlog.DashboardOverviewFields{}, false, err
		}
		combined = mergeDashboardRollupSnapshots(rollupSnapshot, rawSnapshot)
	}

	combined.Aggregate.GeneratedAt = now.UTC()
	overview := invocationlog.BuildDashboardOverviewFromAggregate(combined.Aggregate)
	if len(plan.RawRanges) > 0 {
		overview.DataFreshness.Source = "postgresql_hybrid"
	} else {
		overview.DataFreshness.Source = "postgresql_rollup"
	}
	if lastAggregatedAt != nil {
		overview.DataFreshness.LastAggregatedAt = *lastAggregatedAt
	}
	overview.QueryBudget.Status = "ok"
	overview.QueryBudget.MaxRangeHours = 24 * 31
	overview.QueryBudget.MaxBreakdownItems = 50
	return overview, true, nil
}

func mergeDashboardRollupSnapshots(
	first dashboardRollupSnapshot,
	second dashboardRollupSnapshot,
) dashboardRollupSnapshot {
	merged := newDashboardRollupSnapshot()
	mergeDashboardSnapshotInto(&merged, first)
	mergeDashboardSnapshotInto(&merged, second)
	finalizeMergedDashboardSnapshot(&merged)
	return merged
}

func mergeDashboardSnapshotInto(target *dashboardRollupSnapshot, source dashboardRollupSnapshot) {
	if target == nil {
		return
	}
	target.LatencyCount += source.LatencyCount
	target.LatencySumMs += source.LatencySumMs
	target.GatewayInternalLatencyCount += source.GatewayInternalLatencyCount
	target.GatewayInternalLatencySumMs += source.GatewayInternalLatencySumMs
	target.ProviderLatencyCount += source.ProviderLatencyCount
	target.ProviderLatencySumMs += source.ProviderLatencySumMs
	target.TTFTCount += source.TTFTCount
	target.TTFTSumMs += source.TTFTSumMs
	addDashboardHistograms(target.LatencyHistogram, source.LatencyHistogram)
	addDashboardHistograms(target.GatewayInternalHistogram, source.GatewayInternalHistogram)
	addDashboardHistograms(target.ProviderLatencyHistogram, source.ProviderLatencyHistogram)
	addDashboardHistograms(target.TTFTHistogram, source.TTFTHistogram)

	targetAggregate := &target.Aggregate
	sourceAggregate := source.Aggregate
	targetAggregate.TotalRequests += sourceAggregate.TotalRequests
	targetAggregate.SuccessfulRequests += sourceAggregate.SuccessfulRequests
	targetAggregate.FailedRequests += sourceAggregate.FailedRequests
	targetAggregate.BlockedRequests += sourceAggregate.BlockedRequests
	targetAggregate.RateLimitedRequests += sourceAggregate.RateLimitedRequests
	targetAggregate.CancelledRequests += sourceAggregate.CancelledRequests
	targetAggregate.CacheHitRequests += sourceAggregate.CacheHitRequests
	targetAggregate.CacheEligibleRequests += sourceAggregate.CacheEligibleRequests
	targetAggregate.FallbackSuccessCount += sourceAggregate.FallbackSuccessCount
	targetAggregate.PromptTokens += sourceAggregate.PromptTokens
	targetAggregate.CompletionTokens += sourceAggregate.CompletionTokens
	targetAggregate.TotalTokens += sourceAggregate.TotalTokens
	targetAggregate.TotalCostMicroUSD += sourceAggregate.TotalCostMicroUSD
	targetAggregate.SavedCostMicroUSD += sourceAggregate.SavedCostMicroUSD
	targetAggregate.EligibleStreamRequests += sourceAggregate.EligibleStreamRequests
	targetAggregate.ObservedTTFTRequests += sourceAggregate.ObservedTTFTRequests
	mergeDashboardCountMap(targetAggregate.StatusCounts, sourceAggregate.StatusCounts)
	mergeDashboardCountMap(targetAggregate.MaskingActionCounts, sourceAggregate.MaskingActionCounts)
	mergeDashboardCountMap(targetAggregate.SafetyOutcomeCounts, sourceAggregate.SafetyOutcomeCounts)
	mergeDashboardCountMap(targetAggregate.CacheOutcomeCounts, sourceAggregate.CacheOutcomeCounts)
	mergeDashboardCountMap(targetAggregate.FallbackOutcomeCounts, sourceAggregate.FallbackOutcomeCounts)
	mergeDashboardCountMap(targetAggregate.BudgetOutcomeCounts, sourceAggregate.BudgetOutcomeCounts)
	targetAggregate.ProjectBreakdown = mergeProjectBreakdowns(targetAggregate.ProjectBreakdown, sourceAggregate.ProjectBreakdown)
	targetAggregate.ApplicationBreakdown = mergeApplicationBreakdowns(targetAggregate.ApplicationBreakdown, sourceAggregate.ApplicationBreakdown)
	targetAggregate.BudgetScopeBreakdown = mergeBudgetScopeBreakdowns(targetAggregate.BudgetScopeBreakdown, sourceAggregate.BudgetScopeBreakdown)
	targetAggregate.CostByModel = mergeModelBreakdowns(targetAggregate.CostByModel, sourceAggregate.CostByModel)
	targetAggregate.RoutingCountByModel = mergeRoutingBreakdowns(targetAggregate.RoutingCountByModel, sourceAggregate.RoutingCountByModel)
	if sourceAggregate.LastLogCreatedAt != nil && (targetAggregate.LastLogCreatedAt == nil || sourceAggregate.LastLogCreatedAt.After(*targetAggregate.LastLogCreatedAt)) {
		value := *sourceAggregate.LastLogCreatedAt
		targetAggregate.LastLogCreatedAt = &value
	}
}

func finalizeMergedDashboardSnapshot(snapshot *dashboardRollupSnapshot) {
	if snapshot == nil {
		return
	}
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
}

func mergeDashboardCountMap(target map[string]int64, source map[string]int64) {
	for key, value := range source {
		target[key] += value
	}
}

func mergeProjectBreakdowns(first []invocationlog.ProjectBreakdown, second []invocationlog.ProjectBreakdown) []invocationlog.ProjectBreakdown {
	rows := map[string]invocationlog.ProjectBreakdown{}
	for _, item := range append(append([]invocationlog.ProjectBreakdown{}, first...), second...) {
		row := rows[item.ProjectID]
		row.ProjectID = item.ProjectID
		row.RequestCount += item.RequestCount
		row.PromptTokens += item.PromptTokens
		row.CompletionTokens += item.CompletionTokens
		row.TotalTokens += item.TotalTokens
		row.CostMicroUSD += item.CostMicroUSD
		rows[item.ProjectID] = row
	}
	result := make([]invocationlog.ProjectBreakdown, 0, len(rows))
	for _, row := range rows {
		result = append(result, row)
	}
	return result
}

func mergeApplicationBreakdowns(first []invocationlog.ApplicationBreakdown, second []invocationlog.ApplicationBreakdown) []invocationlog.ApplicationBreakdown {
	rows := map[string]invocationlog.ApplicationBreakdown{}
	for _, item := range append(append([]invocationlog.ApplicationBreakdown{}, first...), second...) {
		row := rows[item.ApplicationID]
		row.ApplicationID = item.ApplicationID
		row.RequestCount += item.RequestCount
		row.CostMicroUSD += item.CostMicroUSD
		rows[item.ApplicationID] = row
	}
	result := make([]invocationlog.ApplicationBreakdown, 0, len(rows))
	for _, row := range rows {
		result = append(result, row)
	}
	return result
}

func mergeBudgetScopeBreakdowns(first []invocationlog.BudgetScopeBreakdown, second []invocationlog.BudgetScopeBreakdown) []invocationlog.BudgetScopeBreakdown {
	rows := map[string]invocationlog.BudgetScopeBreakdown{}
	for _, item := range append(append([]invocationlog.BudgetScopeBreakdown{}, first...), second...) {
		key := strings.Join([]string{item.BudgetScope.Type, item.BudgetScope.ID, item.BudgetScope.ResolvedBy}, "\x00")
		row := rows[key]
		row.BudgetScope = item.BudgetScope
		row.RequestCount += item.RequestCount
		row.CostMicroUSD += item.CostMicroUSD
		rows[key] = row
	}
	result := make([]invocationlog.BudgetScopeBreakdown, 0, len(rows))
	for _, row := range rows {
		result = append(result, row)
	}
	return result
}

func mergeModelBreakdowns(first []invocationlog.CostByModel, second []invocationlog.CostByModel) []invocationlog.CostByModel {
	rows := map[string]invocationlog.CostByModel{}
	for _, item := range append(append([]invocationlog.CostByModel{}, first...), second...) {
		key := item.Provider + "\x00" + item.Model
		row := rows[key]
		row.Provider = item.Provider
		row.Model = item.Model
		row.RequestCount += item.RequestCount
		row.TotalTokens += item.TotalTokens
		row.CostMicroUSD += item.CostMicroUSD
		rows[key] = row
	}
	result := make([]invocationlog.CostByModel, 0, len(rows))
	for _, row := range rows {
		result = append(result, row)
	}
	return result
}

func mergeRoutingBreakdowns(first []invocationlog.RoutingCountByModel, second []invocationlog.RoutingCountByModel) []invocationlog.RoutingCountByModel {
	rows := map[string]invocationlog.RoutingCountByModel{}
	for _, item := range append(append([]invocationlog.RoutingCountByModel{}, first...), second...) {
		key := strings.Join([]string{item.Category, item.Difficulty, item.RoutingReason}, "\x00")
		row := rows[key]
		row.Category = item.Category
		row.Difficulty = item.Difficulty
		row.RoutingReason = item.RoutingReason
		row.RequestCount += item.RequestCount
		rows[key] = row
	}
	result := make([]invocationlog.RoutingCountByModel, 0, len(rows))
	for _, row := range rows {
		result = append(result, row)
	}
	return result
}
