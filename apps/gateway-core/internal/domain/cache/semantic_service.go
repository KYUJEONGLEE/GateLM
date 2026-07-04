package cache

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	ErrSemanticCacheEmbeddingProviderUnavailable = errors.New("semantic cache embedding provider is unavailable")
	ErrSemanticCacheInputUnsafe                  = errors.New("semantic cache input is not normalized or contains forbidden material")
)

type SemanticCacheServiceConfig struct {
	Enabled                  bool
	Threshold                float64
	TopK                     int
	TTL                      time.Duration
	PolicyVersion            string
	HitPolicy                *SemanticCacheHitPolicy
	StorePolicy              *SemanticCacheStorePolicy
	EmbeddingInputNormalizer SemanticCacheEmbeddingInputNormalizer
	Reranker                 SemanticCacheReranker
}

type SemanticCacheLookupRequest struct {
	Boundary               SemanticCacheBoundary
	NormalizedText         string
	IntentMaterial         SemanticCacheIntentMaterial
	CacheabilityGatePassed bool
}

type SemanticCacheStoreRequest struct {
	EntryID                   string
	RequestID                 string
	Boundary                  SemanticCacheBoundary
	NormalizedText            string
	IntentMaterial            SemanticCacheIntentMaterial
	EmbeddingVector           []float64
	CachedResponse            []byte
	ResponseCacheabilityClass string
	ProviderOutcome           string
	FallbackUsed              bool
	Stream                    bool
	Now                       time.Time
}

type SemanticCacheService struct {
	store             SemanticCacheStore
	embeddingProvider EmbeddingProvider
	config            SemanticCacheServiceConfig
}

func NewSemanticCacheService(store SemanticCacheStore, embeddingProvider EmbeddingProvider, config SemanticCacheServiceConfig) SemanticCacheService {
	if config.Threshold <= 0 || config.Threshold > 1 {
		config.Threshold = 0.92
	}
	if config.TopK <= 0 {
		config.TopK = 3
	}
	if config.TTL <= 0 {
		config.TTL = time.Hour
	}
	config.PolicyVersion = strings.TrimSpace(config.PolicyVersion)
	if config.PolicyVersion == "" {
		config.PolicyVersion = "v1"
	}
	if config.HitPolicy != nil {
		normalizedPolicy, err := config.HitPolicy.Normalize()
		if err == nil {
			config.HitPolicy = &normalizedPolicy
		} else {
			config.HitPolicy = nil
		}
	}
	if config.StorePolicy != nil {
		normalizedPolicy := config.StorePolicy.Normalize()
		config.StorePolicy = &normalizedPolicy
	}
	return SemanticCacheService{
		store:             store,
		embeddingProvider: embeddingProvider,
		config:            config,
	}
}

func (s SemanticCacheService) Enabled() bool {
	return s.config.Enabled
}

func (s SemanticCacheService) Threshold() float64 {
	return s.config.Threshold
}

func (s SemanticCacheService) PolicyVersion() string {
	return s.config.PolicyVersion
}

func (s SemanticCacheService) EmbeddingProviderName() string {
	if s.embeddingProvider == nil {
		return ""
	}
	return s.embeddingProvider.ProviderName()
}

func (s SemanticCacheService) Search(ctx context.Context, request SemanticCacheLookupRequest) (SemanticCacheSearchResult, SemanticCacheDecision, error) {
	result := SemanticCacheSearchResult{
		Threshold: s.config.Threshold,
		Reason:    SemanticCacheReasonDisabled,
	}
	providerName := ""
	if s.embeddingProvider != nil {
		providerName = s.embeddingProvider.ProviderName()
	}
	if !s.config.Enabled {
		return result, result.Decision(false, providerName, s.config.PolicyVersion), nil
	}
	if s.store == nil {
		result.Reason = SemanticCacheReasonStoreSkipped
		return result, result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheStoreUnavailable
	}
	if s.embeddingProvider == nil {
		result.Reason = SemanticCacheReasonEmbeddingFailure
		return result, result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheEmbeddingProviderUnavailable
	}
	embeddingInput, ok := s.normalizeEmbeddingInput(request.NormalizedText)
	result.EmbeddingInput = embeddingInput
	if !ok {
		result.Reason = firstSemanticReason(embeddingInput.BypassReason, SemanticCacheReasonInvalidVector)
		return result, result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheInputUnsafe
	}
	normalizedText := embeddingInput.Text
	if !s.intentPolicyConfigured() {
		result.Reason = SemanticCacheReasonIntentPolicyUnavailable
		return result, result.Decision(true, providerName, s.config.PolicyVersion), nil
	}
	intentMaterial, intentReason, intentOK := s.intentMaterial(request.Boundary.PromptCategory, normalizedText, request.IntentMaterial)
	if !intentOK && !request.CacheabilityGatePassed {
		result.Reason = intentReason
		return result, result.Decision(true, providerName, s.config.PolicyVersion), nil
	}

	embedding, err := s.embeddingProvider.Embed(ctx, EmbeddingInput{NormalizedText: normalizedText})
	if err != nil {
		result.Reason = SemanticCacheReasonEmbeddingFailure
		return result, result.Decision(true, providerName, s.config.PolicyVersion), err
	}
	queryVector := append([]float64(nil), embedding.Vector...)
	threshold := s.config.Threshold
	if intentOK {
		threshold = s.intentThreshold(intentMaterial)
	}
	result, err = s.store.Search(ctx, request.Boundary, queryVector, threshold, s.config.TopK)
	result.QueryVector = queryVector
	result.IntentMaterial = intentMaterial
	result.EmbeddingInput = embeddingInput
	if !intentOK {
		if result.Hit {
			result.Hit = false
			result.MatchedEntry = nil
			result.Matches = nil
		}
		result.Reason = firstSemanticReason(intentReason, result.Reason)
		return result, result.Decision(true, providerName, s.config.PolicyVersion), err
	}
	result = s.applyHitPolicy(result, intentMaterial, threshold)
	result = s.applyReranker(ctx, result, intentMaterial, threshold)
	return result, result.Decision(true, providerName, s.config.PolicyVersion), err
}

func (s SemanticCacheService) Upsert(ctx context.Context, request SemanticCacheStoreRequest) (SemanticCacheDecision, error) {
	result := SemanticCacheSearchResult{
		Threshold: s.config.Threshold,
		Reason:    SemanticCacheReasonDisabled,
	}
	providerName := ""
	if s.embeddingProvider != nil {
		providerName = s.embeddingProvider.ProviderName()
	}
	if !s.config.Enabled {
		return result.Decision(false, providerName, s.config.PolicyVersion), nil
	}
	if s.store == nil {
		result.Reason = SemanticCacheReasonStoreSkipped
		return result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheStoreUnavailable
	}
	if s.embeddingProvider == nil {
		result.Reason = SemanticCacheReasonEmbeddingFailure
		return result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheEmbeddingProviderUnavailable
	}
	embeddingInput, ok := s.normalizeEmbeddingInput(request.NormalizedText)
	result.EmbeddingInput = embeddingInput
	if !ok {
		result.Reason = firstSemanticReason(embeddingInput.BypassReason, SemanticCacheReasonPayloadUnsafe)
		return result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheInputUnsafe
	}
	normalizedText := embeddingInput.Text
	if decision, bypass := s.preIntentStoreDecision(request); bypass {
		result.Reason = decision.Reason
		return result.Decision(true, providerName, s.config.PolicyVersion), nil
	}
	intentMaterial, intentReason, intentOK := s.intentMaterial(request.Boundary.PromptCategory, normalizedText, request.IntentMaterial)
	if s.intentPolicyConfigured() && !intentOK {
		result.Reason = intentReason
		return result.Decision(true, providerName, s.config.PolicyVersion), nil
	}
	if !s.intentPolicyConfigured() {
		result.Reason = SemanticCacheReasonIntentPolicyUnavailable
		return result.Decision(true, providerName, s.config.PolicyVersion), nil
	}
	if decision, bypass := s.storeDecision(request, intentMaterial); bypass {
		result.Reason = decision.Reason
		return result.Decision(true, providerName, s.config.PolicyVersion), nil
	}

	now := request.Now
	if now.IsZero() {
		now = time.Now()
	}
	embeddingVector := append([]float64(nil), request.EmbeddingVector...)
	if !isUsableSemanticVector(embeddingVector) {
		embedding, err := s.embeddingProvider.Embed(ctx, EmbeddingInput{NormalizedText: normalizedText})
		if err != nil {
			result.Reason = SemanticCacheReasonEmbeddingFailure
			return result.Decision(true, providerName, s.config.PolicyVersion), err
		}
		embeddingVector = append([]float64(nil), embedding.Vector...)
	}
	err := s.store.Upsert(ctx, SemanticCacheEntry{
		EntryID:                    request.EntryID,
		RequestID:                  request.RequestID,
		Boundary:                   request.Boundary,
		IntentMaterial:             intentMaterial,
		EmbeddingVector:            embeddingVector,
		CachedResponse:             request.CachedResponse,
		CreatedAt:                  now,
		ExpiresAt:                  now.Add(s.config.TTL),
		SemanticCachePolicyVersion: s.config.PolicyVersion,
	})
	if err != nil {
		if errors.Is(err, ErrSemanticCachePayloadUnsafe) {
			result.Reason = SemanticCacheReasonPayloadUnsafe
		} else {
			result.Reason = SemanticCacheReasonStoreSkipped
		}
		return result.Decision(true, providerName, s.config.PolicyVersion), err
	}
	result.Reason = SemanticCacheReasonStored
	return result.Decision(true, providerName, s.config.PolicyVersion), nil
}

func (s SemanticCacheService) intentPolicyConfigured() bool {
	return s.config.HitPolicy != nil && s.config.HitPolicy.Configured()
}

func (s SemanticCacheService) storePolicyConfigured() bool {
	return s.config.StorePolicy != nil && s.config.StorePolicy.Configured()
}

func (s SemanticCacheService) preIntentStoreDecision(request SemanticCacheStoreRequest) (SemanticCacheStoreDecision, bool) {
	if !s.storePolicyConfigured() {
		return SemanticCacheStoreDecision{}, false
	}
	material := semanticCacheStoreMaterialFromRequest(request, SemanticCacheIntentMaterial{})
	decision := s.config.StorePolicy.EvaluatePreIntent(material)
	return decision, !decision.Allowed
}

func (s SemanticCacheService) storeDecision(request SemanticCacheStoreRequest, intentMaterial SemanticCacheIntentMaterial) (SemanticCacheStoreDecision, bool) {
	if !s.storePolicyConfigured() {
		return SemanticCacheStoreDecision{}, false
	}
	material := semanticCacheStoreMaterialFromRequest(request, intentMaterial)
	decision := s.config.StorePolicy.Evaluate(material)
	return decision, !decision.Allowed
}

func (s SemanticCacheService) intentMaterial(category string, normalizedText string, provided SemanticCacheIntentMaterial) (SemanticCacheIntentMaterial, string, bool) {
	provided = provided.Normalize()
	if !provided.IsZero() {
		return provided, SemanticCacheReasonHit, true
	}
	if !s.intentPolicyConfigured() {
		return SemanticCacheIntentMaterial{}, SemanticCacheReasonIntentPolicyUnavailable, false
	}
	material, decision := s.config.HitPolicy.Materialize(category, normalizedText)
	return material, firstSemanticReason(decision.Reason, SemanticCacheReasonIntentUnavailable), !material.IsZero()
}

func (s SemanticCacheService) intentThreshold(material SemanticCacheIntentMaterial) float64 {
	if s.intentPolicyConfigured() {
		return s.config.HitPolicy.CategoryThreshold(material.Category, s.config.Threshold)
	}
	return s.config.Threshold
}

func (s SemanticCacheService) applyHitPolicy(result SemanticCacheSearchResult, requestMaterial SemanticCacheIntentMaterial, threshold float64) SemanticCacheSearchResult {
	if !result.Hit || len(result.Matches) == 0 {
		return result
	}
	if !s.intentPolicyConfigured() {
		result.Hit = false
		result.MatchedEntry = nil
		result.Reason = SemanticCacheReasonIntentPolicyUnavailable
		return result
	}

	bestRejectedReason := ""
	filteredMatches := make([]SemanticCacheMatch, 0, len(result.Matches))
	for _, match := range result.Matches {
		decision := s.config.HitPolicy.Evaluate(requestMaterial, match.Entry.IntentMaterial, match.Similarity, threshold)
		if decision.ProviderBypassAllowed {
			filteredMatches = append(filteredMatches, match)
			continue
		}
		if bestRejectedReason == "" {
			bestRejectedReason = firstSemanticReason(decision.Reason, SemanticCacheReasonIntentMismatch)
			result.Similarity = match.Similarity
		}
	}
	if len(filteredMatches) == 0 {
		result.Hit = false
		result.MatchedEntry = nil
		result.Reason = firstSemanticReason(bestRejectedReason, SemanticCacheReasonIntentMismatch)
		result.Matches = nil
		return result
	}

	best := filteredMatches[0].Entry.Clone()
	result.Hit = true
	result.MatchedEntry = &best
	result.Similarity = filteredMatches[0].Similarity
	result.Reason = SemanticCacheReasonHit
	result.Matches = filteredMatches
	return result
}

func (s SemanticCacheService) applyReranker(ctx context.Context, result SemanticCacheSearchResult, requestMaterial SemanticCacheIntentMaterial, threshold float64) SemanticCacheSearchResult {
	if !result.Hit || len(result.Matches) == 0 || s.config.Reranker == nil {
		return result
	}

	bestRejectedReason := ""
	bestRejectedScore := 0.0
	bestRejectedThreshold := threshold
	bestRejectedSimilarity := 0.0
	bestRejectedApplied := false
	for rank, match := range result.Matches {
		rerankResult, err := s.config.Reranker.Rerank(ctx, SemanticCacheRerankRequest{
			Category:                   requestMaterial.Category,
			RequestIntentMaterial:      requestMaterial.Clone(),
			CandidateIntentMaterial:    match.Entry.IntentMaterial.Clone(),
			SemanticSimilarity:         match.Similarity,
			Threshold:                  threshold,
			SemanticCachePolicyVersion: s.config.PolicyVersion,
			NormalizationVersion:       result.EmbeddingInput.NormalizationVersion,
			EmbeddingProvider:          s.EmbeddingProviderName(),
			CandidateRank:              rank + 1,
		})
		if err != nil {
			result.Hit = false
			result.MatchedEntry = nil
			result.Matches = nil
			result.Reason = semanticCacheRerankerFailureReason(err)
			result.RerankerApplied = true
			result.RerankerPassed = false
			result.RerankerScore = 0
			result.RerankerThreshold = threshold
			result.RerankerDecisionReason = result.Reason
			return result
		}
		rerankResult = normalizeSemanticCacheRerankResult(rerankResult, match.Similarity, threshold)
		if !rerankResult.Applied || (rerankResult.Passed && rerankResult.ProviderBypassAllowed) {
			best := match.Entry.Clone()
			result.Hit = true
			result.MatchedEntry = &best
			result.Similarity = match.Similarity
			result.Reason = SemanticCacheReasonHit
			result.Matches = []SemanticCacheMatch{match}
			result.RerankerApplied = rerankResult.Applied
			result.RerankerPassed = true
			result.RerankerScore = rerankResult.Score
			result.RerankerThreshold = rerankResult.Threshold
			result.RerankerDecisionReason = rerankResult.DecisionReason
			return result
		}
		if bestRejectedReason == "" {
			bestRejectedReason = firstSemanticReason(rerankResult.DecisionReason, SemanticCacheReasonRerankerScoreMiss)
			bestRejectedScore = rerankResult.Score
			bestRejectedThreshold = rerankResult.Threshold
			bestRejectedSimilarity = match.Similarity
			bestRejectedApplied = rerankResult.Applied
		}
	}

	result.Hit = false
	result.MatchedEntry = nil
	result.Matches = nil
	result.Similarity = bestRejectedSimilarity
	result.Reason = firstSemanticReason(bestRejectedReason, SemanticCacheReasonRerankerScoreMiss)
	result.RerankerApplied = bestRejectedApplied
	result.RerankerPassed = false
	result.RerankerScore = bestRejectedScore
	result.RerankerThreshold = bestRejectedThreshold
	result.RerankerDecisionReason = result.Reason
	return result
}

func (s SemanticCacheService) normalizeEmbeddingInput(text string) (NormalizedEmbeddingInput, bool) {
	normalizer := s.config.EmbeddingInputNormalizer
	return normalizer.NormalizeText(text)
}

func normalizeSemanticCacheRerankResult(result SemanticCacheRerankResult, similarity float64, threshold float64) SemanticCacheRerankResult {
	if result.Threshold <= 0 || result.Threshold > 1 {
		result.Threshold = threshold
	}
	if result.Score < 0 || result.Score > 1 {
		result.Score = similarity
	}
	if !result.Applied {
		result.Passed = true
		result.ProviderBypassAllowed = true
		result.DecisionReason = firstSemanticReason(result.DecisionReason, SemanticCacheReasonRerankerDisabled)
		return result
	}
	if result.Passed {
		result.ProviderBypassAllowed = true
		result.DecisionReason = firstSemanticReason(result.DecisionReason, SemanticCacheReasonRerankerPass)
		return result
	}
	result.DecisionReason = firstSemanticReason(result.DecisionReason, SemanticCacheReasonRerankerScoreMiss)
	return result
}

func semanticCacheRerankerFailureReason(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return SemanticCacheReasonRerankerTimeout
	}
	return SemanticCacheReasonRerankerProviderFailure
}

func firstSemanticReason(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
