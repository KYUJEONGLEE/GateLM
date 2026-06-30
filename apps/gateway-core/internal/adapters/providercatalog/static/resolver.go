package static

import (
	"context"
	"fmt"

	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

type Resolver struct {
	catalogs map[providercatalog.Reference]providercatalog.Catalog
}

func NewResolver(catalogs ...providercatalog.Catalog) *Resolver {
	resolver := &Resolver{catalogs: make(map[providercatalog.Reference]providercatalog.Catalog, len(catalogs))}
	for _, catalog := range catalogs {
		catalog = catalog.Normalize()
		if ref := catalog.Reference(); !ref.IsZero() {
			resolver.catalogs[ref] = catalog
		}
	}
	return resolver
}

func (r *Resolver) GetCatalog(ctx context.Context, ref providercatalog.Reference, _ providercatalog.Scope) (providercatalog.Catalog, error) {
	if err := ctx.Err(); err != nil {
		return providercatalog.Catalog{}, err
	}
	ref = ref.Normalize()
	if ref.IsZero() || r == nil {
		return providercatalog.Catalog{}, providercatalog.ErrUnavailable
	}
	catalog, ok := r.catalogs[ref]
	if !ok {
		return providercatalog.Catalog{}, fmt.Errorf("%w: %s", providercatalog.ErrMismatch, ref.CatalogID)
	}
	return catalog, nil
}
