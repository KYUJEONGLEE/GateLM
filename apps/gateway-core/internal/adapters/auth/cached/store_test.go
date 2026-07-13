package cached

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/auth"
)

func TestStoreCachesSuccessfulAPIKeyByHMAC(t *testing.T) {
	now := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	delegate := &fakeCredentialStore{apiIdentity: auth.APIKeyIdentity{APIKeyID: "api-key-id"}}
	store := NewStore(delegate, Config{
		Enabled:    true,
		TTL:        time.Second,
		MaxEntries: 2,
		KeySecret:  []byte("cache-test-key-material"),
		Now:        func() time.Time { return now },
	})

	const token = "gsk_live_cached_1234"
	for range 2 {
		identity, err := store.AuthenticateAPIKey(context.Background(), token)
		if err != nil || identity.APIKeyID != "api-key-id" {
			t.Fatalf("authenticate cached API key: identity=%+v err=%v", identity, err)
		}
	}
	if delegate.apiCalls != 1 {
		t.Fatalf("expected one delegate API key lookup, got %d", delegate.apiCalls)
	}
	for key := range store.apiKeys.items {
		if strings.Contains(key, token) || len(key) != sha256HexLength {
			t.Fatalf("cache key must be a fixed-length HMAC, got %q", key)
		}
	}
}

func TestStoreExpiresSuccessfulIdentity(t *testing.T) {
	now := time.Date(2026, 7, 12, 0, 0, 0, 0, time.UTC)
	delegate := &fakeCredentialStore{apiIdentity: auth.APIKeyIdentity{APIKeyID: "api-key-id"}}
	store := NewStore(delegate, Config{
		Enabled:    true,
		TTL:        time.Second,
		MaxEntries: 2,
		KeySecret:  []byte("cache-test-key-material"),
		Now:        func() time.Time { return now },
	})

	if _, err := store.AuthenticateAPIKey(context.Background(), "gsk_live_cached_1234"); err != nil {
		t.Fatalf("authenticate initial API key: %v", err)
	}
	now = now.Add(time.Second)
	if _, err := store.AuthenticateAPIKey(context.Background(), "gsk_live_cached_1234"); err != nil {
		t.Fatalf("authenticate expired API key: %v", err)
	}
	if delegate.apiCalls != 2 {
		t.Fatalf("expected cache expiry to revalidate, got %d delegate calls", delegate.apiCalls)
	}
}

func TestStoreDoesNotCacheInvalidCredentials(t *testing.T) {
	delegate := &fakeCredentialStore{apiErr: auth.ErrInvalidAPIKey}
	store := NewStore(delegate, Config{
		Enabled:    true,
		TTL:        time.Second,
		MaxEntries: 2,
		KeySecret:  []byte("cache-test-key-material"),
	})

	for range 2 {
		_, err := store.AuthenticateAPIKey(context.Background(), "gsk_live_invalid_1234")
		if !errors.Is(err, auth.ErrInvalidAPIKey) {
			t.Fatalf("expected invalid API key, got %v", err)
		}
	}
	if delegate.apiCalls != 2 {
		t.Fatalf("invalid credentials must not be cached, got %d delegate calls", delegate.apiCalls)
	}
}

func TestStoreBoundsEntriesAndSeparatesCredentialKinds(t *testing.T) {
	delegate := &fakeCredentialStore{
		apiIdentity: auth.APIKeyIdentity{APIKeyID: "api-key-id"},
		appIdentity: auth.AppTokenIdentity{AppTokenID: "app-token-id"},
	}
	store := NewStore(delegate, Config{
		Enabled:    true,
		TTL:        time.Minute,
		MaxEntries: 1,
		KeySecret:  []byte("cache-test-key-material"),
	})

	if _, err := store.AuthenticateAPIKey(context.Background(), "gsk_live_first_1234"); err != nil {
		t.Fatalf("authenticate first API key: %v", err)
	}
	if _, err := store.AuthenticateAPIKey(context.Background(), "gsk_live_second_5678"); err != nil {
		t.Fatalf("authenticate second API key: %v", err)
	}
	if store.apiKeys.order.Len() != 1 {
		t.Fatalf("expected bounded API cache, got %d entries", store.apiKeys.order.Len())
	}
	if _, err := store.ValidateAppToken(context.Background(), "gat_app_cached_1234"); err != nil {
		t.Fatalf("validate app token: %v", err)
	}
	if delegate.appCalls != 1 || store.appTokens.order.Len() != 1 {
		t.Fatalf("expected separate app token cache, calls=%d entries=%d", delegate.appCalls, store.appTokens.order.Len())
	}
}

const sha256HexLength = 64

type fakeCredentialStore struct {
	apiIdentity auth.APIKeyIdentity
	appIdentity auth.AppTokenIdentity
	apiErr      error
	appErr      error
	apiCalls    int
	appCalls    int
}

func (s *fakeCredentialStore) AuthenticateAPIKey(context.Context, string) (auth.APIKeyIdentity, error) {
	s.apiCalls++
	return s.apiIdentity, s.apiErr
}

func (s *fakeCredentialStore) ValidateAppToken(context.Context, string) (auth.AppTokenIdentity, error) {
	s.appCalls++
	return s.appIdentity, s.appErr
}
