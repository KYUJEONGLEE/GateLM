package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
)

const (
	SemanticCacheStoreInMemory           = "in_memory"
	SemanticCacheEmbeddingProviderFake   = "fake"
	SemanticCacheEmbeddingProviderOpenAI = "openai"
	SemanticCacheClassifierTypeNoop      = cachekey.CacheabilityClassifierTypeNoop
	SemanticCacheClassifierTypeStub      = cachekey.CacheabilityClassifierTypeStub
	SemanticCacheClassifierTypeFastText  = cachekey.CacheabilityClassifierTypeFastText
)

type Config struct {
	Port                     string
	DatabaseURL              string
	RedisURL                 string
	ControlPlaneBaseURL      string
	ControlPlaneTimeout      time.Duration
	RuntimeSnapshotMode      string
	AuthSource               string
	MockProviderBaseURL      string
	DefaultProvider          string
	DefaultModel             string
	LowCostModel             string
	HighQualityModel         string
	ProviderCatalogID        string
	ProviderCatalogVersion   int
	ProviderCatalogHash      string
	OpenAIProviderID         string
	OpenAIProviderName       string
	OpenAIProviderBaseURL    string
	OpenAICredentialRefID    string
	OpenAILowCostModelID     string
	OpenAILowCostModelName   string
	OpenAIBalancedModelID    string
	OpenAIBalancedModelName  string
	MockProviderID           string
	MockProviderName         string
	ProviderCredentialEnvMap string
	RuntimeConfigHash        string
	SecurityPolicyHash       string
	RoutingPolicyHash        string
	CachePolicyHash          string
	ShortPromptMaxChars      int
	DemoAPIKey               string
	DemoAppToken             string
	DemoTenantID             string
	DemoProjectID            string
	DemoApplicationID        string
	DemoAPIKeyID             string
	DemoAppTokenID           string
	ExpectedTenantID         string
	ExpectedProjectID        string
	ExpectedApplicationID    string
	ReadinessTimeout         time.Duration
	ProviderTimeout          time.Duration
	MaxRequestBodyBytes      int64
	ExactCacheTTL            time.Duration
	ExactCacheKeySecret      string
	RateLimitEnabled         bool
	RateLimitWindowSecs      int
	RateLimitLimit           int
	AsyncLogEnabled          bool
	AsyncLogQueueSize        int
	AsyncLogWorkerCount      int
	AsyncLogWriteTimeout     time.Duration
	AsyncLogShutdownTimeout  time.Duration
	PromptCaptureEnabled     bool
	PromptCaptureMaxChars    int
	ResponseCaptureEnabled   bool
	ResponseCaptureMaxChars  int
	SemanticCache            SemanticCacheConfig
}

type SemanticCacheConfig struct {
	Enabled                 bool
	Mode                    string
	Threshold               float64
	TopK                    int
	TTL                     time.Duration
	Store                   string
	MaxEntries              int
	EmbeddingProvider       string
	EmbeddingModel          string
	EmbeddingDimensions     int
	EmbeddingTimeout        time.Duration
	OpenAIBaseURL           string
	OpenAIAPIKey            string
	PolicyVersion           string
	KeyVersion              string
	IntentPolicyPath        string
	AllowCategories         []string
	DenyCategories          []string
	AllowedTenantIDs        []string
	AllowedApplicationIDs   []string
	AllowedCategories       []string
	CategoryThresholds      map[string]float64
	ClassifierEnabled       bool
	ClassifierType          string
	ClassifierEndpoint      string
	ClassifierMinConfidence float64
	ClassifierTimeout       time.Duration
}

func Load() Config {
	cfg, _ := LoadWithError()
	return cfg
}

func LoadWithError() (Config, error) {
	semanticCache, err := LoadSemanticCacheConfig()
	cfg := Config{
		Port:                     envString("GATEWAY_PORT", "8080"),
		DatabaseURL:              envString("DATABASE_URL", "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public"),
		RedisURL:                 envString("REDIS_URL", "redis://localhost:6379"),
		ControlPlaneBaseURL:      envString("GATEWAY_CONTROL_PLANE_BASE_URL", ""),
		ControlPlaneTimeout:      envDurationMillis("GATEWAY_CONTROL_PLANE_TIMEOUT_MS", 2000),
		RuntimeSnapshotMode:      envString("GATEWAY_RUNTIME_SNAPSHOT_MODE", "demo"),
		AuthSource:               envString("GATEWAY_AUTH_SOURCE", "database"),
		MockProviderBaseURL:      envString("MOCK_PROVIDER_BASE_URL", "http://localhost:8090"),
		DefaultProvider:          envString("GATEWAY_DEFAULT_PROVIDER", "mock"),
		DefaultModel:             envString("GATEWAY_DEFAULT_MODEL", "mock-balanced"),
		LowCostModel:             envString("GATEWAY_LOW_COST_MODEL", "mock-fast"),
		HighQualityModel:         envString("GATEWAY_HIGH_QUALITY_MODEL", "mock-smart"),
		ProviderCatalogID:        envString("GATEWAY_PROVIDER_CATALOG_ID", "provider_catalog_local_static"),
		ProviderCatalogVersion:   envInt("GATEWAY_PROVIDER_CATALOG_VERSION", 1),
		ProviderCatalogHash:      envString("GATEWAY_PROVIDER_CATALOG_HASH", "sha256:provider-catalog-local-static"),
		OpenAIProviderID:         envString("GATEWAY_OPENAI_PROVIDER_ID", "provider_openai_main"),
		OpenAIProviderName:       envString("GATEWAY_OPENAI_PROVIDER_NAME", "openai-main"),
		OpenAIProviderBaseURL:    envString("GATEWAY_OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAICredentialRefID:    envString("GATEWAY_OPENAI_CREDENTIAL_REF_ID", "credential_ref_openai_main"),
		OpenAILowCostModelID:     envString("GATEWAY_OPENAI_LOW_COST_MODEL_ID", "openai-low-cost"),
		OpenAILowCostModelName:   envString("GATEWAY_OPENAI_LOW_COST_MODEL_NAME", "gpt-4o-mini"),
		OpenAIBalancedModelID:    envString("GATEWAY_OPENAI_BALANCED_MODEL_ID", "openai-balanced"),
		OpenAIBalancedModelName:  envString("GATEWAY_OPENAI_BALANCED_MODEL_NAME", "gpt-4o"),
		MockProviderID:           envString("GATEWAY_MOCK_PROVIDER_ID", "provider_mock_local"),
		MockProviderName:         envString("GATEWAY_MOCK_PROVIDER_NAME", "mock"),
		ProviderCredentialEnvMap: envString("GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP", "credential_ref_openai_main=OPENAI_API_KEY,provider_credential:00000000-0000-4000-8000-000000000601=OPENAI_API_KEY"),
		RuntimeConfigHash:        envString("GATEWAY_RUNTIME_CONFIG_HASH", "hash_runtime_config_v1_local"),
		SecurityPolicyHash:       envString("GATEWAY_SECURITY_POLICY_HASH", "hash_security_policy_v1_local"),
		RoutingPolicyHash:        envString("GATEWAY_ROUTING_POLICY_HASH", "hash_routing_policy_v1_local"),
		CachePolicyHash:          envString("GATEWAY_CACHE_POLICY_HASH", "cache_p0_v1"),
		ShortPromptMaxChars:      envInt("GATEWAY_SHORT_PROMPT_MAX_CHARS", 300),
		DemoAPIKey:               envString("GATELM_DEMO_API_KEY", "glm_api_test_redacted"),
		DemoAppToken:             envString("GATELM_DEMO_APP_TOKEN", "glm_app_token_test_redacted"),
		DemoTenantID:             envString("GATELM_DEMO_TENANT_ID", "00000000-0000-4000-8000-000000000100"),
		DemoProjectID:            envString("GATELM_DEMO_PROJECT_ID", "00000000-0000-4000-8000-000000000200"),
		DemoApplicationID:        envString("GATELM_DEMO_APPLICATION_ID", "00000000-0000-4000-8000-000000000300"),
		DemoAPIKeyID:             envString("GATELM_DEMO_API_KEY_ID", "00000000-0000-4000-8000-000000000400"),
		DemoAppTokenID:           envString("GATELM_DEMO_APP_TOKEN_ID", "00000000-0000-4000-8000-000000000500"),
		ExpectedTenantID:         envString("GATEWAY_EXPECTED_TENANT_ID", ""),
		ExpectedProjectID:        envString("GATEWAY_EXPECTED_PROJECT_ID", ""),
		ExpectedApplicationID:    envString("GATEWAY_EXPECTED_APPLICATION_ID", ""),
		ReadinessTimeout:         envDurationMillis("GATEWAY_READINESS_TIMEOUT_MS", 1000),
		ProviderTimeout:          envDurationMillis("GATEWAY_PROVIDER_TIMEOUT_MS", 5000),
		MaxRequestBodyBytes:      envInt64("GATEWAY_MAX_REQUEST_BODY_BYTES", 4*1024*1024),
		ExactCacheTTL:            envDurationSeconds("GATEWAY_EXACT_CACHE_TTL_SECONDS", 600),
		ExactCacheKeySecret:      envString("GATEWAY_EXACT_CACHE_KEY_SECRET", "cache_key_secret_for_p0_demo_only"),
		RateLimitEnabled:         envBool("GATEWAY_RATE_LIMIT_ENABLED", true),
		RateLimitWindowSecs:      envInt("GATEWAY_RATE_LIMIT_WINDOW_SECONDS", 60),
		RateLimitLimit:           envInt("GATEWAY_RATE_LIMIT_LIMIT", 60),
		AsyncLogEnabled:          envBool("GATEWAY_ASYNC_LOG_ENABLED", true),
		AsyncLogQueueSize:        envInt("GATEWAY_ASYNC_LOG_QUEUE_SIZE", 1024),
		AsyncLogWorkerCount:      envInt("GATEWAY_ASYNC_LOG_WORKER_COUNT", 2),
		AsyncLogWriteTimeout:     envDurationMillis("GATEWAY_ASYNC_LOG_WRITE_TIMEOUT_MS", 2000),
		AsyncLogShutdownTimeout:  envDurationMillis("GATEWAY_ASYNC_LOG_SHUTDOWN_TIMEOUT_MS", 5000),
		PromptCaptureEnabled:     envBool("GATEWAY_PROMPT_CAPTURE_ENABLED", false),
		PromptCaptureMaxChars:    envInt("GATEWAY_PROMPT_CAPTURE_MAX_CHARS", 8000),
		ResponseCaptureEnabled:   envBool("GATEWAY_RESPONSE_CAPTURE_ENABLED", false),
		ResponseCaptureMaxChars:  envInt("GATEWAY_RESPONSE_CAPTURE_MAX_CHARS", 8000),
		SemanticCache:            semanticCache,
	}
	return cfg, err
}

func LoadSemanticCacheConfig() (SemanticCacheConfig, error) {
	enabled, err := semanticEnvBool("SEMANTIC_CACHE_ENABLED", false)
	if err != nil {
		return SemanticCacheConfig{}, err
	}
	classifierEnabled, err := semanticEnvBool("SEMANTIC_CACHE_CLASSIFIER_ENABLED", false)
	if err != nil {
		return SemanticCacheConfig{}, err
	}
	mode := semanticEnvString("SEMANTIC_CACHE_MODE", cachekey.SemanticCacheModeEnforce)
	switch mode {
	case cachekey.SemanticCacheModeOff, cachekey.SemanticCacheModeShadow, cachekey.SemanticCacheModeEnforce:
	default:
		return SemanticCacheConfig{}, fmt.Errorf("unsupported semantic cache mode %q", mode)
	}
	store := semanticEnvString("SEMANTIC_CACHE_STORE", SemanticCacheStoreInMemory)
	if store != SemanticCacheStoreInMemory {
		return SemanticCacheConfig{}, fmt.Errorf("unsupported semantic cache store %q", store)
	}
	embeddingProvider := semanticEnvString("SEMANTIC_CACHE_EMBEDDING_PROVIDER", SemanticCacheEmbeddingProviderFake)
	if embeddingProvider != SemanticCacheEmbeddingProviderFake && embeddingProvider != SemanticCacheEmbeddingProviderOpenAI {
		return SemanticCacheConfig{}, fmt.Errorf("unsupported semantic cache embedding provider %q", embeddingProvider)
	}
	classifierType := semanticEnvString("SEMANTIC_CACHE_CLASSIFIER_TYPE", SemanticCacheClassifierTypeStub)
	switch classifierType {
	case SemanticCacheClassifierTypeNoop, SemanticCacheClassifierTypeStub, SemanticCacheClassifierTypeFastText:
	default:
		return SemanticCacheConfig{}, fmt.Errorf("unsupported semantic cache classifier type %q", classifierType)
	}
	classifierEndpoint := semanticEnvString("SEMANTIC_CACHE_CLASSIFIER_ENDPOINT", "")
	if classifierEnabled && classifierType == SemanticCacheClassifierTypeFastText {
		parsedEndpoint, parseErr := url.Parse(classifierEndpoint)
		if strings.TrimSpace(classifierEndpoint) == "" || parseErr != nil || parsedEndpoint.Scheme == "" || parsedEndpoint.Host == "" {
			return SemanticCacheConfig{}, fmt.Errorf("SEMANTIC_CACHE_CLASSIFIER_ENDPOINT is required when SEMANTIC_CACHE_CLASSIFIER_ENABLED=true and SEMANTIC_CACHE_CLASSIFIER_TYPE=fasttext")
		}
	}
	intentPolicyPath := semanticEnvString("SEMANTIC_CACHE_INTENT_POLICY_PATH", "")
	openAIAPIKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if enabled && mode != cachekey.SemanticCacheModeOff && embeddingProvider == SemanticCacheEmbeddingProviderOpenAI && strings.TrimSpace(intentPolicyPath) != "" && openAIAPIKey == "" {
		return SemanticCacheConfig{}, fmt.Errorf("OPENAI_API_KEY is required when SEMANTIC_CACHE_ENABLED=true, SEMANTIC_CACHE_MODE is not off, SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai, and SEMANTIC_CACHE_INTENT_POLICY_PATH is set")
	}
	threshold := semanticEnvFloat("SEMANTIC_CACHE_THRESHOLD", 0.92, 0, 1)
	threshold = semanticEnvFloat("SEMANTIC_CACHE_DEFAULT_THRESHOLD", threshold, 0, 1)

	return SemanticCacheConfig{
		Enabled:                 enabled,
		Mode:                    mode,
		Threshold:               threshold,
		TopK:                    semanticEnvInt("SEMANTIC_CACHE_TOP_K", 3, 1),
		TTL:                     time.Duration(semanticEnvInt("SEMANTIC_CACHE_TTL_SECONDS", 3600, 1)) * time.Second,
		Store:                   store,
		MaxEntries:              semanticEnvInt("SEMANTIC_CACHE_MAX_ENTRIES", 1000, 1),
		EmbeddingProvider:       embeddingProvider,
		EmbeddingModel:          semanticEnvString("SEMANTIC_CACHE_EMBEDDING_MODEL", "text-embedding-3-small"),
		EmbeddingDimensions:     semanticEnvInt("SEMANTIC_CACHE_EMBEDDING_DIMENSIONS", 0, 0),
		EmbeddingTimeout:        time.Duration(semanticEnvInt("SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS", 3000, 1)) * time.Millisecond,
		OpenAIBaseURL:           semanticEnvString("SEMANTIC_CACHE_OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAIAPIKey:            openAIAPIKey,
		PolicyVersion:           semanticEnvString("SEMANTIC_CACHE_POLICY_VERSION", "v1"),
		KeyVersion:              semanticEnvString("SEMANTIC_CACHE_KEY_VERSION", "v1"),
		IntentPolicyPath:        intentPolicyPath,
		AllowCategories:         semanticEnvCSV("SEMANTIC_CACHE_ALLOW_CATEGORIES", []string{"general", "support_refund"}),
		DenyCategories:          semanticEnvCSV("SEMANTIC_CACHE_DENY_CATEGORIES", []string{"code", "translation", "summarization", "extraction_json", "reasoning", "sensitive", "tool_call", "unknown"}),
		AllowedTenantIDs:        semanticEnvCSV("SEMANTIC_CACHE_ALLOWED_TENANT_IDS", nil),
		AllowedApplicationIDs:   semanticEnvCSV("SEMANTIC_CACHE_ALLOWED_APPLICATION_IDS", nil),
		AllowedCategories:       semanticEnvCSV("SEMANTIC_CACHE_ALLOWED_CATEGORIES", nil),
		CategoryThresholds:      semanticCacheCategoryThresholds(),
		ClassifierEnabled:       classifierEnabled,
		ClassifierType:          classifierType,
		ClassifierEndpoint:      classifierEndpoint,
		ClassifierMinConfidence: semanticEnvFloat("SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE", cachekey.DefaultCacheabilityClassifierMinConfidence, 0, 1),
		ClassifierTimeout:       time.Duration(semanticEnvInt("SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS", int(cachekey.DefaultCacheabilityClassifierTimeout.Milliseconds()), 1)) * time.Millisecond,
	}, nil
}

func semanticCacheCategoryThresholds() map[string]float64 {
	envByCategory := map[string]string{
		"general":        "SEMANTIC_CACHE_THRESHOLD_GENERAL",
		"account_access": "SEMANTIC_CACHE_THRESHOLD_ACCOUNT_ACCESS",
		"support_refund": "SEMANTIC_CACHE_THRESHOLD_SUPPORT_REFUND",
		"code":           "SEMANTIC_CACHE_THRESHOLD_CODE",
		"translation":    "SEMANTIC_CACHE_THRESHOLD_TRANSLATION",
		"unknown":        "SEMANTIC_CACHE_THRESHOLD_UNKNOWN",
	}
	thresholds := map[string]float64{}
	for category, key := range envByCategory {
		value := semanticEnvString(key, "")
		if value == "" {
			continue
		}
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil || parsed <= 0 || parsed > 1 {
			continue
		}
		thresholds[category] = parsed
	}
	if len(thresholds) == 0 {
		return nil
	}
	return thresholds
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

func semanticEnvString(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		value = strings.TrimSpace(os.Getenv("GATEWAY_" + key))
	}
	if value == "" {
		return fallback
	}
	return value
}

func semanticEnvBool(key string, fallback bool) (bool, error) {
	value := semanticEnvString(key, "")
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be a boolean: %w", key, err)
	}
	return parsed, nil
}

func semanticEnvFloat(key string, fallback float64, minVal float64, maxVal float64) float64 {
	value := semanticEnvString(key, "")
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed < minVal || parsed > maxVal {
		return fallback
	}
	return parsed
}

func semanticEnvInt(key string, fallback int, minVal int) int {
	value := semanticEnvString(key, "")
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < minVal {
		return fallback
	}
	return parsed
}

func semanticEnvCSV(key string, fallback []string) []string {
	value := semanticEnvString(key, "")
	if value == "" {
		return append([]string{}, fallback...)
	}
	parts := strings.Split(value, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	if len(values) == 0 {
		return append([]string{}, fallback...)
	}
	return values
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
