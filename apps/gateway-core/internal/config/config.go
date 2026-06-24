package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port                string
	DatabaseURL         string
	RedisURL            string
	MockProviderBaseURL string
	DefaultProvider     string
	DefaultModel        string
	ReadinessTimeout    time.Duration
	ProviderTimeout     time.Duration
}

func Load() Config {
	return Config{
		Port:                envString("GATEWAY_PORT", "8080"),
		DatabaseURL:         envString("DATABASE_URL", "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"),
		RedisURL:            envString("REDIS_URL", "redis://localhost:6379"),
		MockProviderBaseURL: envString("MOCK_PROVIDER_BASE_URL", "http://localhost:8090"),
		DefaultProvider:     envString("GATEWAY_DEFAULT_PROVIDER", "mock"),
		DefaultModel:        envString("GATEWAY_DEFAULT_MODEL", "mock-balanced"),
		ReadinessTimeout:    envDurationMillis("GATEWAY_READINESS_TIMEOUT_MS", 1000),
		ProviderTimeout:     envDurationMillis("GATEWAY_PROVIDER_TIMEOUT_MS", 5000),
	}
}

func envString(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envDurationMillis(key string, fallback int) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return time.Duration(fallback) * time.Millisecond
	}

	millis, err := strconv.Atoi(value)
	if err != nil || millis <= 0 {
		return time.Duration(fallback) * time.Millisecond
	}

	return time.Duration(millis) * time.Millisecond
}
