package workloadauth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

type fakeSetNXClient struct {
	result     bool
	err        error
	key        string
	expiration time.Duration
}

func (c *fakeSetNXClient) SetNX(_ context.Context, key string, _ any, expiration time.Duration) *redis.BoolCmd {
	c.key = key
	c.expiration = expiration
	return redis.NewBoolResult(c.result, c.err)
}

func TestJTIConsumerConsumesOnceUntilTokenExpiry(t *testing.T) {
	now := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	client := &fakeSetNXClient{result: true}
	consumer, err := NewJTIConsumer(client, "tenant-chat:workload-jti:")
	if err != nil {
		t.Fatalf("create jti consumer: %v", err)
	}
	consumer.now = func() time.Time { return now }

	if err := consumer.Consume(context.Background(), "jti_fixture_001", now.Add(30*time.Second)); err != nil {
		t.Fatalf("consume jti: %v", err)
	}
	if client.key != "tenant-chat:workload-jti:jti_fixture_001" {
		t.Fatalf("unexpected redis key %q", client.key)
	}
	if client.expiration != 35*time.Second {
		t.Fatalf("unexpected redis ttl %s", client.expiration)
	}
}

func TestJTIConsumerFailsClosed(t *testing.T) {
	now := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		client *fakeSetNXClient
		want   error
	}{
		{name: "replayed", client: &fakeSetNXClient{result: false}, want: ErrJTIReplayed},
		{name: "redis unavailable", client: &fakeSetNXClient{err: errors.New("redis down")}, want: ErrJTIUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			consumer, err := NewJTIConsumer(test.client, "tenant-chat:workload-jti:")
			if err != nil {
				t.Fatalf("create jti consumer: %v", err)
			}
			consumer.now = func() time.Time { return now }
			err = consumer.Consume(context.Background(), "jti_fixture_001", now.Add(30*time.Second))
			if !errors.Is(err, test.want) {
				t.Fatalf("want %v, got %v", test.want, err)
			}
		})
	}
}
