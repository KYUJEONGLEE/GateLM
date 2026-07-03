package cache

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

type Status string

const (
	StatusHit    Status = "hit"
	StatusMiss   Status = "miss"
	StatusBypass Status = "bypass"
	StatusError  Status = "error"
)

type Type string

const (
	TypeNone     Type = "none"
	TypeExact    Type = "exact"
	TypeSemantic Type = "semantic"
)

const ExactKeyMaterialVersion = "v2-exact-routing-aware-v1"

type KeyMaterial struct {
	TenantID                        string `json:"tenantId"`
	ProjectID                       string `json:"projectId"`
	ApplicationID                   string `json:"applicationId"`
	RequestedModel                  string `json:"requestedModel"`
	ProviderCatalogContentHash      string `json:"providerCatalogContentHash"`
	ProviderID                      string `json:"providerId"`
	ProviderCatalogStableKey        string `json:"providerCatalogStableKey"`
	ModelID                         string `json:"modelId"`
	RoutingPolicyHash               string `json:"routingPolicyHash"`
	RoutingDecisionKeyHash          string `json:"routingDecisionKeyHash"`
	CachePolicyHash                 string `json:"cachePolicyHash"`
	SafetyPolicyHash                string `json:"safetyPolicyHash"`
	MaskingPolicyHash               string `json:"maskingPolicyHash"`
	NormalizedMaskedRequestBodyHash string `json:"normalizedMaskedRequestBodyHash"`
	RequestParamsHash               string `json:"requestParamsHash"`
	CacheVersion                    string `json:"cacheVersion"`

	// Deprecated compatibility fields. They are intentionally excluded from
	// canonical JSON so raw or redacted prompt text is not key material.
	SecurityPolicyVersionID  string `json:"-"`
	RoutingPolicyVersionID   string `json:"-"`
	NormalizedRedactedPrompt string `json:"-"`
}

type keyEnvelope struct {
	Version  string      `json:"version"`
	Material KeyMaterial `json:"material"`
}

func NormalizeRedactedPrompt(prompt string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(prompt)), " ")
}

func BuildExactKey(secret []byte, material KeyMaterial) (string, error) {
	payload, err := canonicalMaterialBytes(material)
	if err != nil {
		return "", err
	}

	if len(secret) == 0 {
		return "", errors.New("cache key secret is required")
	}

	mac := hmac.New(sha256.New, secret)
	if _, err := mac.Write(payload); err != nil {
		return "", err
	}

	return "hmac-sha256:" + hex.EncodeToString(mac.Sum(nil)), nil
}

func canonicalMaterialBytes(material KeyMaterial) ([]byte, error) {
	material.TenantID = strings.TrimSpace(material.TenantID)
	material.ProjectID = strings.TrimSpace(material.ProjectID)
	material.ApplicationID = strings.TrimSpace(material.ApplicationID)
	material.RequestedModel = strings.TrimSpace(material.RequestedModel)
	material.ProviderCatalogContentHash = strings.TrimSpace(material.ProviderCatalogContentHash)
	material.ProviderID = strings.TrimSpace(material.ProviderID)
	material.ProviderCatalogStableKey = strings.TrimSpace(material.ProviderCatalogStableKey)
	material.ModelID = strings.TrimSpace(material.ModelID)
	material.RoutingPolicyHash = firstNonEmpty(strings.TrimSpace(material.RoutingPolicyHash), strings.TrimSpace(material.RoutingPolicyVersionID))
	material.RoutingDecisionKeyHash = strings.TrimSpace(material.RoutingDecisionKeyHash)
	material.CachePolicyHash = strings.TrimSpace(material.CachePolicyHash)
	material.SafetyPolicyHash = firstNonEmpty(strings.TrimSpace(material.SafetyPolicyHash), strings.TrimSpace(material.SecurityPolicyVersionID))
	material.MaskingPolicyHash = strings.TrimSpace(material.MaskingPolicyHash)
	material.NormalizedMaskedRequestBodyHash = strings.TrimSpace(material.NormalizedMaskedRequestBodyHash)
	material.RequestParamsHash = strings.TrimSpace(material.RequestParamsHash)
	material.CacheVersion = strings.TrimSpace(material.CacheVersion)
	if material.CacheVersion == "" {
		material.CacheVersion = ExactKeyMaterialVersion
	}

	if material.TenantID == "" {
		return nil, errors.New("tenant id is required")
	}
	if material.ProjectID == "" {
		return nil, errors.New("project id is required")
	}
	if material.ApplicationID == "" {
		return nil, errors.New("application id is required")
	}
	if material.RequestedModel == "" {
		return nil, errors.New("requested model is required")
	}
	if material.ProviderCatalogContentHash == "" {
		return nil, errors.New("provider catalog content hash is required")
	}
	if material.ProviderID == "" && material.ProviderCatalogStableKey == "" {
		return nil, errors.New("provider id or provider catalog stable key is required")
	}
	if material.ModelID == "" {
		return nil, errors.New("model id is required")
	}
	if material.RoutingPolicyHash == "" {
		return nil, errors.New("routing policy hash is required")
	}
	if material.RoutingDecisionKeyHash == "" {
		return nil, errors.New("routing decision key hash is required")
	}
	if material.CachePolicyHash == "" {
		return nil, errors.New("cache policy hash is required")
	}
	if material.SafetyPolicyHash == "" {
		return nil, errors.New("safety policy hash is required")
	}
	if material.MaskingPolicyHash == "" {
		return nil, errors.New("masking policy hash is required")
	}
	if material.NormalizedMaskedRequestBodyHash == "" {
		return nil, errors.New("normalized masked request body hash is required")
	}
	if material.RequestParamsHash == "" {
		return nil, errors.New("request params hash is required")
	}

	return json.Marshal(keyEnvelope{
		Version:  ExactKeyMaterialVersion,
		Material: material,
	})
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
