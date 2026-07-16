package config

import (
	"strings"
	"testing"
	"time"
)

func TestDifficultyE5RuntimeRequiresExplicitOptIn(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "")
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS", "")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "false")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DifficultyE5Runtime.Enabled {
		t.Fatal("difficulty E5 hot-path runtime must be disabled by default")
	}
	if cfg.DifficultyE5Runtime.Timeout != 100*time.Millisecond {
		t.Fatalf("default timeout = %s, want 100ms", cfg.DifficultyE5Runtime.Timeout)
	}
}

func TestDifficultyE5RuntimeLoadsDeploymentBundle(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT", "/opt/gatelm/difficulty-e5")
	t.Setenv("GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST", "/opt/gatelm/difficulty-e5/encoder-manifest.json")
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK", "/opt/gatelm/difficulty-e5/runtime-lock.json")
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS", "75")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DifficultyE5Runtime.Enabled ||
		cfg.DifficultyE5Runtime.ArtifactRoot != "/opt/gatelm/difficulty-e5" ||
		cfg.DifficultyE5Runtime.EncoderManifestPath != "/opt/gatelm/difficulty-e5/encoder-manifest.json" ||
		cfg.DifficultyE5Runtime.RuntimeLockPath != "/opt/gatelm/difficulty-e5/runtime-lock.json" ||
		cfg.DifficultyE5Runtime.Timeout != 75*time.Millisecond {
		t.Fatalf("unexpected difficulty E5 runtime config: %#v", cfg.DifficultyE5Runtime)
	}
}

func TestDifficultyE5RuntimeRejectsTimeoutOutsideBoundedRange(t *testing.T) {
	for _, value := range []string{"0", "1001", "not-a-number"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS", value)
			if _, err := LoadWithError(); err == nil {
				t.Fatalf("timeout %q should be rejected", value)
			}
		})
	}
}

func TestDifficultyE5RuntimeAndShadowAreMutuallyExclusive(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "true")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "cannot be enabled together") {
		t.Fatalf("LoadWithError() error = %v", err)
	}
}
