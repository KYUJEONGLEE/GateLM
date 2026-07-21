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

func TestProjectReaderUsesClickHouseCompatibleAliasesAndBucketConversions(t *testing.T) {
	var mu sync.Mutex
	queries := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read query: %v", err)
		}
		statement := string(body)
		mu.Lock()
		queries = append(queries, statement)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/x-ndjson")
		switch {
		case strings.Contains(statement, "ORDER BY created_at DESC, request_id DESC"):
			_, _ = io.WriteString(w, `{"request_id":"request-1","project_id_text":"00000000-0000-4000-8000-000000000200","application_id_text":"00000000-0000-4000-8000-000000000300","terminal_status":"success","created_at_ms":1784638923000}`+"\n")
		case strings.Contains(statement, "option_type"):
			_, _ = io.WriteString(w, `{"option_type":"requested_model","value":"z-model","scope_type":"","scope_id":"","resolved_by":""}`+"\n")
			_, _ = io.WriteString(w, `{"option_type":"requested_model","value":"a-model","scope_type":"","scope_id":"","resolved_by":""}`+"\n")
			_, _ = io.WriteString(w, `{"option_type":"budget_scope","value":"","scope_type":"employee","scope_id":"employee-1","resolved_by":"api_key"}`+"\n")
		}
	}))
	defer server.Close()

	reader, err := NewProjectReader(QueryConfig{EndpointURL: server.URL, Database: "analytics", Table: "llm_invocations", Timeout: time.Second})
	if err != nil {
		t.Fatalf("new project reader: %v", err)
	}
	from := time.Date(2026, 7, 18, 0, 0, 0, 0, time.UTC)
	filter := invocationlog.ProjectLogsFilter{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
		From:      from,
		To:        from.Add(5 * 24 * time.Hour),
		Limit:     20,
	}
	items, err := reader.ListProjectLogs(context.Background(), filter)
	if err != nil {
		t.Fatalf("list project logs: %v", err)
	}
	if len(items) != 1 || items[0].ProjectID != filter.ProjectID {
		t.Fatalf("unexpected project log rows: %+v", items)
	}
	options, err := reader.ListProjectLogFilterOptions(context.Background(), filter)
	if err != nil {
		t.Fatalf("list filter options: %v", err)
	}
	if got := strings.Join(options.RequestedModels, ","); got != "a-model,z-model" {
		t.Fatalf("expected stable model ordering, got %q", got)
	}
	if len(queries) != 2 {
		t.Fatalf("expected two queries, got %d", len(queries))
	}
	if !strings.Contains(queries[0], "AS project_id_text") || strings.Contains(queries[0], "AS project_id,") {
		t.Fatalf("project alias must not shadow the UUID filter column: %s", queries[0])
	}
	if strings.Contains(queries[1], "ORDER BY option_type") {
		t.Fatalf("UNION filter options must be sorted after decoding: %s", queries[1])
	}

	_, err = reader.GetCostReport(context.Background(), invocationlog.CostReportFilter{
		TenantID: filter.TenantID, ProjectID: filter.ProjectID, Period: "day", From: filter.From, To: filter.To,
	})
	if err != nil {
		t.Fatalf("cost report: %v", err)
	}
	_, err = reader.GetAnalyticsPolicyImpact(context.Background(), invocationlog.AnalyticsPolicyImpactFilter{
		TenantID: filter.TenantID, ProjectID: filter.ProjectID, Period: "day", From: filter.From, To: filter.To,
	})
	if err != nil {
		t.Fatalf("policy impact: %v", err)
	}
	if len(queries) != 4 {
		t.Fatalf("expected four queries, got %d", len(queries))
	}
	for _, statement := range queries[2:] {
		if strings.Contains(statement, "toUnixTimestamp64Milli(toStartOf") || !strings.Contains(statement, "toUnixTimestamp(toStartOf") {
			t.Fatalf("bucket conversion must support ClickHouse DateTime results: %s", statement)
		}
	}
}
