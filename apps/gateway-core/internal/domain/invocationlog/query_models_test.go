package invocationlog

import (
	"errors"
	"math"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

func TestToRequestLogListItemUsesSafeP0Fields(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 2, 3, 0, time.UTC)
	log := LlmInvocationLog{
		RequestID:             "request_001",
		ProjectID:             "project_demo",
		ApplicationID:         "app_demo",
		EndUserID:             "Yoonji",
		Provider:              "mock",
		Model:                 "mock-fast",
		RequestedModel:        "auto",
		Status:                StatusSuccess,
		HTTPStatus:            200,
		PromptTokens:          32,
		CompletionTokens:      24,
		TotalTokens:           56,
		CostMicroUSD:          12,
		LatencyMs:             132,
		CacheStatus:           CacheStatusMiss,
		CacheType:             CacheTypeExact,
		RoutingReason:         routing.ReasonMatrixRoute,
		MaskingAction:         "redacted",
		RedactedPromptPreview: "Send a reply to [EMAIL_1].",
		MaskingDetectedTypes:  []string{"email"},
		MaskingDetectedCount:  1,
		CreatedAt:             createdAt,
	}

	item := ToRequestLogListItem(log)

	if item.RequestID != "request_001" || item.ProjectID != "project_demo" {
		t.Fatalf("unexpected list identity fields: %+v", item)
	}
	if item.UserRef != "Yoonji" {
		t.Fatalf("unexpected user ref: %+v", item)
	}
	if item.CostUSD != "0.000012" || item.CostMicroUSD != 12 {
		t.Fatalf("unexpected cost fields: %+v", item)
	}
	if item.CacheStatus != CacheStatusMiss || item.CacheType != CacheTypeExact {
		t.Fatalf("unexpected cache fields: %+v", item)
	}
	if item.BudgetScope.Type != budget.ScopeTypeApplication || item.BudgetScope.ID != "app_demo" || item.BudgetScope.ResolvedBy != budget.ResolvedByDefaultApplication {
		t.Fatalf("unexpected default budget scope: %+v", item.BudgetScope)
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
		RoutingReason:         routing.ReasonMatrixRoute,
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
		PromptCapture: PromptCaptureFields{
			Enabled:        true,
			Mode:           runtimeconfig.PromptCaptureModeLogSafeFull,
			Visibility:     PromptCaptureVisibilityAdminRequestDetail,
			CapturedPrompt: "Write a short refund response.",
			Truncated:      false,
			MaxChars:       8000,
		},
		RuntimeSnapshot: runtimeconfig.RuntimeSnapshotProvenance{
			RuntimeSnapshotID:      "runtime_snapshot_query_test",
			RuntimeSnapshotVersion: 2,
			ContentHash:            "content_hash_query_test",
			RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
			PublishedAt:            completedAt.Add(-time.Second),
			PublishedBy:            "runtime_config_compat",
			GatewayInstanceID:      "gateway_query_test",
			LegacyHashes: runtimeconfig.LegacyHashes{
				ConfigHash:         "config_hash_query_test",
				SecurityPolicyHash: "security_hash_query_test",
				RoutingPolicyHash:  "route_hash_query_test",
			},
		},
		CreatedAt:   completedAt.Add(-132 * time.Millisecond),
		CompletedAt: &completedAt,
	}

	detail := ToRequestDetail(log)

	if detail.Cost.CostUSD != "0.000001" || detail.Cost.Currency != CurrencyUSD {
		t.Fatalf("unexpected detail cost: %+v", detail.Cost)
	}
	if detail.Cache.CacheKeyHash != "sha256:cache" || detail.Routing.RoutingReason != routing.ReasonMatrixRoute {
		t.Fatalf("unexpected cache/routing detail: %+v %+v", detail.Cache, detail.Routing)
	}
	if detail.Masking.RedactedPromptPreview != "Write a short refund response." {
		t.Fatalf("unexpected redacted prompt preview: %+v", detail.Masking)
	}
	if !detail.PromptCapture.Enabled || detail.PromptCapture.CapturedPrompt != "Write a short refund response." {
		t.Fatalf("unexpected prompt capture detail: %+v", detail.PromptCapture)
	}
	if detail.Latency.ProviderLatencyMs == nil || *detail.Latency.ProviderLatencyMs != 86 {
		t.Fatalf("unexpected provider latency: %+v", detail.Latency)
	}
	if detail.BudgetScope.Type != budget.ScopeTypeApplication || detail.BudgetScope.ID != "app_demo" || detail.BudgetScope.ResolvedBy != budget.ResolvedByDefaultApplication {
		t.Fatalf("unexpected default budget scope: %+v", detail.BudgetScope)
	}
	if detail.RuntimeSnapshot == nil ||
		detail.RuntimeSnapshot.RuntimeSnapshotID != "runtime_snapshot_query_test" ||
		detail.RuntimeSnapshot.RuntimeSnapshotVersion != 2 ||
		detail.RuntimeSnapshot.RuntimeState != runtimeconfig.RuntimeStateSnapshotActive ||
		detail.RuntimeSnapshot.LegacyHashes.RoutingPolicyHash != "route_hash_query_test" {
		t.Fatalf("unexpected runtime snapshot detail: %+v", detail.RuntimeSnapshot)
	}
}

func TestReadModelsCanonicalizeRetiredRoutingCategoriesAndDifficulty(t *testing.T) {
	for _, legacyCategory := range []string{"support_refund", "extraction_json", "unknown", "", "missing-category"} {
		log := LlmInvocationLog{
			RequestID:        "request_legacy_category",
			RequestedModel:   "auto",
			PromptCategory:   legacyCategory,
			PromptDifficulty: "legacy-tier",
			RoutingReason:    routing.ReasonMatrixRoute,
		}
		item := ToRequestLogListItem(log)
		detail := ToRequestDetail(log)
		if item.Category != routing.CategoryGeneral || item.Difficulty != routing.DifficultySimple {
			t.Fatalf("list must canonicalize %q to general/simple: %+v", legacyCategory, item)
		}
		if detail.Routing.Category != routing.CategoryGeneral || detail.Routing.Difficulty != routing.DifficultySimple {
			t.Fatalf("detail must canonicalize %q to general/simple: %+v", legacyCategory, detail.Routing)
		}
	}
}

func TestDashboardMergesRetiredRoutingCategoriesIntoGeneral(t *testing.T) {
	logs := []LlmInvocationLog{
		{PromptCategory: "support_refund", PromptDifficulty: "simple", RoutingReason: routing.ReasonMatrixRoute},
		{PromptCategory: "extraction_json", PromptDifficulty: "simple", RoutingReason: routing.ReasonMatrixRoute},
		{PromptCategory: "unknown", PromptDifficulty: "simple", RoutingReason: routing.ReasonMatrixRoute},
		{PromptCategory: "", PromptDifficulty: "legacy-tier", RoutingReason: routing.ReasonMatrixRoute},
	}

	overview := BuildDashboardOverview(logs)
	if len(overview.RoutingCountByModel) != 1 {
		t.Fatalf("retired categories must merge into one dashboard bucket: %+v", overview.RoutingCountByModel)
	}
	item := overview.RoutingCountByModel[0]
	if item.Category != routing.CategoryGeneral || item.Difficulty != routing.DifficultySimple || item.RequestCount != 4 {
		t.Fatalf("unexpected merged routing bucket: %+v", item)
	}
}

func TestBuildDashboardOverviewCountsV1Statuses(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 0, 0, 0, time.UTC)
	logs := []LlmInvocationLog{
		{
			Status: StatusSuccess, CacheStatus: CacheStatusMiss, CacheType: CacheTypeExact,
			ProjectID:     "project_alpha",
			ApplicationID: "app_demo",
			BudgetScope: budget.Scope{
				Type:       budget.ScopeTypeTeam,
				ID:         "team_demo",
				ResolvedBy: budget.ResolvedByControlPlaneRule,
			},
			PromptTokens: 10, CompletionTokens: 20, TotalTokens: 30, CostMicroUSD: 100,
			LatencyMs: 100, Provider: "mock", Model: "mock-fast", RoutingReason: routing.ReasonMatrixRoute,
			MaskingAction: "none", DomainOutcomes: DomainOutcomes{Budget: BudgetOutcome{Outcome: budget.OutcomeWarned}}, CreatedAt: createdAt,
		},
		{
			Status: StatusSuccess, CacheStatus: CacheStatusHit, CacheType: CacheTypeExact,
			ProjectID:         "project_alpha",
			ApplicationID:     "app_demo",
			BudgetScope:       budget.Scope{Type: budget.ScopeTypeTeam, ID: "team_demo", ResolvedBy: budget.ResolvedByControlPlaneRule},
			SavedCostMicroUSD: 50, LatencyMs: 20, Provider: "mock", Model: "mock-fast", RoutingReason: routing.ReasonMatrixRoute,
			MaskingAction: "none", CreatedAt: createdAt.Add(time.Second),
		},
		{Status: StatusBlocked, CacheStatus: CacheStatusBypass, CacheType: CacheTypeNone, MaskingAction: "blocked", CreatedAt: createdAt.Add(2 * time.Second)},
		{
			Status: StatusFailed, CacheStatus: CacheStatusMiss, CacheType: CacheTypeExact,
			ProjectID:    "project_beta",
			PromptTokens: 3, TotalTokens: 3, LatencyMs: 70, Provider: "mock", Model: "mock-balanced",
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
	if overview.StatusCounts[StatusSuccess] != 2 || overview.StatusCounts[StatusBlocked] != 1 || overview.StatusCounts[StatusRateLimited] != 1 || overview.StatusCounts[StatusFailed] != 1 || overview.StatusCounts[StatusCancelled] != 1 {
		t.Fatalf("unexpected status counts: %+v", overview.StatusCounts)
	}
	if overview.MaskingActionCounts["none"] != 4 || overview.MaskingActionCounts["redacted"] != 1 || overview.MaskingActionCounts["blocked"] != 1 {
		t.Fatalf("unexpected masking counts: %+v", overview.MaskingActionCounts)
	}
	if overview.BudgetOutcomeCounts[budget.OutcomeWarned] != 1 || overview.BudgetOutcomeCounts[budget.OutcomeNotChecked] != 5 {
		t.Fatalf("unexpected budget outcome counts: counts=%+v", overview.BudgetOutcomeCounts)
	}
	if len(overview.RoutingCountByModel) != 2 ||
		overview.RoutingCountByModel[0].Category != routing.CategoryGeneral ||
		overview.RoutingCountByModel[0].Difficulty != routing.DifficultySimple ||
		overview.RoutingCountByModel[0].RequestCount != 4 ||
		overview.RoutingCountByModel[1].RoutingReason != routing.ReasonMatrixRoute ||
		overview.RoutingCountByModel[1].RequestCount != 2 {
		t.Fatalf("unexpected routing outcome counts: %+v", overview.RoutingCountByModel)
	}
	if len(overview.CostByModel) != 2 || overview.CostByModel[0].Model != "mock-fast" || overview.CostByModel[0].RequestCount != 2 || overview.CostByModel[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected cost by model: %+v", overview.CostByModel)
	}
	if len(overview.ProjectBreakdown) != 2 || overview.ProjectBreakdown[0].ProjectID != "project_alpha" || overview.ProjectBreakdown[0].RequestCount != 2 || overview.ProjectBreakdown[0].CostUSD != "0.000100" {
		t.Fatalf("unexpected project breakdown: %+v", overview.ProjectBreakdown)
	}
	if len(overview.BudgetScopeBreakdown) != 1 || overview.BudgetScopeBreakdown[0].BudgetScope.Type != budget.ScopeTypeTeam || overview.BudgetScopeBreakdown[0].BudgetScope.ID != "team_demo" || overview.BudgetScopeBreakdown[0].RequestCount != 2 {
		t.Fatalf("unexpected budget scope breakdown: %+v", overview.BudgetScopeBreakdown)
	}
	if overview.DataFreshness.Source != "postgresql_request_log" || overview.DataFreshness.RecordCount != 6 || overview.DataFreshness.LastLogCreatedAt == nil || !overview.DataFreshness.LastLogCreatedAt.Equal(createdAt.Add(5*time.Second)) {
		t.Fatalf("unexpected data freshness: %+v", overview.DataFreshness)
	}
}

func TestBuildDashboardOverviewCacheHitRateUsesOnlyExactCacheEligibleRequests(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 0, 0, 0, time.UTC)
	logs := []LlmInvocationLog{
		{Status: StatusSuccess, CacheStatus: CacheStatusMiss, CacheType: CacheTypeExact, CreatedAt: createdAt},
		{Status: StatusSuccess, CacheStatus: CacheStatusHit, CacheType: CacheTypeExact, CreatedAt: createdAt.Add(time.Second)},
		{Status: StatusSuccess, CacheStatus: CacheStatusMiss, CacheType: CacheTypeSemantic, CreatedAt: createdAt.Add(2 * time.Second)},
		{Status: StatusSuccess, CacheStatus: CacheStatusHit, CacheType: CacheTypeSemantic, CreatedAt: createdAt.Add(3 * time.Second)},
		{Status: StatusFailed, CacheStatus: CacheStatusError, CacheType: CacheTypeSemantic, CreatedAt: createdAt.Add(4 * time.Second)},
	}

	overview := BuildDashboardOverview(logs)

	if overview.CacheHitRequests != 1 || overview.CacheEligibleRequests != 2 {
		t.Fatalf("expected exact-only cache counts, got %+v", overview)
	}
	if overview.CacheHitRate == nil || !floatEquals(*overview.CacheHitRate, 0.5) {
		t.Fatalf("expected exact-only cache hit rate 0.5, got %+v", overview.CacheHitRate)
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

	filter, err = NormalizeProjectLogsFilter(ProjectLogsFilter{
		TenantID:    "tenant_demo",
		ProjectID:   "project_demo",
		From:        from,
		To:          to,
		BudgetScope: budget.Scope{Type: " application ", ID: " app_demo ", ResolvedBy: " default_application "},
	})
	if err != nil {
		t.Fatalf("expected valid budget scope filter, got %v", err)
	}
	if filter.BudgetScope.Type != budget.ScopeTypeApplication || filter.BudgetScope.ID != "app_demo" || filter.BudgetScope.ResolvedBy != budget.ResolvedByDefaultApplication {
		t.Fatalf("unexpected normalized budget scope filter: %+v", filter.BudgetScope)
	}

	for _, invalid := range []budget.Scope{
		{Type: "department", ID: "dept_demo", ResolvedBy: "control_plane_rule"},
		{Type: "application", ID: "app_demo", ResolvedBy: "client_provided"},
		{Type: "application", ID: "", ResolvedBy: "default_application"},
	} {
		_, err = NormalizeProjectLogsFilter(ProjectLogsFilter{
			TenantID:    "tenant_demo",
			ProjectID:   "project_demo",
			From:        from,
			To:          to,
			BudgetScope: invalid,
		})
		if !errors.Is(err, ErrInvalidLogQuery) {
			t.Fatalf("expected invalid budget scope filter %v to fail, got %v", invalid, err)
		}
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

	_, err = NormalizeDashboardOverviewFilter(DashboardOverviewFilter{
		TenantID:    "tenant_demo",
		From:        from,
		To:          to,
		BudgetScope: budget.Scope{Type: "project", ID: "project_demo", ResolvedBy: "client_provided"},
	})
	if !errors.Is(err, ErrInvalidLogQuery) {
		t.Fatalf("expected invalid dashboard budget resolver to fail, got %v", err)
	}
}

func floatEquals(a float64, b float64) bool {
	return math.Abs(a-b) < 0.0000001
}
