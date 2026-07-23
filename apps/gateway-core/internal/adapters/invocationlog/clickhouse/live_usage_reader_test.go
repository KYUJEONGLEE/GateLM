package clickhouse

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestAnalyticsLiveUsageReaderUsesOnlyBoundedSecondRollup(t *testing.T) {
	var mu sync.Mutex
	queries := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read query: %v", err)
			return
		}
		statement := string(body)
		mu.Lock()
		queries = append(queries, statement)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/x-ndjson")
		switch {
		case strings.Contains(statement, "project_id_text"):
			_, _ = io.WriteString(w, `{"project_id_text":"00000000-0000-4000-8000-000000000202","requests":7,"processed":5,"rate_limited":2,"current_requests":5,"current_delta":12,"previous_delta":6}`+"\n")
			_, _ = io.WriteString(w, `{"project_id_text":"00000000-0000-4000-8000-000000000201","requests":7,"processed":7,"rate_limited":0,"current_requests":0,"current_delta":0,"previous_delta":0}`+"\n")
		case strings.Contains(statement, "GROUP BY toStartOfInterval"):
			_, _ = io.WriteString(w, `{"bucket_ms":1784862000000,"requests":0,"processed":0,"rate_limited":0}`+"\n")
			_, _ = io.WriteString(w, `{"bucket_ms":1784862005000,"requests":10,"processed":6,"rate_limited":4}`+"\n")
		case strings.Contains(statement, "per_second"):
			_, _ = io.WriteString(w, `{"requests":14,"processed":12,"rate_limited":2,"current_requests":10,"peak_rps":8,"last_ms":1784862009123}`+"\n")
		default:
			t.Errorf("unexpected query: %s", statement)
		}
	}))
	defer server.Close()

	reader, err := NewProjectReader(QueryConfig{
		EndpointURL: server.URL,
		Database:    "analytics",
		Table:       "llm_invocations",
		Timeout:     time.Second,
	})
	if err != nil {
		t.Fatalf("new project reader: %v", err)
	}
	to := time.Date(2026, 7, 24, 3, 15, 0, 0, time.UTC)
	result, err := reader.GetAnalyticsLiveUsage(context.Background(), invocationlog.AnalyticsLiveUsageFilter{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "",
		From:      to.Add(-15 * time.Minute),
		To:        to,
	})
	if err != nil {
		t.Fatalf("get live usage: %v", err)
	}
	if result.Summary.CurrentIncomingRPS != 2 || result.Summary.PeakIncomingRPS != 8 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if result.Summary.RequestCount != result.Summary.ProcessedRequestCount+result.Summary.RateLimitedRequestCount {
		t.Fatalf("summary status counts must equal requests: %+v", result.Summary)
	}
	if len(result.Projects) != 2 || result.Projects[0].ProjectID != "00000000-0000-4000-8000-000000000201" {
		t.Fatalf("expected stable project tie ordering, got %+v", result.Projects)
	}
	if len(result.Buckets) != 180 || result.RateLimitStartedAt == nil {
		t.Fatalf("expected filled series and marker, got %d / %v", len(result.Buckets), result.RateLimitStartedAt)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(queries) != 3 {
		t.Fatalf("expected three bounded aggregate queries, got %d", len(queries))
	}
	for _, statement := range queries {
		if !strings.Contains(statement, "analytics.llm_invocations_dashboard_second_rollup") {
			t.Fatalf("live usage must use the second rollup: %s", statement)
		}
		if strings.Contains(statement, "llm_invocations FINAL") ||
			strings.Contains(statement, "llm_invocations_by_time") {
			t.Fatalf("live usage must not scan a raw read model: %s", statement)
		}
	}
}

func TestAnalyticsLiveUsageReaderReturnsUnavailableWithoutFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "clickhouse unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	reader, err := NewProjectReader(QueryConfig{
		EndpointURL: server.URL,
		Database:    "analytics",
		Table:       "llm_invocations",
		Timeout:     time.Second,
	})
	if err != nil {
		t.Fatalf("new project reader: %v", err)
	}
	to := time.Date(2026, 7, 24, 3, 15, 0, 0, time.UTC)
	_, err = reader.GetAnalyticsLiveUsage(context.Background(), invocationlog.AnalyticsLiveUsageFilter{
		TenantID: "00000000-0000-4000-8000-000000000100",
		From:     to.Add(-15 * time.Minute),
		To:       to,
	})
	if !errors.Is(err, invocationlog.ErrAnalyticsDataUnavailable) {
		t.Fatalf("expected analytics unavailable, got %v", err)
	}
}
