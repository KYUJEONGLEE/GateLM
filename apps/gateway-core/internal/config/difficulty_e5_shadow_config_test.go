package config

import "testing"

func TestDifficultyE5ShadowRequiresExplicitOptIn(t *testing.T) {
	for _, key := range []string{
		"GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED",
		"GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT",
		"GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST",
		"GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK",
	} {
		t.Setenv(key, "")
	}

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DifficultyE5Shadow.Enabled {
		t.Fatal("difficulty E5 shadow runtime must be disabled by default")
	}
}

func TestDifficultyE5ShadowLoadsDeploymentLocalBundlePaths(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT", "/opt/gatelm/difficulty-e5")
	t.Setenv("GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST", "/opt/gatelm/difficulty-e5/encoder-manifest.json")
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK", "/opt/gatelm/difficulty-e5/runtime-lock.json")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DifficultyE5Shadow.Enabled ||
		cfg.DifficultyE5Shadow.ArtifactRoot != "/opt/gatelm/difficulty-e5" ||
		cfg.DifficultyE5Shadow.EncoderManifestPath != "/opt/gatelm/difficulty-e5/encoder-manifest.json" ||
		cfg.DifficultyE5Shadow.RuntimeLockPath != "/opt/gatelm/difficulty-e5/runtime-lock.json" {
		t.Fatalf("unexpected difficulty E5 shadow config: %#v", cfg.DifficultyE5Shadow)
	}
}
