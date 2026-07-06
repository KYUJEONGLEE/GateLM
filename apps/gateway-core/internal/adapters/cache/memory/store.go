package memory

import (
	"context"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/ports"
)

type Store struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]entry
}

type entry struct {
	requestID         string
	savedCostMicroUSD int64
	payload           []byte
	expiresAt         time.Time
}

func NewStore(ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &Store{
		ttl:     ttl,
		entries: map[string]entry{},
	}
}

func (s *Store) GetExact(_ context.Context, keyHash string) (ports.CacheLookupResult, error) {
	if s == nil || keyHash == "" {
		return ports.CacheLookupResult{}, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	cached, ok := s.entries[keyHash]
	if !ok {
		return ports.CacheLookupResult{}, nil
	}
	if !cached.expiresAt.IsZero() && time.Now().After(cached.expiresAt) {
		delete(s.entries, keyHash)
		return ports.CacheLookupResult{}, nil
	}

	payload := append([]byte(nil), cached.payload...)
	return ports.CacheLookupResult{
		Hit:               true,
		CacheHitRequestID: cached.requestID,
		SavedCostMicroUSD: cached.savedCostMicroUSD,
		Payload:           payload,
	}, nil
}

func (s *Store) SetExact(_ context.Context, cacheEntry ports.CacheEntry) error {
	if s == nil || cacheEntry.KeyHash == "" || len(cacheEntry.Payload) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.entries[cacheEntry.KeyHash] = entry{
		requestID:         cacheEntry.RequestID,
		savedCostMicroUSD: cacheEntry.SavedCostMicroUSD,
		payload:           append([]byte(nil), cacheEntry.Payload...),
		expiresAt:         time.Now().Add(s.ttl),
	}
	return nil
}
