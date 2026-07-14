package postgres

import (
	"context"
	"sort"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func (r *QueryReader) tryGetCostReportFromRollups(
	ctx context.Context,
	filter invocationlog.CostReportFilter,
	now time.Time,
) (invocationlog.CostReportFields, bool, error) {
	plan, ok := buildCostReportRollupPlan(filter, now)
	if !ok {
		return invocationlog.CostReportFields{}, false, nil
	}

	coverageFilter := invocationlog.DashboardOverviewFilter{
		TenantID:    filter.TenantID,
		ProjectID:   filter.ProjectID,
		BudgetScope: filter.BudgetScope,
		From:        filter.From,
		To:          filter.To,
	}
	var lastAggregatedAt *time.Time
	for _, segment := range plan.Segments {
		coverage, err := r.getDashboardRollupCoverage(ctx, coverageFilter, segment)
		if err != nil {
			return invocationlog.CostReportFields{}, false, err
		}
		if !coverage.Complete() {
			return invocationlog.CostReportFields{}, false, nil
		}
		if coverage.LastAggregatedAt != nil &&
			(lastAggregatedAt == nil || coverage.LastAggregatedAt.Before(*lastAggregatedAt)) {
			value := coverage.LastAggregatedAt.UTC()
			lastAggregatedAt = &value
		}
	}

	aggregate := newCostReportAggregate()
	if err := r.addCostReportRollupRows(ctx, filter, plan.Segments, &aggregate); err != nil {
		return invocationlog.CostReportFields{}, false, err
	}
	if err := r.addCostReportRawRangeRows(ctx, filter, plan.RawRanges, &aggregate); err != nil {
		return invocationlog.CostReportFields{}, false, err
	}

	source := "postgresql_rollup"
	if len(plan.RawRanges) > 0 {
		source = "postgresql_hybrid"
	}
	return buildCostReportFromAggregate(filter, aggregate, now, source, lastAggregatedAt), true, nil
}

func buildCostReportFromAggregate(
	filter invocationlog.CostReportFilter,
	aggregate costReportAggregate,
	generatedAt time.Time,
	source string,
	lastAggregatedAt *time.Time,
) invocationlog.CostReportFields {
	buckets := make([]invocationlog.CostReportBucket, 0, len(aggregate.Buckets))
	for _, bucket := range aggregate.Buckets {
		bucket.PeriodStart = bucket.PeriodStart.UTC()
		bucket.PeriodEnd = costReportBucketEnd(bucket.PeriodStart, filter.Period)
		bucket.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(bucket.CostMicroUSD)
		bucket.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(bucket.SavedCostMicroUSD)
		buckets = append(buckets, bucket)
	}
	sort.Slice(buckets, func(i int, j int) bool {
		return buckets[i].PeriodStart.Before(buckets[j].PeriodStart)
	})
	buckets = fillCostReportBuckets(filter, buckets)

	totals := invocationlog.CostReportTotals{}
	for _, bucket := range buckets {
		totals.RequestCount += bucket.RequestCount
		totals.PromptTokens += bucket.PromptTokens
		totals.CompletionTokens += bucket.CompletionTokens
		totals.TotalTokens += bucket.TotalTokens
		totals.CostMicroUSD += bucket.CostMicroUSD
		totals.SavedCostMicroUSD += bucket.SavedCostMicroUSD
	}
	totals.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(totals.CostMicroUSD)
	totals.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(totals.SavedCostMicroUSD)

	generatedAt = generatedAt.UTC()
	aggregatedAt := generatedAt
	if lastAggregatedAt != nil {
		aggregatedAt = lastAggregatedAt.UTC()
	}
	bucketConfig := costReportBucketConfig(filter)
	return invocationlog.CostReportFields{
		Period:              filter.Period,
		BucketInterval:      bucketConfig.IntervalLabel,
		ExpectedBucketCount: bucketConfig.ExpectedBucketCount,
		Totals:              totals,
		Buckets:             buckets,
		Breakdowns: invocationlog.CostReportBreakdowns{
			ByProject:     finalizedCostReportProjects(aggregate.Projects),
			ByApplication: finalizedCostReportApplications(aggregate.Applications),
			ByModel:       finalizedCostReportModels(aggregate.Models),
			ByBudgetScope: finalizedCostReportBudgetScopes(aggregate.BudgetScopes),
		},
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           source,
			RecordCount:      totals.RequestCount,
			LastLogCreatedAt: aggregate.LastSourceAt,
			GeneratedAt:      generatedAt,
			LastAggregatedAt: aggregatedAt,
			IsStale:          false,
		},
	}
}

func finalizedCostReportProjects(
	items map[string]invocationlog.CostReportProjectBreakdown,
) []invocationlog.CostReportProjectBreakdown {
	result := make([]invocationlog.CostReportProjectBreakdown, 0, len(items))
	for _, item := range items {
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		result = append(result, item)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].CostMicroUSD != result[j].CostMicroUSD {
			return result[i].CostMicroUSD > result[j].CostMicroUSD
		}
		return result[i].ProjectID < result[j].ProjectID
	})
	return limitCostReportItems(result)
}

func finalizedCostReportApplications(
	items map[string]invocationlog.CostReportApplicationBreakdown,
) []invocationlog.CostReportApplicationBreakdown {
	result := make([]invocationlog.CostReportApplicationBreakdown, 0, len(items))
	for _, item := range items {
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		result = append(result, item)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].CostMicroUSD != result[j].CostMicroUSD {
			return result[i].CostMicroUSD > result[j].CostMicroUSD
		}
		return result[i].ApplicationID < result[j].ApplicationID
	})
	return limitCostReportItems(result)
}

func finalizedCostReportModels(
	items map[string]invocationlog.CostReportModelBreakdown,
) []invocationlog.CostReportModelBreakdown {
	result := make([]invocationlog.CostReportModelBreakdown, 0, len(items))
	for _, item := range items {
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		result = append(result, item)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].CostMicroUSD != result[j].CostMicroUSD {
			return result[i].CostMicroUSD > result[j].CostMicroUSD
		}
		if result[i].Provider != result[j].Provider {
			return result[i].Provider < result[j].Provider
		}
		return result[i].Model < result[j].Model
	})
	return limitCostReportItems(result)
}

func finalizedCostReportBudgetScopes(
	items map[string]invocationlog.CostReportBudgetScopeBreakdown,
) []invocationlog.CostReportBudgetScopeBreakdown {
	result := make([]invocationlog.CostReportBudgetScopeBreakdown, 0, len(items))
	for _, item := range items {
		item.CostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.CostMicroUSD)
		item.SavedCostUSD = invocationlog.FormatCostUSDFromMicroUSD(item.SavedCostMicroUSD)
		result = append(result, item)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].CostMicroUSD != result[j].CostMicroUSD {
			return result[i].CostMicroUSD > result[j].CostMicroUSD
		}
		first := result[i].BudgetScope
		second := result[j].BudgetScope
		if first.Type != second.Type {
			return first.Type < second.Type
		}
		if first.ID != second.ID {
			return first.ID < second.ID
		}
		return first.ResolvedBy < second.ResolvedBy
	})
	return limitCostReportItems(result)
}

func limitCostReportItems[T any](items []T) []T {
	if len(items) > 100 {
		return items[:100]
	}
	return items
}
