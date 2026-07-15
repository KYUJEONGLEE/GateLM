package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	cachekey "gatelm/apps/gateway-core/internal/domain/cache"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	SemanticCacheStoreInMemory           = "in_memory"
	SemanticCacheEmbeddingProviderFake   = "fake"
	SemanticCacheEmbeddingProviderOpenAI = "openai"
	SemanticCacheClassifierTypeNoop      = cachekey.CacheabilityClassifierTypeNoop
	SemanticCacheClassifierTypeStub      = cachekey.CacheabilityClassifierTypeStub
	SemanticCacheClassifierTypeFastText  = cachekey.CacheabilityClassifierTypeFastText

	RateLimitBackendPostgres      = "postgres"
	RateLimitBackendRedis         = "redis"
	RateLimitAlgorithmFixedWindow = "fixed_window"
	RateLimitAlgorithmTokenBucket = "token_bucket"
)

var defaultOpenAIExtraModelNames = []string{
	"gpt-5.5",
	"gpt-5.5-pro",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.4-nano",
	"gpt-5.4-pro",
	"gpt-5.3-codex",
	"gpt-5.2",
	"gpt-5.2-pro",
	"gpt-5.2-codex",
	"gpt-5.1",
	"gpt-5.1-codex",
	"gpt-5.1-codex-mini",
	"gpt-5.1-codex-max",
	"gpt-5",
	"gpt-5-mini",
	"gpt-5-nano",
	"gpt-5-pro",
	"gpt-4.5-preview",
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4.1-nano",
	"gpt-3.5-turbo",
	"chat-latest",
}

type Config struct {
	Port                                   string
	DatabaseURL                            string
	DatabasePool                           PostgresPoolConfig
	LogDatabaseURL                         string
	LogDatabasePool                        PostgresPoolConfig
	RedisURL                               string
	ControlPlaneBaseURL                    string
	ControlPlaneInternalToken              string
	ControlPlaneTimeout                    time.Duration
	ObservabilityInternalToken             string
	ObservabilityAuthRequired              bool
	RuntimeSnapshotMode                    string
	RuntimeSnapshotCache                   RuntimeSnapshotCacheConfig
	ProviderCatalogCache                   ProviderCatalogCacheConfig
	AuthSource                             string
	AuthCache                              AuthCacheConfig
	PricingCache                           PricingCacheConfig
	MockProviderBaseURL                    string
	ProviderCatalogID                      string
	ProviderCatalogVersion                 int
	ProviderCatalogHash                    string
	OpenAIProviderID                       string
	OpenAIProviderName                     string
	OpenAIProviderBaseURL                  string
	OpenAICredentialRefID                  string
	OpenAILowCostModelID                   string
	OpenAILowCostModelName                 string
	OpenAIBalancedModelID                  string
	OpenAIBalancedModelName                string
	OpenAIExtraModelNames                  []string
	MockProviderID                         string
	MockProviderName                       string
	ProviderCredentialEnvMap               string
	ProviderCredentialEncryptionKey        string
	ProviderCredentialEncryptionKeyVersion string
	RuntimeConfigHash                      string
	SecurityPolicyHash                     string
	RoutingPolicyHash                      string
	CachePolicyHash                        string
	ShortPromptMaxChars                    int
	DemoAPIKey                             string
	DemoAppToken                           string
	DemoTenantID                           string
	DemoProjectID                          string
	DemoApplicationID                      string
	DemoAPIKeyID                           string
	DemoAppTokenID                         string
	ExpectedTenantID                       string
	ExpectedProjectID                      string
	ExpectedApplicationID                  string
	ReadinessTimeout                       time.Duration
	ProviderTimeout                        time.Duration
	ProviderTransport                      ProviderTransportConfig
	MaxRequestBodyBytes                    int64
	ExactCacheTTL                          time.Duration
	ExactCacheKeySecret                    string
	RateLimitEnabled                       bool
	RateLimitWindowSecs                    int
	RateLimitLimit                         int
	RateLimitBackend                       string
	RateLimitAlgorithm                     string
	RateLimitRedisKeyPrefix                string
	AISafetySidecar                        AISafetySidecarConfig
	AsyncLogEnabled                        bool
	AsyncLogQueueSize                      int
	AsyncLogWorkerCount                    int
	AsyncLogBatchSize                      int
	AsyncLogBatchFlushInterval             time.Duration
	AsyncLogWriteTimeout                   time.Duration
	AsyncLogShutdownTimeout                time.Duration
	PromptCaptureEnabled                   bool
	PromptCaptureMaxChars                  int
	DeploymentMode                         string
	RawResponseCaptureEnabled              bool
	ResponseCaptureEnabled                 bool
	ResponseCaptureMaxChars                int
	SemanticCache                          SemanticCacheConfig
	DifficultyE5Shadow                     DifficultyE5ShadowConfig
	TenantChatPrivate                      TenantChatPrivateConfig
}

type DifficultyE5ShadowConfig struct {
	Enabled             bool
	ArtifactRoot        string
	EncoderManifestPath string
	RuntimeLockPath     string
}

type TenantChatPrivateConfig struct {
	Enabled               bool
	ListenAddress         string
	WorkloadJWKSFile      string
	BindingHMACKeysFile   string
	CacheKeySetsFile      string
	UsageReceiptTokenFile string
	WorkloadJTIPrefix     string
}

type AISafetySidecarConfig struct {
	Enabled     bool
	EndpointURL string
	Timeout     time.Duration
	ModelID     string
	DetectorSet string
	Locale      string
}

type RuntimeSnapshotCacheConfig struct {
	Enabled  bool
	TTL      time.Duration
	StaleTTL time.Duration
}

type ProviderCatalogCacheConfig struct {
	Enabled  bool
	TTL      time.Duration
	StaleTTL time.Duration
}

type PostgresPoolConfig struct {
	MaxConns          int
	MinConns          int
	MaxConnLifetime   time.Duration
	MaxConnIdleTime   time.Duration
	HealthCheckPeriod time.Duration
}

type AuthCacheConfig struct {
	Enabled    bool
	TTL        time.Duration
	MaxEntries int
	KeySecret  string
}

type PricingCacheConfig struct {
	Enabled    bool
	TTL        time.Duration
	MaxEntries int
}

type ProviderTransportConfig struct {
	MaxIdleConns          int
	MaxIdleConnsPerHost   int
	MaxConnsPerHost       int
	IdleConnTimeout       time.Duration
	DialTimeout           time.Duration
	DialKeepAlive         time.Duration
	TLSHandshakeTimeout   time.Duration
	ResponseHeaderTimeout time.Duration
	ExpectContinueTimeout time.Duration
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
	databaseURL := envString("DATABASE_URL", "postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public")
	exactCacheKeySecret := envString("GATEWAY_EXACT_CACHE_KEY_SECRET", "cache_key_secret_for_p0_demo_only")
	providerTimeout := envDurationMillis("GATEWAY_PROVIDER_TIMEOUT_MS", 5000)
	rateLimitBackend := normalizeRateLimitBackend(envString("GATEWAY_RATE_LIMIT_BACKEND", RateLimitBackendRedis))
	rateLimitAlgorithm := normalizeRateLimitAlgorithm(os.Getenv("GATEWAY_RATE_LIMIT_ALGORITHM"), rateLimitBackend)
	deploymentMode := normalizeDeploymentMode(envString("DEPLOYMENT_MODE", ""))
	requireObservabilityAuth := observabilityAuthRequired(deploymentMode)
	cfg := Config{
		Port:        envString("GATEWAY_PORT", "8080"),
		DatabaseURL: databaseURL,
		DatabasePool: PostgresPoolConfig{
			MaxConns:          envInt("GATEWAY_DATABASE_MAX_CONNS", 16),
			MinConns:          envInt("GATEWAY_DATABASE_MIN_CONNS", 2),
			MaxConnLifetime:   envDurationMillis("GATEWAY_DATABASE_MAX_CONN_LIFETIME_MS", 1800000),
			MaxConnIdleTime:   envDurationMillis("GATEWAY_DATABASE_MAX_CONN_IDLE_TIME_MS", 300000),
			HealthCheckPeriod: envDurationMillis("GATEWAY_DATABASE_HEALTH_CHECK_PERIOD_MS", 60000),
		},
		LogDatabaseURL: envString("GATEWAY_LOG_DATABASE_URL", databaseURL),
		LogDatabasePool: PostgresPoolConfig{
			MaxConns:          envInt("GATEWAY_LOG_DATABASE_MAX_CONNS", 4),
			MinConns:          envInt("GATEWAY_LOG_DATABASE_MIN_CONNS", 2),
			MaxConnLifetime:   envDurationMillis("GATEWAY_LOG_DATABASE_MAX_CONN_LIFETIME_MS", 1800000),
			MaxConnIdleTime:   envDurationMillis("GATEWAY_LOG_DATABASE_MAX_CONN_IDLE_TIME_MS", 300000),
			HealthCheckPeriod: envDurationMillis("GATEWAY_LOG_DATABASE_HEALTH_CHECK_PERIOD_MS", 60000),
		},
		RedisURL:            envString("REDIS_URL", "redis://localhost:6379"),
		ControlPlaneBaseURL: envString("GATEWAY_CONTROL_PLANE_BASE_URL", ""),
		ControlPlaneInternalToken: strings.TrimSpace(
			envString("GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN", ""),
		),
		ControlPlaneTimeout:        envDurationMillis("GATEWAY_CONTROL_PLANE_TIMEOUT_MS", 2000),
		ObservabilityInternalToken: strings.TrimSpace(envString("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", "")),
		ObservabilityAuthRequired:  requireObservabilityAuth,
		RuntimeSnapshotMode:        envString("GATEWAY_RUNTIME_SNAPSHOT_MODE", "demo"),
		RuntimeSnapshotCache: RuntimeSnapshotCacheConfig{
			Enabled:  envBool("GATEWAY_RUNTIME_SNAPSHOT_CACHE_ENABLED", true),
			TTL:      envDurationMillis("GATEWAY_RUNTIME_SNAPSHOT_CACHE_TTL_MS", 5000),
			StaleTTL: envDurationMillis("GATEWAY_RUNTIME_SNAPSHOT_CACHE_STALE_TTL_MS", 60000),
		},
		ProviderCatalogCache: ProviderCatalogCacheConfig{
			Enabled:  envBool("GATEWAY_PROVIDER_CATALOG_CACHE_ENABLED", true),
			TTL:      envDurationMillis("GATEWAY_PROVIDER_CATALOG_CACHE_TTL_MS", 5000),
			StaleTTL: envDurationMillis("GATEWAY_PROVIDER_CATALOG_CACHE_STALE_TTL_MS", 60000),
		},
		AuthSource: envString("GATEWAY_AUTH_SOURCE", "database"),
		AuthCache: AuthCacheConfig{
			Enabled:    envBool("GATEWAY_AUTH_CACHE_ENABLED", false),
			TTL:        envDurationMillis("GATEWAY_AUTH_CACHE_TTL_MS", 1000),
			MaxEntries: envInt("GATEWAY_AUTH_CACHE_MAX_ENTRIES", 4096),
			KeySecret:  envString("GATEWAY_AUTH_CACHE_KEY_SECRET", exactCacheKeySecret),
		},
		PricingCache: PricingCacheConfig{
			Enabled:    envBool("GATEWAY_PRICING_CACHE_ENABLED", false),
			TTL:        envDurationMillis("GATEWAY_PRICING_CACHE_TTL_MS", 5000),
			MaxEntries: envInt("GATEWAY_PRICING_CACHE_MAX_ENTRIES", 1024),
		},
		MockProviderBaseURL:                    envString("MOCK_PROVIDER_BASE_URL", "http://localhost:8090"),
		ProviderCatalogID:                      envString("GATEWAY_PROVIDER_CATALOG_ID", "provider_catalog_local_static"),
		ProviderCatalogVersion:                 envInt("GATEWAY_PROVIDER_CATALOG_VERSION", 1),
		ProviderCatalogHash:                    envString("GATEWAY_PROVIDER_CATALOG_HASH", "sha256:provider-catalog-local-static"),
		OpenAIProviderID:                       envString("GATEWAY_OPENAI_PROVIDER_ID", "provider_openai_main"),
		OpenAIProviderName:                     envString("GATEWAY_OPENAI_PROVIDER_NAME", "openai-main"),
		OpenAIProviderBaseURL:                  envString("GATEWAY_OPENAI_BASE_URL", "https://api.openai.com/v1"),
		OpenAICredentialRefID:                  envString("GATEWAY_OPENAI_CREDENTIAL_REF_ID", "credential_ref_openai_main"),
		OpenAILowCostModelID:                   envString("GATEWAY_OPENAI_LOW_COST_MODEL_ID", "openai-low-cost"),
		OpenAILowCostModelName:                 envString("GATEWAY_OPENAI_LOW_COST_MODEL_NAME", "gpt-4o-mini"),
		OpenAIBalancedModelID:                  envString("GATEWAY_OPENAI_BALANCED_MODEL_ID", "openai-balanced"),
		OpenAIBalancedModelName:                envString("GATEWAY_OPENAI_BALANCED_MODEL_NAME", "gpt-4o"),
		OpenAIExtraModelNames:                  envCSV("GATEWAY_OPENAI_EXTRA_MODELS", defaultOpenAIExtraModelNames),
		MockProviderID:                         envString("GATEWAY_MOCK_PROVIDER_ID", "provider_mock_local"),
		MockProviderName:                       envString("GATEWAY_MOCK_PROVIDER_NAME", "mock"),
		ProviderCredentialEnvMap:               envString("GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP", "credential_ref_openai_main=OPENAI_API_KEY,provider_credential:00000000-0000-4000-8000-000000000601=OPENAI_API_KEY"),
		ProviderCredentialEncryptionKey:        envString("GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY", envString("PROVIDER_CREDENTIAL_ENCRYPTION_KEY", "")),
		ProviderCredentialEncryptionKeyVersion: envString("GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION", envString("PROVIDER_CREDENTIAL_ENCRYPTION_KEY_VERSION", "v1")),
		RuntimeConfigHash:                      envString("GATEWAY_RUNTIME_CONFIG_HASH", "hash_runtime_config_v1_local"),
		SecurityPolicyHash:                     envString("GATEWAY_SECURITY_POLICY_HASH", "hash_security_policy_v1_local"),
		RoutingPolicyHash:                      envString("GATEWAY_ROUTING_POLICY_HASH", routing.DefaultPolicyHash),
		CachePolicyHash:                        envString("GATEWAY_CACHE_POLICY_HASH", "cache_p0_v1"),
		ShortPromptMaxChars:                    envInt("GATEWAY_SHORT_PROMPT_MAX_CHARS", 300),
		DemoAPIKey:                             envString("GATELM_DEMO_API_KEY", "glm_api_test_redacted"),
		DemoAppToken:                           envString("GATELM_DEMO_APP_TOKEN", "glm_app_token_test_redacted"),
		DemoTenantID:                           envString("GATELM_DEMO_TENANT_ID", "00000000-0000-4000-8000-000000000100"),
		DemoProjectID:                          envString("GATELM_DEMO_PROJECT_ID", "00000000-0000-4000-8000-000000000200"),
		DemoApplicationID:                      envString("GATELM_DEMO_APPLICATION_ID", "00000000-0000-4000-8000-000000000300"),
		DemoAPIKeyID:                           envString("GATELM_DEMO_API_KEY_ID", "00000000-0000-4000-8000-000000000400"),
		DemoAppTokenID:                         envString("GATELM_DEMO_APP_TOKEN_ID", "00000000-0000-4000-8000-000000000500"),
		ExpectedTenantID:                       envString("GATEWAY_EXPECTED_TENANT_ID", ""),
		ExpectedProjectID:                      envString("GATEWAY_EXPECTED_PROJECT_ID", ""),
		ExpectedApplicationID:                  envString("GATEWAY_EXPECTED_APPLICATION_ID", ""),
		ReadinessTimeout:                       envDurationMillis("GATEWAY_READINESS_TIMEOUT_MS", 1000),
		ProviderTimeout:                        providerTimeout,
		ProviderTransport: ProviderTransportConfig{
			MaxIdleConns:          envInt("GATEWAY_PROVIDER_MAX_IDLE_CONNS", 512),
			MaxIdleConnsPerHost:   envInt("GATEWAY_PROVIDER_MAX_IDLE_CONNS_PER_HOST", 256),
			MaxConnsPerHost:       envInt("GATEWAY_PROVIDER_MAX_CONNS_PER_HOST", 256),
			IdleConnTimeout:       envDurationMillis("GATEWAY_PROVIDER_IDLE_CONN_TIMEOUT_MS", 90000),
			DialTimeout:           envDurationMillis("GATEWAY_PROVIDER_DIAL_TIMEOUT_MS", 5000),
			DialKeepAlive:         envDurationMillis("GATEWAY_PROVIDER_DIAL_KEEP_ALIVE_MS", 30000),
			TLSHandshakeTimeout:   envDurationMillis("GATEWAY_PROVIDER_TLS_HANDSHAKE_TIMEOUT_MS", 10000),
			ResponseHeaderTimeout: envDurationMillis("GATEWAY_PROVIDER_RESPONSE_HEADER_TIMEOUT_MS", int(providerTimeout.Milliseconds())),
			ExpectContinueTimeout: envDurationMillis("GATEWAY_PROVIDER_EXPECT_CONTINUE_TIMEOUT_MS", 1000),
		},
		MaxRequestBodyBytes:     envInt64("GATEWAY_MAX_REQUEST_BODY_BYTES", 4*1024*1024),
		ExactCacheTTL:           envDurationSeconds("GATEWAY_EXACT_CACHE_TTL_SECONDS", 600),
		ExactCacheKeySecret:     exactCacheKeySecret,
		RateLimitEnabled:        envBool("GATEWAY_RATE_LIMIT_ENABLED", true),
		RateLimitWindowSecs:     envInt("GATEWAY_RATE_LIMIT_WINDOW_SECONDS", 60),
		RateLimitLimit:          envInt("GATEWAY_RATE_LIMIT_LIMIT", 60),
		RateLimitBackend:        rateLimitBackend,
		RateLimitAlgorithm:      rateLimitAlgorithm,
		RateLimitRedisKeyPrefix: strings.TrimSpace(envString("GATEWAY_RATE_LIMIT_REDIS_KEY_PREFIX", "")),
		AISafetySidecar: AISafetySidecarConfig{
			Enabled:     envBool("GATEWAY_AI_SAFETY_SIDECAR_ENABLED", true),
			EndpointURL: envString("GATEWAY_AI_SAFETY_SIDECAR_URL", "http://127.0.0.1:8001/internal/ai-safety/v1/detect"),
			Timeout:     envDurationMillis("GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS", 300),
			ModelID:     envString("GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID", "openai/privacy-filter"),
			DetectorSet: envString("GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET", "privacy-filter-default"),
			Locale:      envString("GATEWAY_AI_SAFETY_SIDECAR_LOCALE", ""),
		},
		AsyncLogEnabled:            envBool("GATEWAY_ASYNC_LOG_ENABLED", true),
		AsyncLogQueueSize:          envInt("GATEWAY_ASYNC_LOG_QUEUE_SIZE", 1024),
		AsyncLogWorkerCount:        envInt("GATEWAY_ASYNC_LOG_WORKER_COUNT", 2),
		AsyncLogBatchSize:          envInt("GATEWAY_ASYNC_LOG_BATCH_SIZE", 100),
		AsyncLogBatchFlushInterval: envDurationMillis("GATEWAY_ASYNC_LOG_BATCH_FLUSH_INTERVAL_MS", 10),
		AsyncLogWriteTimeout:       envDurationMillis("GATEWAY_ASYNC_LOG_WRITE_TIMEOUT_MS", 2000),
		AsyncLogShutdownTimeout:    envDurationMillis("GATEWAY_ASYNC_LOG_SHUTDOWN_TIMEOUT_MS", 5000),
		PromptCaptureEnabled:       envBool("GATEWAY_PROMPT_CAPTURE_ENABLED", false),
		PromptCaptureMaxChars:      envInt("GATEWAY_PROMPT_CAPTURE_MAX_CHARS", 8000),
		DeploymentMode:             deploymentMode,
		RawResponseCaptureEnabled:  rawResponseCaptureAllowed(deploymentMode),
		ResponseCaptureEnabled:     envBool("GATEWAY_RESPONSE_CAPTURE_ENABLED", false),
		ResponseCaptureMaxChars:    envInt("GATEWAY_RESPONSE_CAPTURE_MAX_CHARS", 8000),
		SemanticCache:              semanticCache,
		DifficultyE5Shadow: DifficultyE5ShadowConfig{
			Enabled:             envBool("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", false),
			ArtifactRoot:        strings.TrimSpace(envString("GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT", "/opt/gatelm/difficulty-e5")),
			EncoderManifestPath: strings.TrimSpace(envString("GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST", "/opt/gatelm/difficulty-e5/difficulty-e5-encoder-manifest.v1.json")),
			RuntimeLockPath:     strings.TrimSpace(envString("GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK", "/opt/gatelm/difficulty-e5/difficulty-e5-gateway-runtime-lock.linux-amd64.v1.json")),
		},
		TenantChatPrivate: TenantChatPrivateConfig{
			Enabled:               envBool("TENANT_CHAT_PRIVATE_GATEWAY_ENABLED", false),
			ListenAddress:         strings.TrimSpace(envString("TENANT_CHAT_PRIVATE_LISTEN_ADDRESS", ":8081")),
			WorkloadJWKSFile:      strings.TrimSpace(envString("TENANT_CHAT_WORKLOAD_JWKS_FILE", "")),
			BindingHMACKeysFile:   strings.TrimSpace(envString("TENANT_CHAT_BINDING_HMAC_KEYS_FILE", "")),
			CacheKeySetsFile:      strings.TrimSpace(envString("TENANT_CHAT_CACHE_KEYSETS_FILE", "")),
			UsageReceiptTokenFile: strings.TrimSpace(envString("TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE", "")),
			WorkloadJTIPrefix:     strings.TrimSpace(envString("TENANT_CHAT_WORKLOAD_JTI_REDIS_PREFIX", "tenant-chat:workload-jti:")),
		},
	}
	if err != nil {
		return cfg, err
	}
	if err := validateRateLimitConfig(cfg); err != nil {
		return cfg, err
	}
	if err := validatePostgresPoolConfig("database", cfg.DatabasePool); err != nil {
		return cfg, err
	}
	if err := validatePostgresPoolConfig("log database", cfg.LogDatabasePool); err != nil {
		return cfg, err
	}
	if cfg.AuthCache.Enabled && strings.TrimSpace(cfg.AuthCache.KeySecret) == "" {
		return cfg, errors.New("auth cache requires GATEWAY_AUTH_CACHE_KEY_SECRET")
	}
	if cfg.AuthCache.MaxEntries <= 0 || cfg.PricingCache.MaxEntries <= 0 {
		return cfg, errors.New("auth and pricing cache max entries must be positive")
	}
	if err := validateProviderTransportConfig(cfg.ProviderTransport); err != nil {
		return cfg, err
	}
	if err := validateTenantChatPrivateConfig(cfg); err != nil {
		return cfg, err
	}
	if err := validateObservabilityAuthConfig(cfg); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func validatePostgresPoolConfig(name string, cfg PostgresPoolConfig) error {
	if cfg.MaxConns <= 0 || cfg.MaxConns > 1000 {
		return fmt.Errorf("%s max connections must be between 1 and 1000", name)
	}
	if cfg.MinConns < 0 || cfg.MinConns > cfg.MaxConns {
		return fmt.Errorf("%s min connections must be between 0 and max connections", name)
	}
	return nil
}

func validateProviderTransportConfig(cfg ProviderTransportConfig) error {
	if cfg.MaxIdleConns <= 0 || cfg.MaxIdleConnsPerHost <= 0 || cfg.MaxConnsPerHost <= 0 {
		return errors.New("provider HTTP connection limits must be positive")
	}
	if cfg.MaxIdleConnsPerHost > cfg.MaxIdleConns {
		return errors.New("provider max idle connections per host cannot exceed total max idle connections")
	}
	if cfg.MaxIdleConnsPerHost > cfg.MaxConnsPerHost {
		return errors.New("provider max idle connections per host cannot exceed max connections per host")
	}
	return nil
}

func validateTenantChatPrivateConfig(cfg Config) error {
	private := cfg.TenantChatPrivate
	if !private.Enabled {
		return nil
	}
	if private.ListenAddress == "" {
		return fmt.Errorf("TENANT_CHAT_PRIVATE_LISTEN_ADDRESS is required when private Gateway is enabled")
	}
	if private.ListenAddress == ":"+cfg.Port || private.ListenAddress == "0.0.0.0:"+cfg.Port {
		return fmt.Errorf("Tenant Chat private listener must not share GATEWAY_PORT")
	}
	if private.WorkloadJWKSFile == "" {
		return fmt.Errorf("TENANT_CHAT_WORKLOAD_JWKS_FILE is required when private Gateway is enabled")
	}
	if private.BindingHMACKeysFile == "" {
		return fmt.Errorf("TENANT_CHAT_BINDING_HMAC_KEYS_FILE is required when private Gateway is enabled")
	}
	if private.CacheKeySetsFile == "" {
		return fmt.Errorf("TENANT_CHAT_CACHE_KEYSETS_FILE is required when private Gateway is enabled")
	}
	if private.UsageReceiptTokenFile == "" {
		return fmt.Errorf("TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE is required when private Gateway is enabled")
	}
	if private.WorkloadJTIPrefix == "" {
		return fmt.Errorf("TENANT_CHAT_WORKLOAD_JTI_REDIS_PREFIX is required when private Gateway is enabled")
	}
	return nil
}

func normalizeDeploymentMode(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	switch normalized {
	case "selfhost", "self_hosted", "selfhosted":
		return "self_host"
	default:
		return normalized
	}
}

func rawResponseCaptureAllowed(deploymentMode string) bool {
	if !envBool("RAW_RESPONSE_CAPTURE_ENABLED", false) {
		return false
	}
	if productionLikeEnv() {
		return false
	}
	switch normalizeDeploymentMode(deploymentMode) {
	case "self_host", "demo":
		return true
	default:
		return false
	}
}

func productionLikeEnv() bool {
	for _, key := range []string{"NODE_ENV", "APP_ENV", "ENV", "DEPLOYMENT_ENV", "GATELM_DEPLOYMENT_ENV"} {
		if productionLikeMode(os.Getenv(key)) {
			return true
		}
	}
	for _, key := range []string{
		"AWS_EXECUTION_ENV",
		"ECS_CONTAINER_METADATA_URI",
		"ECS_CONTAINER_METADATA_URI_V4",
		"AWS_LAMBDA_FUNCTION_NAME",
	} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return true
		}
	}
	return false
}

func productionLikeMode(value string) bool {
	switch normalizeDeploymentMode(value) {
	case "prod", "production", "saas", "aws", "cloud", "public", "stage", "staging":
		return true
	default:
		return false
	}
}

func observabilityAuthRequired(deploymentMode string) bool {
	if observabilityAuthRequiredEnv() || productionLikeEnv() {
		return true
	}

	for _, value := range []string{
		deploymentMode,
		os.Getenv("NODE_ENV"),
		os.Getenv("APP_ENV"),
		os.Getenv("ENV"),
		os.Getenv("DEPLOYMENT_ENV"),
		os.Getenv("GATELM_DEPLOYMENT_ENV"),
	} {
		if observabilityProductionLikeMode(value) {
			return true
		}
	}
	return false
}

func observabilityAuthRequiredEnv() bool {
	value := strings.TrimSpace(os.Getenv("GATEWAY_OBSERVABILITY_AUTH_REQUIRED"))
	if value == "" {
		return false
	}
	parsed, err := strconv.ParseBool(value)
	// An invalid security switch must never silently disable the boundary.
	return err != nil || parsed
}

func observabilityProductionLikeMode(value string) bool {
	if productionLikeMode(value) {
		return true
	}
	switch normalizeDeploymentMode(value) {
	case "self_host", "release", "aws_triage":
		return true
	default:
		return false
	}
}

func validateObservabilityAuthConfig(cfg Config) error {
	if !cfg.ObservabilityAuthRequired {
		return nil
	}
	if IsWeakObservabilityInternalToken(cfg.ObservabilityInternalToken) {
		return errors.New("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN must be a non-placeholder value of at least 32 characters when observability auth is required")
	}
	return nil
}

// IsWeakObservabilityInternalToken rejects values that are too short or look
// like deployment placeholders. It is exported so manually constructed router
// configs retain the same fail-closed behavior as LoadWithError.
func IsWeakObservabilityInternalToken(value string) bool {
	value = strings.TrimSpace(value)
	normalized := strings.ToLower(value)
	compact := strings.NewReplacer("-", "", "_", "", " ", "").Replace(normalized)
	if len(value) < 32 {
		return true
	}
	for _, marker := range []string{
		"changeme",
		"demo",
		"devonly",
		"example",
		"placeholder",
		"replaceme",
		"redacted",
	} {
		if strings.Contains(compact, marker) {
			return true
		}
	}
	return false
}

func normalizeRateLimitBackend(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	if normalized == "" {
		return RateLimitBackendRedis
	}
	return normalized
}

func normalizeRateLimitAlgorithm(value string, backend string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	if normalized == "" {
		if backend == RateLimitBackendPostgres {
			return RateLimitAlgorithmFixedWindow
		}
		return RateLimitAlgorithmTokenBucket
	}
	return normalized
}

func validateRateLimitConfig(cfg Config) error {
	switch cfg.RateLimitBackend {
	case RateLimitBackendPostgres, RateLimitBackendRedis:
	default:
		return fmt.Errorf("unsupported gateway rate limit backend %q", cfg.RateLimitBackend)
	}

	switch cfg.RateLimitAlgorithm {
	case RateLimitAlgorithmFixedWindow, RateLimitAlgorithmTokenBucket:
	default:
		return fmt.Errorf("unsupported gateway rate limit algorithm %q", cfg.RateLimitAlgorithm)
	}

	if cfg.RateLimitAlgorithm == RateLimitAlgorithmTokenBucket && cfg.RateLimitBackend != RateLimitBackendRedis {
		return fmt.Errorf("token bucket requires redis backend, got %q", cfg.RateLimitBackend)
	}

	return nil
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
		AllowCategories:         semanticEnvCSV("SEMANTIC_CACHE_ALLOW_CATEGORIES", []string{"general"}),
		DenyCategories:          semanticEnvCSV("SEMANTIC_CACHE_DENY_CATEGORIES", []string{"account_access", "support_refund", "code", "translation", "summarization", "extraction_json", "reasoning", "sensitive", "tool_call", "unknown"}),
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

func envCSV(key string, fallback []string) []string {
	return parseCSVEnvValue(os.Getenv(key), fallback)
}

func semanticEnvCSV(key string, fallback []string) []string {
	return parseCSVEnvValue(semanticEnvString(key, ""), fallback)
}

func parseCSVEnvValue(value string, fallback []string) []string {
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
