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
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
)

func TestChatCompletionsHandlerAuthSafetyRejectsInvalidAPIKeyBeforeProviderCall(t *testing.T) {
	chatCalls, registry, closeServer := authSafetyProviderRegistry(t)
	defer closeServer()

	apiAuth := &fakeAPIKeyAuthenticator{
		err: gatewayerrors.InvalidAPIKey("authenticate_api_key"),
	}
	appValidator := &fakeAppTokenValidator{
		identity: validAppTokenIdentity(),
	}
	handler := ChatCompletionsHandler{
		Providers:           registry,
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: apiAuth,
		AppTokenValidator:   appValidator,
	}

	req := authSafetyRequest()
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assertGatewayError(t, rr, http.StatusUnauthorized, "invalid_api_key")
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if *chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", *chatCalls)
	}
}

func TestChatCompletionsHandlerRejectsMissingAuthorizationBeforeProviderCall(t *testing.T) {
	chatCalls, registry, closeServer := authSafetyProviderRegistry(t)
	defer closeServer()

	apiAuth := &fakeAPIKeyAuthenticator{
		identity: validAPIKeyIdentity(),
	}
	appValidator := &fakeAppTokenValidator{
		identity: validAppTokenIdentity(),
	}
	handler := ChatCompletionsHandler{
		Providers:           registry,
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: apiAuth,
		AppTokenValidator:   appValidator,
	}

	req := authSafetyRequest()
	req.Header.Del("Authorization")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assertGatewayError(t, rr, http.StatusUnauthorized, "invalid_api_key")
	if apiAuth.calls != 0 {
		t.Fatalf("expected API key authenticator not to be called, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if *chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", *chatCalls)
	}
}

func TestChatCompletionsHandlerAuthSafetyIgnoresLegacyAppTokenValidatorBeforeProviderCall(t *testing.T) {
	chatCalls, registry, closeServer := authSafetyProviderRegistry(t)
	defer closeServer()

	apiAuth := &fakeAPIKeyAuthenticator{
		identity: validAPIKeyIdentity(),
	}
	appValidator := &fakeAppTokenValidator{
		err: gatewayerrors.InvalidAppToken("validate_app_token"),
	}
	handler := ChatCompletionsHandler{
		Providers:           registry,
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: apiAuth,
		AppTokenValidator:   appValidator,
	}

	req := authSafetyRequest()
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if *chatCalls != 1 {
		t.Fatalf("expected one mock provider call, got %d", *chatCalls)
	}
}

func TestChatCompletionsHandlerAcceptsProjectAPIKeyWithoutAppToken(t *testing.T) {
	chatCalls, registry, closeServer := authSafetyProviderRegistry(t)
	defer closeServer()

	apiAuth := &fakeAPIKeyAuthenticator{
		identity: validAPIKeyIdentity(),
	}
	appValidator := &fakeAppTokenValidator{
		identity: validAppTokenIdentity(),
	}
	handler := ChatCompletionsHandler{
		Providers:           registry,
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: apiAuth,
		AppTokenValidator:   appValidator,
	}

	req := authSafetyRequest()
	req.Header.Del("X-GateLM-App-Token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if *chatCalls != 1 {
		t.Fatalf("expected one mock provider call, got %d", *chatCalls)
	}
}

func TestChatCompletionsHandlerAuthSafetyRejectsScopeMismatchBeforeProviderCall(t *testing.T) {
	chatCalls, registry, closeServer := authSafetyProviderRegistry(t)
	defer closeServer()

	apiAuth := &fakeAPIKeyAuthenticator{
		identity: auth.APIKeyIdentity{
			APIKeyID:      "api_key_demo",
			TenantID:      "tenant_demo",
			ProjectID:     "other_project",
			ApplicationID: "app_demo",
		},
	}
	appValidator := &fakeAppTokenValidator{
		identity: validAppTokenIdentity(),
	}
	handler := ChatCompletionsHandler{
		Providers:           registry,
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: apiAuth,
		AppTokenValidator:   appValidator,
		ExpectedProjectID:   "project_demo",
	}

	req := authSafetyRequest()
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assertGatewayError(t, rr, http.StatusForbidden, "scope_mismatch")
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if *chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", *chatCalls)
	}
}

func TestChatCompletionsHandlerCallsProviderWithValidAuth(t *testing.T) {
	chatCalls, registry, closeServer := authSafetyProviderRegistry(t)
	defer closeServer()

	apiAuth := &fakeAPIKeyAuthenticator{
		identity: validAPIKeyIdentity(),
	}
	appValidator := &fakeAppTokenValidator{
		identity: validAppTokenIdentity(),
	}
	handler := ChatCompletionsHandler{
		Providers:           registry,
		DefaultModel:        "mock-balanced",
		DefaultProvider:     "mock",
		APIKeyAuthenticator: apiAuth,
		AppTokenValidator:   appValidator,
	}

	req := authSafetyRequest()
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if apiAuth.bearerToken != "glm_api_test_redacted" {
		t.Fatalf("unexpected bearer token passed to authenticator: %s", apiAuth.bearerToken)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if *chatCalls != 1 {
		t.Fatalf("expected one mock provider call, got %d", *chatCalls)
	}
}

func authSafetyProviderRegistry(t *testing.T) (*int, *provider.Registry, func()) {
	t.Helper()

	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chatCalls++
		writeJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_auth_safety",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   "mock-balanced",
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

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	return &chatCalls, registry, mockServer.Close
}

func authSafetyRequest() *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	return req
}

func assertGatewayError(t *testing.T, rr *httptest.ResponseRecorder, expectedStatus int, expectedCode string) {
	t.Helper()

	if rr.Code != expectedStatus {
		t.Fatalf("expected %d, got %d: %s", expectedStatus, rr.Code, rr.Body.String())
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
		t.Fatalf("expected cache bypass header, got %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if rr.Header().Get("X-GateLM-Masking-Action") != "none" {
		t.Fatalf("expected masking none header, got %s", rr.Header().Get("X-GateLM-Masking-Action"))
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != expectedCode {
		t.Fatalf("expected error code %s, got %s", expectedCode, resp.Error.Code)
	}
}

func validAPIKeyIdentity() auth.APIKeyIdentity {
	return auth.APIKeyIdentity{
		APIKeyID:      "api_key_demo",
		TenantID:      "tenant_demo",
		ProjectID:     "project_demo",
		ApplicationID: "app_demo",
	}
}

func validAppTokenIdentity() auth.AppTokenIdentity {
	return auth.AppTokenIdentity{
		AppTokenID:    "app_token_demo",
		TenantID:      "tenant_demo",
		ProjectID:     "project_demo",
		ApplicationID: "app_demo",
	}
}

type fakeAPIKeyAuthenticator struct {
	identity    auth.APIKeyIdentity
	err         error
	calls       int
	bearerToken string
}

func (f *fakeAPIKeyAuthenticator) AuthenticateAPIKey(_ context.Context, bearerToken string) (auth.APIKeyIdentity, error) {
	f.calls++
	f.bearerToken = bearerToken
	if f.err != nil {
		return auth.APIKeyIdentity{}, f.err
	}
	return f.identity, nil
}

type fakeAppTokenValidator struct {
	identity auth.AppTokenIdentity
	err      error
	calls    int
	appToken string
}

func (f *fakeAppTokenValidator) ValidateAppToken(_ context.Context, appToken string) (auth.AppTokenIdentity, error) {
	f.calls++
	f.appToken = appToken
	if f.err != nil {
		return auth.AppTokenIdentity{}, f.err
	}
	return f.identity, nil
}
