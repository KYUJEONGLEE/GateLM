package config

import (
	"strings"
	"testing"
)

var rateLimitEnvKeys = []string{
	"GATEWAY_RATE_LIMIT_BACKEND",
	"GATEWAY_RATE_LIMIT_ALGORITHM",
	"GATEWAY_RATE_LIMIT_REDIS_KEY_PREFIX",
}

func resetRateLimitEnv(t *testing.T) {
	t.Helper()
	for _, key := range rateLimitEnvKeys {
		t.Setenv(key, "")
	}
}

func TestLoadWithErrorDefaultsRateLimitToRedisTokenBucket(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("expected default config to load, got %v", err)
	}
	if cfg.RateLimitBackend != RateLimitBackendRedis {
		t.Fatalf("expected redis rate limit backend, got %q", cfg.RateLimitBackend)
	}
	if cfg.RateLimitAlgorithm != RateLimitAlgorithmTokenBucket {
		t.Fatalf("expected token bucket algorithm, got %q", cfg.RateLimitAlgorithm)
	}
}

func TestLoadWithErrorNormalizesRedisRateLimitBackend(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_BACKEND", " Redis ")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("expected redis config to load, got %v", err)
	}
	if cfg.RateLimitBackend != RateLimitBackendRedis {
		t.Fatalf("expected redis rate limit backend, got %q", cfg.RateLimitBackend)
	}
}

func TestLoadWithErrorAcceptsPostgresFixedWindowRollback(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_BACKEND", "postgres")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("expected postgres fixed-window rollback config to load, got %v", err)
	}
	if cfg.RateLimitBackend != RateLimitBackendPostgres || cfg.RateLimitAlgorithm != RateLimitAlgorithmFixedWindow {
		t.Fatalf("unexpected rollback config backend=%q algorithm=%q", cfg.RateLimitBackend, cfg.RateLimitAlgorithm)
	}
}

func TestLoadWithErrorRejectsUnsupportedRateLimitBackend(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_BACKEND", "memory")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "unsupported gateway rate limit backend") {
		t.Fatalf("expected unsupported backend error, got %v", err)
	}
}

func TestLoadWithErrorNormalizesTokenBucketAlgorithm(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_ALGORITHM", " Token_Bucket ")
	t.Setenv("GATEWAY_RATE_LIMIT_BACKEND", "redis")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("expected token bucket config to load, got %v", err)
	}
	if cfg.RateLimitAlgorithm != RateLimitAlgorithmTokenBucket {
		t.Fatalf("expected token bucket algorithm, got %q", cfg.RateLimitAlgorithm)
	}
}

func TestLoadWithErrorReadsRedisRateLimitKeyPrefix(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_REDIS_KEY_PREFIX", " gatelm:rate_limit:perf:run_001 ")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("expected config to load, got %v", err)
	}
	if cfg.RateLimitRedisKeyPrefix != "gatelm:rate_limit:perf:run_001" {
		t.Fatalf("unexpected redis key prefix %q", cfg.RateLimitRedisKeyPrefix)
	}
}

func TestLoadWithErrorRejectsUnsupportedRateLimitAlgorithm(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_ALGORITHM", "sliding_window")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "unsupported gateway rate limit algorithm") {
		t.Fatalf("expected unsupported algorithm error, got %v", err)
	}
}

func TestLoadWithErrorRequiresRedisBackendForTokenBucket(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRateLimitEnv(t)
	t.Setenv("GATEWAY_RATE_LIMIT_BACKEND", "postgres")
	t.Setenv("GATEWAY_RATE_LIMIT_ALGORITHM", "token_bucket")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "token bucket requires redis backend") {
		t.Fatalf("expected token bucket backend error, got %v", err)
	}
}
