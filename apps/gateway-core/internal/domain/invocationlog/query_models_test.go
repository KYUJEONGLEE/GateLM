package invocationlog

import (
	"errors"
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

func TestBuildDashboardOverviewCountsV1Statuses(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 0, 0, 0, time.UTC)
	logs := []LlmInvocationLog{
		{
			Status: StatusSuccess, CacheStatus: CacheStatusMiss, CacheType: CacheTypeExact,
			PromptTokens: 10, CompletionTokens: 20, TotalTokens: 30, CostMicroUSD: 100,
			LatencyMs: 100, SelectedProvider: "mock", SelectedModel: "mock-fast", RoutingReason: "short_prompt_low_cost",
			MaskingAction: "none", CreatedAt: createdAt,
		},
		{
			Status: StatusCacheHit, CacheStatus: CacheStatusHit, CacheType: CacheTypeExact,
			SavedCostMicroUSD: 50, LatencyMs: 20, SelectedProvider: "mock", SelectedModel: "mock-fast", RoutingReason: "short_prompt_low_cost",
			MaskingAction: "none", CreatedAt: createdAt.Add(time.Second),
		},
		{Status: StatusBlocked, CacheStatus: CacheStatusBypass, CacheType: CacheTypeNone, MaskingAction: "blocked", CreatedAt: createdAt.Add(2 * time.Second)},
		{
			Status: StatusError, CacheStatus: CacheStatusMiss, CacheType: CacheTypeExact,
			PromptTokens: 3, TotalTokens: 3, LatencyMs: 70, SelectedProvider: "mock", SelectedModel: "mock-balanced",
			MaskingAction: "redacted", CreatedAt: createdAt.Add(3 * time.Second),
		},
		{Status: StatusRateLimited, CacheStatus: CacheStatusBypass, CacheType: CacheTypeNone, MaskingAction: "none", CreatedAt: createdAt.Add(4 * time.Second)},
		{Status: StatusCancelled, CacheStatus: CacheStatusBypass, CacheType: CacheTypeNone, MaskingAction: "none", CreatedAt: createdAt.Add(5 * time.Second)},
	}

	overview := BuildDashboardOverview(logs)

	if overview.TotalRequests != 6 || overview.SuccessfulRequests != 2 || overview.FailedRequests != 1 || overview.BlockedRequests != 1 || overview.RateLimitedRequests != 1 {
		t.Fatalf("unexpected overview counts: %+v", overview)
	}
	if overview.CacheHitRequests != 1 || overview.CacheEligibleRequests != 3 {
		t.Fatalf("unexpected cache counts: %+v", overview)
	}
	if overview.PromptTokens != 13 || overview.CompletionTokens != 20 || overview.TotalTokens != 33 || overview.TotalCostUSD != "0.000100" || overview.SavedCostUSD != "0.000050" {
		t.Fatalf("unexpected overview totals: %+v", overview)
	}
	if overview.CacheHitRate == nil || !floatEquals(*overview.CacheHitRate, 1.0/3.0) {
		t.Fatalf("unexpected cache hit rate: %+v", overview.CacheHitRate)
	}
	if overview.AverageLatencyMs == nil || !floatEquals(*overview.AverageLatencyMs, 190.0/3.0) || overview.P95LatencyMs == nil || !floatEquals(*overview.P95LatencyMs, 100) {
		t.Fatalf("unexpected latency metrics: avg=%+v p95=%+v", overview.AverageLatencyMs, overview.P95LatencyMs)
	}
	if overview.AverageResponseTimeMs == nil || !floatEquals(*overview.AverageResponseTimeMs, *overview.AverageLatencyMs) {
		t.Fatalf("expected average response time compatibility alias, got %+v", overview.AverageResponseTimeMs)
	}
	if overview.StatusCounts[StatusSuccess] != 1 || overview.StatusCounts[StatusCacheHit] != 1 || overview.StatusCounts[StatusBlocked] != 1 || overview.StatusCounts[StatusRateLimited] != 1 || overview.StatusCounts[StatusError] != 1 || overview.StatusCounts[StatusCancelled] != 1 {
		t.Fatalf("unexpected status counts: %+v", overview.StatusCounts)
	}
	if overview.MaskingActionCounts["none"] != 4 || overview.MaskingActionCounts["redacted"] != 1 || overview.MaskingActionCounts["blocked"] != 1 {
		t.Fatalf("unexpected masking counts: %+v", overview.MaskingActionCounts)
	}
	if len(overview.RoutingCountByModel) != 2 || overview.RoutingCountByModel[0].SelectedModel != "mock-fast" || overview.RoutingCountByModel[0].RequestCount != 2 {
		t.Fatalf("unexpected routing count by model: %+v", overview.RoutingCountByModel)
	}
	if len(overview.CostByModel) != 2 || overview.CostByModel[0].SelectedModel != "mock-fast" || overview.CostByModel[0].RequestCount != 2 || overview.CostByModel[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected cost by model: %+v", overview.CostByModel)
	}
	if overview.DataFreshness.Source != "postgresql_request_log" || overview.DataFreshness.RecordCount != 6 || overview.DataFreshness.LastLogCreatedAt == nil || !overview.DataFreshness.LastLogCreatedAt.Equal(createdAt.Add(5*time.Second)) {
		t.Fatalf("unexpected data freshness: %+v", overview.DataFreshness)
	}
}

func TestBuildDashboardOverviewEmptyRangeReturnsZeroRatesAndNoLatency(t *testing.T) {
	overview := BuildDashboardOverview(nil)

	if overview.TotalRequests != 0 || overview.CacheEligibleRequests != 0 || overview.CacheHitRequests != 0 {
		t.Fatalf("unexpected empty overview counts: %+v", overview)
	}
	if overview.CacheHitRate == nil || *overview.CacheHitRate != 0 {
		t.Fatalf("expected zero cache hit rate, got %+v", overview.CacheHitRate)
	}
	if overview.AverageLatencyMs != nil || overview.P95LatencyMs != nil {
		t.Fatalf("expected nil latency metrics for empty range, got avg=%+v p95=%+v", overview.AverageLatencyMs, overview.P95LatencyMs)
	}
	if overview.StatusCounts[StatusSuccess] != 0 || overview.MaskingActionCounts["none"] != 0 {
		t.Fatalf("expected default zero count maps, got status=%+v masking=%+v", overview.StatusCounts, overview.MaskingActionCounts)
	}
	if overview.DataFreshness.Source != "postgresql_request_log" || overview.DataFreshness.RecordCount != 0 || overview.DataFreshness.LastLogCreatedAt != nil {
		t.Fatalf("unexpected empty data freshness: %+v", overview.DataFreshness)
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

func TestNormalizeProjectLogsFilterRequiresTenantProjectScopeAndRange(t *testing.T) {
	_, err := NormalizeProjectLogsFilter(ProjectLogsFilter{})
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected missing tenant id to fail with invalid query, got %v", err)
	}

	_, err = NormalizeProjectLogsFilter(ProjectLogsFilter{
		TenantID: "tenant_demo",
	})
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected missing project id to fail with invalid query, got %v", err)
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

func TestNormalizeRequestDetailFilterRequiresTenantProjectRequestScope(t *testing.T) {
	_, err := NormalizeRequestDetailFilter(RequestDetailFilter{
		ProjectID: "project_demo",
		RequestID: "request_demo",
	})
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected missing tenant id to fail with invalid query, got %v", err)
	}

	_, err = NormalizeRequestDetailFilter(RequestDetailFilter{
		TenantID:  "tenant_demo",
		RequestID: "request_demo",
	})
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected missing project id to fail with invalid query, got %v", err)
	}

	_, err = NormalizeRequestDetailFilter(RequestDetailFilter{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	})
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected missing request id to fail with invalid query, got %v", err)
	}

	filter, err := NormalizeRequestDetailFilter(RequestDetailFilter{
		TenantID:  " tenant_demo ",
		ProjectID: " project_demo ",
		RequestID: " request_demo ",
	})
	if err != nil {
		t.Fatalf("expected valid detail filter, got %v", err)
	}
	if filter.TenantID != "tenant_demo" || filter.ProjectID != "project_demo" || filter.RequestID != "request_demo" {
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
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected missing tenant id to fail with invalid query, got %v", err)
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
