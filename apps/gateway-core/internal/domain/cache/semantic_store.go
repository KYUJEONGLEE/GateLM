package cache

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	SemanticCacheReasonHit              = "hit"
	SemanticCacheReasonDisabled         = "disabled"
	SemanticCacheReasonInvalidBoundary  = "invalid_boundary"
	SemanticCacheReasonInvalidVector    = "invalid_vector"
	SemanticCacheReasonNoBoundaryMatch  = "boundary_miss"
	SemanticCacheReasonThresholdMiss    = "threshold_miss"
	SemanticCacheReasonStoreSkipped     = "store_skipped"
	SemanticCacheReasonStored           = "stored"
	SemanticCacheReasonPayloadUnsafe    = "payload_unsafe"
	SemanticCacheReasonEmbeddingFailure = "embedding_failure"
)

var ErrSemanticCacheStoreUnavailable = errors.New("semantic cache store is unavailable")

type SemanticCacheStore interface {
	Search(ctx context.Context, boundary SemanticCacheBoundary, vector []float64, threshold float64, topK int) (SemanticCacheSearchResult, error)
	Upsert(ctx context.Context, entry SemanticCacheEntry) error
}

// InMemorySemanticCacheStore is process-local only. It has no persistence,
// no cross-instance sharing, and no vector index; a future pgvector store should
// replace the linear scan while keeping the SemanticCacheStore contract.
type InMemorySemanticCacheStore struct {
	mu         sync.Mutex
	maxEntries int
	entries    map[string]SemanticCacheEntry
	now        func() time.Time
}

func NewInMemorySemanticCacheStore(maxEntries int) *InMemorySemanticCacheStore {
	if maxEntries <= 0 {
		maxEntries = 1000
	}
	return &InMemorySemanticCacheStore{
		maxEntries: maxEntries,
		entries:    map[string]SemanticCacheEntry{},
		now:        time.Now,
	}
}

func (s *InMemorySemanticCacheStore) Search(ctx context.Context, boundary SemanticCacheBoundary, vector []float64, threshold float64, topK int) (SemanticCacheSearchResult, error) {
	result := SemanticCacheSearchResult{
		Threshold: threshold,
		Reason:    SemanticCacheReasonThresholdMiss,
	}
	if s == nil {
		result.Reason = SemanticCacheReasonStoreSkipped
		return result, ErrSemanticCacheStoreUnavailable
	}
	if err := ctx.Err(); err != nil {
		return result, err
	}
	boundary = boundary.Normalize()
	if err := boundary.Validate(); err != nil {
		result.Reason = SemanticCacheReasonInvalidBoundary
		return result, err
	}
	if !isUsableSemanticVector(vector) {
		result.Reason = SemanticCacheReasonInvalidVector
		return result, nil
	}
	if threshold <= 0 || threshold > 1 {
		threshold = 0.92
		result.Threshold = threshold
	}
	if topK <= 0 {
		topK = 1
	}

	now := s.currentTime()
	s.mu.Lock()
	defer s.mu.Unlock()

	s.deleteExpiredLocked(now)
	matches := make([]SemanticCacheMatch, 0, topK)
	boundaryMatched := false
	for _, entry := range s.entries {
		if !entry.Boundary.Equal(boundary) {
			continue
		}
		boundaryMatched = true
		similarity, err := CosineSimilarity(vector, entry.EmbeddingVector)
		if err != nil {
			continue
		}
		if similarity >= threshold {
			matches = append(matches, SemanticCacheMatch{
				Entry:      entry.Clone(),
				Similarity: similarity,
			})
		}
	}

	if len(matches) == 0 {
		if !boundaryMatched {
			result.Reason = SemanticCacheReasonNoBoundaryMatch
		}
		return result, nil
	}

	sort.SliceStable(matches, func(i int, j int) bool {
		return matches[i].Similarity > matches[j].Similarity
	})
	if len(matches) > topK {
		matches = matches[:topK]
	}
	best := matches[0].Entry.Clone()
	result.Hit = true
	result.MatchedEntry = &best
	result.Similarity = matches[0].Similarity
	result.Reason = SemanticCacheReasonHit
	result.Matches = matches
	return result, nil
}

func (s *InMemorySemanticCacheStore) Upsert(ctx context.Context, entry SemanticCacheEntry) error {
	if s == nil {
		return ErrSemanticCacheStoreUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	entry = entry.Clone()
	if err := validateSemanticCacheEntry(entry); err != nil {
		return err
	}
	if containsForbiddenSemanticCachePayload(entry.CachedResponse) {
		return ErrSemanticCachePayloadUnsafe
	}
	if !entry.IntentMaterial.IsZero() && entry.IntentMaterial.ContainsForbiddenMaterial() {
		return ErrSemanticCachePayloadUnsafe
	}

	now := s.currentTime()
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = now
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.entries == nil {
		s.entries = map[string]SemanticCacheEntry{}
	}
	s.deleteExpiredLocked(now)
	s.entries[entry.EntryID] = entry
	s.enforceMaxEntriesLocked()
	return nil
}

func (s *InMemorySemanticCacheStore) currentTime() time.Time {
	if s == nil || s.now == nil {
		return time.Now()
	}
	return s.now()
}

func (s *InMemorySemanticCacheStore) deleteExpiredLocked(now time.Time) {
	for entryID, entry := range s.entries {
		if !entry.ExpiresAt.IsZero() && !now.Before(entry.ExpiresAt) {
			delete(s.entries, entryID)
		}
	}
}

func (s *InMemorySemanticCacheStore) enforceMaxEntriesLocked() {
	if s.maxEntries <= 0 || len(s.entries) <= s.maxEntries {
		return
	}
	type orderedEntry struct {
		entryID   string
		createdAt time.Time
	}
	ordered := make([]orderedEntry, 0, len(s.entries))
	for entryID, entry := range s.entries {
		ordered = append(ordered, orderedEntry{
			entryID:   entryID,
			createdAt: entry.CreatedAt,
		})
	}
	sort.SliceStable(ordered, func(i int, j int) bool {
		return ordered[i].createdAt.Before(ordered[j].createdAt)
	})
	for len(s.entries) > s.maxEntries && len(ordered) > 0 {
		delete(s.entries, ordered[0].entryID)
		ordered = ordered[1:]
	}
}

func validateSemanticCacheEntry(entry SemanticCacheEntry) error {
	if strings.TrimSpace(entry.EntryID) == "" ||
		strings.TrimSpace(entry.RequestID) == "" ||
		len(entry.CachedResponse) == 0 ||
		!isUsableSemanticVector(entry.EmbeddingVector) {
		return ErrSemanticCacheEntryInvalid
	}
	if err := entry.Boundary.Validate(); err != nil {
		return err
	}
	return nil
}

func isUsableSemanticVector(vector []float64) bool {
	for _, value := range vector {
		if value != 0 {
			return true
		}
	}
	return false
}

func containsForbiddenSemanticCachePayload(payload []byte) bool {
	lowered := strings.ToLower(string(payload))
	for _, marker := range []string{
		"api_key=",
		"app_token=",
		"provider_key=",
		"authorization:",
		"bearer ",
		"raw prompt",
		"raw pii",
		"raw response",
		"raw detected value",
		"raw prompt fragment",
		"provider raw error",
		"provider raw response",
	} {
		if strings.Contains(lowered, marker) {
			return true
		}
	}
	return false
}
