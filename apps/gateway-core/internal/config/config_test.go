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
