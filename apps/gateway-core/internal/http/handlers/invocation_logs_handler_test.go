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

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

func TestProjectLogsHandlerListsLogsWithTenantAndProjectScope(t *testing.T) {
	createdAt := time.Date(2026, 6, 25, 1, 2, 3, 0, time.UTC)
	ttftMs := int64(84)
	reader := &recordingProjectLogsReader{
		items: []invocationlog.RequestLogListItem{{
			RequestID:      "request_001",
			ProjectID:      "project_demo",
			ApplicationID:  "app_demo",
			UserRef:        "Yoonji",
			RequestedModel: "auto",
			ProviderAttempt: &invocationlog.ProviderAttemptFields{
				ProviderID: "provider_openai",
				ModelID:    "gpt-4o-mini",
				Outcome:    "success",
			},
			Status:           invocationlog.StatusSuccess,
			HTTPStatus:       http.StatusOK,
			PromptTokens:     32,
			CompletionTokens: 24,
			TotalTokens:      56,
			CostUSD:          "0.000001",
			CostMicroUSD:     1,
			LatencyMs:        132,
			TTFTMs:           &ttftMs,
			CacheStatus:      invocationlog.CacheStatusMiss,
			CacheType:        invocationlog.CacheTypeExact,
			RoutingReason:    routing.ReasonMatrixRoute,
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
	if item.RequestID != "request_001" || item.RequestedModel != "auto" || item.CostUSD != "0.000001" {
		t.Fatalf("unexpected response item: %+v", item)
	}
	if item.UserRef == nil || *item.UserRef != "Yoonji" {
		t.Fatalf("unexpected user ref: %+v", item)
	}
	if item.ProviderAttempt == nil || item.ProviderAttempt.ProviderID != "provider_openai" || item.ProviderAttempt.ModelID != "gpt-4o-mini" {
		t.Fatalf("unexpected provider attempt: %+v", item.ProviderAttempt)
	}
	if item.TTFTMs == nil || *item.TTFTMs != 84 {
		t.Fatalf("unexpected TTFT: %+v", item.TTFTMs)
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

func TestProjectLogsHandlerUsesTenantQueryOverride(t *testing.T) {
	reader := &recordingProjectLogsReader{}
	handler := ProjectLogsHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_live/logs?tenantId=tenant_live&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	req.SetPathValue("projectId", "project_live")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_live" || reader.filter.ProjectID != "project_live" {
		t.Fatalf("expected query tenant and path project scope, got %+v", reader.filter)
	}
}

func TestProjectLogsHandlerIncludesFilterOptionsMetaWhenRequested(t *testing.T) {
	reader := &recordingProjectLogsReader{
		filterOptions: invocationlog.RequestLogFilterOptions{
			RequestedModels: []string{"auto", "mock-fast"},
			BudgetScopes: []budget.Scope{{
				Type:       "application",
				ID:         "app_demo",
				ResolvedBy: "default_application",
			}},
		},
	}
	handler := ProjectLogsHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z&status=success&model=ignored-by-options&includeFilterOptions=true", nil)
	req.SetPathValue("projectId", "project_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.optionFilter.TenantID != "tenant_demo" || reader.optionFilter.ProjectID != "project_demo" {
		t.Fatalf("expected option query to use tenant/project scope, got %+v", reader.optionFilter)
	}
	var response projectLogsResponse
	if err := json.NewDecoder(strings.NewReader(rr.Body.String())).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Meta == nil {
		t.Fatalf("expected meta filter options in response: %s", rr.Body.String())
	}
	if got := response.Meta.FilterOptions.RequestedModels; len(got) != 2 || got[0] != "auto" || got[1] != "mock-fast" {
		t.Fatalf("unexpected requested model options: %#v", got)
	}
	if got := response.Meta.FilterOptions.BudgetScopes; len(got) != 1 ||
		got[0].BudgetScopeType != "application" ||
		got[0].BudgetScopeID != "app_demo" ||
		got[0].ResolvedBy != "default_application" {
		t.Fatalf("unexpected budget scope options: %#v", got)
	}
	for _, forbidden := range []string{
		"rawPrompt",
		"rawResponse",
		"authorizationHeader",
		"apiKeyPlaintext",
		"appTokenPlaintext",
		"providerApiKey",
		"requestBodyHash",
		"promptHash",
		"cacheKeyHash",
	} {
		if strings.Contains(rr.Body.String(), forbidden) {
			t.Fatalf("filter options response must not include forbidden field %q: %s", forbidden, rr.Body.String())
		}
	}
}

func TestProjectLogsHandlerSerializesEmptyFilterOptionsAsArrays(t *testing.T) {
	reader := &recordingProjectLogsReader{}
	handler := ProjectLogsHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/project_demo/logs?from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z&includeFilterOptions=true", nil)
	req.SetPathValue("projectId", "project_demo")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if strings.Contains(body, `"requestedModels":null`) || !strings.Contains(body, `"requestedModels":[]`) {
		t.Fatalf("expected empty requested model options to serialize as [], got: %s", body)
	}
	if strings.Contains(body, `"budgetScopes":null`) || !strings.Contains(body, `"budgetScopes":[]`) {
		t.Fatalf("expected empty budget scope options to serialize as [], got: %s", body)
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
	ttftMs := int64(84)
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
			RequestedModel: "auto",
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
				TTFTMs:            &ttftMs,
			},
			LatencySummary: invocationlog.LatencySummaryFields{
				GatewayInternalLatencyMs: 46,
				ProviderLatencyMs:        &providerLatencyMs,
				TotalLatencyMs:           132,
				TTFTMs:                   &ttftMs,
			},
			Cache: invocationlog.CacheFields{
				CacheStatus:       invocationlog.CacheStatusMiss,
				CacheType:         invocationlog.CacheTypeExact,
				CacheKeyHash:      "hmac-sha256:cache-key-demo",
				CacheHitRequestID: "",
			},
			Routing: invocationlog.RoutingFields{
				RoutingReason: "category_difficulty_matrix",
				Category:      "general",
				Difficulty:    "simple",
			},
			Masking: invocationlog.MaskingFields{
				MaskingAction:         "redacted",
				MaskingDetectedTypes:  []string{"email"},
				MaskingDetectedCount:  1,
				RedactedPromptPreview: "Send a reply to [EMAIL_1].",
			},
			PromptCapture: invocationlog.PromptCaptureFields{
				Enabled:        true,
				Mode:           runtimeconfig.PromptCaptureModeLogSafeFull,
				Visibility:     invocationlog.PromptCaptureVisibilityAdminRequestDetail,
				CapturedPrompt: "Send a reply to [EMAIL_REDACTED].",
				Truncated:      false,
				MaxChars:       8000,
			},
			ResponseCapture: invocationlog.ResponseCaptureFields{
				Enabled:          true,
				Mode:             runtimeconfig.ResponseCaptureModeRawFull,
				Visibility:       invocationlog.ResponseCaptureVisibilityAdminRequestDetail,
				CapturedResponse: "Mock response",
				Truncated:        false,
				MaxChars:         8000,
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
	if response.Data.RequestID != "request_001" || response.Data.Routing.Category == nil || *response.Data.Routing.Category != "general" {
		t.Fatalf("unexpected detail response: %+v", response.Data)
	}
	if response.Data.Masking.RedactedPromptPreview == nil || *response.Data.Masking.RedactedPromptPreview != "Send a reply to [EMAIL_1]." {
		t.Fatalf("expected redacted prompt preview, got %+v", response.Data.Masking)
	}
	if !response.Data.PromptCapture.Enabled ||
		response.Data.PromptCapture.CapturedPrompt == nil ||
		*response.Data.PromptCapture.CapturedPrompt != "Send a reply to [EMAIL_REDACTED]." ||
		response.Data.PromptCapture.Visibility != invocationlog.PromptCaptureVisibilityAdminRequestDetail {
		t.Fatalf("unexpected prompt capture response: %+v", response.Data.PromptCapture)
	}
	if !response.Data.ResponseCapture.Enabled ||
		response.Data.ResponseCapture.CapturedResponse != nil ||
		response.Data.ResponseCapture.Visibility != invocationlog.ResponseCaptureVisibilityAdminRequestDetail {
		t.Fatalf("unexpected response capture response: %+v", response.Data.ResponseCapture)
	}
	if response.Data.Cache.CacheHitRequestID != nil || response.Data.Error.ErrorCode != nil {
		t.Fatalf("expected empty optional fields to be null, got cache=%+v error=%+v", response.Data.Cache, response.Data.Error)
	}
	if response.Data.Latency.TTFTMs == nil || *response.Data.Latency.TTFTMs != 84 || response.Data.LatencySummary.TTFTMs == nil || *response.Data.LatencySummary.TTFTMs != 84 {
		t.Fatalf("unexpected detail TTFT response: latency=%+v summary=%+v", response.Data.Latency, response.Data.LatencySummary)
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
		"Mock response",
		"metadata",
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response must not include forbidden field %q: %s", forbidden, body)
		}
	}
}

func TestRequestDetailHandlerUsesTenantProjectQueryOverride(t *testing.T) {
	reader := &recordingRequestDetailReader{
		detail: invocationlog.RequestDetail{
			RequestID:  "request_live",
			TenantID:   "tenant_live",
			ProjectID:  "project_live",
			Status:     invocationlog.StatusSuccess,
			HTTPStatus: http.StatusOK,
			Masking:    invocationlog.MaskingFields{MaskingAction: "none"},
		},
	}
	handler := RequestDetailHandler{
		Reader:    reader,
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_live?tenantId=tenant_live&projectId=project_live", nil)
	req.SetPathValue("requestId", "request_live")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_live" || reader.filter.ProjectID != "project_live" || reader.filter.RequestID != "request_live" {
		t.Fatalf("expected query tenant/project and path request scope, got %+v", reader.filter)
	}
}

func TestRequestDetailHandlerSerializesNoCallProviderAttemptAsNull(t *testing.T) {
	handler := RequestDetailHandler{
		Reader: &recordingRequestDetailReader{detail: invocationlog.RequestDetail{
			RequestID:       "request_cache_hit_no_call",
			TenantID:        "tenant_demo",
			ProjectID:       "project_demo",
			Status:          invocationlog.StatusSuccess,
			HTTPStatus:      http.StatusOK,
			RequestedModel:  "auto",
			ProviderCalled:  false,
			ProviderAttempt: nil,
			Cache:           invocationlog.CacheFields{CacheStatus: invocationlog.CacheStatusHit, CacheType: invocationlog.CacheTypeExact},
			Masking:         invocationlog.MaskingFields{MaskingAction: "none"},
		}},
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/llm-requests/request_cache_hit_no_call", nil)
	req.SetPathValue("requestId", "request_cache_hit_no_call")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var envelope map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode detail response: %v", err)
	}
	data, ok := envelope["data"].(map[string]any)
	if !ok {
		t.Fatalf("missing detail data: %#v", envelope)
	}
	attempt, exists := data["providerAttempt"]
	if !exists || attempt != nil {
		t.Fatalf("no-call detail must contain providerAttempt:null, got %#v", data)
	}
	if called, ok := data["providerCalled"].(bool); !ok || called {
		t.Fatalf("no-call detail must expose providerCalled:false, got %#v", data["providerCalled"])
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
	averageTTFT := 80.0
	p50TTFT := 70.0
	p95TTFT := 110.0
	p99TTFT := 130.0
	coverageRate := 0.75
	lastLogCreatedAt := time.Date(2026, 6, 25, 0, 30, 0, 0, time.UTC)
	generatedAt := time.Date(2026, 6, 25, 0, 31, 0, 0, time.UTC)
	reader := &recordingDashboardOverviewReader{
		overview: invocationlog.DashboardOverviewFields{
			TotalRequests:         6,
			SuccessfulRequests:    2,
			FailedRequests:        1,
			BlockedRequests:       1,
			RateLimitedRequests:   1,
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
			Performance: invocationlog.DashboardPerformance{
				GatewayTTFT: invocationlog.DashboardGatewayTTFT{
					Scope:                  "project_application",
					AverageMs:              &averageTTFT,
					P50Ms:                  &p50TTFT,
					P95Ms:                  &p95TTFT,
					P99Ms:                  &p99TTFT,
					EligibleStreamRequests: 4,
					ObservedRequests:       3,
					CoverageRate:           &coverageRate,
				},
			},
			MaskingActionCounts: map[string]int64{
				"none":     4,
				"redacted": 1,
				"blocked":  1,
			},
			RoutingCountByModel: []invocationlog.RoutingCountByModel{{
				Category:      "general",
				Difficulty:    "simple",
				RoutingReason: "category_difficulty_matrix",
				RequestCount:  3,
			}},
			StatusCounts: map[string]int64{
				invocationlog.StatusSuccess:     3,
				invocationlog.StatusBlocked:     1,
				invocationlog.StatusRateLimited: 1,
				invocationlog.StatusFailed:      1,
			},
			CostByModel: []invocationlog.CostByModel{{
				Provider:     "mock",
				Model:        "mock-fast",
				RequestCount: 3,
				TotalTokens:  193,
				CostMicroUSD: 256,
				CostUSD:      "0.000256",
			}},
			ProjectBreakdown: []invocationlog.ProjectBreakdown{{
				ProjectID:        "project_demo",
				RequestCount:     6,
				PromptTokens:     78,
				CompletionTokens: 115,
				TotalTokens:      193,
				CostMicroUSD:     256,
				CostUSD:          "0.000256",
			}},
			BudgetScopeBreakdown: []invocationlog.BudgetScopeBreakdown{{
				BudgetScope:  budget.Scope{Type: budget.ScopeTypeTeam, ID: "team_demo", ResolvedBy: budget.ResolvedByControlPlaneRule},
				RequestCount: 6,
				CostMicroUSD: 256,
				CostUSD:      "0.000256",
			}},
			DataFreshness: invocationlog.DashboardDataFreshness{
				Source:           "postgresql_request_log",
				RecordCount:      6,
				LastLogCreatedAt: &lastLogCreatedAt,
				GeneratedAt:      generatedAt,
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
	if response.Data.Totals.TotalRequests != 6 || response.Data.Totals.SuccessfulRequests != 2 || response.Data.Totals.FailedRequests != 1 || response.Data.Totals.BlockedRequests != 1 || response.Data.Totals.RateLimitedRequests != 1 {
		t.Fatalf("unexpected dashboard totals: %+v", response.Data.Totals)
	}
	if response.Data.Totals.CacheEligibleRequests != 4 || response.Data.Totals.CacheHitRate == nil || *response.Data.Totals.CacheHitRate != 0.25 {
		t.Fatalf("unexpected cache hit rate: %+v", response.Data.Totals.CacheHitRate)
	}
	if response.Data.Totals.PromptTokens != 78 || response.Data.Totals.CompletionTokens != 115 || response.Data.Totals.TotalTokens != 193 || response.Data.Totals.TotalCostUSD != "0.000256" || response.Data.Totals.SavedCostUSD != "0.000120" {
		t.Fatalf("unexpected token/cost totals: %+v", response.Data.Totals)
	}
	if response.Data.Totals.AverageLatencyMs == nil || *response.Data.Totals.AverageLatencyMs != 50 || response.Data.Totals.P95LatencyMs == nil || *response.Data.Totals.P95LatencyMs != 100 {
		t.Fatalf("unexpected latency totals: %+v", response.Data.Totals)
	}
	if response.Data.Totals.AverageResponseTimeMs == nil || *response.Data.Totals.AverageResponseTimeMs != 50 {
		t.Fatalf("expected average response time compatibility field, got %+v", response.Data.Totals.AverageResponseTimeMs)
	}
	if response.Data.Performance.GatewayTTFT.Scope != "project_application" ||
		response.Data.Performance.GatewayTTFT.P95Ms == nil || *response.Data.Performance.GatewayTTFT.P95Ms != 110 ||
		response.Data.Performance.GatewayTTFT.EligibleStreamRequests != 4 ||
		response.Data.Performance.GatewayTTFT.ObservedRequests != 3 ||
		response.Data.Performance.GatewayTTFT.CoverageRate == nil || *response.Data.Performance.GatewayTTFT.CoverageRate != 0.75 {
		t.Fatalf("unexpected gateway TTFT response: %+v", response.Data.Performance.GatewayTTFT)
	}
	if response.Data.Totals.StatusCounts[invocationlog.StatusRateLimited] != 1 || response.Data.Totals.MaskingActionCounts["blocked"] != 1 {
		t.Fatalf("unexpected rollup counts: status=%+v masking=%+v", response.Data.Totals.StatusCounts, response.Data.Totals.MaskingActionCounts)
	}
	if len(response.Data.Totals.RoutingCountByModel) != 1 || response.Data.Totals.RoutingCountByModel[0].Category != "general" {
		t.Fatalf("unexpected routing count by model: %+v", response.Data.Totals.RoutingCountByModel)
	}
	if len(response.Data.Totals.CostByModel) != 1 || response.Data.Totals.CostByModel[0].CostUSD != "0.000256" {
		t.Fatalf("unexpected cost by model: %+v", response.Data.Totals.CostByModel)
	}
	if len(response.Data.Totals.CostByProject) != 1 || response.Data.Totals.CostByProject[0].ProjectID != "project_demo" || response.Data.Totals.CostByProject[0].CostUSD != "0.000256" {
		t.Fatalf("unexpected cost by project: %+v", response.Data.Totals.CostByProject)
	}
	if len(response.Data.Breakdowns.ByProject) != 1 || response.Data.Breakdowns.ByProject[0].ProjectID != "project_demo" {
		t.Fatalf("unexpected project breakdown response: %+v", response.Data.Breakdowns.ByProject)
	}
	if response.Data.DataFreshness.Source != "postgresql_request_log" || response.Data.DataFreshness.RecordCount != 6 || response.Data.DataFreshness.LastLogCreatedAt == nil || !response.Data.DataFreshness.LastLogCreatedAt.Equal(lastLogCreatedAt) || !response.Data.DataFreshness.GeneratedAt.Equal(generatedAt) {
		t.Fatalf("unexpected data freshness: %+v", response.Data.DataFreshness)
	}
	if response.Data.Filter.ProjectID == nil || *response.Data.Filter.ProjectID != "project_demo" {
		t.Fatalf("unexpected dashboard filter: %+v", response.Data.Filter)
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

func TestDashboardOverviewHandlerUsesTenantQueryOverride(t *testing.T) {
	reader := &recordingDashboardOverviewReader{}
	handler := DashboardOverviewHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview?tenantId=tenant_live&projectId=project_live&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_live" || reader.filter.ProjectID != "project_live" {
		t.Fatalf("expected query tenant/project dashboard scope, got %+v", reader.filter)
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

func TestAnalyticsPerformanceHandlerReturnsAggregatesAndSafeFields(t *testing.T) {
	generatedAt := time.Date(2026, 6, 25, 1, 0, 0, 0, time.UTC)
	lastLogCreatedAt := time.Date(2026, 6, 25, 0, 59, 0, 0, time.UTC)
	avgLatency := 420.0
	p95Latency := 2153.0
	p99Latency := 4102.0
	throughput := 12.5
	errorRate := 0.03
	cacheHitRate := 0.34
	costPerRequest := 0.0031
	reader := &recordingAnalyticsPerformanceReader{
		performance: invocationlog.AnalyticsPerformanceFields{
			Summary: invocationlog.AnalyticsPerformanceSummary{
				AvgLatencyMs:        &avgLatency,
				P95LatencyMs:        &p95Latency,
				P99LatencyMs:        &p99Latency,
				ThroughputPerMinute: &throughput,
				ErrorRate:           &errorRate,
				TotalRequests:       129512,
			},
			ProviderModelPerformance: []invocationlog.AnalyticsProviderModelPerformance{{
				Provider:          "OpenAI",
				Model:             "gpt-4o-mini",
				Requests:          129512,
				AvgLatencyMs:      &avgLatency,
				P95LatencyMs:      &p95Latency,
				P99LatencyMs:      &p99Latency,
				ErrorRate:         &errorRate,
				CostPerRequestUSD: &costPerRequest,
				TotalCostMicroUSD: 401120000,
				TotalCostUSD:      "401.120000",
				CacheHitRate:      &cacheHitRate,
			}},
			P95LatencyByProvider: []invocationlog.AnalyticsProviderLatency{{
				Provider:     "OpenAI",
				P95LatencyMs: &p95Latency,
				Requests:     129512,
			}},
			LatencyDistribution: []invocationlog.AnalyticsLatencyDistributionBucket{{
				Bucket:       time.Date(2026, 6, 25, 0, 0, 0, 0, time.UTC),
				P50LatencyMs: &avgLatency,
				P95LatencyMs: &p95Latency,
				P99LatencyMs: &p99Latency,
				Requests:     100,
			}},
			SlowestRequests: []invocationlog.AnalyticsSlowRequest{{
				RequestID:      "request_slow_001",
				ProjectID:      "project_demo",
				Provider:       "OpenAI",
				Model:          "gpt-4o-mini",
				LatencyMs:      12340,
				HTTPStatus:     200,
				TerminalStatus: invocationlog.StatusSuccess,
				CreatedAt:      lastLogCreatedAt,
			}},
			BucketInterval:      "1h",
			ExpectedBucketCount: 24,
			DataFreshness: invocationlog.DashboardDataFreshness{
				Source:           "postgresql_request_log",
				RecordCount:      129512,
				LastLogCreatedAt: &lastLogCreatedAt,
				GeneratedAt:      generatedAt,
			},
		},
	}
	handler := AnalyticsPerformanceHandler{
		Reader:   reader,
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/analytics/performance?projectId=project_demo&provider=OpenAI&model=gpt-4o-mini&from=2026-06-25T00:00:00Z&to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if reader.filter.TenantID != "tenant_demo" || reader.filter.ProjectID != "project_demo" || reader.filter.Provider != "OpenAI" || reader.filter.Model != "gpt-4o-mini" {
		t.Fatalf("unexpected analytics filter: %+v", reader.filter)
	}
	var response analyticsPerformanceResponse
	if err := json.NewDecoder(strings.NewReader(rr.Body.String())).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Data.Summary.TotalRequests != 129512 || response.Data.Summary.P95LatencyMs == nil || *response.Data.Summary.P95LatencyMs != p95Latency {
		t.Fatalf("unexpected summary: %+v", response.Data.Summary)
	}
	if len(response.Data.ProviderModelPerformance) != 1 || response.Data.ProviderModelPerformance[0].Provider != "OpenAI" || response.Data.ProviderModelPerformance[0].TotalCostUSD != "401.120000" {
		t.Fatalf("unexpected provider/model performance: %+v", response.Data.ProviderModelPerformance)
	}
	if len(response.Data.LatencyDistribution) != 1 || response.Data.LatencyDistribution[0].Label != "00:00" {
		t.Fatalf("unexpected latency distribution: %+v", response.Data.LatencyDistribution)
	}
	if response.Data.BucketInterval != "1h" || response.Data.ExpectedBucketCount != 24 {
		t.Fatalf("unexpected bucket metadata: interval=%s count=%d", response.Data.BucketInterval, response.Data.ExpectedBucketCount)
	}
	if len(response.Data.SlowestRequests) != 1 || response.Data.SlowestRequests[0].RequestID != "request_slow_001" {
		t.Fatalf("unexpected slowest requests: %+v", response.Data.SlowestRequests)
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
		if strings.Contains(rr.Body.String(), forbidden) {
			t.Fatalf("response must not include forbidden field %q: %s", forbidden, rr.Body.String())
		}
	}
}

func TestAnalyticsPerformanceHandlerRejectsMissingRange(t *testing.T) {
	handler := AnalyticsPerformanceHandler{
		Reader:   &recordingAnalyticsPerformanceReader{},
		TenantID: "tenant_demo",
	}
	req := httptest.NewRequest(http.MethodGet, "/api/analytics/performance?to=2026-06-26T00:00:00Z", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
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
	filter        invocationlog.ProjectLogsFilter
	optionFilter  invocationlog.ProjectLogsFilter
	items         []invocationlog.RequestLogListItem
	filterOptions invocationlog.RequestLogFilterOptions
	err           error
	optionErr     error
}

func (r *recordingProjectLogsReader) ListProjectLogs(_ context.Context, filter invocationlog.ProjectLogsFilter) ([]invocationlog.RequestLogListItem, error) {
	r.filter = filter
	if r.err != nil {
		return nil, r.err
	}
	return r.items, nil
}

func (r *recordingProjectLogsReader) ListProjectLogFilterOptions(_ context.Context, filter invocationlog.ProjectLogsFilter) (invocationlog.RequestLogFilterOptions, error) {
	r.optionFilter = filter
	if r.optionErr != nil {
		return invocationlog.RequestLogFilterOptions{}, r.optionErr
	}
	return r.filterOptions, nil
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

type recordingAnalyticsPerformanceReader struct {
	filter      invocationlog.AnalyticsPerformanceFilter
	performance invocationlog.AnalyticsPerformanceFields
	err         error
}

func (r *recordingAnalyticsPerformanceReader) GetAnalyticsPerformance(_ context.Context, filter invocationlog.AnalyticsPerformanceFilter) (invocationlog.AnalyticsPerformanceFields, error) {
	r.filter = filter
	if r.err != nil {
		return invocationlog.AnalyticsPerformanceFields{}, r.err
	}
	return r.performance, nil
}
