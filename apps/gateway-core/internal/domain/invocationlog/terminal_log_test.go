package invocationlog

import (
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/domain/stagetiming"
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
		RedactedPromptPreview:   "Send a reply to [EMAIL_1].",
		SecurityPolicyVersionID: "sec_p0_v1",
		RedactedPromptForHash:   "Send a reply to [EMAIL_1].",
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

func TestBuildTerminalLogStoresLogSafePromptCaptureWhenEnabled(t *testing.T) {
	startedAt := time.Date(2026, 7, 3, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:             "request_prompt_capture",
		ApplicationID:         "app_demo",
		Status:                StatusSuccess,
		HTTPStatus:            200,
		MaskingAction:         "redacted",
		RedactedPromptPreview: "문의: [EMAIL_REDACTED]",
		RedactedPromptForHash: "문의: [EMAIL_REDACTED]",
		PromptCapturePolicy: runtimeconfig.PromptCapturePolicy{
			Enabled:  true,
			Mode:     runtimeconfig.PromptCaptureModeLogSafeFull,
			MaxChars: 5,
		},
		CapturedPrompt: "문의: [EMAIL_REDACTED]",
		StartedAt:      startedAt,
		CompletedAt:    startedAt.Add(10 * time.Millisecond),
	})

	capture, ok := log.Metadata["promptCapture"].(PromptCaptureFields)
	if !ok {
		t.Fatalf("expected prompt capture metadata, got %+v", log.Metadata["promptCapture"])
	}
	if !capture.Enabled ||
		capture.Mode != runtimeconfig.PromptCaptureModeLogSafeFull ||
		capture.Visibility != PromptCaptureVisibilityAdminRequestDetail ||
		capture.CapturedPrompt != "문의: [" ||
		!capture.Truncated ||
		capture.MaxChars != 5 {
		t.Fatalf("unexpected prompt capture metadata: %+v", capture)
	}
}

func TestBuildTerminalLogStoresRawResponseCaptureWhenEnabled(t *testing.T) {
	startedAt := time.Date(2026, 7, 3, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:     "request_response_capture",
		ApplicationID: "app_demo",
		Status:        StatusSuccess,
		HTTPStatus:    200,
		ResponseCapturePolicy: runtimeconfig.ResponseCapturePolicy{
			Enabled:  true,
			Mode:     runtimeconfig.ResponseCaptureModeRawFull,
			MaxChars: 8,
		},
		CapturedResponse: "Mock response",
		StartedAt:        startedAt,
		CompletedAt:      startedAt.Add(10 * time.Millisecond),
	})

	capture, ok := log.Metadata["responseCapture"].(ResponseCaptureFields)
	if !ok {
		t.Fatalf("expected response capture metadata, got %+v", log.Metadata["responseCapture"])
	}
	if !capture.Enabled ||
		capture.Mode != runtimeconfig.ResponseCaptureModeRawFull ||
		capture.Visibility != ResponseCaptureVisibilityAdminRequestDetail ||
		capture.CapturedResponse != "Mock res" ||
		!capture.Truncated ||
		capture.MaxChars != 8 {
		t.Fatalf("unexpected response capture metadata: %+v", capture)
	}
}

func TestBuildResponseCaptureFieldsSanitizesSensitiveValues(t *testing.T) {
	capture, ok := BuildResponseCaptureFields(runtimeconfig.ResponseCapturePolicy{
		Enabled:  true,
		Mode:     runtimeconfig.ResponseCaptureModeRawFull,
		MaxChars: 8000,
	}, `Authorization: Bearer fake_redaction_token api_key=fake_redaction_key app_token=fake_redaction_token 문의 person@example.invalid 전화 +82 10 0000 0000`)
	if !ok {
		t.Fatal("expected response capture fields")
	}
	for _, forbidden := range []string{
		"Bearer fake_redaction_token",
		"fake_redaction_key",
		"fake_redaction_token",
		"person@example.invalid",
		"+82 10 0000 0000",
	} {
		if strings.Contains(capture.CapturedResponse, forbidden) {
			t.Fatalf("captured response contains forbidden value %q: %s", forbidden, capture.CapturedResponse)
		}
	}
	for _, expected := range []string{"Authorization: [REDACTED]", "[SECRET_REDACTED]", "[EMAIL_REDACTED]", "[PHONE_REDACTED]"} {
		if !strings.Contains(capture.CapturedResponse, expected) {
			t.Fatalf("captured response missing %q: %s", expected, capture.CapturedResponse)
		}
	}
}

func TestBuildResponseCaptureFieldsCapsMaxChars(t *testing.T) {
	capture, ok := BuildResponseCaptureFields(runtimeconfig.ResponseCapturePolicy{
		Enabled:  true,
		Mode:     runtimeconfig.ResponseCaptureModeRawFull,
		MaxChars: responseCaptureMaxRunesLimit + 100,
	}, strings.Repeat("a", responseCaptureMaxRunesLimit+10))
	if !ok {
		t.Fatal("expected response capture fields")
	}
	if capture.MaxChars != responseCaptureMaxRunesLimit {
		t.Fatalf("expected max chars cap %d, got %d", responseCaptureMaxRunesLimit, capture.MaxChars)
	}
	if !capture.Truncated {
		t.Fatalf("expected response capture to be truncated: %+v", capture)
	}
	if got := len([]rune(capture.CapturedResponse)); got != responseCaptureMaxRunesLimit {
		t.Fatalf("expected captured response length %d, got %d", responseCaptureMaxRunesLimit, got)
	}
}

func TestBuildTerminalLogSkipsResponseCaptureWhenDisabledOrEmpty(t *testing.T) {
	startedAt := time.Date(2026, 7, 3, 1, 2, 3, 0, time.UTC)
	disabled := BuildTerminalLog(TerminalLogInput{
		RequestID:        "request_response_capture_disabled",
		ApplicationID:    "app_demo",
		Status:           StatusSuccess,
		HTTPStatus:       200,
		CapturedResponse: "Mock response",
		StartedAt:        startedAt,
		CompletedAt:      startedAt.Add(10 * time.Millisecond),
	})
	if _, exists := disabled.Metadata["responseCapture"]; exists {
		t.Fatalf("disabled response capture must not be stored: %+v", disabled.Metadata)
	}

	empty := BuildTerminalLog(TerminalLogInput{
		RequestID:     "request_response_capture_empty",
		ApplicationID: "app_demo",
		Status:        StatusSuccess,
		HTTPStatus:    200,
		ResponseCapturePolicy: runtimeconfig.ResponseCapturePolicy{
			Enabled:  true,
			Mode:     runtimeconfig.ResponseCaptureModeRawFull,
			MaxChars: 8000,
		},
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(10 * time.Millisecond),
	})
	if _, exists := empty.Metadata["responseCapture"]; exists {
		t.Fatalf("empty response capture must not be stored: %+v", empty.Metadata)
	}
}

func TestBuildTerminalLogSkipsPromptCaptureBeforeMaskingOrWhenDisabled(t *testing.T) {
	startedAt := time.Date(2026, 7, 3, 1, 2, 3, 0, time.UTC)
	disabled := BuildTerminalLog(TerminalLogInput{
		RequestID:      "request_prompt_capture_disabled",
		ApplicationID:  "app_demo",
		Status:         StatusSuccess,
		HTTPStatus:     200,
		CapturedPrompt: "문의: [EMAIL_REDACTED]",
		StartedAt:      startedAt,
		CompletedAt:    startedAt.Add(10 * time.Millisecond),
	})
	if _, exists := disabled.Metadata["promptCapture"]; exists {
		t.Fatalf("disabled prompt capture must not be stored: %+v", disabled.Metadata)
	}

	preMasking := BuildTerminalLog(TerminalLogInput{
		RequestID:     "request_prompt_capture_premasking",
		ApplicationID: "app_demo",
		Status:        StatusRateLimited,
		HTTPStatus:    429,
		PromptCapturePolicy: runtimeconfig.PromptCapturePolicy{
			Enabled:  true,
			Mode:     runtimeconfig.PromptCaptureModeLogSafeFull,
			MaxChars: 8000,
		},
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(10 * time.Millisecond),
	})
	if _, exists := preMasking.Metadata["promptCapture"]; exists {
		t.Fatalf("pre-masking terminal path must not store prompt capture: %+v", preMasking.Metadata)
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

func TestBuildTerminalLogMapsPreRoutingExactCacheHitAsSkippedRouting(t *testing.T) {
	startedAt := time.Date(2026, 6, 29, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:         "request_cache_hit",
		ApplicationID:     "app_demo",
		RequestedModel:    "auto",
		Status:            StatusSuccess,
		HTTPStatus:        200,
		CacheStatus:       CacheStatusHit,
		CacheType:         CacheTypeExact,
		CacheHitRequestID: "request_previous",
		StartedAt:         startedAt,
		CompletedAt:       startedAt.Add(4 * time.Millisecond),
	})

	if log.DomainOutcomes.Routing.Outcome != "skipped" {
		t.Fatalf("pre-routing cache hit must skip routing, got %+v", log.DomainOutcomes.Routing)
	}
	if log.DomainOutcomes.Routing.RoutingReason == nil ||
		*log.DomainOutcomes.Routing.RoutingReason != "exact_cache_hit_provider_bypass" {
		t.Fatalf("unexpected pre-routing cache hit reason: %+v", log.DomainOutcomes.Routing)
	}
	if log.DomainOutcomes.Provider.SelectedProvider != nil || log.DomainOutcomes.Provider.SelectedModel != nil {
		t.Fatalf("pre-routing cache hit must not invent provider/model, got %+v", log.DomainOutcomes.Provider)
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

func TestBuildTerminalLogStoresStageTimingsMetadata(t *testing.T) {
	startedAt := time.Date(2026, 7, 4, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:     "request_stage_timing",
		ApplicationID: "app_demo",
		Status:        StatusSuccess,
		HTTPStatus:    200,
		StageTimings: stagetiming.Timings{
			"pii_masking":            {DurationMs: 3, Count: 1},
			"provider_response_wait": {DurationMs: 120, Count: 1},
		},
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(130 * time.Millisecond),
	})

	if log.StageTimings["pii_masking"].DurationMs != 3 {
		t.Fatalf("expected log stage timings to be preserved, got %#v", log.StageTimings)
	}
	timings, ok := log.Metadata["stageTimings"].(stagetiming.Timings)
	if !ok {
		t.Fatalf("expected stageTimings metadata, got %#v", log.Metadata["stageTimings"])
	}
	if timings["provider_response_wait"].DurationMs != 120 || timings["provider_response_wait"].Count != 1 {
		t.Fatalf("unexpected stage timings metadata: %#v", timings)
	}
}

func TestBuildTerminalLogStoresRoutingDiagnosticsMetadata(t *testing.T) {
	startedAt := time.Date(2026, 7, 4, 1, 2, 3, 0, time.UTC)
	log := BuildTerminalLog(TerminalLogInput{
		RequestID:      "request_routing_diagnostics",
		ApplicationID:  "app_demo",
		Status:         StatusSuccess,
		HTTPStatus:     200,
		PromptCategory: routing.CategoryReasoning,
		RoutingDiagnostics: routing.CategoryDiagnostics{
			SelectedCategory: routing.CategoryReasoning,
			TopCategory:      routing.CategoryReasoning,
			TopScore:         3,
			SecondCategory:   routing.CategorySummarization,
			SecondScore:      2,
			ScoreMargin:      1,
			Confidence:       routing.RoutingConfidenceLow,
			Ambiguous:        true,
			AmbiguityReason:  routing.AmbiguityReasonLowMargin,
			ScoreVector: []routing.CategoryScore{
				{Category: routing.CategoryReasoning, Score: 3, Matched: true},
				{Category: routing.CategorySummarization, Score: 2, Matched: true},
			},
		},
		StartedAt:   startedAt,
		CompletedAt: startedAt.Add(10 * time.Millisecond),
	})

	diagnostics, ok := log.Metadata["routingDiagnostics"].(routing.CategoryDiagnostics)
	if !ok {
		t.Fatalf("expected routingDiagnostics metadata, got %#v", log.Metadata["routingDiagnostics"])
	}
	if !diagnostics.Ambiguous || diagnostics.ScoreMargin != 1 || len(diagnostics.ScoreVector) != 2 {
		t.Fatalf("unexpected routing diagnostics metadata: %#v", diagnostics)
	}
}
