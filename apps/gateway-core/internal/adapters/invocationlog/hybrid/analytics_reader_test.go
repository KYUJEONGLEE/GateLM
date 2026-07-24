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

type fullReaderStub struct {
	performanceStub
	listCalls, detailCalls, dashboardCalls, costCalls, liveCalls, policyCalls, reliabilityCalls, optionCalls int
	listErr, liveErr                                                                                         error
}

func (s *fullReaderStub) ListProjectLogs(_ context.Context, _ invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	s.listCalls++
	return []invocationlog.RequestLogListItem{{RequestID: "project-reader"}}, s.listErr
}
func (s *fullReaderStub) GetRequestDetail(_ context.Context, _ invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error) {
	s.detailCalls++
	return invocationlog.RequestDetail{RequestID: "postgres-detail"}, nil
}
func (s *fullReaderStub) GetDashboardOverview(_ context.Context, _ invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	s.dashboardCalls++
	return invocationlog.DashboardOverviewFields{}, nil
}
func (s *fullReaderStub) GetCostReport(_ context.Context, _ invocationlog.CostReportFilter) (invocationlog.CostReportFields, error) {
	s.costCalls++
	return invocationlog.CostReportFields{}, nil
}
func (s *fullReaderStub) GetAnalyticsLiveUsage(_ context.Context, _ invocationlog.AnalyticsLiveUsageFilter) (invocationlog.AnalyticsLiveUsageFields, error) {
	s.liveCalls++
	return invocationlog.AnalyticsLiveUsageFields{}, s.liveErr
}
func (s *fullReaderStub) GetAnalyticsPolicyImpact(_ context.Context, _ invocationlog.AnalyticsPolicyImpactFilter) (invocationlog.AnalyticsPolicyImpactFields, error) {
	s.policyCalls++
	return invocationlog.AnalyticsPolicyImpactFields{}, nil
}
func (s *fullReaderStub) GetAnalyticsReliability(_ context.Context, _ invocationlog.AnalyticsReliabilityFilter) (invocationlog.AnalyticsReliabilityFields, error) {
	s.reliabilityCalls++
	return invocationlog.AnalyticsReliabilityFields{Freshness: invocationlog.AnalyticsReliabilityFreshness{Complete: true}}, nil
}
func (s *fullReaderStub) ListProjectLogFilterOptions(_ context.Context, _ invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error) {
	s.optionCalls++
	return invocationlog.RequestLogFilterOptions{}, nil
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
		TenantID:          "00000000-0000-4000-8000-000000000100",
		From:              from,
		To:                from.Add(10 * time.Minute),
		IncludeTenantChat: true,
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

func TestAnalyticsReaderTenantScopeCanExcludeTenantChat(t *testing.T) {
	from := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	project := &performanceStub{result: performanceFields(invocationlog.AnalyticsSurfaceProjectApplication, 8, 1, 800, from)}
	project.result.LatencyDistribution = []invocationlog.AnalyticsLatencyDistributionBucket{{
		Bucket:   from,
		Requests: 8,
		Surface:  invocationlog.AnalyticsSurfaceProjectApplication,
	}}
	tenant := &performanceStub{result: performanceFields(invocationlog.AnalyticsSurfaceTenantChat, 0, 0, 0, from)}
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
		t.Fatalf("get project-only performance: %v", err)
	}
	if tenant.calls != 0 || project.calls != 1 {
		t.Fatalf("unexpected reader routing: project=%d tenant=%d", project.calls, tenant.calls)
	}
	if len(result.LatencyDistribution) != 1 || result.LatencyDistribution[0].Requests != 8 {
		t.Fatalf("project distribution must be preserved: %+v", result.LatencyDistribution)
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

func TestAnalyticsReaderRoutesEveryProjectBulkReadToClickHouseAndKeepsDetailOnPostgres(t *testing.T) {
	from := time.Now().UTC().Add(-time.Hour)
	primary := &fullReaderStub{}
	project := &fullReaderStub{}
	reader, err := NewAnalyticsReader(primary, project)
	if err != nil {
		t.Fatalf("new hybrid reader: %v", err)
	}
	projectID := "00000000-0000-4000-8000-000000000200"
	tenantID := "00000000-0000-4000-8000-000000000100"
	_, _ = reader.ListProjectLogs(context.Background(), invocationlog.ProjectLogsFilter{TenantID: tenantID, ProjectID: projectID, From: from, To: from.Add(time.Hour)})
	_, _ = reader.GetDashboardOverview(context.Background(), invocationlog.DashboardOverviewFilter{TenantID: tenantID, ProjectID: projectID, From: from, To: from.Add(time.Hour)})
	_, _ = reader.GetCostReport(context.Background(), invocationlog.CostReportFilter{TenantID: tenantID, ProjectID: projectID, From: from, To: from.Add(time.Hour)})
	liveTo := from.Truncate(time.Second).Add(15 * time.Minute)
	_, _ = reader.GetAnalyticsLiveUsage(context.Background(), invocationlog.AnalyticsLiveUsageFilter{TenantID: tenantID, ProjectID: projectID, From: liveTo.Add(-15 * time.Minute), To: liveTo})
	_, _ = reader.GetAnalyticsPolicyImpact(context.Background(), invocationlog.AnalyticsPolicyImpactFilter{TenantID: tenantID, ProjectID: projectID, From: from, To: from.Add(time.Hour)})
	_, _ = reader.GetAnalyticsReliability(context.Background(), invocationlog.AnalyticsReliabilityFilter{TenantID: tenantID, ProjectID: projectID, From: from, To: from.Add(time.Hour)})
	_, _ = reader.ListProjectLogFilterOptions(context.Background(), invocationlog.ProjectLogsFilter{TenantID: tenantID, ProjectID: projectID, From: from, To: from.Add(time.Hour)})
	detail, _ := reader.GetRequestDetail(context.Background(), invocationlog.RequestDetailFilter{TenantID: tenantID, ProjectID: projectID, RequestID: "request"})
	if project.listCalls != 1 || project.dashboardCalls != 1 || project.costCalls != 1 || project.liveCalls != 1 || project.policyCalls != 1 || project.reliabilityCalls != 1 || project.optionCalls != 1 {
		t.Fatalf("project bulk reads did not all route to ClickHouse stub: %+v", project)
	}
	if primary.listCalls != 0 || primary.dashboardCalls != 0 || primary.costCalls != 0 || primary.liveCalls != 0 || primary.policyCalls != 0 || primary.reliabilityCalls != 0 || primary.optionCalls != 0 {
		t.Fatalf("project bulk read reached PostgreSQL primary: %+v", primary)
	}
	if primary.detailCalls != 1 || detail.RequestID != "postgres-detail" {
		t.Fatalf("request detail must remain a PostgreSQL point lookup: calls=%d detail=%+v", primary.detailCalls, detail)
	}
}

func TestAnalyticsReaderDoesNotFallbackProjectLogsToPostgres(t *testing.T) {
	from := time.Now().UTC().Add(-time.Hour)
	primary := &fullReaderStub{}
	project := &fullReaderStub{listErr: errors.New("clickhouse unavailable")}
	reader, err := NewAnalyticsReader(primary, project)
	if err != nil {
		t.Fatalf("new hybrid reader: %v", err)
	}
	_, err = reader.ListProjectLogs(context.Background(), invocationlog.ProjectLogsFilter{TenantID: "00000000-0000-4000-8000-000000000100", ProjectID: "00000000-0000-4000-8000-000000000200", From: from, To: from.Add(time.Hour)})
	if err == nil {
		t.Fatal("expected ClickHouse read error")
	}
	if primary.listCalls != 0 {
		t.Fatalf("PostgreSQL fallback must stay disabled, got %d calls", primary.listCalls)
	}
}

func TestAnalyticsReaderDoesNotFallbackLiveUsageToPostgres(t *testing.T) {
	primary := &fullReaderStub{}
	project := &fullReaderStub{liveErr: invocationlog.ErrAnalyticsDataUnavailable}
	reader, err := NewAnalyticsReader(primary, project)
	if err != nil {
		t.Fatalf("new hybrid reader: %v", err)
	}
	to := time.Now().UTC().Truncate(time.Second)
	_, err = reader.GetAnalyticsLiveUsage(context.Background(), invocationlog.AnalyticsLiveUsageFilter{
		TenantID: "00000000-0000-4000-8000-000000000100",
		From:     to.Add(-15 * time.Minute),
		To:       to,
	})
	if !errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
		t.Fatalf("expected ClickHouse unavailable error, got %v", err)
	}
	if primary.liveCalls != 0 || project.liveCalls != 1 {
		t.Fatalf("live usage must not fall back to primary: project=%d primary=%d", project.liveCalls, primary.liveCalls)
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
