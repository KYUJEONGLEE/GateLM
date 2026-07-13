package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

const (
	metricsHandoffSafeMissRequestID  = "request_v1_metrics_safe_success_001"
	metricsHandoffCacheHitRequestID  = "request_v1_metrics_cache_hit_002"
	metricsHandoffRedactedRequestID  = "request_v1_metrics_redacted_003"
	metricsHandoffBlockedRequestID   = "request_v1_metrics_blocked_004"
	metricsHandoffRateLimitRequestID = "request_v1_metrics_rate_limited_005"
	metricsHandoffProviderRequestID  = "request_v1_metrics_provider_error_006"
)

func TestChatCompletionsMetricsHandoffSmoke(t *testing.T) {
	registry := metrics.NewRegistry()
	logWriter := &recordingTerminalLogWriter{}
	demo := newMetricsHandoffHarness(t, registry, logWriter)

	safePrompt := "Write a short safe refund response."
	first := demo.exercise(t, metricsHandoffSafeMissRequestID, safePrompt)
	firstResp := decodeChatCompletionResponse(t, first)
	if first.Code != http.StatusOK {
		t.Fatalf("expected safe miss request to return 200, got %d: %s", first.Code, first.Body.String())
	}
	providerCallsAfterFirst := *demo.providerCalls

	second := demo.exercise(t, metricsHandoffCacheHitRequestID, safePrompt)
	secondResp := decodeChatCompletionResponse(t, second)
	if second.Code != http.StatusOK {
		t.Fatalf("expected cache hit request to return 200, got %d: %s", second.Code, second.Body.String())
	}
	if *demo.providerCalls != providerCallsAfterFirst {
		t.Fatalf("cache hit must not increase provider calls, before=%d after=%d", providerCallsAfterFirst, *demo.providerCalls)
	}

	rawEmail := "user@example.invalid"
	rawPhone := "010-0000-0000"
	redactedPrompt := "Write a safe reply to " + rawEmail + " and ask them to call " + rawPhone + "."
	redacted := demo.exercise(t, metricsHandoffRedactedRequestID, redactedPrompt)
	redactedResp := decodeChatCompletionResponse(t, redacted)
	if redacted.Code != http.StatusOK {
		t.Fatalf("expected redacted request to return 200, got %d: %s", redacted.Code, redacted.Body.String())
	}
	providerPrompt := providerPromptAt(t, *demo.providerRequests, 1)
	if strings.Contains(providerPrompt, rawEmail) || strings.Contains(providerPrompt, rawPhone) ||
		strings.Contains(redacted.Body.String(), rawEmail) || strings.Contains(redacted.Body.String(), rawPhone) {
		t.Fatalf("redacted flow must not expose raw sensitive values")
	}

	providerCallsBeforeBlocked := *demo.providerCalls
	keyBuildsBeforeBlocked := len(demo.keyBuilder.materials)
	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"
	blocked := demo.exercise(t, metricsHandoffBlockedRequestID, "Summarize api_key="+rawSecret)
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

	rateLimited, rateLimitedProviderCalls := metricsHandoffRateLimitedRequest(t, registry, logWriter)
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

	providerError, providerErrorCalls := metricsHandoffProviderErrorRequest(t, registry, logWriter)
	var providerErrorResp gatewayErrorResponse
	if err := json.NewDecoder(providerError.Body).Decode(&providerErrorResp); err != nil {
		t.Fatalf("decode provider error response: %v", err)
	}
	if providerError.Code != http.StatusBadGateway || providerErrorResp.Error.Code != "provider_error" {
		t.Fatalf("expected provider error response, got %d %#v", providerError.Code, providerErrorResp)
	}
	if providerErrorCalls != 1 {
		t.Fatalf("provider error scenario must call provider once, got calls=%d", providerErrorCalls)
	}

	if len(logWriter.logs) != 6 {
		t.Fatalf("expected six terminal log writes, got %d: %#v", len(logWriter.logs), logWriter.logs)
	}

	metricsOutput := metricsHandoffRenderMetrics(t, registry)
	for _, sample := range metricsHandoffExpectedSamples() {
		assertHandlerMetricsContains(t, metricsOutput, sample)
	}
	assertHandlerMetricsHasNoForbiddenLabels(t, metricsOutput)

	t.Logf("\n[Given]\nGateway MetricsRegistry가 켜져 있고, v1 계약의 /metrics endpoint가 Prometheus text를 반환한다.")
	t.Logf("\n[When - 입력]\n%s", metricsHandoffInputOutput(t))
	t.Logf("\n[Then - Gateway 출력]\n%s", metricsHandoffGatewayOutput(t, first, firstResp, second, secondResp, redacted, redactedResp, blocked, blockedResp, rateLimited, rateLimitedResp, providerError, providerErrorResp, providerCallsAfterFirst, *demo.providerCalls, rateLimitedProviderCalls, providerErrorCalls))
	t.Logf("\n[Then - /metrics 출력]\n%s", metricsHandoffMetricsEvidenceOutput(t, metricsOutput))
	t.Logf("\n[의미]\nGateway가 만든 terminal outcome이 Log/Detail/Dashboard뿐 아니라 Prometheus-compatible /metrics에서도 같은 운영 의미로 관측된다. 새 metric 계약을 추가하지 않고 기존 v1 metric name과 label만 사용한다.")
}

type metricsHandoffHarness struct {
	handler          *ChatCompletionsHandler
	providerCalls    *int
	providerRequests *[]provider.ChatCompletionRequest
	cacheStore       *phase3MemoryExactCacheStore
	keyBuilder       *phase3RecordingExactKeyBuilder
}

func newMetricsHandoffHarness(t *testing.T, registry *metrics.Registry, logWriter *recordingTerminalLogWriter) metricsHandoffHarness {
	t.Helper()

	providerCalls := 0
	providerRequests := []provider.ChatCompletionRequest{}
	cacheStore := newPhase3MemoryExactCacheStore()
	keyBuilder := &phase3RecordingExactKeyBuilder{secret: []byte("cache_key_secret_for_v1_metrics_handoff_smoke_only")}
	handler := &ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &providerCalls,
			requests: &providerRequests,
		}),
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: keyBuilder,
		CachePolicyHash:      "cache_policy_metrics_handoff_smoke",
		TerminalLogWriter:    logWriter,
		MetricsRegistry:      registry,
	}
	withTestAuth(handler)

	return metricsHandoffHarness{
		handler:          handler,
		providerCalls:    &providerCalls,
		providerRequests: &providerRequests,
		cacheStore:       cacheStore,
		keyBuilder:       keyBuilder,
	}
}

func (h metricsHandoffHarness) exercise(t *testing.T, requestID string, prompt string) *httptest.ResponseRecorder {
	t.Helper()

	return metricsHandoffExercise(t, h.handler, requestID, prompt)
}

func metricsHandoffRateLimitedRequest(t *testing.T, registry *metrics.Registry, logWriter *recordingTerminalLogWriter) (*httptest.ResponseRecorder, int) {
	t.Helper()

	chatCalls := 0
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
		TerminalLogWriter: logWriter,
		MetricsRegistry:   registry,
	}
	withTestAuth(&handler)

	return metricsHandoffExercise(t, &handler, metricsHandoffRateLimitRequestID, "Write a short safe response after quota is exhausted."), chatCalls
}

func metricsHandoffProviderErrorRequest(t *testing.T, registry *metrics.Registry, logWriter *recordingTerminalLogWriter) (*httptest.ResponseRecorder, int) {
	t.Helper()

	var providerCalls int64
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", metricsHandoffNilProviderAdapter{calls: &providerCalls}),
		TerminalLogWriter: logWriter,
		MetricsRegistry:   registry,
	}
	withTestAuth(&handler)

	return metricsHandoffExercise(t, &handler, metricsHandoffProviderRequestID, "Write a short safe response while upstream is unavailable."), int(atomic.LoadInt64(&providerCalls))
}

func metricsHandoffExercise(t *testing.T, handler *ChatCompletionsHandler, requestID string, prompt string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(phase3ChatCompletionBody(t, "auto", prompt)))
	req.Header.Set(middleware.RequestIDHeader, requestID)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func metricsHandoffRenderMetrics(t *testing.T, registry *metrics.Registry) string {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr := httptest.NewRecorder()
	MetricsHandler{Registry: registry}.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected /metrics 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); got != metrics.PrometheusTextContentType {
		t.Fatalf("unexpected /metrics content type: %q", got)
	}
	return rr.Body.String()
}

func metricsHandoffExpectedSamples() []string {
	return []string{
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 3`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="sensitive_data_blocked",http_status="403",method="POST",status="blocked"} 1`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="rate_limited",http_status="429",method="POST",status="rate_limited"} 1`,
		`gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="provider_error",http_status="502",method="POST",status="failed"} 1`,
		`gatelm_gateway_inflight_requests{endpoint="/v1/chat/completions",method="POST"} 0`,
		`gatelm_provider_requests_total{error_code="none",http_status="200",model="mock-balanced",provider="mock",status="success"} 2`,
		`gatelm_provider_requests_total{error_code="provider_error",http_status="502",model="mock-balanced",provider="mock",status="failed"} 1`,
		`gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="lookup",status="success"} 3`,
		`gatelm_cache_operations_total{cache_status="hit",cache_type="exact",operation="lookup",status="success"} 1`,
		`gatelm_cache_operations_total{cache_status="miss",cache_type="exact",operation="write",status="success"} 2`,
		`gatelm_rate_limit_decisions_total{rate_limit_allowed="false",status="limit_exceeded"} 1`,
		`gatelm_masking_actions_total{masking_action="none"} 4`,
		`gatelm_masking_actions_total{masking_action="redacted"} 1`,
		`gatelm_masking_actions_total{masking_action="blocked"} 1`,
		`gatelm_log_writes_total{operation="terminal",status="success"} 6`,
	}
}

func metricsHandoffInputOutput(t *testing.T) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"chatCompletionRequests": []map[string]any{
			{
				"name": "success",
				"http": "POST /v1/chat/completions",
				"body": map[string]any{
					"model":   "auto",
					"message": "<safe_prompt_short>",
				},
			},
			{
				"name": "cache hit success",
				"http": "POST /v1/chat/completions",
				"body": map[string]any{
					"model":   "auto",
					"message": "<same_safe_prompt_short>",
				},
			},
			{
				"name": "redacted success",
				"http": "POST /v1/chat/completions",
				"body": map[string]any{
					"model":   "auto",
					"message": "Write a safe reply to <email> and ask them to call <phone_number>.",
				},
			},
			{
				"name": "blocked",
				"http": "POST /v1/chat/completions",
				"body": map[string]any{
					"model":   "auto",
					"message": "Summarize api_key=<credential_like_secret>",
				},
			},
			{
				"name": "rate_limited",
				"http": "POST /v1/chat/completions",
				"body": map[string]any{
					"model":   "auto",
					"message": "<safe_prompt_after_quota_exhausted>",
				},
			},
			{
				"name": "provider_error",
				"http": "POST /v1/chat/completions",
				"body": map[string]any{
					"model":   "auto",
					"message": "<safe_prompt_when_provider_unavailable>",
				},
			},
		},
		"metricsRequest": map[string]any{
			"http": "GET /metrics",
		},
		"headers": map[string]string{
			"Authorization":       "Bearer <redacted>",
			"X-GateLM-App-Token":  "<redacted>",
			"X-GateLM-Request-Id": "<synthetic_request_id>",
		},
	})
}

func metricsHandoffGatewayOutput(
	t *testing.T,
	first *httptest.ResponseRecorder,
	firstResp provider.ChatCompletionResponse,
	second *httptest.ResponseRecorder,
	secondResp provider.ChatCompletionResponse,
	redacted *httptest.ResponseRecorder,
	redactedResp provider.ChatCompletionResponse,
	blocked *httptest.ResponseRecorder,
	blockedResp gatewayErrorResponse,
	rateLimited *httptest.ResponseRecorder,
	rateLimitedResp gatewayErrorResponse,
	providerError *httptest.ResponseRecorder,
	providerErrorResp gatewayErrorResponse,
	providerCallsAfterFirst int,
	providerCallsAfterMainFlow int,
	rateLimitedProviderCalls int,
	providerErrorCalls int,
) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"success": metricsHandoffSuccessSummary(first, firstResp, map[string]any{
			"providerCalls": providerCallsAfterFirst,
		}),
		"cacheHit": metricsHandoffSuccessSummary(second, secondResp, map[string]any{
			"providerBypassed": providerCallsAfterMainFlow == 2,
		}),
		"redactedSuccess": metricsHandoffSuccessSummary(redacted, redactedResp, map[string]any{
			"rawSensitiveValueExposed": false,
		}),
		"blocked": metricsHandoffErrorSummary(blocked, blockedResp, map[string]any{
			"stoppedBeforeProviderAndCache": true,
		}),
		"rateLimited": metricsHandoffErrorSummary(rateLimited, rateLimitedResp, map[string]any{
			"providerCalls":             rateLimitedProviderCalls,
			"blockedBeforeProviderCost": rateLimitedProviderCalls == 0,
		}),
		"providerError": metricsHandoffErrorSummary(providerError, providerErrorResp, map[string]any{
			"providerCalls": providerErrorCalls,
			"errorStage":    "call_provider_with_timeout_retry_fallback",
		}),
	})
}

func metricsHandoffSuccessSummary(rr *httptest.ResponseRecorder, resp provider.ChatCompletionResponse, evidence map[string]any) map[string]any {
	gateLM := map[string]any{}
	if resp.GateLM != nil {
		gateLM = map[string]any{
			"requestId":      resp.GateLM.RequestID,
			"requestedModel": resp.GateLM.RequestedModel,
			"executionMode":  resp.GateLM.ExecutionMode,
			"routingReason":  resp.GateLM.RoutingReason,
			"cacheStatus":    resp.GateLM.CacheStatus,
			"maskingAction":  resp.GateLM.MaskingAction,
		}
	}
	return map[string]any{
		"httpStatus":    rr.Code,
		"cacheStatus":   rr.Header().Get("X-GateLM-Cache-Status"),
		"maskingAction": rr.Header().Get("X-GateLM-Masking-Action"),
		"body.gate_lm":  gateLM,
		"evidence":      evidence,
	}
}

func metricsHandoffErrorSummary(rr *httptest.ResponseRecorder, resp gatewayErrorResponse, evidence map[string]any) map[string]any {
	return map[string]any{
		"httpStatus":    rr.Code,
		"cacheStatus":   rr.Header().Get("X-GateLM-Cache-Status"),
		"maskingAction": rr.Header().Get("X-GateLM-Masking-Action"),
		"body.error": map[string]any{
			"code":      resp.Error.Code,
			"message":   resp.Error.Message,
			"requestId": resp.Error.RequestID,
		},
		"evidence": evidence,
	}
}

func metricsHandoffMetricsEvidenceOutput(t *testing.T, metricsOutput string) string {
	t.Helper()

	return demoJSON(t, map[string]any{
		"verifiedSamples": metricsHandoffExpectedSamples(),
		"forbiddenLabels": map[string]any{
			"requestIdOrCredentialLabelsPresent": metricsHandoffHasForbiddenLabels(metricsOutput),
			"checkedLabels": []string{
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
				"cache_key_hash",
				"authorization",
			},
		},
		"meaning": "Gateway terminal outcome이 기존 v1 metrics name/label만으로 Prometheus text에 반영된다.",
	})
}

func metricsHandoffHasForbiddenLabels(output string) bool {
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
			return true
		}
	}
	return false
}

type metricsHandoffNilProviderAdapter struct {
	calls *int64
}

func (a metricsHandoffNilProviderAdapter) AdapterType() string {
	return providercatalog.AdapterTypeMock
}

func (a metricsHandoffNilProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a metricsHandoffNilProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	if a.calls != nil {
		atomic.AddInt64(a.calls, 1)
	}
	return nil, nil
}
