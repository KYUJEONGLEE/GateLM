package config

import (
	"testing"
	"time"
)

var aiSafetySidecarEnvKeys = []string{
	"GATEWAY_AI_SAFETY_SIDECAR_ENABLED",
	"GATEWAY_AI_SAFETY_SIDECAR_URL",
	"GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS",
	"GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID",
	"GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET",
	"GATEWAY_AI_SAFETY_SIDECAR_LOCALE",
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
	if cfg.AISafetySidecar.Timeout != 300*time.Millisecond {
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
