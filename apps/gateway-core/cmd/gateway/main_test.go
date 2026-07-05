package main

import (
	"context"
	"strings"
	"testing"

	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	redisratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/redis"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"

	goredis "github.com/redis/go-redis/v9"
)

func TestIsStrictRuntimeSnapshotMode(t *testing.T) {
	tests := []struct {
		name string
		mode string
		want bool
	}{
		{name: "default demo mode", mode: "demo", want: false},
		{name: "empty mode", mode: "", want: false},
		{name: "strict mode", mode: "strict", want: true},
		{name: "strict snapshot alias", mode: "strict_snapshot", want: true},
		{name: "case and space tolerant", mode: " Strict ", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isStrictRuntimeSnapshotMode(config.Config{RuntimeSnapshotMode: tt.mode})
			if got != tt.want {
				t.Errorf("isStrictRuntimeSnapshotMode(%q) = %v, want %v", tt.mode, got, tt.want)
			}
		})
	}
}

func TestValidateRuntimeSnapshotMode(t *testing.T) {
	tests := []struct {
		name    string
		mode    string
		wantErr bool
	}{
		{name: "demo", mode: "demo", wantErr: false},
		{name: "empty", mode: "", wantErr: false},
		{name: "strict", mode: "strict", wantErr: false},
		{name: "strict snapshot alias", mode: "strict_snapshot", wantErr: false},
		{name: "case and space tolerant", mode: " Strict ", wantErr: false},
		{name: "typo", mode: "stric", wantErr: true},
		{name: "unknown", mode: "control_plane", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRuntimeSnapshotMode(config.Config{RuntimeSnapshotMode: tt.mode})
			if (err != nil) != tt.wantErr {
				t.Errorf("validateRuntimeSnapshotMode(%q) error = %v, wantErr %v", tt.mode, err, tt.wantErr)
			}
		})
	}
}

func TestBuildRateLimiterDefaultsToRedis(t *testing.T) {
	limiter, err := buildRateLimiter(config.Config{}, nil, fakeRedisClient{})
	if err != nil {
		t.Fatalf("expected redis limiter, got error %v", err)
	}
	if _, ok := limiter.(*redisratelimit.Limiter); !ok {
		t.Fatalf("expected redis limiter, got %T", limiter)
	}
}

func TestBuildRateLimiterUsesPostgresRollbackBackend(t *testing.T) {
	limiter, err := buildRateLimiter(config.Config{RateLimitBackend: " Postgres "}, nil, fakeRedisClient{})
	if err != nil {
		t.Fatalf("expected postgres limiter, got error %v", err)
	}
	if _, ok := limiter.(*postgresratelimit.Limiter); !ok {
		t.Fatalf("expected postgres limiter, got %T", limiter)
	}
}

func TestBuildRateLimiterUsesRedisBackend(t *testing.T) {
	limiter, err := buildRateLimiter(config.Config{RateLimitBackend: " Redis "}, nil, fakeRedisClient{})
	if err != nil {
		t.Fatalf("expected redis limiter, got error %v", err)
	}
	if _, ok := limiter.(*redisratelimit.Limiter); !ok {
		t.Fatalf("expected redis limiter, got %T", limiter)
	}
}

func TestBuildRateLimiterRequiresRedisClient(t *testing.T) {
	_, err := buildRateLimiter(config.Config{RateLimitBackend: "redis"}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "requires redis client") {
		t.Fatalf("expected redis client error, got %v", err)
	}
}

func TestBuildRateLimiterRejectsUnsupportedBackend(t *testing.T) {
	_, err := buildRateLimiter(config.Config{RateLimitBackend: "memory"}, nil, fakeRedisClient{})
	if err == nil || !strings.Contains(err.Error(), "unsupported rate limit backend") {
		t.Fatalf("expected unsupported backend error, got %v", err)
	}
}

func TestBuildRateLimitStageConfigDefaultsToTokenBucket(t *testing.T) {
	cfg := buildRateLimitStageConfig(config.Config{
		RateLimitEnabled:    true,
		RateLimitWindowSecs: 60,
		RateLimitLimit:      60,
	})

	if cfg.Algorithm != ratelimit.AlgorithmTokenBucket || cfg.Limit != 60 || cfg.WindowSeconds != 60 {
		t.Fatalf("unexpected rate limit stage config: %#v", cfg)
	}
}

type fakeRedisClient struct{}

func (fakeRedisClient) Eval(context.Context, string, []string, ...any) *goredis.Cmd {
	return goredis.NewCmdResult(nil, nil)
}
