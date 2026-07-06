package composite

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/credentials"
)

type Resolver struct {
	primary  credentials.Resolver
	fallback credentials.Resolver
}

func NewResolver(primary credentials.Resolver, fallback credentials.Resolver) *Resolver {
	return &Resolver{primary: primary, fallback: fallback}
}

func (r *Resolver) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	if err := ctx.Err(); err != nil {
		return credentials.Resolved{}, err
	}
	if r == nil {
		return credentials.Resolved{}, credentials.ErrUnavailable
	}
	if r.primary == nil {
		if r.fallback == nil {
			return credentials.Resolved{}, credentials.ErrUnavailable
		}
		return r.fallback.Resolve(ctx, ref)
	}

	resolved, err := r.primary.Resolve(ctx, ref)
	if err == nil {
		return resolved, nil
	}
	if !errors.Is(err, credentials.ErrUnavailable) || r.fallback == nil {
		return credentials.Resolved{}, err
	}
	return r.fallback.Resolve(ctx, ref)
}
