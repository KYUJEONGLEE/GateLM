package config

import (
	"testing"
	"time"
)

func TestDifficultyLightGBMShadowIsDisabledByDefault(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ENABLED", "false")
	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DifficultyLightGBMShadow.Enabled {
		t.Fatal("LightGBM shadow must be disabled by default")
	}
	if cfg.DifficultyLightGBMShadow.SamplingBasisPoints != 1000 ||
		cfg.DifficultyLightGBMShadow.Timeout != 500*time.Millisecond ||
		cfg.DifficultyLightGBMShadow.MaximumConcurrent != 4 {
		t.Fatalf("unexpected LightGBM shadow defaults: %#v", cfg.DifficultyLightGBMShadow)
	}
}

func TestDifficultyLightGBMShadowLoadsExactScopeAndSampling(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_URL", "http://ai-service-lr:8001/internal/routing/difficulty/v1/classify")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_SERVICE_TOKEN", "unit-lr-token")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ALLOWED_SCOPES", "tenant-a/app-a")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_SAMPLING_BASIS_POINTS", "10000")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_URL", "http://ai-service-lightgbm:8002/internal/routing/difficulty/lightgbm-shadow/v1/classify")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_SERVICE_TOKEN", "unit-lightgbm-token")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MODEL_VERSION", "difficulty-lightgbm-shadow.unit.v1")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MODEL_CONTENT_HASH", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DifficultyLightGBMShadow.AllowsRequest("tenant-a", "app-a", "request-1") {
		t.Fatal("exact allowed scope with 100% sampling must be eligible")
	}
	if cfg.DifficultyLightGBMShadow.AllowsRequest("tenant-a", "app-b", "request-1") ||
		cfg.DifficultyLightGBMShadow.AllowsRequest("tenant-a", "app-a", "") {
		t.Fatal("scope mismatch or empty request ID must not be eligible")
	}
}

func TestDifficultyLightGBMShadowRequiresAuthoritativeLR(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_ALLOWED_SCOPES", "tenant-a/app-a")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_URL", "http://ai-service-lightgbm:8002/internal/routing/difficulty/lightgbm-shadow/v1/classify")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_SERVICE_TOKEN", "unit-lightgbm-token")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MODEL_VERSION", "difficulty-lightgbm-shadow.unit.v1")
	t.Setenv("GATEWAY_DIFFICULTY_LIGHTGBM_SHADOW_MODEL_CONTENT_HASH", "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

	if _, err := LoadWithError(); err == nil {
		t.Fatal("LightGBM shadow without authoritative LR must fail")
	}
}

func TestDifficultyLightGBMShadowSamplingIsDeterministic(t *testing.T) {
	cfg := DifficultyLightGBMShadowConfig{
		Enabled:             true,
		AllowedScopes:       []DifficultyE5ShadowScope{{TenantID: "tenant-a", ApplicationID: "app-a"}},
		SamplingBasisPoints: 5000,
	}
	first := cfg.AllowsRequest("tenant-a", "app-a", "request-stable")
	for range 20 {
		if cfg.AllowsRequest("tenant-a", "app-a", "request-stable") != first {
			t.Fatal("sampling decision changed for the same request identity")
		}
	}
}
