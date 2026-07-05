package routing

import (
	"context"
	"strings"
	"unicode/utf8"
)

const (
	DefaultPolicyHash          = "route_p0_v1"
	DefaultShortPromptMaxChars = 300

	ReasonShortPromptLowCost     = "short_prompt_low_cost"
	ReasonDefaultBalanced        = "default_balanced"
	ReasonPinned                 = "pinned"
	ReasonCodeHighQuality        = "category_code_high_quality"
	ReasonTranslationBalanced    = "category_translation_balanced"
	ReasonSummarizationBalanced  = "category_summarization_balanced"
	ReasonExtractionJSONBalanced = "category_extraction_json_balanced"
	ReasonSupportRefundLowCost   = "category_support_refund_low_cost"
	ReasonReasoningHighQuality   = "category_reasoning_high_quality"
	ReasonAmbiguousBalanced      = "category_ambiguous_balanced"
	ReasonProviderHealthFallback = "provider_health_fallback"

	RouteCandidateAvailable   = "available"
	RouteCandidateDegraded    = "degraded"
	RouteCandidateUnavailable = "unavailable"
)

type SimpleRouterConfig struct {
	DefaultProvider     string
	DefaultModel        string
	LowCostProvider     string
	LowCostModel        string
	HighQualityProvider string
	HighQualityModel    string
	PolicyHash          string
	ShortPromptMaxChars int
	CandidateStatuses   []RouteCandidateStatus
}

type RouteCandidateStatus struct {
	Provider         string
	Model            string
	Tier             string
	Status           string
	FallbackPriority int
	LatencyP95Ms     int
}

type SimpleRouter struct {
	defaultProvider     string
	defaultModel        string
	lowCostProvider     string
	lowCostModel        string
	highQualityProvider string
	highQualityModel    string
	policyHash          string
	shortPromptMaxChars int
	candidateStatuses   []RouteCandidateStatus
	classifier          RuleBasedCategoryClassifier
}

func NewSimpleRouter(config SimpleRouterConfig) *SimpleRouter {
	normalized := normalizeSimpleRouterConfig(config)
	return &SimpleRouter{
		defaultProvider:     normalized.DefaultProvider,
		defaultModel:        normalized.DefaultModel,
		lowCostProvider:     normalized.LowCostProvider,
		lowCostModel:        normalized.LowCostModel,
		highQualityProvider: normalized.HighQualityProvider,
		highQualityModel:    normalized.HighQualityModel,
		policyHash:          normalized.PolicyHash,
		shortPromptMaxChars: normalized.ShortPromptMaxChars,
		candidateStatuses:   append([]RouteCandidateStatus(nil), normalized.CandidateStatuses...),
		classifier:          NewRuleBasedCategoryClassifier(),
	}
}

func normalizeSimpleRouterConfig(config SimpleRouterConfig) SimpleRouterConfig {
	config = SimpleRouterConfig{
		DefaultProvider:     strings.TrimSpace(config.DefaultProvider),
		DefaultModel:        strings.TrimSpace(config.DefaultModel),
		LowCostProvider:     strings.TrimSpace(config.LowCostProvider),
		LowCostModel:        strings.TrimSpace(config.LowCostModel),
		HighQualityProvider: strings.TrimSpace(config.HighQualityProvider),
		HighQualityModel:    strings.TrimSpace(config.HighQualityModel),
		PolicyHash:          strings.TrimSpace(config.PolicyHash),
		ShortPromptMaxChars: config.ShortPromptMaxChars,
		CandidateStatuses:   normalizeRouteCandidateStatuses(config.CandidateStatuses),
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
	if config.LowCostProvider == "" {
		config.LowCostProvider = config.DefaultProvider
	}
	if config.HighQualityModel == "" {
		config.HighQualityModel = "mock-smart"
	}
	if config.HighQualityProvider == "" {
		config.HighQualityProvider = config.DefaultProvider
	}
	if config.PolicyHash == "" {
		config.PolicyHash = DefaultPolicyHash
	}
	if config.ShortPromptMaxChars <= 0 {
		config.ShortPromptMaxChars = DefaultShortPromptMaxChars
	}

	return config
}

func mergeSimpleRouterConfig(base SimpleRouterConfig, override SimpleRouterConfig) SimpleRouterConfig {
	merged := base
	overrideDefaultProvider := strings.TrimSpace(override.DefaultProvider)
	if overrideDefaultProvider != "" {
		merged.DefaultProvider = overrideDefaultProvider
	}
	if strings.TrimSpace(override.DefaultModel) != "" {
		merged.DefaultModel = override.DefaultModel
	}
	if strings.TrimSpace(override.LowCostProvider) != "" {
		merged.LowCostProvider = override.LowCostProvider
	} else if overrideDefaultProvider != "" {
		merged.LowCostProvider = overrideDefaultProvider
	}
	if strings.TrimSpace(override.LowCostModel) != "" {
		merged.LowCostModel = override.LowCostModel
	}
	if strings.TrimSpace(override.HighQualityProvider) != "" {
		merged.HighQualityProvider = override.HighQualityProvider
	} else if overrideDefaultProvider != "" {
		merged.HighQualityProvider = overrideDefaultProvider
	}
	if strings.TrimSpace(override.HighQualityModel) != "" {
		merged.HighQualityModel = override.HighQualityModel
	}
	if strings.TrimSpace(override.PolicyHash) != "" {
		merged.PolicyHash = override.PolicyHash
	}
	if override.ShortPromptMaxChars > 0 {
		merged.ShortPromptMaxChars = override.ShortPromptMaxChars
	}
	if len(override.CandidateStatuses) > 0 {
		merged.CandidateStatuses = append([]RouteCandidateStatus(nil), override.CandidateStatuses...)
	}
	return normalizeSimpleRouterConfig(merged)
}

func (r *SimpleRouter) DecideRoute(_ context.Context, req Request) (Decision, error) {
	config := SimpleRouterConfig{}
	classifier := NewRuleBasedCategoryClassifier()
	if r != nil {
		classifier = r.classifier
		if classifier.compiled.policy.Rules == nil {
			classifier = NewRuleBasedCategoryClassifier()
		}
		config = SimpleRouterConfig{
			DefaultProvider:     r.defaultProvider,
			DefaultModel:        r.defaultModel,
			LowCostProvider:     r.lowCostProvider,
			LowCostModel:        r.lowCostModel,
			HighQualityProvider: r.highQualityProvider,
			HighQualityModel:    r.highQualityModel,
			PolicyHash:          r.policyHash,
			ShortPromptMaxChars: r.shortPromptMaxChars,
			CandidateStatuses:   append([]RouteCandidateStatus(nil), r.candidateStatuses...),
		}
	}
	config = normalizeSimpleRouterConfig(config)
	if req.Config != nil {
		config = mergeSimpleRouterConfig(config, *req.Config)
	}

	requestedModel := strings.TrimSpace(req.RequestedModel)
	if requestedModel == "" {
		requestedModel = config.DefaultModel
	}
	signals := classifier.ExtractRoutingSignals(req.PromptText)
	category := signals.Category
	diagnostics := routeDiagnosticsForCategory(category, signals.CategoryDiagnostics.WithSelectedCategory(category))
	capability := capabilityForCategory(category)

	decision := Decision{
		RequestedModel:             requestedModel,
		SelectedProvider:           config.DefaultProvider,
		SelectedProviderCatalogKey: config.DefaultProvider,
		PolicyHash:                 config.PolicyHash,
		CategoryDiagnostics:        diagnostics,
	}

	if strings.EqualFold(requestedModel, "auto") {
		selectedProvider, selectedModel, tier, reason := autoRouteForCategory(category, diagnostics, req.PromptText, config)
		policyVariant := PolicyVariantDefault
		selectedProvider, selectedModel, tier, reason, policyVariant = applyCandidateStatusFallback(selectedProvider, selectedModel, tier, reason, config)
		decision.SelectedProvider = selectedProvider
		decision.SelectedProviderCatalogKey = selectedProvider
		decision.SelectedModel = selectedModel
		decision.SelectedModelID = selectedModel
		decision.RoutingDecisionMaterial = DecisionMaterial{
			RoutingMode:   RoutingModeAuto,
			Category:      category,
			Tier:          tier,
			Capability:    capability,
			PolicyVariant: policyVariant,
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

func autoRouteForCategory(category string, diagnostics CategoryDiagnostics, prompt string, config SimpleRouterConfig) (string, string, string, string) {
	if diagnostics.Ambiguous {
		return config.DefaultProvider, config.DefaultModel, TierBalanced, ReasonAmbiguousBalanced
	}
	switch canonicalCategory(category) {
	case CategoryCode:
		return config.HighQualityProvider, config.HighQualityModel, TierHighQuality, ReasonCodeHighQuality
	case CategoryReasoning:
		return config.HighQualityProvider, config.HighQualityModel, TierHighQuality, ReasonReasoningHighQuality
	case CategoryTranslation:
		return config.DefaultProvider, config.DefaultModel, TierBalanced, ReasonTranslationBalanced
	case CategorySummarization:
		return config.DefaultProvider, config.DefaultModel, TierBalanced, ReasonSummarizationBalanced
	case CategoryExtractionJSON:
		return config.DefaultProvider, config.DefaultModel, TierBalanced, ReasonExtractionJSONBalanced
	case CategorySupportRefund:
		return config.LowCostProvider, config.LowCostModel, TierLowCost, ReasonSupportRefundLowCost
	case CategoryUnknown:
		return config.DefaultProvider, config.DefaultModel, TierBalanced, ReasonDefaultBalanced
	}

	if utf8.RuneCountInString(prompt) <= config.ShortPromptMaxChars {
		return config.LowCostProvider, config.LowCostModel, TierLowCost, ReasonShortPromptLowCost
	}
	return config.DefaultProvider, config.DefaultModel, TierBalanced, ReasonDefaultBalanced
}

func categoryCertainForHighQuality(diagnostics CategoryDiagnostics) bool {
	return diagnostics.Confidence == RoutingConfidenceHigh && !diagnostics.Ambiguous
}

func routeDiagnosticsForCategory(category string, diagnostics CategoryDiagnostics) CategoryDiagnostics {
	category = canonicalCategory(category)
	if (category == CategoryCode || category == CategoryReasoning) && !categoryCertainForHighQuality(diagnostics) {
		diagnostics.Ambiguous = true
		diagnostics.Confidence = RoutingConfidenceLow
		if diagnostics.AmbiguityReason == "" {
			diagnostics.AmbiguityReason = AmbiguityReasonUncertain
		}
	}
	return diagnostics
}

func applyCandidateStatusFallback(provider string, model string, tier string, reason string, config SimpleRouterConfig) (string, string, string, string, string) {
	if !routeCandidateIsUnavailable(provider, model, config.CandidateStatuses) {
		return provider, model, tier, reason, PolicyVariantDefault
	}

	fallback, ok := bestAvailableRouteCandidate(provider, model, config)
	if !ok {
		return provider, model, tier, reason, PolicyVariantDefault
	}
	return fallback.Provider, fallback.Model, fallback.Tier, ReasonProviderHealthFallback, PolicyVariantProviderHealthFallback
}

func bestAvailableRouteCandidate(excludeProvider string, excludeModel string, config SimpleRouterConfig) (RouteCandidateStatus, bool) {
	candidates := routeCandidatesForConfig(config)
	var selected RouteCandidateStatus
	found := false
	for _, candidate := range candidates {
		if sameRouteCandidate(candidate.Provider, candidate.Model, excludeProvider, excludeModel) {
			continue
		}
		if candidate.Status == RouteCandidateUnavailable {
			continue
		}
		if !routeCandidateAllowedForHealthFallback(candidate.Tier) {
			continue
		}
		if !found || routeCandidateLess(candidate, selected) {
			selected = candidate
			found = true
		}
	}
	return selected, found
}

func routeCandidateAllowedForHealthFallback(candidateTier string) bool {
	return canonicalTier(candidateTier) != TierHighQuality
}

func routeCandidatesForConfig(config SimpleRouterConfig) []RouteCandidateStatus {
	config = normalizeSimpleRouterConfig(config)
	candidates := []RouteCandidateStatus{
		defaultRouteCandidate(config.DefaultProvider, config.DefaultModel, TierBalanced, 10),
		defaultRouteCandidate(config.LowCostProvider, config.LowCostModel, TierLowCost, 20),
		defaultRouteCandidate(config.HighQualityProvider, config.HighQualityModel, TierHighQuality, 30),
	}

	for i := range candidates {
		if status, ok := routeCandidateStatusFor(candidates[i].Provider, candidates[i].Model, config.CandidateStatuses); ok {
			candidates[i] = mergeRouteCandidateStatus(candidates[i], status)
		}
	}
	return candidates
}

func defaultRouteCandidate(provider string, model string, tier string, fallbackPriority int) RouteCandidateStatus {
	return RouteCandidateStatus{
		Provider:         strings.TrimSpace(provider),
		Model:            strings.TrimSpace(model),
		Tier:             canonicalTier(tier),
		Status:           RouteCandidateAvailable,
		FallbackPriority: fallbackPriority,
	}
}

func mergeRouteCandidateStatus(candidate RouteCandidateStatus, status RouteCandidateStatus) RouteCandidateStatus {
	if status.Tier != "" {
		candidate.Tier = status.Tier
	}
	if status.Status != "" {
		candidate.Status = status.Status
	}
	if status.FallbackPriority > 0 {
		candidate.FallbackPriority = status.FallbackPriority
	}
	if status.LatencyP95Ms > 0 {
		candidate.LatencyP95Ms = status.LatencyP95Ms
	}
	return candidate
}

func routeCandidateIsUnavailable(provider string, model string, statuses []RouteCandidateStatus) bool {
	status, ok := routeCandidateStatusFor(provider, model, statuses)
	return ok && status.Status == RouteCandidateUnavailable
}

func routeCandidateStatusFor(provider string, model string, statuses []RouteCandidateStatus) (RouteCandidateStatus, bool) {
	provider = strings.TrimSpace(provider)
	model = strings.TrimSpace(model)
	for _, status := range statuses {
		if sameRouteCandidate(status.Provider, status.Model, provider, model) {
			return status, true
		}
	}
	return RouteCandidateStatus{}, false
}

func sameRouteCandidate(leftProvider string, leftModel string, rightProvider string, rightModel string) bool {
	return strings.TrimSpace(leftProvider) == strings.TrimSpace(rightProvider) &&
		strings.TrimSpace(leftModel) == strings.TrimSpace(rightModel)
}

func routeCandidateLess(left RouteCandidateStatus, right RouteCandidateStatus) bool {
	leftStatus := routeCandidateStatusPriority(left.Status)
	rightStatus := routeCandidateStatusPriority(right.Status)
	if leftStatus != rightStatus {
		return leftStatus < rightStatus
	}
	leftPriority := normalizedFallbackPriority(left.FallbackPriority)
	rightPriority := normalizedFallbackPriority(right.FallbackPriority)
	if leftPriority != rightPriority {
		return leftPriority < rightPriority
	}
	leftLatency := normalizedLatencyP95(left.LatencyP95Ms)
	rightLatency := normalizedLatencyP95(right.LatencyP95Ms)
	if leftLatency != rightLatency {
		return leftLatency < rightLatency
	}
	if left.Provider != right.Provider {
		return left.Provider < right.Provider
	}
	return left.Model < right.Model
}

func routeCandidateStatusPriority(status string) int {
	switch canonicalRouteCandidateStatus(status) {
	case RouteCandidateAvailable:
		return 1
	case RouteCandidateDegraded:
		return 2
	default:
		return 3
	}
}

func normalizedFallbackPriority(value int) int {
	if value <= 0 {
		return 1000
	}
	return value
}

func normalizedLatencyP95(value int) int {
	if value <= 0 {
		return 1 << 30
	}
	return value
}

func normalizeRouteCandidateStatuses(statuses []RouteCandidateStatus) []RouteCandidateStatus {
	if len(statuses) == 0 {
		return nil
	}
	normalized := make([]RouteCandidateStatus, 0, len(statuses))
	for _, status := range statuses {
		status.Provider = strings.TrimSpace(status.Provider)
		status.Model = strings.TrimSpace(status.Model)
		if status.Provider == "" || status.Model == "" {
			continue
		}
		if strings.TrimSpace(status.Tier) != "" {
			status.Tier = canonicalTier(status.Tier)
		}
		status.Status = canonicalRouteCandidateStatus(status.Status)
		normalized = append(normalized, status)
	}
	return normalized
}

func canonicalRouteCandidateStatus(value string) string {
	switch strings.TrimSpace(value) {
	case RouteCandidateUnavailable:
		return RouteCandidateUnavailable
	case RouteCandidateDegraded:
		return RouteCandidateDegraded
	default:
		return RouteCandidateAvailable
	}
}
