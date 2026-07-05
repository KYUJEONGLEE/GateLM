package cached

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

func TestResolverReturnsFreshCachedCatalog(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	ref := catalogRef(1)
	delegate := newFakeCatalogResolver(catalogFixture("first"), catalogFixture("second"))
	resolver := NewResolver(delegate, Config{
		FreshTTL: time.Minute,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	first, err := resolver.GetCatalog(context.Background(), ref, catalogScope())
	if err != nil {
		t.Fatalf("first catalog: %v", err)
	}
	second, err := resolver.GetCatalog(context.Background(), ref, catalogScope())
	if err != nil {
		t.Fatalf("second catalog: %v", err)
	}

	if providerDisplayName(t, first) != "first" || providerDisplayName(t, second) != "first" {
		t.Fatalf("expected fresh cache to reuse first catalog, got first=%q second=%q", providerDisplayName(t, first), providerDisplayName(t, second))
	}
	if delegate.callCount() != 1 {
		t.Fatalf("expected delegate to be called once, got %d", delegate.callCount())
	}
}

func TestResolverSingleflightsColdMiss(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	ref := catalogRef(1)
	block := make(chan struct{})
	delegate := newFakeCatalogResolver(catalogFixture("first"))
	delegate.block = block
	delegate.started = make(chan int, 1)
	resolver := NewResolver(delegate, Config{
		FreshTTL: time.Minute,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	const workers = 16
	var wg sync.WaitGroup
	results := make(chan providercatalog.Catalog, workers)
	errs := make(chan error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			catalog, err := resolver.GetCatalog(context.Background(), ref, catalogScope())
			if err != nil {
				errs <- err
				return
			}
			results <- catalog
		}()
	}

	<-delegate.started
	close(block)
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Fatalf("unexpected error: %v", err)
	}
	for catalog := range results {
		if providerDisplayName(t, catalog) != "first" {
			t.Fatalf("expected first catalog, got %q", providerDisplayName(t, catalog))
		}
	}
	if delegate.callCount() != 1 {
		t.Fatalf("expected one delegate call, got %d", delegate.callCount())
	}
}

func TestResolverReturnsStaleCatalogWhileRefreshing(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	ref := catalogRef(1)
	delegate := newFakeCatalogResolver(catalogFixture("first"), catalogFixture("second"))
	resolver := NewResolver(delegate, Config{
		FreshTTL: time.Second,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	if _, err := resolver.GetCatalog(context.Background(), ref, catalogScope()); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	now = now.Add(2 * time.Second)
	block := make(chan struct{})
	delegate.block = block
	delegate.started = make(chan int, 1)
	delegate.completed = make(chan int, 1)

	stale, err := resolver.GetCatalog(context.Background(), ref, catalogScope())
	if err != nil {
		t.Fatalf("stale catalog: %v", err)
	}
	if providerDisplayName(t, stale) != "first" {
		t.Fatalf("expected stale first catalog, got %q", providerDisplayName(t, stale))
	}

	<-delegate.started
	close(block)
	<-delegate.completed

	refreshed, err := resolver.GetCatalog(context.Background(), ref, catalogScope())
	if err != nil {
		t.Fatalf("refreshed catalog: %v", err)
	}
	if providerDisplayName(t, refreshed) != "second" {
		t.Fatalf("expected refreshed second catalog, got %q", providerDisplayName(t, refreshed))
	}
	if delegate.callCount() != 2 {
		t.Fatalf("expected two delegate calls, got %d", delegate.callCount())
	}
}

func TestResolverDoesNotUseExpiredStaleCatalog(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	ref := catalogRef(1)
	delegate := newFakeCatalogResolver(catalogFixture("first"))
	resolver := NewResolver(delegate, Config{
		FreshTTL: time.Second,
		StaleTTL: time.Second,
		Now:      func() time.Time { return now },
	})

	if _, err := resolver.GetCatalog(context.Background(), ref, catalogScope()); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	expectedErr := errors.New("control plane unavailable")
	delegate.setErr(expectedErr)
	now = now.Add(3 * time.Second)

	_, err := resolver.GetCatalog(context.Background(), ref, catalogScope())
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected refresh error after stale expiry, got %v", err)
	}
}

func TestResolverRejectsCachedCatalogForMismatchedApplicationScope(t *testing.T) {
	now := time.Unix(100, 0).UTC()
	ref := catalogRef(1)
	delegate := newFakeCatalogResolver(catalogFixture("first"))
	resolver := NewResolver(delegate, Config{
		FreshTTL: time.Minute,
		StaleTTL: time.Minute,
		Now:      func() time.Time { return now },
	})

	if _, err := resolver.GetCatalog(context.Background(), ref, catalogScope()); err != nil {
		t.Fatalf("prime cache: %v", err)
	}

	_, err := resolver.GetCatalog(context.Background(), ref, providercatalog.Scope{ApplicationID: "different-app"})
	if !errors.Is(err, providercatalog.ErrMismatch) {
		t.Fatalf("expected mismatch for different application, got %v", err)
	}
}

type fakeCatalogResolver struct {
	mu        sync.Mutex
	calls     int
	catalogs  []providercatalog.Catalog
	err       error
	block     <-chan struct{}
	started   chan int
	completed chan int
}

func newFakeCatalogResolver(catalogs ...providercatalog.Catalog) *fakeCatalogResolver {
	return &fakeCatalogResolver{catalogs: catalogs}
}

func (r *fakeCatalogResolver) GetCatalog(ctx context.Context, _ providercatalog.Reference, _ providercatalog.Scope) (providercatalog.Catalog, error) {
	r.mu.Lock()
	r.calls++
	call := r.calls
	err := r.err
	block := r.block
	started := r.started
	completed := r.completed
	catalog := r.catalogs[len(r.catalogs)-1]
	if call <= len(r.catalogs) {
		catalog = r.catalogs[call-1]
	}
	r.mu.Unlock()

	if started != nil {
		started <- call
	}
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return providercatalog.Catalog{}, ctx.Err()
		}
	}
	if completed != nil {
		defer func() { completed <- call }()
	}
	if err != nil {
		return providercatalog.Catalog{}, err
	}
	return catalog, nil
}

func (r *fakeCatalogResolver) callCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls
}

func (r *fakeCatalogResolver) setErr(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.err = err
}

func catalogScope() providercatalog.Scope {
	return providercatalog.Scope{
		TenantID:      "tenant",
		ProjectID:     "project",
		ApplicationID: "app",
	}
}

func catalogRef(version int) providercatalog.Reference {
	return providercatalog.Reference{
		CatalogID:      "provider_catalog:app:1",
		CatalogVersion: version,
		ContentHash:    "hash_catalog",
	}
}

func catalogFixture(displayName string) providercatalog.Catalog {
	return providercatalog.Catalog{
		CatalogID:      "provider_catalog:app:1",
		CatalogVersion: 1,
		ContentHash:    "hash_catalog",
		Providers: []providercatalog.Provider{
			{
				ProviderID:   "provider_mock",
				ProviderName: "mock",
				AdapterType:  providercatalog.AdapterTypeMock,
				Enabled:      true,
				Models: []providercatalog.Model{
					{
						ModelID:     "mock-balanced",
						ModelName:   "mock-balanced",
						DisplayName: displayName,
						Enabled:     true,
					},
				},
			},
		},
	}
}

func providerDisplayName(t *testing.T, catalog providercatalog.Catalog) string {
	t.Helper()
	if len(catalog.Providers) == 0 || len(catalog.Providers[0].Models) == 0 {
		t.Fatalf("catalog fixture missing provider/model: %+v", catalog)
	}
	return catalog.Providers[0].Models[0].DisplayName
}
