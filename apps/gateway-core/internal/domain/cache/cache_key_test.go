package cache

import (
	"strings"
	"testing"
)

func TestBuildExactKeyIsDeterministic(t *testing.T) {
	secret := []byte("cache-key-secret-for-test-only")
	material := validKeyMaterial()

	first, err := BuildExactKey(secret, material)
	if err != nil {
		t.Fatalf("BuildExactKey returned error: %v", err)
	}

	second, err := BuildExactKey(secret, material)
	if err != nil {
		t.Fatalf("BuildExactKey returned error on second call: %v", err)
	}

	if first != second {
		t.Fatalf("expected deterministic hash, got %q and %q", first, second)
	}
	if !strings.HasPrefix(first, "hmac-sha256:") {
		t.Fatalf("expected hmac-sha256 prefix, got %q", first)
	}
}

func TestBuildExactKeyChangesWhenMaterialChanges(t *testing.T) {
	secret := []byte("cache-key-secret-for-test-only")
	base, err := BuildExactKey(secret, validKeyMaterial())
	if err != nil {
		t.Fatalf("BuildExactKey returned error: %v", err)
	}

	cases := map[string]func(KeyMaterial) KeyMaterial{
		"tenant": func(material KeyMaterial) KeyMaterial {
			material.TenantID = "tenant_other"
			return material
		},
		"project": func(material KeyMaterial) KeyMaterial {
			material.ProjectID = "project_other"
			return material
		},
		"application": func(material KeyMaterial) KeyMaterial {
			material.ApplicationID = "app_other"
			return material
		},
		"requested model": func(material KeyMaterial) KeyMaterial {
			material.RequestedModel = "mock-balanced"
			return material
		},
		"security policy": func(material KeyMaterial) KeyMaterial {
			material.SecurityPolicyVersionID = "security_policy_p0_v2"
			return material
		},
		"routing policy": func(material KeyMaterial) KeyMaterial {
			material.RoutingPolicyVersionID = "routing_policy_p0_v2"
			return material
		},
		"cache policy": func(material KeyMaterial) KeyMaterial {
			material.CachePolicyHash = "cache_p0_v2"
			return material
		},
		"redacted prompt": func(material KeyMaterial) KeyMaterial {
			material.NormalizedRedactedPrompt = "Write a short billing response."
			return material
		},
		"request params": func(material KeyMaterial) KeyMaterial {
			material.RequestParamsHash = "hmac-sha256:params-other"
			return material
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			changed, err := BuildExactKey(secret, mutate(validKeyMaterial()))
			if err != nil {
				t.Fatalf("BuildExactKey returned error: %v", err)
			}
			if changed == base {
				t.Fatalf("expected key to change when %s changes", name)
			}
		})
	}
}

func TestBuildExactKeyDoesNotExposePromptText(t *testing.T) {
	secret := []byte("cache-key-secret-for-test-only")
	originalPrompt := "Contact user@example.invalid about the refund."
	redactedPrompt := "Contact [EMAIL_REDACTED] about the refund."
	material := validKeyMaterial()
	material.NormalizedRedactedPrompt = redactedPrompt

	canonical, err := canonicalMaterialBytes(material)
	if err != nil {
		t.Fatalf("canonicalMaterialBytes returned error: %v", err)
	}
	if strings.Contains(string(canonical), originalPrompt) {
		t.Fatalf("canonical material must not include unredacted prompt text")
	}

	key, err := BuildExactKey(secret, material)
	if err != nil {
		t.Fatalf("BuildExactKey returned error: %v", err)
	}
	if strings.Contains(key, originalPrompt) || strings.Contains(key, redactedPrompt) {
		t.Fatalf("cache key hash must not expose prompt text")
	}
}

func TestNormalizeRedactedPrompt(t *testing.T) {
	got := NormalizeRedactedPrompt("  Write\t\na short   response.  ")
	want := "Write a short response."
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestBuildExactKeyRequiresRequestParamsHash(t *testing.T) {
	material := validKeyMaterial()
	material.RequestParamsHash = "  "

	_, err := BuildExactKey([]byte("cache-key-secret-for-test-only"), material)
	if err == nil {
		t.Fatal("expected error when request params hash is empty")
	}
	if !strings.Contains(err.Error(), "request params hash") {
		t.Fatalf("expected request params hash error, got %v", err)
	}
}

func TestBuildExactKeyRequiresCachePolicyHash(t *testing.T) {
	material := validKeyMaterial()
	material.CachePolicyHash = "  "

	_, err := BuildExactKey([]byte("cache-key-secret-for-test-only"), material)
	if err == nil {
		t.Fatal("expected error when cache policy hash is empty")
	}
	if !strings.Contains(err.Error(), "cache policy hash") {
		t.Fatalf("expected cache policy hash error, got %v", err)
	}
}

func validKeyMaterial() KeyMaterial {
	return KeyMaterial{
		TenantID:                 "tenant_01J_DEMO",
		ProjectID:                "project_01J_DEMO",
		ApplicationID:            "app_01J_DEMO",
		RequestedModel:           "auto",
		SecurityPolicyVersionID:  "security_policy_p0_v1",
		RoutingPolicyVersionID:   "routing_policy_p0_v1",
		CachePolicyHash:          "cache_p0_v1",
		NormalizedRedactedPrompt: "Write a short refund response.",
		RequestParamsHash:        "hmac-sha256:params-demo",
	}
}
