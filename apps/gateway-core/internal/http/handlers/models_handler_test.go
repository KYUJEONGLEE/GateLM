package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

func TestModelsHandlerReturnsProviderCatalog(t *testing.T) {
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}

		writeJSON(w, http.StatusOK, provider.ModelListResponse{
			Object: "list",
			Data: []provider.ModelInfo{
				{ID: "mock-fast", Object: "model", OwnedBy: "mock"},
				{ID: "mock-balanced", Object: "model", OwnedBy: "mock"},
			},
		})
	}))
	defer mockServer.Close()

	registry := provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client()))
	handler := ModelsHandler{Providers: registry}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestModelsHandlerRejectsMissingProviderRegistry(t *testing.T) {
	handler := ModelsHandler{}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
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
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if rr.Header().Get("X-GateLM-Masking-Action") != "none" {
		t.Fatalf("unexpected masking action header: %s", rr.Header().Get("X-GateLM-Masking-Action"))
	}
}

func TestModelsHandlerReturnsPipelineAuthErrorBeforeProviderCall(t *testing.T) {
	modelCalls := 0
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		modelCalls++
		writeJSON(w, http.StatusOK, provider.ModelListResponse{})
	}))
	defer mockServer.Close()

	handler := ModelsHandler{
		Providers:           provider.NewRegistry("mock", mock.NewAdapter(mockServer.URL, mockServer.Client())),
		PreProviderPipeline: &fakeGatewayPipeline{err: gatewayerrors.InvalidAPIKey("authenticate_api_key")},
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	if modelCalls != 0 {
		t.Fatalf("expected no mock provider calls, got %d", modelCalls)
	}
	if rr.Header().Get(middleware.RequestIDHeader) == "" {
		t.Fatalf("missing response request id header")
	}

	var resp gatewayErrorResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if resp.Error.Code != "invalid_api_key" {
		t.Fatalf("unexpected error code: %s", resp.Error.Code)
	}
}
