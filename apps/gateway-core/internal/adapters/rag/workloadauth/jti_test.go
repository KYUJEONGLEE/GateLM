package workloadauth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type fakeRedisSetNXClient struct {
	result     bool
	err        error
	key        string
	value      any
	expiration time.Duration
	calls      int
}

func (c *fakeRedisSetNXClient) SetNX(
	_ context.Context,
	key string,
	value any,
	expiration time.Duration,
) *redis.BoolCmd {
	c.calls++
	c.key = key
	c.value = value
	c.expiration = expiration
	return redis.NewBoolResult(c.result, c.err)
}

func TestRedisJTIConsumerUsesNamespacedKeyAndExpiryWithClockSkew(t *testing.T) {
	now := time.Date(2026, time.July, 16, 0, 0, 0, 0, time.UTC)
	client := &fakeRedisSetNXClient{result: true}
	consumer, err := NewRedisJTIConsumer(client, "rag:workload-jti:")
	if err != nil {
		t.Fatalf("create consumer: %v", err)
	}
	consumer.now = func() time.Time { return now }

	if err := consumer.Consume(context.Background(), "jti_fixture_001", now.Add(30*time.Second)); err != nil {
		t.Fatalf("consume JTI: %v", err)
	}
	if client.calls != 1 {
		t.Fatalf("SetNX calls=%d, want 1", client.calls)
	}
	if client.key != "rag:workload-jti:jti_fixture_001" {
		t.Fatalf("unexpected Redis key %q", client.key)
	}
	if client.value != "1" {
		t.Fatalf("unexpected Redis value %#v", client.value)
	}
	if client.expiration != 35*time.Second {
		t.Fatalf("unexpected Redis TTL %s, want 35s", client.expiration)
	}
}

func TestRedisJTIConsumerFailsClosedOnReplayAndRedisError(t *testing.T) {
	now := time.Date(2026, time.July, 16, 0, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name   string
		client *fakeRedisSetNXClient
		want   error
	}{
		{name: "SetNX false is replay", client: &fakeRedisSetNXClient{result: false}, want: errJTIReplayed},
		{name: "Redis error is unavailable", client: &fakeRedisSetNXClient{err: errors.New("redis down")}, want: errJTIUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			consumer, err := NewRedisJTIConsumer(test.client, "rag:workload-jti:")
			if err != nil {
				t.Fatalf("create consumer: %v", err)
			}
			consumer.now = func() time.Time { return now }

			err = consumer.Consume(context.Background(), "jti_fixture_001", now.Add(30*time.Second))
			if !errors.Is(err, test.want) {
				t.Fatalf("want %v, got %v", test.want, err)
			}
			if test.client.calls != 1 {
				t.Fatalf("SetNX calls=%d, want 1", test.client.calls)
			}
		})
	}
}

func TestRedisJTIConsumerAcceptsMaximumLifetimeFromFastIssuerClock(t *testing.T) {
	now := time.Date(2026, time.July, 16, 0, 0, 0, 0, time.UTC)
	client := &fakeRedisSetNXClient{result: true}
	consumer, err := NewRedisJTIConsumer(client, "rag:workload-jti:")
	if err != nil {
		t.Fatalf("create consumer: %v", err)
	}
	consumer.now = func() time.Time { return now }

	// A signer may be clockSkew ahead, issue a maximumLifetime token, and the
	// consumer keeps it for one additional skew after exp.
	expiresAt := now.Add(clockSkew + maximumLifetime)
	if err := consumer.Consume(context.Background(), "jti_fast_issuer_001", expiresAt); err != nil {
		t.Fatalf("consume maximum valid skewed JTI: %v", err)
	}
	if client.expiration != maximumLifetime+2*clockSkew {
		t.Fatalf("unexpected maximum skewed TTL %s", client.expiration)
	}

	tooLongClient := &fakeRedisSetNXClient{result: true}
	tooLongConsumer, err := NewRedisJTIConsumer(tooLongClient, "rag:workload-jti:")
	if err != nil {
		t.Fatalf("create long-lived consumer: %v", err)
	}
	tooLongConsumer.now = func() time.Time { return now }
	if err := tooLongConsumer.Consume(context.Background(), "jti_too_long_001", expiresAt.Add(time.Nanosecond)); !errors.Is(err, errJTIUnavailable) {
		t.Fatalf("expiry beyond the verified lifetime boundary must fail closed: %v", err)
	}
	if tooLongClient.calls != 0 {
		t.Fatalf("invalid long-lived JTI reached Redis: calls=%d", tooLongClient.calls)
	}
}
