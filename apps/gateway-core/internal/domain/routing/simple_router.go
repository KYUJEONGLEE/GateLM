package routing

import (
	"context"
	"strings"
	"unicode/utf8"
)

const (
	DefaultPolicyHash          = "route_p0_v1"
	DefaultShortPromptMaxChars = 300

	ReasonShortPromptLowCost   = "short_prompt_low_cost"
	ReasonDefaultBalanced      = "default_balanced"
	ReasonPinned               = "pinned"
	ReasonCodeHighQuality      = "category_code_high_quality"
	ReasonTranslationBalanced  = "category_translation_balanced"
	ReasonSupportRefundLowCost = "category_support_refund_low_cost"
)

type SimpleRouterConfig struct {
	DefaultProvider     string
	DefaultModel        string
	LowCostModel        string
	HighQualityModel    string
	PolicyHash          string
	ShortPromptMaxChars int
}

type SimpleRouter struct {
	defaultProvider     string
	defaultModel        string
	lowCostModel        string
	highQualityModel    string
	policyHash          string
	shortPromptMaxChars int
}

func NewSimpleRouter(config SimpleRouterConfig) *SimpleRouter {
	normalized := normalizeSimpleRouterConfig(config)
	return &SimpleRouter{
		defaultProvider:     normalized.DefaultProvider,
		defaultModel:        normalized.DefaultModel,
		lowCostModel:        normalized.LowCostModel,
		highQualityModel:    normalized.HighQualityModel,
		policyHash:          normalized.PolicyHash,
		shortPromptMaxChars: normalized.ShortPromptMaxChars,
	}
}

func normalizeSimpleRouterConfig(config SimpleRouterConfig) SimpleRouterConfig {
	config = SimpleRouterConfig{
		DefaultProvider:     strings.TrimSpace(config.DefaultProvider),
		DefaultModel:        strings.TrimSpace(config.DefaultModel),
		LowCostModel:        strings.TrimSpace(config.LowCostModel),
		HighQualityModel:    strings.TrimSpace(config.HighQualityModel),
		PolicyHash:          strings.TrimSpace(config.PolicyHash),
		ShortPromptMaxChars: config.ShortPromptMaxChars,
	}

	if config.DefaultProvider == "" {
		config.DefaultProvider = "mock"
	}
	if config.DefaultModel == "" {
		config.DefaultModel = "mock-balanced"
	}
	if config.LowCostModel == "" {
		config.LowCostModel = "mock-fast"
	}
	if config.HighQualityModel == "" {
		config.HighQualityModel = "mock-smart"
	}
	if config.PolicyHash == "" {
		config.PolicyHash = DefaultPolicyHash
	}
	if config.ShortPromptMaxChars <= 0 {
		config.ShortPromptMaxChars = DefaultShortPromptMaxChars
	}

	return config
}

func (r *SimpleRouter) DecideRoute(_ context.Context, req Request) (Decision, error) {
	config := SimpleRouterConfig{}
	if r != nil {
		config = SimpleRouterConfig{
			DefaultProvider:     r.defaultProvider,
			DefaultModel:        r.defaultModel,
			LowCostModel:        r.lowCostModel,
			HighQualityModel:    r.highQualityModel,
			PolicyHash:          r.policyHash,
			ShortPromptMaxChars: r.shortPromptMaxChars,
		}
	}
	config = normalizeSimpleRouterConfig(config)
	if req.Config != nil {
		config = normalizeSimpleRouterConfig(*req.Config)
	}

	requestedModel := strings.TrimSpace(req.RequestedModel)
	if requestedModel == "" {
		requestedModel = config.DefaultModel
	}

	category := NewRuleBasedCategoryClassifier().Classify(req.PromptText)
	capability := capabilityForCategory(category)

	decision := Decision{
		RequestedModel:             requestedModel,
		SelectedProvider:           config.DefaultProvider,
		SelectedProviderCatalogKey: config.DefaultProvider,
		PolicyHash:                 config.PolicyHash,
	}

	if strings.EqualFold(requestedModel, "auto") {
		selectedModel, tier, reason := autoRouteForCategory(category, req.PromptText, config)
		decision.SelectedModel = selectedModel
		decision.SelectedModelID = selectedModel
		decision.RoutingDecisionMaterial = DecisionMaterial{
			RoutingMode:   RoutingModeAuto,
			Category:      category,
			Tier:          tier,
			Capability:    capability,
			PolicyVariant: PolicyVariantDefault,
		}
		decision.RoutingReason = reason
		decision.RoutingDecisionKeyHash, _ = DecisionKeyHash(decision.RoutingDecisionMaterial)
		return decision, nil
	}

	decision.SelectedModel = requestedModel
	decision.SelectedModelID = requestedModel
	decision.RoutingDecisionMaterial = DecisionMaterial{
		RoutingMode:   RoutingModePinned,
		Category:      category,
		Tier:          TierBalanced,
		Capability:    capability,
		PolicyVariant: PolicyVariantDefault,
	}
	decision.RoutingReason = ReasonPinned
	decision.RoutingDecisionKeyHash, _ = DecisionKeyHash(decision.RoutingDecisionMaterial)
	return decision, nil
}

func autoRouteForCategory(category string, prompt string, config SimpleRouterConfig) (string, string, string) {
	switch canonicalCategory(category) {
	case CategoryCode:
		return config.HighQualityModel, TierHighQuality, ReasonCodeHighQuality
	case CategoryTranslation:
		return config.DefaultModel, TierBalanced, ReasonTranslationBalanced
	case CategorySupportRefund:
		return config.LowCostModel, TierLowCost, ReasonSupportRefundLowCost
	}

	if utf8.RuneCountInString(prompt) <= config.ShortPromptMaxChars {
		return config.LowCostModel, TierLowCost, ReasonShortPromptLowCost
	}
	return config.DefaultModel, TierBalanced, ReasonDefaultBalanced
}
