package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	controlplaneprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/controlplane"
	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	controlplaneruntimeconfig "gatelm/apps/gateway-core/internal/adapters/runtimeconfig/controlplane"
	"gatelm/apps/gateway-core/internal/domain/auth"
	"gatelm/apps/gateway-core/internal/domain/budget"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/costing"
	"gatelm/apps/gateway-core/internal/domain/credentials"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/request"
	routingdomain "gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/pipeline/stages/authenticate"
	budgetstage "gatelm/apps/gateway-core/internal/pipeline/stages/budget"
	runtimeconfigstage "gatelm/apps/gateway-core/internal/pipeline/stages/runtimeconfig"
	"gatelm/apps/gateway-core/internal/ports"
)

const (
	testAPIKey     = "glm_api_test_redacted"
	testAppToken   = "glm_app_token_test_redacted"
	testTenantID   = "tenant_demo"
	testProjectID  = "project_demo"
	testAppID      = "app_demo"
	testAPIKeyID   = "api_key_demo"
	testAppTokenID = "app_token_demo"
)

func TestChatCompletionsHandlerCallsMockProvider(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get(middleware.RequestIDHeader) == "" {
			t.Fatalf("missing request id header sent to mock provider")
		}
		chatCalls++

		var req provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}

		writeJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_test",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   req.Model,
			Choices: []provider.ChatChoice{
				{
					Index: 0,
					Message: provider.ChatMessage{
						Role:    "assistant",
						Content: json.RawMessage(`"Mock response"`),
					},
					FinishReason: "stop",
				},
			},
			Usage: &provider.Usage{
				PromptTokens:     4,
				CompletionTokens: 3,
				TotalTokens:      7,
			},
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	handler := ChatCompletionsHandler{
		Providers: registry,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected one mock provider call, got %d", chatCalls)
	}
	if rr.Header().Get(middleware.RequestIDHeader) == "" {
		t.Fatalf("missing response request id header")
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("resolved target must not be exposed in response headers: %#v", rr.Header())
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil {
		t.Fatalf("missing gate_lm metadata")
	}
	if resp.GateLM.ExecutionMode != "mock" {
		t.Fatalf("unexpected execution mode metadata: %s", resp.GateLM.ExecutionMode)
	}
	if resp.GateLM.TerminalStatus != invocationlog.StatusSuccess {
		t.Fatalf("unexpected terminal status metadata: %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerWritesTerminalLogForSuccess(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	resp := decodeChatCompletionResponse(t, rr)
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	assertTerminalLogMatchesSuccessResponse(t, logged, rr, resp)
	if logged.Status != invocationlog.StatusSuccess || logged.HTTPStatus != http.StatusOK {
		t.Fatalf("unexpected terminal status: %+v", logged)
	}
	if logged.CacheStatus != invocationlog.CacheStatusMiss || logged.CacheType != invocationlog.CacheTypeExact {
		t.Fatalf("unexpected cache fields: %+v", logged)
	}
	if logged.Provider != "mock" || logged.Model != "mock-balanced" {
		t.Fatalf("unexpected route fields: %+v", logged)
	}
	if logged.PromptTokens != 4 || logged.CompletionTokens != 3 || logged.TotalTokens != 7 {
		t.Fatalf("unexpected usage fields: %+v", logged)
	}
	if logged.SavedCostMicroUSD != 0 {
		t.Fatalf("success log saved cost must default to zero, got %d", logged.SavedCostMicroUSD)
	}
	if logged.ProviderLatencyMs == nil {
		t.Fatalf("success log must include provider latency: %+v", logged)
	}
	if logged.DomainOutcomes.Provider.Outcome != "success" || logged.DomainOutcomes.Cache.Outcome != "miss" {
		t.Fatalf("unexpected success domain outcomes: %+v", logged.DomainOutcomes)
	}
	if logged.RequestBodyHash == "" || logged.PromptHash == "" {
		t.Fatalf("expected request and prompt hashes: %+v", logged)
	}
}

func TestChatCompletionsHandlerCalculatesCostFromProviderUsage(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	calculator := &recordingCostCalculator{result: costing.Result{
		CostMicroUSD:              2,
		Currency:                  costing.CurrencyUSD,
		PricingRuleID:             "price_mock_balanced_v1",
		PricingVersion:            "pricing_test_v1",
		PricingProvider:           "mock",
		PricingModel:              "mock-balanced",
		InputMicroUSDPer1MTokens:  100_000,
		OutputMicroUSDPer1MTokens: 400_000,
		TokenCountSource:          costing.TokenCountSourceProviderUsage,
		CostSource:                costing.CostSourcePricingCatalog,
		PromptTokens:              4,
		CompletionTokens:          3,
		TotalTokens:               7,
	}}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		TerminalLogWriter: logWriter,
		CostCalculator:    calculator,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	resp := decodeChatCompletionResponse(t, rr)
	if calculator.calls != 1 {
		t.Fatalf("expected one cost calculation, got %d", calculator.calls)
	}
	if calculator.ctxErr != nil {
		t.Fatalf("cost calculator context must ignore request cancellation, got %v", calculator.ctxErr)
	}
	if !calculator.hasDeadline {
		t.Fatalf("cost calculator context must have a deadline")
	}
	if calculator.lastRequest.PromptTokens != 4 || calculator.lastRequest.CompletionTokens != 3 || calculator.lastRequest.TotalTokens != 7 {
		t.Fatalf("unexpected cost calculator usage request: %+v", calculator.lastRequest)
	}
	if !containsString(calculator.lastRequest.ProviderKeys, "mock") || !containsString(calculator.lastRequest.ModelKeys, "mock-balanced") {
		t.Fatalf("unexpected pricing lookup keys: %+v", calculator.lastRequest)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.CostMicroUSD != 2 || rr.Header().Get("X-GateLM-Estimated-Cost-Usd") != "0.000002" || resp.GateLM.EstimatedCostUSD != "0.000002" {
		t.Fatalf("unexpected calculated cost: log=%d header=%q gate_lm=%q", logged.CostMicroUSD, rr.Header().Get("X-GateLM-Estimated-Cost-Usd"), resp.GateLM.EstimatedCostUSD)
	}
	metadata, ok := logged.Metadata["costing"].(map[string]any)
	if !ok {
		t.Fatalf("missing costing metadata: %+v", logged.Metadata)
	}
	if metadata["pricingRuleId"] != "price_mock_balanced_v1" || metadata["costSource"] != costing.CostSourcePricingCatalog {
		t.Fatalf("unexpected costing metadata: %+v", metadata)
	}
	if metadata["amountType"] != costing.AmountTypeEstimatedProviderUsageCost || metadata["credentialOwner"] != costing.CredentialOwnerTenant || metadata["billableByGateLM"] != false {
		t.Fatalf("costing metadata must describe tenant-owned provider usage, not GateLM billing: %+v", metadata)
	}
}

func TestPricingKeysIncludeCanonicalAndCompatibilityAliases(t *testing.T) {
	reqCtx := &pipeline.RequestContext{
		Provider:           "openai",
		ProviderID:         "79e07d4e-3d26-47fc-b001-ae0e6402ed82",
		ProviderCatalogKey: "openai",
		Model:              "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-4o",
		ModelID:            "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-4o",
	}
	target := providerCallTarget{
		ProviderID:   "79e07d4e-3d26-47fc-b001-ae0e6402ed82",
		ProviderName: "openai",
		AdapterType:  "openai_compatible",
		ModelID:      "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-4o",
		ModelName:    "gpt-4o",
		ExecutionConfig: provider.ExecutionConfig{
			ProviderID:   "79e07d4e-3d26-47fc-b001-ae0e6402ed82",
			ProviderName: "openai",
			AdapterType:  "openai_compatible",
		},
	}

	providerKeys := providerPricingKeys(reqCtx, target)
	modelKeys := modelPricingKeys(reqCtx, target)

	if !containsString(providerKeys, "openai") || !containsString(providerKeys, "openai-main") {
		t.Fatalf("expected canonical and legacy provider pricing keys, got %+v", providerKeys)
	}
	if containsString(providerKeys, "79e07d4e-3d26-47fc-b001-ae0e6402ed82-main") || containsString(providerKeys, "openai_compatible-main") {
		t.Fatalf("provider aliases must not be generated for ids or adapter types: %+v", providerKeys)
	}
	if aliases := providerPricingAliases("groq-2"); len(aliases) != 1 || aliases[0] != "groq" {
		t.Fatalf("numbered provider connections must fall back to family pricing, got %+v", aliases)
	}
	if aliases := providerPricingAliases("groq-secondary"); len(aliases) != 1 || aliases[0] != "groq-secondary-main" {
		t.Fatalf("custom provider names must retain the existing main alias rule, got %+v", aliases)
	}
	if !containsString(modelKeys, "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-4o") || !containsString(modelKeys, "gpt-4o") {
		t.Fatalf("expected execution model id and billing model alias, got %+v", modelKeys)
	}
}

func TestPricingKeysIncludeOpenAITextModelVersionAliases(t *testing.T) {
	reqCtx := &pipeline.RequestContext{
		Model:          "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-5.1-2025-11-13",
		ModelID:        "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-5.1-2025-11-13",
		RequestedModel: "auto",
	}
	target := providerCallTarget{
		ModelID:   "79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-5.1-2025-11-13",
		ModelName: "gpt-5.1-2025-11-13",
	}

	modelKeys := modelPricingKeys(reqCtx, target)

	for _, expected := range []string{
		"79e07d4e-3d26-47fc-b001-ae0e6402ed82:gpt-5.1-2025-11-13",
		"gpt-5.1-2025-11-13",
		"gpt-5.1",
	} {
		if !containsString(modelKeys, expected) {
			t.Fatalf("expected model pricing key %q in %+v", expected, modelKeys)
		}
	}
}

func TestChatCompletionsHandlerStoresPromptCaptureButSkipsResponseCaptureWithoutRawGate(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	runtimePolicy := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Runtime.PromptCapture = runtimeconfig.PromptCapturePolicy{
				Enabled:  true,
				Mode:     runtimeconfig.PromptCaptureModeLogSafeFull,
				MaxChars: 8000,
			}
			gatewayCtx.Runtime.HasPromptCapture = true
			gatewayCtx.Runtime.ResponseCapture = runtimeconfig.ResponseCapturePolicy{
				Enabled:  true,
				Mode:     runtimeconfig.ResponseCaptureModeRawFull,
				MaxChars: 8000,
			}
			gatewayCtx.Runtime.HasResponseCapture = true
		},
	}
	handler := ChatCompletionsHandler{
		Providers:             provider.NewRegistry("mock", recordingProviderAdapter{}),
		RuntimePolicyPipeline: runtimePolicy,
		TerminalLogWriter:     logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Send a reply to user@example.invalid.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	capture, ok := logWriter.logs[0].Metadata["promptCapture"].(invocationlog.PromptCaptureFields)
	if !ok {
		t.Fatalf("expected prompt capture metadata, got %+v", logWriter.logs[0].Metadata["promptCapture"])
	}
	if !capture.Enabled ||
		capture.Mode != runtimeconfig.PromptCaptureModeLogSafeFull ||
		capture.CapturedPrompt != "Send a reply to [EMAIL_1]." ||
		strings.Contains(capture.CapturedPrompt, "user@example.invalid") {
		t.Fatalf("unexpected prompt capture metadata: %+v", capture)
	}
	if _, exists := logWriter.logs[0].Metadata["responseCapture"]; exists {
		t.Fatalf("response capture must require global raw capture gate: %+v", logWriter.logs[0].Metadata["responseCapture"])
	}
}

func TestChatCompletionsHandlerStoresResponseCaptureOnlyWhenRawGateAndRuntimePolicyAllowIt(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	runtimePolicy := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Runtime.ResponseCapture = runtimeconfig.ResponseCapturePolicy{
				Enabled:  true,
				Mode:     runtimeconfig.ResponseCaptureModeRawFull,
				MaxChars: 8000,
			}
			gatewayCtx.Runtime.HasResponseCapture = true
		},
	}
	handler := ChatCompletionsHandler{
		Providers:                 provider.NewRegistry("mock", recordingProviderAdapter{}),
		RuntimePolicyPipeline:     runtimePolicy,
		RawResponseCaptureEnabled: true,
		TerminalLogWriter:         logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Send a reply.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	responseCapture, ok := logWriter.logs[0].Metadata["responseCapture"].(invocationlog.ResponseCaptureFields)
	if !ok {
		t.Fatalf("expected response capture metadata, got %+v", logWriter.logs[0].Metadata["responseCapture"])
	}
	if !responseCapture.Enabled ||
		responseCapture.Mode != runtimeconfig.ResponseCaptureModeRawFull ||
		responseCapture.CapturedResponse != "Mock response" {
		t.Fatalf("unexpected response capture metadata: %+v", responseCapture)
	}
}

func TestChatCompletionsHandlerWritesDay4CIdentityAndRoutingMetadata(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	setValidGatewayAuthHeaders(req)
	req.Header.Set("X-GateLM-End-User-Id", "user_demo_001")
	req.Header.Set("X-GateLM-Feature-Id", "support-reply")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}

	logged := logWriter.logs[0]
	if logged.TenantID != testTenantID || logged.ProjectID != testProjectID || logged.ApplicationID != testAppID {
		t.Fatalf("unexpected tenant/project/application metadata: %+v", logged)
	}
	if logged.APIKeyID != testAPIKeyID || logged.AppTokenID != "" {
		t.Fatalf("unexpected key/token metadata: %+v", logged)
	}
	if logged.EndUserID != "user_demo_001" || logged.FeatureID != "support-reply" {
		t.Fatalf("unexpected end user/feature metadata: %+v", logged)
	}
	if logged.RequestedModel != "auto" {
		t.Fatalf("expected requested model auto, got %q", logged.RequestedModel)
	}
	if logged.Provider != "mock" || logged.Model != "mock-balanced" ||
		logged.RoutingReason != routingdomain.ReasonMatrixRoute ||
		logged.PromptCategory != routingdomain.CategoryGeneral ||
		logged.PromptDifficulty != routingdomain.DifficultySimple {
		t.Fatalf("unexpected routing metadata: %+v", logged)
	}
}

func TestChatCompletionsHandlerUsesMetadataEndUserIDForTerminalLog(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"metadata": {"endUserId": " 윤지\nKim "},
		"stream": false
	}`))
	setValidGatewayAuthHeaders(req)
	req.Header.Set("X-GateLM-End-User-Id", "customer_user_demo_live")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	if logWriter.logs[0].EndUserID != "윤지 Kim" {
		t.Fatalf("unexpected end user id: %+v", logWriter.logs[0])
	}
}

func TestChatCompletionsHandlerTerminalLogIgnoresRequestCancellation(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short refund response."))).WithContext(ctx)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	cancel()

	handler.ServeHTTP(rr, req)

	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log despite cancelled request context, got %d", len(logWriter.logs))
	}
	if logWriter.ctxErr != nil {
		t.Fatalf("terminal log context must ignore request cancellation, got %v", logWriter.ctxErr)
	}
	if logWriter.ctxDoneClosed {
		t.Fatalf("terminal log context must not expose an already-closed Done channel")
	}
}

func TestChatCompletionsHandlerRelaysProviderStreamAfterProviderSuccess(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	runtimePolicy := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Runtime.ResponseCapture = runtimeconfig.ResponseCapturePolicy{
				Enabled:  true,
				Mode:     runtimeconfig.ResponseCaptureModeRawFull,
				MaxChars: 8000,
			}
			gatewayCtx.Runtime.HasResponseCapture = true
		},
	}
	streamingAdapter := &streamingProviderAdapter{
		events: []provider.ChatCompletionStreamEvent{
			streamEvent(t, `{"id":"chatcmpl_stream_test","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}`),
			streamEvent(t, `{"id":"chatcmpl_stream_test","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"안녕하세요. "},"finish_reason":null}]}`),
			streamEvent(t, `{"id":"chatcmpl_stream_test","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"실제 provider streaming입니다."},"finish_reason":null}]}`),
			streamEvent(t, `{"id":"chatcmpl_stream_test","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}`),
		},
	}
	handler := ChatCompletionsHandler{
		Providers:                 provider.NewRegistry("mock", streamingAdapter),
		RuntimePolicyPipeline:     runtimePolicy,
		RawResponseCaptureEnabled: true,
		TerminalLogWriter:         logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("Write a short refund response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Content-Type"); !strings.Contains(got, "text/event-stream") {
		t.Fatalf("expected event-stream content type, got %q", got)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "data:") || !strings.Contains(body, "실제 provider streaming") || !strings.Contains(body, "data: [DONE]") {
		t.Fatalf("expected SSE chunks and done marker, got %q", body)
	}
	if strings.Count(body, "data:") < 3 {
		t.Fatalf("expected multiple SSE chunks, got %q", body)
	}
	if streamingAdapter.chatCalls != 0 {
		t.Fatalf("streaming request must not use non-stream provider call, got %d", streamingAdapter.chatCalls)
	}
	if streamingAdapter.streamCalls != 1 {
		t.Fatalf("expected one provider stream request, got %d", streamingAdapter.streamCalls)
	}
	if len(streamingAdapter.streamRequests) != 1 || !streamingAdapter.streamRequests[0].Stream {
		t.Fatalf("expected upstream stream=true request, got %+v", streamingAdapter.streamRequests)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if !logged.Stream || logged.Status != invocationlog.StatusSuccess || logged.HTTPStatus != http.StatusOK {
		t.Fatalf("unexpected streaming terminal log: %+v", logged)
	}
	if logged.TotalTokens != 9 {
		t.Fatalf("expected usage from final stream chunk, got %+v", logged)
	}
	if logged.DomainOutcomes.Streaming.Outcome != "completed" ||
		!logged.DomainOutcomes.Streaming.StreamingRequested ||
		logged.DomainOutcomes.Provider.Outcome != "success" {
		t.Fatalf("unexpected streaming domain outcomes: %+v", logged.DomainOutcomes)
	}
	loggedJSON, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("marshal terminal log: %v", err)
	}
	if strings.Contains(string(loggedJSON), "안녕하세요") || strings.Contains(string(loggedJSON), "실제 provider streaming") {
		t.Fatalf("terminal log must not store streamed response chunks: %s", string(loggedJSON))
	}
	if _, exists := logged.Metadata["responseCapture"]; exists {
		t.Fatalf("streaming terminal log must not store response capture: %+v", logged.Metadata["responseCapture"])
	}
}

func TestChatCompletionsHandlerRelaysLocalMockProviderStream(t *testing.T) {
	upstreamStreamCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected mock provider path: %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Fatalf("expected event-stream accept header, got %q", r.Header.Get("Accept"))
		}
		upstreamStreamCalls++

		var req provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode mock provider request: %v", err)
		}
		if !req.Stream {
			t.Fatal("expected Gateway to call mock provider with stream=true")
		}

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = w.Write([]byte(`data: {"id":"mock_stream","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}` + "\n\n"))
		_, _ = w.Write([]byte(`data: {"id":"mock_stream","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"로컬 mock streaming 응답입니다."},"finish_reason":null}]}` + "\n\n"))
		_, _ = w.Write([]byte(`data: {"id":"mock_stream","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}` + "\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer mockServer.Close()

	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("로컬 mock streaming을 확인해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if upstreamStreamCalls != 1 {
		t.Fatalf("expected one upstream mock streaming call, got %d", upstreamStreamCalls)
	}
	body := rr.Body.String()
	if !strings.Contains(rr.Header().Get("Content-Type"), "text/event-stream") ||
		!strings.Contains(body, "로컬 mock streaming 응답입니다.") ||
		!strings.Contains(body, "data: [DONE]") {
		t.Fatalf("expected relayed local mock SSE stream, headers=%v body=%q", rr.Header(), body)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if !logged.Stream ||
		logged.Status != invocationlog.StatusSuccess ||
		logged.DomainOutcomes.Streaming.Outcome != "completed" ||
		logged.DomainOutcomes.Provider.Outcome != "success" ||
		logged.TotalTokens != 7 {
		t.Fatalf("unexpected local mock streaming log: %+v outcomes=%+v", logged, logged.DomainOutcomes)
	}
	loggedJSON, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("marshal terminal log: %v", err)
	}
	if strings.Contains(string(loggedJSON), "로컬 mock streaming 응답입니다.") {
		t.Fatalf("terminal log must not store local mock streamed chunk content: %s", string(loggedJSON))
	}
}

func TestChatCompletionsHandlerStreamingPreservesResponseWhitespace(t *testing.T) {
	content := "첫 줄\n\n```go\nfunc main() {\n\tfmt.Println(\"hi\")\n}\n```\n끝  두칸"
	contentJSON, err := json.Marshal(content)
	if err != nil {
		t.Fatalf("marshal content: %v", err)
	}

	calls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", staticProviderAdapter{
			calls: &calls,
			response: &provider.ChatCompletionResponse{
				ID:      "mock_chatcmpl_whitespace",
				Object:  "chat.completion",
				Created: 1782108000,
				Model:   "mock-balanced",
				Choices: []provider.ChatChoice{{
					Index: 0,
					Message: provider.ChatMessage{
						Role:    "assistant",
						Content: contentJSON,
					},
					FinishReason: "stop",
				}},
			},
		}),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("Return formatted code.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if calls != 1 {
		t.Fatalf("expected one provider call, got %d", calls)
	}
	if got := streamedAssistantContent(t, rr.Body.String()); got != content {
		t.Fatalf("streamed content must preserve whitespace\nwant: %q\n got: %q\nbody: %s", content, got, rr.Body.String())
	}
}

func TestChatCompletionsHandlerStreamingClientAbortRecordsCancelled(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	streamingAdapter := &streamingProviderAdapter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", streamingAdapter),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("Write a short refund response."))).WithContext(ctx)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()
	cancel()

	handler.ServeHTTP(rr, req)

	if rr.Code != gatewayerrors.StatusClientClosedRequest {
		t.Fatalf("expected 499, got %d: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Header().Get("Content-Type"), "text/event-stream") || strings.Contains(rr.Body.String(), "data:") {
		t.Fatalf("cancelled request must not start streaming, headers=%v body=%q", rr.Header(), rr.Body.String())
	}
	if streamingAdapter.streamCalls != 0 {
		t.Fatalf("cancelled request must not open provider stream, got %d", streamingAdapter.streamCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if !logged.Stream ||
		logged.Status != invocationlog.StatusCancelled ||
		logged.HTTPStatus != gatewayerrors.StatusClientClosedRequest ||
		logged.DomainOutcomes.Streaming.Outcome != "cancelled" {
		t.Fatalf("expected cancelled streaming log, got %+v outcomes=%+v", logged, logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerStreamingUnsupportedFailsBeforeProviderCall(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	providerCalls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls: &providerCalls,
		}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("스트리밍 지원 여부를 확인해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if providerCalls != 0 {
		t.Fatalf("unsupported streaming must not call provider, got %d", providerCalls)
	}
	assertGatewayErrorCode(t, rr, "streaming_not_supported")
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.DomainOutcomes.Provider.Outcome != "not_called" ||
		logged.DomainOutcomes.Streaming.Outcome != "not_streaming" {
		t.Fatalf("unexpected unsupported streaming outcomes: %+v", logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerStreamingProviderErrorAfterChunkRecordsInterrupted(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	streamingAdapter := &streamingProviderAdapter{
		events: []provider.ChatCompletionStreamEvent{
			streamEvent(t, `{"id":"chatcmpl_interrupted","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"부분 응답"},"finish_reason":null}]}`),
		},
		nextErr: provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("synthetic stream failure")),
	}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", streamingAdapter),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("중간 실패를 재현해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("stream already started, response status should remain 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "부분 응답") || strings.Contains(rr.Body.String(), "data: [DONE]") {
		t.Fatalf("expected partial stream without done marker, got %q", rr.Body.String())
	}
	if streamingAdapter.closeCalls != 1 {
		t.Fatalf("stream reader must be closed, got %d", streamingAdapter.closeCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.Status != invocationlog.StatusFailed ||
		logged.HTTPStatus != http.StatusBadGateway ||
		logged.DomainOutcomes.Streaming.Outcome != "interrupted" ||
		logged.DomainOutcomes.Provider.Outcome != "error" ||
		logged.DomainOutcomes.Fallback.Outcome != "not_called" {
		t.Fatalf("unexpected interrupted streaming log: %+v outcomes=%+v", logged, logged.DomainOutcomes)
	}
	loggedJSON, err := json.Marshal(logged)
	if err != nil {
		t.Fatalf("marshal terminal log: %v", err)
	}
	if strings.Contains(string(loggedJSON), "부분 응답") {
		t.Fatalf("terminal log must not store streamed chunk content: %s", string(loggedJSON))
	}
}

func TestChatCompletionsHandlerStreamingFallbackSuccessRecordsFallbackOutcome(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.Providers[1].Models[0].Capabilities.StreamingSupported = true
	primary := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		openErr:     provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout")),
	}
	fallback := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeMock,
		events: []provider.ChatCompletionStreamEvent{
			streamContentEvent(t, "mock-fallback-model", "fallback stream response"),
		},
	}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("fallback streaming success를 재현해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected fallback stream 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "fallback stream response") || !strings.Contains(rr.Body.String(), "data: [DONE]") {
		t.Fatalf("expected completed fallback stream, got %q", rr.Body.String())
	}
	if primary.streamCalls != 1 || fallback.streamCalls != 1 {
		t.Fatalf("expected primary and fallback stream calls, got primary=%d fallback=%d", primary.streamCalls, fallback.streamCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if !logged.FallbackOccurred ||
		logged.Status != invocationlog.StatusSuccess ||
		logged.DomainOutcomes.Provider.Outcome != "success" ||
		logged.DomainOutcomes.Fallback.Outcome != "success" ||
		logged.DomainOutcomes.Streaming.Outcome != "completed" {
		t.Fatalf("unexpected streaming fallback log: %+v outcomes=%+v", logged, logged.DomainOutcomes)
	}
	if !logged.ProviderCalled || logged.ProviderID != "provider_mock" || logged.ModelID != "mock-fallback-model" || logged.ProviderLatencyMs == nil {
		t.Fatalf("terminal provider attempt must describe the fallback call: %+v", logged)
	}
}

func TestChatCompletionsHandlerStreamingOpenFallbackContinuesThroughOrderedModelRefs(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.Providers[1].Models[0].Capabilities.StreamingSupported = true
	catalog.Providers = append(catalog.Providers, providercatalog.Provider{
		ProviderID:       "provider_anthropic_fallback",
		ProviderName:     "anthropic-fallback",
		AdapterType:      providercatalog.AdapterTypeAnthropic,
		Enabled:          true,
		BaseURL:          "https://anthropic.example.test/v1",
		TimeoutMs:        1000,
		FallbackEligible: true,
		AdapterConfig: providercatalog.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatAnthropicMessages,
		},
		Models: []providercatalog.Model{{
			ModelID:     "model_anthropic_fallback",
			ModelName:   "anthropic-fallback-model",
			DisplayName: "Anthropic Fallback",
			Enabled:     true,
			Capabilities: providercatalog.ModelCapabilities{
				StreamingSupported: true,
			},
		}},
	})
	retryableTimeout := func() error {
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout"))
	}
	primary := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		openErr:     retryableTimeout(),
	}
	firstFallback := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeMock,
		openErr:     retryableTimeout(),
	}
	secondFallback := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeAnthropic,
		events: []provider.ChatCompletionStreamEvent{
			streamContentEvent(t, "anthropic-fallback-model", "second fallback stream response"),
		},
	}
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry(
			"mock",
			primary,
			firstFallback,
			secondFallback,
		),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline: testProviderCatalogPipelineWithCandidates(
			"model_low",
			"model_mock_fallback",
			"model_anthropic_fallback",
		),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("ordered streaming fallback")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected the final ordered stream fallback to succeed, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "second fallback stream response") || !strings.Contains(rr.Body.String(), "data: [DONE]") {
		t.Fatalf("expected completed final fallback stream, got %q", rr.Body.String())
	}
	if primary.streamCalls != 1 || firstFallback.streamCalls != 1 || secondFallback.streamCalls != 1 {
		t.Fatalf(
			"expected each ordered stream candidate once, got primary=%d first=%d second=%d",
			primary.streamCalls,
			firstFallback.streamCalls,
			secondFallback.streamCalls,
		)
	}
}

func TestChatCompletionsHandlerStreamingFallbackSkipsUnsupportedOrderedCandidate(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.Providers = append(catalog.Providers, providercatalog.Provider{
		ProviderID:       "provider_anthropic_fallback",
		ProviderName:     "anthropic-fallback",
		AdapterType:      providercatalog.AdapterTypeAnthropic,
		Enabled:          true,
		BaseURL:          "https://anthropic.example.test/v1",
		TimeoutMs:        1000,
		FallbackEligible: true,
		AdapterConfig: providercatalog.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatAnthropicMessages,
		},
		Models: []providercatalog.Model{{
			ModelID:     "model_anthropic_fallback",
			ModelName:   "anthropic-fallback-model",
			DisplayName: "Anthropic Fallback",
			Enabled:     true,
			Capabilities: providercatalog.ModelCapabilities{
				StreamingSupported: true,
			},
		}},
	})
	primary := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		openErr: provider.NewError(
			provider.ErrorKindTimeout,
			provider.ErrorCodeProviderTimeout,
			errors.New("synthetic timeout"),
		),
	}
	unsupportedFallback := &streamingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	streamingFallback := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeAnthropic,
		events: []provider.ChatCompletionStreamEvent{
			streamContentEvent(t, "anthropic-fallback-model", "supported fallback stream response"),
		},
	}
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry(
			"mock",
			primary,
			unsupportedFallback,
			streamingFallback,
		),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline: testProviderCatalogPipelineWithCandidates(
			"model_low",
			"model_mock_fallback",
			"model_anthropic_fallback",
		),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("skip unsupported fallback")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected a later streaming-capable fallback to succeed, got %d: %s", rr.Code, rr.Body.String())
	}
	if unsupportedFallback.streamCalls != 0 || streamingFallback.streamCalls != 1 {
		t.Fatalf(
			"expected unsupported candidate to be skipped and next candidate called once, got unsupported=%d supported=%d",
			unsupportedFallback.streamCalls,
			streamingFallback.streamCalls,
		)
	}
}

func TestChatCompletionsHandlerStreamingFallbackResolveCancellationRecordsCancelled(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.Providers[0].CredentialRequired = false
	catalog.Providers[0].CredentialRef = nil
	catalog.Providers[1].CredentialRequired = true
	catalog.Providers[1].CredentialRef = &credentials.Ref{
		CredentialRefID:   "credential_ref_fallback_cancel",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	}
	catalog.Providers[1].Models[0].Capabilities.StreamingSupported = true
	primary := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		openErr:     provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout")),
	}
	fallback := &streamingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      cancelingCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("fallback resolve 취소를 재현해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != gatewayerrors.StatusClientClosedRequest {
		t.Fatalf("expected 499, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.streamCalls != 1 || fallback.streamCalls != 0 {
		t.Fatalf("expected primary stream open and no fallback stream call, got primary=%d fallback=%d", primary.streamCalls, fallback.streamCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.Status != invocationlog.StatusCancelled ||
		logged.HTTPStatus != gatewayerrors.StatusClientClosedRequest ||
		logged.ErrorCode != "internal_error" ||
		logged.DomainOutcomes.Streaming.Outcome != "cancelled" {
		t.Fatalf("expected cancelled streaming log, got %+v outcomes=%+v", logged, logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerStreamingFallbackOpenCancellationRecordsCancelled(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.Providers[1].Models[0].Capabilities.StreamingSupported = true
	primary := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		openErr:     provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout")),
	}
	fallback := &streamingProviderAdapter{
		adapterType: providercatalog.AdapterTypeMock,
		openErr:     context.Canceled,
	}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("fallback open 취소를 재현해줘.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != gatewayerrors.StatusClientClosedRequest {
		t.Fatalf("expected 499, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.streamCalls != 1 || fallback.streamCalls != 1 {
		t.Fatalf("expected primary and fallback stream open attempts, got primary=%d fallback=%d", primary.streamCalls, fallback.streamCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.Status != invocationlog.StatusCancelled ||
		logged.HTTPStatus != gatewayerrors.StatusClientClosedRequest ||
		logged.ErrorCode != "internal_error" ||
		logged.DomainOutcomes.Streaming.Outcome != "cancelled" {
		t.Fatalf("expected cancelled streaming log, got %+v outcomes=%+v", logged, logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerAuthenticatesBeforeStreaming(t *testing.T) {
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock"),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}],
		"stream": true
	}`))
	req.Header.Set("Authorization", "Bearer wrong_key_redacted")
	req.Header.Set("X-GateLM-App-Token", testAppToken)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected auth to run before stream validation, got %d: %s", rr.Code, rr.Body.String())
	}
	assertGatewayErrorCode(t, rr, "invalid_api_key")
}

func TestChatCompletionsHandlerAuthenticatesBeforeRejectingMissingMessages(t *testing.T) {
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock"),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": []
	}`))
	req.Header.Set("Authorization", "Bearer "+testAPIKey)
	req.Header.Set("X-GateLM-App-Token", "wrong_token_redacted")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected auth to run before message validation, got %d: %s", rr.Code, rr.Body.String())
	}
	assertGatewayErrorCode(t, rr, "invalid_request_error")
}

func TestChatCompletionsHandlerRejectsMissingProviderRegistry(t *testing.T) {
	handler := ChatCompletionsHandler{}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "internal_error" {
		t.Fatalf("unexpected error code: %s", resp.Error.Code)
	}
}

func TestChatCompletionsHandlerRejectsOversizedBodyBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatCalls++
		writeJSON(w, http.StatusOK, provider.ChatCompletionResponse{})
	}))
	defer mockServer.Close()

	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
		MaxRequestBodyBytes: 16,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "this request is larger than the configured limit"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", chatCalls)
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "request_body_too_large" {
		t.Fatalf("unexpected error code: %s", resp.Error.Code)
	}
}

func TestChatCompletionsHandlerRejectsNilProviderResponse(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", nilProviderAdapter{}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "provider_error" {
		t.Fatalf("unexpected error code: %s", resp.Error.Code)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	assertTerminalLogMatchesGatewayErrorResponse(t, logged, rr, resp)
	if logged.Status != invocationlog.StatusFailed || logged.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("unexpected provider error log status: %+v", logged)
	}
	if logged.ErrorCode != "provider_error" || logged.ErrorStage != "call_provider_with_timeout_retry_fallback" {
		t.Fatalf("unexpected provider error fields: %+v", logged)
	}
	if logged.Provider != "mock" || logged.Model != "mock-balanced" {
		t.Fatalf("unexpected provider error route fields: %+v", logged)
	}
	if logged.ProviderLatencyMs == nil {
		t.Fatalf("provider error after adapter call must include provider latency: %+v", logged)
	}
}

func TestChatCompletionsHandlerRejectsNonTextMessageContentBeforePipelineAndProvider(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{
			name: "array content",
			body: `{
				"model": "mock-balanced",
				"messages": [{"role": "user", "content": [{"type": "text", "text": "unsupported in P0"}]}]
			}`,
		},
		{
			name: "null content",
			body: `{
				"model": "mock-balanced",
				"messages": [{"role": "assistant", "content": null}]
			}`,
		},
		{
			name: "missing content",
			body: `{
				"model": "mock-balanced",
				"messages": [{"role": "assistant"}]
			}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chatCalls := 0
			mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				chatCalls++
				writeJSON(w, http.StatusOK, provider.ChatCompletionResponse{})
			}))
			defer mockServer.Close()

			preflight := &fakeGatewayPipeline{}
			handler := ChatCompletionsHandler{
				Providers:           provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
				PreProviderPipeline: preflight,
			}
			withTestAuth(&handler)

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(tt.body))
			setValidGatewayAuthHeaders(req)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
			}
			if preflight.calls != 0 {
				t.Fatalf("expected no preflight calls, got %d", preflight.calls)
			}
			if chatCalls != 0 {
				t.Fatalf("expected no mock provider calls, got %d", chatCalls)
			}

			var resp gatewayErrorResponse
			if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if resp.Error.Code != "invalid_request_error" {
				t.Fatalf("unexpected error code: %s", resp.Error.Code)
			}
		})
	}
}

func TestChatCompletionsHandlerRejectsInvalidAPIKeyBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	req.Header.Set("Authorization", "Bearer wrong_key_redacted")
	req.Header.Set("X-GateLM-App-Token", testAppToken)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "invalid_api_key")
}

func TestChatCompletionsHandlerIgnoresLegacyAppTokenHeaderBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	req.Header.Set("Authorization", "Bearer "+testAPIKey)
	req.Header.Set("X-GateLM-App-Token", "wrong_token_redacted")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected one provider call, got %d", chatCalls)
	}
}

func TestChatCompletionsHandlerAuthenticatesProjectAPIKeyWithoutAppToken(t *testing.T) {
	apiKeyCalls := 0
	appTokenCalls := 0
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		APIKeyAuthenticator: countingAPIKeyAuthenticator{calls: &apiKeyCalls},
		AppTokenValidator:   countingAppTokenValidator{calls: &appTokenCalls},
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": []
	}`))
	req.Header.Set("Authorization", "Bearer "+testAPIKey)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiKeyCalls != 1 {
		t.Fatalf("expected one API key authenticator call, got %d", apiKeyCalls)
	}
	if appTokenCalls != 0 {
		t.Fatalf("expected no app token validator calls, got %d", appTokenCalls)
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "invalid_request_error")
}

func TestChatCompletionsHandlerAuthenticateRequestRejectsPreResolvedApplicationMismatch(t *testing.T) {
	handler := ChatCompletionsHandler{
		APIKeyAuthenticator: newTestCredentialStore(),
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	setValidGatewayAuthHeaders(req)
	reqCtx := &pipeline.RequestContext{
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: "other_app",
	}

	err := handler.authenticateRequest(context.Background(), req, reqCtx)

	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected gateway error, got %v", err)
	}
	if gatewayErr.Code != "scope_mismatch" {
		t.Fatalf("expected scope_mismatch, got %+v", gatewayErr)
	}
	if reqCtx.ApplicationID != "other_app" {
		t.Fatalf("expected existing application scope to remain unchanged, got %q", reqCtx.ApplicationID)
	}
}

func TestChatCompletionsHandlerAuthenticateRequestNormalizesBudgetScopeAfterApplicationResolution(t *testing.T) {
	handler := ChatCompletionsHandler{
		APIKeyAuthenticator: newTestCredentialStore(),
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	setValidGatewayAuthHeaders(req)
	reqCtx := &pipeline.RequestContext{}

	err := handler.authenticateRequest(context.Background(), req, reqCtx)

	if err != nil {
		t.Fatalf("authenticate request: %v", err)
	}
	if reqCtx.TenantID != testTenantID || reqCtx.ProjectID != testProjectID || reqCtx.ApplicationID != testAppID {
		t.Fatalf("unexpected authenticated scope: %+v", reqCtx)
	}
	if reqCtx.BudgetScope.Type != budget.ScopeTypeApplication ||
		reqCtx.BudgetScope.ID != testAppID ||
		reqCtx.BudgetScope.ResolvedBy != budget.ResolvedByDefaultApplication {
		t.Fatalf("unexpected budget scope: %+v", reqCtx.BudgetScope)
	}
}

func TestChatCompletionsHandlerReturnsInternalErrorForAPIKeyStoreFailure(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		APIKeyAuthenticator: failingAPIKeyAuthenticator{err: errors.New("credential store unavailable")},
		AppTokenValidator:   store,
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "internal_error")
}

func TestChatCompletionsHandlerIgnoresLegacyAppTokenStoreFailure(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		APIKeyAuthenticator: store,
		AppTokenValidator:   failingAppTokenValidator{err: errors.New("credential store unavailable")},
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": []
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "invalid_request_error")
}

func TestChatCompletionsHandlerReturnsPipelineAuthErrorsBeforeProviderCall(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "invalid api key",
			err:        gatewayerrors.InvalidAPIKey("authenticate_api_key"),
			wantStatus: http.StatusUnauthorized,
			wantCode:   "invalid_api_key",
		},
		{
			name:       "invalid app token",
			err:        gatewayerrors.InvalidAppToken("validate_app_token"),
			wantStatus: http.StatusForbidden,
			wantCode:   "invalid_app_token",
		},
		{
			name:       "scope mismatch",
			err:        gatewayerrors.ScopeMismatch("resolve_tenant_project_application"),
			wantStatus: http.StatusForbidden,
			wantCode:   "scope_mismatch",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chatCalls := 0
			mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				chatCalls++
				writeJSON(w, http.StatusOK, provider.ChatCompletionResponse{})
			}))
			defer mockServer.Close()

			preflight := &fakeGatewayPipeline{err: tt.err}
			handler := ChatCompletionsHandler{
				Providers:           provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
				PreProviderPipeline: preflight,
			}
			withTestAuth(&handler)

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
				"model": "mock-balanced",
				"messages": [{"role": "user", "content": "synthetic auth failure test"}]
			}`))
			setValidGatewayAuthHeaders(req)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != tt.wantStatus {
				t.Fatalf("expected %d, got %d: %s", tt.wantStatus, rr.Code, rr.Body.String())
			}
			if chatCalls != 0 {
				t.Fatalf("expected no mock provider calls, got %d", chatCalls)
			}
			if preflight.calls != 1 {
				t.Fatalf("expected one preflight call, got %d", preflight.calls)
			}
			if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
				t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
			}

			assertGatewayErrorCode(t, rr, tt.wantCode)
		})
	}
}

func TestChatCompletionsHandlerWritesTerminalLogForPipelineFailure(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	preflight := &fakeGatewayPipeline{
		err: gatewayerrors.InternalError("gateway_pipeline", "Gateway pipeline failed.", errors.New("stage unavailable")),
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Identity.TenantID = testTenantID
			gatewayCtx.Identity.ProjectID = testProjectID
			gatewayCtx.Identity.ApplicationID = testAppID
			gatewayCtx.Routing.ModelRef = routingdomain.MockBootstrapRef
			gatewayCtx.Routing.CandidateModelRefs = []string{routingdomain.MockBootstrapRef}
			gatewayCtx.Routing.RoutingReason = routingdomain.ReasonMatrixRoute
			gatewayCtx.Cache.CacheStatus = invocationlog.CacheStatusBypass
			gatewayCtx.Cache.CacheType = invocationlog.CacheTypeNone
			gatewayCtx.Masking.Action = "none"
			gatewayCtx.Masking.RedactedPromptPreview = "Summarize safe pipeline failure input."
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", recordingProviderAdapter{}),
		PreProviderPipeline: preflight,
		TerminalLogWriter:   logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Summarize safe pipeline failure input.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	assertTerminalLogMatchesGatewayErrorResponse(t, logged, rr, resp)
	if logged.Status != invocationlog.StatusFailed || logged.HTTPStatus != http.StatusInternalServerError {
		t.Fatalf("unexpected pipeline failure status: %+v", logged)
	}
	if logged.ErrorCode != "internal_error" || logged.ErrorStage != "gateway_pipeline" {
		t.Fatalf("unexpected pipeline error fields: %+v", logged)
	}
	if logged.CacheStatus != invocationlog.CacheStatusBypass || logged.CacheType != invocationlog.CacheTypeNone {
		t.Fatalf("pipeline failure must bypass cache, got %+v", logged)
	}
	if logged.MaskingAction != "none" || logged.MaskingDetectedCount != 0 {
		t.Fatalf("unexpected pipeline masking metadata: %+v", logged)
	}
	if logged.RedactedPromptPreview != "Summarize safe pipeline failure input." {
		t.Fatalf("unexpected pipeline redacted preview: %q", logged.RedactedPromptPreview)
	}
	if logged.ProviderLatencyMs != nil {
		t.Fatalf("pipeline failure before provider call must not include provider latency: %d", *logged.ProviderLatencyMs)
	}
}

func TestLogGatewayAuthInternalErrorWritesSafeCause(t *testing.T) {
	output := captureDefaultLog(t)
	reqCtx := &pipeline.RequestContext{RequestID: "req_test"}
	err := gatewayerrors.InternalError(authenticate.StageName, "Gateway API key authentication failed.", errors.New("credential store unavailable\nretry later"))

	logGatewayAuthInternalError(reqCtx, err)

	logged := output.String()
	if !strings.Contains(logged, "gateway auth internal error") {
		t.Fatalf("expected auth internal error log, got %q", logged)
	}
	if !strings.Contains(logged, "request_id=req_test") || !strings.Contains(logged, "stage=authenticate_api_key") {
		t.Fatalf("expected request and stage context in log, got %q", logged)
	}
	if !strings.Contains(logged, "credential store unavailable retry later") {
		t.Fatalf("expected sanitized cause in log, got %q", logged)
	}
}

func TestLogGatewayAuthInternalErrorSkipsInvalidAPIKey(t *testing.T) {
	output := captureDefaultLog(t)
	reqCtx := &pipeline.RequestContext{RequestID: "req_test"}

	logGatewayAuthInternalError(reqCtx, gatewayerrors.InvalidAPIKey(authenticate.StageName))

	if output.String() != "" {
		t.Fatalf("expected no log for invalid API key, got %q", output.String())
	}
}

func TestChatCompletionsHandlerRejectsScopeMismatchBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	store := auth.NewStaticCredentialStore(auth.StaticCredentialConfig{
		APIKey:   testAPIKey,
		AppToken: testAppToken,
		APIKeyIdentity: auth.APIKeyIdentity{
			APIKeyID:      testAPIKeyID,
			TenantID:      testTenantID,
			ProjectID:     "other_project",
			ApplicationID: testAppID,
		},
		AppTokenIdentity: auth.AppTokenIdentity{
			AppTokenID:    testAppTokenID,
			TenantID:      testTenantID,
			ProjectID:     testProjectID,
			ApplicationID: testAppID,
		},
	})
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		APIKeyAuthenticator: store,
		AppTokenValidator:   store,
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "scope_mismatch")
}

func TestChatCompletionsHandlerDoesNotMaskAPIKeyContextCancellation(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		APIKeyAuthenticator: failingAPIKeyAuthenticator{err: context.Canceled},
		AppTokenValidator:   store,
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != 499 {
		t.Fatalf("expected 499, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "internal_error")
}

func TestChatCompletionsHandlerDoesNotCallLegacyAppTokenValidatorAfterAPIKeyAuth(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		APIKeyAuthenticator: store,
		AppTokenValidator:   failingAppTokenValidator{err: context.DeadlineExceeded},
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": []
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "invalid_request_error")
}

func TestChatCompletionsHandlerUsesPipelineRouteAndContextMetadata(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if req.Model != routingdomain.MockBootstrapRef {
			t.Fatalf("expected routed mock bootstrap model, got %s", req.Model)
		}

		writeJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_route_test",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   req.Model,
			Choices: []provider.ChatChoice{
				{
					Index: 0,
					Message: provider.ChatMessage{
						Role:    "assistant",
						Content: json.RawMessage(`"Mock routed response"`),
					},
					FinishReason: "stop",
				},
			},
		})
	}))
	defer mockServer.Close()

	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			expectedPrompt := "system prompt\nshort prompt"
			if gatewayCtx.Request.PromptText != expectedPrompt {
				t.Fatalf("expected prompt text %q, got %q", expectedPrompt, gatewayCtx.Request.PromptText)
			}
			gatewayCtx.Identity.TenantID = testTenantID
			gatewayCtx.Identity.ProjectID = testProjectID
			gatewayCtx.Identity.ApplicationID = testAppID
			gatewayCtx.Identity.APIKeyID = testAPIKeyID
			gatewayCtx.Identity.AppTokenID = testAppTokenID
			gatewayCtx.Routing.ModelRef = routingdomain.MockBootstrapRef
			gatewayCtx.Routing.CandidateModelRefs = []string{routingdomain.MockBootstrapRef}
			gatewayCtx.Routing.RoutingReason = routingdomain.ReasonMatrixRoute
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
		PreProviderPipeline: preflight,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [
			{"role": "system", "content": "system prompt"},
			{"role": "user", "content": "short prompt"}
		]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("resolved target must not be exposed in response headers: %#v", rr.Header())
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil {
		t.Fatalf("missing gate_lm metadata")
	}
	if resp.GateLM.TenantID != testTenantID || resp.GateLM.ProjectID != testProjectID || resp.GateLM.ApplicationID != testAppID {
		t.Fatalf("unexpected gate_lm context metadata: %#v", resp.GateLM)
	}
	if resp.GateLM.ExecutionMode != "mock" || resp.GateLM.RoutingReason != routingdomain.ReasonMatrixRoute {
		t.Fatalf("unexpected gate_lm routing metadata: %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerRedactsEmailAndPhoneBeforeProviderCall(t *testing.T) {
	tests := []struct {
		name        string
		prompt      string
		rawValue    string
		placeholder string
	}{
		{
			name:        "email",
			prompt:      "Write a safe reply to user@example.invalid about the refund.",
			rawValue:    "user@example.invalid",
			placeholder: "[EMAIL_1]",
		},
		{
			name:        "phone",
			prompt:      "Write a safe reply asking them to call 010-0000-0000 tomorrow.",
			rawValue:    "010-0000-0000",
			placeholder: "[PHONE_NUMBER_1]",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chatCalls := 0
			var providerRequests []provider.ChatCompletionRequest
			logWriter := &recordingTerminalLogWriter{}
			handler := ChatCompletionsHandler{
				Providers: provider.NewRegistry("mock", recordingProviderAdapter{
					calls:    &chatCalls,
					requests: &providerRequests,
				}),
				TerminalLogWriter: logWriter,
			}
			withTestAuth(&handler)

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody(tt.prompt)))
			setValidGatewayAuthHeaders(req)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if rr.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
			}
			if chatCalls != 1 {
				t.Fatalf("expected one provider call for redacted request, got %d", chatCalls)
			}
			if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "redacted" {
				t.Fatalf("expected masking action redacted header, got %q", got)
			}

			providerPrompt := recordedProviderPrompt(t, providerRequests)
			if !strings.Contains(providerPrompt, tt.placeholder) {
				t.Fatalf("expected provider prompt to contain %s, got %q", tt.placeholder, providerPrompt)
			}
			if strings.Contains(providerPrompt, tt.rawValue) {
				t.Fatalf("provider prompt must not include raw sensitive value %q: %q", tt.rawValue, providerPrompt)
			}

			responseBody := rr.Body.String()
			var resp provider.ChatCompletionResponse
			if err := json.NewDecoder(strings.NewReader(responseBody)).Decode(&resp); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if resp.GateLM == nil || resp.GateLM.MaskingAction != "redacted" {
				t.Fatalf("expected redacted gate_lm masking metadata, got %#v", resp.GateLM)
			}
			if strings.Contains(responseBody, tt.rawValue) {
				t.Fatalf("response body must not include raw sensitive value %q: %s", tt.rawValue, responseBody)
			}
			if len(logWriter.logs) != 1 {
				t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
			}
			logged := logWriter.logs[0]
			if logged.MaskingAction != "redacted" || logged.MaskingDetectedCount == 0 {
				t.Fatalf("unexpected redacted terminal log masking metadata: %+v", logged)
			}
			if !strings.Contains(logged.RedactedPromptPreview, tt.placeholder) {
				t.Fatalf("expected redacted prompt preview to contain %s, got %q", tt.placeholder, logged.RedactedPromptPreview)
			}
			if strings.Contains(logged.RedactedPromptPreview, tt.rawValue) {
				t.Fatalf("redacted prompt preview must not include raw sensitive value %q: %q", tt.rawValue, logged.RedactedPromptPreview)
			}
		})
	}
}

func TestChatCompletionsHandlerKeepsEntityScopeAcrossRequestMessages(t *testing.T) {
	chatCalls := 0
	var providerRequests []provider.ChatCompletionRequest
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &chatCalls,
			requests: &providerRequests,
		}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: "mock-balanced",
		Messages: []provider.ChatMessage{
			{
				Role:    "system",
				Content: json.RawMessage(jsonStringLiteral("Primary contact is first@example.invalid.")),
			},
			{
				Role:    "user",
				Content: json.RawMessage(jsonStringLiteral("Email second@example.invalid, then first@example.invalid.")),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected one provider call, got %d", chatCalls)
	}

	providerPrompt := recordedProviderPrompt(t, providerRequests)
	expected := "Primary contact is [EMAIL_1].\nEmail [EMAIL_2], then [EMAIL_1]."
	if providerPrompt != expected {
		t.Fatalf("expected request-scoped redacted prompt %q, got %q", expected, providerPrompt)
	}
	if strings.Contains(providerPrompt, "first@example.invalid") || strings.Contains(providerPrompt, "second@example.invalid") {
		t.Fatalf("provider prompt must not include raw emails: %q", providerPrompt)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	expectedPreview := "Primary contact is [EMAIL_1].\nEmail [EMAIL_2], then [EMAIL_1]."
	if logWriter.logs[0].RedactedPromptPreview != expectedPreview {
		t.Fatalf("expected request-scoped log preview %q, got %q", expectedPreview, logWriter.logs[0].RedactedPromptPreview)
	}
}

func TestChatCompletionsHandlerKeepsFirstPersonRoleAcrossRequestMessages(t *testing.T) {
	chatCalls := 0
	var providerRequests []provider.ChatCompletionRequest
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls:    &chatCalls,
			requests: &providerRequests,
		}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: "mock-balanced",
		Messages: []provider.ChatMessage{
			{
				Role:    "system",
				Content: json.RawMessage(jsonStringLiteral("customer_name=Alex Kim")),
			},
			{
				Role:    "user",
				Content: json.RawMessage(jsonStringLiteral("patient_name=Alex Kim")),
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected one provider call, got %d", chatCalls)
	}

	providerPrompt := recordedProviderPrompt(t, providerRequests)
	expected := "customer_name=[CUSTOMER_1]\npatient_name=[CUSTOMER_1]"
	if providerPrompt != expected {
		t.Fatalf("expected request-scoped role-aware prompt %q, got %q", expected, providerPrompt)
	}
	if strings.Contains(providerPrompt, "Alex Kim") || strings.Contains(providerPrompt, "[PATIENT_1]") {
		t.Fatalf("provider prompt must keep first role without raw person name: %q", providerPrompt)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	expectedPreview := "customer_name=[CUSTOMER_1]\npatient_name=[CUSTOMER_1]"
	if logWriter.logs[0].RedactedPromptPreview != expectedPreview {
		t.Fatalf("expected role-aware log preview %q, got %q", expectedPreview, logWriter.logs[0].RedactedPromptPreview)
	}
}

func TestChatCompletionsHandlerBlocksSensitiveDataBeforeProviderCall(t *testing.T) {
	tests := []struct {
		name     string
		prompt   string
		rawValue string
	}{
		{
			name:     "api key",
			prompt:   "Summarize this synthetic config: api_key=test_secret_token_redacted_for_demo_only_1234567890",
			rawValue: "test_secret_token_redacted_for_demo_only_1234567890",
		},
		{
			name:     "jwt",
			prompt:   "Summarize this synthetic token: eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature_for_test_only",
			rawValue: "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature_for_test_only",
		},
		{
			name:     "rrn",
			prompt:   "Reject this synthetic rrn-like value: 000101-3000000",
			rawValue: "000101-3000000",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			chatCalls := 0
			handler := ChatCompletionsHandler{
				Providers: provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
			}
			withTestAuth(&handler)

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody(tt.prompt)))
			setValidGatewayAuthHeaders(req)
			rr := httptest.NewRecorder()

			handler.ServeHTTP(rr, req)

			if chatCalls != 0 {
				t.Fatalf("expected sensitive %s request to block before provider call, got %d provider calls", tt.name, chatCalls)
			}
			if rr.Code != http.StatusForbidden {
				t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
			}
			if got := rr.Header().Get("X-GateLM-Masking-Action"); got != "blocked" {
				t.Fatalf("expected masking action blocked header, got %q", got)
			}
			if got := rr.Header().Get("X-GateLM-Cache-Status"); got != "bypass" {
				t.Fatalf("expected blocked request to bypass cache, got %q", got)
			}
			if strings.Contains(rr.Body.String(), tt.rawValue) {
				t.Fatalf("blocked response must not include raw sensitive value %q", tt.rawValue)
			}
			assertGatewayErrorCode(t, rr, "sensitive_data_blocked")
		})
	}
}

func TestChatCompletionsHandlerWritesTerminalLogForBlockedRequest(t *testing.T) {
	chatCalls := 0
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Summarize api_key="+rawSecret)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("blocked request must not call provider, got %d calls", chatCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	assertTerminalLogMatchesBlockedResponse(t, logged, rr)
	if logged.Status != invocationlog.StatusBlocked || logged.HTTPStatus != http.StatusForbidden {
		t.Fatalf("unexpected blocked log status: %+v", logged)
	}
	if logged.ErrorCode != "sensitive_data_blocked" || logged.ErrorStage != "mask_or_block" {
		t.Fatalf("unexpected blocked error fields: %+v", logged)
	}
	if logged.CacheStatus != invocationlog.CacheStatusBypass || logged.CacheType != invocationlog.CacheTypeNone {
		t.Fatalf("blocked request must bypass cache, got %+v", logged)
	}
	if logged.CostMicroUSD != 0 || logged.SavedCostMicroUSD != 0 {
		t.Fatalf("blocked request cost fields must be zero, got %+v", logged)
	}
	if logged.ProviderLatencyMs != nil {
		t.Fatalf("blocked request provider latency must be nil, got %+v", logged.ProviderLatencyMs)
	}
	if logged.MaskingAction != "blocked" || logged.MaskingDetectedCount == 0 {
		t.Fatalf("unexpected masking fields: %+v", logged)
	}
	if strings.Contains(logged.RedactedPromptPreview, rawSecret) {
		t.Fatalf("blocked log preview must not include raw secret: %q", logged.RedactedPromptPreview)
	}
	if logged.PromptTokens != 0 || logged.CompletionTokens != 0 || logged.TotalTokens != 0 || logged.CostMicroUSD != 0 {
		t.Fatalf("blocked log usage/cost must be zero, got %+v", logged)
	}
	if logged.ProviderLatencyMs != nil {
		t.Fatalf("blocked log provider latency must be nil, got %d", *logged.ProviderLatencyMs)
	}
}

func TestChatCompletionsHandlerStreamingSafetyBlockNeverStartsStreamOrProvider(t *testing.T) {
	chatCalls := 0
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		TerminalLogWriter: logWriter,
	}
	withTestAuth(&handler)

	rawSecret := "test_secret_token_redacted_for_demo_only_1234567890"
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("Summarize api_key="+rawSecret)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Header().Get("Content-Type"), "text/event-stream") || strings.Contains(rr.Body.String(), "data:") {
		t.Fatalf("safety block must not start streaming, headers=%v body=%q", rr.Header(), rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("safety block must not call provider, got %d calls", chatCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if !logged.Stream ||
		logged.Status != invocationlog.StatusBlocked ||
		logged.DomainOutcomes.Streaming.Outcome != "not_streaming" ||
		logged.DomainOutcomes.Provider.Outcome != "not_called" ||
		logged.DomainOutcomes.Cache.Outcome != "bypassed" {
		t.Fatalf("unexpected streaming safety block log: %+v", logged.DomainOutcomes)
	}
	if strings.Contains(rr.Body.String(), rawSecret) {
		t.Fatalf("blocked response must not include raw sensitive value")
	}
}

func TestChatCompletionsHandlerSameSafeRequestMissThenHit(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
	}
	withTestAuth(&handler)

	body := chatCompletionBody("Write a short safe refund response.")
	firstReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	setValidGatewayAuthHeaders(firstReq)
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, firstReq)

	secondReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	setValidGatewayAuthHeaders(secondReq)
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, secondReq)

	if first.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d: %s", first.Code, first.Body.String())
	}
	if second.Code != http.StatusOK {
		t.Fatalf("expected second request 200, got %d: %s", second.Code, second.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf(
			"expected provider call count to remain 1 across miss then hit, got %d (first cache=%q second cache=%q)",
			chatCalls,
			first.Header().Get("X-GateLM-Cache-Status"),
			second.Header().Get("X-GateLM-Cache-Status"),
		)
	}
	if got := first.Header().Get("X-GateLM-Cache-Status"); got != "miss" {
		t.Fatalf("expected first safe request cache miss, got %q", got)
	}
	if got := second.Header().Get("X-GateLM-Cache-Status"); got != "hit" {
		t.Fatalf("expected second safe request cache hit, got %q", got)
	}
}

func TestCombineMaskingResultsBoundsRedactedPromptPreview(t *testing.T) {
	redactedPrompt := strings.Repeat("safe ", 40)

	result := combineMaskingResults([]maskdomain.Result{
		{
			Action:                  maskdomain.ActionNone,
			RedactedPrompt:          redactedPrompt,
			RedactedPromptPreview:   redactedPrompt,
			SecurityPolicyVersionID: maskdomain.DefaultSecurityPolicyVersionID,
		},
	}, redactedPrompt, redactedPrompt, maskdomain.DefaultSecurityPolicyVersionID)

	if result.RedactedPrompt != redactedPrompt {
		t.Fatalf("expected full redacted prompt to remain available in memory, got %q", result.RedactedPrompt)
	}
	if len([]rune(result.RedactedPromptPreview)) > maskdomain.RedactedPromptPreviewMaxRunes+3 {
		t.Fatalf("expected bounded preview, got length=%d preview=%q", len([]rune(result.RedactedPromptPreview)), result.RedactedPromptPreview)
	}
	if !strings.HasSuffix(result.RedactedPromptPreview, "...") {
		t.Fatalf("expected truncated preview suffix, got %q", result.RedactedPromptPreview)
	}
}

func TestChatCompletionsHandlerStoresSanitizedPayloadOnCacheMiss(t *testing.T) {
	chatCalls := 0
	rawPayload := json.RawMessage(`{"raw":"provider body must not be cached"}`)
	providerMetadata := &provider.GateLMMetadata{
		RequestID:     "provider_request_should_not_be_cached",
		CacheStatus:   "provider-cache",
		MaskingAction: "provider-mask",
	}
	cacheStore := &recordingExactCacheStore{}
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:sanitized-cache-key"}
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", staticProviderAdapter{
			calls: &chatCalls,
			response: &provider.ChatCompletionResponse{
				ID:      "mock_chatcmpl_cache_store",
				Object:  "chat.completion",
				Created: 1782108000,
				Model:   "mock-balanced",
				Choices: []provider.ChatChoice{
					{
						Index: 0,
						Message: provider.ChatMessage{
							Role:    "assistant",
							Content: json.RawMessage(`"Mock cached response"`),
						},
						FinishReason: "stop",
					},
				},
				GateLM: providerMetadata,
				Raw:    &rawPayload,
			},
		}),
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: keyBuilder,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short safe cacheable response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected provider to be called once, got %d", chatCalls)
	}
	if keyBuilder.calls != 1 || cacheStore.getCalls != 1 || cacheStore.setCalls != 1 {
		t.Fatalf("expected one key build/get/set, got key=%d get=%d set=%d", keyBuilder.calls, cacheStore.getCalls, cacheStore.setCalls)
	}
	if len(cacheStore.entries) != 1 {
		t.Fatalf("expected one cached entry, got %d", len(cacheStore.entries))
	}

	entry := cacheStore.entries[0]
	if entry.KeyHash != "hmac-sha256:sanitized-cache-key" {
		t.Fatalf("unexpected cache key hash: %q", entry.KeyHash)
	}
	cachedPayload := string(entry.Payload)
	if strings.Contains(cachedPayload, "gate_lm") || strings.Contains(cachedPayload, providerMetadata.RequestID) {
		t.Fatalf("cached payload must not include request-specific gate_lm metadata: %s", cachedPayload)
	}
	if strings.Contains(cachedPayload, "provider body must not be cached") {
		t.Fatalf("cached payload must not include raw provider payload: %s", cachedPayload)
	}
}

func TestChatCompletionsHandlerDoesNotSetHitRequestIDBeforeCachedPayloadDecodes(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_current",
		TraceID:   "request_current",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.TenantID = testTenantID
	reqCtx.ProjectID = testProjectID
	reqCtx.ApplicationID = testAppID
	reqCtx.RequestedModel = "mock-balanced"
	reqCtx.Provider = "mock"
	reqCtx.Model = "mock-balanced"
	reqCtx.RoutingPolicyHash = "route_p0_v1"
	reqCtx.SecurityPolicyVersionID = maskdomain.DefaultSecurityPolicyVersionID
	reqCtx.MaskingAction = string(maskdomain.ActionNone)
	handler := ChatCompletionsHandler{
		ExactCacheStore: &recordingExactCacheStore{
			result: ports.CacheLookupResult{
				Hit:               true,
				CacheHitRequestID: "request_original",
				Payload:           []byte(`not-json`),
			},
		},
		ExactCacheKeyBuilder: &recordingExactKeyBuilder{key: "hmac-sha256:cache-hit-key"},
		CachePolicyHash:      "cache_p0_v1",
	}

	payload, hitRequestID, _, hit := handler.lookupExactCache(
		context.Background(),
		reqCtx,
		provider.ChatCompletionRequest{Model: "mock-balanced"},
		"Write a short safe cached response.",
	)

	if !hit || string(payload) != "not-json" || hitRequestID != "request_original" {
		t.Fatalf("expected raw cache hit result, hit=%v hitRequestID=%q payload=%q", hit, hitRequestID, string(payload))
	}
	if reqCtx.CacheHitRequestID != "" {
		t.Fatalf("cache hit request id must be applied only after cached payload decode succeeds, got %q", reqCtx.CacheHitRequestID)
	}
}

func TestBuildExactCacheKeyPrefersRuntimeSecurityPolicyHash(t *testing.T) {
	reqCtx := pipeline.NewRequestContext(pipeline.NewRequestContextInput{
		RequestID: "request_current",
		TraceID:   "request_current",
		Endpoint:  "/v1/chat/completions",
		Method:    http.MethodPost,
	})
	reqCtx.TenantID = testTenantID
	reqCtx.ProjectID = testProjectID
	reqCtx.ApplicationID = testAppID
	reqCtx.RequestedModel = "auto"
	reqCtx.ModelRef = "mock-fast"
	reqCtx.Provider = "mock"
	reqCtx.Model = "mock-fast"
	reqCtx.RoutingPolicyHash = "hash_routing_policy_test"
	reqCtx.SecurityPolicyHash = "hash_security_policy_test"
	reqCtx.SecurityPolicyVersionID = maskdomain.DefaultSecurityPolicyVersionID
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:cache-key"}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock"),
		ExactCacheKeyBuilder: keyBuilder,
		CachePolicyHash:      "cache_p0_v1",
	}

	key, err := handler.buildExactCacheKey(
		context.Background(),
		reqCtx,
		provider.ChatCompletionRequest{Model: "mock-balanced"},
		"Write a short safe cached response.",
	)

	if err != nil {
		t.Fatalf("expected cache key build, got %v", err)
	}
	if key != "hmac-sha256:cache-key" {
		t.Fatalf("unexpected cache key: %s", key)
	}
	if keyBuilder.material.SafetyPolicyHash != "hash_security_policy_test" {
		t.Fatalf("expected runtime security hash in cache material, got %#v", keyBuilder.material)
	}
	if keyBuilder.material.RoutingPolicyHash != "hash_routing_policy_test" {
		t.Fatalf("expected runtime routing hash in cache material, got %#v", keyBuilder.material)
	}
	if keyBuilder.material.RequestedModel != "auto" {
		t.Fatalf("expected requested model in cache material, got %#v", keyBuilder.material)
	}
	if keyBuilder.material.ProviderCatalogStableKey != "mock" || keyBuilder.material.ModelID != "mock-fast" {
		t.Fatalf("expected routing-aware provider/model material, got %#v", keyBuilder.material)
	}
}

func TestChatCompletionsHandlerFallsBackToProviderWhenCachedPayloadIsInvalid(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls: &chatCalls,
		}),
		ExactCacheStore: &recordingExactCacheStore{
			result: ports.CacheLookupResult{
				Hit:               true,
				CacheHitRequestID: "request_original",
				Payload:           []byte(`not-json`),
			},
		},
		ExactCacheKeyBuilder: &recordingExactKeyBuilder{key: "hmac-sha256:bad-cache-payload"},
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short safe cached response with corrupt cache fallback.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected provider fallback 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected provider fallback after corrupt cache hit, got %d provider calls", chatCalls)
	}
	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil || resp.GateLM.CacheStatus != "error" {
		t.Fatalf("expected cache error metadata on fallback response, got %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerLogsCacheWriteFailureWithoutFailingResponse(t *testing.T) {
	output := captureDefaultLog(t)
	chatCalls := 0
	cacheStore := &recordingExactCacheStore{setErr: errors.New("redis unavailable\nretry later")}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: &recordingExactKeyBuilder{key: "hmac-sha256:cache-write-failure"},
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short safe response while cache write fails.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("cache write failure must not fail response, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 || cacheStore.setCalls != 1 {
		t.Fatalf("expected one provider call and one cache set, got provider=%d set=%d", chatCalls, cacheStore.setCalls)
	}
	logged := output.String()
	if !strings.Contains(logged, "exact cache write failed") || !strings.Contains(logged, "request_id=") || !strings.Contains(logged, "cache_key_hash=hmac-sha256:cache-write-failure") {
		t.Fatalf("expected safe cache write failure log, got %q", logged)
	}
	if strings.Contains(logged, "\nretry later") {
		t.Fatalf("expected sanitized one-line cache write failure log, got %q", logged)
	}
}

func TestChatCompletionsHandlerCacheHitReattachesCurrentRequestMetadata(t *testing.T) {
	chatCalls := 0
	cachedPayload, err := json.Marshal(provider.ChatCompletionResponse{
		ID:      "mock_chatcmpl_cached",
		Object:  "chat.completion",
		Created: 1782108000,
		Model:   "mock-balanced",
		Choices: []provider.ChatChoice{
			{
				Index: 0,
				Message: provider.ChatMessage{
					Role:    "assistant",
					Content: json.RawMessage(`"Cached response"`),
				},
				FinishReason: "stop",
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal cached response: %v", err)
	}
	cacheStore := &recordingExactCacheStore{
		result: ports.CacheLookupResult{
			Hit:               true,
			CacheHitRequestID: "request_original",
			Payload:           cachedPayload,
		},
	}
	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.ModelRef = "mock-balanced"
			gatewayCtx.Routing.CandidateModelRefs = []string{"mock-balanced"}
			gatewayCtx.Routing.RoutingReason = "pinned"
		},
	}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		PreProviderPipeline:  preflight,
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: &recordingExactKeyBuilder{key: "hmac-sha256:cache-hit-key"},
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short safe cached response.")))
	req.Header.Set(middleware.RequestIDHeader, "request_current")
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("cache hit must not call provider, got %d provider calls", chatCalls)
	}
	if preflight.calls != 1 {
		t.Fatalf("routing-aware cache hit must run pre-provider routing pipeline once, got %d calls", preflight.calls)
	}
	if cacheStore.setCalls != 0 {
		t.Fatalf("cache hit must not write cache, got %d set calls", cacheStore.setCalls)
	}
	if got := rr.Header().Get("X-GateLM-Cache-Status"); got != "hit" {
		t.Fatalf("expected cache hit header, got %q", got)
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil {
		t.Fatal("expected current gate_lm metadata on cached response")
	}
	if resp.GateLM.RequestID != "request_current" {
		t.Fatalf("expected current request id on cache hit, got %q", resp.GateLM.RequestID)
	}
	if resp.GateLM.CacheStatus != "hit" || resp.GateLM.ExecutionMode != "mock" || resp.GateLM.RoutingReason != "pinned" {
		t.Fatalf("unexpected gate_lm cache/routing metadata: %#v", resp.GateLM)
	}
	outcomes, ok := resp.GateLM.DomainOutcomes.(map[string]any)
	if !ok {
		t.Fatalf("expected domain outcomes map on cache hit, got %#v", resp.GateLM.DomainOutcomes)
	}
	routingOutcome, ok := outcomes["routing"].(map[string]any)
	if !ok ||
		routingOutcome["outcome"] != "selected" ||
		routingOutcome["routingReason"] != "pinned" {
		t.Fatalf("expected selected routing outcome on cache hit, got %#v", outcomes["routing"])
	}
	if _, exposed := routingOutcome["selectedProvider"]; exposed {
		t.Fatalf("routing outcome exposed selectedProvider: %#v", routingOutcome)
	}
	if _, exposed := routingOutcome["selectedModel"]; exposed {
		t.Fatalf("routing outcome exposed selectedModel: %#v", routingOutcome)
	}
}

func TestChatCompletionsHandlerWritesTerminalLogForCacheHit(t *testing.T) {
	chatCalls := 0
	logWriter := &recordingTerminalLogWriter{}
	cachedPayload := marshalChatCompletionPayload(t, provider.ChatCompletionResponse{
		ID:      "cached_chatcmpl_previous",
		Object:  "chat.completion",
		Created: 1782108000,
		Model:   "mock-balanced",
	})
	cacheStore := &recordingExactCacheStore{
		result: ports.CacheLookupResult{
			Hit:               true,
			CacheHitRequestID: "request_previous",
			Payload:           cachedPayload,
		},
	}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: &recordingExactKeyBuilder{key: "hmac-sha256:cache-key"},
		TerminalLogWriter:    logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Write a short safe cached response.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("cache hit must not call provider, got %d calls", chatCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	resp := decodeChatCompletionResponse(t, rr)
	logged := logWriter.logs[0]
	assertTerminalLogMatchesSuccessResponse(t, logged, rr, resp)
	if logged.Status != invocationlog.StatusSuccess || logged.CacheStatus != invocationlog.CacheStatusHit {
		t.Fatalf("unexpected cache hit log status: %+v", logged)
	}
	if logged.CacheType != invocationlog.CacheTypeExact || logged.CacheKeyHash != "hmac-sha256:cache-key" || logged.CacheHitRequestID != "request_previous" {
		t.Fatalf("unexpected cache hit fields: %+v", logged)
	}
	if logged.PromptTokens != 0 || logged.CompletionTokens != 0 || logged.TotalTokens != 0 || logged.CostMicroUSD != 0 {
		t.Fatalf("cache hit usage/cost must be zero, got %+v", logged)
	}
	if logged.SavedCostMicroUSD != 0 {
		t.Fatalf("cache hit saved cost must default to zero, got %d", logged.SavedCostMicroUSD)
	}
	if logged.ProviderLatencyMs != nil {
		t.Fatalf("cache hit provider latency must be nil, got %+v", logged.ProviderLatencyMs)
	}
	if logged.DomainOutcomes.Cache.Outcome != "hit" || logged.DomainOutcomes.Provider.Outcome != "not_called" {
		t.Fatalf("unexpected cache hit domain outcomes: %+v", logged.DomainOutcomes)
	}
	if logged.DomainOutcomes.Routing.Outcome != "selected" ||
		valueOrEmpty(logged.DomainOutcomes.Routing.RoutingReason) != routingdomain.ReasonManualModelRef {
		t.Fatalf("cache hit must retain routing decision and bypass only provider call, got %+v", logged.DomainOutcomes.Routing)
	}
}

func TestChatCompletionsHandlerReturnsCacheHitWithoutProviderCall(t *testing.T) {
	chatCalls := 0
	cachedPayload := marshalChatCompletionPayload(t, provider.ChatCompletionResponse{
		ID:      "cached_chatcmpl_previous",
		Object:  "chat.completion",
		Created: 1782108000,
		Model:   "mock-balanced",
		Choices: []provider.ChatChoice{
			{
				Index: 0,
				Message: provider.ChatMessage{
					Role:    "assistant",
					Content: json.RawMessage(`"Cached response"`),
				},
				FinishReason: "stop",
			},
		},
		Usage: &provider.Usage{
			PromptTokens:     12,
			CompletionTokens: 8,
			TotalTokens:      20,
		},
		GateLM: &provider.GateLMMetadata{
			RequestID:   "request_previous",
			CacheStatus: "miss",
		},
	})
	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.ModelRef = routingdomain.MockBootstrapRef
			gatewayCtx.Routing.CandidateModelRefs = []string{routingdomain.MockBootstrapRef}
			gatewayCtx.Routing.RoutingReason = routingdomain.ReasonMatrixRoute
			gatewayCtx.Cache.CacheStatus = "hit"
			gatewayCtx.Cache.CacheType = "exact"
			gatewayCtx.Cache.CacheKeyHash = "hmac-sha256:cache-key"
			gatewayCtx.Cache.CacheHitRequestID = "request_previous"
			gatewayCtx.Cache.Payload = cachedPayload
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		PreProviderPipeline: preflight,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "short prompt"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if preflight.calls != 1 {
		t.Fatalf("expected pre-provider pipeline to be called once, got %d", preflight.calls)
	}
	if chatCalls != 0 {
		t.Fatalf("expected provider not to be called on cache hit, got %d", chatCalls)
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "hit" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("resolved target must not be exposed in response headers: %#v", rr.Header())
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ID != "cached_chatcmpl_previous" || resp.Object != "chat.completion" {
		t.Fatalf("unexpected cached response shape: %#v", resp)
	}
	if resp.Model != "auto" {
		t.Fatalf("expected cached response model to preserve requested model auto, got %s", resp.Model)
	}
	if resp.Usage == nil || resp.Usage.PromptTokens != 0 || resp.Usage.CompletionTokens != 0 || resp.Usage.TotalTokens != 0 {
		t.Fatalf("expected cache hit usage to be zeroed, got %#v", resp.Usage)
	}
	if resp.GateLM == nil {
		t.Fatalf("missing gate_lm metadata")
	}
	if resp.GateLM.RequestID == "request_previous" || resp.GateLM.RequestID != rr.Header().Get(middleware.RequestIDHeader) {
		t.Fatalf("expected current request id in gate_lm metadata, got %#v", resp.GateLM)
	}
	if resp.GateLM.CacheStatus != "hit" || resp.GateLM.ExecutionMode != "mock" || resp.GateLM.EstimatedCostUSD != "0.000000" {
		t.Fatalf("unexpected gate_lm cache metadata: %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerBypassesCacheForBlockedRequestBeforeKeyBuilderAndStore(t *testing.T) {
	chatCalls := 0
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:must-not-build"}
	cacheStore := &recordingExactCacheStore{}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		ExactCacheStore:      cacheStore,
		ExactCacheKeyBuilder: keyBuilder,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("Summarize this synthetic config: api_key=test_secret_token_redacted_for_demo_only_1234567890")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("blocked request must not call provider, got %d provider calls", chatCalls)
	}
	if keyBuilder.calls != 0 || cacheStore.getCalls != 0 || cacheStore.setCalls != 0 {
		t.Fatalf("blocked request must bypass key builder and cache store, got key=%d get=%d set=%d", keyBuilder.calls, cacheStore.getCalls, cacheStore.setCalls)
	}
	if got := rr.Header().Get("X-GateLM-Cache-Status"); got != "bypass" {
		t.Fatalf("expected cache bypass header, got %q", got)
	}
}

func TestChatCompletionsHandlerBudgetBlockStopsBeforeCacheRoutingAndProvider(t *testing.T) {
	chatCalls := 0
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:must-not-build"}
	cacheStore := &recordingExactCacheStore{}
	preflight := &fakeGatewayPipeline{}
	logWriter := &recordingTerminalLogWriter{}
	runtimePolicy := pipeline.New(budgetstage.NewStage(handlerBudgetChecker{decision: budget.Decision{
		Allowed: false,
		Outcome: budget.OutcomeBlocked,
		Reason:  "monthly_limit_exceeded",
	}}))
	handler := ChatCompletionsHandler{
		Providers:             provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		RuntimePolicyPipeline: runtimePolicy,
		PreProviderPipeline:   preflight,
		ExactCacheStore:       cacheStore,
		ExactCacheKeyBuilder:  keyBuilder,
		TerminalLogWriter:     logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "short prompt"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("budget block must not call provider, got %d provider calls", chatCalls)
	}
	if preflight.calls != 0 {
		t.Fatalf("budget block must stop before pre-provider pipeline, got %d calls", preflight.calls)
	}
	if keyBuilder.calls != 0 || cacheStore.getCalls != 0 || cacheStore.setCalls != 0 {
		t.Fatalf("budget block must bypass key builder and cache store, got key=%d get=%d set=%d", keyBuilder.calls, cacheStore.getCalls, cacheStore.setCalls)
	}
	if got := rr.Header().Get("X-GateLM-Cache-Status"); got != "bypass" {
		t.Fatalf("expected cache bypass header, got %q", got)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.DomainOutcomes.Budget.Outcome != budget.OutcomeBlocked ||
		logged.DomainOutcomes.Cache.Outcome != "bypassed" ||
		logged.DomainOutcomes.Provider.Outcome != "not_called" ||
		logged.DomainOutcomes.Routing.Outcome != "not_checked" {
		t.Fatalf("unexpected budget blocked domain outcomes: %+v", logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerStreamingBudgetBlockNeverStartsStreamOrProvider(t *testing.T) {
	chatCalls := 0
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:must-not-build"}
	cacheStore := &recordingExactCacheStore{}
	logWriter := &recordingTerminalLogWriter{}
	runtimePolicy := pipeline.New(budgetstage.NewStage(handlerBudgetChecker{decision: budget.Decision{
		Allowed: false,
		Outcome: budget.OutcomeBlocked,
		Reason:  "monthly_limit_exceeded",
	}}))
	handler := ChatCompletionsHandler{
		Providers:             provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		RuntimePolicyPipeline: runtimePolicy,
		ExactCacheStore:       cacheStore,
		ExactCacheKeyBuilder:  keyBuilder,
		TerminalLogWriter:     logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionStreamBody("short prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Header().Get("Content-Type"), "text/event-stream") || strings.Contains(rr.Body.String(), "data:") {
		t.Fatalf("budget block must not start streaming, headers=%v body=%q", rr.Header(), rr.Body.String())
	}
	if chatCalls != 0 || keyBuilder.calls != 0 || cacheStore.getCalls != 0 || cacheStore.setCalls != 0 {
		t.Fatalf("budget block must stop before provider/cache, provider=%d key=%d get=%d set=%d", chatCalls, keyBuilder.calls, cacheStore.getCalls, cacheStore.setCalls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if !logged.Stream ||
		logged.DomainOutcomes.Budget.Outcome != budget.OutcomeBlocked ||
		logged.DomainOutcomes.Streaming.Outcome != "not_streaming" ||
		logged.DomainOutcomes.Provider.Outcome != "not_called" {
		t.Fatalf("unexpected streaming budget block outcomes: %+v", logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerPreservesCacheMissAndCallsProvider(t *testing.T) {
	chatCalls := 0
	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.ModelRef = routingdomain.MockBootstrapRef
			gatewayCtx.Routing.CandidateModelRefs = []string{routingdomain.MockBootstrapRef}
			gatewayCtx.Routing.RoutingReason = routingdomain.ReasonMatrixRoute
			gatewayCtx.Cache.CacheStatus = "miss"
			gatewayCtx.Cache.CacheType = "exact"
			gatewayCtx.Cache.CacheKeyHash = "hmac-sha256:cache-key"
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		PreProviderPipeline: preflight,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "short prompt"}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected provider to be called once on cache miss, got %d", chatCalls)
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "miss" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil || resp.GateLM.CacheStatus != "miss" || resp.GateLM.ExecutionMode != "mock" {
		t.Fatalf("unexpected gate_lm cache miss metadata: %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerFailsOpenWhenCacheHitPayloadIsInvalid(t *testing.T) {
	output := captureDefaultLog(t)
	chatCalls := 0
	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.ModelRef = routingdomain.MockBootstrapRef
			gatewayCtx.Routing.CandidateModelRefs = []string{routingdomain.MockBootstrapRef}
			gatewayCtx.Routing.RoutingReason = routingdomain.ReasonMatrixRoute
			gatewayCtx.Cache.CacheStatus = "hit"
			gatewayCtx.Cache.CacheType = "exact"
			gatewayCtx.Cache.CacheKeyHash = "hmac-sha256:cache-key"
			gatewayCtx.Cache.Payload = []byte(`{"unexpected":"shape"}`)
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		PreProviderPipeline: preflight,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "short prompt"}]
	}`))
	req.Header.Set(middleware.RequestIDHeader, "req_cache_decode")
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 1 {
		t.Fatalf("expected provider to be called once after invalid cache payload, got %d", chatCalls)
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "error" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil || resp.GateLM.CacheStatus != "error" || resp.GateLM.ExecutionMode != "mock" {
		t.Fatalf("unexpected gate_lm cache error metadata: %#v", resp.GateLM)
	}

	logged := output.String()
	if !strings.Contains(logged, "gateway cache decode error") {
		t.Fatalf("expected cache decode error log, got %q", logged)
	}
	if !strings.Contains(logged, "request_id=req_cache_decode") || !strings.Contains(logged, "cache_type=exact") {
		t.Fatalf("expected cache decode context in log, got %q", logged)
	}
	if !strings.Contains(logged, "cache_key_hash=hmac-sha256:cache-key") {
		t.Fatalf("expected cache key hash in log, got %q", logged)
	}
	if !strings.Contains(logged, "cached chat completion payload has invalid shape") {
		t.Fatalf("expected sanitized decode error in log, got %q", logged)
	}
	if strings.Contains(logged, "unexpected") {
		t.Fatalf("cache decode log must not include raw cached payload: %q", logged)
	}
}

func TestChatCompletionsHandlerDispatchesByCatalogAdapterTypeAndUsesModelName(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeOpenAICompatible}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 {
		t.Fatalf("expected primary provider call, got %d", primary.calls)
	}
	if primary.lastConfig.AdapterType != providercatalog.AdapterTypeOpenAICompatible {
		t.Fatalf("expected openai-compatible dispatch, got %s", primary.lastConfig.AdapterType)
	}
	if primary.lastConfig.ProviderName != "openai-main" {
		t.Fatalf("expected catalog providerName, got %s", primary.lastConfig.ProviderName)
	}
	if primary.lastConfig.Credential == nil {
		t.Fatal("expected resolved credential")
	}
	if primary.lastRequest.Model != "provider-low" {
		t.Fatalf("expected provider modelName provider-low, got %s", primary.lastRequest.Model)
	}
}

func TestChatCompletionsHandlerUsesLiveRuntimeSnapshotAndProviderCatalog(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.CatalogID = "provider_catalog:" + testAppID + ":1"
	catalog.ContentHash = "sha256:provider-catalog-live-handler-test"
	primary := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeOpenAICompatible}

	controlPlane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin/v1/applications/" + testAppID + "/runtime-snapshot/active":
			writeTestJSON(t, w, http.StatusOK, liveRuntimeSnapshotPayload(catalog.Reference()))
		case "/admin/v1/provider-catalogs/" + catalog.CatalogID:
			writeTestJSON(t, w, http.StatusOK, liveProviderCatalogPayload(catalog))
		default:
			t.Fatalf("unexpected control plane path: %s", r.URL.Path)
		}
	}))
	defer controlPlane.Close()

	runtimeSnapshotProvider := controlplaneruntimeconfig.NewProvider(controlPlane.URL, controlPlane.Client())
	providerCatalogResolver := controlplaneprovidercatalog.NewResolver(controlPlane.URL, controlPlane.Client())
	if _, err := runtimeSnapshotProvider.GetExecutionSnapshot(context.Background(), testTenantID, testProjectID, testAppID); err != nil {
		t.Fatalf("load v2 runtime snapshot fixture: %v", err)
	}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary),
		ProviderCatalogResolver: providerCatalogResolver,
		CredentialResolver:      staticCredentialResolver{},
		RuntimePolicyPipeline:   pipeline.New(runtimeconfigstage.NewStage(runtimeSnapshotProvider)),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("auto", "safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 {
		t.Fatalf("expected primary provider call, got %d", primary.calls)
	}
	if primary.lastConfig.AdapterType != providercatalog.AdapterTypeOpenAICompatible {
		t.Fatalf("expected live catalog adapterType dispatch, got %s", primary.lastConfig.AdapterType)
	}
	if primary.lastConfig.ProviderName != "openai-main" {
		t.Fatalf("expected live catalog providerName, got %s", primary.lastConfig.ProviderName)
	}
	if primary.lastRequest.Model != "provider-low" {
		t.Fatalf("expected provider API modelName provider-low, got %s", primary.lastRequest.Model)
	}
}

func TestChatCompletionsHandlerUsesApplicationRuntimeSnapshotModelForAutoRequests(t *testing.T) {
	appA := "app_policy_a"
	appB := "app_policy_b"
	catalogA := testProviderCatalogWithPrimaryModel(
		"provider_catalog:"+appA+":1",
		"sha256:provider-catalog-app-a",
		"model_app_a",
		"provider-model-a",
	)
	catalogB := testProviderCatalogWithPrimaryModel(
		"provider_catalog:"+appB+":1",
		"sha256:provider-catalog-app-b",
		"model_app_b",
		"provider-model-b",
	)
	primary := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeOpenAICompatible}

	controlPlane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin/v1/applications/" + appA + "/runtime-snapshot/active":
			writeTestJSON(t, w, http.StatusOK, liveRuntimeSnapshotPayloadForApplication(catalogA.Reference(), appA, "model_app_a"))
		case "/admin/v1/applications/" + appB + "/runtime-snapshot/active":
			writeTestJSON(t, w, http.StatusOK, liveRuntimeSnapshotPayloadForApplication(catalogB.Reference(), appB, "model_app_b"))
		case "/admin/v1/provider-catalogs/" + catalogA.CatalogID:
			writeTestJSON(t, w, http.StatusOK, liveProviderCatalogPayload(catalogA))
		case "/admin/v1/provider-catalogs/" + catalogB.CatalogID:
			writeTestJSON(t, w, http.StatusOK, liveProviderCatalogPayload(catalogB))
		default:
			t.Fatalf("unexpected control plane path: %s", r.URL.Path)
		}
	}))
	defer controlPlane.Close()

	runtimeSnapshotProvider := controlplaneruntimeconfig.NewProvider(controlPlane.URL, controlPlane.Client())
	providerCatalogResolver := controlplaneprovidercatalog.NewResolver(controlPlane.URL, controlPlane.Client())
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary),
		ProviderCatalogResolver: providerCatalogResolver,
		CredentialResolver:      staticCredentialResolver{},
		RuntimePolicyPipeline:   pipeline.New(runtimeconfigstage.NewStage(runtimeSnapshotProvider)),
		APIKeyAuthenticator: &mappedAPIKeyAuthenticator{identities: map[string]auth.APIKeyIdentity{
			"api-key-a": {
				APIKeyID:      "api_key_a",
				TenantID:      testTenantID,
				ProjectID:     testProjectID,
				ApplicationID: appA,
			},
			"api-key-b": {
				APIKeyID:      "api_key_b",
				TenantID:      testTenantID,
				ProjectID:     testProjectID,
				ApplicationID: appB,
			},
		}},
	}

	performAutoRequestWithAPIKey(t, &handler, "api-key-a")
	if primary.lastRequest.Model != "provider-model-a" {
		t.Fatalf("expected app A provider modelName provider-model-a, got %s", primary.lastRequest.Model)
	}

	performAutoRequestWithAPIKey(t, &handler, "api-key-b")
	if primary.lastRequest.Model != "provider-model-b" {
		t.Fatalf("expected app B provider modelName provider-model-b, got %s", primary.lastRequest.Model)
	}
}

func TestChatCompletionsHandlerAppliesRuntimeSnapshotDetectorSetToMasking(t *testing.T) {
	catalog := testProviderCatalog()
	catalog.CatalogID = "provider_catalog:" + testAppID + ":1"
	catalog.ContentHash = "sha256:provider-catalog-detector-policy-test"
	primary := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeOpenAICompatible}
	logWriter := &recordingTerminalLogWriter{}
	detectorSet := []map[string]string{
		{"detectorType": "email", "action": "redact"},
		{"detectorType": "phone_number", "action": "allow"},
		{"detectorType": "api_key", "action": "block"},
	}

	controlPlane := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/admin/v1/applications/" + testAppID + "/runtime-snapshot/active":
			writeTestJSON(t, w, http.StatusOK, liveRuntimeSnapshotPayloadWithDetectorSet(catalog.Reference(), detectorSet))
		case "/admin/v1/provider-catalogs/" + catalog.CatalogID:
			writeTestJSON(t, w, http.StatusOK, liveProviderCatalogPayload(catalog))
		default:
			t.Fatalf("unexpected control plane path: %s", r.URL.Path)
		}
	}))
	defer controlPlane.Close()

	runtimeSnapshotProvider := controlplaneruntimeconfig.NewProvider(controlPlane.URL, controlPlane.Client())
	providerCatalogResolver := controlplaneprovidercatalog.NewResolver(controlPlane.URL, controlPlane.Client())
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary),
		ProviderCatalogResolver: providerCatalogResolver,
		CredentialResolver:      staticCredentialResolver{},
		RuntimePolicyPipeline:   pipeline.New(runtimeconfigstage.NewStage(runtimeSnapshotProvider)),
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(&handler)

	prompt := "Contact user@example.invalid or 010-0000-0000."
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("auto", prompt)))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 {
		t.Fatalf("expected one provider call, got %d", primary.calls)
	}
	providerPrompt := recordedProviderPrompt(t, []provider.ChatCompletionRequest{primary.lastRequest})
	if !strings.Contains(providerPrompt, "[EMAIL_1]") {
		t.Fatalf("expected provider prompt to redact email, got %q", providerPrompt)
	}
	if strings.Contains(providerPrompt, "user@example.invalid") {
		t.Fatalf("provider prompt must not include raw email: %q", providerPrompt)
	}
	if !strings.Contains(providerPrompt, "010-0000-0000") {
		t.Fatalf("provider prompt should keep policy-allowed phone value, got %q", providerPrompt)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if strings.Join(logged.MaskingDetectedTypes, ",") != "email" {
		t.Fatalf("expected only email in protected detector types, got %#v", logged.MaskingDetectedTypes)
	}
	if strings.Join(logged.PolicyAllowedTypes, ",") != "phone_number" {
		t.Fatalf("expected phone_number policy allowed type, got %#v", logged.PolicyAllowedTypes)
	}
	if strings.Contains(logged.RedactedPromptPreview, "010-0000-0000") || strings.Contains(logged.RedactedPromptPreview, "user@example.invalid") {
		t.Fatalf("log-safe preview must not include raw policy-allowed or redacted values: %q", logged.RedactedPromptPreview)
	}
	if !strings.Contains(logged.RedactedPromptPreview, "[PHONE_NUMBER_REDACTED]") {
		t.Fatalf("expected log-safe preview to mask policy-allowed phone, got %q", logged.RedactedPromptPreview)
	}
	if strings.Join(logged.DomainOutcomes.Safety.PolicyAllowedTypes, ",") != "phone_number" {
		t.Fatalf("expected safety domain outcome to carry policy allowed type, got %#v", logged.DomainOutcomes)
	}
}

func TestChatCompletionsHandlerRejectsMismatchedProviderCatalogBeforeProviderCall(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeOpenAICompatible}
	fallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	mismatched := testProviderCatalog()
	mismatched.ContentHash = "sha256:different"
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(mismatched),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 0 || fallback.calls != 0 {
		t.Fatalf("catalog mismatch must not call provider or fallback: primary=%d fallback=%d", primary.calls, fallback.calls)
	}
	if !strings.Contains(rr.Body.String(), "provider_catalog_mismatch") {
		t.Fatalf("expected provider_catalog_mismatch response, got %s", rr.Body.String())
	}
}

func TestChatCompletionsHandlerRecordsFallbackSuccessAsDegradedSuccess(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		err:         provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout")),
	}
	fallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected fallback success 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 || fallback.calls != 1 {
		t.Fatalf("expected one primary and one fallback call, got primary=%d fallback=%d", primary.calls, fallback.calls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.Status != invocationlog.StatusSuccess {
		t.Fatalf("expected terminal success, got %s", logged.Status)
	}
	if logged.DomainOutcomes.Provider.Outcome != "success" || logged.DomainOutcomes.Fallback.Outcome != "success" {
		t.Fatalf("unexpected fallback outcomes: %+v", logged.DomainOutcomes)
	}
	if !logged.ProviderCalled || logged.ProviderID != "provider_mock" || logged.ModelID != "mock-fallback-model" || logged.ProviderLatencyMs == nil {
		t.Fatalf("terminal provider attempt must describe the fallback call: %+v", logged)
	}
}

func TestChatCompletionsHandlerAutoFallbackSkipsFailedPrimaryCandidate(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		err:         provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout")),
	}
	fallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	catalog := testProviderCatalog()
	catalog.Providers[0].FallbackEligible = true
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipelineWithoutExplicitFallback("openai-main", "model_low"),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected fallback success 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 || fallback.calls != 1 {
		t.Fatalf("expected one primary and one fallback call, got primary=%d fallback=%d", primary.calls, fallback.calls)
	}
	if fallback.lastRequest.Model != "mock-fallback-model" {
		t.Fatalf("expected fallback modelName mock-fallback-model, got %s", fallback.lastRequest.Model)
	}
}

func TestChatCompletionsHandlerAutoFallbackContinuesThroughOrderedModelRefs(t *testing.T) {
	retryableTimeout := func() error {
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, errors.New("synthetic timeout"))
	}
	primary := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		err:         retryableTimeout(),
	}
	firstFallback := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeMock,
		err:         retryableTimeout(),
	}
	secondFallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeAnthropic}
	catalog := testProviderCatalog()
	catalog.Providers = append(catalog.Providers, providercatalog.Provider{
		ProviderID:       "provider_anthropic_fallback",
		ProviderName:     "anthropic-fallback",
		AdapterType:      providercatalog.AdapterTypeAnthropic,
		Enabled:          true,
		BaseURL:          "https://anthropic.example.test/v1",
		TimeoutMs:        1000,
		FallbackEligible: true,
		AdapterConfig: providercatalog.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatAnthropicMessages,
		},
		Models: []providercatalog.Model{{
			ModelID:     "model_anthropic_fallback",
			ModelName:   "anthropic-fallback-model",
			DisplayName: "Anthropic Fallback",
			Enabled:     true,
		}},
	})
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry(
			"mock",
			primary,
			firstFallback,
			secondFallback,
		),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline: testProviderCatalogPipelineWithCandidates(
			"model_low",
			"model_mock_fallback",
			"model_anthropic_fallback",
		),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected the final ordered fallback to succeed, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 || firstFallback.calls != 1 || secondFallback.calls != 1 {
		t.Fatalf(
			"expected each ordered candidate once, got primary=%d first=%d second=%d",
			primary.calls,
			firstFallback.calls,
			secondFallback.calls,
		)
	}
	if secondFallback.lastRequest.Model != "anthropic-fallback-model" {
		t.Fatalf("expected final fallback model anthropic-fallback-model, got %s", secondFallback.lastRequest.Model)
	}
}

func TestChatCompletionsHandlerAutoFallbackCancellationStopsOrderedCandidates(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		err: provider.NewError(
			provider.ErrorKindTimeout,
			provider.ErrorCodeProviderTimeout,
			errors.New("synthetic timeout"),
		),
	}
	cancelledFallback := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeMock,
		err:         context.Canceled,
	}
	unusedFallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeAnthropic}
	catalog := testProviderCatalog()
	catalog.Providers = append(catalog.Providers, providercatalog.Provider{
		ProviderID:       "provider_anthropic_fallback",
		ProviderName:     "anthropic-fallback",
		AdapterType:      providercatalog.AdapterTypeAnthropic,
		Enabled:          true,
		BaseURL:          "https://anthropic.example.test/v1",
		TimeoutMs:        1000,
		FallbackEligible: true,
		AdapterConfig: providercatalog.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatAnthropicMessages,
		},
		Models: []providercatalog.Model{{
			ModelID:     "model_anthropic_fallback",
			ModelName:   "anthropic-fallback-model",
			DisplayName: "Anthropic Fallback",
			Enabled:     true,
		}},
	})
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry(
			"mock",
			primary,
			cancelledFallback,
			unusedFallback,
		),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline: testProviderCatalogPipelineWithCandidates(
			"model_low",
			"model_mock_fallback",
			"model_anthropic_fallback",
		),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("cancel ordered fallback")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != gatewayerrors.StatusClientClosedRequest {
		t.Fatalf("expected cancelled fallback to return 499, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 || cancelledFallback.calls != 1 || unusedFallback.calls != 0 {
		t.Fatalf(
			"expected cancellation to stop ordered candidates, got primary=%d cancelled=%d unused=%d",
			primary.calls,
			cancelledFallback.calls,
			unusedFallback.calls,
		)
	}
}

func TestChatCompletionsHandlerProviderCancellationDoesNotFallback(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{
		adapterType: providercatalog.AdapterTypeOpenAICompatible,
		err:         context.Canceled,
	}
	fallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		CredentialResolver:      staticCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
		TerminalLogWriter:       logWriter,
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != gatewayerrors.StatusClientClosedRequest {
		t.Fatalf("expected 499, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 1 || fallback.calls != 0 {
		t.Fatalf("expected primary call without fallback, got primary=%d fallback=%d", primary.calls, fallback.calls)
	}
	if len(logWriter.logs) != 1 {
		t.Fatalf("expected one terminal log, got %d", len(logWriter.logs))
	}
	logged := logWriter.logs[0]
	if logged.Status != invocationlog.StatusCancelled || logged.HTTPStatus != gatewayerrors.StatusClientClosedRequest {
		t.Fatalf("expected cancelled terminal log, got status=%s http=%d", logged.Status, logged.HTTPStatus)
	}
	if logged.DomainOutcomes.Provider.Outcome != "cancelled" || logged.DomainOutcomes.Fallback.Outcome != "not_called" {
		t.Fatalf("cancelled provider attempt must be recorded without fallback: %+v", logged.DomainOutcomes)
	}
	if !logged.ProviderCalled || logged.ProviderID != "provider_primary" || logged.ModelID != "provider-low" || logged.ProviderLatencyMs == nil {
		t.Fatalf("cancelled terminal provider attempt is incomplete: %+v", logged)
	}
}

func TestChatCompletionsHandlerCredentialFailureDoesNotCallProviderOrFallback(t *testing.T) {
	primary := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeOpenAICompatible}
	fallback := &catalogRecordingProviderAdapter{adapterType: providercatalog.AdapterTypeMock}
	handler := ChatCompletionsHandler{
		Providers:               provider.NewRegistry("mock", primary, fallback),
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		CredentialResolver:      failingCredentialResolver{},
		PreProviderPipeline:     testProviderCatalogPipeline("openai-main", "model_low"),
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBody("safe prompt")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rr.Code, rr.Body.String())
	}
	if primary.calls != 0 || fallback.calls != 0 {
		t.Fatalf("credential failure must not call provider or fallback: primary=%d fallback=%d", primary.calls, fallback.calls)
	}
	if !strings.Contains(rr.Body.String(), provider.ErrorCodeProviderCredentialUnavailable) {
		t.Fatalf("expected credential unavailable response, got %s", rr.Body.String())
	}
}

func marshalChatCompletionPayload(t *testing.T, resp provider.ChatCompletionResponse) []byte {
	t.Helper()

	payload, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal cached payload: %v", err)
	}
	return payload
}

type nilProviderAdapter struct{}

func (nilProviderAdapter) AdapterType() string {
	return providercatalog.AdapterTypeMock
}

func (nilProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (nilProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	return nil, nil
}

type countingProviderAdapter struct {
	calls *int
}

func (a countingProviderAdapter) AdapterType() string {
	return "mock"
}

func (a countingProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a countingProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	(*a.calls)++
	return &provider.ChatCompletionResponse{}, nil
}

type recordingCostCalculator struct {
	calls       int
	lastRequest costing.Request
	result      costing.Result
	err         error
	ctxErr      error
	hasDeadline bool
}

func (c *recordingCostCalculator) Calculate(ctx context.Context, req costing.Request) (costing.Result, error) {
	if err := ctx.Err(); err != nil {
		return costing.Result{}, err
	}
	c.calls++
	c.lastRequest = req
	c.ctxErr = ctx.Err()
	_, c.hasDeadline = ctx.Deadline()
	return c.result, c.err
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

type recordingProviderAdapter struct {
	calls    *int
	requests *[]provider.ChatCompletionRequest
}

func (a recordingProviderAdapter) AdapterType() string {
	return "mock"
}

func (a recordingProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a recordingProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	if a.calls != nil {
		(*a.calls)++
	}
	if a.requests != nil {
		*a.requests = append(*a.requests, req)
	}

	return &provider.ChatCompletionResponse{
		ID:      "mock_chatcmpl_recording",
		Object:  "chat.completion",
		Created: 1782108000,
		Model:   req.Model,
		Choices: []provider.ChatChoice{
			{
				Index: 0,
				Message: provider.ChatMessage{
					Role:    "assistant",
					Content: json.RawMessage(`"Mock response"`),
				},
				FinishReason: "stop",
			},
		},
		Usage: &provider.Usage{
			PromptTokens:     4,
			CompletionTokens: 3,
			TotalTokens:      7,
		},
	}, nil
}

type staticProviderAdapter struct {
	calls    *int
	response *provider.ChatCompletionResponse
}

func (a staticProviderAdapter) AdapterType() string {
	return "mock"
}

func (a staticProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a staticProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	if a.calls != nil {
		(*a.calls)++
	}
	return a.response, nil
}

func (a staticProviderAdapter) CreateChatCompletionStream(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (provider.ChatCompletionStreamReader, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if a.calls != nil {
		(*a.calls)++
	}
	return streamReaderFromResponse(req.Model, a.response), nil
}

type streamingProviderAdapter struct {
	adapterType    string
	chatCalls      int
	streamCalls    int
	streamRequests []provider.ChatCompletionRequest
	events         []provider.ChatCompletionStreamEvent
	openErr        error
	nextErr        error
	closeCalls     int
}

func (a *streamingProviderAdapter) AdapterType() string {
	if a != nil && a.adapterType != "" {
		return a.adapterType
	}
	return "mock"
}

func (a *streamingProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a *streamingProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	a.chatCalls++
	return &provider.ChatCompletionResponse{}, nil
}

func (a *streamingProviderAdapter) CreateChatCompletionStream(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (provider.ChatCompletionStreamReader, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	a.streamCalls++
	a.streamRequests = append(a.streamRequests, req)
	if a.openErr != nil {
		return nil, a.openErr
	}
	return &recordingStreamReader{
		events:     append([]provider.ChatCompletionStreamEvent(nil), a.events...),
		errAfter:   a.nextErr,
		closeCalls: &a.closeCalls,
	}, nil
}

type recordingStreamReader struct {
	events     []provider.ChatCompletionStreamEvent
	index      int
	errAfter   error
	closeCalls *int
}

func (r *recordingStreamReader) Next() (provider.ChatCompletionStreamEvent, error) {
	if r.index < len(r.events) {
		event := r.events[r.index]
		r.index++
		return event, nil
	}
	if r.errAfter != nil {
		return provider.ChatCompletionStreamEvent{}, r.errAfter
	}
	return provider.ChatCompletionStreamEvent{}, io.EOF
}

func (r *recordingStreamReader) Close() error {
	if r.closeCalls != nil {
		(*r.closeCalls)++
	}
	return nil
}

func streamReaderFromResponse(model string, resp *provider.ChatCompletionResponse) provider.ChatCompletionStreamReader {
	if resp == nil {
		return &recordingStreamReader{}
	}
	if resp.Model == "" {
		resp = cloneChatCompletionResponse(resp)
		resp.Model = model
	}
	chunks := streamingChunks(resp, &pipeline.RequestContext{RequestedModel: "auto"})
	events := make([]provider.ChatCompletionStreamEvent, 0, len(chunks))
	for _, chunk := range chunks {
		payload, _ := json.Marshal(chunk)
		events = append(events, provider.ChatCompletionStreamEvent{Data: json.RawMessage(payload)})
	}
	return &recordingStreamReader{events: events}
}

func cloneChatCompletionResponse(resp *provider.ChatCompletionResponse) *provider.ChatCompletionResponse {
	if resp == nil {
		return nil
	}
	cloned := *resp
	return &cloned
}

func streamEvent(t *testing.T, payload string) provider.ChatCompletionStreamEvent {
	t.Helper()
	raw := json.RawMessage(payload)
	if !json.Valid(raw) {
		t.Fatalf("invalid stream event json: %s", payload)
	}
	var metadata struct {
		Usage *provider.Usage `json:"usage"`
	}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatalf("decode stream event metadata: %v", err)
	}
	return provider.ChatCompletionStreamEvent{
		Data:  append(json.RawMessage(nil), raw...),
		Usage: metadata.Usage,
	}
}

func streamContentEvent(t *testing.T, model string, content string) provider.ChatCompletionStreamEvent {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"id":      "chatcmpl_content",
		"object":  "chat.completion.chunk",
		"created": 1782108000,
		"model":   model,
		"choices": []map[string]any{{
			"index": 0,
			"delta": map[string]any{
				"content": content,
			},
			"finish_reason": nil,
		}},
	})
	if err != nil {
		t.Fatalf("marshal stream content event: %v", err)
	}
	return provider.ChatCompletionStreamEvent{Data: payload}
}

type catalogRecordingProviderAdapter struct {
	adapterType string
	err         error
	calls       int
	lastConfig  provider.ExecutionConfig
	lastRequest provider.ChatCompletionRequest
}

func (a *catalogRecordingProviderAdapter) AdapterType() string {
	return a.adapterType
}

func (a *catalogRecordingProviderAdapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a *catalogRecordingProviderAdapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	a.calls++
	a.lastConfig = config
	a.lastRequest = req
	if a.err != nil {
		return nil, a.err
	}
	return &provider.ChatCompletionResponse{
		ID:      "chatcmpl_catalog_test",
		Object:  "chat.completion",
		Created: 1782108000,
		Model:   req.Model,
		Choices: []provider.ChatChoice{{
			Index: 0,
			Message: provider.ChatMessage{
				Role:    "assistant",
				Content: json.RawMessage(`"catalog response"`),
			},
			FinishReason: "stop",
		}},
		Usage: &provider.Usage{
			PromptTokens:     2,
			CompletionTokens: 2,
			TotalTokens:      4,
		},
	}, nil
}

type staticCredentialResolver struct{}

func (staticCredentialResolver) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	return credentials.Resolved{Value: "test-provider-credential"}, nil
}

type failingCredentialResolver struct{}

func (failingCredentialResolver) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	return credentials.Resolved{}, credentials.ErrUnavailable
}

type cancelingCredentialResolver struct{}

func (cancelingCredentialResolver) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	return credentials.Resolved{}, context.Canceled
}

type mappedAPIKeyAuthenticator struct {
	identities map[string]auth.APIKeyIdentity
}

func (a *mappedAPIKeyAuthenticator) AuthenticateAPIKey(_ context.Context, bearerToken string) (auth.APIKeyIdentity, error) {
	if a == nil {
		return auth.APIKeyIdentity{}, auth.ErrInvalidAPIKey
	}
	identity, ok := a.identities[bearerToken]
	if !ok {
		return auth.APIKeyIdentity{}, auth.ErrInvalidAPIKey
	}
	return identity, nil
}

func testProviderCatalogPipeline(providerName string, modelID string) *fakeGatewayPipeline {
	return &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Runtime.Snapshot = runtimeconfig.RuntimeSnapshotProvenance{
				RuntimeSnapshotID:      "runtime_snapshot_test",
				RuntimeSnapshotVersion: 2,
				ContentHash:            "sha256:runtime-test",
				RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
				ProviderCatalogRef:     testProviderCatalog().Reference(),
			}
			gatewayCtx.Runtime.RoutingPolicy = runtimeconfig.BootstrapRoutingPolicy("routing_policy_catalog_test")
			gatewayCtx.Runtime.HasRoutingPolicy = true
			gatewayCtx.Routing.ModelRef = modelID
			gatewayCtx.Routing.CandidateModelRefs = []string{modelID, "model_mock_fallback"}
			gatewayCtx.Routing.RoutingReason = "catalog_test"
		},
	}
}

func testProviderCatalogPipelineWithoutExplicitFallback(providerName string, modelID string) *fakeGatewayPipeline {
	return &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Runtime.Snapshot = runtimeconfig.RuntimeSnapshotProvenance{
				RuntimeSnapshotID:      "runtime_snapshot_test",
				RuntimeSnapshotVersion: 2,
				ContentHash:            "sha256:runtime-test",
				RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
				ProviderCatalogRef:     testProviderCatalog().Reference(),
			}
			gatewayCtx.Runtime.HasRoutingPolicy = true
			gatewayCtx.Routing.ModelRef = modelID
			gatewayCtx.Routing.CandidateModelRefs = []string{modelID, "model_mock_fallback"}
			gatewayCtx.Routing.RoutingReason = "catalog_test"
		},
	}
}

func testProviderCatalogPipelineWithCandidates(modelRefs ...string) *fakeGatewayPipeline {
	return &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Runtime.Snapshot = runtimeconfig.RuntimeSnapshotProvenance{
				RuntimeSnapshotID:      "runtime_snapshot_test",
				RuntimeSnapshotVersion: 2,
				ContentHash:            "sha256:runtime-test",
				RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
				ProviderCatalogRef:     testProviderCatalog().Reference(),
			}
			gatewayCtx.Runtime.HasRoutingPolicy = true
			if len(modelRefs) > 0 {
				gatewayCtx.Routing.ModelRef = modelRefs[0]
			}
			gatewayCtx.Routing.CandidateModelRefs = append([]string(nil), modelRefs...)
			gatewayCtx.Routing.RoutingReason = "catalog_test"
		},
	}
}

func testProviderCatalog() providercatalog.Catalog {
	return providercatalog.Catalog{
		CatalogID:      "provider_catalog_test",
		CatalogVersion: 1,
		ContentHash:    "sha256:provider-catalog-test",
		Providers: []providercatalog.Provider{
			{
				ProviderID:         "provider_primary",
				ProviderName:       "openai-main",
				AdapterType:        providercatalog.AdapterTypeOpenAICompatible,
				Enabled:            true,
				BaseURL:            "https://provider.example.test/v1",
				TimeoutMs:          1000,
				CredentialRequired: true,
				CredentialRef: &credentials.Ref{
					CredentialRefID:   "credential_ref_test",
					CredentialVersion: 1,
					CredentialState:   credentials.StateActive,
				},
				AdapterConfig: providercatalog.AdapterConfig{
					RequestFormat: providercatalog.RequestFormatOpenAIChatCompletions,
				},
				Models: []providercatalog.Model{{
					ModelID:     "model_low",
					ModelName:   "provider-low",
					DisplayName: "Provider Low",
					Enabled:     true,
					Capabilities: providercatalog.ModelCapabilities{
						StreamingSupported: true,
						SupportsJSONMode:   true,
						MaxInputTokens:     8192,
						MaxOutputTokens:    2048,
					},
					Routing: providercatalog.ModelRouting{
						AutoRoutingEligible: true,
						CostTier:            "low",
						FallbackPriority:    0,
					},
				}},
			},
			{
				ProviderID:         "provider_mock",
				ProviderName:       "mock-fallback",
				AdapterType:        providercatalog.AdapterTypeMock,
				Enabled:            true,
				BaseURL:            "http://mock-provider.test/v1",
				TimeoutMs:          1000,
				CredentialRequired: false,
				AdapterConfig: providercatalog.AdapterConfig{
					RequestFormat: providercatalog.RequestFormatMockChatCompletions,
				},
				FallbackEligible: true,
				Models: []providercatalog.Model{{
					ModelID:     "model_mock_fallback",
					ModelName:   "mock-fallback-model",
					DisplayName: "Mock Fallback",
					Enabled:     true,
					Capabilities: providercatalog.ModelCapabilities{
						StreamingSupported: false,
						SupportsJSONMode:   false,
						MaxInputTokens:     4096,
						MaxOutputTokens:    1024,
					},
					Routing: providercatalog.ModelRouting{
						AutoRoutingEligible: false,
						CostTier:            "low",
						FallbackPriority:    10,
					},
				}},
			},
		},
	}
}

func testProviderCatalogWithPrimaryModel(catalogID string, contentHash string, modelID string, modelName string) providercatalog.Catalog {
	catalog := testProviderCatalog()
	catalog.CatalogID = catalogID
	catalog.ContentHash = contentHash
	catalog.Providers[0].Models[0].ModelID = modelID
	catalog.Providers[0].Models[0].ModelName = modelName
	catalog.Providers[0].Models[0].DisplayName = modelName
	return catalog
}

func performAutoRequestWithAPIKey(t *testing.T, handler *ChatCompletionsHandler, apiKey string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("auto", "safe prompt")))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

type recordingExactKeyBuilder struct {
	calls    int
	key      string
	err      error
	material cachekey.KeyMaterial
}

func (b *recordingExactKeyBuilder) BuildExactKey(ctx context.Context, material cachekey.KeyMaterial) (string, error) {
	b.calls++
	b.material = material
	if b.err != nil {
		return "", b.err
	}
	if b.key == "" {
		return "hmac-sha256:test-cache-key", nil
	}
	return b.key, nil
}

type recordingExactCacheStore struct {
	getCalls int
	setCalls int
	result   ports.CacheLookupResult
	getErr   error
	setErr   error
	entries  []ports.CacheEntry
}

func (s *recordingExactCacheStore) GetExact(ctx context.Context, keyHash string) (ports.CacheLookupResult, error) {
	s.getCalls++
	if s.getErr != nil {
		return ports.CacheLookupResult{}, s.getErr
	}
	return s.result, nil
}

func (s *recordingExactCacheStore) SetExact(ctx context.Context, entry ports.CacheEntry) error {
	s.setCalls++
	if s.setErr != nil {
		return s.setErr
	}
	entry.Payload = append([]byte(nil), entry.Payload...)
	s.entries = append(s.entries, entry)
	return nil
}

type recordingTerminalLogWriter struct {
	logs          []invocationlog.TerminalLog
	err           error
	ctxErr        error
	ctxDoneClosed bool
}

func (w *recordingTerminalLogWriter) WriteTerminalLog(ctx context.Context, log invocationlog.TerminalLog) error {
	if w.err != nil {
		return w.err
	}
	w.ctxErr = ctx.Err()
	select {
	case <-ctx.Done():
		w.ctxDoneClosed = true
	default:
		w.ctxDoneClosed = false
	}
	w.logs = append(w.logs, log)
	return nil
}

type failingAPIKeyAuthenticator struct {
	err error
}

func (a failingAPIKeyAuthenticator) AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error) {
	return auth.APIKeyIdentity{}, a.err
}

type failingAppTokenValidator struct {
	err error
}

func (v failingAppTokenValidator) ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error) {
	return auth.AppTokenIdentity{}, v.err
}

type countingAPIKeyAuthenticator struct {
	calls *int
}

func (a countingAPIKeyAuthenticator) AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error) {
	(*a.calls)++
	return auth.APIKeyIdentity{
		APIKeyID:      testAPIKeyID,
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testAppID,
	}, nil
}

type countingAppTokenValidator struct {
	calls *int
}

func (v countingAppTokenValidator) ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error) {
	(*v.calls)++
	return auth.AppTokenIdentity{
		AppTokenID:    testAppTokenID,
		TenantID:      testTenantID,
		ProjectID:     testProjectID,
		ApplicationID: testAppID,
	}, nil
}

type fakeGatewayPipeline struct {
	err    error
	mutate func(gatewayCtx *request.GatewayContext)
	calls  int
}

func (p *fakeGatewayPipeline) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	p.calls++
	if p.mutate != nil {
		p.mutate(gatewayCtx)
	}
	return p.err
}

type handlerBudgetChecker struct {
	decision budget.Decision
	err      error
}

func (c handlerBudgetChecker) Check(_ context.Context, req budget.Request) (budget.Decision, error) {
	decision := c.decision
	decision.Scope = req.Scope
	decision.Policy = req.Policy
	return decision, c.err
}

func withTestAuth(handler *ChatCompletionsHandler) {
	store := newTestCredentialStore()
	handler.APIKeyAuthenticator = store
	handler.AppTokenValidator = store
	handler.ExpectedTenantID = testTenantID
	handler.ExpectedProjectID = testProjectID
	handler.ExpectedAppID = testAppID
}

func newTestCredentialStore() *auth.StaticCredentialStore {
	return auth.NewStaticCredentialStore(auth.StaticCredentialConfig{
		APIKey:   testAPIKey,
		AppToken: testAppToken,
		APIKeyIdentity: auth.APIKeyIdentity{
			APIKeyID:      testAPIKeyID,
			TenantID:      testTenantID,
			ProjectID:     testProjectID,
			ApplicationID: testAppID,
		},
		AppTokenIdentity: auth.AppTokenIdentity{
			AppTokenID:    testAppTokenID,
			TenantID:      testTenantID,
			ProjectID:     testProjectID,
			ApplicationID: testAppID,
		},
	})
}

func setValidGatewayAuthHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+testAPIKey)
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, status int, payload any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatalf("encode test json: %v", err)
	}
}

func chatCompletionBody(prompt string) string {
	return chatCompletionBodyWithModel("mock-balanced", prompt)
}

func chatCompletionStreamBody(prompt string) string {
	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: "mock-balanced",
		Messages: []provider.ChatMessage{
			{
				Role:    "user",
				Content: json.RawMessage(jsonStringLiteral(prompt)),
			},
		},
		Stream: true,
	})
	if err != nil {
		panic(err)
	}
	return string(body)
}

func chatCompletionBodyWithModel(model string, prompt string) string {
	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: model,
		Messages: []provider.ChatMessage{
			{
				Role:    "user",
				Content: json.RawMessage(jsonStringLiteral(prompt)),
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return string(body)
}

func liveRuntimeSnapshotPayload(ref providercatalog.Reference) map[string]any {
	return map[string]any{
		"schemaVersion":          "gatelm.runtime-snapshot.v2",
		"runtimeSnapshotId":      "runtime_snapshot_live_handler_test",
		"runtimeSnapshotVersion": 2,
		"contentHash":            "hash_runtime_snapshot_live_handler",
		"runtimeState":           runtimeconfig.RuntimeStateSnapshotActive,
		"publishedAt":            "2026-06-30T00:00:00Z",
		"publishedBy":            "control_plane_test",
		"gatewayInstanceId":      "gateway_core_test",
		"lookupKey": map[string]any{
			"tenantId":      testTenantID,
			"projectId":     testProjectID,
			"applicationId": testAppID,
		},
		"budgetResolution": map[string]any{
			"budgetScopeType":         "application",
			"budgetScopeId":           testAppID,
			"resolvedBy":              "default_application",
			"warningThresholdPercent": 80,
		},
		"providerCatalogRef": map[string]any{
			"catalogId":      ref.CatalogID,
			"catalogVersion": ref.CatalogVersion,
			"contentHash":    ref.ContentHash,
		},
		"policies": map[string]any{
			"safety": map[string]any{
				"enabled":             true,
				"mode":                "enforce",
				"requestSideRequired": true,
				"policyHash":          "hash_security_policy_live_handler",
			},
			"routing": liveRuntimeRoutingPolicy("model_low"),
			"cache": map[string]any{
				"exactCacheEnabled": true,
				"semanticCacheMode": "evidence_only",
				"cachePolicyHash":   "hash_cache_policy_live_handler",
			},
			"promptCapture": map[string]any{
				"enabled":  false,
				"mode":     runtimeconfig.PromptCaptureModeDisabled,
				"maxChars": runtimeconfig.PromptCaptureDefaultMaxChars,
			},
			"responseCapture": map[string]any{
				"enabled":  false,
				"mode":     runtimeconfig.ResponseCaptureModeDisabled,
				"maxChars": runtimeconfig.ResponseCaptureDefaultMaxChars,
			},
			"rateLimit": map[string]any{
				"enabled":       false,
				"scope":         "application",
				"windowSeconds": 60,
				"limit":         60,
			},
			"budget": map[string]any{
				"enabled":                 false,
				"enforcementMode":         "disabled",
				"warningThresholdPercent": 80,
			},
			"streaming": map[string]any{
				"enabled":       false,
				"thinSliceOnly": true,
			},
		},
		"legacyHashes": map[string]any{
			"configHash":         "hash_runtime_snapshot_live_handler",
			"securityPolicyHash": "hash_security_policy_live_handler",
			"routingPolicyHash":  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		},
	}
}

func liveRuntimeSnapshotPayloadWithDetectorSet(ref providercatalog.Reference, detectorSet []map[string]string) map[string]any {
	payload := liveRuntimeSnapshotPayload(ref)
	policies := payload["policies"].(map[string]any)
	safety := policies["safety"].(map[string]any)
	safety["detectorSet"] = detectorSet
	return payload
}

func liveRuntimeSnapshotPayloadForApplication(ref providercatalog.Reference, applicationID string, modelID string) map[string]any {
	payload := liveRuntimeSnapshotPayload(ref)
	lookupKey := payload["lookupKey"].(map[string]any)
	lookupKey["applicationId"] = applicationID
	policies := payload["policies"].(map[string]any)
	policies["routing"] = liveRuntimeRoutingPolicy(modelID)
	return payload
}

func liveRuntimeRoutingPolicy(modelRef string) map[string]any {
	cell := func() map[string]any {
		return map[string]any{"modelRefs": []string{modelRef}}
	}
	difficulties := func() map[string]any {
		return map[string]any{"simple": cell(), "complex": cell()}
	}
	return map[string]any{
		"mode":              routingdomain.RoutingPolicyModeAuto,
		"bootstrapState":    routingdomain.BootstrapStateConfigured,
		"routingPolicyHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"routes": map[string]any{
			"general":       difficulties(),
			"code":          difficulties(),
			"translation":   difficulties(),
			"summarization": difficulties(),
			"reasoning":     difficulties(),
		},
	}
}

func TestLiveRuntimeRoutingFixtureIsValid(t *testing.T) {
	payload, err := json.Marshal(liveRuntimeRoutingPolicy("model_low"))
	if err != nil {
		t.Fatalf("marshal live routing fixture: %v", err)
	}
	var policy runtimeconfig.RoutingPolicy
	if err := json.Unmarshal(payload, &policy); err != nil {
		t.Fatalf("decode live routing fixture: %v", err)
	}
	if !runtimeconfig.IsValidRoutingPolicy(policy) {
		t.Fatalf("live routing fixture is invalid: %#v payload=%s", policy, payload)
	}
}

func liveProviderCatalogPayload(catalog providercatalog.Catalog) map[string]any {
	providers := make([]map[string]any, 0, len(catalog.Providers))
	for _, provider := range catalog.Providers {
		models := make([]map[string]any, 0, len(provider.Models))
		for _, model := range provider.Models {
			models = append(models, map[string]any{
				"modelId":     model.ModelID,
				"modelName":   model.ModelName,
				"displayName": model.DisplayName,
				"enabled":     model.Enabled,
				"capabilities": map[string]any{
					"streamingSupported": model.Capabilities.StreamingSupported,
					"supportsJsonMode":   model.Capabilities.SupportsJSONMode,
					"maxInputTokens":     model.Capabilities.MaxInputTokens,
					"maxOutputTokens":    model.Capabilities.MaxOutputTokens,
				},
				"routing": map[string]any{
					"autoRoutingEligible": model.Routing.AutoRoutingEligible,
					"costTier":            model.Routing.CostTier,
					"fallbackPriority":    model.Routing.FallbackPriority,
				},
			})
		}
		var credentialRef any
		if provider.CredentialRef != nil {
			credentialRef = map[string]any{
				"credentialRefId":   provider.CredentialRef.CredentialRefID,
				"credentialVersion": provider.CredentialRef.CredentialVersion,
				"credentialState":   provider.CredentialRef.CredentialState,
			}
		}
		providers = append(providers, map[string]any{
			"providerId":         provider.ProviderID,
			"providerName":       provider.ProviderName,
			"adapterType":        provider.AdapterType,
			"enabled":            provider.Enabled,
			"baseUrl":            provider.BaseURL,
			"timeoutMs":          provider.TimeoutMs,
			"credentialRequired": provider.CredentialRequired,
			"credentialRef":      credentialRef,
			"adapterConfig": map[string]any{
				"requestFormat": provider.AdapterConfig.RequestFormat,
				"apiVersion":    provider.AdapterConfig.APIVersion,
			},
			"fallbackEligible": provider.FallbackEligible,
			"models":           models,
		})
	}
	return map[string]any{
		"catalogId":      catalog.CatalogID,
		"catalogVersion": catalog.CatalogVersion,
		"contentHash":    catalog.ContentHash,
		"updatedAt":      "2026-06-30T00:00:00Z",
		"providers":      providers,
	}
}

func jsonStringLiteral(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

func recordedProviderPrompt(t *testing.T, requests []provider.ChatCompletionRequest) string {
	t.Helper()

	if len(requests) != 1 {
		t.Fatalf("expected one recorded provider request, got %d", len(requests))
	}
	promptText, err := extractTextPrompt(requests[0].Messages)
	if err != nil {
		t.Fatalf("extract provider prompt: %v", err)
	}
	return promptText
}

func decodeChatCompletionResponse(t *testing.T, rr *httptest.ResponseRecorder) provider.ChatCompletionResponse {
	t.Helper()

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return resp
}

func streamedAssistantContent(t *testing.T, body string) string {
	t.Helper()

	var content strings.Builder
	for _, line := range strings.Split(body, "\n") {
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok || data == "" || data == "[DONE]" {
			continue
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			t.Fatalf("decode streaming chunk %q: %v", data, err)
		}
		for _, choice := range chunk.Choices {
			content.WriteString(choice.Delta.Content)
		}
	}
	return content.String()
}

func assertTerminalLogMatchesSuccessResponse(t *testing.T, logged invocationlog.TerminalLog, rr *httptest.ResponseRecorder, resp provider.ChatCompletionResponse) {
	t.Helper()

	if resp.GateLM == nil {
		t.Fatalf("missing gate_lm metadata")
	}
	if logged.RequestID != rr.Header().Get(middleware.RequestIDHeader) || logged.RequestID != resp.GateLM.RequestID {
		t.Fatalf("request id mismatch: log=%q header=%q gate_lm=%q", logged.RequestID, rr.Header().Get(middleware.RequestIDHeader), resp.GateLM.RequestID)
	}
	if logged.CacheStatus != rr.Header().Get("X-GateLM-Cache-Status") || logged.CacheStatus != resp.GateLM.CacheStatus {
		t.Fatalf("cache status mismatch: log=%q header=%q gate_lm=%q", logged.CacheStatus, rr.Header().Get("X-GateLM-Cache-Status"), resp.GateLM.CacheStatus)
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("routing target headers must not be exposed: provider=%q model=%q", rr.Header().Get("X-GateLM-Routed-Provider"), rr.Header().Get("X-GateLM-Routed-Model"))
	}
	if logged.MaskingAction != rr.Header().Get("X-GateLM-Masking-Action") || logged.MaskingAction != resp.GateLM.MaskingAction {
		t.Fatalf("masking action mismatch: log=%q header=%q gate_lm=%q", logged.MaskingAction, rr.Header().Get("X-GateLM-Masking-Action"), resp.GateLM.MaskingAction)
	}
	expectedCost := formatCostMicroUSD(logged.CostMicroUSD)
	if expectedCost != rr.Header().Get("X-GateLM-Estimated-Cost-Usd") || expectedCost != resp.GateLM.EstimatedCostUSD {
		t.Fatalf("cost mismatch: log=%q header=%q gate_lm=%q", expectedCost, rr.Header().Get("X-GateLM-Estimated-Cost-Usd"), resp.GateLM.EstimatedCostUSD)
	}
	if logged.LatencyMs < 0 || resp.GateLM.LatencyMs < 0 {
		t.Fatalf("latency must not be negative: log=%d gate_lm=%d", logged.LatencyMs, resp.GateLM.LatencyMs)
	}
	if resp.Usage == nil {
		t.Fatalf("missing usage metadata")
	}
	if logged.PromptTokens != resp.Usage.PromptTokens || logged.CompletionTokens != resp.Usage.CompletionTokens || logged.TotalTokens != resp.Usage.TotalTokens {
		t.Fatalf("usage mismatch: log=%+v response=%+v", logged, resp.Usage)
	}
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func assertTerminalLogMatchesBlockedResponse(t *testing.T, logged invocationlog.TerminalLog, rr *httptest.ResponseRecorder) {
	t.Helper()

	if logged.RequestID != rr.Header().Get(middleware.RequestIDHeader) {
		t.Fatalf("request id mismatch: log=%q header=%q", logged.RequestID, rr.Header().Get(middleware.RequestIDHeader))
	}
	if logged.CacheStatus != rr.Header().Get("X-GateLM-Cache-Status") {
		t.Fatalf("cache status mismatch: log=%q header=%q", logged.CacheStatus, rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if logged.MaskingAction != rr.Header().Get("X-GateLM-Masking-Action") {
		t.Fatalf("masking action mismatch: log=%q header=%q", logged.MaskingAction, rr.Header().Get("X-GateLM-Masking-Action"))
	}
	expectedCost := formatCostMicroUSD(logged.CostMicroUSD)
	if expectedCost != rr.Header().Get("X-GateLM-Estimated-Cost-Usd") {
		t.Fatalf("cost mismatch: log=%q header=%q", expectedCost, rr.Header().Get("X-GateLM-Estimated-Cost-Usd"))
	}
}

func assertTerminalLogMatchesGatewayErrorResponse(t *testing.T, logged invocationlog.TerminalLog, rr *httptest.ResponseRecorder, resp gatewayErrorResponse) {
	t.Helper()

	if logged.RequestID != rr.Header().Get(middleware.RequestIDHeader) || logged.RequestID != resp.Error.RequestID {
		t.Fatalf("request id mismatch: log=%q header=%q error=%q", logged.RequestID, rr.Header().Get(middleware.RequestIDHeader), resp.Error.RequestID)
	}
	if logged.HTTPStatus != rr.Code {
		t.Fatalf("http status mismatch: log=%d response=%d", logged.HTTPStatus, rr.Code)
	}
	if logged.ErrorCode != resp.Error.Code || logged.ErrorMessage != resp.Error.Message {
		t.Fatalf("error mismatch: log=%+v response=%+v", logged, resp.Error)
	}
	if logged.CacheStatus != rr.Header().Get("X-GateLM-Cache-Status") {
		t.Fatalf("cache status mismatch: log=%q header=%q", logged.CacheStatus, rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if logged.MaskingAction != rr.Header().Get("X-GateLM-Masking-Action") {
		t.Fatalf("masking action mismatch: log=%q header=%q", logged.MaskingAction, rr.Header().Get("X-GateLM-Masking-Action"))
	}
	expectedCost := formatCostMicroUSD(logged.CostMicroUSD)
	if expectedCost != rr.Header().Get("X-GateLM-Estimated-Cost-Usd") {
		t.Fatalf("cost mismatch: log=%q header=%q", expectedCost, rr.Header().Get("X-GateLM-Estimated-Cost-Usd"))
	}
}

func assertGatewayErrorCode(t *testing.T, rr *httptest.ResponseRecorder, expected string) {
	t.Helper()

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != expected {
		t.Fatalf("expected error code %s, got %s", expected, resp.Error.Code)
	}
}

func captureDefaultLog(t *testing.T) *bytes.Buffer {
	t.Helper()

	var output bytes.Buffer
	oldOutput := log.Writer()
	oldFlags := log.Flags()
	oldPrefix := log.Prefix()
	log.SetOutput(&output)
	log.SetFlags(0)
	log.SetPrefix("")
	t.Cleanup(func() {
		log.SetOutput(oldOutput)
		log.SetFlags(oldFlags)
		log.SetPrefix(oldPrefix)
	})

	return &output
}
