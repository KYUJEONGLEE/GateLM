package cached

import (
	"container/list"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"gatelm/apps/gateway-core/internal/domain/auth"
)

type CredentialStore interface {
	AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error)
	ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error)
}

type Config struct {
	Enabled    bool
	TTL        time.Duration
	MaxEntries int
	KeySecret  []byte
	Now        func() time.Time
}

type Store struct {
	delegate  CredentialStore
	enabled   bool
	secret    []byte
	now       func() time.Time
	apiKeys   *lruCache[auth.APIKeyIdentity]
	appTokens *lruCache[auth.AppTokenIdentity]
}

func NewStore(delegate CredentialStore, cfg Config) *Store {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	enabled := cfg.Enabled && cfg.TTL > 0 && cfg.MaxEntries > 0 && len(cfg.KeySecret) > 0
	return &Store{
		delegate:  delegate,
		enabled:   enabled,
		secret:    append([]byte(nil), cfg.KeySecret...),
		now:       now,
		apiKeys:   newLRUCache[auth.APIKeyIdentity](cfg.MaxEntries, cfg.TTL),
		appTokens: newLRUCache[auth.AppTokenIdentity](cfg.MaxEntries, cfg.TTL),
	}
}

func (s *Store) AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error) {
	if err := ctx.Err(); err != nil {
		return auth.APIKeyIdentity{}, err
	}
	if s == nil || s.delegate == nil {
		return auth.APIKeyIdentity{}, errors.New("cached credential store requires a delegate")
	}
	if !s.enabled {
		return s.delegate.AuthenticateAPIKey(ctx, bearerToken)
	}

	key := s.cacheKey("api_key", bearerToken)
	if identity, ok := s.apiKeys.get(key, s.now()); ok {
		return identity, nil
	}
	identity, err := s.delegate.AuthenticateAPIKey(ctx, bearerToken)
	if err != nil {
		return auth.APIKeyIdentity{}, err
	}
	s.apiKeys.put(key, identity, s.now())
	return identity, nil
}

func (s *Store) ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error) {
	if err := ctx.Err(); err != nil {
		return auth.AppTokenIdentity{}, err
	}
	if s == nil || s.delegate == nil {
		return auth.AppTokenIdentity{}, errors.New("cached credential store requires a delegate")
	}
	if !s.enabled {
		return s.delegate.ValidateAppToken(ctx, appToken)
	}

	key := s.cacheKey("app_token", appToken)
	if identity, ok := s.appTokens.get(key, s.now()); ok {
		return identity, nil
	}
	identity, err := s.delegate.ValidateAppToken(ctx, appToken)
	if err != nil {
		return auth.AppTokenIdentity{}, err
	}
	s.appTokens.put(key, identity, s.now())
	return identity, nil
}

func (s *Store) cacheKey(kind string, plaintext string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(kind))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.TrimSpace(plaintext)))
	return hex.EncodeToString(mac.Sum(nil))
}

type lruCache[T any] struct {
	mu         sync.Mutex
	maxEntries int
	ttl        time.Duration
	items      map[string]*list.Element
	order      *list.List
}

type lruEntry[T any] struct {
	key       string
	value     T
	expiresAt time.Time
}

func newLRUCache[T any](maxEntries int, ttl time.Duration) *lruCache[T] {
	return &lruCache[T]{
		maxEntries: maxEntries,
		ttl:        ttl,
		items:      make(map[string]*list.Element),
		order:      list.New(),
	}
}

func (c *lruCache[T]) get(key string, now time.Time) (T, bool) {
	var zero T
	if c == nil || c.maxEntries <= 0 || c.ttl <= 0 {
		return zero, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	element := c.items[key]
	if element == nil {
		return zero, false
	}
	entry := element.Value.(lruEntry[T])
	if !now.Before(entry.expiresAt) {
		delete(c.items, key)
		c.order.Remove(element)
		return zero, false
	}
	c.order.MoveToFront(element)
	return entry.value, true
}

func (c *lruCache[T]) put(key string, value T, now time.Time) {
	if c == nil || c.maxEntries <= 0 || c.ttl <= 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if element := c.items[key]; element != nil {
		element.Value = lruEntry[T]{key: key, value: value, expiresAt: now.Add(c.ttl)}
		c.order.MoveToFront(element)
		return
	}
	element := c.order.PushFront(lruEntry[T]{key: key, value: value, expiresAt: now.Add(c.ttl)})
	c.items[key] = element
	for c.order.Len() > c.maxEntries {
		oldest := c.order.Back()
		entry := oldest.Value.(lruEntry[T])
		delete(c.items, entry.key)
		c.order.Remove(oldest)
	}
}
