package hybrid

import (
	"context"
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type performanceStub struct {
	invocationlog.Reader
	result invocationlog.AnalyticsPerformanceFields
	err    error
	filter invocationlog.AnalyticsPerformanceFilter
	calls  int
}

func (s *performanceStub) GetAnalyticsPerformance(_ context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	s.calls++
	s.filter = filter
	return s.result, s.err
}

func TestAnalyticsReaderMergesClickHouseProjectAndPostgresTenantChat(t *testing.T) {
	from := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	projectLast := from.Add(8 * time.Minute)
	tenantLast := from.Add(7 * time.Minute)
	project := &performanceStub{result: performanceFields(invocationlog.AnalyticsSurfaceProjectApplication, 8, 1, 800, projectLast)}
	tenant := &performanceStub{result: performanceFields(invocationlog.AnalyticsSurfaceTenantChat, 2, 1, 900, tenantLast)}
	reader, err := NewAnalyticsReader(tenant, project)
	if err != nil {
		t.Fatalf("new hybrid reader: %v", err)
	}

	result, err := reader.GetAnalyticsPerformance(context.Background(), invocationlog.AnalyticsPerformanceFilter{
		TenantID: "00000000-0000-4000-8000-000000000100",
		From:     from,
		To:       from.Add(10 * time.Minute),
	})
	if err != nil {
		t.Fatalf("get performance: %v", err)
	}
	if project.calls != 1 || tenant.calls != 1 || tenant.filter.Surface != invocationlog.AnalyticsSurfaceTenantChat {
		t.Fatalf("unexpected reader routing: project=%d tenant=%d tenantFilter=%+v", project.calls, tenant.calls, tenant.filter)
	}
	if result.Summary.TotalRequests != 10 || result.Summary.SystemErrorRequests != 2 || result.Summary.ErrorRate == nil || *result.Summary.ErrorRate != 0.2 {
		t.Fatalf("unexpected merged summary: %+v", result.Summary)
	}
	if result.Summary.P95LatencyMs != nil {
		t.Fatal("cross-surface percentile must remain unavailable")
	}
	if result.DataFreshness.LastLogCreatedAt == nil || !result.DataFreshness.LastLogCreatedAt.Equal(tenantLast) {
		t.Fatalf("expected conservative source freshness, got %+v", result.DataFreshness)
	}
	if len(result.SlowestRequests) != 2 || result.SlowestRequests[0].LatencyMs != 900 {
		t.Fatalf("unexpected merged slow requests: %+v", result.SlowestRequests)
	}
}

func TestAnalyticsReaderProjectScopeDoesNotQueryTenantChat(t *testing.T) {
	project := &performanceStub{result: performanceFields(invocationlog.AnalyticsSurfaceProjectApplication, 1, 0, 100, time.Now().UTC())}
	tenant := &performanceStub{err: errors.New("must not be called")}
	reader, err := NewAnalyticsReader(tenant, project)
	if err != nil {
		t.Fatalf("new hybrid reader: %v", err)
	}
	from := time.Now().UTC().Add(-time.Hour)
	_, err = reader.GetAnalyticsPerformance(context.Background(), invocationlog.AnalyticsPerformanceFilter{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
		From:      from,
		To:        from.Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("project-only read: %v", err)
	}
	if tenant.calls != 0 || project.calls != 1 {
		t.Fatalf("unexpected calls: project=%d tenant=%d", project.calls, tenant.calls)
	}
}

func performanceFields(surface string, requests int64, errorsCount int64, latency int64, last time.Time) invocationlog.AnalyticsPerformanceFields {
	return invocationlog.AnalyticsPerformanceFields{
		Summary: invocationlog.AnalyticsPerformanceSummary{
			TotalRequests:       requests,
			SystemErrorRequests: errorsCount,
		},
		SurfaceSummaries: []invocationlog.AnalyticsSurfaceSummary{{
			Surface:     surface,
			Summary:     invocationlog.AnalyticsPerformanceSummary{TotalRequests: requests, SystemErrorRequests: errorsCount},
			LastEventAt: &last,
		}},
		SlowestRequests:     []invocationlog.AnalyticsSlowRequest{{Surface: surface, RequestID: surface, LatencyMs: latency, CreatedAt: last}},
		BucketInterval:      "1m",
		ExpectedBucketCount: 10,
		DataFreshness: invocationlog.DashboardDataFreshness{
			RecordCount:      requests,
			LastLogCreatedAt: &last,
		},
	}
}
