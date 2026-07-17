package workloadauth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ragembedding"

	"github.com/redis/go-redis/v9"
)

var (
	errJTIReplayed    = errors.New("rag embedding workload jti was already consumed")
	errJTIUnavailable = errors.New("rag embedding workload jti guard is unavailable")
)

type setNXClient interface {
	SetNX(ctx context.Context, key string, value any, expiration time.Duration) *redis.BoolCmd
}

type RedisJTIConsumer struct {
	client setNXClient
	prefix string
	now    func() time.Time
}

func NewRedisJTIConsumer(client setNXClient, prefix string) (*RedisJTIConsumer, error) {
	if client == nil {
		return nil, fmt.Errorf("redis client is required")
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil, fmt.Errorf("rag workload jti redis prefix is required")
	}
	return &RedisJTIConsumer{client: client, prefix: prefix, now: time.Now}, nil
}

func (c *RedisJTIConsumer) Consume(ctx context.Context, jti string, expiresAt time.Time) error {
	if c == nil || c.client == nil || !ragembedding.IsOpaqueID(jti) {
		return errJTIUnavailable
	}
	ttl := expiresAt.Add(clockSkew).Sub(c.now())
	// The verifier permits iat/nbf up to one clockSkew ahead. Adding a second
	// skew to the Redis expiry keeps that valid boundary replay-protected.
	if ttl <= 0 || ttl > maximumLifetime+2*clockSkew {
		return errJTIUnavailable
	}
	consumed, err := c.client.SetNX(ctx, c.prefix+jti, "1", ttl).Result()
	if err != nil {
		return errJTIUnavailable
	}
	if !consumed {
		return errJTIReplayed
	}
	return nil
}
