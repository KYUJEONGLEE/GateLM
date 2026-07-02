package controlplane

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

const catalogTestApplicationID = "00000000-0000-4000-8000-000000000300"

func TestResolverLoadsProviderCatalogByRuntimeSnapshotRef(t *testing.T) {
	ref := testCatalogRef()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/v1/provider-catalogs/"+ref.CatalogID {
			t.Fatalf("unexpected provider catalog path: %s", r.URL.Path)
		}
		writeProviderCatalog(t, w, testProviderCatalogResponse(ref, catalogTestApplicationID))
	}))
	defer server.Close()

	resolver := NewResolver(server.URL, server.Client())
	catalog, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: catalogTestApplicationID})
	if err != nil {
		t.Fatalf("expected provider catalog, got %v", err)
	}

	provider, err := catalog.ProviderByName("openai-main")
	if err != nil {
		t.Fatalf("expected openai-main provider: %v", err)
	}
	if provider.AdapterType != providercatalog.AdapterTypeOpenAICompatible {
		t.Fatalf("expected adapterType dispatch key, got %s", provider.AdapterType)
	}
	model, err := provider.ModelByID("provider_openai_main:gpt-test-low")
	if err != nil {
		t.Fatalf("expected catalog model: %v", err)
	}
	if model.ModelName != "gpt-test-low" {
		t.Fatalf("expected provider API modelName, got %s", model.ModelName)
	}
}

func TestResolverNormalizesNullProviderModelsToEmptySlice(t *testing.T) {
	ref := testCatalogRef()
	response := testProviderCatalogResponse(ref, catalogTestApplicationID)
	response.Providers[0].Models = nil
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeProviderCatalog(t, w, response)
	}))
	defer server.Close()

	resolver := NewResolver(server.URL, server.Client())
	catalog, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: catalogTestApplicationID})
	if err != nil {
		t.Fatalf("expected provider catalog, got %v", err)
	}

	provider, err := catalog.ProviderByName("openai-main")
	if err != nil {
		t.Fatalf("expected openai-main provider: %v", err)
	}
	if provider.Models == nil {
		t.Fatal("expected null provider models to normalize to an empty slice")
	}
	if len(provider.Models) != 0 {
		t.Fatalf("expected empty provider models slice, got %d models", len(provider.Models))
	}
}

func TestResolverRejectsCatalogMismatchWithoutLastKnownFallback(t *testing.T) {
	ref := testCatalogRef()
	response := testProviderCatalogResponse(ref, catalogTestApplicationID)
	response.ContentHash = "sha256:different"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeProviderCatalog(t, w, response)
	}))
	defer server.Close()

	resolver := NewResolver(server.URL, server.Client())
	_, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: catalogTestApplicationID})
	if !errors.Is(err, providercatalog.ErrMismatch) {
		t.Fatalf("expected catalog mismatch, got %v", err)
	}
}

func TestResolverUsesLastKnownCatalogOnlyForTransientFailures(t *testing.T) {
	ref := testCatalogRef()
	status := http.StatusOK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if status != http.StatusOK {
			http.Error(w, "temporarily unavailable", status)
			return
		}
		writeProviderCatalog(t, w, testProviderCatalogResponse(ref, catalogTestApplicationID))
	}))
	defer server.Close()

	resolver := NewResolver(server.URL, server.Client())
	if _, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: catalogTestApplicationID}); err != nil {
		t.Fatalf("prime last-known catalog: %v", err)
	}

	status = http.StatusBadGateway
	if _, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: catalogTestApplicationID}); err != nil {
		t.Fatalf("expected last-known catalog on transient failure, got %v", err)
	}

	status = http.StatusForbidden
	if _, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: catalogTestApplicationID}); err == nil {
		t.Fatal("expected forbidden response to fail without last-known fallback")
	}
}

func TestResolverRejectsKnownCatalogApplicationMismatch(t *testing.T) {
	ref := testCatalogRef()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeProviderCatalog(t, w, testProviderCatalogResponse(ref, catalogTestApplicationID))
	}))
	defer server.Close()

	resolver := NewResolver(server.URL, server.Client())
	_, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: "00000000-0000-4000-8000-999999999999"})
	if !errors.Is(err, providercatalog.ErrMismatch) {
		t.Fatalf("expected application mismatch, got %v", err)
	}
}

func writeProviderCatalog(t *testing.T, w http.ResponseWriter, response providerCatalogResponse) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		t.Fatalf("encode provider catalog response: %v", err)
	}
}

func testCatalogRef() providercatalog.Reference {
	return providercatalog.Reference{
		CatalogID:      "provider_catalog:" + catalogTestApplicationID + ":1",
		CatalogVersion: 1,
		ContentHash:    "sha256:provider-catalog-live-test",
	}
}

func testProviderCatalogResponse(ref providercatalog.Reference, applicationID string) providerCatalogResponse {
	ref.CatalogID = "provider_catalog:" + applicationID + ":1"
	return providerCatalogResponse{
		CatalogID:      ref.CatalogID,
		CatalogVersion: ref.CatalogVersion,
		ContentHash:    ref.ContentHash,
		UpdatedAt:      time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC),
		Providers: []providerCatalogProvider{
			{
				ProviderID:         "provider_openai_main",
				ProviderName:       "openai-main",
				AdapterType:        providercatalog.AdapterTypeOpenAICompatible,
				Enabled:            true,
				BaseURL:            "https://provider.example.test/v1",
				TimeoutMs:          1000,
				CredentialRequired: true,
				CredentialRef: &credentials.Ref{
					CredentialRefID:   "credential_ref_openai_main",
					CredentialVersion: 1,
					CredentialState:   credentials.StateActive,
				},
				AdapterConfig: providercatalog.AdapterConfig{
					RequestFormat: providercatalog.RequestFormatOpenAIChatCompletions,
				},
				Models: []providercatalog.Model{
					{
						ModelID:     "provider_openai_main:gpt-test-low",
						ModelName:   "gpt-test-low",
						DisplayName: "GPT Test Low",
						Enabled:     true,
						Capabilities: providercatalog.ModelCapabilities{
							StreamingSupported: true,
							SupportsJSONMode:   true,
							MaxInputTokens:     8192,
							MaxOutputTokens:    2048,
						},
						Routing: providercatalog.ModelRouting{
							AutoRoutingEligible: true,
							CostTier:            "low",
							FallbackPriority:    0,
						},
					},
				},
			},
		},
	}
}
