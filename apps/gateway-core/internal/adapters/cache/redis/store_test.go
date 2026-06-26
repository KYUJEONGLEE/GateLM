package redis

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/ports"

	goredis "github.com/redis/go-redis/v9"
)

func TestStoreSetExactWritesJSONWithTTLAndCacheKeyHash(t *testing.T) {
	client := &fakeRedisClient{}
	store := NewStore(client, 42*time.Second)

	err := store.SetExact(context.Background(), ports.CacheEntry{
		KeyHash:   "hmac-sha256:test-cache-key",
		RequestID: "request_original",
		Payload:   []byte(`{"id":"mock_chatcmpl_cached"}`),
	})

	if err != nil {
		t.Fatalf("SetExact returned error: %v", err)
	}
	if len(client.setCalls) != 1 {
		t.Fatalf("expected one Redis SET, got %d", len(client.setCalls))
	}

	call := client.setCalls[0]
	if call.key != "hmac-sha256:test-cache-key" {
		t.Fatalf("expected Redis key to be cacheKeyHash only, got %q", call.key)
	}
	if call.expiration != 42*time.Second {
		t.Fatalf("expected TTL 42s, got %s", call.expiration)
	}

	var stored cacheValue
	if err := json.Unmarshal(call.value, &stored); err != nil {
		t.Fatalf("decode stored Redis payload: %v", err)
	}
	if stored.RequestID != "request_original" {
		t.Fatalf("unexpected stored request id: %q", stored.RequestID)
	}
	if string(stored.Payload) != `{"id":"mock_chatcmpl_cached"}` {
		t.Fatalf("unexpected stored payload: %s", string(stored.Payload))
	}
}

func TestStoreSetExactNoopsForEmptyKeyOrPayload(t *testing.T) {
	client := &fakeRedisClient{}
	store := NewStore(client, time.Minute)

	if err := store.SetExact(context.Background(), ports.CacheEntry{Payload: []byte(`{}`)}); err != nil {
		t.Fatalf("SetExact with empty key returned error: %v", err)
	}
	if err := store.SetExact(context.Background(), ports.CacheEntry{KeyHash: "hmac-sha256:key"}); err != nil {
		t.Fatalf("SetExact with empty payload returned error: %v", err)
	}
	if len(client.setCalls) != 0 {
		t.Fatalf("expected no Redis SET calls, got %d", len(client.setCalls))
	}
}

func TestStoreGetExactReturnsMissForRedisNil(t *testing.T) {
	store := NewStore(&fakeRedisClient{}, time.Minute)

	result, err := store.GetExact(context.Background(), "hmac-sha256:missing")

	if err != nil {
		t.Fatalf("GetExact returned error: %v", err)
	}
	if result.Hit {
		t.Fatal("expected cache miss")
	}
}

func TestStoreGetExactReturnsHit(t *testing.T) {
	cached, err := json.Marshal(cacheValue{
		RequestID: "request_original",
		Payload:   []byte(`{"id":"mock_chatcmpl_cached"}`),
	})
	if err != nil {
		t.Fatalf("marshal cache value: %v", err)
	}
	store := NewStore(&fakeRedisClient{
		getValues: map[string][]byte{
			"hmac-sha256:cached": cached,
		},
	}, time.Minute)

	result, err := store.GetExact(context.Background(), "hmac-sha256:cached")

	if err != nil {
		t.Fatalf("GetExact returned error: %v", err)
	}
	if !result.Hit {
		t.Fatal("expected cache hit")
	}
	if result.CacheHitRequestID != "request_original" {
		t.Fatalf("unexpected hit request id: %q", result.CacheHitRequestID)
	}
	if string(result.Payload) != `{"id":"mock_chatcmpl_cached"}` {
		t.Fatalf("unexpected cached payload: %s", string(result.Payload))
	}
}

func TestStoreGetExactReturnsDecodeError(t *testing.T) {
	store := NewStore(&fakeRedisClient{
		getValues: map[string][]byte{
			"hmac-sha256:bad-json": []byte(`not-json`),
		},
	}, time.Minute)

	result, err := store.GetExact(context.Background(), "hmac-sha256:bad-json")

	if err == nil {
		t.Fatal("expected decode error")
	}
	if result.Hit {
		t.Fatal("invalid cached payload must not be returned as hit")
	}
}

func TestStoreGetExactPropagatesRedisError(t *testing.T) {
	store := NewStore(&fakeRedisClient{getErr: errors.New("redis unavailable")}, time.Minute)

	result, err := store.GetExact(context.Background(), "hmac-sha256:key")

	if err == nil {
		t.Fatal("expected Redis error")
	}
	if result.Hit {
		t.Fatal("Redis error must not be returned as hit")
	}
}

type fakeRedisClient struct {
	getValues map[string][]byte
	getErr    error
	setErr    error
	setCalls  []fakeRedisSetCall
}

type fakeRedisSetCall struct {
	key        string
	value      []byte
	expiration time.Duration
}

func (c *fakeRedisClient) Get(ctx context.Context, key string) *goredis.StringCmd {
	if c.getErr != nil {
		return goredis.NewStringResult("", c.getErr)
	}
	if c.getValues == nil {
		return goredis.NewStringResult("", goredis.Nil)
	}
	value, ok := c.getValues[key]
	if !ok {
		return goredis.NewStringResult("", goredis.Nil)
	}
	return goredis.NewStringResult(string(value), nil)
}

func (c *fakeRedisClient) Set(ctx context.Context, key string, value any, expiration time.Duration) *goredis.StatusCmd {
	var bytesValue []byte
	switch typed := value.(type) {
	case []byte:
		bytesValue = append([]byte(nil), typed...)
	case string:
		bytesValue = []byte(typed)
	default:
		bytesValue, _ = json.Marshal(typed)
	}
	c.setCalls = append(c.setCalls, fakeRedisSetCall{
		key:        key,
		value:      bytesValue,
		expiration: expiration,
	})
	return goredis.NewStatusResult("OK", c.setErr)
}
