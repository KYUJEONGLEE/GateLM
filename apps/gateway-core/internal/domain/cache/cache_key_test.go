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
			material.SafetyPolicyHash = "safety_policy_v2"
			return material
		},
		"masking policy": func(material KeyMaterial) KeyMaterial {
			material.MaskingPolicyHash = "masking_policy_v2"
			return material
		},
		"routing policy": func(material KeyMaterial) KeyMaterial {
			material.RoutingPolicyHash = "routing_policy_v2"
			return material
		},
		"routing decision": func(material KeyMaterial) KeyMaterial {
			material.RoutingDecisionKeyHash = "sha256:routing-decision-other"
			return material
		},
		"cache policy": func(material KeyMaterial) KeyMaterial {
			material.CachePolicyHash = "cache_p0_v2"
			return material
		},
		"provider catalog content hash": func(material KeyMaterial) KeyMaterial {
			material.ProviderCatalogContentHash = "sha256:provider-catalog-other"
			return material
		},
		"provider id": func(material KeyMaterial) KeyMaterial {
			material.ProviderID = "provider_other"
			return material
		},
		"provider catalog stable key": func(material KeyMaterial) KeyMaterial {
			material.ProviderID = ""
			material.ProviderCatalogStableKey = "provider-stable-other"
			return material
		},
		"model id": func(material KeyMaterial) KeyMaterial {
			material.ModelID = "model_other"
			return material
		},
		"masked request body hash": func(material KeyMaterial) KeyMaterial {
			material.NormalizedMaskedRequestBodyHash = "sha256:masked-body-other"
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
	redactedPrompt := "Contact [EMAIL_1] about the refund."
	material := validKeyMaterial()
	material.NormalizedRedactedPrompt = redactedPrompt
	material.NormalizedMaskedRequestBodyHash = "sha256:redacted-body-hash"

	canonical, err := canonicalMaterialBytes(material)
	if err != nil {
		t.Fatalf("canonicalMaterialBytes returned error: %v", err)
	}
	if strings.Contains(string(canonical), originalPrompt) {
		t.Fatalf("canonical material must not include unredacted prompt text")
	}
	if strings.Contains(string(canonical), redactedPrompt) {
		t.Fatalf("canonical material must not include redacted prompt text, only its hash")
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

func TestBuildExactKeyRequiresRoutingAwareMaterial(t *testing.T) {
	cases := map[string]func(KeyMaterial) KeyMaterial{
		"provider catalog content hash": func(material KeyMaterial) KeyMaterial {
			material.ProviderCatalogContentHash = " "
			return material
		},
		"provider identity": func(material KeyMaterial) KeyMaterial {
			material.ProviderID = " "
			material.ProviderCatalogStableKey = " "
			return material
		},
		"model id": func(material KeyMaterial) KeyMaterial {
			material.ModelID = " "
			return material
		},
		"routing decision key hash": func(material KeyMaterial) KeyMaterial {
			material.RoutingDecisionKeyHash = " "
			return material
		},
		"masked request body hash": func(material KeyMaterial) KeyMaterial {
			material.NormalizedMaskedRequestBodyHash = " "
			return material
		},
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := BuildExactKey([]byte("cache-key-secret-for-test-only"), mutate(validKeyMaterial()))
			if err == nil {
				t.Fatalf("expected error when %s is empty", name)
			}
		})
	}
}

func validKeyMaterial() KeyMaterial {
	return KeyMaterial{
		TenantID:                        "tenant_01J_DEMO",
		ProjectID:                       "project_01J_DEMO",
		ApplicationID:                   "app_01J_DEMO",
		RequestedModel:                  "auto",
		ProviderCatalogContentHash:      "sha256:provider-catalog-demo",
		ProviderID:                      "provider_demo",
		ProviderCatalogStableKey:        "",
		ModelID:                         "model_demo",
		RoutingPolicyHash:               "routing_policy_p0_v1",
		RoutingDecisionKeyHash:          "sha256:routing-decision-demo",
		CachePolicyHash:                 "cache_p0_v1",
		SafetyPolicyHash:                "safety_policy_p0_v1",
		MaskingPolicyHash:               "masking_policy_p0_v1",
		NormalizedMaskedRequestBodyHash: "sha256:masked-body-demo",
		RequestParamsHash:               "hmac-sha256:params-demo",
		CacheVersion:                    ExactKeyMaterialVersion,
	}
}
