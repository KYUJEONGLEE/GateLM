package cached

import (
	"context"
	"strings"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

const (
	DefaultFreshTTL = 5 * time.Second
	DefaultStaleTTL = 60 * time.Second
)

type Config struct {
	FreshTTL time.Duration
	StaleTTL time.Duration
	Now      func() time.Time
}

type Resolver struct {
	delegate providercatalog.Resolver
	freshTTL time.Duration
	staleTTL time.Duration
	now      func() time.Time

	mu      sync.Mutex
	entries map[providercatalog.Reference]entry
	flights map[providercatalog.Reference]*flight
}

type entry struct {
	catalog    providercatalog.Catalog
	freshUntil time.Time
	staleUntil time.Time
}

type flight struct {
	done    chan struct{}
	catalog providercatalog.Catalog
	err     error
}

func NewResolver(delegate providercatalog.Resolver, cfg Config) *Resolver {
	freshTTL := cfg.FreshTTL
	if freshTTL <= 0 {
		freshTTL = DefaultFreshTTL
	}
	staleTTL := cfg.StaleTTL
	if staleTTL == 0 {
		staleTTL = DefaultStaleTTL
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Resolver{
		delegate: delegate,
		freshTTL: freshTTL,
		staleTTL: staleTTL,
		now:      now,
		entries:  map[providercatalog.Reference]entry{},
		flights:  map[providercatalog.Reference]*flight{},
	}
}

func (r *Resolver) GetCatalog(ctx context.Context, ref providercatalog.Reference, scope providercatalog.Scope) (providercatalog.Catalog, error) {
	if r == nil || r.delegate == nil {
		return providercatalog.Catalog{}, providercatalog.ErrUnavailable
	}
	ref = ref.Normalize()
	if ref.IsZero() {
		return providercatalog.Catalog{}, providercatalog.ErrUnavailable
	}

	now := r.now().UTC()
	r.mu.Lock()
	if cached, ok := r.entries[ref]; ok {
		if err := validateCachedCatalog(cached.catalog, ref, scope); err != nil {
			r.mu.Unlock()
			return providercatalog.Catalog{}, err
		}
		if now.Before(cached.freshUntil) {
			catalog := cached.catalog
			r.mu.Unlock()
			return catalog, nil
		}
		if r.isStaleUsable(cached, now) {
			if _, refreshing := r.flights[ref]; !refreshing {
				f := &flight{done: make(chan struct{})}
				r.flights[ref] = f
				go r.refresh(context.Background(), ref, scope, f)
			}
			catalog := cached.catalog
			r.mu.Unlock()
			return catalog, nil
		}
	}

	if f, ok := r.flights[ref]; ok {
		r.mu.Unlock()
		return waitForFlight(ctx, f)
	}

	f := &flight{done: make(chan struct{})}
	r.flights[ref] = f
	r.mu.Unlock()

	go r.refresh(context.Background(), ref, scope, f)
	return waitForFlight(ctx, f)
}

func (r *Resolver) isStaleUsable(cached entry, now time.Time) bool {
	return r.staleTTL > 0 && now.Before(cached.staleUntil)
}

func (r *Resolver) refresh(ctx context.Context, ref providercatalog.Reference, scope providercatalog.Scope, f *flight) {
	catalog, err := r.delegate.GetCatalog(ctx, ref, scope)
	if err == nil {
		catalog = catalog.Normalize()
		err = validateCachedCatalog(catalog, ref, scope)
	}
	now := r.now().UTC()

	r.mu.Lock()
	if err == nil {
		r.entries[ref] = entry{
			catalog:    catalog,
			freshUntil: now.Add(r.freshTTL),
			staleUntil: now.Add(r.freshTTL + r.staleTTL),
		}
		f.catalog = catalog
	} else {
		f.err = err
	}
	delete(r.flights, ref)
	close(f.done)
	r.mu.Unlock()
}

func waitForFlight(ctx context.Context, f *flight) (providercatalog.Catalog, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-f.done:
		return f.catalog, f.err
	case <-ctx.Done():
		return providercatalog.Catalog{}, ctx.Err()
	}
}

func validateCachedCatalog(catalog providercatalog.Catalog, ref providercatalog.Reference, scope providercatalog.Scope) error {
	catalog = catalog.Normalize()
	ref = ref.Normalize()
	if !catalog.Matches(ref) || !catalogMatchesApplication(catalog.CatalogID, scope.ApplicationID) {
		return providercatalog.ErrMismatch
	}
	return nil
}

func catalogMatchesApplication(catalogID string, applicationID string) bool {
	applicationID = strings.TrimSpace(applicationID)
	if applicationID == "" {
		return true
	}
	parts := strings.Split(strings.TrimSpace(catalogID), ":")
	if len(parts) != 3 || parts[0] != "provider_catalog" {
		return true
	}
	return parts[1] == applicationID
}
