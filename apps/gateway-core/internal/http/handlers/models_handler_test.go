package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"gatelm/apps/gateway-core/internal/adapters/providers/mock"
	"gatelm/apps/gateway-core/internal/domain/provider"
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
