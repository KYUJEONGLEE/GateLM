package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

const (
	defaultGatewayBaseURL      = "http://localhost:8080"
	defaultMockProviderBaseURL = "http://localhost:8090"
	defaultDemoAPIKey          = "glm_api_test_redacted"
	defaultDemoAppToken        = "glm_app_token_test_redacted"
	defaultDemoProjectID       = "00000000-0000-4000-8000-000000000200"
)

func TestGatewayLocalStackSmoke(t *testing.T) {
	if os.Getenv("GATELM_LOCAL_STACK_SMOKE") != "1" {
		t.Skip("set GATELM_LOCAL_STACK_SMOKE=1 to run the Docker-backed local stack smoke")
	}

	cfg := loadLocalStackSmokeConfig()
	client := &http.Client{Timeout: 10 * time.Second}
	runStart := time.Now().UTC().Add(-24 * time.Hour)

	ids := map[string]string{
		"safeMiss":    "request_local_stack_" + cfg.runID + "_safe_miss_001",
		"cacheHit":    "request_local_stack_" + cfg.runID + "_cache_hit_002",
		"redacted":    "request_local_stack_" + cfg.runID + "_redacted_003",
		"blocked":     "request_local_stack_" + cfg.runID + "_blocked_004",
		"rateLimited": "request_local_stack_" + cfg.runID + "_rate_limited_005",
	}

	safePrompt := "Write a short local stack smoke response for run " + cfg.runID + "."
	rawEmail := "minji.kim@example.test"
	rawPhone := "010-0000-1234"
	redactedPrompt := "Write a support note to " + rawEmail + " and ask them to call " + rawPhone + "."
	rawCredential := "test_secret_token_redacted_for_demo_only_" + cfg.runID + "_abcdef1234567890"
	blockedPrompt := "Summarize this synthetic config: api_key=" + rawCredential
	rateLimitedPrompt := "Write one more local stack smoke response after quota is exhausted."

	ready := doGet(t, client, cfg.gatewayBaseURL+"/readyz", "")
	requireHTTPStatus(t, ready, http.StatusOK)
	models := doGet(t, client, cfg.gatewayBaseURL+"/v1/models", "request_local_stack_"+cfg.runID+"_models_000")
	requireHTTPStatus(t, models, http.StatusOK)
	requireContains(t, string(models.body), "mock-fast")
	requireContains(t, string(models.body), "mock-balanced")

	t.Logf("\n[Given]\nDocker Postgres, Redis, Mock Provider, 실제 cmd/gateway 서버가 켜져 있고 demo tenant/project/application seed가 적용되어 있다.")
	t.Logf("\n[When - 입력]\n%s", prettyJSON(t, map[string]any{
		"health": "GET /readyz",
		"models": "GET /v1/models",
		"headers": map[string]string{
			"Authorization":        "Bearer <redacted>",
			"X-GateLM-App-Token":   "<redacted>",
			"X-GateLM-Request-Id":  "request_local_stack_" + cfg.runID + "_models_000",
			"X-GateLM-End-User-Id": "user_local_stack_smoke",
		},
	}))
	t.Logf("\n[Then - Gateway 출력]\n%s", prettyJSON(t, map[string]any{
		"readyz": map[string]any{
			"httpStatus": ready.statusCode,
			"body":       summarizeJSON(ready.json),
		},
		"models": map[string]any{
			"httpStatus":      models.statusCode,
			"containsModels":  []string{"mock-fast", "mock-balanced"},
			"rawCredentialIn": false,
		},
	}))
	t.Logf("\n[의미]\nGateway 서버가 실제 Docker dependency에 연결되어 있고, Gateway 표면에서 Mock Provider 모델 catalog를 조회할 수 있음을 확인한다.")

	beforeCalls := mockProviderTotalCalls(t, client, cfg)

	safeMiss := postChat(t, client, cfg, ids["safeMiss"], safePrompt)
	requireHTTPStatus(t, safeMiss.http, http.StatusOK)
	requireEqual(t, safeMiss.gateLM.CacheStatus, "miss", "safe miss cache status")
	requireEqual(t, safeMiss.gateLM.SelectedProvider, "mock", "safe miss selected provider")
	requireEqual(t, safeMiss.gateLM.SelectedModel, "mock-fast", "safe miss selected model")
	requireEqual(t, safeMiss.gateLM.RoutingReason, "short_prompt_low_cost", "safe miss routing reason")
	afterSafeMissCalls := mockProviderTotalCalls(t, client, cfg)
	requireEqual(t, afterSafeMissCalls-beforeCalls, 1, "safe miss provider call increment")

	t.Logf("\n[Given]\n유효한 API Key/App Token과 runtime config가 있고, exact cache에는 아직 같은 요청 결과가 없다.")
	t.Logf("\n[When - 입력]\n%s", localStackChatInput(t, ids["safeMiss"], "<safe_prompt_local_stack>"))
	t.Logf("\n[Then - Gateway 출력]\n%s", prettyJSON(t, map[string]any{
		"httpStatus": safeMiss.http.statusCode,
		"headers": map[string]string{
			"X-GateLM-Cache-Status":    safeMiss.http.header.Get("X-GateLM-Cache-Status"),
			"X-GateLM-Masking-Action":  safeMiss.http.header.Get("X-GateLM-Masking-Action"),
			"X-GateLM-Routed-Provider": safeMiss.http.header.Get("X-GateLM-Routed-Provider"),
			"X-GateLM-Routed-Model":    safeMiss.http.header.Get("X-GateLM-Routed-Model"),
		},
		"body.gate_lm": map[string]any{
			"cacheStatus":      safeMiss.gateLM.CacheStatus,
			"selectedProvider": safeMiss.gateLM.SelectedProvider,
			"selectedModel":    safeMiss.gateLM.SelectedModel,
			"routingReason":    safeMiss.gateLM.RoutingReason,
			"maskingAction":    safeMiss.gateLM.MaskingAction,
		},
		"mockProvider": map[string]any{
			"totalCallsBefore": beforeCalls,
			"totalCallsAfter":  afterSafeMissCalls,
		},
	}))
	t.Logf("\n[의미]\n안전한 첫 요청은 rate limit, safety, cache miss, routing을 거쳐 Provider까지 도달하고 success/miss로 끝난다.")

	cacheHit := postChat(t, client, cfg, ids["cacheHit"], safePrompt)
	requireHTTPStatus(t, cacheHit.http, http.StatusOK)
	requireEqual(t, cacheHit.gateLM.CacheStatus, "hit", "cache hit status")
	afterCacheHitCalls := mockProviderTotalCalls(t, client, cfg)
	requireEqual(t, afterCacheHitCalls, afterSafeMissCalls, "cache hit provider call count")

	t.Logf("\n[Given]\n동일 Application이 같은 safe request를 다시 보낸다.")
	t.Logf("\n[When - 입력]\n%s", localStackChatInput(t, ids["cacheHit"], "<same_safe_prompt_local_stack>"))
	t.Logf("\n[Then - Gateway 출력]\n%s", prettyJSON(t, map[string]any{
		"httpStatus": cacheHit.http.statusCode,
		"body.gate_lm": map[string]any{
			"cacheStatus":                   cacheHit.gateLM.CacheStatus,
			"selectedModel":                 cacheHit.gateLM.SelectedModel,
			"cacheHitRequestIdEvidence":     "Request Detail에서 확인",
			"clientResponseRawPromptStored": false,
		},
		"mockProvider": map[string]any{
			"totalCallsBefore":      afterSafeMissCalls,
			"totalCallsAfter":       afterCacheHitCalls,
			"providerBypassed":      afterCacheHitCalls == afterSafeMissCalls,
			"providerCostAvoided":   true,
			"cacheHitSourceRequest": ids["safeMiss"],
		},
	}))
	t.Logf("\n[의미]\nRedis exact cache hit이면 Provider를 다시 호출하지 않고, cache hit request가 원본 miss requestId를 추적한다.")

	redacted := postChat(t, client, cfg, ids["redacted"], redactedPrompt)
	requireHTTPStatus(t, redacted.http, http.StatusOK)
	requireEqual(t, redacted.gateLM.MaskingAction, "redacted", "redacted masking action")
	afterRedactedCalls := mockProviderTotalCalls(t, client, cfg)
	requireEqual(t, afterRedactedCalls-afterCacheHitCalls, 1, "redacted provider call increment")
	redactedCall := requireMockCall(t, client, cfg, ids["redacted"])
	requireContains(t, redactedCall.RedactedPromptPreview, "[EMAIL_REDACTED]")
	requireContains(t, redactedCall.RedactedPromptPreview, "[PHONE_NUMBER_REDACTED]")
	requireNotContains(t, redactedCall.RedactedPromptPreview, rawEmail)
	requireNotContains(t, redactedCall.RedactedPromptPreview, rawPhone)

	t.Logf("\n[Given]\n요청 prompt에 email과 phone_number가 포함되어 있지만 v1 정책상 redaction 후 계속 진행 가능한 유형이다.")
	t.Logf("\n[When - 입력]\n%s", localStackChatInput(t, ids["redacted"], "Write a support note to <email> and <phone_number>."))
	t.Logf("\n[Then - Gateway 출력]\n%s", prettyJSON(t, map[string]any{
		"httpStatus": redacted.http.statusCode,
		"body.gate_lm": map[string]any{
			"cacheStatus":   redacted.gateLM.CacheStatus,
			"maskingAction": redacted.gateLM.MaskingAction,
		},
		"mockProvider": map[string]any{
			"totalCallsAfter":                    afterRedactedCalls,
			"redactedPromptPreview":              redactedCall.RedactedPromptPreview,
			"providerReceivedOnlyPlaceholders":   true,
			"rawSensitiveValueExposedToProvider": false,
		},
	}))
	t.Logf("\n[의미]\nGateway safety stage가 raw 민감값을 placeholder로 바꾼 뒤 Provider에 전달한다. Provider stats에도 raw 값은 남지 않는다.")

	blocked := postChat(t, client, cfg, ids["blocked"], blockedPrompt)
	requireHTTPStatus(t, blocked.http, http.StatusForbidden)
	requireEqual(t, blocked.errorBody.Error.Code, "sensitive_data_blocked", "blocked error code")
	afterBlockedCalls := mockProviderTotalCalls(t, client, cfg)
	requireEqual(t, afterBlockedCalls, afterRedactedCalls, "blocked provider call count")

	t.Logf("\n[Given]\n요청 prompt에 credential-like secret이 포함되어 있고 v1 정책상 block 대상이다.")
	t.Logf("\n[When - 입력]\n%s", localStackChatInput(t, ids["blocked"], "Summarize api_key=<credential_like_secret>"))
	t.Logf("\n[Then - Gateway 출력]\n%s", prettyJSON(t, map[string]any{
		"httpStatus": blocked.http.statusCode,
		"body.error": map[string]any{
			"code":       blocked.errorBody.Error.Code,
			"request_id": blocked.errorBody.Error.RequestID,
		},
		"headers": map[string]string{
			"X-GateLM-Cache-Status":   blocked.http.header.Get("X-GateLM-Cache-Status"),
			"X-GateLM-Masking-Action": blocked.http.header.Get("X-GateLM-Masking-Action"),
		},
		"mockProvider": map[string]any{
			"totalCallsBefore":    afterRedactedCalls,
			"totalCallsAfter":     afterBlockedCalls,
			"providerBypassed":    true,
			"cacheBypassedBefore": "cache key build/provider call",
		},
	}))
	t.Logf("\n[의미]\nblock 대상 민감정보는 cache key 생성과 Provider 호출 전에 403 sensitive_data_blocked로 종료된다.")

	rateLimited := postChat(t, client, cfg, ids["rateLimited"], rateLimitedPrompt)
	requireHTTPStatus(t, rateLimited.http, http.StatusTooManyRequests)
	requireEqual(t, rateLimited.errorBody.Error.Code, "rate_limited", "rate limited error code")
	afterRateLimitedCalls := mockProviderTotalCalls(t, client, cfg)
	requireEqual(t, afterRateLimitedCalls, afterBlockedCalls, "rate limited provider call count")

	t.Logf("\n[Given]\n동일 Application이 60초 fixed window에서 local smoke limit을 초과했다.")
	t.Logf("\n[When - 입력]\n%s", localStackChatInput(t, ids["rateLimited"], "<safe_prompt_after_quota_exhausted>"))
	t.Logf("\n[Then - Gateway 출력]\n%s", prettyJSON(t, map[string]any{
		"httpStatus": rateLimited.http.statusCode,
		"body.error": map[string]any{
			"code":       rateLimited.errorBody.Error.Code,
			"request_id": rateLimited.errorBody.Error.RequestID,
		},
		"mockProvider": map[string]any{
			"totalCallsBefore": afterBlockedCalls,
			"totalCallsAfter":  afterRateLimitedCalls,
			"providerBypassed": true,
			"blockedBefore":    "provider cost",
		},
	}))
	t.Logf("\n[의미]\nRate Limit 초과 요청은 Provider 비용이 발생하기 전에 429 rate_limited terminal outcome으로 끝난다.")

	runEnd := time.Now().UTC().Add(24 * time.Hour)
	logs := getProjectLogs(t, client, cfg, runStart, runEnd)
	requireLogStatuses(t, logs.Data, map[string]int{
		"success":      3,
		"blocked":      1,
		"rate_limited": 1,
	})
	requireLogItem(t, logs.Data, ids["safeMiss"], "success", "miss")
	requireLogItem(t, logs.Data, ids["cacheHit"], "success", "hit")
	requireLogItem(t, logs.Data, ids["redacted"], "success", "miss")
	requireLogItem(t, logs.Data, ids["blocked"], "blocked", "bypass")
	requireLogItem(t, logs.Data, ids["rateLimited"], "rate_limited", "bypass")

	detail := getRequestDetail(t, client, cfg, ids["cacheHit"])
	requireEqual(t, detail.Data.RequestID, ids["cacheHit"], "detail request id")
	requireEqual(t, detail.Data.Status, "success", "detail status")
	if detail.Data.Cache.CacheHitRequestID == nil || *detail.Data.Cache.CacheHitRequestID != ids["safeMiss"] {
		t.Fatalf("expected detail cacheHitRequestId=%q, got %#v", ids["safeMiss"], detail.Data.Cache.CacheHitRequestID)
	}

	dashboard := getDashboardOverview(t, client, cfg, runStart, runEnd)
	requireEqual(t, dashboard.Data.Totals.TotalRequests, int64(5), "dashboard total requests")
	requireEqual(t, dashboard.Data.Totals.SuccessfulRequests, int64(3), "dashboard successful requests")
	requireEqual(t, dashboard.Data.Totals.BlockedRequests, int64(1), "dashboard blocked requests")
	requireEqual(t, dashboard.Data.Totals.RateLimitedRequests, int64(1), "dashboard rate limited requests")
	requireEqual(t, dashboard.Data.Totals.CacheHitRequests, int64(1), "dashboard cache hit requests")

	metrics := doGet(t, client, cfg.gatewayBaseURL+"/metrics", "request_local_stack_"+cfg.runID+"_metrics_006")
	requireHTTPStatus(t, metrics, http.StatusOK)
	metricsText := string(metrics.body)
	requireContains(t, metricsText, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="none",http_status="200",method="POST",status="success"} 3`)
	requireNotContains(t, metricsText, `status="cache_hit"`)
	requireContains(t, metricsText, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="sensitive_data_blocked",http_status="403",method="POST",status="blocked"} 1`)
	requireContains(t, metricsText, `gatelm_gateway_requests_total{endpoint="/v1/chat/completions",error_code="rate_limited",http_status="429",method="POST",status="rate_limited"} 1`)
	requireContains(t, metricsText, `gatelm_provider_requests_total`)
	requireContains(t, metricsText, `selected_model="mock-fast"`)
	requireContains(t, metricsText, `gatelm_cache_operations_total`)
	requireContains(t, metricsText, `cache_status="hit"`)
	requireContains(t, metricsText, `gatelm_rate_limit_decisions_total`)
	requireContains(t, metricsText, `rate_limit_allowed="false"`)
	requireContains(t, metricsText, `status="rate_limited"`)
	requireContains(t, metricsText, `gatelm_masking_actions_total`)
	requireContains(t, metricsText, `masking_action="redacted"`)
	requireContains(t, metricsText, `masking_action="blocked"`)
	requireContains(t, metricsText, `gatelm_log_writes_total`)
	requireNoForbiddenMetricLabels(t, metricsText)

	observabilityPayloads := []string{
		prettyJSON(t, logs),
		prettyJSON(t, detail),
		prettyJSON(t, dashboard),
		metricsText,
	}
	for _, rawValue := range []string{safePrompt, rawEmail, rawPhone, rawCredential} {
		for _, payload := range observabilityPayloads {
			requireNotContains(t, payload, rawValue)
		}
	}

	t.Logf("\n[Then - Log/Detail/Dashboard/Metrics 출력]\n%s", prettyJSON(t, map[string]any{
		"requestLog": map[string]any{
			"totalItems": len(logs.Data),
			"statusCounts": map[string]int{
				"success":      countLogsByStatus(logs.Data, "success"),
				"blocked":      countLogsByStatus(logs.Data, "blocked"),
				"rate_limited": countLogsByStatus(logs.Data, "rate_limited"),
			},
			"items": compactLogItems(logs.Data),
		},
		"requestDetail": map[string]any{
			"requestId":         detail.Data.RequestID,
			"status":            detail.Data.Status,
			"cacheStatus":       detail.Data.Cache.CacheStatus,
			"cacheHitRequestId": valueOrNil(detail.Data.Cache.CacheHitRequestID),
			"providerLatencyMs": detail.Data.Latency.ProviderLatencyMs,
		},
		"dashboard": map[string]any{
			"totalRequests":       dashboard.Data.Totals.TotalRequests,
			"successfulRequests":  dashboard.Data.Totals.SuccessfulRequests,
			"blockedRequests":     dashboard.Data.Totals.BlockedRequests,
			"rateLimitedRequests": dashboard.Data.Totals.RateLimitedRequests,
			"cacheHitRequests":    dashboard.Data.Totals.CacheHitRequests,
			"statusCounts":        dashboard.Data.Totals.StatusCounts,
		},
		"metrics": map[string]any{
			"gatewayRequests": "success/blocked/rate_limited terminal labels present; cache hit is success",
			"providerCalls":   "cache hit, blocked, rate_limited do not add provider calls",
			"cache":           "miss/hit/bypass evidence present",
			"rateLimit":       "allowed=true and allowed=false evidence present",
			"masking":         "none/redacted/blocked evidence present",
			"logWrites":       "terminal log write evidence present",
			"forbiddenLabels": "absent",
		},
	}))
	t.Logf("\n[의미]\n실제 Gateway 서버가 만든 terminal outcome이 PostgreSQL Request Log/Detail/Dashboard와 Prometheus-compatible /metrics까지 이어진다. 이 smoke는 v1.0.0 release candidate baseline을 Docker local stack에서 반복 재현할 수 있다는 증거다.")
}

type localStackSmokeConfig struct {
	gatewayBaseURL      string
	mockProviderBaseURL string
	apiKey              string
	appToken            string
	projectID           string
	runID               string
}

func loadLocalStackSmokeConfig() localStackSmokeConfig {
	return localStackSmokeConfig{
		gatewayBaseURL:      trimTrailingSlash(envOrDefault("GATEWAY_BASE_URL", defaultGatewayBaseURL)),
		mockProviderBaseURL: trimTrailingSlash(envOrDefault("MOCK_PROVIDER_BASE_URL", defaultMockProviderBaseURL)),
		apiKey:              envOrDefault("GATELM_DEMO_API_KEY", defaultDemoAPIKey),
		appToken:            envOrDefault("GATELM_DEMO_APP_TOKEN", defaultDemoAppToken),
		projectID:           envOrDefault("GATELM_DEMO_PROJECT_ID", defaultDemoProjectID),
		runID:               sanitizeRequestIDPart(envOrDefault("GATELM_LOCAL_STACK_RUN_ID", fmt.Sprintf("%d", time.Now().Unix()))),
	}
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func trimTrailingSlash(value string) string {
	return strings.TrimRight(value, "/")
}

func sanitizeRequestIDPart(value string) string {
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '_' || r == '-':
			builder.WriteRune('_')
		}
	}
	if builder.Len() == 0 {
		return "run"
	}
	return builder.String()
}

type httpResponse struct {
	statusCode int
	header     http.Header
	body       []byte
	json       map[string]any
}

func doGet(t *testing.T, client *http.Client, endpoint string, requestID string) httpResponse {
	t.Helper()

	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatalf("build GET %s: %v", endpoint, err)
	}
	if requestID != "" {
		req.Header.Set("X-GateLM-Request-Id", requestID)
	}

	return doHTTP(t, client, req)
}

func doHTTP(t *testing.T, client *http.Client, req *http.Request) httpResponse {
	t.Helper()

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("%s %s failed: %v", req.Method, req.URL.String(), err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}

	decoded := map[string]any{}
	if len(bytes.TrimSpace(body)) > 0 && strings.Contains(resp.Header.Get("Content-Type"), "application/json") {
		if err := json.Unmarshal(body, &decoded); err != nil {
			t.Fatalf("decode json response from %s: %v\nbody=%s", req.URL.String(), err, string(body))
		}
	}

	return httpResponse{
		statusCode: resp.StatusCode,
		header:     resp.Header.Clone(),
		body:       body,
		json:       decoded,
	}
}

func requireHTTPStatus(t *testing.T, resp httpResponse, want int) {
	t.Helper()
	if resp.statusCode != want {
		t.Fatalf("expected HTTP %d, got %d: %s", want, resp.statusCode, string(resp.body))
	}
}

type chatResult struct {
	http      httpResponse
	gateLM    gateLMMetadata
	errorBody gatewayErrorResponse
}

type chatCompletionResponse struct {
	GateLM gateLMMetadata `json:"gate_lm"`
}

type gateLMMetadata struct {
	RequestID         string `json:"requestId"`
	CacheStatus       string `json:"cacheStatus"`
	CacheType         string `json:"cacheType"`
	CacheHitRequestID string `json:"cacheHitRequestId"`
	MaskingAction     string `json:"maskingAction"`
	SelectedProvider  string `json:"selectedProvider"`
	SelectedModel     string `json:"selectedModel"`
	RoutingReason     string `json:"routingReason"`
}

type gatewayErrorResponse struct {
	Error struct {
		Code      string `json:"code"`
		RequestID string `json:"request_id"`
	} `json:"error"`
}

func postChat(t *testing.T, client *http.Client, cfg localStackSmokeConfig, requestID string, prompt string) chatResult {
	t.Helper()

	body, err := json.Marshal(map[string]any{
		"model": "auto",
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.2,
		"max_tokens":  128,
		"stream":      false,
	})
	if err != nil {
		t.Fatalf("marshal chat request: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, cfg.gatewayBaseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build chat request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
	req.Header.Set("X-GateLM-App-Token", cfg.appToken)
	req.Header.Set("X-GateLM-End-User-Id", "user_local_stack_smoke")
	req.Header.Set("X-GateLM-Feature-Id", "local-stack-smoke")
	req.Header.Set("X-GateLM-Request-Id", requestID)

	resp := doHTTP(t, client, req)
	result := chatResult{http: resp}
	if resp.statusCode >= 200 && resp.statusCode < 300 {
		var decoded chatCompletionResponse
		if err := json.Unmarshal(resp.body, &decoded); err != nil {
			t.Fatalf("decode chat success response: %v\nbody=%s", err, string(resp.body))
		}
		result.gateLM = decoded.GateLM
		return result
	}

	if err := json.Unmarshal(resp.body, &result.errorBody); err != nil {
		t.Fatalf("decode chat error response: %v\nbody=%s", err, string(resp.body))
	}
	return result
}

func localStackChatInput(t *testing.T, requestID string, sanitizedPrompt string) string {
	t.Helper()
	return prettyJSON(t, map[string]any{
		"http": "POST /v1/chat/completions",
		"headers": map[string]string{
			"Authorization":       "Bearer <redacted>",
			"X-GateLM-App-Token":  "<redacted>",
			"X-GateLM-Request-Id": requestID,
		},
		"body": map[string]any{
			"model":       "auto",
			"messages":    []map[string]string{{"role": "user", "content": sanitizedPrompt}},
			"temperature": 0.2,
			"max_tokens":  128,
			"stream":      false,
		},
	})
}

type mockStatsResponse struct {
	Data struct {
		TotalCalls   int                `json:"totalCalls"`
		CallsByModel map[string]int     `json:"callsByModel"`
		LastCalls    []mockProviderCall `json:"lastCalls"`
	} `json:"data"`
}

type mockProviderCall struct {
	RequestID             string `json:"requestId"`
	Model                 string `json:"model"`
	PromptHash            string `json:"promptHash"`
	RedactedPromptPreview string `json:"redactedPromptPreview"`
	CreatedAt             string `json:"createdAt"`
}

func getMockStats(t *testing.T, client *http.Client, cfg localStackSmokeConfig) mockStatsResponse {
	t.Helper()

	resp := doGet(t, client, cfg.mockProviderBaseURL+"/__mock/stats", "")
	requireHTTPStatus(t, resp, http.StatusOK)

	var stats mockStatsResponse
	if err := json.Unmarshal(resp.body, &stats); err != nil {
		t.Fatalf("decode mock stats: %v\nbody=%s", err, string(resp.body))
	}
	return stats
}

func mockProviderTotalCalls(t *testing.T, client *http.Client, cfg localStackSmokeConfig) int {
	t.Helper()
	return getMockStats(t, client, cfg).Data.TotalCalls
}

func requireMockCall(t *testing.T, client *http.Client, cfg localStackSmokeConfig, requestID string) mockProviderCall {
	t.Helper()

	stats := getMockStats(t, client, cfg)
	for _, call := range stats.Data.LastCalls {
		if call.RequestID == requestID {
			return call
		}
	}
	t.Fatalf("mock provider call %q not found in stats: %#v", requestID, stats.Data.LastCalls)
	return mockProviderCall{}
}

type projectLogsResponse struct {
	Data []requestLogItem `json:"data"`
}

type requestLogItem struct {
	RequestID     string `json:"requestId"`
	Status        string `json:"status"`
	HTTPStatus    int    `json:"httpStatus"`
	CacheStatus   string `json:"cacheStatus"`
	CacheType     string `json:"cacheType"`
	RoutingReason string `json:"routingReason"`
	MaskingAction string `json:"maskingAction"`
	SelectedModel string `json:"selectedModel"`
}

func getProjectLogs(t *testing.T, client *http.Client, cfg localStackSmokeConfig, from time.Time, to time.Time) projectLogsResponse {
	t.Helper()

	query := url.Values{}
	query.Set("from", from.Format(time.RFC3339))
	query.Set("to", to.Format(time.RFC3339))
	query.Set("limit", "50")

	endpoint := fmt.Sprintf("%s/api/projects/%s/logs?%s", cfg.gatewayBaseURL, url.PathEscape(cfg.projectID), query.Encode())
	resp := doGet(t, client, endpoint, "request_local_stack_"+cfg.runID+"_logs_006")
	requireHTTPStatus(t, resp, http.StatusOK)

	var logs projectLogsResponse
	if err := json.Unmarshal(resp.body, &logs); err != nil {
		t.Fatalf("decode project logs: %v\nbody=%s", err, string(resp.body))
	}
	return logs
}

type requestDetailResponse struct {
	Data struct {
		RequestID  string `json:"requestId"`
		Status     string `json:"status"`
		HTTPStatus int    `json:"httpStatus"`
		Latency    struct {
			ProviderLatencyMs *int64 `json:"providerLatencyMs"`
		} `json:"latency"`
		Cache struct {
			CacheStatus       string  `json:"cacheStatus"`
			CacheType         string  `json:"cacheType"`
			CacheHitRequestID *string `json:"cacheHitRequestId"`
		} `json:"cache"`
		Masking struct {
			MaskingAction string `json:"maskingAction"`
		} `json:"masking"`
		Routing struct {
			SelectedProvider *string `json:"selectedProvider"`
			SelectedModel    *string `json:"selectedModel"`
			RoutingReason    *string `json:"routingReason"`
		} `json:"routing"`
	} `json:"data"`
}

func getRequestDetail(t *testing.T, client *http.Client, cfg localStackSmokeConfig, requestID string) requestDetailResponse {
	t.Helper()

	resp := doGet(t, client, cfg.gatewayBaseURL+"/api/llm-requests/"+url.PathEscape(requestID), "request_local_stack_"+cfg.runID+"_detail_007")
	requireHTTPStatus(t, resp, http.StatusOK)

	var detail requestDetailResponse
	if err := json.Unmarshal(resp.body, &detail); err != nil {
		t.Fatalf("decode request detail: %v\nbody=%s", err, string(resp.body))
	}
	return detail
}

type dashboardOverviewResponse struct {
	Data struct {
		Totals struct {
			TotalRequests       int64            `json:"totalRequests"`
			SuccessfulRequests  int64            `json:"successfulRequests"`
			FailedRequests      int64            `json:"failedRequests"`
			BlockedRequests     int64            `json:"blockedRequests"`
			RateLimitedRequests int64            `json:"rateLimitedRequests"`
			CacheHitRequests    int64            `json:"cacheHitRequests"`
			StatusCounts        map[string]int64 `json:"statusCounts"`
		} `json:"totals"`
	} `json:"data"`
}

func getDashboardOverview(t *testing.T, client *http.Client, cfg localStackSmokeConfig, from time.Time, to time.Time) dashboardOverviewResponse {
	t.Helper()

	query := url.Values{}
	query.Set("projectId", cfg.projectID)
	query.Set("from", from.Format(time.RFC3339))
	query.Set("to", to.Format(time.RFC3339))

	resp := doGet(t, client, cfg.gatewayBaseURL+"/api/dashboard/overview?"+query.Encode(), "request_local_stack_"+cfg.runID+"_dashboard_008")
	requireHTTPStatus(t, resp, http.StatusOK)

	var dashboard dashboardOverviewResponse
	if err := json.Unmarshal(resp.body, &dashboard); err != nil {
		t.Fatalf("decode dashboard overview: %v\nbody=%s", err, string(resp.body))
	}
	return dashboard
}

func requireLogStatuses(t *testing.T, logs []requestLogItem, expected map[string]int) {
	t.Helper()

	if len(logs) != 5 {
		t.Fatalf("expected 5 local smoke request logs, got %d: %#v", len(logs), logs)
	}
	for status, want := range expected {
		if got := countLogsByStatus(logs, status); got != want {
			t.Fatalf("expected status %s count %d, got %d: %#v", status, want, got, logs)
		}
	}
}

func requireLogItem(t *testing.T, logs []requestLogItem, requestID string, wantStatus string, wantCacheStatus string) {
	t.Helper()

	for _, item := range logs {
		if item.RequestID != requestID {
			continue
		}
		if item.Status != wantStatus || item.CacheStatus != wantCacheStatus {
			t.Fatalf("unexpected log item for %s: want status/cache=%s/%s got %#v", requestID, wantStatus, wantCacheStatus, item)
		}
		return
	}
	t.Fatalf("request log %q not found: %#v", requestID, logs)
}

func countLogsByStatus(logs []requestLogItem, status string) int {
	count := 0
	for _, item := range logs {
		if item.Status == status {
			count++
		}
	}
	return count
}

func compactLogItems(logs []requestLogItem) []map[string]any {
	items := make([]map[string]any, 0, len(logs))
	for _, item := range logs {
		items = append(items, map[string]any{
			"requestId":     item.RequestID,
			"status":        item.Status,
			"httpStatus":    item.HTTPStatus,
			"cacheStatus":   item.CacheStatus,
			"maskingAction": item.MaskingAction,
			"routingReason": item.RoutingReason,
			"selectedModel": item.SelectedModel,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return fmt.Sprint(items[i]["requestId"]) < fmt.Sprint(items[j]["requestId"])
	})
	return items
}

func requireNoForbiddenMetricLabels(t *testing.T, metricsText string) {
	t.Helper()

	forbiddenLabels := []string{
		"request_id=",
		"trace_id=",
		"tenant_id=",
		"project_id=",
		"application_id=",
		"api_key_id=",
		"app_token_id=",
		"end_user_id=",
		"feature_id=",
		"prompt=",
		"prompt_hash=",
		"request_body_hash=",
		"cache_key_hash=",
		"provider_key=",
		"authorization=",
		"raw_error_detail=",
	}
	for _, label := range forbiddenLabels {
		requireNotContains(t, strings.ToLower(metricsText), label)
	}
}

func summarizeJSON(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	summary := make(map[string]any)
	for key, entry := range value {
		switch key {
		case "time":
			continue
		default:
			summary[key] = entry
		}
	}
	return summary
}

func valueOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func prettyJSON(t *testing.T, value any) string {
	t.Helper()

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		t.Fatalf("marshal json evidence: %v", err)
	}
	return strings.TrimSpace(buffer.String())
}

func requireEqual[T comparable](t *testing.T, got T, want T, label string) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: want %v, got %v", label, want, got)
	}
}

func requireContains(t *testing.T, haystack string, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Fatalf("expected value to contain %q\nvalue=%s", needle, haystack)
	}
}

func requireNotContains(t *testing.T, haystack string, needle string) {
	t.Helper()
	if needle == "" {
		return
	}
	if strings.Contains(haystack, needle) {
		t.Fatalf("expected value not to contain %q\nvalue=%s", needle, haystack)
	}
}
