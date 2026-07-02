package routing

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

type Request struct {
	RequestedModel string
	PromptText     string
	Config         *SimpleRouterConfig
}

type Decision struct {
	RequestedModel             string
	SelectedProvider           string
	SelectedProviderID         string
	SelectedProviderCatalogKey string
	SelectedModel              string
	SelectedModelID            string
	ProviderCatalogContentHash string
	RoutingDecisionKeyHash     string
	RoutingDecisionMaterial    DecisionMaterial
	RoutingReason              string
	PolicyHash                 string
}

type DecisionMaterial struct {
	RoutingMode   string `json:"routingMode"`
	Category      string `json:"category"`
	Tier          string `json:"tier"`
	Capability    string `json:"capability"`
	PolicyVariant string `json:"policyVariant"`
}

const (
	RoutingModeAuto   = "auto"
	RoutingModePinned = "pinned"

	CategoryUnknown       = "unknown"
	CategoryGeneral       = "general"
	CategoryCode          = "code"
	CategoryTranslation   = "translation"
	CategorySupportRefund = "support_refund"

	TierLowCost     = "low_cost"
	TierBalanced    = "balanced"
	TierHighQuality = "high_quality"

	CapabilityChat        = "chat"
	CapabilityReasoning   = "reasoning"
	CapabilityCode        = "code"
	CapabilityTranslation = "translation"

	PolicyVariantDefault = "default"
)

func CanonicalDecisionMaterial(material DecisionMaterial) DecisionMaterial {
	return DecisionMaterial{
		RoutingMode:   canonicalValue(material.RoutingMode, RoutingModeAuto, map[string]struct{}{RoutingModeAuto: {}, RoutingModePinned: {}}),
		Category:      canonicalValue(material.Category, CategoryUnknown, map[string]struct{}{CategoryGeneral: {}, CategoryCode: {}, CategoryTranslation: {}, CategorySupportRefund: {}, CategoryUnknown: {}}),
		Tier:          canonicalValue(material.Tier, TierBalanced, map[string]struct{}{TierLowCost: {}, TierBalanced: {}, TierHighQuality: {}}),
		Capability:    canonicalValue(material.Capability, CapabilityChat, map[string]struct{}{CapabilityChat: {}, CapabilityReasoning: {}, CapabilityCode: {}, CapabilityTranslation: {}}),
		PolicyVariant: canonicalValue(material.PolicyVariant, PolicyVariantDefault, map[string]struct{}{PolicyVariantDefault: {}}),
	}
}

func DecisionKeyHash(material DecisionMaterial) (string, error) {
	canonical := CanonicalDecisionMaterial(material)
	payload, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func canonicalValue(value string, fallback string, allowed map[string]struct{}) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if _, ok := allowed[value]; ok {
		return value
	}
	return fallback
}
