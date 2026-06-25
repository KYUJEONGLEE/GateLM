package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/domain/provider"
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
