package gatewayerrors

import "testing"

func TestGatewayErrorIncludesContextInErrorString(t *testing.T) {
	err := New(403, "scope_mismatch", "Tenant, project, or application scope mismatch.", "appauth")

	expected := "scope_mismatch: Tenant, project, or application scope mismatch. (stage=appauth)"
	if err.Error() != expected {
		t.Fatalf("expected %q, got %q", expected, err.Error())
	}
}
