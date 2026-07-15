package config

import (
	"testing"
	"time"
)

func TestDifficultyE5ShadowRequiresExplicitOptIn(t *testing.T) {
	for _, key := range []string{
		"GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED",
		"GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES",
		"GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT",
		"GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST",
		"GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK",
		"GATEWAY_DIFFICULTY_E5_SHADOW_TIMEOUT_MS",
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
	if cfg.DifficultyE5Shadow.Timeout != 100*time.Millisecond {
		t.Fatalf("default difficulty E5 shadow timeout = %s, want 100ms", cfg.DifficultyE5Shadow.Timeout)
	}
}

func TestDifficultyE5ShadowLoadsDeploymentLocalBundlePaths(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES", "tenant_dev/application_dev")
	t.Setenv("GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT", "/opt/gatelm/difficulty-e5")
	t.Setenv("GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST", "/opt/gatelm/difficulty-e5/encoder-manifest.json")
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK", "/opt/gatelm/difficulty-e5/runtime-lock.json")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_TIMEOUT_MS", "75")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DifficultyE5Shadow.Enabled ||
		cfg.DifficultyE5Shadow.ArtifactRoot != "/opt/gatelm/difficulty-e5" ||
		cfg.DifficultyE5Shadow.EncoderManifestPath != "/opt/gatelm/difficulty-e5/encoder-manifest.json" ||
		cfg.DifficultyE5Shadow.RuntimeLockPath != "/opt/gatelm/difficulty-e5/runtime-lock.json" ||
		cfg.DifficultyE5Shadow.Timeout != 75*time.Millisecond {
		t.Fatalf("unexpected difficulty E5 shadow config: %#v", cfg.DifficultyE5Shadow)
	}
	if !cfg.DifficultyE5Shadow.AllowsScope("tenant_dev", "application_dev") {
		t.Fatal("configured exact tenant/application pair must be eligible")
	}
}

func TestDifficultyE5ShadowScopesAreExactPairsAndFailClosed(t *testing.T) {
	tests := []struct {
		name           string
		enabled        string
		rawScopes      string
		allowed        [][2]string
		notAllowed     [][2]string
		wantScopeCount int
	}{
		{
			name:       "global flag remains required",
			enabled:    "false",
			rawScopes:  "tenant_a/app_a",
			notAllowed: [][2]string{{"tenant_a", "app_a"}},
		},
		{
			name:       "empty allowlist disables every scope",
			enabled:    "true",
			rawScopes:  "",
			notAllowed: [][2]string{{"tenant_a", "app_a"}},
		},
		{
			name:           "exact pairs are trimmed and deduplicated",
			enabled:        "true",
			rawScopes:      " tenant_a/app_a ,tenant_b/app_b,tenant_a/app_a ",
			allowed:        [][2]string{{"tenant_a", "app_a"}, {"tenant_b", "app_b"}},
			notAllowed:     [][2]string{{"tenant_a", "app_b"}, {"tenant_b", "app_a"}, {"TENANT_A", "app_a"}},
			wantScopeCount: 2,
		},
		{
			name:       "one malformed entry invalidates the whole allowlist",
			enabled:    "true",
			rawScopes:  "tenant_a/app_a,tenant_only",
			notAllowed: [][2]string{{"tenant_a", "app_a"}},
		},
		{
			name:       "wildcards are rejected",
			enabled:    "true",
			rawScopes:  "tenant_a/*",
			notAllowed: [][2]string{{"tenant_a", "app_a"}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", test.enabled)
			t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES", test.rawScopes)

			cfg, err := LoadWithError()
			if err != nil {
				t.Fatal(err)
			}
			if len(cfg.DifficultyE5Shadow.AllowedScopes) != test.wantScopeCount {
				t.Fatalf("allowed scope count = %d, want %d", len(cfg.DifficultyE5Shadow.AllowedScopes), test.wantScopeCount)
			}
			for _, scope := range test.allowed {
				if !cfg.DifficultyE5Shadow.AllowsScope(scope[0], scope[1]) {
					t.Fatalf("scope %q/%q must be allowed", scope[0], scope[1])
				}
			}
			for _, scope := range test.notAllowed {
				if cfg.DifficultyE5Shadow.AllowsScope(scope[0], scope[1]) {
					t.Fatalf("scope %q/%q must not be allowed", scope[0], scope[1])
				}
			}
		})
	}
}

func TestDifficultyE5ShadowRejectsTimeoutOutsideBoundedRange(t *testing.T) {
	for _, value := range []string{"0", "1001", "not-a-number"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_TIMEOUT_MS", value)
			if _, err := LoadWithError(); err == nil {
				t.Fatalf("timeout %q should be rejected", value)
			}
		})
	}
}
