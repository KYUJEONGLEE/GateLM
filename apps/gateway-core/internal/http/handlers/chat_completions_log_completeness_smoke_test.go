package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

const (
	logSmokeSafeMissRequestID  = "request_v1_log_safe_success_001"
	logSmokeCacheHitRequestID  = "request_v1_log_cache_hit_002"
	logSmokeRedactedRequestID  = "request_v1_log_redacted_003"
	logSmokeBlockedRequestID   = "request_v1_log_blocked_004"
	logSmokeRateLimitRequestID = "request_v1_log_rate_limited_005"
	logSmokeProviderRequestID  = "request_v1_log_provider_error_006"
)

func TestChatCompletionsLogCompletenessSmoke(t *testing.T) {
	demo := newPhase3DemoHarness(t, runtimeconfig.CachePolicy{
		Enabled:    true,
		Type:       runtimeconfig.CacheTypeExact,
		TTLSeconds: 600,
	})

	safePrompt := "Write a short safe refund response."
	first := demo.exercise(t, logSmokeSafeMissRequestID, safePrompt)
	firstResp := decodeChatCompletionResponse(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("expected safe miss request to return 200, got %d: %s", first.Code, first.Body.String())
	}
	if firstResp.GateLM == nil || firstResp.GateLM.CacheStatus != invocationlog.CacheStatusMiss {
		t.Fatalf("expected safe miss response metadata, got %#v", firstResp.GateLM)
	}
	providerCallsAfterFirst := *demo.providerCalls
	cacheLookupsAfterFirst := demo.cacheStore.getCalls
	cacheWritesAfterFirst := demo.cacheStore.setCalls

	second := demo.exercise(t, logSmokeCacheHitRequestID, safePrompt)
	secondResp := decodeChatCompletionResponse(t, second)
	if second.Code != http.StatusOK {
		t.Fatalf("expected cache hit request to return 200, got %d: %s", second.Code, second.Body.String())
	}
	if secondResp.GateLM == nil || secondResp.GateLM.CacheStatus != invocationlog.CacheStatusHit {
		t.Fatalf("expected cache hit response metadata, got %#v", secondResp.GateLM)
	}
	if *demo.providerCalls != providerCallsAfterFirst {
		t.Fatalf("cache hit must bypass provider, before=%d after=%d", providerCallsAfterFirst, *demo.providerCalls)
	}
	providerCallsAfterSecond := *demo.providerCalls

	rawEmail := "user@example.invalid"
	rawPhone := "010-0000-0000"
	redactedPrompt := "Write a safe reply to " + rawEmail + " and ask them to call " + rawPhone + "."
	redacted := demo.exercise(t, logSmokeRedactedRequestID, redactedPrompt)
	redactedResp := decodeChatCompletionResponse(t, redacted)
	if redacted.Code != http.StatusOK {
		t.Fatalf("expected redacted request to return 200, got %d: %s", redacted.Code, redacted.Body.String())
	}
	if redactedResp.GateLM == nil || redactedResp.GateLM.MaskingAction != "redacted" {
		t.Fatalf("expected redacted response metadata, got %#v", redactedResp.GateLM)
	}
	providerPrompt := providerPromptAt(t, *demo.providerRequests, 1)
	if strings.Contains(providerPrompt, rawEmail) || strings.Contains(providerPrompt, rawPhone) ||
		strings.Contains(redacted.Body.String(), rawEmail) || strings.Contains(redacted.Body.String(), rawPhone) {
		t.Fatalf("redacted flow must not expose raw sensitive values")
	}

	providerCallsBeforeBlocked := *demo.providerCalls
	keyBuildsBeforeBlocked := len(demo.keyBuilder.materials)
	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"
	blocked := demo.exercise(t, logSmokeBlockedRequestID, "Summarize api_key="+rawSecret)
	var blockedResp gatewayErrorResponse
	if err := json.NewDecoder(blocked.Body).Decode(&blockedResp); err != nil {
		t.Fatalf("decode blocked response: %v", err)
	}
	if blocked.Code != http.StatusForbidden || blockedResp.Error.Code != "sensitive_data_blocked" {
		t.Fatalf("expected blocked response, got %d %#v", blocked.Code, blockedResp)
	}
	if *demo.providerCalls != providerCallsBeforeBlocked || len(demo.keyBuilder.materials) != keyBuildsBeforeBlocked {
		t.Fatalf("blocked request must stop before cache key/provider, provider=%d keyBuilds=%d", *demo.providerCalls, len(demo.keyBuilder.materials))
	}
	if strings.Contains(blocked.Body.String(), rawSecret) {
		t.Fatalf("blocked response must not expose raw credential-like value")
	}

	rateLimited, rateLimitedProviderCalls := logSmokeRateLimitedRequest(t, demo.logWriter)
	var rateLimitedResp gatewayErrorResponse
	if err := json.NewDecoder(rateLimited.Body).Decode(&rateLimitedResp); err != nil {
		t.Fatalf("decode rate limited response: %v", err)
	}
	if rateLimited.Code != http.StatusTooManyRequests || rateLimitedResp.Error.Code != "rate_limited" {
		t.Fatalf("expected rate limited response, got %d %#v", rateLimited.Code, rateLimitedResp)
	}
	if rateLimitedProviderCalls != 0 {
		t.Fatalf("rate limited request must stop before provider, got calls=%d", rateLimitedProviderCalls)
	}

	providerError := logSmokeProviderErrorRequest(t, demo.logWriter)
	var providerErrorResp gatewayErrorResponse
	if err := json.NewDecoder(providerError.Body).Decode(&providerErrorResp); err != nil {
		t.Fatalf("decode provider error response: %v", err)
	}
	if providerError.Code != http.StatusBadGateway || providerErrorResp.Error.Code != "provider_error" {
		t.Fatalf("expected provider error response, got %d %#v", providerError.Code, providerErrorResp)
	}

	if len(demo.logWriter.logs) != 6 {
		t.Fatalf("expected six terminal logs, got %d: %#v", len(demo.logWriter.logs), demo.logWriter.logs)
	}
	invocationLogs := logSmokeInvocationLogs(demo.logWriter.logs)
	itemsByID, detailsByID := logSmokeQueryViews(invocationLogs)
	overview := invocationlog.BuildDashboardOverview(invocationLogs)

	logSmokeAssertDetail(t, logSmokeSafeMissRequestID, detailsByID[logSmokeSafeMissRequestID], invocationlog.StatusSuccess, http.StatusOK, invocationlog.CacheStatusMiss, "none", "")
	logSmokeAssertDetail(t, logSmokeCacheHitRequestID, detailsByID[logSmokeCacheHitRequestID], invocationlog.StatusSuccess, http.StatusOK, invocationlog.CacheStatusHit, "none", "")
	if detailsByID[logSmokeCacheHitRequestID].Cache.CacheHitRequestID != logSmokeSafeMissRequestID {
		t.Fatalf("cache hit detail must point to first request, got %#v", detailsByID[logSmokeCacheHitRequestID].Cache)
	}
	logSmokeAssertDetail(t, logSmokeRedactedRequestID, detailsByID[logSmokeRedactedRequestID], invocationlog.StatusSuccess, http.StatusOK, invocationlog.CacheStatusMiss, "redacted", "")
	if detailsByID[logSmokeRedactedRequestID].Masking.MaskingDetectedCount < 2 {
		t.Fatalf("expected redacted detail to carry detection count, got %#v", detailsByID[logSmokeRedactedRequestID].Masking)
	}
	logSmokeAssertDetail(t, logSmokeBlockedRequestID, detailsByID[logSmokeBlockedRequestID], invocationlog.StatusBlocked, http.StatusForbidden, invocationlog.CacheStatusBypass, "blocked", "sensitive_data_blocked")
	if detailsByID[logSmokeBlockedRequestID].Latency.ProviderLatencyMs != nil {
		t.Fatalf("blocked detail must not include provider latency, got %#v", detailsByID[logSmokeBlockedRequestID].Latency)
	}
	logSmokeAssertDetail(t, logSmokeRateLimitRequestID, detailsByID[logSmokeRateLimitRequestID], invocationlog.StatusRateLimited, http.StatusTooManyRequests, invocationlog.CacheStatusBypass, "none", "rate_limited")
	if detailsByID[logSmokeRateLimitRequestID].Latency.ProviderLatencyMs != nil {
		t.Fatalf("rate limited detail must not include provider latency, got %#v", detailsByID[logSmokeRateLimitRequestID].Latency)
	}
	logSmokeAssertDetail(t, logSmokeProviderRequestID, detailsByID[logSmokeProviderRequestID], invocationlog.StatusFailed, http.StatusBadGateway, invocationlog.CacheStatusMiss, "none", "provider_error")

	if overview.TotalRequests != 6 ||
		overview.SuccessfulRequests != 3 ||
		overview.BlockedRequests != 1 ||
		overview.RateLimitedRequests != 1 ||
		overview.FailedRequests != 1 ||
		overview.CacheHitRequests != 1 {
		t.Fatalf("unexpected dashboard overview counts: %#v", overview)
	}
	if overview.StatusCounts[invocationlog.StatusSuccess] != 3 ||
		overview.StatusCounts[invocationlog.StatusBlocked] != 1 ||
		overview.StatusCounts[invocationlog.StatusRateLimited] != 1 ||
		overview.StatusCounts[invocationlog.StatusFailed] != 1 {
		t.Fatalf("unexpected dashboard status counts: %#v", overview.StatusCounts)
	}

	logSmokePrintCase(t,
		"1. safe success",
		"유효한 Gateway API Key와 App Token이 있고, active runtime config에서 rule-based safety, model=auto routing, exact cache가 켜져 있다.",
		demoHTTPRequest(t, "<safe_prompt_short>"),
		demoSuccessHTTPOutput(t, first, firstResp, map[string]any{
			"providerCalls":    providerCallsAfterFirst,
			"cacheLookups":     cacheLookupsAfterFirst,
			"cacheWrites":      cacheWritesAfterFirst,
			"rawPromptShown":   false,
			"rawResponseShown": false,
		}),
		logSmokeLogDetailOutput(t, itemsByID[logSmokeSafeMissRequestID], detailsByID[logSmokeSafeMissRequestID]),
		"첫 번째 정상 요청은 Provider까지 진행되고, Request Log에는 success/miss로 남으며 Dashboard의 successfulRequests에 포함된다.",
	)
	logSmokePrintCase(t,
		"2. cache hit",
		"같은 Application이 같은 안전한 요청을 다시 보낸다.",
		demoHTTPRequest(t, "<same_safe_prompt_short>"),
		demoSuccessHTTPOutput(t, second, secondResp, map[string]any{
			"providerCallsBefore": providerCallsAfterFirst,
			"providerCallsAfter":  providerCallsAfterSecond,
			"providerBypassed":    providerCallsAfterSecond == providerCallsAfterFirst,
			"rawPromptShown":      false,
			"rawResponseShown":    false,
		}),
		logSmokeLogDetailOutput(t, itemsByID[logSmokeCacheHitRequestID], detailsByID[logSmokeCacheHitRequestID]),
		"동일 요청은 exact cache hit로 응답되고 Provider 비용이 다시 발생하지 않으며, Detail에는 원본 hit requestId가 추적된다.",
	)
	logSmokePrintCase(t,
		"3. redacted success",
		"사용자 입력에 email과 phone_number가 있지만 block 대상은 아니다.",
		demoHTTPRequest(t, "Write a safe reply to <email> and ask them to call <phone_number>."),
		demoSuccessHTTPOutput(t, redacted, redactedResp, map[string]any{
			"providerPromptContainsPlaceholders": strings.Contains(providerPrompt, "[EMAIL_REDACTED]") && strings.Contains(providerPrompt, "[PHONE_NUMBER_REDACTED]"),
			"rawSensitiveValueExposed":           false,
			"rawPromptShown":                     false,
			"rawResponseShown":                   false,
		}),
		logSmokeLogDetailOutput(t, itemsByID[logSmokeRedactedRequestID], detailsByID[logSmokeRedactedRequestID]),
		"민감값은 placeholder로 치환된 뒤 Provider로 전달되고, Log/Detail에는 redacted action과 detector count만 남는다.",
	)
	logSmokePrintCase(t,
		"4. blocked",
		"사용자 입력에 credential-like secret이 포함되어 보안 정책상 차단되어야 한다.",
		demoHTTPRequest(t, "Summarize api_key=<credential_like_secret>"),
		demoErrorHTTPOutput(t, blocked, blockedResp, map[string]any{
			"providerCallsUnchanged":   *demo.providerCalls == providerCallsBeforeBlocked,
			"cacheKeyNotBuilt":         len(demo.keyBuilder.materials) == keyBuildsBeforeBlocked,
			"rawSensitiveValueExposed": false,
		}),
		logSmokeLogDetailOutput(t, itemsByID[logSmokeBlockedRequestID], detailsByID[logSmokeBlockedRequestID]),
		"credential-like 입력은 cache/provider 이전에 403으로 차단되고, Dashboard에서는 blockedRequests로 집계된다.",
	)
	logSmokePrintCase(t,
		"5. rate_limited",
		"같은 Application이 PostgreSQL fixed-window 정책상 이미 한도를 초과한 상태다.",
		demoHTTPRequest(t, "<safe_prompt_after_quota_exhausted>"),
		demoErrorHTTPOutput(t, rateLimited, rateLimitedResp, map[string]any{
			"providerCalls":              rateLimitedProviderCalls,
			"blockedBeforeProviderCost":  rateLimitedProviderCalls == 0,
			"rateLimitDecision.reason":   ratelimit.ReasonLimitExceeded,
			"rateLimitDecision.recorded": detailsByID[logSmokeRateLimitRequestID].Status == invocationlog.StatusRateLimited,
		}),
		logSmokeLogDetailOutput(t, itemsByID[logSmokeRateLimitRequestID], detailsByID[logSmokeRateLimitRequestID]),
		"Rate Limit 초과는 Provider 비용 발생 전에 429로 종료되고, first-class status=rate_limited로 Log/Detail/Dashboard에 남는다.",
	)
	logSmokePrintCase(t,
		"6. provider_error",
		"안전성, cache, routing은 통과했지만 Provider adapter가 빈 응답을 반환한다.",
		demoHTTPRequest(t, "<safe_prompt_when_provider_unavailable>"),
		demoErrorHTTPOutput(t, providerError, providerErrorResp, map[string]any{
			"errorStage":           "call_provider_with_timeout_retry_fallback",
			"rawResponseShown":     false,
			"rawProviderBodyShown": false,
		}),
		logSmokeLogDetailOutput(t, itemsByID[logSmokeProviderRequestID], detailsByID[logSmokeProviderRequestID]),
		"Provider 장애는 policy outcome이 아니라 product failure로 status=failed에 집계되고, errorStage로 원인을 추적한다.",
	)
	t.Logf("\n[Then - Dashboard 전체 출력]\n%s", logSmokeDashboardOutput(t, overview))
}

func logSmokeRateLimitedRequest(t *testing.T, logWriter *recordingTerminalLogWriter) (*httptest.ResponseRecorder, int) {
	t.Helper()

	chatCalls := 0
	limiter := &sequenceRateLimiter{
		decisions: []ratelimit.Decision{
			{
				Allowed:           false,
				Limit:             1,
				Remaining:         0,
				WindowSeconds:     60,
				RetryAfterSeconds: 60,
				Reason:            ratelimit.ReasonLimitExceeded,
			},
		},
	}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		RateLimitPipeline: newTestRateLimitPipeline(limiter),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	return logSmokeExercise(t, &handler, logSmokeRateLimitRequestID, "Write a short safe response after quota is exhausted."), chatCalls
}

func logSmokeProviderErrorRequest(t *testing.T, logWriter *recordingTerminalLogWriter) *httptest.ResponseRecorder {
	t.Helper()

	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("nil-provider", nilProviderAdapter{}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "nil-provider",
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	return logSmokeExercise(t, &handler, logSmokeProviderRequestID, "Write a short safe response while upstream is unavailable.")
}

func logSmokeExercise(t *testing.T, handler *ChatCompletionsHandler, requestID string, prompt string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(phase3ChatCompletionBody(t, "auto", prompt)))
	req.Header.Set(middleware.RequestIDHeader, requestID)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func logSmokeInvocationLogs(terminalLogs []invocationlog.TerminalLog) []invocationlog.LlmInvocationLog {
	invocationLogs := make([]invocationlog.LlmInvocationLog, 0, len(terminalLogs))
	for _, log := range terminalLogs {
		completedAt := log.CompletedAt
		invocationLogs = append(invocationLogs, invocationlog.LlmInvocationLog{
			RequestID:             log.RequestID,
			TraceID:               log.TraceID,
			TenantID:              log.TenantID,
			ProjectID:             log.ProjectID,
			ApplicationID:         log.ApplicationID,
			APIKeyID:              log.APIKeyID,
			AppTokenID:            log.AppTokenID,
			EndUserID:             log.EndUserID,
			FeatureID:             log.FeatureID,
			Endpoint:              log.Endpoint,
			Method:                log.Method,
			Source:                log.Source,
			Stream:                log.Stream,
			RequestedProvider:     log.RequestedProvider,
			RequestedModel:        log.RequestedModel,
			Provider:              log.Provider,
			Model:                 log.Model,
			SelectedProvider:      log.SelectedProvider,
			SelectedModel:         log.SelectedModel,
			RoutingReason:         log.RoutingReason,
			PromptTokens:          int64(log.PromptTokens),
			CompletionTokens:      int64(log.CompletionTokens),
			TotalTokens:           int64(log.TotalTokens),
			CostMicroUSD:          log.CostMicroUSD,
			SavedCostMicroUSD:     log.SavedCostMicroUSD,
			LatencyMs:             log.LatencyMs,
			ProviderLatencyMs:     log.ProviderLatencyMs,
			Status:                log.Status,
			HTTPStatus:            log.HTTPStatus,
			ErrorCode:             log.ErrorCode,
			ErrorMessage:          log.ErrorMessage,
			ErrorStage:            log.ErrorStage,
			CacheStatus:           log.CacheStatus,
			CacheType:             log.CacheType,
			CacheKeyHash:          log.CacheKeyHash,
			CacheHitRequestID:     log.CacheHitRequestID,
			MaskingAction:         log.MaskingAction,
			MaskingDetectedTypes:  append([]string(nil), log.MaskingDetectedTypes...),
			MaskingDetectedCount:  log.MaskingDetectedCount,
			RedactedPromptPreview: log.RedactedPromptPreview,
			CreatedAt:             log.CreatedAt,
			CompletedAt:           &completedAt,
		})
	}
	return invocationLogs
}

func logSmokeQueryViews(logs []invocationlog.LlmInvocationLog) (map[string]invocationlog.RequestLogListItem, map[string]invocationlog.RequestDetail) {
	itemsByID := make(map[string]invocationlog.RequestLogListItem, len(logs))
	detailsByID := make(map[string]invocationlog.RequestDetail, len(logs))
	for _, log := range logs {
		itemsByID[log.RequestID] = invocationlog.ToRequestLogListItem(log)
		detailsByID[log.RequestID] = invocationlog.ToRequestDetail(log)
	}
	return itemsByID, detailsByID
}

func logSmokeAssertDetail(t *testing.T, expectedRequestID string, detail invocationlog.RequestDetail, status string, httpStatus int, cacheStatus string, maskingAction string, errorCode string) {
	t.Helper()

	if detail.RequestID == "" {
		t.Fatalf("expected request detail for %s to be present, got empty/missing detail", expectedRequestID)
	}
	if detail.RequestID != expectedRequestID {
		t.Fatalf("expected request detail for %s, got %s: %#v", expectedRequestID, detail.RequestID, detail)
	}
	if detail.Status != status || detail.HTTPStatus != httpStatus {
		t.Fatalf("unexpected detail status for %s: %#v", detail.RequestID, detail)
	}
	if detail.Cache.CacheStatus != cacheStatus {
		t.Fatalf("unexpected cache status for %s: %#v", detail.RequestID, detail.Cache)
	}
	if detail.Masking.MaskingAction != maskingAction {
		t.Fatalf("unexpected masking action for %s: %#v", detail.RequestID, detail.Masking)
	}
	if detail.Error.ErrorCode != errorCode {
		t.Fatalf("unexpected error code for %s: %#v", detail.RequestID, detail.Error)
	}
}

func logSmokePrintCase(t *testing.T, label string, given string, input string, gatewayOutput string, logOutput string, meaning string) {
	t.Helper()

	t.Logf("\n[%s]\n[Given]\n%s\n\n[When - 입력]\n%s\n\n[Then - Gateway 출력]\n%s\n\n[Then - Log/Detail/Dashboard 출력]\n%s\n\n[의미]\n%s",
		label,
		given,
		input,
		gatewayOutput,
		logOutput,
		meaning,
	)
}

func logSmokeLogDetailOutput(t *testing.T, item invocationlog.RequestLogListItem, detail invocationlog.RequestDetail) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"requestLogListItem": map[string]any{
			"requestId":        item.RequestID,
			"projectId":        item.ProjectID,
			"applicationId":    item.ApplicationID,
			"status":           item.Status,
			"httpStatus":       item.HTTPStatus,
			"requestedModel":   item.RequestedModel,
			"selectedProvider": item.Provider,
			"selectedModel":    item.SelectedModel,
			"cacheStatus":      item.CacheStatus,
			"cacheType":        item.CacheType,
			"maskingAction":    item.MaskingAction,
			"routingReason":    item.RoutingReason,
			"totalTokens":      item.TotalTokens,
			"costMicroUsd":     item.CostMicroUSD,
			"latencyMs":        item.LatencyMs,
		},
		"requestDetail": map[string]any{
			"identity": map[string]any{
				"tenantId":      detail.TenantID,
				"projectId":     detail.ProjectID,
				"applicationId": detail.ApplicationID,
			},
			"status": map[string]any{
				"status":     detail.Status,
				"httpStatus": detail.HTTPStatus,
			},
			"cache": map[string]any{
				"cacheStatus":       detail.Cache.CacheStatus,
				"cacheType":         detail.Cache.CacheType,
				"cacheKeyHash":      detail.Cache.CacheKeyHash,
				"cacheHitRequestId": detail.Cache.CacheHitRequestID,
			},
			"masking": map[string]any{
				"maskingAction":         detail.Masking.MaskingAction,
				"maskingDetectedTypes":  detail.Masking.MaskingDetectedTypes,
				"maskingDetectedCount":  detail.Masking.MaskingDetectedCount,
				"redactedPromptPreview": logSmokePreviewForOutput(detail.Masking.RedactedPromptPreview, detail.Masking.MaskingAction),
			},
			"routing": map[string]any{
				"selectedProvider": detail.Routing.SelectedProvider,
				"selectedModel":    detail.Routing.SelectedModel,
				"routingReason":    detail.Routing.RoutingReason,
			},
			"error": map[string]any{
				"errorCode":  detail.Error.ErrorCode,
				"errorStage": detail.Error.ErrorStage,
			},
			"latency": map[string]any{
				"latencyMs":             detail.Latency.LatencyMs,
				"providerLatencyMs":     logSmokeOptionalInt64(detail.Latency.ProviderLatencyMs),
				"providerLatencyIsNull": detail.Latency.ProviderLatencyMs == nil,
			},
		},
		"dashboardContribution": logSmokeDashboardContribution(detail.Status),
	})
}

func logSmokeDashboardOutput(t *testing.T, overview invocationlog.DashboardOverviewFields) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"totals": map[string]any{
			"totalRequests":         overview.TotalRequests,
			"successfulRequests":    overview.SuccessfulRequests,
			"failedRequests":        overview.FailedRequests,
			"blockedRequests":       overview.BlockedRequests,
			"rateLimitedRequests":   overview.RateLimitedRequests,
			"cacheHitRequests":      overview.CacheHitRequests,
			"cacheEligibleRequests": overview.CacheEligibleRequests,
			"cacheHitRate":          logSmokeOptionalFloat64(overview.CacheHitRate),
		},
		"statusCounts":        overview.StatusCounts,
		"maskingActionCounts": overview.MaskingActionCounts,
		"meaning":             "Request Log list와 Request Detail에 저장된 terminal status가 Dashboard Overview 집계 기준으로도 같은 숫자를 만든다.",
	})
}

func logSmokeDashboardContribution(status string) map[string]any {
	contribution := map[string]any{
		"statusBucket":        status,
		"successfulRequests":  false,
		"failedRequests":      false,
		"blockedRequests":     false,
		"rateLimitedRequests": false,
		"explanation":         "이 status는 Dashboard의 기본 statusCounts에 반영된다.",
	}
	switch status {
	case invocationlog.StatusSuccess:
		contribution["successfulRequests"] = true
	case invocationlog.StatusFailed:
		contribution["failedRequests"] = true
	case invocationlog.StatusBlocked:
		contribution["blockedRequests"] = true
		contribution["explanation"] = "blocked는 정책 차단 결과이며 product failure로 세지 않는다."
	case invocationlog.StatusRateLimited:
		contribution["rateLimitedRequests"] = true
		contribution["explanation"] = "rate_limited는 정책 차단 결과이며 product failure로 세지 않는다."
	}
	return contribution
}

func logSmokePreviewForOutput(preview string, maskingAction string) string {
	if strings.TrimSpace(preview) == "" {
		return ""
	}
	switch maskingAction {
	case "redacted", "blocked":
		return preview
	default:
		return "<redacted_prompt_preview>"
	}
}

func logSmokeOptionalInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func logSmokeOptionalFloat64(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
