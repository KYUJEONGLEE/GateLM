package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/domain/auth"
	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/invocationlog"
	maskdomain "gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/pipeline/stages/authenticate"
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
		Providers:       registry,
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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
	if rr.Header().Get("X-GateLM-Routed-Provider") != "mock" {
		t.Fatalf("unexpected routed provider header: %s", rr.Header().Get("X-GateLM-Routed-Provider"))
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GateLM == nil {
		t.Fatalf("missing gate_lm metadata")
	}
	if resp.GateLM.SelectedProvider != "mock" {
		t.Fatalf("unexpected selected provider metadata: %s", resp.GateLM.SelectedProvider)
	}
}

func TestChatCompletionsHandlerWritesTerminalLogForSuccess(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
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
	if logged.SelectedProvider != "mock" || logged.SelectedModel != "mock-balanced" {
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
	if logged.RequestBodyHash == "" || logged.PromptHash == "" {
		t.Fatalf("expected request and prompt hashes: %+v", logged)
	}
}

func TestChatCompletionsHandlerWritesDay4CIdentityAndRoutingMetadata(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
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
	if logged.APIKeyID != testAPIKeyID || logged.AppTokenID != testAppTokenID {
		t.Fatalf("unexpected key/token metadata: %+v", logged)
	}
	if logged.EndUserID != "user_demo_001" || logged.FeatureID != "support-reply" {
		t.Fatalf("unexpected end user/feature metadata: %+v", logged)
	}
	if logged.RequestedModel != "auto" {
		t.Fatalf("expected requested model auto, got %q", logged.RequestedModel)
	}
	if logged.SelectedProvider != "mock" || logged.SelectedModel != "mock-fast" || logged.RoutingReason != "short_prompt_low_cost" {
		t.Fatalf("unexpected routing metadata: %+v", logged)
	}
	if logged.Provider != "mock" || logged.Model != "mock-fast" {
		t.Fatalf("unexpected provider/model metadata: %+v", logged)
	}
}

func TestChatCompletionsHandlerTerminalLogIgnoresRequestCancellation(t *testing.T) {
	logWriter := &recordingTerminalLogWriter{}
	handler := ChatCompletionsHandler{
		Providers:         provider.NewRegistry("mock", recordingProviderAdapter{}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
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

func TestChatCompletionsHandlerRejectsStreaming(t *testing.T) {
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock"),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
	}
	withTestAuth(&handler)

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": true
	}`))
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "streaming_not_supported" {
		t.Fatalf("unexpected error code: %s", resp.Error.Code)
	}
}

func TestChatCompletionsHandlerAuthenticatesBeforeRejectingStreaming(t *testing.T) {
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock"),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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
		Providers:       provider.NewRegistry("mock"),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected auth to run before message validation, got %d: %s", rr.Code, rr.Body.String())
	}
	assertGatewayErrorCode(t, rr, "invalid_app_token")
}

func TestChatCompletionsHandlerRejectsMissingProviderRegistry(t *testing.T) {
	handler := ChatCompletionsHandler{
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
	}
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
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
		Providers:         provider.NewRegistry("nil-provider", nilProviderAdapter{}),
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "nil-provider",
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
	if logged.Status != invocationlog.StatusError || logged.HTTPStatus != http.StatusBadGateway {
		t.Fatalf("unexpected provider error log status: %+v", logged)
	}
	if logged.ErrorCode != "provider_error" || logged.ErrorStage != "call_provider_with_timeout_retry_fallback" {
		t.Fatalf("unexpected provider error fields: %+v", logged)
	}
	if logged.SelectedProvider != "nil-provider" || logged.SelectedModel != "mock-balanced" {
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
				DefaultModel:        "mock-balanced",
				DefaultProvider:     "mock",
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
		Providers:       provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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

func TestChatCompletionsHandlerRejectsInvalidAppTokenBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "invalid_app_token")
}

func TestChatCompletionsHandlerRejectsMissingAppTokenBeforeAPIKeyLookup(t *testing.T) {
	apiKeyCalls := 0
	appTokenCalls := 0
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: countingAPIKeyAuthenticator{calls: &apiKeyCalls},
		AppTokenValidator:   countingAppTokenValidator{calls: &appTokenCalls},
		ExpectedTenantID:    testTenantID,
		ExpectedProjectID:   testProjectID,
		ExpectedAppID:       testAppID,
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
	req.Header.Set("Authorization", "Bearer "+testAPIKey)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiKeyCalls != 0 {
		t.Fatalf("expected no API key authenticator calls, got %d", apiKeyCalls)
	}
	if appTokenCalls != 0 {
		t.Fatalf("expected no app token validator calls, got %d", appTokenCalls)
	}
	if chatCalls != 0 {
		t.Fatalf("expected no provider calls, got %d", chatCalls)
	}
	assertGatewayErrorCode(t, rr, "invalid_app_token")
}

func TestChatCompletionsHandlerReturnsInternalErrorForAPIKeyStoreFailure(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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

func TestChatCompletionsHandlerReturnsInternalErrorForAppTokenStoreFailure(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: store,
		AppTokenValidator:   failingAppTokenValidator{err: errors.New("credential store unavailable")},
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
				DefaultModel:        "mock-balanced",
				DefaultProvider:     "mock",
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
			gatewayCtx.Routing.SelectedProvider = "mock"
			gatewayCtx.Routing.SelectedModel = "mock-fast"
			gatewayCtx.Routing.RoutingReason = "short_prompt_low_cost"
			gatewayCtx.Cache.CacheStatus = invocationlog.CacheStatusBypass
			gatewayCtx.Cache.CacheType = invocationlog.CacheTypeNone
			gatewayCtx.Masking.Action = "none"
			gatewayCtx.Masking.RedactedPromptPreview = "Summarize safe pipeline failure input."
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", recordingProviderAdapter{}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
	if logged.Status != invocationlog.StatusError || logged.HTTPStatus != http.StatusInternalServerError {
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
			ProjectID:     testProjectID,
			ApplicationID: testAppID,
		},
		AppTokenIdentity: auth.AppTokenIdentity{
			AppTokenID:    testAppTokenID,
			TenantID:      testTenantID,
			ProjectID:     "other_project",
			ApplicationID: testAppID,
		},
	})
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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

func TestChatCompletionsHandlerDoesNotMaskAppTokenDeadlineExceeded(t *testing.T) {
	chatCalls := 0
	store := newTestCredentialStore()
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: store,
		AppTokenValidator:   failingAppTokenValidator{err: context.DeadlineExceeded},
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

func TestChatCompletionsHandlerUsesPipelineRouteAndContextMetadata(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		if req.Model != "mock-fast" {
			t.Fatalf("expected routed model mock-fast, got %s", req.Model)
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
			gatewayCtx.Routing.SelectedProvider = "mock"
			gatewayCtx.Routing.SelectedModel = "mock-fast"
			gatewayCtx.Routing.RoutingReason = "short_prompt_low_cost"
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
	if rr.Header().Get("X-GateLM-Routed-Model") != "mock-fast" {
		t.Fatalf("unexpected routed model header: %s", rr.Header().Get("X-GateLM-Routed-Model"))
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
	if resp.GateLM.SelectedModel != "mock-fast" || resp.GateLM.RoutingReason != "short_prompt_low_cost" {
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
			placeholder: "[EMAIL_REDACTED]",
		},
		{
			name:        "phone",
			prompt:      "Write a safe reply asking them to call 010-0000-0000 tomorrow.",
			rawValue:    "010-0000-0000",
			placeholder: "[PHONE_NUMBER_REDACTED]",
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
				DefaultModel:      "mock-balanced",
				DefaultProvider:   "mock",
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
				Providers:       provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
				DefaultModel:    "mock-balanced",
				DefaultProvider: "mock",
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
		DefaultModel:      "mock-balanced",
		DefaultProvider:   "mock",
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

func TestChatCompletionsHandlerSameSafeRequestMissThenHit(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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
	}, redactedPrompt, maskdomain.DefaultSecurityPolicyVersionID)

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
		RequestID:        "provider_request_should_not_be_cached",
		SelectedProvider: "provider",
		SelectedModel:    "provider-model",
		CacheStatus:      "provider-cache",
		MaskingAction:    "provider-mask",
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
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
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
	reqCtx.SelectedProvider = "mock"
	reqCtx.SelectedModel = "mock-balanced"
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

	payload, hitRequestID, hit := handler.lookupExactCache(
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
	reqCtx.SelectedProvider = "mock"
	reqCtx.SelectedModel = "mock-balanced"
	reqCtx.RoutingPolicyHash = "hash_routing_policy_test"
	reqCtx.SecurityPolicyHash = "hash_security_policy_test"
	reqCtx.SecurityPolicyVersionID = maskdomain.DefaultSecurityPolicyVersionID
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:cache-key"}
	handler := ChatCompletionsHandler{
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
	if keyBuilder.material.SecurityPolicyVersionID != "hash_security_policy_test" {
		t.Fatalf("expected runtime security hash in cache material, got %#v", keyBuilder.material)
	}
	if keyBuilder.material.RoutingPolicyVersionID != "hash_routing_policy_test" {
		t.Fatalf("expected runtime routing hash in cache material, got %#v", keyBuilder.material)
	}
}

func TestChatCompletionsHandlerFallsBackToProviderWhenCachedPayloadIsInvalid(t *testing.T) {
	chatCalls := 0
	handler := ChatCompletionsHandler{
		Providers: provider.NewRegistry("mock", recordingProviderAdapter{
			calls: &chatCalls,
		}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
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
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
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
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
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
	if resp.GateLM.CacheStatus != "hit" || resp.GateLM.SelectedProvider != "mock" || resp.GateLM.SelectedModel != "mock-balanced" {
		t.Fatalf("unexpected gate_lm cache/routing metadata: %#v", resp.GateLM)
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
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
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
	if logged.Status != invocationlog.StatusCacheHit || logged.CacheStatus != invocationlog.CacheStatusHit {
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
			gatewayCtx.Routing.SelectedProvider = "mock"
			gatewayCtx.Routing.SelectedModel = "mock-fast"
			gatewayCtx.Routing.RoutingReason = "short_prompt_low_cost"
			gatewayCtx.Cache.CacheStatus = "hit"
			gatewayCtx.Cache.CacheType = "exact"
			gatewayCtx.Cache.CacheKeyHash = "hmac-sha256:cache-key"
			gatewayCtx.Cache.CacheHitRequestID = "request_previous"
			gatewayCtx.Cache.Payload = cachedPayload
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
	if rr.Header().Get("X-GateLM-Routed-Model") != "mock-fast" {
		t.Fatalf("unexpected routed model header: %s", rr.Header().Get("X-GateLM-Routed-Model"))
	}

	var resp provider.ChatCompletionResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ID != "cached_chatcmpl_previous" || resp.Object != "chat.completion" {
		t.Fatalf("unexpected cached response shape: %#v", resp)
	}
	if resp.Model != "mock-fast" {
		t.Fatalf("expected cached response model to use routed model, got %s", resp.Model)
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
	if resp.GateLM.CacheStatus != "hit" || resp.GateLM.SelectedModel != "mock-fast" || resp.GateLM.EstimatedCostUSD != "0.000000" {
		t.Fatalf("unexpected gate_lm cache metadata: %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerBypassesCacheForBlockedRequestBeforeKeyBuilderAndStore(t *testing.T) {
	chatCalls := 0
	keyBuilder := &recordingExactKeyBuilder{key: "hmac-sha256:must-not-build"}
	cacheStore := &recordingExactCacheStore{}
	handler := ChatCompletionsHandler{
		Providers:            provider.NewRegistry("mock", recordingProviderAdapter{calls: &chatCalls}),
		DefaultModel:         "mock-balanced",
		DefaultProvider:      "mock",
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

func TestChatCompletionsHandlerPreservesCacheMissAndCallsProvider(t *testing.T) {
	chatCalls := 0
	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.SelectedProvider = "mock"
			gatewayCtx.Routing.SelectedModel = "mock-fast"
			gatewayCtx.Routing.RoutingReason = "short_prompt_low_cost"
			gatewayCtx.Cache.CacheStatus = "miss"
			gatewayCtx.Cache.CacheType = "exact"
			gatewayCtx.Cache.CacheKeyHash = "hmac-sha256:cache-key"
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
	if resp.GateLM == nil || resp.GateLM.CacheStatus != "miss" || resp.GateLM.SelectedModel != "mock-fast" {
		t.Fatalf("unexpected gate_lm cache miss metadata: %#v", resp.GateLM)
	}
}

func TestChatCompletionsHandlerFailsOpenWhenCacheHitPayloadIsInvalid(t *testing.T) {
	output := captureDefaultLog(t)
	chatCalls := 0
	preflight := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *request.GatewayContext) {
			gatewayCtx.Routing.SelectedProvider = "mock"
			gatewayCtx.Routing.SelectedModel = "mock-fast"
			gatewayCtx.Routing.RoutingReason = "short_prompt_low_cost"
			gatewayCtx.Cache.CacheStatus = "hit"
			gatewayCtx.Cache.CacheType = "exact"
			gatewayCtx.Cache.CacheKeyHash = "hmac-sha256:cache-key"
			gatewayCtx.Cache.Payload = []byte(`{"unexpected":"shape"}`)
		},
	}
	handler := ChatCompletionsHandler{
		Providers:           provider.NewRegistry("mock", countingProviderAdapter{calls: &chatCalls}),
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
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
	if resp.GateLM == nil || resp.GateLM.CacheStatus != "error" || resp.GateLM.SelectedModel != "mock-fast" {
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

func marshalChatCompletionPayload(t *testing.T, resp provider.ChatCompletionResponse) []byte {
	t.Helper()

	payload, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal cached payload: %v", err)
	}
	return payload
}

type nilProviderAdapter struct{}

func (nilProviderAdapter) Name() string {
	return "nil-provider"
}

func (nilProviderAdapter) ListModels(ctx context.Context) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (nilProviderAdapter) CreateChatCompletion(ctx context.Context, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	return nil, nil
}

type countingProviderAdapter struct {
	calls *int
}

func (a countingProviderAdapter) Name() string {
	return "mock"
}

func (a countingProviderAdapter) ListModels(ctx context.Context) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a countingProviderAdapter) CreateChatCompletion(ctx context.Context, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	(*a.calls)++
	return &provider.ChatCompletionResponse{}, nil
}

type recordingProviderAdapter struct {
	calls    *int
	requests *[]provider.ChatCompletionRequest
}

func (a recordingProviderAdapter) Name() string {
	return "mock"
}

func (a recordingProviderAdapter) ListModels(ctx context.Context) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a recordingProviderAdapter) CreateChatCompletion(ctx context.Context, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
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

func (a staticProviderAdapter) Name() string {
	return "mock"
}

func (a staticProviderAdapter) ListModels(ctx context.Context) (*provider.ModelListResponse, error) {
	return &provider.ModelListResponse{}, nil
}

func (a staticProviderAdapter) CreateChatCompletion(ctx context.Context, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	if a.calls != nil {
		(*a.calls)++
	}
	return a.response, nil
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
	req.Header.Set("X-GateLM-App-Token", testAppToken)
}

func chatCompletionBody(prompt string) string {
	body, err := json.Marshal(provider.ChatCompletionRequest{
		Model: "mock-balanced",
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
	if logged.SelectedProvider != rr.Header().Get("X-GateLM-Routed-Provider") || logged.SelectedProvider != resp.GateLM.SelectedProvider {
		t.Fatalf("selected provider mismatch: log=%q header=%q gate_lm=%q", logged.SelectedProvider, rr.Header().Get("X-GateLM-Routed-Provider"), resp.GateLM.SelectedProvider)
	}
	if logged.SelectedModel != rr.Header().Get("X-GateLM-Routed-Model") || logged.SelectedModel != resp.GateLM.SelectedModel {
		t.Fatalf("selected model mismatch: log=%q header=%q gate_lm=%q", logged.SelectedModel, rr.Header().Get("X-GateLM-Routed-Model"), resp.GateLM.SelectedModel)
	}
	if logged.MaskingAction != rr.Header().Get("X-GateLM-Masking-Action") || logged.MaskingAction != resp.GateLM.MaskingAction {
		t.Fatalf("masking action mismatch: log=%q header=%q gate_lm=%q", logged.MaskingAction, rr.Header().Get("X-GateLM-Masking-Action"), resp.GateLM.MaskingAction)
	}
	expectedCost := formatCostMicroUSD(logged.CostMicroUSD)
	if expectedCost != rr.Header().Get("X-GateLM-Estimated-Cost-Usd") || expectedCost != resp.GateLM.EstimatedCostUSD {
		t.Fatalf("cost mismatch: log=%q header=%q gate_lm=%q", expectedCost, rr.Header().Get("X-GateLM-Estimated-Cost-Usd"), resp.GateLM.EstimatedCostUSD)
	}
	if logged.LatencyMs != resp.GateLM.LatencyMs {
		t.Fatalf("latency mismatch: log=%d gate_lm=%d", logged.LatencyMs, resp.GateLM.LatencyMs)
	}
	if resp.Usage == nil {
		t.Fatalf("missing usage metadata")
	}
	if logged.PromptTokens != resp.Usage.PromptTokens || logged.CompletionTokens != resp.Usage.CompletionTokens || logged.TotalTokens != resp.Usage.TotalTokens {
		t.Fatalf("usage mismatch: log=%+v response=%+v", logged, resp.Usage)
	}
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
