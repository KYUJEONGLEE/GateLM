package redis

import (
	"context"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/ratelimit"
)

type Limiter struct {
	fixedWindow *FixedWindowLimiter
	tokenBucket *TokenBucketLimiter
}

func NewLimiter(client Client) *Limiter {
	return NewLimiterWithKeyPrefix(client, "")
}

func NewLimiterWithKeyPrefix(client Client, keyPrefix string) *Limiter {
	return &Limiter{
		fixedWindow: NewFixedWindowLimiterWithKeyPrefix(client, limiterKeyPrefix(keyPrefix, "fixed_window", defaultFixedWindowKeyPrefix)),
		tokenBucket: NewTokenBucketLimiterWithKeyPrefix(client, limiterKeyPrefix(keyPrefix, "token_bucket", defaultTokenBucketKeyPrefix)),
	}
}

func (l *Limiter) Check(ctx context.Context, req ratelimit.Request) (ratelimit.Decision, error) {
	if l == nil {
		return NewFixedWindowLimiter(nil).Check(ctx, req)
	}
	config := ratelimit.NormalizeConfig(req.Config)
	switch config.Algorithm {
	case ratelimit.AlgorithmTokenBucket:
		return l.tokenBucket.Check(ctx, req)
	default:
		return l.fixedWindow.Check(ctx, req)
	}
}

func limiterKeyPrefix(rootPrefix string, algorithm string, fallback string) string {
	trimmed := strings.TrimSpace(rootPrefix)
	if trimmed == "" {
		return fallback
	}
	return strings.TrimRight(trimmed, ":") + ":" + algorithm + ":v1"
}
