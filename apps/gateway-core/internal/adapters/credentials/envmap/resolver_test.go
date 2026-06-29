package envmap

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/credentials"
)

func TestResolverResolvesActiveReferenceThroughEnvBinding(t *testing.T) {
	resolver := NewResolver(map[string]string{"credential_ref_test": "PROVIDER_KEY_TEST"})
	resolver.lookup = func(name string) (string, bool) {
		if name != "PROVIDER_KEY_TEST" {
			t.Fatalf("unexpected env name: %s", name)
		}
		return "resolved-provider-credential", true
	}

	resolved, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   "credential_ref_test",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if resolved.Value != "resolved-provider-credential" {
		t.Fatal("unexpected resolved credential value")
	}
}

func TestResolverRejectsMissingBindingWithoutReadingEnv(t *testing.T) {
	resolver := NewResolver(nil)
	resolver.lookup = func(name string) (string, bool) {
		t.Fatal("lookup must not be called without a binding")
		return "", false
	}

	_, err := resolver.Resolve(context.Background(), credentials.Ref{
		CredentialRefID:   "credential_ref_missing",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	})
	if !errors.Is(err, credentials.ErrUnavailable) {
		t.Fatalf("expected unavailable error, got %v", err)
	}
}

func TestParseBindingsIgnoresMalformedEntries(t *testing.T) {
	bindings := ParseBindings("credential_ref_a=PROVIDER_A,malformed, =EMPTY,credential_ref_b= PROVIDER_B ")
	if len(bindings) != 2 {
		t.Fatalf("expected two bindings, got %+v", bindings)
	}
	if bindings["credential_ref_a"] != "PROVIDER_A" || bindings["credential_ref_b"] != "PROVIDER_B" {
		t.Fatalf("unexpected bindings: %+v", bindings)
	}
}
