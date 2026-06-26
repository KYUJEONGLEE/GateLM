package config

import (
	"net/url"
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
	DemoAPIKey          string
	DemoAppToken        string
	DemoTenantID        string
	DemoProjectID       string
	DemoApplicationID   string
	DemoAPIKeyID        string
	DemoAppTokenID      string
	ReadinessTimeout    time.Duration
	ProviderTimeout     time.Duration
	MaxRequestBodyBytes int64
	ExactCacheTTL       time.Duration
	ExactCacheKeySecret string
}

func Load() Config {
	return Config{
		Port:                envString("GATEWAY_PORT", "8080"),
		DatabaseURL:         envString("DATABASE_URL", "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"),
		RedisURL:            envString("REDIS_URL", "redis://localhost:6379"),
		MockProviderBaseURL: envString("MOCK_PROVIDER_BASE_URL", "http://localhost:8090"),
		DefaultProvider:     envString("GATEWAY_DEFAULT_PROVIDER", "mock"),
		DefaultModel:        envString("GATEWAY_DEFAULT_MODEL", "mock-balanced"),
		DemoAPIKey:          envString("GATELM_DEMO_API_KEY", "glm_api_test_redacted"),
		DemoAppToken:        envString("GATELM_DEMO_APP_TOKEN", "glm_app_token_test_redacted"),
		DemoTenantID:        envString("GATELM_DEMO_TENANT_ID", "00000000-0000-4000-8000-000000000100"),
		DemoProjectID:       envString("GATELM_DEMO_PROJECT_ID", "00000000-0000-4000-8000-000000000200"),
		DemoApplicationID:   envString("GATELM_DEMO_APPLICATION_ID", "00000000-0000-4000-8000-000000000300"),
		DemoAPIKeyID:        envString("GATELM_DEMO_API_KEY_ID", "00000000-0000-4000-8000-000000000400"),
		DemoAppTokenID:      envString("GATELM_DEMO_APP_TOKEN_ID", "00000000-0000-4000-8000-000000000500"),
		ReadinessTimeout:    envDurationMillis("GATEWAY_READINESS_TIMEOUT_MS", 1000),
		ProviderTimeout:     envDurationMillis("GATEWAY_PROVIDER_TIMEOUT_MS", 5000),
		MaxRequestBodyBytes: envInt64("GATEWAY_MAX_REQUEST_BODY_BYTES", 4*1024*1024),
		ExactCacheTTL:       envDurationSeconds("GATEWAY_EXACT_CACHE_TTL_SECONDS", 600),
		ExactCacheKeySecret: envString("GATEWAY_EXACT_CACHE_KEY_SECRET", "cache_key_secret_for_p0_demo_only"),
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

func envDurationSeconds(key string, fallback int) time.Duration {
	value := os.Getenv(key)
	if value == "" {
		return time.Duration(fallback) * time.Second
	}

	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return time.Duration(fallback) * time.Second
	}

	return time.Duration(seconds) * time.Second
}

func envInt64(key string, fallback int64) int64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return fallback
	}

	return parsed
}

func DatabaseDriverURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	query := parsed.Query()
	query.Del("schema")
	parsed.RawQuery = query.Encode()

	return parsed.String()
}
