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

func resetAISafetySidecarEnv(t *testing.T) {
	t.Helper()
	for _, key := range aiSafetySidecarEnvKeys {
		t.Setenv(key, "")
	}
}

func TestAISafetySidecarConfigDefaults(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)

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
}

func TestAISafetySidecarConfigLoadsEnvOverrides(t *testing.T) {
	resetSemanticCacheEnv(t)
	resetAISafetySidecarEnv(t)
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
