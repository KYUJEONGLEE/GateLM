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

const ExactKeyMaterialVersion = "p0-exact-v3"

type KeyMaterial struct {
	TenantID                 string `json:"tenantId"`
	ProjectID                string `json:"projectId"`
	ApplicationID            string `json:"applicationId"`
	RequestedModel           string `json:"requestedModel"`
	SecurityPolicyVersionID  string `json:"securityPolicyVersionId"`
	RoutingPolicyVersionID   string `json:"routingPolicyVersionId"`
	CachePolicyHash          string `json:"cachePolicyHash"`
	NormalizedRedactedPrompt string `json:"normalizedRedactedPrompt"`
	RequestParamsHash        string `json:"requestParamsHash"`
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
	material.SecurityPolicyVersionID = strings.TrimSpace(material.SecurityPolicyVersionID)
	material.RoutingPolicyVersionID = strings.TrimSpace(material.RoutingPolicyVersionID)
	material.CachePolicyHash = strings.TrimSpace(material.CachePolicyHash)
	material.NormalizedRedactedPrompt = NormalizeRedactedPrompt(material.NormalizedRedactedPrompt)
	material.RequestParamsHash = strings.TrimSpace(material.RequestParamsHash)

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
	if material.SecurityPolicyVersionID == "" {
		return nil, errors.New("security policy version id is required")
	}
	if material.RoutingPolicyVersionID == "" {
		return nil, errors.New("routing policy version id is required")
	}
	if material.CachePolicyHash == "" {
		return nil, errors.New("cache policy hash is required")
	}
	if material.NormalizedRedactedPrompt == "" {
		return nil, errors.New("normalized redacted prompt is required")
	}
	if material.RequestParamsHash == "" {
		return nil, errors.New("request params hash is required")
	}

	return json.Marshal(keyEnvelope{
		Version:  ExactKeyMaterialVersion,
		Material: material,
	})
}
