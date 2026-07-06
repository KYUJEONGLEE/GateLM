package cache

import "strings"

const (
	SemanticCacheStoreModeDisabled      = "disabled"
	SemanticCacheStoreModeStrictStore   = "strict_store"
	SemanticCacheStoreModeCandidateOnly = "candidate_only"

	SemanticCacheResponseCacheabilityStaticGuidance   = "static_guidance"
	SemanticCacheResponseCacheabilityPolicySummary    = "policy_summary"
	SemanticCacheResponseCacheabilityDynamicUserState = "dynamic_user_state"
	SemanticCacheResponseCacheabilityCredentialSecret = "credential_or_secret"
	SemanticCacheResponseCacheabilityProviderError    = "provider_error"
	SemanticCacheResponseCacheabilityUnsafeOrUnknown  = "unsafe_or_unknown"
	SemanticCacheProviderOutcomeSuccess               = "success"
	SemanticCacheProviderOutcomeError                 = "error"
	SemanticCacheReasonStoreAllowed                   = "store_allowed"
	SemanticCacheReasonResponseNotCacheable           = "response_not_cacheable"
	SemanticCacheReasonDynamicUserState               = "dynamic_user_state_denied"
	SemanticCacheReasonFallbackResponse               = "fallback_store_bypass"
	SemanticCacheReasonStreamingResponse              = "stream_bypass"
	SemanticCacheReasonProviderError                  = "provider_error"
)

type SemanticCacheStorePolicy struct {
	PolicyVersion string                                      `json:"semanticCacheStorePolicyVersion"`
	DefaultMode   string                                      `json:"defaultMode"`
	Categories    map[string]SemanticCacheCategoryStorePolicy `json:"categories"`
}

type SemanticCacheCategoryStorePolicy struct {
	Mode                          string   `json:"mode"`
	AllowCacheabilityClasses      []string `json:"allowCacheabilityClasses"`
	DenyCacheabilityClasses       []string `json:"denyCacheabilityClasses"`
	RequiresIntent                bool     `json:"requiresIntent"`
	RequiresRequiredSlots         bool     `json:"requiresRequiredSlots"`
	RequiresForbiddenPayloadGuard bool     `json:"requiresForbiddenPayloadGuard"`
	RequiresProviderSuccess       bool     `json:"requiresProviderSuccess"`
	DenyFallback                  bool     `json:"denyFallback"`
	DenyStream                    bool     `json:"denyStream"`
}

type SemanticCacheStoreMaterial struct {
	Category                  string
	CanonicalIntent           string
	RequiredSlotsHash         string
	ResponseCacheabilityClass string
	ProviderOutcome           string
	FallbackUsed              bool
	Stream                    bool
	ContainsForbiddenPayload  bool
	ContainsDynamicUserState  bool
	StorePolicyVersion        string
}

type SemanticCacheStoreDecision struct {
	Enabled                   bool
	Allowed                   bool
	Reason                    string
	Category                  string
	CanonicalIntent           string
	RequiredSlotsHash         string
	ResponseCacheabilityClass string
	StorePolicyVersion        string
}

func DefaultSemanticCacheStorePolicy() SemanticCacheStorePolicy {
	return SemanticCacheStorePolicy{
		PolicyVersion: "store-v1",
		DefaultMode:   SemanticCacheStoreModeDisabled,
		Categories: map[string]SemanticCacheCategoryStorePolicy{
			SemanticCacheCategoryGeneral: {
				Mode:                          SemanticCacheStoreModeStrictStore,
				AllowCacheabilityClasses:      []string{SemanticCacheResponseCacheabilityStaticGuidance},
				RequiresIntent:                true,
				RequiresRequiredSlots:         true,
				RequiresForbiddenPayloadGuard: true,
				RequiresProviderSuccess:       true,
				DenyFallback:                  true,
			},
			SemanticCacheCategoryAccountAccess: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategorySupportRefund: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategoryCode: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategoryTranslation: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategoryReasoning: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategorySensitive: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategoryToolCall: {
				Mode: SemanticCacheStoreModeDisabled,
			},
			SemanticCacheCategoryUnknown: {
				Mode: SemanticCacheStoreModeDisabled,
			},
		},
	}
}

func (p SemanticCacheStorePolicy) Normalize() SemanticCacheStorePolicy {
	p.PolicyVersion = strings.TrimSpace(p.PolicyVersion)
	if p.PolicyVersion == "" {
		p.PolicyVersion = "v1"
	}
	p.DefaultMode = strings.TrimSpace(p.DefaultMode)
	if p.DefaultMode == "" {
		p.DefaultMode = SemanticCacheStoreModeDisabled
	}
	normalizedCategories := map[string]SemanticCacheCategoryStorePolicy{}
	for category, mode := range p.Categories {
		canonicalCategory := canonicalIntentCategory(category)
		if canonicalCategory == "" {
			continue
		}
		normalizedCategories[canonicalCategory] = mode.Normalize()
	}
	p.Categories = normalizedCategories
	return p
}

func (p SemanticCacheStorePolicy) Configured() bool {
	return len(p.Categories) > 0
}

func (p SemanticCacheStorePolicy) EvaluatePreIntent(material SemanticCacheStoreMaterial) SemanticCacheStoreDecision {
	material = material.Normalize(p.PolicyVersion)
	decision := semanticCacheStoreDecision(material)
	mode := p.categoryPolicy(material.Category)
	if mode.Mode == SemanticCacheStoreModeDisabled {
		decision.Reason = semanticCacheCategoryDenyReason(material.Category)
		return decision
	}
	if mode.DenyStream && material.Stream {
		decision.Reason = SemanticCacheReasonStreamingResponse
		return decision
	}
	if mode.DenyFallback && material.FallbackUsed {
		decision.Reason = SemanticCacheReasonFallbackResponse
		return decision
	}
	if mode.RequiresProviderSuccess && material.ProviderOutcome != SemanticCacheProviderOutcomeSuccess {
		decision.Reason = SemanticCacheReasonProviderErrorStoreBypass
		return decision
	}
	if mode.RequiresForbiddenPayloadGuard && material.ContainsForbiddenPayload {
		decision.Reason = SemanticCacheReasonPayloadUnsafe
		return decision
	}
	if material.ContainsDynamicUserState || material.ResponseCacheabilityClass == SemanticCacheResponseCacheabilityDynamicUserState {
		decision.Reason = SemanticCacheReasonDynamicUserState
		return decision
	}
	decision.Allowed = true
	decision.Reason = SemanticCacheReasonStoreAllowed
	return decision
}

func (p SemanticCacheStorePolicy) Evaluate(material SemanticCacheStoreMaterial) SemanticCacheStoreDecision {
	preDecision := p.EvaluatePreIntent(material)
	if !preDecision.Allowed {
		return preDecision
	}
	material = material.Normalize(p.PolicyVersion)
	decision := semanticCacheStoreDecision(material)
	mode := p.categoryPolicy(material.Category)
	if mode.RequiresIntent && material.CanonicalIntent == "" {
		decision.Reason = SemanticCacheReasonIntentUnavailable
		return decision
	}
	if mode.RequiresRequiredSlots && material.RequiredSlotsHash == "" {
		decision.Reason = SemanticCacheReasonSlotsUnavailable
		return decision
	}
	if mode.cacheabilityDenied(material.ResponseCacheabilityClass) || !mode.cacheabilityAllowed(material.ResponseCacheabilityClass) {
		decision.Reason = SemanticCacheReasonResponseNotCacheable
		return decision
	}
	if mode.Mode == SemanticCacheStoreModeCandidateOnly {
		decision.Reason = SemanticCacheReasonCandidateOnly
		return decision
	}
	decision.Allowed = true
	decision.Reason = SemanticCacheReasonStoreAllowed
	return decision
}

func (p SemanticCacheStorePolicy) categoryPolicy(category string) SemanticCacheCategoryStorePolicy {
	category = canonicalIntentCategory(category)
	if mode, ok := p.Categories[category]; ok {
		return mode.Normalize()
	}
	return SemanticCacheCategoryStorePolicy{Mode: p.DefaultMode}.Normalize()
}

func (p SemanticCacheCategoryStorePolicy) Normalize() SemanticCacheCategoryStorePolicy {
	p.Mode = strings.TrimSpace(p.Mode)
	if p.Mode == "" {
		p.Mode = SemanticCacheStoreModeDisabled
	}
	p.AllowCacheabilityClasses = normalizeSemanticStringList(p.AllowCacheabilityClasses)
	p.DenyCacheabilityClasses = normalizeSemanticStringList(p.DenyCacheabilityClasses)
	return p
}

func (p SemanticCacheCategoryStorePolicy) cacheabilityAllowed(cacheabilityClass string) bool {
	cacheabilityClass = strings.TrimSpace(cacheabilityClass)
	if cacheabilityClass == "" {
		cacheabilityClass = SemanticCacheResponseCacheabilityUnsafeOrUnknown
	}
	if len(p.AllowCacheabilityClasses) == 0 {
		return true
	}
	for _, allowed := range p.AllowCacheabilityClasses {
		if allowed == cacheabilityClass {
			return true
		}
	}
	return false
}

func (p SemanticCacheCategoryStorePolicy) cacheabilityDenied(cacheabilityClass string) bool {
	cacheabilityClass = strings.TrimSpace(cacheabilityClass)
	if cacheabilityClass == "" {
		cacheabilityClass = SemanticCacheResponseCacheabilityUnsafeOrUnknown
	}
	for _, denied := range p.DenyCacheabilityClasses {
		if denied == cacheabilityClass {
			return true
		}
	}
	return false
}

func semanticCacheStoreMaterialFromRequest(request SemanticCacheStoreRequest, intentMaterial SemanticCacheIntentMaterial) SemanticCacheStoreMaterial {
	category := intentMaterial.Category
	if category == "" {
		category = request.Boundary.PromptCategory
	}
	providerOutcome := strings.TrimSpace(request.ProviderOutcome)
	if providerOutcome == "" {
		providerOutcome = SemanticCacheProviderOutcomeSuccess
	}
	cacheabilityClass := strings.TrimSpace(request.ResponseCacheabilityClass)
	if cacheabilityClass == "" {
		cacheabilityClass = SemanticCacheResponseCacheabilityUnsafeOrUnknown
	}
	forbiddenPayload := containsForbiddenSemanticCachePayload(request.CachedResponse)
	dynamicUserState := containsDynamicSemanticCachePayload(request.CachedResponse)
	if forbiddenPayload {
		cacheabilityClass = SemanticCacheResponseCacheabilityCredentialSecret
	} else if dynamicUserState {
		cacheabilityClass = SemanticCacheResponseCacheabilityDynamicUserState
	} else if providerOutcome != SemanticCacheProviderOutcomeSuccess {
		cacheabilityClass = SemanticCacheResponseCacheabilityProviderError
	}
	return SemanticCacheStoreMaterial{
		Category:                  category,
		CanonicalIntent:           intentMaterial.CanonicalIntent,
		RequiredSlotsHash:         intentMaterial.RequiredSlotsHash,
		ResponseCacheabilityClass: cacheabilityClass,
		ProviderOutcome:           providerOutcome,
		FallbackUsed:              request.FallbackUsed,
		Stream:                    request.Stream,
		ContainsForbiddenPayload:  forbiddenPayload,
		ContainsDynamicUserState:  dynamicUserState,
	}
}

func (m SemanticCacheStoreMaterial) Normalize(policyVersion string) SemanticCacheStoreMaterial {
	m.Category = canonicalIntentCategory(m.Category)
	m.CanonicalIntent = strings.TrimSpace(m.CanonicalIntent)
	m.RequiredSlotsHash = strings.TrimSpace(m.RequiredSlotsHash)
	m.ResponseCacheabilityClass = strings.TrimSpace(m.ResponseCacheabilityClass)
	if m.ResponseCacheabilityClass == "" {
		m.ResponseCacheabilityClass = SemanticCacheResponseCacheabilityUnsafeOrUnknown
	}
	m.ProviderOutcome = strings.TrimSpace(m.ProviderOutcome)
	if m.ProviderOutcome == "" {
		m.ProviderOutcome = SemanticCacheProviderOutcomeSuccess
	}
	m.StorePolicyVersion = strings.TrimSpace(policyVersion)
	return m
}

func semanticCacheStoreDecision(material SemanticCacheStoreMaterial) SemanticCacheStoreDecision {
	return SemanticCacheStoreDecision{
		Enabled:                   true,
		Category:                  material.Category,
		CanonicalIntent:           material.CanonicalIntent,
		RequiredSlotsHash:         material.RequiredSlotsHash,
		ResponseCacheabilityClass: material.ResponseCacheabilityClass,
		StorePolicyVersion:        material.StorePolicyVersion,
	}
}

func semanticCacheCategoryDenyReason(category string) string {
	switch canonicalIntentCategory(category) {
	case SemanticCacheCategoryAccountAccess:
		return SemanticCacheReasonAccountAccessDenied
	case SemanticCacheCategorySupportRefund:
		return SemanticCacheReasonSupportRefundDenied
	default:
		return SemanticCacheReasonCategoryDenied
	}
}

func containsDynamicSemanticCachePayload(payload []byte) bool {
	lowered := strings.ToLower(string(payload))
	for _, marker := range []string{
		"account status",
		"billing amount",
		"current usage",
		"invoice status",
		"order status",
		"payment status",
		"quota remaining",
		"refund status",
		"usage_count",
		"계정 상태",
		"결제 상태",
		"남은 한도",
		"이번 달 사용량",
		"주문 상태",
		"처리 상태",
		"환불 상태",
	} {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}
