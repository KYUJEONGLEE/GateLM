package ragembedding

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRequestWireShapeContainsNoTenantOrProviderSelection(t *testing.T) {
	request := Request{
		Purpose:        PurposeQuery,
		ProfileVersion: ProfileVersion,
		Inputs:         []string{"first", "second"},
	}
	raw, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	encoded := string(raw)
	for _, forbidden := range []string{"tenant", "model", "dimension", "apiKey", "baseURL"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("request leaked forbidden caller/provider field %q: %s", forbidden, encoded)
		}
	}
	if err := ValidateRequest(request); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
}

func TestPayloadDigestPreservesInputOrderAndExactContent(t *testing.T) {
	base := Request{Purpose: PurposeQuery, ProfileVersion: 1, Inputs: []string{"Alpha", "Beta"}}
	baseDigest, err := ComputePayloadDigest(base)
	if err != nil {
		t.Fatalf("base digest: %v", err)
	}

	for name, changed := range map[string]Request{
		"order":   {Purpose: PurposeQuery, ProfileVersion: 1, Inputs: []string{"Beta", "Alpha"}},
		"content": {Purpose: PurposeQuery, ProfileVersion: 1, Inputs: []string{"alpha", "Beta"}},
		"purpose": {Purpose: PurposeIngestion, ProfileVersion: 1, Inputs: []string{"Alpha", "Beta"}},
	} {
		t.Run(name, func(t *testing.T) {
			digest, digestErr := ComputePayloadDigest(changed)
			if digestErr != nil {
				t.Fatalf("changed digest: %v", digestErr)
			}
			if digest == baseDigest {
				t.Fatalf("changed request produced the same digest")
			}
		})
	}
}

func TestVerifiedScopeRequiresCanonicalTenantUUID(t *testing.T) {
	caller, err := NewCallerIdentity("gatelm-chat-api", "service:chat-api", "chat-key-1")
	if err != nil {
		t.Fatalf("caller: %v", err)
	}
	if _, err := NewVerifiedScope("tenant_fixture_001", "request_1", "operation_1", PurposeQuery, 1, caller); err == nil {
		t.Fatal("non-UUID tenant was accepted")
	}
	scope, err := NewVerifiedScope(
		"00000000-0000-4000-8000-000000000001",
		"request_1",
		"operation_1",
		PurposeQuery,
		1,
		caller,
	)
	if err != nil {
		t.Fatalf("canonical tenant UUID rejected: %v", err)
	}
	if scope.TenantID() != "00000000-0000-4000-8000-000000000001" {
		t.Fatalf("tenant mismatch: %s", scope.TenantID())
	}
}
