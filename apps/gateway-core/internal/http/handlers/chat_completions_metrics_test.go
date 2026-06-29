package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/auth"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
)

func TestChatCompletionsHandlerRecordsMetricsForSafeRequest(t *testing.T) {
	chatCalls := 0
	registry := metrics.NewRegistry()
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		TerminalLogWriter: logWriter,
		MetricsRegistry:   registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected one provider call, got %d", chatCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}

	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_gateway_inflight_requests{endpoint="/v1/chat/completions",method="POST"} 0`)
	assertHandlerMetricsContains(t, output, `gatelm_provider_requests_total{error_code="none",http_status="200",selected_model="mock-balanced",selected_provider="mock",status="success"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="lookup",status="success"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="write",status="success"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_masking_actions_total{masking_action="none"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_log_writes_total{operation="terminal",status="success"} 1`)
	assertHandlerMetricsHasNoForbiddenLabels(t, output)
}

func TestChatCompletionsHandlerRecordsCacheHitWithoutProviderMetricIncrease(t *testing.T) {
	chatCalls := 0
	registry := metrics.NewRegistry()
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
		MetricsRegistry: registry,
	}
	withTestAuth(&handler)

	first := exerciseMetricsChatRequest(t, &handler, "Write a short refund response.")
	second := exerciseMetricsChatRequest(t, &handler, "Write a short refund response.")

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("expected both requests 200, got first=%d second=%d", first.Code, second.Code)
	}
	if first.Header().Get("X-GateLM-Cache-Status") != "miss" || second.Header().Get("X-GateLM-Cache-Status") != "hit" {
		t.Fatalf("expected miss then hit, got first=%s second=%s", first.Header().Get("X-GateLM-Cache-Status"), second.Header().Get("X-GateLM-Cache-Status"))
	}
	if chatCalls != 1 {
		t.Fatalf("cache hit must not call provider again, got %d provider calls", chatCalls)
	}

	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 2`)
	assertHandlerMetricsContains(t, output, `gatelm_provider_requests_total{error_code="none",http_status="200",selected_model="mock-balanced",selected_provider="mock",status="success"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_cache_operations_total{cache_status="hit",cache_type="exact",operation="lookup",status="success"} 1`)
}

func TestChatCompletionsHandlerRecordsBlockedMetricsBeforeProviderAndCache(t *testing.T) {
	chatCalls := 0
	registry := metrics.NewRegistry()
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:must-not-build"}
	cacheStore := &recordingExactCacheStore{}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: keyBuilder,
		MetricsRegistry:      registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Summarize api_key=test_secret_token_redacted_for_demo_only_1234567890")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("blocked request must not call provider, got %d", chatCalls)
	}
	if keyBuilder.calls != 0 || cacheStore.getCalls != 0 || cacheStore.setCalls != 0 {
		t.Fatalf("blocked request must bypass cache, got key=%d get=%d set=%d", keyBuilder.calls, cacheStore.getCalls, cacheStore.setCalls)
	}

	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="sensitive_data_blocked",http_status="403",method="POST",status="blocked"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_masking_actions_total{masking_action="blocked"} 1`)
	assertHandlerMetricsNotContains(t, output, `gatelm_provider_requests_total{`)
	assertHandlerMetricsNotContains(t, output, `gatelm_cache_operations_total{`)
}

func TestChatCompletionsHandlerRecordsRateLimitedMetricsBeforeProviderAndCache(t *testing.T) {
	chatCalls := 0
	registry := metrics.NewRegistry()
	limiter := &sequenceRateLimiter{
		decisions: []ratelimit.Decision{{
			Allowed:           false,
			Limit:             1,
			Remaining:         0,
			WindowSeconds:     60,
			RetryAfterSeconds: 60,
			Reason:            ratelimit.ReasonLimitExceeded,
		}},
	}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		RateLimitPipeline: newTestRateLimitPipeline(limiter),
		MetricsRegistry:   registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("rate limited request must not call provider, got %d", chatCalls)
	}

	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="rate_limited",http_status="429",method="POST",status="rate_limited"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_rate_limit_decisions_total{rate_limit_allowed="false",status="rate_limited"} 1`)
	assertHandlerMetricsNotContains(t, output, `gatelm_provider_requests_total{`)
	assertHandlerMetricsNotContains(t, output, `gatelm_cache_operations_total{`)
}

func TestChatCompletionsHandlerRecordsLogWriteErrors(t *testing.T) {
	registry := metrics.NewRegistry()
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
		TerminalLogWriter: &recordingTerminalLogWriter{err: errors.New("log store unavailable")},
		MetricsRegistry:   registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 despite log write error, got %d: %s", rr.Code, rr.Body.String())
	}
	assertHandlerMetricsContains(t, registry.RenderPrometheus(), `gatelm_log_writes_total{operation="terminal",status="error"} 1`)
}

func TestChatCompletionsHandlerRecordsAuthFailureLogWriteErrors(t *testing.T) {
	registry := metrics.NewRegistry()
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", recordingProviderAdapter{}),
		DefaultModel:            "mock-balanced",
		DefaultProvider:         "mock",
		APIKeyAuthenticator:     failingAPIKeyAuthenticator{err: auth.ErrInvalidAPIKey},
		AppTokenValidator:       newTestCredentialStore(),
		AuthFailureLogWriter:    failingAuthFailureLogWriter{err: errors.New("auth log store unavailable")},
		MetricsRegistry:         registry,
		TerminalLogWriter:       &recordingTerminalLogWriter{},
		ExpectedTenantID:        testTenantID,
		ExpectedProjectID:       testProjectID,
		ExpectedAppID:           testAppID,
		ExactCacheKeyBuilder:    &recordingExactKeyBuilder{},
		ExactCacheStore:         &recordingExactCacheStore{},
		SecurityPolicyVersionID: "security_policy_p0_v1",
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	req.Header.Set("Authorization", "Bearer invalid_key")
	req.Header.Set("X-GateLM-App-Token", testAppToken)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_log_writes_total{operation="auth_failure",status="error"} 1`)
	assertHandlerMetricsNotContains(t, output, `gatelm_log_writes_total{operation="terminal"`)
}

func exerciseMetricsChatRequest(t *testing.T, handler *ChatCompletionsHandler, prompt string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody(prompt)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

type failingAuthFailureLogWriter struct {
	err error
}

func (w failingAuthFailureLogWriter) WriteAuthFailureLog(_ context.Context, _ invocationlog.AuthFailureLog) error {
	return w.err
}

func assertHandlerMetricsContains(t *testing.T, output string, expected string) {
	t.Helper()
	if !strings.Contains(output, expected) {
		t.Fatalf("expected metrics output to contain %q\noutput:\n%s", expected, output)
	}
}

func assertHandlerMetricsNotContains(t *testing.T, output string, unexpected string) {
	t.Helper()
	if strings.Contains(output, unexpected) {
		t.Fatalf("expected metrics output not to contain %q\noutput:\n%s", unexpected, output)
	}
}

func assertHandlerMetricsHasNoForbiddenLabels(t *testing.T, output string) {
	t.Helper()
	for _, labelName := range []string{
		"request_id",
		"trace_id",
		"tenant_id",
		"project_id",
		"application_id",
		"api_key_id",
		"app_token_id",
		"end_user_id",
		"feature_id",
		"prompt",
		"prompt_hash",
		"request_body_hash",
		"cache_key_hash",
		"provider_key",
		"authorization",
		"raw_error_detail",
	} {
		if strings.Contains(output, labelName+"=") || strings.Contains(output, labelName+"=\"") {
			t.Fatalf("metrics output must not contain forbidden label %q\noutput:\n%s", labelName, output)
		}
	}
}
