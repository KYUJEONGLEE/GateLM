package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	staticprovidercatalog "gatelm/apps/gateway-core/internal/adapters/providercatalog/static"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	gatewayrequest "gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
	"gatelm/apps/gateway-core/internal/http/middleware"
)

func TestModelsHandlerReturnsRuntimeCatalogModels(t *testing.T) {
	catalog := testProviderCatalog()
	handler := ModelsHandler{
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(catalog),
		APIKeyAuthenticator:     newTestCredentialStore(),
		ExpectedTenantID:        testTenantID,
		ExpectedProjectID:       testProjectID,
		ExpectedAppID:           testAppID,
		RuntimePolicyPipeline:   testProviderCatalogPipeline("", ""),
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp provider.ModelListResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode model response: %v", err)
	}
	if resp.Object != "list" {
		t.Fatalf("unexpected object: %s", resp.Object)
	}
	if len(resp.Data) != 2 {
		t.Fatalf("expected two enabled catalog models, got %#v", resp.Data)
	}
	if resp.Data[0].ID != "model_low" || resp.Data[0].OwnedBy != "openai-main" {
		t.Fatalf("unexpected primary model info: %#v", resp.Data[0])
	}
	if resp.Data[1].ID != "model_mock_fallback" || resp.Data[1].OwnedBy != "mock-fallback" {
		t.Fatalf("unexpected fallback model info: %#v", resp.Data[1])
	}
}

func TestModelsHandlerPassesStartedAtToRuntimePipeline(t *testing.T) {
	runtimePolicy := &fakeGatewayPipeline{
		mutate: func(gatewayCtx *gatewayrequest.GatewayContext) {
			if gatewayCtx.Request.StartedAt.IsZero() {
				t.Fatalf("expected non-zero started at")
			}
			gatewayCtx.Runtime.Snapshot = testRuntimeSnapshotForModels(testProviderCatalog())
		},
	}
	handler := ModelsHandler{
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		APIKeyAuthenticator:     newTestCredentialStore(),
		ExpectedTenantID:        testTenantID,
		ExpectedProjectID:       testProjectID,
		ExpectedAppID:           testAppID,
		RuntimePolicyPipeline:   runtimePolicy,
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if runtimePolicy.calls != 1 {
		t.Fatalf("expected one runtime policy call, got %d", runtimePolicy.calls)
	}
}

func TestModelListFromProviderCatalogReturnsEmptyArray(t *testing.T) {
	resp := modelListFromProviderCatalog(providercatalog.Catalog{})
	if resp.Data == nil {
		t.Fatalf("expected non-nil empty data slice")
	}

	body, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal model response: %v", err)
	}
	if !strings.Contains(string(body), `"data":[]`) {
		t.Fatalf("expected empty JSON array for data, got %s", body)
	}
}

func testRuntimeSnapshotForModels(catalog providercatalog.Catalog) runtimeconfig.RuntimeSnapshotProvenance {
	return runtimeconfig.RuntimeSnapshotProvenance{
		RuntimeSnapshotID:      "runtime_snapshot_models_test",
		RuntimeSnapshotVersion: 1,
		ContentHash:            "sha256:runtime-models-test",
		RuntimeState:           runtimeconfig.RuntimeStateSnapshotActive,
		ProviderCatalogRef:     catalog.Reference(),
	}
}

func TestModelsHandlerRejectsMissingRuntimePipeline(t *testing.T) {
	handler := ModelsHandler{
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		APIKeyAuthenticator:     newTestCredentialStore(),
		ExpectedTenantID:        testTenantID,
		ExpectedProjectID:       testProjectID,
		ExpectedAppID:           testAppID,
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
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
	if rr.Header().Get("X-GateLM-Cache-Status") != "bypass" {
		t.Fatalf("unexpected cache status header: %s", rr.Header().Get("X-GateLM-Cache-Status"))
	}
	if rr.Header().Get("X-GateLM-Masking-Action") != "none" {
		t.Fatalf("unexpected masking action header: %s", rr.Header().Get("X-GateLM-Masking-Action"))
	}
}

func TestModelsHandlerReturnsAuthErrorBeforeRuntimeCatalogLookup(t *testing.T) {
	runtimePolicy := &fakeGatewayPipeline{}
	handler := ModelsHandler{
		ProviderCatalogResolver: staticprovidercatalog.NewResolver(testProviderCatalog()),
		APIKeyAuthenticator:     failingAPIKeyAuthenticator{err: gatewayerrors.InvalidAPIKey("authenticate_api_key")},
		RuntimePolicyPipeline:   runtimePolicy,
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	setValidGatewayAuthHeaders(req)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rr.Code, rr.Body.String())
	}
	if runtimePolicy.calls != 0 {
		t.Fatalf("expected no runtime policy calls, got %d", runtimePolicy.calls)
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
