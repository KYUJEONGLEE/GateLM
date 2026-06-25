package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/domain/auth"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/middleware"
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
