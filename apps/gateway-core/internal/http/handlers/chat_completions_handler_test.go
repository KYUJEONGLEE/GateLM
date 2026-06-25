package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/http/middleware"
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

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": false
	}`))
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

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}],
		"stream": true
	}`))
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

func TestChatCompletionsHandlerRejectsMissingProviderRegistry(t *testing.T) {
	handler := ChatCompletionsHandler{
		DefaultModel:    "mock-balanced",
		DefaultProvider: "mock",
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "synthetic test message"}]
	}`))
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

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "this request is larger than the configured limit"}]
	}`))
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

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "mock-balanced",
		"messages": [{"role": "user", "content": "Write a short refund response."}]
	}`))
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

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
				"model": "mock-balanced",
				"messages": [{"role": "user", "content": "synthetic auth failure test"}]
			}`))
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

			var resp gatewayErrorResponse
			if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if resp.Error.Code != tt.wantCode {
				t.Fatalf("unexpected error code: %s", resp.Error.Code)
			}
			if resp.Error.RequestID == "" {
				t.Fatalf("expected response request id")
			}
		})
	}
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
			gatewayCtx.Identity.TenantID = "tenant_demo"
			gatewayCtx.Identity.ProjectID = "project_demo"
			gatewayCtx.Identity.ApplicationID = "app_demo"
			gatewayCtx.Identity.APIKeyID = "api_key_demo"
			gatewayCtx.Identity.AppTokenID = "app_token_demo"
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

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{
		"model": "auto",
		"messages": [{"role": "user", "content": "short prompt"}]
	}`))
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
	if resp.GateLM.TenantID != "tenant_demo" || resp.GateLM.ProjectID != "project_demo" || resp.GateLM.ApplicationID != "app_demo" {
		t.Fatalf("unexpected gate_lm context metadata: %#v", resp.GateLM)
	}
	if resp.GateLM.SelectedModel != "mock-fast" || resp.GateLM.RoutingReason != "short_prompt_low_cost" {
		t.Fatalf("unexpected gate_lm routing metadata: %#v", resp.GateLM)
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
