package invocationlog

import (
	"strings"
	"testing"
	"time"
)

func TestBuildTerminalLogMapsP0ContextWithoutRawPrompt(t *testing.T) {
	startedAt := time.Date(2026, 6, 26, 1, 2, 3, 0, time.UTC)
	completedAt := startedAt.Add(25 * time.Millisecond)
	providerLatencyMs := int64(10)

	log := BuildTerminalLog(TerminalLogInput{
		RequestID:               " request_success ",
		TenantID:                " tenant_demo ",
		ProjectID:               " project_demo ",
		ApplicationID:           " app_demo ",
		APIKeyID:                " api_key_demo ",
		AppTokenID:              " app_token_demo ",
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
		LatencyMs:               25,
		ProviderLatencyMs:       &providerLatencyMs,
		Status:                  StatusSuccess,
		HTTPStatus:              200,
		CacheStatus:             CacheStatusMiss,
		CacheType:               CacheTypeExact,
		CacheKeyHash:            "hmac-sha256:cache-key",
		MaskingAction:           "redacted",
		MaskingDetectedTypes:    []string{"email"},
		MaskingDetectedCount:    1,
		RedactedPromptPreview:   "Send a reply to [EMAIL_REDACTED].",
		SecurityPolicyVersionID: "sec_p0_v1",
		RedactedPromptForHash:   "Send a reply to [EMAIL_REDACTED].",
		StartedAt:               startedAt,
		CompletedAt:             completedAt,
	})

	if log.RequestID != "request_success" || log.TraceID != "request_success" {
		t.Fatalf("unexpected ids: %+v", log)
	}
	if log.Source != SourceCustomerApp || log.Endpoint != "/v1/chat/completions" || log.Method != "POST" {
		t.Fatalf("unexpected defaults: %+v", log)
	}
	if log.Status != StatusSuccess || log.CacheStatus != CacheStatusMiss || log.CacheType != CacheTypeExact {
		t.Fatalf("unexpected terminal fields: %+v", log)
	}
	if !strings.HasPrefix(log.RequestBodyHash, "sha256:") || !strings.HasPrefix(log.PromptHash, "sha256:") {
		t.Fatalf("expected synthetic hashes, got %s %s", log.RequestBodyHash, log.PromptHash)
	}
	if strings.Contains(log.RequestBodyHash, "EMAIL") || strings.Contains(log.PromptHash, "EMAIL") {
		t.Fatalf("hash fields must not contain prompt material: %+v", log)
	}
	if log.Metadata["schemaVersion"] != 1 || log.Metadata["securityPolicyVersionId"] != "sec_p0_v1" || log.Metadata["routingPolicyHash"] != "route_p0_v1" {
		t.Fatalf("unexpected metadata: %+v", log.Metadata)
	}
}

func TestBuildTerminalLogUsesLatencyFallback(t *testing.T) {
	startedAt := time.Date(2026, 6, 26, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:   "request_blocked",
		Status:      StatusBlocked,
		HTTPStatus:  403,
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(13 * time.Millisecond),
	})

	if log.LatencyMs != 13 {
		t.Fatalf("expected fallback latency 13, got %d", log.LatencyMs)
	}
	if log.CacheStatus != CacheStatusBypass || log.CacheType != CacheTypeNone || log.MaskingAction != "none" {
		t.Fatalf("unexpected fallback fields: %+v", log)
	}
}
