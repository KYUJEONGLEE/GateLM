package static

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

func TestResolverReturnsMatchingCatalog(t *testing.T) {
	catalog := providercatalog.Catalog{
		CatalogID:      "provider_catalog_test",
		CatalogVersion: 1,
		ContentHash:    "sha256:catalog-test",
		Providers: []providercatalog.Provider{{
			ProviderID:   "provider_test",
			ProviderName: "provider-test",
			AdapterType:  providercatalog.AdapterTypeMock,
			Enabled:      true,
			BaseURL:      "http://provider.test/v1",
			TimeoutMs:    1000,
		}},
	}

	resolved, err := NewResolver(catalog).GetCatalog(context.Background(), catalog.Reference(), providercatalog.Scope{})
	if err != nil {
		t.Fatalf("GetCatalog returned error: %v", err)
	}
	if !resolved.Matches(catalog.Reference()) {
		t.Fatalf("resolved catalog does not match reference: %+v", resolved)
	}
}

func TestResolverRejectsMismatchedReference(t *testing.T) {
	catalog := providercatalog.Catalog{
		CatalogID:      "provider_catalog_test",
		CatalogVersion: 1,
		ContentHash:    "sha256:catalog-test",
	}
	ref := catalog.Reference()
	ref.ContentHash = "sha256:different"

	_, err := NewResolver(catalog).GetCatalog(context.Background(), ref, providercatalog.Scope{})
	if !errors.Is(err, providercatalog.ErrMismatch) {
		t.Fatalf("expected mismatch error, got %v", err)
	}
}
