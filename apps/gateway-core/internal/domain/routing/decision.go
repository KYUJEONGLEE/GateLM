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

// Decision is the routing-policy result. It intentionally contains only an
// opaque model reference. Provider and concrete model identifiers are resolved
// at the provider-attempt boundary, after routing has completed.
type Decision struct {
	RequestedModel          string
	ModelRef                string
	CandidateModelRefs      []string
	RoutingDecisionKeyHash  string
	RoutingDecisionMaterial DecisionMaterial
	RoutingReason           string
	PolicyHash              string
	CategoryDiagnostics     CategoryDiagnostics
}

// ResolvedTarget is an internal execution-boundary value. It is populated only
// after an opaque modelRef has been resolved through the provider catalog and
// must never be copied into a routing decision or routing summary contract.
type ResolvedTarget struct {
	ProviderID string
	ModelID    string
}

type DecisionMaterial struct {
	RoutingMode   string `json:"routingMode"`
	Category      string `json:"category"`
	Difficulty    string `json:"difficulty"`
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
	RoutingModeManual = "manual"

	RoutingPolicyModeAuto   = RoutingModeAuto
	RoutingPolicyModeManual = RoutingModeManual

	CategoryGeneral       = "general"
	CategoryCode          = "code"
	CategoryTranslation   = "translation"
	CategorySummarization = "summarization"
	CategoryReasoning     = "reasoning"

	DifficultySimple  = "simple"
	DifficultyComplex = "complex"

	CapabilityChat          = "chat"
	CapabilityReasoning     = "reasoning"
	CapabilityCode          = "code"
	CapabilityTranslation   = "translation"
	CapabilitySummarization = "summarization"

	PolicyVariantDefault                = "default"
	PolicyVariantProviderHealthFallback = "provider_health_fallback"

	RoutingConfidenceHigh   = "high"
	RoutingConfidenceMedium = "medium"
	RoutingConfidenceLow    = "low"

	AmbiguityReasonLowScore  = "low_score"
	AmbiguityReasonLowMargin = "low_margin"
)

var Categories = [...]string{
	CategoryGeneral,
	CategoryCode,
	CategoryTranslation,
	CategorySummarization,
	CategoryReasoning,
}

func CanonicalDecisionMaterial(material DecisionMaterial) DecisionMaterial {
	return DecisionMaterial{
		RoutingMode:   canonicalRoutingMode(material.RoutingMode),
		Category:      canonicalCategory(material.Category),
		Difficulty:    canonicalDifficulty(material.Difficulty),
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
	switch strings.TrimSpace(strings.ToLower(value)) {
	case RoutingModeManual:
		return RoutingModeManual
	default:
		return RoutingModeAuto
	}
}

// canonicalCategory is intentionally closed over the five v2 categories.
// Every removed, unknown, or missing category is folded into general.
func canonicalCategory(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case CategoryCode:
		return CategoryCode
	case CategoryTranslation:
		return CategoryTranslation
	case CategorySummarization:
		return CategorySummarization
	case CategoryReasoning:
		return CategoryReasoning
	default:
		return CategoryGeneral
	}
}

func canonicalDifficulty(value string) string {
	if strings.TrimSpace(strings.ToLower(value)) == DifficultyComplex {
		return DifficultyComplex
	}
	return DifficultySimple
}

func canonicalCapability(value string) string {
	switch strings.TrimSpace(value) {
	case CapabilityReasoning, CapabilityCode, CapabilityTranslation, CapabilitySummarization:
		return strings.TrimSpace(value)
	default:
		return CapabilityChat
	}
}

func canonicalPolicyVariant(value string) string {
	if strings.TrimSpace(value) == PolicyVariantProviderHealthFallback {
		return PolicyVariantProviderHealthFallback
	}
	return PolicyVariantDefault
}
