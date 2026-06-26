package invocationlog

import (
	"math"
	"testing"
	"time"
)

func TestToRequestLogListItemUsesSafeP0Fields(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 2, 3, 0, time.UTC)
	log := LlmInvocationLog{
		RequestID:             "request_001",
		ProjectID:             "project_demo",
		ApplicationID:         "app_demo",
		Provider:              "mock",
		Model:                 "mock-fast",
		RequestedModel:        "auto",
		SelectedModel:         "mock-fast",
		Status:                StatusSuccess,
		HTTPStatus:            200,
		PromptTokens:          32,
		CompletionTokens:      24,
		TotalTokens:           56,
		CostMicroUSD:          12,
		LatencyMs:             132,
		CacheStatus:           CacheStatusMiss,
		CacheType:             CacheTypeExact,
		RoutingReason:         "low_cost",
		MaskingAction:         "redacted",
		RedactedPromptPreview: "Send a reply to [EMAIL_REDACTED].",
		MaskingDetectedTypes:  []string{"email"},
		MaskingDetectedCount:  1,
		CreatedAt:             createdAt,
	}

	item := ToRequestLogListItem(log)

	if item.RequestID != "request_001" || item.ProjectID != "project_demo" {
		t.Fatalf("unexpected list identity fields: %+v", item)
	}
	if item.CostUSD != "0.000012" || item.CostMicroUSD != 12 {
		t.Fatalf("unexpected cost fields: %+v", item)
	}
	if item.CacheStatus != CacheStatusMiss || item.CacheType != CacheTypeExact {
		t.Fatalf("unexpected cache fields: %+v", item)
	}
}

func TestToRequestDetailMapsCacheRoutingMaskingAndCost(t *testing.T) {
	providerLatencyMs := int64(86)
	completedAt := time.Date(2026, 6, 25, 1, 2, 4, 0, time.UTC)
	log := LlmInvocationLog{
		RequestID:             "request_001",
		TraceID:               "trace_001",
		TenantID:              "tenant_demo",
		ProjectID:             "project_demo",
		ApplicationID:         "app_demo",
		Status:                StatusSuccess,
		HTTPStatus:            200,
		Provider:              "mock",
		Model:                 "mock-fast",
		RequestedModel:        "auto",
		SelectedProvider:      "mock",
		SelectedModel:         "mock-fast",
		RoutingReason:         "low_cost",
		PromptTokens:          32,
		CompletionTokens:      24,
		TotalTokens:           56,
		CostMicroUSD:          1,
		LatencyMs:             132,
		ProviderLatencyMs:     &providerLatencyMs,
		CacheStatus:           CacheStatusMiss,
		CacheType:             CacheTypeExact,
		CacheKeyHash:          "sha256:cache",
		MaskingAction:         "none",
		MaskingDetectedTypes:  []string{},
		RedactedPromptPreview: "Write a short refund response.",
		CreatedAt:             completedAt.Add(-132 * time.Millisecond),
		CompletedAt:           &completedAt,
	}

	detail := ToRequestDetail(log)

	if detail.Cost.CostUSD != "0.000001" || detail.Cost.Currency != CurrencyUSD {
		t.Fatalf("unexpected detail cost: %+v", detail.Cost)
	}
	if detail.Cache.CacheKeyHash != "sha256:cache" || detail.Routing.RoutingReason != "low_cost" {
		t.Fatalf("unexpected cache/routing detail: %+v %+v", detail.Cache, detail.Routing)
	}
	if detail.Masking.RedactedPromptPreview != "Write a short refund response." {
		t.Fatalf("unexpected redacted prompt preview: %+v", detail.Masking)
	}
	if detail.Latency.ProviderLatencyMs == nil || *detail.Latency.ProviderLatencyMs != 86 {
		t.Fatalf("unexpected provider latency: %+v", detail.Latency)
	}
}

func TestBuildDashboardOverviewCountsP0Statuses(t *testing.T) {
	logs := []LlmInvocationLog{
		{Status: StatusSuccess, CacheStatus: CacheStatusMiss, TotalTokens: 10, CostMicroUSD: 2, LatencyMs: 100},
		{Status: StatusCacheHit, CacheStatus: CacheStatusHit, TotalTokens: 0, CostMicroUSD: 0, LatencyMs: 20},
		{Status: StatusBlocked, CacheStatus: CacheStatusBypass, TotalTokens: 0, CostMicroUSD: 0, LatencyMs: 10},
		{Status: StatusError, CacheStatus: CacheStatusBypass, TotalTokens: 0, CostMicroUSD: 0, LatencyMs: 70},
	}

	overview := BuildDashboardOverview(logs)

	if overview.TotalRequests != 4 || overview.SuccessfulRequests != 2 || overview.BlockedRequests != 1 || overview.CacheHitRequests != 1 {
		t.Fatalf("unexpected overview counts: %+v", overview)
	}
	if overview.TotalTokens != 10 || overview.TotalCostUSD != "0.000002" {
		t.Fatalf("unexpected overview totals: %+v", overview)
	}
	if overview.CacheHitRate == nil || !floatEquals(*overview.CacheHitRate, 0.25) {
		t.Fatalf("unexpected cache hit rate: %+v", overview.CacheHitRate)
	}
	if overview.AverageResponseTimeMs == nil || !floatEquals(*overview.AverageResponseTimeMs, 50) {
		t.Fatalf("unexpected average latency: %+v", overview.AverageResponseTimeMs)
	}
}

func TestFormatCostUSDFromMicroUSDHandlesNegativeValuesSafely(t *testing.T) {
	const minInt64 int64 = -1 << 63
	cases := []struct {
		name         string
		costMicroUSD int64
		want         string
	}{
		{name: "zero", costMicroUSD: 0, want: "0.000000"},
		{name: "positive", costMicroUSD: 1_234_567, want: "1.234567"},
		{name: "negative fractional", costMicroUSD: -1, want: "-0.000001"},
		{name: "negative whole", costMicroUSD: -1_000_001, want: "-1.000001"},
		{name: "min int64", costMicroUSD: minInt64, want: "-9223372036854.775808"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := FormatCostUSDFromMicroUSD(tc.costMicroUSD)
			if got != tc.want {
				t.Fatalf("expected %s, got %s", tc.want, got)
			}
		})
	}
}

func TestNormalizeProjectLogsFilterRequiresProjectScopeAndRange(t *testing.T) {
	_, err := NormalizeProjectLogsFilter(ProjectLogsFilter{})
	if err == nil {
		t.Fatalf("expected missing tenant and project id to fail")
	}

	from := time.Date(2026, 6, 25, 1, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	filter, err := NormalizeProjectLogsFilter(ProjectLogsFilter{
		TenantID:  " tenant_demo ",
		ProjectID: " project_demo ",
		From:      from,
		To:        to,
		Limit:     1000,
	})
	if err != nil {
		t.Fatalf("expected valid filter, got %v", err)
	}
	if filter.TenantID != "tenant_demo" || filter.ProjectID != "project_demo" || filter.Limit != 100 {
		t.Fatalf("unexpected normalized filter: %+v", filter)
	}
}

func TestNormalizeRequestDetailFilterRequiresTenantProjectAndRequest(t *testing.T) {
	_, err := NormalizeRequestDetailFilter(RequestDetailFilter{
		ProjectID: "project_demo",
		RequestID: "request_001",
	})
	if err == nil {
		t.Fatalf("expected missing tenant id to fail")
	}

	filter, err := NormalizeRequestDetailFilter(RequestDetailFilter{
		TenantID:  " tenant_demo ",
		ProjectID: " project_demo ",
		RequestID: " request_001 ",
	})
	if err != nil {
		t.Fatalf("expected valid detail filter, got %v", err)
	}
	if filter.TenantID != "tenant_demo" || filter.ProjectID != "project_demo" || filter.RequestID != "request_001" {
		t.Fatalf("unexpected normalized detail filter: %+v", filter)
	}
}

func TestNormalizeDashboardOverviewFilterRequiresTenantScope(t *testing.T) {
	from := time.Date(2026, 6, 25, 1, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	_, err := NormalizeDashboardOverviewFilter(DashboardOverviewFilter{
		ProjectID: "project_demo",
		From:      from,
		To:        to,
	})
	if err == nil {
		t.Fatalf("expected project-only dashboard scope to fail")
	}

	filter, err := NormalizeDashboardOverviewFilter(DashboardOverviewFilter{
		TenantID:  " tenant_demo ",
		ProjectID: " project_demo ",
		From:      from,
		To:        to,
	})
	if err != nil {
		t.Fatalf("expected valid dashboard filter, got %v", err)
	}
	if filter.TenantID != "tenant_demo" || filter.ProjectID != "project_demo" {
		t.Fatalf("unexpected normalized dashboard filter: %+v", filter)
	}
}

func floatEquals(a float64, b float64) bool {
	return math.Abs(a-b) < 0.0000001
}
