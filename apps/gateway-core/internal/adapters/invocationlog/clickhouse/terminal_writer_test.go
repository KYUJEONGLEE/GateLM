package clickhouse

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

const testIdentitySecret = "clickhouse-employee-identity-test-secret"

func TestTerminalLogWriterWritesSafeJSONEachRowBatch(t *testing.T) {
	var requestBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("query"); got != "INSERT INTO `analytics`.`llm_invocations` FORMAT JSONEachRow" {
			t.Errorf("unexpected query: %q", got)
		}
		username, password, ok := r.BasicAuth()
		if !ok || username != "analytics_writer" || password != "safe-test-password" {
			t.Errorf("unexpected basic auth: username=%q password=%q ok=%t", username, password, ok)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read request: %v", err)
		}
		requestBody = string(body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	writer, err := NewTerminalLogWriter(Config{
		EndpointURL:                server.URL,
		Database:                   "analytics",
		Table:                      "llm_invocations",
		Username:                   "analytics_writer",
		Password:                   "safe-test-password",
		EmployeeIdentityHMACSecret: testIdentitySecret,
	})
	if err != nil {
		t.Fatalf("new writer: %v", err)
	}
	entries := []invocationlog.TerminalLog{
		testTerminalLog("request_clickhouse_1", "Employee@Example.com"),
		testTerminalLog("request_clickhouse_2", "another@example.com"),
	}
	entries[0].Metadata = map[string]any{
		"promptCapture":   "raw prompt must never be mirrored",
		"responseCapture": "raw response must never be mirrored",
		"providerKey":     "provider-secret-must-never-be-mirrored",
	}
	entries[0].APIKeyID = "api-key-id-must-not-be-mirrored"
	entries[0].AppTokenID = "app-token-id-must-not-be-mirrored"
	entries[0].RedactedPromptPreview = "preview-must-not-be-mirrored"
	if err := writer.WriteTerminalLogs(context.Background(), entries); err != nil {
		t.Fatalf("write batch: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(requestBody), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected two JSONEachRow lines, got %d: %q", len(lines), requestBody)
	}
	var first analyticsRow
	if err := json.Unmarshal([]byte(lines[0]), &first); err != nil {
		t.Fatalf("decode first row: %v", err)
	}
	if first.RequestID != "request_clickhouse_1" || first.Provider != "mock" || first.Model != "mock-balanced" {
		t.Fatalf("unexpected first row: %+v", first)
	}
	if first.EmployeeIdentityHash != expectedHMAC(testIdentitySecret, "employee-id-001") {
		t.Fatalf("employee identity must prefer the resolved employee id HMAC, got %q", first.EmployeeIdentityHash)
	}
	for _, forbidden := range []string{
		"raw prompt must never be mirrored",
		"raw response must never be mirrored",
		"provider-secret-must-never-be-mirrored",
		"api-key-id-must-not-be-mirrored",
		"app-token-id-must-not-be-mirrored",
		"preview-must-not-be-mirrored",
		"Employee@Example.com",
	} {
		if strings.Contains(requestBody, forbidden) {
			t.Fatalf("ClickHouse payload contains forbidden value %q: %s", forbidden, requestBody)
		}
	}
}

func TestTerminalLogWriterFallsBackToHashedEndUserIdentity(t *testing.T) {
	writer, err := NewTerminalLogWriter(Config{
		EndpointURL:                "http://clickhouse.internal:8123",
		Database:                   "analytics",
		Table:                      "llm_invocations",
		EmployeeIdentityHMACSecret: testIdentitySecret,
	})
	if err != nil {
		t.Fatalf("new writer: %v", err)
	}
	entry := testTerminalLog("request_identity_fallback", " Employee@Example.COM ")
	entry.EmployeePolicyDecision = nil
	row := writer.row(entry, time.Now().UTC())
	if row.EmployeeIdentityHash != expectedHMAC(testIdentitySecret, "employee@example.com") {
		t.Fatalf("unexpected identity hash: %q", row.EmployeeIdentityHash)
	}
}

func TestNewTerminalLogWriterRejectsUnsafeConfiguration(t *testing.T) {
	for _, testCase := range []struct {
		name string
		cfg  Config
	}{
		{name: "missing endpoint", cfg: Config{Database: "analytics", Table: "logs", EmployeeIdentityHMACSecret: testIdentitySecret}},
		{name: "unsafe database", cfg: Config{EndpointURL: "http://localhost:8123", Database: "analytics;drop", Table: "logs", EmployeeIdentityHMACSecret: testIdentitySecret}},
		{name: "missing identity secret", cfg: Config{EndpointURL: "http://localhost:8123", Database: "analytics", Table: "logs"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := NewTerminalLogWriter(testCase.cfg); err == nil {
				t.Fatal("expected configuration error")
			}
		})
	}
}

func testTerminalLog(requestID string, endUserID string) invocationlog.TerminalLog {
	createdAt := time.Date(2026, 7, 21, 1, 2, 3, 456000000, time.UTC)
	return invocationlog.TerminalLog{
		RequestID:        requestID,
		TenantID:         "00000000-0000-4000-8000-000000000100",
		ProjectID:        "00000000-0000-4000-8000-000000000200",
		ApplicationID:    "00000000-0000-4000-8000-000000000300",
		EndUserID:        endUserID,
		Provider:         "mock",
		Model:            "mock-balanced",
		Status:           invocationlog.StatusSuccess,
		HTTPStatus:       200,
		PromptTokens:     10,
		CompletionTokens: 20,
		TotalTokens:      30,
		CostMicroUSD:     42,
		LatencyMs:        100,
		CacheStatus:      "miss",
		PromptCategory:   "general",
		PromptDifficulty: "simple",
		CreatedAt:        createdAt,
		EmployeePolicyDecision: &employeepolicy.Decision{
			EmployeeID: "employee-id-001",
		},
	}
}

func expectedHMAC(secret string, identity string) string {
	digest := hmac.New(sha256.New, []byte(secret))
	_, _ = digest.Write([]byte(strings.ToLower(strings.TrimSpace(identity))))
	return hex.EncodeToString(digest.Sum(nil))
}
