package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
)

func TestNewRouterWiresAuthBeforeProviderCall(t *testing.T) {
	chatCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chatCalls++
		writeRouterTestJSON(w, http.StatusOK, provider.ChatCompletionResponse{
			ID:      "mock_chatcmpl_router_auth_safety",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   "mock-balanced",
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	apiAuth := &routerTestAPIKeyAuthenticator{
		err: gatewayerrors.InvalidAPIKey("authenticate_api_key"),
	}
	appValidator := &routerTestAppTokenValidator{
		identity: routerTestValidAppTokenIdentity(),
	}
	router := NewRouter(config.Config{
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
	}, registry, nil, WithGatewayAuth(apiAuth, appValidator))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
	req.Header.Set("Authorization", "Bearer glm_api_test_redacted")
	req.Header.Set("X-GateLM-App-Token", "glm_app_token_test_redacted")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	if apiAuth.calls != 1 {
		t.Fatalf("expected API key authenticator to be called once, got %d", apiAuth.calls)
	}
	if appValidator.calls != 0 {
		t.Fatalf("expected app token validator not to be called, got %d", appValidator.calls)
	}
	if chatCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", chatCalls)
	}
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
		t.Fatalf("expected cache bypass header, got %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
}

func writeRouterTestJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func routerTestValidAppTokenIdentity() auth.AppTokenIdentity {
	return auth.AppTokenIdentity{
		AppTokenID:    "app_token_demo",
		TenantID:      "tenant_demo",
		ProjectID:     "project_demo",
		ApplicationID: "app_demo",
	}
}

type routerTestAPIKeyAuthenticator struct {
	identity auth.APIKeyIdentity
	err      error
	calls    int
}

func (f *routerTestAPIKeyAuthenticator) AuthenticateAPIKey(_ context.Context, _ string) (auth.APIKeyIdentity, error) {
	f.calls++
	if f.err != nil {
		return auth.APIKeyIdentity{}, f.err
	}
	return f.identity, nil
}

type routerTestAppTokenValidator struct {
	identity auth.AppTokenIdentity
	err      error
	calls    int
}

func (f *routerTestAppTokenValidator) ValidateAppToken(_ context.Context, _ string) (auth.AppTokenIdentity, error) {
	f.calls++
	if f.err != nil {
		return auth.AppTokenIdentity{}, f.err
	}
	return f.identity, nil
}
