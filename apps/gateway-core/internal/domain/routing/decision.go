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
	CategoryDiagnostics        CategoryDiagnostics
}

type DecisionMaterial struct {
	RoutingMode   string `json:"routingMode"`
	Category      string `json:"category"`
	Tier          string `json:"tier"`
	Capability    string `json:"capability"`
	PolicyVariant string `json:"policyVariant"`
}

type CategoryDiagnostics struct {
	SelectedCategory string          `json:"selectedCategory,omitempty"`
	TopCategory      string          `json:"topCategory,omitempty"`
	TopScore         int             `json:"topScore,omitempty"`
	SecondCategory   string          `json:"secondCategory,omitempty"`
	SecondScore      int             `json:"secondScore,omitempty"`
	ScoreMargin      int             `json:"scoreMargin,omitempty"`
	Confidence       string          `json:"confidence,omitempty"`
	Ambiguous        bool            `json:"ambiguous,omitempty"`
	AmbiguityReason  string          `json:"ambiguityReason,omitempty"`
	ScoreVector      []CategoryScore `json:"scoreVector,omitempty"`
}

type CategoryScore struct {
	Category string `json:"category"`
	Score    int    `json:"score"`
	Matched  bool   `json:"matched"`
}

const (
	RoutingModeAuto   = "auto"
	RoutingModePinned = "pinned"

	CategoryUnknown        = "unknown"
	CategoryGeneral        = "general"
	CategoryCode           = "code"
	CategoryTranslation    = "translation"
	CategorySummarization  = "summarization"
	CategoryExtractionJSON = "extraction_json"
	CategorySupportRefund  = "support_refund"
	CategoryReasoning      = "reasoning"

	TierLowCost     = "low_cost"
	TierBalanced    = "balanced"
	TierHighQuality = "high_quality"

	CapabilityChat          = "chat"
	CapabilityReasoning     = "reasoning"
	CapabilityCode          = "code"
	CapabilityTranslation   = "translation"
	CapabilitySummarization = "summarization"
	CapabilityJSON          = "json"

	PolicyVariantDefault                = "default"
	PolicyVariantProviderHealthFallback = "provider_health_fallback"

	RoutingConfidenceHigh   = "high"
	RoutingConfidenceMedium = "medium"
	RoutingConfidenceLow    = "low"

	AmbiguityReasonLowScore  = "low_score"
	AmbiguityReasonLowMargin = "low_margin"
	AmbiguityReasonRiskPair  = "risk_pair"
	AmbiguityReasonUncertain = "uncertain_high_quality"
)

func CanonicalDecisionMaterial(material DecisionMaterial) DecisionMaterial {
	return DecisionMaterial{
		RoutingMode:   canonicalRoutingMode(material.RoutingMode),
		Category:      canonicalCategory(material.Category),
		Tier:          canonicalTier(material.Tier),
		Capability:    canonicalCapability(material.Capability),
		PolicyVariant: canonicalPolicyVariant(material.PolicyVariant),
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

func canonicalRoutingMode(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case RoutingModeAuto, RoutingModePinned:
		return value
	default:
		return RoutingModeAuto
	}
}

func canonicalCategory(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case CategoryGeneral, CategoryCode, CategoryTranslation, CategorySummarization, CategoryExtractionJSON, CategorySupportRefund, CategoryReasoning, CategoryUnknown:
		return value
	default:
		return CategoryUnknown
	}
}

func canonicalTier(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case TierLowCost, TierBalanced, TierHighQuality:
		return value
	default:
		return TierBalanced
	}
}

func canonicalCapability(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case CapabilityChat, CapabilityReasoning, CapabilityCode, CapabilityTranslation, CapabilitySummarization, CapabilityJSON:
		return value
	default:
		return CapabilityChat
	}
}

func canonicalPolicyVariant(value string) string {
	value = strings.TrimSpace(value)
	switch value {
	case PolicyVariantDefault, PolicyVariantProviderHealthFallback:
		return value
	default:
		return PolicyVariantDefault
	}
}
