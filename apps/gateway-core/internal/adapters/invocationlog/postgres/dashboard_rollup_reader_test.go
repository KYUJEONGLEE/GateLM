package postgres

import (
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestBuildDashboardRollupQueriesKeepTenantAndScopeFilters(t *testing.T) {
	from := time.Date(2026, 7, 7, 0, 0, 0, 0, time.UTC)
	segments := []dashboardRollupSegment{
		{Grain: "day", From: from, To: from.Add(6 * 24 * time.Hour)},
		{Grain: "hour", From: from.Add(6 * 24 * time.Hour), To: from.Add(6*24*time.Hour + 10*time.Hour)},
	}
	filter := invocationlog.DashboardOverviewFilter{
		TenantID:  testTenantID,
		ProjectID: testProjectID,
		BudgetScope: budget.Scope{
			Type:       "team",
			ID:         "team_demo",
			ResolvedBy: "control_plane_rule",
		},
	}

	query, args := buildDashboardRollupTotalsQuery(filter, segments)
	for _, expected := range []string{
		"from dashboard_rollup_totals",
		"tenant_id = $1::uuid",
		"surface = 'project_application'",
		"grain = $2",
		"grain = $5",
		"project_id = $8",
		"budget_scope_type = $9",
		"budget_scope_id = $10",
		"budget_scope_resolved_by = $11",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected rollup query to contain %q, got %s", expected, query)
		}
	}
	if len(args) != 11 || args[0] != testTenantID || args[7] != testProjectID {
		t.Fatalf("unexpected rollup args: %#v", args)
	}
}

func TestBuildDashboardRawRangeQueriesUseBoundedEdgesAndTTFT(t *testing.T) {
	from := time.Date(2026, 7, 14, 10, 0, 0, 0, time.UTC)
	filter := invocationlog.DashboardOverviewFilter{
		TenantID:  testTenantID,
		ProjectID: testProjectID,
	}
	query, args := buildDashboardRawRangeTotalsQuery(filter, []dashboardTimeRange{
		{From: from, To: from.Add(15 * time.Minute)},
		{From: from.Add(45 * time.Minute), To: from.Add(time.Hour)},
	})
	for _, expected := range []string{
		"from p0_llm_invocation_logs",
		"tenant_id = $1",
		"project_id = $2",
		"created_at >= $3 and created_at < $4",
		"created_at >= $5 and created_at < $6",
		"stream and ttft_ms is not null",
		"ttft_histogram",
		"gateway_internal_latency_histogram",
	} {
		if !strings.Contains(query, expected) {
			t.Fatalf("expected raw edge query to contain %q, got %s", expected, query)
		}
	}
	if len(args) != 6 || args[0] != testTenantID || args[1] != testProjectID {
		t.Fatalf("unexpected raw edge args: %#v", args)
	}
	for _, forbidden := range []string{"raw_prompt", "raw_response", "authorization", "provider_api_key"} {
		if strings.Contains(strings.ToLower(query), forbidden) {
			t.Fatalf("raw edge query must not contain %q", forbidden)
		}
	}
}

func TestMergeDashboardRollupSnapshotsRecomputesRatesAndPercentiles(t *testing.T) {
	first := newDashboardRollupSnapshot()
	first.Aggregate.TotalRequests = 8
	first.Aggregate.SuccessfulRequests = 7
	first.Aggregate.EligibleStreamRequests = 4
	first.Aggregate.ObservedTTFTRequests = 3
	first.Aggregate.StatusCounts[invocationlog.StatusSuccess] = 7
	first.Aggregate.ProjectBreakdown = []invocationlog.ProjectBreakdown{{ProjectID: testProjectID, RequestCount: 8, TotalTokens: 80, CostMicroUSD: 100}}
	first.LatencyCount = 8
	first.LatencySumMs = 800
	first.LatencyHistogram[2] = 8
	first.TTFTCount = 3
	first.TTFTSumMs = 900
	first.TTFTHistogram[4] = 3

	second := newDashboardRollupSnapshot()
	second.Aggregate.TotalRequests = 2
	second.Aggregate.FailedRequests = 1
	second.Aggregate.EligibleStreamRequests = 1
	second.Aggregate.ObservedTTFTRequests = 1
	second.Aggregate.StatusCounts[invocationlog.StatusFailed] = 1
	second.Aggregate.ProjectBreakdown = []invocationlog.ProjectBreakdown{{ProjectID: testProjectID, RequestCount: 2, TotalTokens: 20, CostMicroUSD: 50}}
	second.LatencyCount = 2
	second.LatencySumMs = 1000
	second.LatencyHistogram[5] = 2
	second.TTFTCount = 1
	second.TTFTSumMs = 500
	second.TTFTHistogram[5] = 1

	merged := mergeDashboardRollupSnapshots(first, second)
	if merged.Aggregate.TotalRequests != 10 || merged.Aggregate.EligibleStreamRequests != 5 || merged.Aggregate.ObservedTTFTRequests != 4 {
		t.Fatalf("unexpected merged counts: %+v", merged.Aggregate)
	}
	if merged.Aggregate.AverageLatencyMs == nil || *merged.Aggregate.AverageLatencyMs != 180 {
		t.Fatalf("unexpected merged latency average: %v", merged.Aggregate.AverageLatencyMs)
	}
	if merged.Aggregate.P95LatencyMs == nil || *merged.Aggregate.P95LatencyMs != 500 {
		t.Fatalf("unexpected merged latency p95: %v", merged.Aggregate.P95LatencyMs)
	}
	if merged.Aggregate.P95TTFTMs == nil || *merged.Aggregate.P95TTFTMs != 500 {
		t.Fatalf("unexpected merged TTFT p95: %v", merged.Aggregate.P95TTFTMs)
	}
	if len(merged.Aggregate.ProjectBreakdown) != 1 || merged.Aggregate.ProjectBreakdown[0].RequestCount != 10 || merged.Aggregate.ProjectBreakdown[0].CostMicroUSD != 150 {
		t.Fatalf("unexpected merged project breakdown: %+v", merged.Aggregate.ProjectBreakdown)
	}
}
