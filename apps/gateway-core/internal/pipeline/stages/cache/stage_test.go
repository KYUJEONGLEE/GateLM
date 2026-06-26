package cache

import (
	"context"
	"errors"
	"testing"
)

type fakeKeyBuilder struct {
	called bool
	err    error
	key    string
}

func (f *fakeKeyBuilder) BuildExactCacheKey(context.Context, Request) (string, error) {
	f.called = true
	if f.err != nil {
		return "", f.err
	}
	if f.key == "" {
		return "hmac-sha256:cache-key", nil
	}
	return f.key, nil
}

type fakeStore struct {
	called bool
	result LookupResult
	err    error
}

func (f *fakeStore) GetExact(context.Context, string) (LookupResult, error) {
	f.called = true
	if f.err != nil {
		return LookupResult{}, f.err
	}
	return f.result, nil
}

func TestExecuteBypassesWhenCachePolicyHashIsEmpty(t *testing.T) {
	keyBuilder := &fakeKeyBuilder{}
	store := &fakeStore{}
	stage := NewStage(keyBuilder, store)

	result, err := stage.Execute(context.Background(), Request{
		CachePolicyHash: "  ",
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result.CacheStatus != CacheStatusBypass {
		t.Fatalf("expected cache status %q, got %q", CacheStatusBypass, result.CacheStatus)
	}
	if result.CacheType != CacheTypeNone {
		t.Fatalf("expected cache type %q, got %q", CacheTypeNone, result.CacheType)
	}
	if keyBuilder.called {
		t.Fatal("expected key builder not to be called")
	}
	if store.called {
		t.Fatal("expected store not to be called")
	}
}

func TestExecuteBypassesBlockedRequestsBeforeKeyBuilderAndStore(t *testing.T) {
	keyBuilder := &fakeKeyBuilder{}
	store := &fakeStore{}
	stage := NewStage(keyBuilder, store)

	result, err := stage.Execute(context.Background(), Request{
		CachePolicyHash: "cache_p0_v1",
		MaskingAction:   MaskingActionBlocked,
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if result.CacheStatus != CacheStatusBypass {
		t.Fatalf("expected cache status %q, got %q", CacheStatusBypass, result.CacheStatus)
	}
	if result.CacheType != CacheTypeNone {
		t.Fatalf("expected cache type %q, got %q", CacheTypeNone, result.CacheType)
	}
	if keyBuilder.called {
		t.Fatal("blocked request must not build an exact cache key")
	}
	if store.called {
		t.Fatal("blocked request must not look up exact cache")
	}
}

func TestExecutePropagatesKeyBuilderErrorWhenCachePolicyHashExists(t *testing.T) {
	stage := NewStage(&fakeKeyBuilder{err: errors.New("key builder failed")}, &fakeStore{})

	result, err := stage.Execute(context.Background(), Request{
		CachePolicyHash: "cache_p0_v1",
	})
	if err == nil {
		t.Fatal("expected key builder error")
	}
	if result.CacheStatus != CacheStatusError {
		t.Fatalf("expected cache status %q, got %q", CacheStatusError, result.CacheStatus)
	}
	if result.CacheType != CacheTypeExact {
		t.Fatalf("expected cache type %q, got %q", CacheTypeExact, result.CacheType)
	}
}
