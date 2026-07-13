package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/pipeline"
	routingstage "gatelm/apps/gateway-core/internal/pipeline/stages/routing"
)

func TestChatCompletionsV2AutoResponseDoesNotExposeResolvedTarget(t *testing.T) {
	t.Parallel()
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{}),
	}
	withTestAuth(&handler)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("auto", "Explain OAuth briefly.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "selectedProvider") || strings.Contains(rr.Body.String(), "selectedModel") {
		t.Fatalf("resolved target leaked into public response: %s", rr.Body.String())
	}
	if rr.Header().Get("X-GateLM-Routed-Provider") != "" || rr.Header().Get("X-GateLM-Routed-Model") != "" {
		t.Fatalf("resolved target leaked into public headers: %#v", rr.Header())
	}
	var response provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Model != "auto" || response.GateLM == nil || response.GateLM.ExecutionMode != "mock" {
		t.Fatalf("unexpected public routing response: %#v", response)
	}
}

func TestSanitizeProviderStreamPayloadRemovesResolvedTargetFields(t *testing.T) {
	payload := json.RawMessage(`{
		"id":"chatcmpl_target_redaction",
		"object":"chat.completion.chunk",
		"model":"actual-secret-model",
		"provider":"actual-secret-provider",
		"providerName":"actual-secret-provider",
		"modelId":"actual-secret-model",
		"selected_provider":"actual-secret-provider",
		"selectedModel":"actual-secret-model",
		"metadata":{"providerId":"actual-secret-provider","model_id":"actual-secret-model"},
		"gate_lm":{"terminalStatus":"provisional","domainOutcomes":{"provider":{"outcome":"success"}}},
		"choices":[{"index":0,"delta":{"content":"safe"},"finish_reason":null}]
	}`)
	reqCtx := &pipeline.RequestContext{
		RequestedModel:   "auto",
		PromptCategory:   routing.CategoryCode,
		PromptDifficulty: routing.DifficultyComplex,
		ModelRef:         "opaque-route-ref",
		RoutingReason:    routing.ReasonMatrixRoute,
		ResolvedTarget: routing.ResolvedTarget{
			ProviderID: "actual-secret-provider",
			ModelID:    "actual-secret-model",
		},
		ResolvedProviderName:   "actual-secret-provider",
		ResolvedAdapterType:    "openai_compatible",
		ProviderAttemptStarted: true,
	}

	safe, err := sanitizeProviderStreamPayload(payload, reqCtx)
	if err != nil {
		t.Fatalf("sanitize provider stream payload: %v", err)
	}
	encoded := string(safe)
	for _, forbidden := range []string{
		"actual-secret-provider",
		"actual-secret-model",
		"selected_provider",
		"selectedModel",
		"terminalStatus",
		"domainOutcomes",
	} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("stream payload leaked forbidden target field %q: %s", forbidden, encoded)
		}
	}
	for _, expected := range []string{
		`"model":"auto"`,
		`"category":"code"`,
		`"difficulty":"complex"`,
		`"modelRef":"opaque-route-ref"`,
		`"routingReason":"category_difficulty_matrix"`,
		`"providerCalled":true`,
	} {
		if !strings.Contains(encoded, expected) {
			t.Fatalf("stream payload is missing safe routing metadata %q: %s", expected, encoded)
		}
	}
}

func TestChatCompletionsV2ManualRejectsAutoAndAcceptsExplicitModelRef(t *testing.T) {
	t.Parallel()
	policy := runtimeconfig.BootstrapRoutingPolicy("manual_policy_v2_test")
	policy.Mode = routing.RoutingPolicyModeManual
	router := routing.NewSimpleRouter(policy.SimpleRouterConfig())
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", recordingProviderAdapter{}),
		PreProviderPipeline: pipeline.New(routingstage.NewStage(router)),
	}
	withTestAuth(&handler)

	autoReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("auto", "Hello")))
	setValidGatewayAuthHeaders(autoReq)
	autoRR := httptest.NewRecorder()
	handler.ServeHTTP(autoRR, autoReq)
	if autoRR.Code != http.StatusBadRequest || !strings.Contains(autoRR.Body.String(), `"code":"auto_routing_disabled"`) {
		t.Fatalf("manual mode must reject auto: status=%d body=%s", autoRR.Code, autoRR.Body.String())
	}

	explicitReq := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel(routing.MockBootstrapRef, "Hello")))
	setValidGatewayAuthHeaders(explicitReq)
	explicitRR := httptest.NewRecorder()
	handler.ServeHTTP(explicitRR, explicitReq)
	if explicitRR.Code != http.StatusOK {
		t.Fatalf("manual explicit modelRef must work: status=%d body=%s", explicitRR.Code, explicitRR.Body.String())
	}
}

func TestChatCompletionsV2MissingModelUsesAutoRouting(t *testing.T) {
	t.Parallel()
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{}),
	}
	withTestAuth(&handler)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"messages": [{"role": "user", "content": "Explain OAuth briefly."}]
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var response provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Model != "auto" || response.GateLM == nil || response.GateLM.RequestedModel != "auto" {
		t.Fatalf("missing model must use auto routing: %#v", response)
	}
}

func TestChatCompletionsV2EmptyModelUsesAutoMode(t *testing.T) {
	t.Parallel()
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{}),
	}
	withTestAuth(&handler)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("", "Explain OAuth briefly.")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("empty model should use auto routing: status=%d body=%s", rr.Code, rr.Body.String())
	}
	var response provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Model != "auto" {
		t.Fatalf("empty model must be represented as auto, got %q", response.Model)
	}
}

func TestChatCompletionsV2ManualRejectsEmptyModelAsAuto(t *testing.T) {
	t.Parallel()
	policy := runtimeconfig.BootstrapRoutingPolicy("manual_empty_model_policy_v2_test")
	policy.Mode = routing.RoutingPolicyModeManual
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", recordingProviderAdapter{}),
		PreProviderPipeline: pipeline.New(routingstage.NewStage(routing.NewSimpleRouter(policy.SimpleRouterConfig()))),
	}
	withTestAuth(&handler)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(chatCompletionBodyWithModel("", "Hello")))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), `"code":"auto_routing_disabled"`) {
		t.Fatalf("manual mode must reject empty model as auto: status=%d body=%s", rr.Code, rr.Body.String())
	}
}
