package hybrid

import (
	"context"
	"errors"
	"sort"
	"time"

	"golang.org/x/sync/errgroup"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type AnalyticsPerformanceReader interface {
	GetAnalyticsPerformance(context.Context, invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error)
}

type AnalyticsReader struct {
	invocationlog.Reader
	project AnalyticsPerformanceReader
}

func NewAnalyticsReader(primary invocationlog.Reader, projectPerformance AnalyticsPerformanceReader) (*AnalyticsReader, error) {
	if primary == nil {
		return nil, errors.New("hybrid analytics reader requires a primary reader")
	}
	if projectPerformance == nil {
		return nil, errors.New("hybrid analytics reader requires a project performance reader")
	}
	return &AnalyticsReader{Reader: primary, project: projectPerformance}, nil
}

func (r *AnalyticsReader) ListProjectLogs(ctx context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	reader, ok := r.project.(interface {
		ListProjectLogs(context.Context, invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error)
	})
	if !ok {
		return nil, invocationlog.ErrAnalyticsDataUnavailable
	}
	return reader.ListProjectLogs(ctx, filter)
}

func (r *AnalyticsReader) GetDashboardOverview(ctx context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	reader, ok := r.project.(interface {
		GetDashboardOverview(context.Context, invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error)
	})
	if !ok {
		return invocationlog.DashboardOverviewFields{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	return reader.GetDashboardOverview(ctx, filter)
}

func (r *AnalyticsReader) GetCostReport(ctx context.Context, filter invocationlog.CostReportFilter) (invocationlog.CostReportFields, error) {
	reader, ok := r.project.(interface {
		GetCostReport(context.Context, invocationlog.CostReportFilter) (invocationlog.CostReportFields, error)
	})
	if !ok {
		return invocationlog.CostReportFields{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	return reader.GetCostReport(ctx, filter)
}

func (r *AnalyticsReader) GetAnalyticsPerformance(ctx context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	normalized, err := invocationlog.NormalizeAnalyticsPerformanceFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsPerformanceFields{}, err
	}

	projectFilter := normalized
	projectFilter.Surface = invocationlog.AnalyticsSurfaceProjectApplication
	projectFilter.IncludeTenantChat = false
	includeTenantChat := normalized.ProjectID == "" || normalized.IncludeTenantChat
	if !includeTenantChat {
		return r.project.GetAnalyticsPerformance(ctx, projectFilter)
	}

	tenantFilter := normalized
	tenantFilter.Surface = invocationlog.AnalyticsSurfaceTenantChat
	tenantFilter.ProjectID = ""
	tenantFilter.IncludeTenantChat = true

	var projectFields invocationlog.AnalyticsPerformanceFields
	var tenantFields invocationlog.AnalyticsPerformanceFields
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var readErr error
		projectFields, readErr = r.project.GetAnalyticsPerformance(groupCtx, projectFilter)
		return readErr
	})
	group.Go(func() error {
		var readErr error
		tenantFields, readErr = r.Reader.GetAnalyticsPerformance(groupCtx, tenantFilter)
		return readErr
	})
	if err := group.Wait(); err != nil {
		return invocationlog.AnalyticsPerformanceFields{}, err
	}
	return mergePerformance(normalized, projectFields, tenantFields), nil
}

func (r *AnalyticsReader) GetAnalyticsReliability(ctx context.Context, filter invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error) {
	normalized, err := invocationlog.NormalizeAnalyticsReliabilityFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsReliabilityFields{}, err
	}
	projectReader, ok := r.project.(interface {
		GetAnalyticsReliability(context.Context, invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error)
	})
	if !ok {
		return invocationlog.AnalyticsReliabilityFields{}, invocationlog.ErrReliabilityDataUnavailable
	}
	if normalized.Surface == invocationlog.AnalyticsReliabilitySurfaceProjectApplication {
		return projectReader.GetAnalyticsReliability(ctx, normalized)
	}
	tenantReader, ok := r.Reader.(interface {
		GetAnalyticsReliability(context.Context, invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error)
	})
	if !ok {
		return invocationlog.AnalyticsReliabilityFields{}, invocationlog.ErrReliabilityDataUnavailable
	}
	if normalized.Surface == invocationlog.AnalyticsReliabilitySurfaceTenantChat {
		return tenantReader.GetAnalyticsReliability(ctx, normalized)
	}
	projectFilter := normalized
	projectFilter.Surface = invocationlog.AnalyticsReliabilitySurfaceProjectApplication
	tenantFilter := normalized
	tenantFilter.Surface = invocationlog.AnalyticsReliabilitySurfaceTenantChat
	tenantFilter.ProjectID = ""
	var projectFields, tenantFields invocationlog.AnalyticsReliabilityFields
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var readErr error
		projectFields, readErr = projectReader.GetAnalyticsReliability(groupCtx, projectFilter)
		return readErr
	})
	group.Go(func() error {
		var readErr error
		tenantFields, readErr = tenantReader.GetAnalyticsReliability(groupCtx, tenantFilter)
		return readErr
	})
	if err := group.Wait(); err != nil {
		return invocationlog.AnalyticsReliabilityFields{}, err
	}
	return mergeReliability(normalized, projectFields, tenantFields), nil
}

func (r *AnalyticsReader) GetAnalyticsPolicyImpact(ctx context.Context, filter invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error) {
	normalized, err := invocationlog.NormalizeAnalyticsPolicyImpactFilter(filter)
	if err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}
	projectReader, ok := r.project.(interface {
		GetAnalyticsPolicyImpact(context.Context, invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error)
	})
	if !ok {
		return invocationlog.AnalyticsPolicyImpactFields{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	projectFilter := normalized
	projectFilter.Surface = invocationlog.AnalyticsSurfaceProjectApplication
	if normalized.ProjectID != "" {
		return projectReader.GetAnalyticsPolicyImpact(ctx, projectFilter)
	}
	tenantReader, ok := r.Reader.(interface {
		GetAnalyticsPolicyImpact(context.Context, invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error)
	})
	if !ok {
		return invocationlog.AnalyticsPolicyImpactFields{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	tenantFilter := normalized
	tenantFilter.ProjectID = ""
	tenantFilter.Surface = invocationlog.AnalyticsSurfaceTenantChat
	var projectFields, tenantFields invocationlog.AnalyticsPolicyImpactFields
	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		var readErr error
		projectFields, readErr = projectReader.GetAnalyticsPolicyImpact(groupCtx, projectFilter)
		return readErr
	})
	group.Go(func() error {
		var readErr error
		tenantFields, readErr = tenantReader.GetAnalyticsPolicyImpact(groupCtx, tenantFilter)
		return readErr
	})
	if err := group.Wait(); err != nil {
		return invocationlog.AnalyticsPolicyImpactFields{}, err
	}
	return mergePolicyImpact(normalized, projectFields, tenantFields), nil
}

func (r *AnalyticsReader) ListProjectLogFilterOptions(ctx context.Context, filter invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error) {
	reader, ok := r.project.(interface {
		ListProjectLogFilterOptions(context.Context, invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error)
	})
	if !ok {
		return invocationlog.RequestLogFilterOptions{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	return reader.ListProjectLogFilterOptions(ctx, filter)
}

func mergeReliability(filter invocationlog.AnalyticsReliabilityFilter, project invocationlog.AnalyticsReliabilityFields, tenant invocationlog.AnalyticsReliabilityFields) invocationlog.AnalyticsReliabilityFields {
	result := project
	result.Scope.Surface = filter.Surface
	result.Scope.ProjectID = nil
	addReliabilityTotals(&result.Totals, tenant.Totals)
	result.Rates = reliabilityRates(result.Totals)
	result.TerminalOutcomes = reliabilityOutcomes(result.Totals)
	result.Continuity = reliabilityContinuity(result.Totals)
	result.SurfaceTotals = append(result.SurfaceTotals, tenant.SurfaceTotals...)
	result.Freshness.Sources = append(result.Freshness.Sources, tenant.Freshness.Sources...)
	result.Freshness.Complete = project.Freshness.Complete && tenant.Freshness.Complete
	if !result.Freshness.Complete {
		result.Freshness.QueryStatus = invocationlog.AnalyticsReliabilityStatusPartial
	}
	result.RecentIncidents = append(result.RecentIncidents, tenant.RecentIncidents...)
	sort.SliceStable(result.RecentIncidents, func(i, j int) bool {
		return result.RecentIncidents[i].OccurredAt.After(result.RecentIncidents[j].OccurredAt)
	})
	if len(result.RecentIncidents) > filter.IncidentLimit {
		result.RecentIncidents = result.RecentIncidents[:filter.IncidentLimit]
	}
	return result
}

func addReliabilityTotals(dst *invocationlog.AnalyticsReliabilityTotals, src invocationlog.AnalyticsReliabilityTotals) {
	dst.RequestCount += src.RequestCount
	dst.SuccessCount += src.SuccessCount
	dst.FailedCount += src.FailedCount
	dst.BlockedCount += src.BlockedCount
	dst.RateLimitedCount += src.RateLimitedCount
	dst.CancelledCount += src.CancelledCount
	dst.UnknownCount += src.UnknownCount
	dst.FallbackRequestCount += src.FallbackRequestCount
	dst.FallbackSuccessCount += src.FallbackSuccessCount
}
func reliabilityRate(n, d int64) *float64 {
	if d <= 0 {
		return nil
	}
	value := float64(n) / float64(d)
	return &value
}
func reliabilityRates(t invocationlog.AnalyticsReliabilityTotals) invocationlog.AnalyticsReliabilityRates {
	return invocationlog.AnalyticsReliabilityRates{SuccessRate: reliabilityRate(t.SuccessCount, t.RequestCount), SystemErrorRate: reliabilityRate(t.FailedCount, t.RequestCount), FallbackRecoveryRate: reliabilityRate(t.FallbackSuccessCount, t.FallbackRequestCount)}
}
func reliabilityOutcomes(t invocationlog.AnalyticsReliabilityTotals) []invocationlog.AnalyticsReliabilityOutcome {
	return []invocationlog.AnalyticsReliabilityOutcome{{Outcome: "success", RequestCount: t.SuccessCount}, {Outcome: "failed", RequestCount: t.FailedCount}, {Outcome: "blocked", RequestCount: t.BlockedCount}, {Outcome: "rate_limited", RequestCount: t.RateLimitedCount}, {Outcome: "cancelled", RequestCount: t.CancelledCount}, {Outcome: "unknown", RequestCount: t.UnknownCount}}
}
func reliabilityContinuity(t invocationlog.AnalyticsReliabilityTotals) invocationlog.AnalyticsReliabilityContinuity {
	without := t.SuccessCount - t.FallbackSuccessCount
	if without < 0 {
		without = 0
	}
	return invocationlog.AnalyticsReliabilityContinuity{SuccessWithoutFallbackCount: without, FallbackRecoveredCount: t.FallbackSuccessCount, FailedCount: t.FailedCount, CancelledCount: t.CancelledCount, ExcludedPolicyCount: t.BlockedCount + t.RateLimitedCount, UnknownCount: t.UnknownCount}
}

func mergePolicyImpact(filter invocationlog.AnalyticsPolicyImpactFilter, project invocationlog.AnalyticsPolicyImpactFields, tenant invocationlog.AnalyticsPolicyImpactFields) invocationlog.AnalyticsPolicyImpactFields {
	result := project
	result.Period = filter.Period
	result.SurfaceTotals = append(result.SurfaceTotals, tenant.SurfaceTotals...)
	result.PolicyOutcomes = append(result.PolicyOutcomes, tenant.PolicyOutcomes...)
	result.RoutingRoles = append(result.RoutingRoles, tenant.RoutingRoles...)
	result.ModelBuckets = append(result.ModelBuckets, tenant.ModelBuckets...)
	result.UsageSources = append(result.UsageSources, tenant.UsageSources...)
	result.MetricCoverage = append(result.MetricCoverage, tenant.MetricCoverage...)
	result.Totals.RequestCount += tenant.Totals.RequestCount
	result.Totals.CostMicroUSD += tenant.Totals.CostMicroUSD
	result.Totals.KnownSavedCostMicroUSD += tenant.Totals.KnownSavedCostMicroUSD
	result.Totals.AvoidedProviderCallRequests += tenant.Totals.AvoidedProviderCallRequests
	result.Totals.ProtectedRequests += tenant.Totals.ProtectedRequests
	result.Totals.HighPerformanceRequests += tenant.Totals.HighPerformanceRequests
	result.Totals.HighPerformanceEligibleRequests += tenant.Totals.HighPerformanceEligibleRequests
	if project.Totals.SavedCostMicroUSD != nil && tenant.Totals.SavedCostMicroUSD != nil {
		value := *project.Totals.SavedCostMicroUSD + *tenant.Totals.SavedCostMicroUSD
		result.Totals.SavedCostMicroUSD = &value
	} else {
		result.Totals.SavedCostMicroUSD = nil
	}
	generatedAt := time.Now().UTC()
	result.DataFreshness = invocationlog.DashboardDataFreshness{
		Source: "clickhouse_project_postgresql_tenant_chat", RecordCount: result.Totals.RequestCount,
		LastLogCreatedAt: latestEvent(project.DataFreshness.LastLogCreatedAt, tenant.DataFreshness.LastLogCreatedAt),
		GeneratedAt:      generatedAt, LastAggregatedAt: generatedAt,
		IsStale: project.DataFreshness.IsStale || tenant.DataFreshness.IsStale,
	}
	return result
}

func latestEvent(left, right *time.Time) *time.Time {
	if left == nil {
		return right
	}
	if right == nil {
		return left
	}
	value := left.UTC()
	if right.After(value) {
		value = right.UTC()
	}
	return &value
}

func mergePerformance(filter invocationlog.AnalyticsPerformanceFilter, project invocationlog.AnalyticsPerformanceFields, tenant invocationlog.AnalyticsPerformanceFields) invocationlog.AnalyticsPerformanceFields {
	totalRequests := project.Summary.TotalRequests + tenant.Summary.TotalRequests
	systemErrors := project.Summary.SystemErrorRequests + tenant.Summary.SystemErrorRequests
	summary := invocationlog.AnalyticsPerformanceSummary{
		TotalRequests:       totalRequests,
		SystemErrorRequests: systemErrors,
		ThroughputPerMinute: analyticsThroughput(totalRequests, filter.From, filter.To),
	}
	if totalRequests > 0 {
		value := float64(systemErrors) / float64(totalRequests)
		summary.ErrorRate = &value
	}

	slowest := append(append([]invocationlog.AnalyticsSlowRequest{}, project.SlowestRequests...), tenant.SlowestRequests...)
	sortSlowRequests(slowest)
	if len(slowest) > 10 {
		slowest = slowest[:10]
	}

	generatedAt := time.Now().UTC()
	return invocationlog.AnalyticsPerformanceFields{
		Summary:                  summary,
		SurfaceSummaries:         append(append([]invocationlog.AnalyticsSurfaceSummary{}, project.SurfaceSummaries...), tenant.SurfaceSummaries...),
		ProviderModelPerformance: append(append([]invocationlog.AnalyticsProviderModelPerformance{}, project.ProviderModelPerformance...), tenant.ProviderModelPerformance...),
		P95LatencyByProvider:     append(append([]invocationlog.AnalyticsProviderLatency{}, project.P95LatencyByProvider...), tenant.P95LatencyByProvider...),
		LatencyDistribution:      append(append([]invocationlog.AnalyticsLatencyDistributionBucket{}, project.LatencyDistribution...), tenant.LatencyDistribution...),
		SlowestRequests:          slowest,
		BucketInterval:           project.BucketInterval,
		ExpectedBucketCount:      project.ExpectedBucketCount,
		DataFreshness: invocationlog.DashboardDataFreshness{
			Source:           "clickhouse_project_postgresql_tenant_chat",
			RecordCount:      totalRequests,
			LastLogCreatedAt: conservativeLastEvent(project.DataFreshness.LastLogCreatedAt, tenant.DataFreshness.LastLogCreatedAt),
			GeneratedAt:      generatedAt,
			LastAggregatedAt: generatedAt,
			IsStale:          project.DataFreshness.IsStale || tenant.DataFreshness.IsStale,
		},
	}
}

func analyticsThroughput(total int64, from time.Time, to time.Time) *float64 {
	minutes := to.Sub(from).Minutes()
	if total <= 0 || minutes <= 0 {
		return nil
	}
	value := float64(total) / minutes
	return &value
}

func conservativeLastEvent(left *time.Time, right *time.Time) *time.Time {
	if left == nil || right == nil {
		return nil
	}
	value := left.UTC()
	if right.Before(value) {
		value = right.UTC()
	}
	return &value
}

func sortSlowRequests(items []invocationlog.AnalyticsSlowRequest) {
	sort.SliceStable(items, func(left, right int) bool {
		if items[left].LatencyMs != items[right].LatencyMs {
			return items[left].LatencyMs > items[right].LatencyMs
		}
		if !items[left].CreatedAt.Equal(items[right].CreatedAt) {
			return items[left].CreatedAt.After(items[right].CreatedAt)
		}
		return items[left].RequestID > items[right].RequestID
	})
}
