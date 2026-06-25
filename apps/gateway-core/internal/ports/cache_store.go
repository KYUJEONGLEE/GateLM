package ports

import "context"

// CacheLookupResult is an alias so exact cache stages and adapters keep one
// structural GetExact contract while the Gateway module boundary is skeletal.
type CacheLookupResult = struct {
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
