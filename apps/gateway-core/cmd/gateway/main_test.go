package main

import (
	"context"
	"strings"
	"testing"
	"time"

	postgresratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/postgres"
	redisratelimit "gatelm/apps/gateway-core/internal/adapters/ratelimit/redis"
	"gatelm/apps/gateway-core/internal/config"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"

	goredis "github.com/redis/go-redis/v9"
)

func TestParsePostgresPoolConfigAppliesBoundsAndIdentity(t *testing.T) {
	tuning := config.PostgresPoolConfig{
		MaxConns:          16,
		MinConns:          2,
		MaxConnLifetime:   30 * time.Minute,
		MaxConnIdleTime:   5 * time.Minute,
		HealthCheckPeriod: time.Minute,
	}
	poolConfig, err := parsePostgresPoolConfig(
		"postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public",
		tuning,
		"gatelm-gateway-log",
	)
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}

	if poolConfig.MaxConns != 16 || poolConfig.MinConns != 2 {
		t.Fatalf("unexpected connection bounds: max=%d min=%d", poolConfig.MaxConns, poolConfig.MinConns)
	}
	if poolConfig.MaxConnLifetime != 30*time.Minute || poolConfig.MaxConnLifetimeJitter != 3*time.Minute {
		t.Fatalf("unexpected connection lifetime: lifetime=%s jitter=%s", poolConfig.MaxConnLifetime, poolConfig.MaxConnLifetimeJitter)
	}
	if poolConfig.MaxConnIdleTime != 5*time.Minute || poolConfig.HealthCheckPeriod != time.Minute {
		t.Fatalf("unexpected idle health config: idle=%s health=%s", poolConfig.MaxConnIdleTime, poolConfig.HealthCheckPeriod)
	}
	if poolConfig.ConnConfig.RuntimeParams["application_name"] != "gatelm-gateway-log" {
		t.Fatalf("unexpected application name: %q", poolConfig.ConnConfig.RuntimeParams["application_name"])
	}
	if strings.Contains(poolConfig.ConnString(), "schema=") {
		t.Fatal("Prisma-only schema query parameter must not reach pgx")
	}
}

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

func TestBuildOpenAIStaticCatalogModelsAddsManualExtraModels(t *testing.T) {
	models := buildOpenAIStaticCatalogModels(config.Config{
		OpenAIProviderID:        "provider_openai_main",
		OpenAILowCostModelID:    "openai-low-cost",
		OpenAILowCostModelName:  "gpt-4o-mini",
		OpenAIBalancedModelID:   "openai-balanced",
		OpenAIBalancedModelName: "gpt-4o",
		OpenAIExtraModelNames:   []string{"gpt-5.4-mini", "gpt-5.4", "gpt-4o"},
	})

	if len(models) != 4 {
		t.Fatalf("expected low, balanced, and two unique extra models, got %#v", models)
	}
	if models[0].ModelName != "gpt-4o-mini" || !models[0].Routing.AutoRoutingEligible || models[0].Routing.CostTier != "low" {
		t.Fatalf("low-cost model routing changed: %#v", models[0])
	}
	if models[1].ModelName != "gpt-4o" || !models[1].Routing.AutoRoutingEligible || models[1].Routing.CostTier != "balanced" {
		t.Fatalf("balanced model routing changed: %#v", models[1])
	}
	if models[2].ModelID != "provider_openai_main:gpt-5.4-mini" || models[2].ModelName != "gpt-5.4-mini" {
		t.Fatalf("unexpected first extra model: %#v", models[2])
	}
	if models[2].Routing.AutoRoutingEligible {
		t.Fatalf("extra model should be manual/pinned only by default: %#v", models[2])
	}
	if !models[2].Capabilities.StreamingSupported || !models[2].Capabilities.SupportsJSONMode {
		t.Fatalf("extra OpenAI model capabilities were not set: %#v", models[2].Capabilities)
	}
}

type fakeRedisClient struct{}

func (fakeRedisClient) Eval(context.Context, string, []string, ...any) *goredis.Cmd {
	return goredis.NewCmdResult(nil, nil)
}
