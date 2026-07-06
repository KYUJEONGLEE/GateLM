package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
)

func TestTerminalLogWriterWritesProjectBudgetNotificationsForTenantAndProjectAdmins(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewTerminalLogWriter(execer, TerminalLogDefaults{
		TenantID:      "00000000-0000-4000-8000-000000000100",
		ProjectID:     "00000000-0000-4000-8000-000000000200",
		ApplicationID: "00000000-0000-4000-8000-000000000300",
	})
	startedAt := time.Date(2026, 7, 6, 1, 2, 3, 0, time.UTC)
	completedAt := startedAt.Add(50 * time.Millisecond)
	scope := budget.Scope{
		Type:       budget.ScopeTypeProject,
		ID:         "00000000-0000-4000-8000-000000000200",
		ResolvedBy: budget.ResolvedByRuntimeSnapshot,
	}

	err := writer.WriteTerminalLog(context.Background(), invocationlog.BuildTerminalLog(invocationlog.TerminalLogInput{
		RequestID:     "request_project_budget_exceeded",
		TenantID:      "00000000-0000-4000-8000-000000000100",
		ProjectID:     "00000000-0000-4000-8000-000000000200",
		ApplicationID: "00000000-0000-4000-8000-000000000300",
		BudgetScope:   scope,
		BudgetDecision: &budget.Decision{
			Allowed:                 true,
			Outcome:                 budget.OutcomeDegraded,
			Scope:                   scope,
			Reason:                  "quota_exceeded_quality_guard",
			WarningThresholdPercent: 80,
			LimitMicroUSD:           1000,
			UsedMicroUSD:            1200,
			RemainingMicroUSD:       -200,
			UsagePercent:            120,
		},
		Provider:    "mock",
		Model:       "mock-fast",
		Status:      invocationlog.StatusSuccess,
		HTTPStatus:  200,
		StartedAt:   startedAt,
		CompletedAt: completedAt,
	}))
	if err != nil {
		t.Fatalf("WriteTerminalLog returned error: %v", err)
	}
	if execer.calls != 3 {
		t.Fatalf("expected terminal insert and two notification events, got %d calls", execer.calls)
	}
	if !strings.Contains(execer.queries[1], "insert into notification_events") || !strings.Contains(execer.queries[2], "insert into notification_events") {
		t.Fatalf("expected notification event upserts, got %#v", execer.queries)
	}

	tenantAdminArgs := execer.argsHistory[1]
	projectAdminArgs := execer.argsHistory[2]
	assertArg(t, tenantAdminArgs, 6, "exceeded")
	assertArg(t, tenantAdminArgs, 7, "tenant")
	assertArg(t, tenantAdminArgs, 9, "tenant_admin")
	assertArg(t, projectAdminArgs, 6, "exceeded")
	assertArg(t, projectAdminArgs, 7, "project")
	assertArg(t, projectAdminArgs, 9, "project_admin")
	assertArg(t, projectAdminArgs, 11, int64(1000))
	assertArg(t, projectAdminArgs, 12, int64(1200))
	assertArg(t, projectAdminArgs, 13, int64(-200))
	assertArg(t, projectAdminArgs, 15, "request_project_budget_exceeded")
}

func TestTerminalLogWriterMapsSuccessToP0InvocationLog(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewTerminalLogWriter(execer, TerminalLogDefaults{
		TenantID:      "00000000-0000-4000-8000-000000000100",
		ProjectID:     "00000000-0000-4000-8000-000000000200",
		ApplicationID: "00000000-0000-4000-8000-000000000300",
	})
	providerLatencyMs := int64(42)
	startedAt := time.Date(2026, 6, 26, 1, 2, 3, 0, time.UTC)
	completedAt := startedAt.Add(100 * time.Millisecond)

	err := writer.WriteTerminalLog(context.Background(), invocationlog.BuildTerminalLog(invocationlog.TerminalLogInput{
		RequestID:               "request_success",
		TenantID:                "00000000-0000-4000-8000-000000000100",
		ProjectID:               "00000000-0000-4000-8000-000000000200",
		ApplicationID:           "00000000-0000-4000-8000-000000000300",
		APIKeyID:                "00000000-0000-4000-8000-000000000400",
		AppTokenID:              "00000000-0000-4000-8000-000000000500",
		ConfigHash:              "hash_runtime_config_test",
		SecurityPolicyHash:      "hash_security_policy_test",
		RequestedModel:          "auto",
		Provider:                "mock",
		Model:                   "mock-fast",
		SelectedProvider:        "mock",
		SelectedModel:           "mock-fast",
		RoutingReason:           "short_prompt_low_cost",
		RoutingPolicyHash:       "route_p0_v1",
		PromptTokens:            4,
		CompletionTokens:        3,
		TotalTokens:             7,
		CostMicroUSD:            1,
		LatencyMs:               100,
		ProviderLatencyMs:       &providerLatencyMs,
		Status:                  invocationlog.StatusSuccess,
		HTTPStatus:              200,
		CacheStatus:             invocationlog.CacheStatusMiss,
		CacheType:               invocationlog.CacheTypeExact,
		CacheKeyHash:            "hmac-sha256:cache-key",
		MaskingAction:           "redacted",
		MaskingDetectedTypes:    []string{"email"},
		MaskingDetectedCount:    1,
		RedactedPromptPreview:   "Send a reply to [EMAIL_1].",
		SecurityPolicyVersionID: "sec_p0_v1",
		RedactedPromptForHash:   "Send a reply to [EMAIL_1].",
		StartedAt:               startedAt,
		CompletedAt:             completedAt,
	}))
	if err != nil {
		t.Fatalf("WriteTerminalLog returned error: %v", err)
	}
	if !execer.called {
		t.Fatalf("expected database insert")
	}
	if execer.calls != 2 {
		t.Fatalf("expected terminal log insert and budget ledger upsert, got %d calls", execer.calls)
	}
	if !strings.Contains(execer.queries[0], "insert into p0_llm_invocation_logs") {
		t.Fatalf("expected p0_llm_invocation_logs insert, got %s", execer.queries[0])
	}
	if !strings.Contains(execer.queries[1], "insert into budget_ledger_entries") {
		t.Fatalf("expected budget ledger upsert, got %s", execer.queries[1])
	}
	args := execer.argsHistory[0]
	if len(args) != 46 {
		t.Fatalf("expected 46 insert args, got %d", len(args))
	}

	assertUUIDArg(t, args, 0)
	assertArg(t, args, 1, "request_success")
	assertArg(t, args, 3, "00000000-0000-4000-8000-000000000100")
	assertArg(t, args, 4, "00000000-0000-4000-8000-000000000200")
	assertArg(t, args, 5, "00000000-0000-4000-8000-000000000300")
	assertArg(t, args, 15, "auto")
	assertArg(t, args, 16, "mock")
	assertArg(t, args, 17, "mock-fast")
	assertArg(t, args, 18, "mock")
	assertArg(t, args, 19, "mock-fast")
	assertArg(t, args, 20, "short_prompt_low_cost")
	assertArg(t, args, 21, 4)
	assertArg(t, args, 22, 3)
	assertArg(t, args, 23, 7)
	assertArg(t, args, 24, int64(1))
	assertArg(t, args, 27, int64(42))
	assertArg(t, args, 28, invocationlog.StatusSuccess)
	assertArg(t, args, 29, 200)
	assertArg(t, args, 33, invocationlog.CacheStatusMiss)
	assertArg(t, args, 34, invocationlog.CacheTypeExact)
	assertArg(t, args, 35, "hmac-sha256:cache-key")
	assertArg(t, args, 37, "redacted")
	assertArg(t, args, 39, 1)
	assertHashArg(t, args, 40)
	assertHashArg(t, args, 41)
	assertArg(t, args, 42, "Send a reply to [EMAIL_1].")

	ledgerArgs := execer.argsHistory[1]
	if len(ledgerArgs) != 10 {
		t.Fatalf("expected 10 budget ledger args, got %d", len(ledgerArgs))
	}
	assertArg(t, ledgerArgs, 0, "request_success")
	assertArg(t, ledgerArgs, 1, "00000000-0000-4000-8000-000000000100")
	assertArg(t, ledgerArgs, 2, "00000000-0000-4000-8000-000000000200")
	assertArg(t, ledgerArgs, 3, "00000000-0000-4000-8000-000000000300")
	assertArg(t, ledgerArgs, 4, "application")
	assertArg(t, ledgerArgs, 5, "00000000-0000-4000-8000-000000000300")
	assertArg(t, ledgerArgs, 7, int64(1))

	metadata, ok := args[43].([]byte)
	if !ok {
		t.Fatalf("expected metadata JSON []byte, got %T", execer.args[43])
	}
	var decoded map[string]any
	if err := json.Unmarshal(metadata, &decoded); err != nil {
		t.Fatalf("decode metadata JSON: %v", err)
	}
	if decoded["schemaVersion"] != float64(1) || decoded["securityPolicyVersionId"] != "sec_p0_v1" {
		t.Fatalf("unexpected metadata: %v", decoded)
	}
	if _, exists := decoded["routingPolicyHash"]; exists {
		t.Fatalf("routingPolicyHash must not be primary metadata: %v", decoded)
	}
	runtimeSnapshot, ok := decoded["runtimeSnapshot"].(map[string]any)
	if !ok {
		t.Fatalf("expected runtimeSnapshot metadata, got %v", decoded)
	}
	if runtimeSnapshot["runtimeSnapshotVersion"] != float64(1) || runtimeSnapshot["runtimeState"] != "snapshot_active" {
		t.Fatalf("unexpected runtimeSnapshot metadata: %v", runtimeSnapshot)
	}
	legacyHashes, ok := runtimeSnapshot["legacyHashes"].(map[string]any)
	if !ok || legacyHashes["routingPolicyHash"] != "route_p0_v1" {
		t.Fatalf("expected legacy hash bridge, got %v", runtimeSnapshot)
	}
}

func TestTerminalLogWriterDoesNotPersistRawPromptOrCredentials(t *testing.T) {
	execer := &fakeExecer{}
	writer := NewTerminalLogWriter(execer, TerminalLogDefaults{
		TenantID:  "00000000-0000-4000-8000-000000000100",
		ProjectID: "00000000-0000-4000-8000-000000000200",
	})

	err := writer.WriteTerminalLog(context.Background(), invocationlog.BuildTerminalLog(invocationlog.TerminalLogInput{
		RequestID:             "request_security_check",
		TenantID:              "00000000-0000-4000-8000-000000000100",
		ProjectID:             "00000000-0000-4000-8000-000000000200",
		Status:                invocationlog.StatusBlocked,
		HTTPStatus:            403,
		ErrorCode:             "sensitive_data_blocked",
		MaskingAction:         "blocked",
		RedactedPromptPreview: "Summarize [API_KEY_REDACTED].",
		RedactedPromptForHash: "Summarize [API_KEY_REDACTED].",
		StartedAt:             time.Now(),
		CompletedAt:           time.Now(),
	}))
	if err != nil {
		t.Fatalf("WriteTerminalLog returned error: %v", err)
	}

	args := fmt.Sprintf("%+v", execer.args)
	for _, forbidden := range []string{
		"test_secret_token_redacted_for_demo_only",
		"glm_api_test_redacted",
		"glm_app_token_test_redacted",
		"Authorization",
		"Bearer",
		"rawPrompt",
		"rawResponse",
	} {
		if strings.Contains(args, forbidden) {
			t.Fatalf("terminal insert args must not contain %q: %s", forbidden, args)
		}
	}
}
