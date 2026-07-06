package redis

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/ports"

	goredis "github.com/redis/go-redis/v9"
)

type Client interface {
	Get(ctx context.Context, key string) *goredis.StringCmd
	Set(ctx context.Context, key string, value any, expiration time.Duration) *goredis.StatusCmd
}

type Store struct {
	client Client
	ttl    time.Duration
}

type cacheValue struct {
	RequestID         string `json:"requestId"`
	SavedCostMicroUSD int64  `json:"savedCostMicroUsd"`
	Payload           []byte `json:"payload"`
}

func NewStore(client Client, ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 10 * time.Minute
	}
	return &Store{
		client: client,
		ttl:    ttl,
	}
}

func (s *Store) GetExact(ctx context.Context, keyHash string) (ports.CacheLookupResult, error) {
	if s == nil || s.client == nil || keyHash == "" {
		return ports.CacheLookupResult{}, nil
	}

	raw, err := s.client.Get(ctx, keyHash).Bytes()
	if errors.Is(err, goredis.Nil) {
		return ports.CacheLookupResult{}, nil
	}
	if err != nil {
		return ports.CacheLookupResult{}, err
	}

	var cached cacheValue
	if err := json.Unmarshal(raw, &cached); err != nil {
		return ports.CacheLookupResult{}, err
	}
	if len(cached.Payload) == 0 {
		return ports.CacheLookupResult{}, nil
	}

	return ports.CacheLookupResult{
		Hit:               true,
		CacheHitRequestID: cached.RequestID,
		SavedCostMicroUSD: cached.SavedCostMicroUSD,
		Payload:           cached.Payload,
	}, nil
}

func (s *Store) SetExact(ctx context.Context, cacheEntry ports.CacheEntry) error {
	if s == nil || s.client == nil || cacheEntry.KeyHash == "" || len(cacheEntry.Payload) == 0 {
		return nil
	}

	payload, err := json.Marshal(cacheValue{
		RequestID:         cacheEntry.RequestID,
		SavedCostMicroUSD: cacheEntry.SavedCostMicroUSD,
		Payload:           cacheEntry.Payload,
	})
	if err != nil {
		return err
	}

	return s.client.Set(ctx, cacheEntry.KeyHash, payload, s.ttl).Err()
}
