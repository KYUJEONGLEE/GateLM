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
	Enabled       bool
	Threshold     float64
	TopK          int
	TTL           time.Duration
	PolicyVersion string
}

type SemanticCacheLookupRequest struct {
	Boundary       SemanticCacheBoundary
	NormalizedText string
}

type SemanticCacheStoreRequest struct {
	EntryID        string
	RequestID      string
	Boundary       SemanticCacheBoundary
	NormalizedText string
	CachedResponse []byte
	Now            time.Time
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
	if !isSafeNormalizedSemanticText(request.NormalizedText) {
		result.Reason = SemanticCacheReasonInvalidVector
		return result, result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheInputUnsafe
	}

	embedding, err := s.embeddingProvider.Embed(ctx, EmbeddingInput{NormalizedText: request.NormalizedText})
	if err != nil {
		result.Reason = SemanticCacheReasonEmbeddingFailure
		return result, result.Decision(true, providerName, s.config.PolicyVersion), err
	}
	result, err = s.store.Search(ctx, request.Boundary, embedding.Vector, s.config.Threshold, s.config.TopK)
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
	if !isSafeNormalizedSemanticText(request.NormalizedText) {
		result.Reason = SemanticCacheReasonPayloadUnsafe
		return result.Decision(true, providerName, s.config.PolicyVersion), ErrSemanticCacheInputUnsafe
	}

	now := request.Now
	if now.IsZero() {
		now = time.Now()
	}
	embedding, err := s.embeddingProvider.Embed(ctx, EmbeddingInput{NormalizedText: request.NormalizedText})
	if err != nil {
		result.Reason = SemanticCacheReasonEmbeddingFailure
		return result.Decision(true, providerName, s.config.PolicyVersion), err
	}
	err = s.store.Upsert(ctx, SemanticCacheEntry{
		EntryID:                    request.EntryID,
		RequestID:                  request.RequestID,
		Boundary:                   request.Boundary,
		EmbeddingVector:            embedding.Vector,
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

func isSafeNormalizedSemanticText(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	if trimmed != normalizeSemanticText(trimmed) {
		return false
	}
	return !containsForbiddenSemanticCachePayload([]byte(trimmed))
}
