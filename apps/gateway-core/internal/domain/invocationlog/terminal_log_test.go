package invocationlog

import (
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
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
		ConfigHash:              " hash_runtime_config_test ",
		SecurityPolicyHash:      " hash_security_policy_test ",
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
		SavedCostMicroUSD:       9,
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
	if log.DomainOutcomes.Provider.Outcome != "success" ||
		log.DomainOutcomes.Cache.Outcome != "miss" ||
		log.DomainOutcomes.Safety.Outcome != "redacted" ||
		log.DomainOutcomes.Routing.Outcome != "selected" {
		t.Fatalf("unexpected domain outcomes: %+v", log.DomainOutcomes)
	}
	if log.SavedCostMicroUSD != 9 {
		t.Fatalf("expected saved cost metadata 9, got %d", log.SavedCostMicroUSD)
	}
	if !strings.HasPrefix(log.RequestBodyHash, "sha256:") || !strings.HasPrefix(log.PromptHash, "sha256:") {
		t.Fatalf("expected synthetic hashes, got %s %s", log.RequestBodyHash, log.PromptHash)
	}
	if strings.Contains(log.RequestBodyHash, "EMAIL") || strings.Contains(log.PromptHash, "EMAIL") {
		t.Fatalf("hash fields must not contain prompt material: %+v", log)
	}
	if log.Metadata["schemaVersion"] != 1 || log.Metadata["securityPolicyVersionId"] != "sec_p0_v1" {
		t.Fatalf("unexpected metadata: %+v", log.Metadata)
	}
	if log.Metadata["terminalStatus"] != StatusSuccess {
		t.Fatalf("expected terminalStatus metadata, got %+v", log.Metadata)
	}
	stageOutcomes, ok := log.Metadata["gatewayStageOutcomes"].(GatewayStageOutcomes)
	if !ok || stageOutcomes.TerminalStatus != StatusSuccess || stageOutcomes.DomainOutcomes.Provider.Outcome != "success" {
		t.Fatalf("unexpected gateway stage outcomes metadata: %+v", log.Metadata["gatewayStageOutcomes"])
	}
	if _, exists := log.Metadata["routingPolicyHash"]; exists {
		t.Fatalf("routingPolicyHash must not be primary metadata: %+v", log.Metadata)
	}
	runtimeSnapshot, ok := log.Metadata["runtimeSnapshot"].(map[string]any)
	if !ok {
		t.Fatalf("expected runtime snapshot metadata, got %+v", log.Metadata)
	}
	if runtimeSnapshot["runtimeSnapshotVersion"] != 1 || runtimeSnapshot["runtimeState"] != "snapshot_active" {
		t.Fatalf("unexpected runtime snapshot metadata: %+v", runtimeSnapshot)
	}
	legacyHashes, ok := runtimeSnapshot["legacyHashes"].(map[string]string)
	if !ok {
		t.Fatalf("expected legacy hash bridge, got %+v", runtimeSnapshot)
	}
	if legacyHashes["configHash"] != "hash_runtime_config_test" ||
		legacyHashes["securityPolicyHash"] != "hash_security_policy_test" ||
		legacyHashes["routingPolicyHash"] != "route_p0_v1" {
		t.Fatalf("unexpected legacy hash bridge: %+v", legacyHashes)
	}
}

func TestBuildTerminalLogMapsExactCacheHitDomainOutcomes(t *testing.T) {
	startedAt := time.Date(2026, 6, 29, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:         "request_cache_hit",
		ApplicationID:     "app_demo",
		RequestedModel:    "auto",
		SelectedProvider:  "mock",
		SelectedModel:     "mock-fast",
		RoutingReason:     "short_prompt_low_cost",
		Status:            StatusSuccess,
		HTTPStatus:        200,
		CacheStatus:       CacheStatusHit,
		CacheType:         CacheTypeExact,
		CacheHitRequestID: "request_previous",
		StartedAt:         startedAt,
		CompletedAt:       startedAt.Add(4 * time.Millisecond),
	})

	if log.DomainOutcomes.Cache.Outcome != "hit" {
		t.Fatalf("expected cache hit outcome, got %+v", log.DomainOutcomes.Cache)
	}
	if log.DomainOutcomes.Provider.Outcome != "not_called" {
		t.Fatalf("cache hit must mark provider not_called, got %+v", log.DomainOutcomes.Provider)
	}
	if log.DomainOutcomes.Fallback.Outcome != "not_called" {
		t.Fatalf("cache hit must not evaluate fallback, got %+v", log.DomainOutcomes.Fallback)
	}
}

func TestBuildTerminalLogDefaultsMissingBudgetDecisionToNotChecked(t *testing.T) {
	startedAt := time.Date(2026, 6, 30, 9, 3, 0, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:     "request_without_budget_decision",
		ApplicationID: "app_demo",
		Status:        StatusSuccess,
		HTTPStatus:    200,
		CacheStatus:   CacheStatusMiss,
		CacheType:     CacheTypeExact,
		StartedAt:     startedAt,
		CompletedAt:   startedAt.Add(2 * time.Millisecond),
	})

	if log.BudgetDecision != nil {
		t.Fatalf("expected no budget decision, got %#v", log.BudgetDecision)
	}
	if log.DomainOutcomes.Budget.Outcome != budget.OutcomeNotChecked {
		t.Fatalf("missing budget decision must be not_checked, got %+v", log.DomainOutcomes.Budget)
	}
}

func TestBuildTerminalLogMapsStreamingFinalOutcomes(t *testing.T) {
	startedAt := time.Date(2026, 6, 30, 10, 0, 0, 0, time.UTC)
	providerLatencyMs := int64(12)

	success := BuildTerminalLog(TerminalLogInput{
		RequestID:         "request_stream_success",
		ApplicationID:     "app_demo",
		Stream:            true,
		RequestedModel:    "auto",
		SelectedProvider:  "mock",
		SelectedModel:     "mock-fast",
		Status:            StatusSuccess,
		HTTPStatus:        200,
		CacheStatus:       CacheStatusMiss,
		CacheType:         CacheTypeExact,
		ProviderLatencyMs: &providerLatencyMs,
		StartedAt:         startedAt,
		CompletedAt:       startedAt.Add(20 * time.Millisecond),
	})
	if success.DomainOutcomes.Streaming.Outcome != "completed" || !success.DomainOutcomes.Streaming.StreamingRequested {
		t.Fatalf("streaming success must record completed outcome, got %+v", success.DomainOutcomes.Streaming)
	}

	blocked := BuildTerminalLog(TerminalLogInput{
		RequestID:   "request_stream_blocked",
		Stream:      true,
		Status:      StatusBlocked,
		HTTPStatus:  403,
		ErrorCode:   "sensitive_data_blocked",
		ErrorStage:  "mask_or_block",
		CacheStatus: CacheStatusBypass,
		CacheType:   CacheTypeNone,
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(2 * time.Millisecond),
	})
	if blocked.DomainOutcomes.Streaming.Outcome != "not_streaming" {
		t.Fatalf("blocked stream request must not record streaming start, got %+v", blocked.DomainOutcomes.Streaming)
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

func TestBuildTerminalLogCarriesRateLimitDecisionWithoutProviderLatency(t *testing.T) {
	startedAt := time.Date(2026, 6, 27, 9, 0, 0, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:   "request_rate_limited",
		Status:      StatusRateLimited,
		HTTPStatus:  429,
		ErrorCode:   "rate_limited",
		ErrorStage:  "check_rate_limit",
		CacheStatus: CacheStatusBypass,
		CacheType:   CacheTypeNone,
		RateLimitDecision: &ratelimit.Decision{
			Allowed:           false,
			Scope:             ratelimit.ScopeApplication,
			ScopeID:           "app_demo",
			Limit:             1,
			Remaining:         0,
			WindowSeconds:     60,
			RetryAfterSeconds: 60,
			Reason:            ratelimit.ReasonLimitExceeded,
		},
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(3 * time.Millisecond),
	})

	if log.RateLimitDecision == nil || log.RateLimitDecision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("expected rate limit decision, got %#v", log.RateLimitDecision)
	}
	if log.ProviderLatencyMs != nil {
		t.Fatalf("rate limited log must not include provider latency, got %#v", log.ProviderLatencyMs)
	}
	metadataDecision, ok := log.Metadata["rateLimitDecision"].(ratelimit.Decision)
	if !ok || metadataDecision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("expected rate limit decision metadata, got %#v", log.Metadata)
	}
}

func TestBuildTerminalLogCarriesBudgetBlockedDecisionBeforeProviderPath(t *testing.T) {
	startedAt := time.Date(2026, 6, 30, 9, 0, 0, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:      "request_budget_blocked",
		ApplicationID:  "app_demo",
		Status:         StatusBlocked,
		HTTPStatus:     403,
		ErrorCode:      "budget_blocked",
		ErrorStage:     "check_budget",
		CacheStatus:    CacheStatusBypass,
		CacheType:      CacheTypeNone,
		BudgetScope:    budget.DefaultScope("app_demo"),
		BudgetDecision: &budget.Decision{Allowed: false, Outcome: budget.OutcomeBlocked, Reason: "monthly_limit_exceeded"},
		StartedAt:      startedAt,
		CompletedAt:    startedAt.Add(2 * time.Millisecond),
	})

	if log.BudgetDecision == nil || log.BudgetDecision.Outcome != budget.OutcomeBlocked {
		t.Fatalf("expected budget decision, got %#v", log.BudgetDecision)
	}
	if log.ProviderLatencyMs != nil {
		t.Fatalf("budget blocked log must not include provider latency, got %#v", log.ProviderLatencyMs)
	}
	if log.DomainOutcomes.Budget.Outcome != budget.OutcomeBlocked ||
		log.DomainOutcomes.Cache.Outcome != "bypassed" ||
		log.DomainOutcomes.Safety.Outcome != "not_checked" ||
		log.DomainOutcomes.Routing.Outcome != "not_checked" ||
		log.DomainOutcomes.Provider.Outcome != "not_called" ||
		log.DomainOutcomes.Fallback.Outcome != "not_called" {
		t.Fatalf("unexpected budget blocked outcomes: %+v", log.DomainOutcomes)
	}
	metadataDecision, ok := log.Metadata["budgetDecision"].(budget.Decision)
	if !ok || metadataDecision.Outcome != budget.OutcomeBlocked {
		t.Fatalf("expected budget decision metadata, got %#v", log.Metadata)
	}
}

func TestBuildTerminalLogCarriesBudgetCheckerErrorAsSystemFailure(t *testing.T) {
	startedAt := time.Date(2026, 6, 30, 9, 5, 0, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:      "request_budget_checker_error",
		ApplicationID:  "app_demo",
		Status:         StatusFailed,
		HTTPStatus:     500,
		ErrorCode:      "internal_error",
		ErrorStage:     "check_budget",
		CacheStatus:    CacheStatusBypass,
		CacheType:      CacheTypeNone,
		BudgetScope:    budget.DefaultScope("app_demo"),
		BudgetDecision: &budget.Decision{Allowed: true, Outcome: budget.OutcomeNotChecked, Reason: "checker_error"},
		StartedAt:      startedAt,
		CompletedAt:    startedAt.Add(2 * time.Millisecond),
	})

	if log.Status != StatusFailed {
		t.Fatalf("expected failed terminal status, got %q", log.Status)
	}
	if log.DomainOutcomes.Budget.Outcome != budget.OutcomeNotChecked ||
		log.DomainOutcomes.Cache.Outcome != "bypassed" ||
		log.DomainOutcomes.Safety.Outcome != "not_checked" ||
		log.DomainOutcomes.Routing.Outcome != "not_checked" ||
		log.DomainOutcomes.Provider.Outcome != "not_called" ||
		log.DomainOutcomes.Fallback.Outcome != "not_called" {
		t.Fatalf("unexpected budget checker error outcomes: %+v", log.DomainOutcomes)
	}
}
