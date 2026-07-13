package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/pipeline"
	ratelimitstage "gatelm/apps/gateway-core/internal/pipeline/stages/ratelimit"
)

func TestChatCompletionsHandlerRateLimitAllowsThenBlocksBeforeProviderCost(t *testing.T) {
	// Given 유효한 API Key와 App Token이 있고 첫 요청은 Rate Limit 허용 상태다
	chatCalls := 0
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:rate-limit-demo-cache-key"}
	cacheStore := &recordingExactCacheStore{}
	logWriter := &recordingTerminalLogWriter{}
	limiter := &sequenceRateLimiter{
		decisions: []ratelimit.Decision{
			{
				Allowed:       true,
				Limit:         1,
				Remaining:     0,
				WindowSeconds: 60,
				Reason:        ratelimit.ReasonWithinLimit,
			},
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
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		RateLimitPipeline:    newTestRateLimitPipeline(limiter),
		ExactCacheKeyBuilder: keyBuilder,
		ExactCacheStore:      cacheStore,
		TerminalLogWriter:    logWriter,
	}
	withTestAuth(&handler)

	firstReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(firstReq)
	firstRR := httptest.NewRecorder()

	// When 고객 앱이 첫 번째 안전한 요청을 보낸다
	handler.ServeHTTP(firstRR, firstReq)

	// Then Gateway는 Provider까지 통과시키고 200 OK를 반환한다
	if firstRR.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d: %s", firstRR.Code, firstRR.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected one provider call after allowed request, got %d", chatCalls)
	}
	if keyBuilder.calls != 1 || cacheStore.getCalls != 1 {
		t.Fatalf("expected one cache lookup after allowed request, got key=%d get=%d", keyBuilder.calls, cacheStore.getCalls)
	}

	// Given 같은 Application이 Rate Limit을 초과한 상태다
	secondReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(secondReq)
	secondRR := httptest.NewRecorder()

	// When 고객 앱이 다시 요청을 보낸다
	handler.ServeHTTP(secondRR, secondReq)

	// Then Gateway는 429 rate_limited를 반환하고 Provider 비용 전에 차단한다
	if secondRR.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request 429, got %d: %s", secondRR.Code, secondRR.Body.String())
	}
	assertGatewayErrorCode(t, secondRR, "rate_limited")
	if chatCalls != 1 {
		t.Fatalf("rate limited request must not call provider again, got %d provider calls", chatCalls)
	}
	if keyBuilder.calls != 1 || cacheStore.getCalls != 1 {
		t.Fatalf("rate limited request must not run cache lookup, got key=%d get=%d", keyBuilder.calls, cacheStore.getCalls)
	}
	if len(logWriter.logs) != 2 {
		t.Fatalf("expected two terminal logs, got %d", len(logWriter.logs))
	}
	rateLimitedLog := logWriter.logs[1]
	if rateLimitedLog.Status != invocationlog.StatusRateLimited || rateLimitedLog.HTTPStatus != http.StatusTooManyRequests {
		t.Fatalf("unexpected rate limited log status: %#v", rateLimitedLog)
	}
	if rateLimitedLog.ErrorCode != "rate_limited" || rateLimitedLog.ErrorStage != ratelimitstage.StageName {
		t.Fatalf("unexpected rate limited log error fields: %#v", rateLimitedLog)
	}
	if rateLimitedLog.ProviderLatencyMs != nil || rateLimitedLog.CostMicroUSD != 0 {
		t.Fatalf("rate limited log must not include provider cost/latency, got %#v", rateLimitedLog)
	}
	if rateLimitedLog.RateLimitDecision == nil || rateLimitedLog.RateLimitDecision.Reason != ratelimit.ReasonLimitExceeded {
		t.Fatalf("expected limit_exceeded decision in log, got %#v", rateLimitedLog.RateLimitDecision)
	}
}

func TestChatCompletionsHandlerDoesNotExposeRawPromptToRateLimitPipeline(t *testing.T) {
	// Given masking 전 raw prompt가 포함된 요청이 있다
	chatCalls := 0
	rateLimitPipeline := &recordingRateLimitPipeline{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		RateLimitPipeline: rateLimitPipeline,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Contact user@example.com before shipping.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	// When Gateway가 rate limit을 먼저 확인한다
	handler.ServeHTTP(rr, req)

	// Then RateLimitPipeline에는 prompt text가 전달되지 않는다
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rateLimitPipeline.calls != 1 {
		t.Fatalf("expected rate limit pipeline to run once, got %d", rateLimitPipeline.calls)
	}
	if rateLimitPipeline.promptText != "" {
		t.Fatalf("rate limit pipeline must not receive raw prompt, got %q", rateLimitPipeline.promptText)
	}
	if chatCalls != 1 {
		t.Fatalf("expected provider call after allowed rate limit, got %d", chatCalls)
	}
}

func TestChatCompletionsRateLimitStageDemo(t *testing.T) {
	chatCalls := 0
	limiter := &sequenceRateLimiter{
		decisions: []ratelimit.Decision{
			{
				Allowed:       true,
				Limit:         1,
				Remaining:     0,
				WindowSeconds: 60,
				Reason:        ratelimit.ReasonWithinLimit,
			},
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
		RateLimitPipeline: newTestRateLimitPipeline(limiter),
	}
	withTestAuth(&handler)

	firstRR := exerciseRateLimitDemoRequest(t, &handler)
	providerCallsAfterFirst := chatCalls
	secondRR := exerciseRateLimitDemoRequest(t, &handler)

	var firstResp provider.ChatCompletionResponse
	if err := json.NewDecoder(firstRR.Body).Decode(&firstResp); err != nil {
		t.Fatalf("decode first response: %v", err)
	}
	var secondResp gatewayErrorResponse
	if err := json.NewDecoder(secondRR.Body).Decode(&secondResp); err != nil {
		t.Fatalf("decode second response: %v", err)
	}

	t.Logf("\n[Input #1]\nPOST /v1/chat/completions\nAuthorization: Bearer <redacted>\nX-GateLM-App-Token: <redacted>\n%s", compactJSON(t, chatCompletionBody("Write a short refund response.")))
	t.Logf("\n[Output #1]\nHTTP %d\nX-GateLM-Request-Id: %s\nX-GateLM-Cache-Status: %s\nbody.gate_lm.cacheStatus: %s\nbody.gate_lm.executionMode: %s\nProvider 호출 횟수: %d",
		firstRR.Code,
		firstRR.Header().Get("X-GateLM-Request-Id"),
		firstRR.Header().Get("X-GateLM-Cache-Status"),
		firstResp.GateLM.CacheStatus,
		firstResp.GateLM.ExecutionMode,
		providerCallsAfterFirst,
	)
	t.Logf("\n[Input #2]\nPOST /v1/chat/completions\nAuthorization: Bearer <redacted>\nX-GateLM-App-Token: <redacted>\n%s", compactJSON(t, chatCompletionBody("Write a short refund response.")))
	t.Logf("\n[Output #2]\nHTTP %d\nerror.code: %s\nX-GateLM-Cache-Status: %s\nProvider 호출 횟수: %d\n비용 발생 전 차단: %t",
		secondRR.Code,
		secondResp.Error.Code,
		secondRR.Header().Get("X-GateLM-Cache-Status"),
		chatCalls,
		chatCalls == 1,
	)

	if firstRR.Code != http.StatusOK || secondRR.Code != http.StatusTooManyRequests || chatCalls != 1 {
		t.Fatalf("demo scenario failed: first=%d second=%d providerCalls=%d", firstRR.Code, secondRR.Code, chatCalls)
	}
}

func newTestRateLimitPipeline(limiter ratelimit.Limiter) GatewayPipeline {
	return pipeline.New(ratelimitstage.NewStage(limiter, ratelimit.Config{
		Enabled:       true,
		Scope:         ratelimit.ScopeApplication,
		Algorithm:     ratelimit.AlgorithmFixedWindow,
		WindowSeconds: 60,
		Limit:         1,
	}))
}

func exerciseRateLimitDemoRequest(t *testing.T, handler *ChatCompletionsHandler) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

func compactJSON(t *testing.T, raw string) string {
	t.Helper()

	var payload any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode json: %v", err)
	}
	return string(encoded)
}

type sequenceRateLimiter struct {
	decisions []ratelimit.Decision
	calls     int
	requests  []ratelimit.Request
}

type recordingRateLimitPipeline struct {
	calls      int
	promptText string
}

func (p *recordingRateLimitPipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	p.calls++
	if gatewayCtx != nil {
		p.promptText = gatewayCtx.Request.PromptText
	}
	return nil
}

func (l *sequenceRateLimiter) Check(_ context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	l.requests = append(l.requests, req)
	if len(l.decisions) == 0 {
		return ratelimit.Decision{
			Allowed:       true,
			Scope:         ratelimit.ScopeApplication,
			ScopeID:       req.ApplicationID,
			WindowSeconds: 60,
			Reason:        ratelimit.ReasonRateLimitDisabled,
		}, nil
	}
	index := l.calls
	if index >= len(l.decisions) {
		index = len(l.decisions) - 1
	}
	l.calls++
	return l.decisions[index], nil
}
