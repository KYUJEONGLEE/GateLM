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
	projectPerformance AnalyticsPerformanceReader
}

func NewAnalyticsReader(primary invocationlog.Reader, projectPerformance AnalyticsPerformanceReader) (*AnalyticsReader, error) {
	if primary == nil {
		return nil, errors.New("hybrid analytics reader requires a primary reader")
	}
	if projectPerformance == nil {
		return nil, errors.New("hybrid analytics reader requires a project performance reader")
	}
	return &AnalyticsReader{Reader: primary, projectPerformance: projectPerformance}, nil
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
		return r.projectPerformance.GetAnalyticsPerformance(ctx, projectFilter)
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
		projectFields, readErr = r.projectPerformance.GetAnalyticsPerformance(groupCtx, projectFilter)
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
	reader, ok := r.Reader.(interface {
		GetAnalyticsReliability(context.Context, invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error)
	})
	if !ok {
		return invocationlog.AnalyticsReliabilityFields{}, invocationlog.ErrReliabilityDataUnavailable
	}
	return reader.GetAnalyticsReliability(ctx, filter)
}

func (r *AnalyticsReader) GetAnalyticsPolicyImpact(ctx context.Context, filter invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error) {
	reader, ok := r.Reader.(interface {
		GetAnalyticsPolicyImpact(context.Context, invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error)
	})
	if !ok {
		return invocationlog.AnalyticsPolicyImpactFields{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	return reader.GetAnalyticsPolicyImpact(ctx, filter)
}

func (r *AnalyticsReader) ListProjectLogFilterOptions(ctx context.Context, filter invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error) {
	reader, ok := r.Reader.(interface {
		ListProjectLogFilterOptions(context.Context, invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error)
	})
	if !ok {
		return invocationlog.RequestLogFilterOptions{}, invocationlog.ErrAnalyticsDataUnavailable
	}
	return reader.ListProjectLogFilterOptions(ctx, filter)
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
