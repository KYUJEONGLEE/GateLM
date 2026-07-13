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
	assertHandlerMetricsContains(t, output, `gatelm_provider_requests_total{error_code="none",http_status="200",model="mock-balanced",provider="mock",status="success"} 1`)
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
	assertHandlerMetricsContains(t, output, `gatelm_provider_requests_total{error_code="none",http_status="200",model="mock-balanced",provider="mock",status="success"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_cache_operations_total{cache_status="hit",cache_type="exact",operation="lookup",status="success"} 1`)
}

func TestChatCompletionsHandlerRecordsBlockedMetricsBeforeProviderAndCache(t *testing.T) {
	chatCalls := 0
	registry := metrics.NewRegistry()
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:must-not-build"}
	cacheStore := &recordingExactCacheStore{}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
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
	assertHandlerMetricsContains(t, output, `gatelm_rate_limit_decisions_total{rate_limit_allowed="false",status="limit_exceeded"} 1`)
	assertHandlerMetricsNotContains(t, output, `gatelm_provider_requests_total{`)
	assertHandlerMetricsNotContains(t, output, `gatelm_cache_operations_total{`)
}

func TestChatCompletionsHandlerRecordsLogWriteErrors(t *testing.T) {
	registry := metrics.NewRegistry()
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
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

func TestChatCompletionsHandlerRecordsStreamingObservabilityMetrics(t *testing.T) {
	registry := metrics.NewRegistry()
	streamingAdapter := &streamingProviderAdapter{
		events: []provider.ChatCompletionStreamEvent{
			streamEvent(t, `{"id":"chatcmpl_stream_metrics","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`),
			streamEvent(t, `{"id":"chatcmpl_stream_metrics","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{},"finish_reason":null}],"usage":{"prompt_tokens":4,"completion_tokens":0,"total_tokens":4}}`),
			streamEvent(t, `{"id":"chatcmpl_stream_metrics","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"첫 토큰"},"finish_reason":null}]}`),
			streamEvent(t, `{"id":"chatcmpl_stream_metrics","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}`),
		},
	}
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", streamingAdapter),
		MetricsRegistry: registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("스트리밍 metric을 확인해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_streams_active{model="mock-balanced",provider="mock"} 0`)
	assertHandlerMetricsContains(t, output, `gatelm_stream_relay_total{error_code="none",model="mock-balanced",provider="mock",stream_outcome="completed"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_stream_duration_seconds_count{error_code="none",model="mock-balanced",provider="mock",stream_outcome="completed"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_stream_time_to_first_token_seconds_count{model="mock-balanced",provider="mock"} 1`)
	assertHandlerMetricsHasNoForbiddenLabels(t, output)
}

func TestChatCompletionsHandlerRecordsInterruptedStreamingMetricsWithoutTTFTBeforeContent(t *testing.T) {
	registry := metrics.NewRegistry()
	streamingAdapter := &streamingProviderAdapter{
		events: []provider.ChatCompletionStreamEvent{
			streamEvent(t, `{"id":"chatcmpl_stream_metrics","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`),
		},
		nextErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("stream interrupted")),
	}
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", streamingAdapter),
		MetricsRegistry: registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("중간 오류 metric을 확인해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_streams_active{model="mock-balanced",provider="mock"} 0`)
	assertHandlerMetricsContains(t, output, `gatelm_stream_relay_total{error_code="provider_error",model="mock-balanced",provider="mock",stream_outcome="interrupted"} 1`)
	assertHandlerMetricsNotContains(t, output, `gatelm_stream_time_to_first_token_seconds_count{model="mock-balanced",provider="mock"}`)
	assertHandlerMetricsHasNoForbiddenLabels(t, output)
}

func TestChatCompletionsHandlerRecordsCancelledStreamingMetrics(t *testing.T) {
	registry := metrics.NewRegistry()
	streamingAdapter := &streamingProviderAdapter{
		events: []provider.ChatCompletionStreamEvent{
			streamEvent(t, `{"id":"chatcmpl_stream_metrics","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"취소 전 토큰"},"finish_reason":null}]}`),
		},
		nextErr: context.Canceled,
	}
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", streamingAdapter),
		MetricsRegistry: registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("취소 metric을 확인해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	output := registry.RenderPrometheus()
	assertHandlerMetricsContains(t, output, `gatelm_streams_active{model="mock-balanced",provider="mock"} 0`)
	assertHandlerMetricsContains(t, output, `gatelm_stream_relay_total{error_code="internal_error",model="mock-balanced",provider="mock",stream_outcome="cancelled"} 1`)
	assertHandlerMetricsContains(t, output, `gatelm_stream_time_to_first_token_seconds_count{model="mock-balanced",provider="mock"} 1`)
	assertHandlerMetricsHasNoForbiddenLabels(t, output)
}

func TestStreamEventHasContentDeltaOnlyForNonEmptyContent(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{
			name: "role only",
			raw:  `{"choices":[{"delta":{"role":"assistant"}}]}`,
			want: false,
		},
		{
			name: "usage only",
			raw:  `{"choices":[{"delta":{}}],"usage":{"prompt_tokens":4,"completion_tokens":0,"total_tokens":4}}`,
			want: false,
		},
		{
			name: "empty content",
			raw:  `{"choices":[{"delta":{"content":""}}]}`,
			want: false,
		},
		{
			name: "whitespace content token",
			raw:  `{"choices":[{"delta":{"content":" "}}]}`,
			want: true,
		},
		{
			name: "korean content",
			raw:  `{"choices":[{"delta":{"content":"안녕"}}]}`,
			want: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := streamEventHasContentDelta([]byte(tc.raw)); got != tc.want {
				t.Fatalf("streamEventHasContentDelta()=%v want %v", got, tc.want)
			}
		})
	}
}

func TestChatCompletionsHandlerRecordsAuthFailureLogWriteErrors(t *testing.T) {
	registry := metrics.NewRegistry()
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", recordingProviderAdapter{}),
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
