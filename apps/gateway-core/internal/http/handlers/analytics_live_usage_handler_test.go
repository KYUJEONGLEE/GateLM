package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

type recordingAnalyticsLiveUsageReader struct {
	fields invocationlog.AnalyticsLiveUsageFields
	filter invocationlog.AnalyticsLiveUsageFilter
	err    error
}

func (r *recordingAnalyticsLiveUsageReader) GetAnalyticsLiveUsage(
	_ context.Context,
	filter invocationlog.AnalyticsLiveUsageFilter,
) (invocationlog.AnalyticsLiveUsageFields, error) {
	r.filter = filter
	return r.fields, r.err
}

func TestAnalyticsLiveUsageHandlerReturnsSafeAggregate(t *testing.T) {
	from := time.Date(2026, 7, 24, 3, 0, 0, 0, time.UTC)
	reader := &recordingAnalyticsLiveUsageReader{
		fields: invocationlog.AnalyticsLiveUsageFields{
			BucketIntervalSeconds: 5,
			CurrentWindowSeconds:  5,
			DeltaWindowSeconds:    10,
			Summary: invocationlog.AnalyticsLiveUsageSummary{
				RequestCount:            10,
				ProcessedRequestCount:   8,
				RateLimitedRequestCount: 2,
				CurrentIncomingRPS:      1.2,
				PeakIncomingRPS:         4,
			},
			Projects: []invocationlog.AnalyticsLiveUsageProject{{
				ProjectID:               "project-1",
				RequestCount:            10,
				ProcessedRequestCount:   8,
				RateLimitedRequestCount: 2,
				CurrentIncomingRPS:      1.2,
				Trend:                   "stable",
			}},
			DataFreshness: invocationlog.DashboardDataFreshness{
				Source:      "clickhouse_project_application",
				RecordCount: 10,
				GeneratedAt: from.Add(15 * time.Minute),
			},
		},
	}
	handler := AnalyticsLiveUsageHandler{Reader: reader, TenantID: "tenant-default"}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/analytics/live-usage?tenantId=tenant-1&projectId=project-1&from=2026-07-24T03:00:00Z&to=2026-07-24T03:15:00Z",
		nil,
	)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if reader.filter.TenantID != "tenant-1" || reader.filter.ProjectID != "project-1" {
		t.Fatalf("unexpected scoped filter: %+v", reader.filter)
	}
	var payload struct {
		Data struct {
			Range   string `json:"range"`
			Summary struct {
				RateLimitedRate float64 `json:"rateLimitedRate"`
			} `json:"summary"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Data.Range != "15m" || payload.Data.Summary.RateLimitedRate != 0.2 {
		t.Fatalf("unexpected response: %+v", payload)
	}
	if containsAnyLiveUsage(response.Body.String(), "prompt", "response", "credential", "email") {
		t.Fatalf("response exposed a forbidden field: %s", response.Body.String())
	}
}

func TestAnalyticsLiveUsageHandlerRejectsInvalidRangeAndBoundsUnavailable(t *testing.T) {
	handler := AnalyticsLiveUsageHandler{Reader: &recordingAnalyticsLiveUsageReader{}}
	invalid := httptest.NewRecorder()
	handler.ServeHTTP(invalid, httptest.NewRequest(
		http.MethodGet,
		"/api/analytics/live-usage?tenantId=tenant-1&from=2026-07-24T03:00:00Z&to=2026-07-24T05:00:00Z",
		nil,
	))
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", invalid.Code)
	}

	unavailable := httptest.NewRecorder()
	AnalyticsLiveUsageHandler{Reader: &recordingAnalyticsLiveUsageReader{
		err: invocationlog.ErrAnalyticsDataUnavailable,
	}}.ServeHTTP(unavailable, httptest.NewRequest(
		http.MethodGet,
		"/api/analytics/live-usage?tenantId=tenant-1&from=2026-07-24T03:00:00Z&to=2026-07-24T03:15:00Z",
		nil,
	))
	if unavailable.Code != http.StatusServiceUnavailable ||
		!containsAnyLiveUsage(unavailable.Body.String(), "ANALYTICS_LIVE_USAGE_UNAVAILABLE") {
		t.Fatalf("expected bounded 503, got %d: %s", unavailable.Code, unavailable.Body.String())
	}

	nilReader := httptest.NewRecorder()
	AnalyticsLiveUsageHandler{}.ServeHTTP(nilReader, httptest.NewRequest(
		http.MethodGet,
		"/api/analytics/live-usage?tenantId=tenant-1&from=2026-07-24T03:00:00Z&to=2026-07-24T03:15:00Z",
		nil,
	))
	if nilReader.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected nil reader 503, got %d", nilReader.Code)
	}
}

func TestAnalyticsLiveUsageHandlerDoesNotLeakInternalErrors(t *testing.T) {
	response := httptest.NewRecorder()
	AnalyticsLiveUsageHandler{Reader: &recordingAnalyticsLiveUsageReader{
		err: errors.New("clickhouse password=do-not-expose"),
	}}.ServeHTTP(response, httptest.NewRequest(
		http.MethodGet,
		"/api/analytics/live-usage?tenantId=tenant-1&from=2026-07-24T03:00:00Z&to=2026-07-24T03:15:00Z",
		nil,
	))
	if response.Code != http.StatusInternalServerError ||
		containsAnyLiveUsage(response.Body.String(), "do-not-expose", "clickhouse password") {
		t.Fatalf("expected safe internal error, got %d: %s", response.Code, response.Body.String())
	}
}

func containsAnyLiveUsage(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}
