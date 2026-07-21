package config

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

func TestGatewayConfigDoesNotExposeRetiredRoutingTargetFields(t *testing.T) {
	configType := reflect.TypeOf(Config{})
	for _, fieldName := range []string{
		"DefaultProvider",
		"DefaultModel",
		"LowCostModel",
		"HighQualityModel",
	} {
		if _, exists := configType.FieldByName(fieldName); exists {
			t.Errorf("retired routing target field %s must not be exposed by gateway config", fieldName)
		}
	}
}

func TestLoadUsesCanonicalV2RoutingPolicyHashByDefault(t *testing.T) {
	t.Setenv("GATEWAY_ROUTING_POLICY_HASH", "")
	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.RoutingPolicyHash != routing.DefaultPolicyHash {
		t.Fatalf("unexpected default routing policy hash: %q", cfg.RoutingPolicyHash)
	}
}

var aiSafetySidecarEnvKeys = []string{
	"GATEWAY_AI_SAFETY_SIDECAR_ENABLED",
	"GATEWAY_AI_SAFETY_SIDECAR_URL",
	"GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS",
	"GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID",
	"GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET",
	"GATEWAY_AI_SAFETY_SIDECAR_LOCALE",
	"GATEWAY_AI_SAFETY_SIDECAR_MODE",
	"GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY",
}

var runtimeSnapshotCacheEnvKeys = []string{
	"GATEWAY_RUNTIME_SNAPSHOT_CACHE_ENABLED",
	"GATEWAY_RUNTIME_SNAPSHOT_CACHE_TTL_MS",
	"GATEWAY_RUNTIME_SNAPSHOT_CACHE_STALE_TTL_MS",
}

var providerCatalogCacheEnvKeys = []string{
	"GATEWAY_PROVIDER_CATALOG_CACHE_ENABLED",
	"GATEWAY_PROVIDER_CATALOG_CACHE_TTL_MS",
	"GATEWAY_PROVIDER_CATALOG_CACHE_STALE_TTL_MS",
}

var asyncLogEnvKeys = []string{
	"GATEWAY_ASYNC_LOG_ENABLED",
	"GATEWAY_ASYNC_LOG_QUEUE_SIZE",
	"GATEWAY_ASYNC_LOG_WORKER_COUNT",
	"GATEWAY_ASYNC_LOG_BATCH_SIZE",
	"GATEWAY_ASYNC_LOG_BATCH_FLUSH_INTERVAL_MS",
	"GATEWAY_ASYNC_LOG_WRITE_TIMEOUT_MS",
	"GATEWAY_ASYNC_LOG_SHUTDOWN_TIMEOUT_MS",
}

var clickHouseAnalyticsEnvKeys = []string{
	"GATEWAY_CLICKHOUSE_ANALYTICS_ENABLED",
	"GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED",
	"GATEWAY_CLICKHOUSE_URL",
	"GATEWAY_CLICKHOUSE_DATABASE",
	"GATEWAY_CLICKHOUSE_TABLE",
	"GATEWAY_CLICKHOUSE_USERNAME",
	"GATEWAY_CLICKHOUSE_PASSWORD",
	"GATEWAY_CLICKHOUSE_WRITE_TIMEOUT_MS",
	"GATEWAY_CLICKHOUSE_ANALYTICS_READ_USERNAME",
	"GATEWAY_CLICKHOUSE_ANALYTICS_READ_PASSWORD",
	"GATEWAY_CLICKHOUSE_ANALYTICS_READ_TIMEOUT_MS",
	"GATEWAY_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET",
}

var databasePerformanceEnvKeys = []string{
	"DATABASE_URL",
	"GATEWAY_LOG_DATABASE_URL",
	"GATEWAY_DATABASE_MAX_CONNS",
	"GATEWAY_DATABASE_MIN_CONNS",
	"GATEWAY_DATABASE_MAX_CONN_LIFETIME_MS",
	"GATEWAY_DATABASE_MAX_CONN_IDLE_TIME_MS",
	"GATEWAY_DATABASE_HEALTH_CHECK_PERIOD_MS",
	"GATEWAY_LOG_DATABASE_MAX_CONNS",
	"GATEWAY_LOG_DATABASE_MIN_CONNS",
	"GATEWAY_LOG_DATABASE_MAX_CONN_LIFETIME_MS",
	"GATEWAY_LOG_DATABASE_MAX_CONN_IDLE_TIME_MS",
	"GATEWAY_LOG_DATABASE_HEALTH_CHECK_PERIOD_MS",
	"GATEWAY_AUTH_CACHE_ENABLED",
	"GATEWAY_AUTH_CACHE_TTL_MS",
	"GATEWAY_AUTH_CACHE_MAX_ENTRIES",
	"GATEWAY_AUTH_CACHE_KEY_SECRET",
	"GATEWAY_PRICING_CACHE_ENABLED",
	"GATEWAY_PRICING_CACHE_TTL_MS",
	"GATEWAY_PRICING_CACHE_MAX_ENTRIES",
	"GATEWAY_ANALYTICS_POLICY_IMPACT_READ_MODE",
	"GATEWAY_ANALYTICS_POLICY_IMPACT_MAX_RAW_TAIL_MS",
	"GATEWAY_EXACT_CACHE_KEY_SECRET",
}

var providerTransportEnvKeys = []string{
	"GATEWAY_PROVIDER_TIMEOUT_MS",
	"GATEWAY_PROVIDER_MAX_IDLE_CONNS",
	"GATEWAY_PROVIDER_MAX_IDLE_CONNS_PER_HOST",
	"GATEWAY_PROVIDER_MAX_CONNS_PER_HOST",
	"GATEWAY_PROVIDER_IDLE_CONN_TIMEOUT_MS",
	"GATEWAY_PROVIDER_DIAL_TIMEOUT_MS",
	"GATEWAY_PROVIDER_DIAL_KEEP_ALIVE_MS",
	"GATEWAY_PROVIDER_TLS_HANDSHAKE_TIMEOUT_MS",
	"GATEWAY_PROVIDER_RESPONSE_HEADER_TIMEOUT_MS",
	"GATEWAY_PROVIDER_EXPECT_CONTINUE_TIMEOUT_MS",
}

var rawResponseCaptureEnvKeys = []string{
	"DEPLOYMENT_MODE",
	"RAW_RESPONSE_CAPTURE_ENABLED",
	"GATEWAY_RESPONSE_CAPTURE_ENABLED",
	"NODE_ENV",
	"APP_ENV",
	"ENV",
	"AWS_EXECUTION_ENV",
	"AWS_REGION",
	"AWS_DEFAULT_REGION",
	"ECS_CONTAINER_METADATA_URI",
	"ECS_CONTAINER_METADATA_URI_V4",
	"AWS_LAMBDA_FUNCTION_NAME",
}

func resetAISafetySidecarEnv(t *testing.T) {
	t.Helper()
	for _, key := range aiSafetySidecarEnvKeys {
		t.Setenv(key, "")
	}
}

func resetRuntimeSnapshotCacheEnv(t *testing.T) {
	t.Helper()
	for _, key := range runtimeSnapshotCacheEnvKeys {
		t.Setenv(key, "")
	}
}

func resetProviderCatalogCacheEnv(t *testing.T) {
	t.Helper()
	for _, key := range providerCatalogCacheEnvKeys {
		t.Setenv(key, "")
	}
}

func resetAsyncLogEnv(t *testing.T) {
	t.Helper()
	for _, key := range asyncLogEnvKeys {
		t.Setenv(key, "")
	}
}

func resetClickHouseAnalyticsEnv(t *testing.T) {
	t.Helper()
	for _, key := range clickHouseAnalyticsEnvKeys {
		t.Setenv(key, "")
	}
}

func resetDatabasePerformanceEnv(t *testing.T) {
	t.Helper()
	for _, key := range databasePerformanceEnvKeys {
		t.Setenv(key, "")
	}
}

func resetProviderTransportEnv(t *testing.T) {
	t.Helper()
	for _, key := range providerTransportEnvKeys {
		t.Setenv(key, "")
	}
}

func resetRawResponseCaptureEnv(t *testing.T) {
	t.Helper()
	for _, key := range rawResponseCaptureEnvKeys {
		t.Setenv(key, "")
	}
}

func TestAISafetySidecarConfigDefaults(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if !cfg.AISafetySidecar.Enabled {
		t.Fatal("AI safety sidecar should be enabled by default")
	}
	if cfg.AISafetySidecar.EndpointURL != "http://127.0.0.1:8001/internal/ai-safety/v1/detect" {
		t.Fatalf("unexpected sidecar URL: %q", cfg.AISafetySidecar.EndpointURL)
	}
	if cfg.AISafetySidecar.Timeout != 750*time.Millisecond {
		t.Fatalf("unexpected sidecar timeout: %s", cfg.AISafetySidecar.Timeout)
	}
	if cfg.AISafetySidecar.ModelID != "openai/privacy-filter" {
		t.Fatalf("unexpected sidecar model: %q", cfg.AISafetySidecar.ModelID)
	}
	if cfg.AISafetySidecar.DetectorSet != "privacy-filter-default" {
		t.Fatalf("unexpected sidecar detector set: %q", cfg.AISafetySidecar.DetectorSet)
	}
	if cfg.AISafetySidecar.Locale != "" {
		t.Fatalf("unexpected sidecar locale: %q", cfg.AISafetySidecar.Locale)
	}
	if cfg.AISafetySidecar.Mode != "enforce" {
		t.Fatalf("unexpected sidecar mode: %q", cfg.AISafetySidecar.Mode)
	}
	if cfg.AISafetySidecar.PersonNameModelOnly {
		t.Fatal("person-name model-only evaluation should be disabled by default")
	}
	if !cfg.RuntimeSnapshotCache.Enabled {
		t.Fatal("runtime snapshot cache should be enabled by default")
	}
	if cfg.RuntimeSnapshotCache.TTL != 5*time.Second {
		t.Fatalf("unexpected runtime snapshot cache TTL: %s", cfg.RuntimeSnapshotCache.TTL)
	}
	if cfg.RuntimeSnapshotCache.StaleTTL != 60*time.Second {
		t.Fatalf("unexpected runtime snapshot stale TTL: %s", cfg.RuntimeSnapshotCache.StaleTTL)
	}
	if !cfg.ProviderCatalogCache.Enabled {
		t.Fatal("provider catalog cache should be enabled by default")
	}
	if cfg.ProviderCatalogCache.TTL != 5*time.Second {
		t.Fatalf("unexpected provider catalog cache TTL: %s", cfg.ProviderCatalogCache.TTL)
	}
	if cfg.ProviderCatalogCache.StaleTTL != 60*time.Second {
		t.Fatalf("unexpected provider catalog stale TTL: %s", cfg.ProviderCatalogCache.StaleTTL)
	}
}

func TestAISafetySidecarConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_ENABLED", "false")
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_URL", "http://localhost:8001/internal/ai-safety/v1/detect")
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS", "750")
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID", "openai/privacy-filter")
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET", "privacy-filter-default")
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_LOCALE", "ko-KR")
	t.Setenv("GATEWAY_AI_SAFETY_SIDECAR_MODE", "shadow")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AISafetySidecar.Enabled {
		t.Fatal("AI safety sidecar should be disabled by env override")
	}
	if cfg.AISafetySidecar.EndpointURL != "http://localhost:8001/internal/ai-safety/v1/detect" {
		t.Fatalf("unexpected sidecar URL: %q", cfg.AISafetySidecar.EndpointURL)
	}
	if cfg.AISafetySidecar.Timeout != 750*time.Millisecond {
		t.Fatalf("unexpected sidecar timeout: %s", cfg.AISafetySidecar.Timeout)
	}
	if cfg.AISafetySidecar.ModelID != "openai/privacy-filter" {
		t.Fatalf("unexpected sidecar model: %q", cfg.AISafetySidecar.ModelID)
	}
	if cfg.AISafetySidecar.DetectorSet != "privacy-filter-default" {
		t.Fatalf("unexpected sidecar detector set: %q", cfg.AISafetySidecar.DetectorSet)
	}
	if cfg.AISafetySidecar.Locale != "ko-KR" {
		t.Fatalf("unexpected sidecar locale: %q", cfg.AISafetySidecar.Locale)
	}
	if cfg.AISafetySidecar.Mode != "shadow" {
		t.Fatalf("unexpected sidecar mode: %q", cfg.AISafetySidecar.Mode)
	}
}

func TestAISafetyPersonNameModelOnlyLoadsSafeEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	t.Setenv("GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY", "true")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.AISafetySidecar.PersonNameModelOnly {
		t.Fatal("person-name model-only evaluation should be enabled")
	}
}

func TestAISafetyPersonNameModelOnlyRejectsUnsafeSidecarConfig(t *testing.T) {
	for _, tc := range []struct {
		name        string
		key         string
		value       string
		wantErrPart string
	}{
		{name: "disabled sidecar", key: "GATEWAY_AI_SAFETY_SIDECAR_ENABLED", value: "false", wantErrPart: "SIDECAR_ENABLED=true"},
		{name: "shadow mode", key: "GATEWAY_AI_SAFETY_SIDECAR_MODE", value: "shadow", wantErrPart: "SIDECAR_MODE=enforce"},
		{name: "blank endpoint", key: "GATEWAY_AI_SAFETY_SIDECAR_URL", value: " ", wantErrPart: "SIDECAR_URL"},
		{name: "blank model", key: "GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID", value: " ", wantErrPart: "SIDECAR_MODEL_ID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetSemanticCacheEnv(t)
			resetAISafetySidecarEnv(t)
			resetRuntimeSnapshotCacheEnv(t)
			resetProviderCatalogCacheEnv(t)
			t.Setenv("GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY", "true")
			t.Setenv(tc.key, tc.value)

			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), tc.wantErrPart) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErrPart, err)
			}
		})
	}
}

func TestRuntimeSnapshotCacheConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	t.Setenv("GATEWAY_RUNTIME_SNAPSHOT_CACHE_ENABLED", "false")
	t.Setenv("GATEWAY_RUNTIME_SNAPSHOT_CACHE_TTL_MS", "1500")
	t.Setenv("GATEWAY_RUNTIME_SNAPSHOT_CACHE_STALE_TTL_MS", "45000")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.RuntimeSnapshotCache.Enabled {
		t.Fatal("runtime snapshot cache should be disabled by env override")
	}
	if cfg.RuntimeSnapshotCache.TTL != 1500*time.Millisecond {
		t.Fatalf("unexpected runtime snapshot cache TTL: %s", cfg.RuntimeSnapshotCache.TTL)
	}
	if cfg.RuntimeSnapshotCache.StaleTTL != 45*time.Second {
		t.Fatalf("unexpected runtime snapshot stale TTL: %s", cfg.RuntimeSnapshotCache.StaleTTL)
	}
}

func TestProviderCatalogCacheConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	t.Setenv("GATEWAY_PROVIDER_CATALOG_CACHE_ENABLED", "false")
	t.Setenv("GATEWAY_PROVIDER_CATALOG_CACHE_TTL_MS", "2500")
	t.Setenv("GATEWAY_PROVIDER_CATALOG_CACHE_STALE_TTL_MS", "30000")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.ProviderCatalogCache.Enabled {
		t.Fatal("provider catalog cache should be disabled by env override")
	}
	if cfg.ProviderCatalogCache.TTL != 2500*time.Millisecond {
		t.Fatalf("unexpected provider catalog cache TTL: %s", cfg.ProviderCatalogCache.TTL)
	}
	if cfg.ProviderCatalogCache.StaleTTL != 30*time.Second {
		t.Fatalf("unexpected provider catalog stale TTL: %s", cfg.ProviderCatalogCache.StaleTTL)
	}
}

func TestAsyncLogBatchConfigDefaults(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	resetAsyncLogEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AsyncLogQueueSize != 1024 || cfg.AsyncLogWorkerCount != 2 {
		t.Fatalf("unexpected async log queue defaults: size=%d workers=%d", cfg.AsyncLogQueueSize, cfg.AsyncLogWorkerCount)
	}
	if cfg.AsyncLogBatchSize != 100 {
		t.Fatalf("unexpected async log batch size: %d", cfg.AsyncLogBatchSize)
	}
	if cfg.AsyncLogBatchFlushInterval != 10*time.Millisecond {
		t.Fatalf("unexpected async log batch flush interval: %s", cfg.AsyncLogBatchFlushInterval)
	}
}

func TestAsyncLogBatchConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	resetAsyncLogEnv(t)
	t.Setenv("GATEWAY_ASYNC_LOG_QUEUE_SIZE", "10000")
	t.Setenv("GATEWAY_ASYNC_LOG_WORKER_COUNT", "4")
	t.Setenv("GATEWAY_ASYNC_LOG_BATCH_SIZE", "250")
	t.Setenv("GATEWAY_ASYNC_LOG_BATCH_FLUSH_INTERVAL_MS", "25")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AsyncLogQueueSize != 10000 || cfg.AsyncLogWorkerCount != 4 {
		t.Fatalf("unexpected async log queue config: size=%d workers=%d", cfg.AsyncLogQueueSize, cfg.AsyncLogWorkerCount)
	}
	if cfg.AsyncLogBatchSize != 250 || cfg.AsyncLogBatchFlushInterval != 25*time.Millisecond {
		t.Fatalf("unexpected async log batch config: size=%d flush=%s", cfg.AsyncLogBatchSize, cfg.AsyncLogBatchFlushInterval)
	}
}

func TestClickHouseAnalyticsConfigDefaultsDisabled(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAsyncLogEnv(t)
	resetClickHouseAnalyticsEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ClickHouseAnalytics.Enabled {
		t.Fatal("ClickHouse analytics mirror must require explicit opt-in")
	}
	if cfg.ClickHouseAnalytics.PerformanceReadEnabled {
		t.Fatal("ClickHouse performance reader must require explicit opt-in")
	}
	if cfg.ClickHouseAnalytics.WriteTimeout != 300*time.Millisecond {
		t.Fatalf("unexpected ClickHouse write timeout: %s", cfg.ClickHouseAnalytics.WriteTimeout)
	}
	if cfg.ClickHouseAnalytics.ReadTimeout != 1500*time.Millisecond {
		t.Fatalf("unexpected ClickHouse read timeout: %s", cfg.ClickHouseAnalytics.ReadTimeout)
	}
}

func TestClickHouseAnalyticsConfigLoadsPerformanceReaderIndependently(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAsyncLogEnv(t)
	resetClickHouseAnalyticsEnv(t)
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED", "true")
	t.Setenv("GATEWAY_CLICKHOUSE_URL", "http://10.78.2.60:8123")
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_READ_USERNAME", "analytics_reader")
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_READ_PASSWORD", "reader-password-123")
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_READ_TIMEOUT_MS", "2400")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ClickHouseAnalytics.Enabled || !cfg.ClickHouseAnalytics.PerformanceReadEnabled {
		t.Fatalf("reader must not implicitly enable the writer: %+v", cfg.ClickHouseAnalytics)
	}
	if cfg.ClickHouseAnalytics.ReadUsername != "analytics_reader" || cfg.ClickHouseAnalytics.ReadTimeout != 2400*time.Millisecond {
		t.Fatalf("unexpected reader config: %+v", cfg.ClickHouseAnalytics)
	}
}

func TestClickHouseAnalyticsConfigRejectsPerformanceReaderWithoutBoundedCredential(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAsyncLogEnv(t)
	resetClickHouseAnalyticsEnv(t)
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED", "true")
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_READ_PASSWORD", "short")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "must be at least 16 characters") {
		t.Fatalf("expected bounded reader credential rejection, got %v", err)
	}
}

func TestClickHouseAnalyticsConfigLoadsSafeEnabledConfig(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAsyncLogEnv(t)
	resetClickHouseAnalyticsEnv(t)
	t.Setenv("GATEWAY_ASYNC_LOG_ENABLED", "true")
	t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_ENABLED", "true")
	t.Setenv("GATEWAY_CLICKHOUSE_URL", "http://10.78.2.50:8123")
	t.Setenv("GATEWAY_CLICKHOUSE_DATABASE", "gatelm_analytics")
	t.Setenv("GATEWAY_CLICKHOUSE_TABLE", "llm_invocations")
	t.Setenv("GATEWAY_CLICKHOUSE_USERNAME", "analytics_writer")
	t.Setenv("GATEWAY_CLICKHOUSE_PASSWORD", "safe-test-password")
	t.Setenv("GATEWAY_CLICKHOUSE_WRITE_TIMEOUT_MS", "450")
	t.Setenv("GATEWAY_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET", "0123456789abcdef0123456789abcdef")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.ClickHouseAnalytics.Enabled || cfg.ClickHouseAnalytics.EndpointURL != "http://10.78.2.50:8123" {
		t.Fatalf("unexpected ClickHouse config: %+v", cfg.ClickHouseAnalytics)
	}
	if cfg.ClickHouseAnalytics.WriteTimeout != 450*time.Millisecond {
		t.Fatalf("unexpected ClickHouse write timeout: %s", cfg.ClickHouseAnalytics.WriteTimeout)
	}
}

func TestClickHouseAnalyticsConfigRejectsUnsafeEnabledConfig(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		key   string
		value string
		want  string
	}{
		{name: "async disabled", key: "GATEWAY_ASYNC_LOG_ENABLED", value: "false", want: "requires GATEWAY_ASYNC_LOG_ENABLED=true"},
		{name: "credentials in URL", key: "GATEWAY_CLICKHOUSE_URL", value: "http://user:secret@localhost:8123", want: "must not contain credentials"},
		{name: "short identity secret", key: "GATEWAY_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET", value: "short", want: "at least 32 characters"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			resetSemanticCacheEnv(t)
			resetAsyncLogEnv(t)
			resetClickHouseAnalyticsEnv(t)
			t.Setenv("GATEWAY_ASYNC_LOG_ENABLED", "true")
			t.Setenv("GATEWAY_CLICKHOUSE_ANALYTICS_ENABLED", "true")
			t.Setenv("GATEWAY_CLICKHOUSE_URL", "http://localhost:8123")
			t.Setenv("GATEWAY_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET", "0123456789abcdef0123456789abcdef")
			t.Setenv(testCase.key, testCase.value)
			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("expected error containing %q, got %v", testCase.want, err)
			}
		})
	}
}

func TestDatabasePerformanceConfigDefaults(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetDatabasePerformanceEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.DatabasePool.MaxConns != 16 || cfg.DatabasePool.MinConns != 2 {
		t.Fatalf("unexpected primary pool defaults: %+v", cfg.DatabasePool)
	}
	if cfg.LogDatabaseURL != cfg.DatabaseURL {
		t.Fatal("log database should default to the primary database URL")
	}
	if cfg.LogDatabasePool.MaxConns != 4 || cfg.LogDatabasePool.MinConns != 2 {
		t.Fatalf("unexpected log pool defaults: %+v", cfg.LogDatabasePool)
	}
	if cfg.AuthCache.Enabled || cfg.PricingCache.Enabled {
		t.Fatal("DB read caches must require an explicit opt-in")
	}
	if cfg.AuthCache.TTL != time.Second || cfg.PricingCache.TTL != 5*time.Second {
		t.Fatalf("unexpected cache TTL defaults: auth=%s pricing=%s", cfg.AuthCache.TTL, cfg.PricingCache.TTL)
	}
	if cfg.AnalyticsPolicyImpactReadMode != "raw" ||
		cfg.AnalyticsPolicyImpactMaxRawTail != 2*time.Minute {
		t.Fatalf("unexpected policy impact read defaults: mode=%s tail=%s", cfg.AnalyticsPolicyImpactReadMode, cfg.AnalyticsPolicyImpactMaxRawTail)
	}
}

func TestDatabasePerformanceConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetDatabasePerformanceEnv(t)
	t.Setenv("DATABASE_URL", "postgresql://primary.example/gatelm?schema=public")
	t.Setenv("GATEWAY_LOG_DATABASE_URL", "postgresql://logs.example/gatelm?schema=public")
	t.Setenv("GATEWAY_DATABASE_MAX_CONNS", "24")
	t.Setenv("GATEWAY_DATABASE_MIN_CONNS", "4")
	t.Setenv("GATEWAY_LOG_DATABASE_MAX_CONNS", "8")
	t.Setenv("GATEWAY_LOG_DATABASE_MIN_CONNS", "3")
	t.Setenv("GATEWAY_AUTH_CACHE_ENABLED", "true")
	t.Setenv("GATEWAY_AUTH_CACHE_TTL_MS", "1500")
	t.Setenv("GATEWAY_AUTH_CACHE_MAX_ENTRIES", "2048")
	t.Setenv("GATEWAY_AUTH_CACHE_KEY_SECRET", "auth-cache-test-key-material")
	t.Setenv("GATEWAY_PRICING_CACHE_ENABLED", "true")
	t.Setenv("GATEWAY_PRICING_CACHE_TTL_MS", "7500")
	t.Setenv("GATEWAY_PRICING_CACHE_MAX_ENTRIES", "512")
	t.Setenv("GATEWAY_ANALYTICS_POLICY_IMPACT_READ_MODE", "rollup")
	t.Setenv("GATEWAY_ANALYTICS_POLICY_IMPACT_MAX_RAW_TAIL_MS", "180000")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.DatabasePool.MaxConns != 24 || cfg.DatabasePool.MinConns != 4 {
		t.Fatalf("unexpected primary pool config: %+v", cfg.DatabasePool)
	}
	if cfg.LogDatabasePool.MaxConns != 8 || cfg.LogDatabasePool.MinConns != 3 {
		t.Fatalf("unexpected log pool config: %+v", cfg.LogDatabasePool)
	}
	if !cfg.AuthCache.Enabled || cfg.AuthCache.TTL != 1500*time.Millisecond || cfg.AuthCache.MaxEntries != 2048 {
		t.Fatalf("unexpected auth cache config: enabled=%t ttl=%s maxEntries=%d", cfg.AuthCache.Enabled, cfg.AuthCache.TTL, cfg.AuthCache.MaxEntries)
	}
	if !cfg.PricingCache.Enabled || cfg.PricingCache.TTL != 7500*time.Millisecond || cfg.PricingCache.MaxEntries != 512 {
		t.Fatalf("unexpected pricing cache config: %+v", cfg.PricingCache)
	}
	if cfg.AnalyticsPolicyImpactReadMode != "rollup" ||
		cfg.AnalyticsPolicyImpactMaxRawTail != 3*time.Minute {
		t.Fatalf("unexpected policy impact read config: mode=%s tail=%s", cfg.AnalyticsPolicyImpactReadMode, cfg.AnalyticsPolicyImpactMaxRawTail)
	}
}

func TestDatabasePerformanceConfigRejectsUnknownPolicyImpactReadMode(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetDatabasePerformanceEnv(t)
	t.Setenv("GATEWAY_ANALYTICS_POLICY_IMPACT_READ_MODE", "full-raw-fallback")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "must be raw or rollup") {
		t.Fatalf("expected invalid policy impact read mode error, got %v", err)
	}
}

func TestDatabasePerformanceConfigRejectsPoolMinAboveMax(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetDatabasePerformanceEnv(t)
	t.Setenv("GATEWAY_DATABASE_MAX_CONNS", "2")
	t.Setenv("GATEWAY_DATABASE_MIN_CONNS", "3")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "database min connections") {
		t.Fatalf("expected invalid primary pool error, got %v", err)
	}
}

func TestProviderTransportConfigDefaults(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetProviderTransportEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	transport := cfg.ProviderTransport
	if transport.MaxIdleConns != 512 || transport.MaxIdleConnsPerHost != 256 || transport.MaxConnsPerHost != 256 {
		t.Fatalf("unexpected provider connection defaults: totalIdle=%d hostIdle=%d hostMax=%d", transport.MaxIdleConns, transport.MaxIdleConnsPerHost, transport.MaxConnsPerHost)
	}
	if transport.ResponseHeaderTimeout != 0 {
		t.Fatalf("response header timeout must default to disabled so provider-specific deadlines apply: %s", transport.ResponseHeaderTimeout)
	}
}

func TestProviderTransportConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetProviderTransportEnv(t)
	t.Setenv("GATEWAY_PROVIDER_TIMEOUT_MS", "60000")
	t.Setenv("GATEWAY_PROVIDER_MAX_IDLE_CONNS", "1024")
	t.Setenv("GATEWAY_PROVIDER_MAX_IDLE_CONNS_PER_HOST", "512")
	t.Setenv("GATEWAY_PROVIDER_MAX_CONNS_PER_HOST", "768")
	t.Setenv("GATEWAY_PROVIDER_IDLE_CONN_TIMEOUT_MS", "120000")
	t.Setenv("GATEWAY_PROVIDER_RESPONSE_HEADER_TIMEOUT_MS", "45000")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	transport := cfg.ProviderTransport
	if cfg.ProviderTimeout != 60*time.Second || transport.ResponseHeaderTimeout != 45*time.Second {
		t.Fatalf("unexpected provider timeouts: request=%s header=%s", cfg.ProviderTimeout, transport.ResponseHeaderTimeout)
	}
	if transport.MaxIdleConns != 1024 || transport.MaxIdleConnsPerHost != 512 || transport.MaxConnsPerHost != 768 {
		t.Fatalf("unexpected provider limits: totalIdle=%d hostIdle=%d hostMax=%d", transport.MaxIdleConns, transport.MaxIdleConnsPerHost, transport.MaxConnsPerHost)
	}
}

func TestProviderTransportConfigRejectsIdlePerHostAboveTotal(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetProviderTransportEnv(t)
	t.Setenv("GATEWAY_PROVIDER_MAX_IDLE_CONNS", "10")
	t.Setenv("GATEWAY_PROVIDER_MAX_IDLE_CONNS_PER_HOST", "11")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "per host cannot exceed total") {
		t.Fatalf("expected invalid provider idle connection error, got %v", err)
	}
}

func TestControlPlaneInternalTokenLoadsEnvOverride(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	t.Setenv("GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN", " internal-token-for-test ")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.ControlPlaneInternalToken != "internal-token-for-test" {
		t.Fatalf("unexpected control plane internal token: %q", cfg.ControlPlaneInternalToken)
	}
}

func TestOpenAIExtraModelConfigDefaultsAndLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
	resetRuntimeSnapshotCacheEnv(t)
	resetProviderCatalogCacheEnv(t)
	t.Setenv("GATEWAY_OPENAI_EXTRA_MODELS", "")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if got, want := cfg.OpenAIExtraModelNames, defaultOpenAIExtraModelNames; !sameStrings(got, want) {
		t.Fatalf("unexpected default extra models: got %#v want %#v", got, want)
	}

	t.Setenv("GATEWAY_OPENAI_EXTRA_MODELS", " gpt-5.4-mini, gpt-5.4 , , gpt-5.5 ")
	cfg, err = LoadWithError()
	if err != nil {
		t.Fatalf("load config with env override: %v", err)
	}
	if got, want := cfg.OpenAIExtraModelNames, []string{"gpt-5.4-mini", "gpt-5.4", "gpt-5.5"}; !sameStrings(got, want) {
		t.Fatalf("unexpected env extra models: got %#v want %#v", got, want)
	}
}

func TestRawResponseCaptureDefaultsOff(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRawResponseCaptureEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.RawResponseCaptureEnabled {
		t.Fatal("raw response capture should be disabled without explicit env")
	}
}

func TestRawResponseCaptureRequiresExplicitSelfHostOrDemoOptIn(t *testing.T) {
	for _, tc := range []struct {
		name           string
		deploymentMode string
		rawOptIn       string
		legacyOptIn    string
		wantEnabled    bool
	}{
		{name: "self host with canonical opt in", deploymentMode: "self_host", rawOptIn: "true", wantEnabled: true},
		{name: "demo with canonical opt in", deploymentMode: "demo", rawOptIn: "true", wantEnabled: true},
		{name: "selfhost alias with canonical opt in", deploymentMode: "self-hosted", rawOptIn: "true", wantEnabled: true},
		{name: "self host without canonical opt in", deploymentMode: "self_host", legacyOptIn: "true", wantEnabled: false},
		{name: "saas blocks opt in", deploymentMode: "saas", rawOptIn: "true", wantEnabled: false},
		{name: "unknown mode blocks opt in", deploymentMode: "", rawOptIn: "true", wantEnabled: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetSemanticCacheEnv(t)
			resetRawResponseCaptureEnv(t)
			t.Setenv("DEPLOYMENT_MODE", tc.deploymentMode)
			t.Setenv("RAW_RESPONSE_CAPTURE_ENABLED", tc.rawOptIn)
			t.Setenv("GATEWAY_RESPONSE_CAPTURE_ENABLED", tc.legacyOptIn)
			t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", strongObservabilityTokenForTest)

			cfg, err := LoadWithError()
			if err != nil {
				t.Fatalf("load config: %v", err)
			}
			if cfg.RawResponseCaptureEnabled != tc.wantEnabled {
				t.Fatalf("unexpected raw response capture gate: got %v want %v", cfg.RawResponseCaptureEnabled, tc.wantEnabled)
			}
		})
	}
}

func TestRawResponseCaptureBlocksProductionLikeEnv(t *testing.T) {
	for _, tc := range []struct {
		name string
		key  string
		val  string
	}{
		{name: "node production", key: "NODE_ENV", val: "production"},
		{name: "app staging", key: "APP_ENV", val: "staging"},
		{name: "deployment env production", key: "DEPLOYMENT_ENV", val: "production"},
		{name: "gatelm deployment env aws", key: "GATELM_DEPLOYMENT_ENV", val: "aws"},
		{name: "aws execution env", key: "AWS_EXECUTION_ENV", val: "AWS_ECS_FARGATE"},
		{name: "ecs metadata", key: "ECS_CONTAINER_METADATA_URI_V4", val: "http://169.254.170.2/v4/metadata"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetSemanticCacheEnv(t)
			resetRawResponseCaptureEnv(t)
			t.Setenv("DEPLOYMENT_MODE", "demo")
			t.Setenv("RAW_RESPONSE_CAPTURE_ENABLED", "true")
			t.Setenv(tc.key, tc.val)
			t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", strongObservabilityTokenForTest)

			cfg, err := LoadWithError()
			if err != nil {
				t.Fatalf("load config: %v", err)
			}
			if cfg.RawResponseCaptureEnabled {
				t.Fatalf("raw response capture should be blocked by %s=%q", tc.key, tc.val)
			}
		})
	}
}

func TestRawResponseCaptureIgnoresLocalAWSRegionEnv(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetRawResponseCaptureEnv(t)
	t.Setenv("DEPLOYMENT_MODE", "demo")
	t.Setenv("RAW_RESPONSE_CAPTURE_ENABLED", "true")
	t.Setenv("AWS_REGION", "ap-northeast-2")
	t.Setenv("AWS_DEFAULT_REGION", "ap-northeast-2")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.RawResponseCaptureEnabled {
		t.Fatal("local AWS region env alone should not block demo raw response capture opt-in")
	}
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
