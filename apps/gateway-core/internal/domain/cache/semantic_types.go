package cache

import (
	"errors"
	"strings"
	"time"
)

const (
	SemanticCacheTypeSemantic = "semantic"
	SemanticCacheTypeNone     = "none"

	SemanticCacheOutcomeHit          = "hit"
	SemanticCacheOutcomeMiss         = "miss"
	SemanticCacheOutcomeBypassed     = "bypassed"
	SemanticCacheOutcomeStoreSkipped = "store_skipped"
)

var (
	ErrSemanticCacheBoundaryInvalid = errors.New("semantic cache boundary is invalid")
	ErrSemanticCacheEntryInvalid    = errors.New("semantic cache entry is invalid")
	ErrSemanticCachePayloadUnsafe   = errors.New("semantic cache payload contains forbidden sensitive material")
)

type SemanticCacheBoundary struct {
	TenantID                   string `json:"tenantId"`
	ProjectID                  string `json:"projectId"`
	ApplicationID              string `json:"applicationId"`
	PromptCategory             string `json:"promptCategory"`
	SelectedProviderID         string `json:"selectedProviderId"`
	SelectedModelID            string `json:"selectedModelId"`
	ProviderCatalogContentHash string `json:"providerCatalogContentHash"`
	RoutingPolicyHash          string `json:"routingPolicyHash"`
	RoutingDecisionKeyHash     string `json:"routingDecisionKeyHash"`
	SemanticCachePolicyHash    string `json:"semanticCachePolicyHash"`
	SafetyPolicyHash           string `json:"safetyPolicyHash"`
	MaskingPolicyHash          string `json:"maskingPolicyHash"`
	RequestParamsHash          string `json:"requestParamsHash"`
	CacheVersion               string `json:"cacheVersion"`
}

type SemanticCacheEntry struct {
	EntryID                    string
	RequestID                  string
	Boundary                   SemanticCacheBoundary
	IntentMaterial             SemanticCacheIntentMaterial
	EmbeddingVector            []float64
	CachedResponse             []byte
	CreatedAt                  time.Time
	ExpiresAt                  time.Time
	SemanticCachePolicyVersion string
}

type SemanticCacheMatch struct {
	Entry      SemanticCacheEntry
	Similarity float64
}

type SemanticCacheSearchResult struct {
	Hit                    bool
	MatchedEntry           *SemanticCacheEntry
	Similarity             float64
	Threshold              float64
	Reason                 string
	Matches                []SemanticCacheMatch
	QueryVector            []float64
	IntentMaterial         SemanticCacheIntentMaterial
	EmbeddingInput         NormalizedEmbeddingInput
	RerankerApplied        bool
	RerankerPassed         bool
	RerankerScore          float64
	RerankerThreshold      float64
	RerankerDecisionReason string
}

type SemanticCacheDecision struct {
	LookupAllowed               bool
	StoreAllowed                bool
	ReturnedFromCache           bool
	DenyReason                  string
	BypassReason                string
	CandidateHash               string
	Category                    string
	CanonicalIntent             string
	RequiredSlotsHash           string
	SimilarityScore             float64
	Threshold                   float64
	Enabled                     bool
	Outcome                     string
	CacheType                   string
	SemanticCacheHit            bool
	SemanticSimilarity          float64
	SemanticMatchedRequestID    string
	SemanticCacheThreshold      float64
	SemanticCachePolicyVersion  string
	SemanticCacheDecisionReason string
	EmbeddingProvider           string
	NormalizationVersion        string
	RerankerApplied             bool
	RerankerPassed              bool
	RerankerScore               float64
	RerankerThreshold           float64
	RerankerDecisionReason      string
}

func (b SemanticCacheBoundary) Normalize() SemanticCacheBoundary {
	return SemanticCacheBoundary{
		TenantID:                   strings.TrimSpace(b.TenantID),
		ProjectID:                  strings.TrimSpace(b.ProjectID),
		ApplicationID:              strings.TrimSpace(b.ApplicationID),
		PromptCategory:             strings.TrimSpace(b.PromptCategory),
		SelectedProviderID:         strings.TrimSpace(b.SelectedProviderID),
		SelectedModelID:            strings.TrimSpace(b.SelectedModelID),
		ProviderCatalogContentHash: strings.TrimSpace(b.ProviderCatalogContentHash),
		RoutingPolicyHash:          strings.TrimSpace(b.RoutingPolicyHash),
		RoutingDecisionKeyHash:     strings.TrimSpace(b.RoutingDecisionKeyHash),
		SemanticCachePolicyHash:    strings.TrimSpace(b.SemanticCachePolicyHash),
		SafetyPolicyHash:           strings.TrimSpace(b.SafetyPolicyHash),
		MaskingPolicyHash:          strings.TrimSpace(b.MaskingPolicyHash),
		RequestParamsHash:          strings.TrimSpace(b.RequestParamsHash),
		CacheVersion:               strings.TrimSpace(b.CacheVersion),
	}
}

func (b SemanticCacheBoundary) Validate() error {
	b = b.Normalize()
	if b.TenantID == "" ||
		b.ProjectID == "" ||
		b.ApplicationID == "" ||
		b.PromptCategory == "" ||
		b.SelectedProviderID == "" ||
		b.SelectedModelID == "" ||
		b.ProviderCatalogContentHash == "" ||
		b.RoutingPolicyHash == "" ||
		b.RoutingDecisionKeyHash == "" ||
		b.SemanticCachePolicyHash == "" ||
		b.SafetyPolicyHash == "" ||
		b.MaskingPolicyHash == "" ||
		b.RequestParamsHash == "" ||
		b.CacheVersion == "" {
		return ErrSemanticCacheBoundaryInvalid
	}
	return nil
}

func (b SemanticCacheBoundary) Equal(other SemanticCacheBoundary) bool {
	return b.Normalize() == other.Normalize()
}

func (e SemanticCacheEntry) Clone() SemanticCacheEntry {
	cloned := e
	cloned.Boundary = e.Boundary.Normalize()
	cloned.IntentMaterial = e.IntentMaterial.Clone()
	cloned.EmbeddingVector = append([]float64{}, e.EmbeddingVector...)
	cloned.CachedResponse = append([]byte{}, e.CachedResponse...)
	return cloned
}

func (r SemanticCacheSearchResult) Decision(enabled bool, embeddingProvider string, policyVersion string) SemanticCacheDecision {
	outcome := SemanticCacheOutcomeMiss
	cacheType := SemanticCacheTypeSemantic
	lookupAllowed := enabled
	storeAllowed := r.Reason == SemanticCacheReasonStored || r.Reason == SemanticCacheReasonStoreAllowed
	if !enabled {
		outcome = SemanticCacheOutcomeBypassed
		cacheType = SemanticCacheTypeNone
		lookupAllowed = false
	} else if r.Hit {
		outcome = SemanticCacheOutcomeHit
	}
	matchedRequestID := ""
	candidateHash := ""
	if r.MatchedEntry != nil {
		matchedRequestID = r.MatchedEntry.RequestID
		candidateHash = semanticDecisionCandidateHash(firstSemanticReason(r.MatchedEntry.RequestID, r.MatchedEntry.EntryID))
	}
	reason := strings.TrimSpace(r.Reason)
	denyReason, bypassReason := semanticDecisionReasonKinds(reason)
	intentMaterial := r.IntentMaterial.Normalize()
	return SemanticCacheDecision{
		LookupAllowed:               semanticDecisionLookupAllowed(lookupAllowed, denyReason, bypassReason),
		StoreAllowed:                storeAllowed,
		ReturnedFromCache:           r.Hit,
		DenyReason:                  denyReason,
		BypassReason:                bypassReason,
		CandidateHash:               candidateHash,
		Category:                    intentMaterial.Category,
		CanonicalIntent:             intentMaterial.CanonicalIntent,
		RequiredSlotsHash:           intentMaterial.RequiredSlotsHash,
		SimilarityScore:             r.Similarity,
		Threshold:                   r.Threshold,
		Enabled:                     enabled,
		Outcome:                     outcome,
		CacheType:                   cacheType,
		SemanticCacheHit:            r.Hit,
		SemanticSimilarity:          r.Similarity,
		SemanticMatchedRequestID:    matchedRequestID,
		SemanticCacheThreshold:      r.Threshold,
		SemanticCachePolicyVersion:  strings.TrimSpace(policyVersion),
		SemanticCacheDecisionReason: reason,
		EmbeddingProvider:           strings.TrimSpace(embeddingProvider),
		NormalizationVersion:        strings.TrimSpace(r.EmbeddingInput.NormalizationVersion),
		RerankerApplied:             r.RerankerApplied,
		RerankerPassed:              r.RerankerPassed,
		RerankerScore:               r.RerankerScore,
		RerankerThreshold:           r.RerankerThreshold,
		RerankerDecisionReason:      strings.TrimSpace(r.RerankerDecisionReason),
	}
}

func semanticDecisionLookupAllowed(enabled bool, denyReason string, bypassReason string) bool {
	if !enabled || strings.TrimSpace(bypassReason) != "" {
		return false
	}
	switch strings.TrimSpace(denyReason) {
	case "",
		SemanticCacheReasonIntentMismatch,
		SemanticCacheReasonSlotsUnavailable,
		SemanticCacheReasonSlotsMismatch,
		SemanticCacheReasonHardNegative,
		SemanticCacheReasonNoBoundaryMatch,
		SemanticCacheReasonThresholdMiss,
		SemanticCacheReasonEmbeddingFailure:
		return true
	case SemanticCacheReasonCategoryDenied,
		SemanticCacheReasonAccountAccessDenied,
		SemanticCacheReasonSupportRefundDenied,
		SemanticCacheReasonDynamicUserStateDenied,
		SemanticCacheReasonPayloadUnsafe,
		SemanticCacheReasonEmbeddingInputUnavailable,
		SemanticCacheReasonEmbeddingInputTooLong,
		SemanticCacheReasonEmbeddingInputCodeLike,
		SemanticCacheReasonIntentPolicyUnavailable,
		SemanticCacheReasonIntentUnavailable,
		SemanticCacheReasonIntentMaterialMissing,
		SemanticCacheReasonInvalidBoundary,
		SemanticCacheReasonInvalidVector:
		return false
	default:
		return false
	}
}

func semanticDecisionReasonKinds(reason string) (string, string) {
	reason = strings.TrimSpace(reason)
	if reason == "" || reason == SemanticCacheReasonHit || reason == SemanticCacheReasonStored || reason == SemanticCacheReasonStoreAllowed {
		return "", ""
	}
	switch reason {
	case SemanticCacheReasonDisabled,
		SemanticCacheReasonStreamBypass,
		SemanticCacheReasonFallbackStoreBypass,
		SemanticCacheReasonProviderErrorStoreBypass,
		SemanticCacheReasonStoreSkipped,
		SemanticCacheReasonScopeDenied,
		SemanticCacheReasonTenantDenied,
		SemanticCacheReasonApplicationDenied,
		SemanticCacheReasonCategoryScopeDenied,
		SemanticCacheReasonCandidateOnly,
		SemanticCacheReasonShadowWouldHit,
		SemanticCacheReasonShadowWouldMiss:
		return "", reason
	default:
		return reason, ""
	}
}

func semanticDecisionCandidateHash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return "sha256:" + sha256Hex([]byte(value))
}
