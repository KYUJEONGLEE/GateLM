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
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/http/middleware"
	"gatelm/apps/gateway-core/internal/pipeline"
	"gatelm/apps/gateway-core/internal/pipeline/stages/authenticate"
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
	handler := ChatCompletionsHandler{
		Providers:       provider.NewRegistry("nil-provider", nilProviderAdapter{}),
		DefaultModel:    "mock-balanced",
		DefaultProvider: "nil-provider",
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
			handler := ChatCompletionsHandler{
				Providers: provider.NewRegistry("mock", recordingProviderAdapter{
					calls:    &chatCalls,
					requests: &providerRequests,
				}),
				DefaultModel:    "mock-balanced",
				DefaultProvider: "mock",
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

			var resp provider.ChatCompletionResponse
			if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if resp.GateLM == nil || resp.GateLM.MaskingAction != "redacted" {
				t.Fatalf("expected redacted gate_lm masking metadata, got %#v", resp.GateLM)
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
