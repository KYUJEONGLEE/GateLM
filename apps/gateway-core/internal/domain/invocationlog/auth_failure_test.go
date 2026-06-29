package invocationlog

import (
	"testing"
	"time"
)

func TestBuildAuthFailureLogUsesBlockedDefaults(t *testing.T) {
	startedAt := time.Date(2026, 6, 25, 1, 2, 3, 0, time.UTC)
	completedAt := startedAt.Add(24 * time.Millisecond)

	log := BuildAuthFailureLog(AuthFailureInput{
		RequestID:    " request_auth_failure ",
		HTTPStatus:   401,
		ErrorCode:    ErrorCodeInvalidAPIKey,
		ErrorMessage: "Invalid Gateway API key.",
		StartedAt:    startedAt,
		CompletedAt:  completedAt,
	})

	if log.RequestID != "request_auth_failure" || log.TraceID != "request_auth_failure" {
		t.Fatalf("expected request/trace id defaults, got %q/%q", log.RequestID, log.TraceID)
	}
	if log.Status != StatusBlocked || log.HTTPStatus != 401 {
		t.Fatalf("expected blocked/401, got %s/%d", log.Status, log.HTTPStatus)
	}
	if log.ErrorStage != StageAuthenticateAPIKey {
		t.Fatalf("expected auth stage %q, got %q", StageAuthenticateAPIKey, log.ErrorStage)
	}
	if log.CacheStatus != CacheStatusBypass || log.CacheType != CacheTypeNone {
		t.Fatalf("expected bypass/none cache, got %s/%s", log.CacheStatus, log.CacheType)
	}
	if log.PromptTokens != 0 || log.CompletionTokens != 0 || log.TotalTokens != 0 || log.CostMicroUSD != 0 {
		t.Fatalf("expected zero usage/cost, got %+v", log)
	}
	if log.ProviderLatencyMs != nil {
		t.Fatalf("expected nil provider latency for auth failure")
	}
	if log.LatencyMs != 24 {
		t.Fatalf("expected latency 24ms, got %d", log.LatencyMs)
	}
	if log.Source != SourceCustomerApp {
		t.Fatalf("expected default source %q, got %q", SourceCustomerApp, log.Source)
	}
	if log.DomainOutcomes.Auth.Outcome != "invalid_api_key" ||
		log.DomainOutcomes.Provider.Outcome != "not_called" ||
		log.DomainOutcomes.Cache.Outcome != "bypassed" {
		t.Fatalf("unexpected auth failure domain outcomes: %+v", log.DomainOutcomes)
	}
}

func TestIsAuthFailureOnlyMatchesDocumentedAuthFailures(t *testing.T) {
	if !IsAuthFailure(401, ErrorCodeInvalidAPIKey) {
		t.Fatalf("expected invalid API key to be auth failure")
	}
	if !IsAuthFailure(403, ErrorCodeInvalidAppToken) {
		t.Fatalf("expected invalid app token to be auth failure")
	}
	if IsAuthFailure(403, "scope_mismatch") {
		t.Fatalf("scope mismatch should be handled as a regular request error log")
	}
	if IsAuthFailure(403, ErrorCodeInvalidAPIKey) {
		t.Fatalf("invalid API key must use HTTP 401")
	}
}
