package ports

import "context"

type CacheLookupResult struct {
	Hit               bool
	CacheHitRequestID string
	Payload           []byte
}

type CacheEntry struct {
	KeyHash   string
	RequestID string
	Payload   []byte
}

type CacheStore interface {
	GetExact(ctx context.Context, keyHash string) (CacheLookupResult, error)
	SetExact(ctx context.Context, entry CacheEntry) error
}
