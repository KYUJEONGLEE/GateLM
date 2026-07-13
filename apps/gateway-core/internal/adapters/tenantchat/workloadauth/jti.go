package workloadauth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	ErrJTIReplayed    = errors.New("tenant chat workload jti was already consumed")
	ErrJTIUnavailable = errors.New("tenant chat workload jti guard is unavailable")
)

type setNXClient interface {
	SetNX(ctx context.Context, key string, value any, expiration time.Duration) *redis.BoolCmd
}

type JTIConsumer struct {
	client setNXClient
	prefix string
	now    func() time.Time
}

func NewJTIConsumer(client setNXClient, prefix string) (*JTIConsumer, error) {
	if client == nil {
		return nil, fmt.Errorf("redis client is required")
	}
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil, fmt.Errorf("workload jti redis prefix is required")
	}
	return &JTIConsumer{client: client, prefix: prefix, now: time.Now}, nil
}

func (c *JTIConsumer) Consume(ctx context.Context, jti string, expiresAt time.Time) error {
	if c == nil || !opaqueIDPattern.MatchString(jti) {
		return ErrJTIUnavailable
	}
	ttl := expiresAt.Add(clockSkew).Sub(c.now())
	if ttl <= 0 || ttl > maximumLifetime+clockSkew {
		return ErrJTIUnavailable
	}
	consumed, err := c.client.SetNX(ctx, c.prefix+jti, "1", ttl).Result()
	if err != nil {
		return ErrJTIUnavailable
	}
	if !consumed {
		return ErrJTIReplayed
	}
	return nil
}
