package composite

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/credentials"
)

func TestResolverFallsBackWhenPrimaryCredentialStoreIsUnavailable(t *testing.T) {
	resolver := NewResolver(
		resolverFunc(func(context.Context, credentials.Ref) (credentials.Resolved, error) {
			return credentials.Resolved{}, credentials.ErrUnavailable
		}),
		resolverFunc(func(context.Context, credentials.Ref) (credentials.Resolved, error) {
			return credentials.Resolved{Value: "resolved-from-env-map"}, nil
		}),
	)

	resolved, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   "provider_credential:missing-in-store",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if resolved.Value != "resolved-from-env-map" {
		t.Fatal("unexpected fallback credential value")
	}
}

func TestResolverDoesNotFallBackWhenStoredCredentialIsInactive(t *testing.T) {
	fallbackCalled := false
	resolver := NewResolver(
		resolverFunc(func(context.Context, credentials.Ref) (credentials.Resolved, error) {
			return credentials.Resolved{}, credentials.ErrInactive
		}),
		resolverFunc(func(context.Context, credentials.Ref) (credentials.Resolved, error) {
			fallbackCalled = true
			return credentials.Resolved{Value: "must-not-be-used"}, nil
		}),
	)

	_, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   "provider_credential:revoked",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if !errors.Is(err, credentials.ErrInactive) {
		t.Fatalf("expected inactive error, got %v", err)
	}
	if fallbackCalled {
		t.Fatal("fallback resolver must not be called for inactive stored credential")
	}
}

type resolverFunc func(context.Context, credentials.Ref) (credentials.Resolved, error)

func (f resolverFunc) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	return f(ctx, ref)
}
