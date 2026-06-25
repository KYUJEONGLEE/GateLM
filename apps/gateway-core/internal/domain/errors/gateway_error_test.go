package gatewayerrors

import (
	"context"
	"errors"
	"testing"
)

func TestGatewayErrorIncludesContextInErrorString(t *testing.T) {
	err := New(403, "scope_mismatch", "Tenant, project, or application scope mismatch.", "appauth")

	expected := "scope_mismatch: Tenant, project, or application scope mismatch. (stage=appauth)"
	if err.Error() != expected {
		t.Fatalf("expected %q, got %q", expected, err.Error())
	}
}

func TestGatewayErrorUnwrapsCause(t *testing.T) {
	err := RequestCancelled("authenticate_api_key", context.Canceled)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected GatewayError to unwrap context.Canceled")
	}
}
