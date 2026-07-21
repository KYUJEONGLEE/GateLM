package clickhouse

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestAnalyticsPerformanceReaderQueriesBoundedProjectAggregates(t *testing.T) {
	var mu sync.Mutex
	queries := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		if !ok || username != "analytics_reader" || password != "reader-password" {
			t.Errorf("unexpected reader auth: %q %q %t", username, password, ok)
		}
		if request.URL.Query().Get("param_tenant_id") != "00000000-0000-4000-8000-000000000100" ||
			request.URL.Query().Get("param_project_id") != "00000000-0000-4000-8000-000000000200" {
			t.Errorf("missing bounded query parameters: %s", request.URL.RawQuery)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Errorf("read query: %v", err)
		}
		statement := string(body)
		mu.Lock()
		queries = append(queries, statement)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/x-ndjson")
		switch {
		case strings.Contains(statement, "AS total_requests"):
			_, _ = io.WriteString(w, `{"total_requests":3,"avg_latency_ms":120,"p95_latency_ms":200,"p99_latency_ms":220,"system_error_requests":1,"error_rate":0.333333,"last_event_at_ms":1784638923000}`+"\n")
		case strings.Contains(statement, "GROUP BY provider, model"):
			_, _ = io.WriteString(w, `{"provider":"mock","model":"mock-balanced","requests":3,"avg_latency_ms":120,"p95_latency_ms":200,"p99_latency_ms":220,"error_rate":0.333333,"total_cost_micro_usd":42,"cache_hit_rate":0.5}`+"\n")
		case strings.Contains(statement, "GROUP BY provider"):
			_, _ = io.WriteString(w, `{"provider":"mock","p95_latency_ms":200,"requests":3}`+"\n")
		case strings.Contains(statement, "AS bucket_ms"):
			_, _ = io.WriteString(w, `{"bucket_ms":1784638860000,"requests":3,"p50_latency_ms":100,"p95_latency_ms":200,"p99_latency_ms":220}`+"\n")
		case strings.Contains(statement, "ORDER BY latency_ms DESC"):
			_, _ = io.WriteString(w, `{"request_id":"request-1","project_id":"00000000-0000-4000-8000-000000000200","provider":"mock","model":"mock-balanced","latency_ms":220,"http_status":500,"terminal_status":"failed","created_at_ms":1784638923000}`+"\n")
		default:
			t.Errorf("unexpected query: %s", statement)
			http.Error(w, "unexpected query", http.StatusBadRequest)
		}
	}))
	defer server.Close()

	reader, err := NewAnalyticsPerformanceReader(QueryConfig{
		EndpointURL: server.URL,
		Database:    "analytics",
		Table:       "llm_invocations",
		Username:    "analytics_reader",
		Password:    "reader-password",
		Timeout:     time.Second,
	})
	if err != nil {
		t.Fatalf("new reader: %v", err)
	}
	from := time.Date(2026, 7, 21, 12, 0, 0, 0, time.UTC)
	result, err := reader.GetAnalyticsPerformance(context.Background(), invocationlog.AnalyticsPerformanceFilter{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
		Provider:  "mock",
		Model:     "mock-balanced",
		From:      from,
		To:        from.Add(15 * time.Minute),
	})
	if err != nil {
		t.Fatalf("read performance: %v", err)
	}
	if len(queries) != 5 {
		t.Fatalf("expected five bounded aggregate queries, got %d", len(queries))
	}
	if result.Summary.TotalRequests != 3 || result.Summary.SystemErrorRequests != 1 || result.Summary.P95LatencyMs == nil || *result.Summary.P95LatencyMs != 200 {
		t.Fatalf("unexpected summary: %+v", result.Summary)
	}
	if len(result.ProviderModelPerformance) != 1 || result.ProviderModelPerformance[0].TotalCostUSD != "0.000042" {
		t.Fatalf("unexpected provider/model result: %+v", result.ProviderModelPerformance)
	}
	if len(result.SlowestRequests) != 1 || result.SlowestRequests[0].RequestID != "request-1" {
		t.Fatalf("unexpected slow requests: %+v", result.SlowestRequests)
	}
	if len(result.LatencyDistribution) != 15 {
		t.Fatalf("expected a filled 15-minute series, got %d", len(result.LatencyDistribution))
	}
	if result.DataFreshness.Source != "clickhouse_project_application" {
		t.Fatalf("unexpected source: %q", result.DataFreshness.Source)
	}
}

func TestAnalyticsPerformanceReaderReturnsUnavailableWithoutPostgresFallback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "internal details must not escape", http.StatusServiceUnavailable)
	}))
	defer server.Close()
	reader, err := NewAnalyticsPerformanceReader(QueryConfig{
		EndpointURL: server.URL,
		Database:    "analytics",
		Table:       "llm_invocations",
		Timeout:     time.Second,
	})
	if err != nil {
		t.Fatalf("new reader: %v", err)
	}
	_, err = reader.GetAnalyticsPerformance(context.Background(), invocationlog.AnalyticsPerformanceFilter{
		TenantID: "00000000-0000-4000-8000-000000000100",
		From:     time.Now().UTC().Add(-time.Hour),
		To:       time.Now().UTC(),
	})
	if err == nil || !strings.Contains(err.Error(), invocationlog.ErrAnalyticsDataUnavailable.Error()) {
		t.Fatalf("expected bounded unavailable error, got %v", err)
	}
}
