package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

func TestProjectLogsHandlerListsLogsWithTenantAndProjectScope(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 2, 3, 0, time.UTC)
	reader := &recordingProjectLogsReader{
		items: []invocationlog.RequestLogListItem{{
			RequestID:        "request_001",
			ProjectID:        "project_demo",
			ApplicationID:    "app_demo",
			Provider:         "mock",
			Model:            "mock-fast",
			RequestedModel:   "auto",
			SelectedModel:    "mock-fast",
			Status:           invocationlog.StatusSuccess,
			HTTPStatus:       http.StatusOK,
			PromptTokens:     32,
			CompletionTokens: 24,
			TotalTokens:      56,
			CostUSD:          "0.000001",
			CostMicroUSD:     1,
			LatencyMs:        132,
			CacheStatus:      invocationlog.CacheStatusMiss,
			CacheType:        invocationlog.CacheTypeExact,
			RoutingReason:    "short_prompt_low_cost",
			MaskingAction:    "none",
			CreatedAt:        createdAt,
		}},
	}
	handler := ProjectLogsHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z&status=success&cacheStatus=miss&limit=20", nil)
	req.SetPathValue("projectId", "project_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_demo" || reader.filter.ProjectID != "project_demo" {
		t.Fatalf("expected tenant/project scope, got %+v", reader.filter)
	}
	if reader.filter.Status != invocationlog.StatusSuccess || reader.filter.CacheStatus != invocationlog.CacheStatusMiss || reader.filter.Limit != 20 {
		t.Fatalf("unexpected filter: %+v", reader.filter)
	}

	body := rr.Body.String()
	var response projectLogsResponse
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(response.Data) != 1 {
		t.Fatalf("expected one item, got %d", len(response.Data))
	}
	item := response.Data[0]
	if item.RequestID != "request_001" || item.SelectedModel != "mock-fast" || item.CostUSD != "0.000001" {
		t.Fatalf("unexpected response item: %+v", item)
	}
	if item.TerminalStatus != invocationlog.StatusSuccess || item.Status != invocationlog.StatusSuccess || item.DomainOutcomes.Cache.Outcome != "miss" {
		t.Fatalf("expected canonical list outcome bridge, got terminal=%s status=%s outcomes=%+v", item.TerminalStatus, item.Status, item.DomainOutcomes)
	}

	for _, forbidden := range []string{
		"redactedPromptPreview",
		"rawPrompt",
		"rawResponse",
		"authorizationHeader",
		"apiKeyPlaintext",
		"appTokenPlaintext",
		"providerApiKey",
		"metadata",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response must not include forbidden field %q: %s", forbidden, body)
		}
	}
}

func TestProjectLogsHandlerRejectsMissingRange(t *testing.T) {
	handler := ProjectLogsHandler{
		Reader:   &recordingProjectLogsReader{},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?to=2026-06-26T00:00:00Z", nil)
	req.SetPathValue("projectId", "project_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestParseRequiredRFC3339QueryAcceptsTimezoneOffsets(t *testing.T) {
	tests := []struct {
		name       string
		rawURL     string
		wantFormat string
	}{
		{
			name:       "utc z",
			rawURL:     "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z",
			wantFormat: "2026-06-25T00:00:00Z",
		},
		{
			name:       "encoded plus offset",
			rawURL:     "/api/projects/project_demo/logs?from=2026-06-25T00:00:00%2B09:00",
			wantFormat: "2026-06-25T00:00:00+09:00",
		},
		{
			name:       "unencoded plus offset decoded as space",
			rawURL:     "/api/projects/project_demo/logs?from=2026-06-25T00:00:00+09:00",
			wantFormat: "2026-06-25T00:00:00+09:00",
		},
		{
			name:       "unencoded plus offset with fractional seconds",
			rawURL:     "/api/projects/project_demo/logs?from=2026-06-25T00:00:00.123+09:00",
			wantFormat: "2026-06-25T00:00:00+09:00",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.rawURL, nil)

			parsed, err := parseRequiredRFC3339Query(req, "from")

			if err != nil {
				t.Fatalf("expected query to parse, got %v", err)
			}
			if parsed.Format(time.RFC3339) != tt.wantFormat {
				t.Fatalf("unexpected parsed time: got %s want %s", parsed.Format(time.RFC3339), tt.wantFormat)
			}
		})
	}
}

func TestParseRequiredRFC3339QueryRejectsInvalidSpace(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00+invalid", nil)

	_, err := parseRequiredRFC3339Query(req, "from")

	if err == nil {
		t.Fatalf("expected invalid RFC3339 query to be rejected")
	}
}

func TestProjectLogsHandlerMapsInvalidReaderQueryToBadRequest(t *testing.T) {
	handler := ProjectLogsHandler{
		Reader:   &recordingProjectLogsReader{err: invocationlog.ErrInvalidLogQuery},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	req.SetPathValue("projectId", "project_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestProjectLogsHandlerMapsUnexpectedReaderErrorToInternalError(t *testing.T) {
	logs := captureStructuredLogs(t)
	handler := ProjectLogsHandler{
		Reader:   &recordingProjectLogsReader{err: errors.New("database unavailable\nauthorization: Bearer secret_token_value")},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	req.Header.Set(middleware.RequestIDHeader, "request_list_500")
	req.SetPathValue("projectId", "project_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	entry := decodeSingleStructuredLog(t, logs)
	if entry["request_id"] != "request_list_500" || entry["stage"] != "list_project_logs" || entry["error_code"] != "internal_error" {
		t.Fatalf("unexpected internal error log context: %+v", entry)
	}
	if entry["tenant_id"] != "tenant_demo" || entry["project_id"] != "project_demo" {
		t.Fatalf("expected tenant/project log context, got %+v", entry)
	}
	errorMessage, ok := entry["error"].(string)
	if !ok {
		t.Fatalf("expected string error log field, got %+v", entry["error"])
	}
	if strings.Contains(errorMessage, "\n") || strings.Contains(errorMessage, "secret_token_value") || !strings.Contains(errorMessage, "[REDACTED]") {
		t.Fatalf("expected sanitized error log field, got %q", errorMessage)
	}
}

func TestRequestDetailHandlerGetsDetailWithTenantProjectAndRequestScope(t *testing.T) {
	providerLatencyMs := int64(86)
	completedAt := time.Date(2026, 6, 25, 1, 2, 4, 0, time.UTC)
	reader := &recordingRequestDetailReader{
		detail: invocationlog.RequestDetail{
			RequestID:      "request_001",
			TraceID:        "trace_001",
			TenantID:       "tenant_demo",
			ProjectID:      "project_demo",
			ApplicationID:  "app_demo",
			Status:         invocationlog.StatusSuccess,
			HTTPStatus:     http.StatusOK,
			Provider:       "mock",
			Model:          "mock-fast",
			RequestedModel: "auto",
			SelectedModel:  "mock-fast",
			Usage: invocationlog.UsageFields{
				PromptTokens:     32,
				CompletionTokens: 24,
				TotalTokens:      56,
			},
			Cost: invocationlog.CostFields{
				CostUSD:      "0.000001",
				CostMicroUSD: 1,
				Currency:     invocationlog.CurrencyUSD,
			},
			Latency: invocationlog.LatencyFields{
				LatencyMs:         132,
				ProviderLatencyMs: &providerLatencyMs,
			},
			Cache: invocationlog.CacheFields{
				CacheStatus:       invocationlog.CacheStatusMiss,
				CacheType:         invocationlog.CacheTypeExact,
				CacheKeyHash:      "hmac-sha256:cache-key-demo",
				CacheHitRequestID: "",
			},
			Routing: invocationlog.RoutingFields{
				RoutingReason:    "short_prompt_low_cost",
				SelectedProvider: "mock",
				SelectedModel:    "mock-fast",
			},
			Masking: invocationlog.MaskingFields{
				MaskingAction:         "redacted",
				MaskingDetectedTypes:  []string{"email"},
				MaskingDetectedCount:  1,
				RedactedPromptPreview: "Send a reply to [EMAIL_REDACTED].",
			},
			RuntimeSnapshot: &runtimeconfig.RuntimeSnapshotProvenance{
				RuntimeSnapshotID:      "runtime_snapshot_detail_test",
				RuntimeSnapshotVersion: 2,
				ContentHash:            "content_hash_detail_test",
				RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
				PublishedAt:            completedAt.Add(-time.Second),
				PublishedBy:            "runtime_config_compat",
				GatewayInstanceID:      "gateway_detail_test",
				LegacyHashes: runtimeconfig.LegacyHashes{
					ConfigHash:         "config_hash_detail_test",
					SecurityPolicyHash: "security_hash_detail_test",
					RoutingPolicyHash:  "route_hash_detail_test",
				},
			},
			Error:       invocationlog.ErrorFields{},
			CreatedAt:   completedAt.Add(-132 * time.Millisecond),
			CompletedAt: &completedAt,
		},
	}
	handler := RequestDetailHandler{
		Reader:    reader,
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_001", nil)
	req.SetPathValue("requestId", "request_001")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_demo" || reader.filter.ProjectID != "project_demo" || reader.filter.RequestID != "request_001" {
		t.Fatalf("expected tenant/project/request scope, got %+v", reader.filter)
	}

	body := rr.Body.String()
	var response requestDetailResponse
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.RequestID != "request_001" || response.Data.Routing.SelectedModel == nil || *response.Data.Routing.SelectedModel != "mock-fast" {
		t.Fatalf("unexpected detail response: %+v", response.Data)
	}
	if response.Data.TerminalStatus != invocationlog.StatusSuccess || response.Data.DomainOutcomes.Safety.Outcome != "redacted" {
		t.Fatalf("expected canonical detail outcome bridge, got terminal=%s outcomes=%+v", response.Data.TerminalStatus, response.Data.DomainOutcomes)
	}
	if response.Data.SafetySummary.Outcome != "redacted" || response.Data.SafetySummary.MaskingAction != "redacted" || response.Data.SafetySummary.DetectedCount != 1 {
		t.Fatalf("expected sanitized safety summary, got %+v", response.Data.SafetySummary)
	}
	if len(response.Data.SafetySummary.DetectorCategories) != 1 || response.Data.SafetySummary.DetectorCategories[0] != "email" {
		t.Fatalf("expected detector category summary, got %+v", response.Data.SafetySummary.DetectorCategories)
	}
	if response.Data.ErrorCode != nil || response.Data.UsageSummary.EstimatedCostMicroUSD != 1 || response.Data.LatencySummary.ProviderLatencyMs == nil {
		t.Fatalf("unexpected optional/summary fields: error=%+v usage=%+v latency=%+v", response.Data.ErrorCode, response.Data.UsageSummary, response.Data.LatencySummary)
	}
	if response.Data.RuntimeSnapshot == nil ||
		response.Data.RuntimeSnapshot.RuntimeSnapshotID != "runtime_snapshot_detail_test" ||
		response.Data.RuntimeSnapshot.RuntimeSnapshotVersion != 2 ||
		response.Data.RuntimeSnapshot.RuntimeState != runtimeconfig.RuntimeStateSnapshotActive ||
		response.Data.RuntimeSnapshot.LegacyHashes == nil ||
		response.Data.RuntimeSnapshot.LegacyHashes.RoutingPolicyHash != "route_hash_detail_test" {
		t.Fatalf("unexpected runtime snapshot response: %+v", response.Data.RuntimeSnapshot)
	}

	for _, forbidden := range []string{
		"rawPrompt",
		"rawResponse",
		"authorizationHeader",
		"apiKeyPlaintext",
		"appTokenPlaintext",
		"providerApiKey",
		"metadata",
		"redactedPromptPreview",
		"cacheKeyHash",
		"cacheHitRequestId",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response must not include forbidden field %q: %s", forbidden, body)
		}
	}
}

func TestRequestDetailHandlerMapsNotFoundTo404(t *testing.T) {
	handler := RequestDetailHandler{
		Reader:    &recordingRequestDetailReader{err: invocationlog.ErrLogNotFound},
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_missing", nil)
	req.SetPathValue("requestId", "request_missing")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestRequestDetailHandlerMapsInvalidReaderQueryToBadRequest(t *testing.T) {
	handler := RequestDetailHandler{
		Reader:    &recordingRequestDetailReader{err: invocationlog.ErrInvalidLogQuery},
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_001", nil)
	req.SetPathValue("requestId", "request_001")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestRequestDetailHandlerMapsUnexpectedReaderErrorToInternalError(t *testing.T) {
	logs := captureStructuredLogs(t)
	handler := RequestDetailHandler{
		Reader:    &recordingRequestDetailReader{err: errors.New("detail query failed")},
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_001", nil)
	req.Header.Set(middleware.RequestIDHeader, "request_detail_500")
	req.SetPathValue("requestId", "request_001")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	entry := decodeSingleStructuredLog(t, logs)
	if entry["request_id"] != "request_detail_500" || entry["stage"] != "get_request_detail" || entry["error_code"] != "internal_error" {
		t.Fatalf("unexpected internal error log context: %+v", entry)
	}
	if entry["tenant_id"] != "tenant_demo" || entry["project_id"] != "project_demo" {
		t.Fatalf("expected tenant/project log context, got %+v", entry)
	}
}

func TestDashboardOverviewHandlerGetsOverviewWithTenantAndOptionalProjectScope(t *testing.T) {
	cacheHitRate := 0.25
	averageLatency := 50.0
	p95Latency := 100.0
	lastLogCreatedAt := time.Date(2026, 6, 25, 0, 30, 0, 0, time.UTC)
	generatedAt := time.Date(2026, 6, 25, 0, 31, 0, 0, time.UTC)
	reader := &recordingDashboardOverviewReader{
		overview: invocationlog.DashboardOverviewFields{
			TotalRequests:         6,
			SuccessfulRequests:    2,
			FailedRequests:        1,
			BlockedRequests:       1,
			RateLimitedRequests:   1,
			CancelledRequests:     1,
			CacheHitRequests:      1,
			CacheEligibleRequests: 4,
			CacheHitRate:          &cacheHitRate,
			PromptTokens:          78,
			CompletionTokens:      115,
			TotalTokens:           193,
			TotalCostMicroUSD:     256,
			TotalCostUSD:          "0.000256",
			SavedCostMicroUSD:     120,
			SavedCostUSD:          "0.000120",
			AverageLatencyMs:      &averageLatency,
			P95LatencyMs:          &p95Latency,
			AverageResponseTimeMs: &averageLatency,
			MaskingActionCounts: map[string]int64{
				"none":     4,
				"redacted": 1,
				"blocked":  1,
			},
			RoutingCountByModel: []invocationlog.RoutingCountByModel{{
				SelectedProvider: "mock",
				SelectedModel:    "mock-fast",
				RoutingReason:    "short_prompt_low_cost",
				RequestCount:     3,
			}},
			StatusCounts: map[string]int64{
				invocationlog.StatusSuccess:     3,
				invocationlog.StatusBlocked:     1,
				invocationlog.StatusRateLimited: 1,
				invocationlog.StatusFailed:      1,
			},
			CostByModel: []invocationlog.CostByModel{{
				SelectedProvider: "mock",
				SelectedModel:    "mock-fast",
				RequestCount:     3,
				TotalTokens:      193,
				CostMicroUSD:     256,
				CostUSD:          "0.000256",
			}},
			DataFreshness: invocationlog.DashboardDataFreshness{
				Source:           "postgresql_request_log",
				RecordCount:      6,
				LastLogCreatedAt: &lastLogCreatedAt,
				GeneratedAt:      generatedAt,
			},
			GeneratedAt: generatedAt,
			Freshness: invocationlog.DashboardFreshnessFields{
				LastIngestedAt:   lastLogCreatedAt,
				LastAggregatedAt: generatedAt,
				Source:           "request_log",
				IsStale:          false,
			},
			QueryBudget: invocationlog.DashboardQueryBudgetFields{
				Status:            "ok",
				MaxRangeHours:     24,
				MaxBreakdownItems: 50,
			},
			Breakdowns: invocationlog.DashboardBreakdowns{
				BySafetyOutcome: []invocationlog.OutcomeBreakdown{
					{Outcome: "passed", RequestCount: 4},
					{Outcome: "blocked", RequestCount: 1},
					{Outcome: "redacted", RequestCount: 1},
				},
				ByCacheOutcome: []invocationlog.OutcomeBreakdown{
					{Outcome: "hit", RequestCount: 1},
					{Outcome: "miss", RequestCount: 3},
				},
				ByFallbackOutcome: []invocationlog.OutcomeBreakdown{
					{Outcome: "success", RequestCount: 1},
				},
				ByTerminalStatus: []invocationlog.OutcomeBreakdown{
					{Outcome: invocationlog.StatusSuccess, RequestCount: 3},
					{Outcome: invocationlog.StatusBlocked, RequestCount: 1},
					{Outcome: invocationlog.StatusRateLimited, RequestCount: 1},
					{Outcome: invocationlog.StatusFailed, RequestCount: 1},
				},
			},
			Performance: invocationlog.DashboardPerformanceFields{
				P95GatewayInternalLatencyMs: 100,
				P99GatewayInternalLatencyMs: 100,
				P95ProviderLatencyMs:        86,
				P99ProviderLatencyMs:        86,
				SystemErrorRate:             1.0 / 6.0,
			},
		},
	}
	handler := DashboardOverviewHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?projectId=project_demo&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_demo" || reader.filter.ProjectID != "project_demo" {
		t.Fatalf("expected tenant/project dashboard scope, got %+v", reader.filter)
	}

	body := rr.Body.String()
	var response dashboardOverviewResponse
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.Totals.RequestCount != 6 || response.Data.Totals.SuccessCount != 2 || response.Data.Totals.FailedCount != 1 || response.Data.Totals.BlockedCount != 1 || response.Data.Totals.RateLimitedCount != 1 {
		t.Fatalf("unexpected dashboard totals: %+v", response.Data.Totals)
	}
	if response.Data.Totals.ExactCacheHitRate != 0.25 {
		t.Fatalf("unexpected exact cache hit rate: %+v", response.Data.Totals.ExactCacheHitRate)
	}
	if response.Data.Totals.EstimatedCostMicroUSD != 256 || response.Data.Totals.FallbackSuccessCount != 1 || response.Data.Totals.CancelledCount != 1 {
		t.Fatalf("unexpected cost/fallback totals: %+v", response.Data.Totals)
	}
	if response.Data.Performance.P95GatewayInternalLatencyMs != 100 || response.Data.Performance.SystemErrorRate != 1.0/6.0 {
		t.Fatalf("unexpected performance summary: %+v", response.Data.Performance)
	}
	if len(response.Data.Breakdowns.BySafetyOutcome) != 3 || response.Data.Breakdowns.BySafetyOutcome[1].Outcome != "blocked" {
		t.Fatalf("unexpected safety outcome breakdown: %+v", response.Data.Breakdowns.BySafetyOutcome)
	}
	if len(response.Data.Breakdowns.ByTerminalStatus) != 4 || response.Data.Breakdowns.ByTerminalStatus[2].Outcome != invocationlog.StatusRateLimited {
		t.Fatalf("unexpected terminal status breakdown: %+v", response.Data.Breakdowns.ByTerminalStatus)
	}
	if response.Data.Freshness.Source != "request_log" || !response.Data.Freshness.LastIngestedAt.Equal(lastLogCreatedAt) || !response.Data.GeneratedAt.Equal(generatedAt) {
		t.Fatalf("unexpected freshness: %+v generated=%s", response.Data.Freshness, response.Data.GeneratedAt)
	}
	if response.Data.Filters.ProjectID == nil || *response.Data.Filters.ProjectID != "project_demo" {
		t.Fatalf("unexpected dashboard filter: %+v", response.Data.Filters)
	}

	for _, forbidden := range []string{
		"rawPrompt",
		"rawResponse",
		"authorizationHeader",
		"apiKeyPlaintext",
		"appTokenPlaintext",
		"providerApiKey",
		"metadata",
		"redactedPromptPreview",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response must not include forbidden field %q: %s", forbidden, body)
		}
	}
}

func TestDashboardOverviewHandlerRejectsMissingRange(t *testing.T) {
	handler := DashboardOverviewHandler{
		Reader:   &recordingDashboardOverviewReader{},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestDashboardOverviewHandlerMapsInvalidReaderQueryToBadRequest(t *testing.T) {
	handler := DashboardOverviewHandler{
		Reader:   &recordingDashboardOverviewReader{err: invocationlog.ErrInvalidLogQuery},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestDashboardOverviewHandlerMapsUnexpectedReaderErrorToInternalError(t *testing.T) {
	logs := captureStructuredLogs(t)
	handler := DashboardOverviewHandler{
		Reader:   &recordingDashboardOverviewReader{err: errors.New("overview query failed")},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?projectId=project_demo&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	req.Header.Set(middleware.RequestIDHeader, "request_dashboard_500")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	entry := decodeSingleStructuredLog(t, logs)
	if entry["request_id"] != "request_dashboard_500" || entry["stage"] != "get_dashboard_overview" || entry["error_code"] != "internal_error" {
		t.Fatalf("unexpected internal error log context: %+v", entry)
	}
	if entry["tenant_id"] != "tenant_demo" || entry["project_id"] != "project_demo" {
		t.Fatalf("expected tenant/project log context, got %+v", entry)
	}
}

func captureStructuredLogs(t *testing.T) *bytes.Buffer {
	t.Helper()

	var buffer bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buffer, nil)))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})
	return &buffer
}

func decodeSingleStructuredLog(t *testing.T, logs *bytes.Buffer) map[string]any {
	t.Helper()

	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 1 || lines[0] == "" {
		t.Fatalf("expected one structured log entry, got %q", logs.String())
	}

	var entry map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &entry); err != nil {
		t.Fatalf("decode structured log: %v; log=%s", err, lines[0])
	}
	return entry
}

type recordingProjectLogsReader struct {
	filter invocationlog.ProjectLogsFilter
	items  []invocationlog.RequestLogListItem
	err    error
}

func (r *recordingProjectLogsReader) ListProjectLogs(_ context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	r.filter = filter
	if r.err != nil {
		return nil, r.err
	}
	return r.items, nil
}

type recordingRequestDetailReader struct {
	filter invocationlog.RequestDetailFilter
	detail invocationlog.RequestDetail
	err    error
}

func (r *recordingRequestDetailReader) GetRequestDetail(_ context.Context, filter invocationlog.RequestDetailFilter) (invocationlog.RequestDetail, error) {
	r.filter = filter
	if r.err != nil {
		return invocationlog.RequestDetail{}, r.err
	}
	return r.detail, nil
}

type recordingDashboardOverviewReader struct {
	filter   invocationlog.DashboardOverviewFilter
	overview invocationlog.DashboardOverviewFields
	err      error
}

func (r *recordingDashboardOverviewReader) GetDashboardOverview(_ context.Context, filter invocationlog.DashboardOverviewFilter) (invocationlog.DashboardOverviewFields, error) {
	r.filter = filter
	if r.err != nil {
		return invocationlog.DashboardOverviewFields{}, r.err
	}
	return r.overview, nil
}
