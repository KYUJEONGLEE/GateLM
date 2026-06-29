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
	OpenAIProviderName  string
	OpenAIBaseURL       string
	OpenAIAPIKey        string
	DefaultProvider     string
	DefaultModel        string
	LowCostModel        string
	HighQualityModel    string
	RuntimeConfigHash   string
	SecurityPolicyHash  string
	RoutingPolicyHash   string
	CachePolicyHash     string
	ShortPromptMaxChars int
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
	RateLimitEnabled    bool
	RateLimitWindowSecs int
	RateLimitLimit      int
}

func Load() Config {
	return Config{
		Port:                envString("GATEWAY_PORT", "8080"),
		DatabaseURL:         envString("DATABASE_URL", "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"),
		RedisURL:            envString("REDIS_URL", "redis://localhost:6379"),
		MockProviderBaseURL: envString("MOCK_PROVIDER_BASE_URL", "http://localhost:8090"),
		OpenAIProviderName:  envString("GATEWAY_OPENAI_PROVIDER_NAME", "openai"),
		OpenAIBaseURL:       envString("GATEWAY_OPENAI_BASE_URL", "https://api.openai.com"),
		OpenAIAPIKey:        envString("GATEWAY_OPENAI_API_KEY", ""),
		DefaultProvider:     envString("GATEWAY_DEFAULT_PROVIDER", "mock"),
		DefaultModel:        envString("GATEWAY_DEFAULT_MODEL", "mock-balanced"),
		LowCostModel:        envString("GATEWAY_LOW_COST_MODEL", "mock-fast"),
		HighQualityModel:    envString("GATEWAY_HIGH_QUALITY_MODEL", "mock-smart"),
		RuntimeConfigHash:   envString("GATEWAY_RUNTIME_CONFIG_HASH", "hash_runtime_config_v1_local"),
		SecurityPolicyHash:  envString("GATEWAY_SECURITY_POLICY_HASH", "hash_security_policy_v1_local"),
		RoutingPolicyHash:   envString("GATEWAY_ROUTING_POLICY_HASH", "hash_routing_policy_v1_local"),
		CachePolicyHash:     envString("GATEWAY_CACHE_POLICY_HASH", "cache_p0_v1"),
		ShortPromptMaxChars: envInt("GATEWAY_SHORT_PROMPT_MAX_CHARS", 300),
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
		RateLimitEnabled:    envBool("GATEWAY_RATE_LIMIT_ENABLED", true),
		RateLimitWindowSecs: envInt("GATEWAY_RATE_LIMIT_WINDOW_SECONDS", 60),
		RateLimitLimit:      envInt("GATEWAY_RATE_LIMIT_LIMIT", 60),
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

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}

	return parsed
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
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
