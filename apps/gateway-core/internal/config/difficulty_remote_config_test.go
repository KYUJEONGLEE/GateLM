package config

import (
	"strings"
	"testing"
	"time"
)

func TestDifficultyRemoteRequiresExplicitOptIn(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_ENABLED", "")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_TIMEOUT_MS", "")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_MAX_CONCURRENT", "")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DifficultyRemote.Enabled {
		t.Fatal("remote difficulty experiment must be disabled by default")
	}
	if cfg.DifficultyRemote.Timeout != 100*time.Millisecond || cfg.DifficultyRemote.MaximumConcurrent != 64 {
		t.Fatalf("unexpected defaults: %#v", cfg.DifficultyRemote)
	}
}

func TestDifficultyRemoteLoadsPrivateEndpointAndDedicatedToken(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "false")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_URL", "http://10.77.1.40:8001/internal/routing/difficulty/v1/classify")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_SERVICE_TOKEN", "unit-routing-token")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_TIMEOUT_MS", "125")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_MAX_CONCURRENT", "32")
	t.Setenv("DEPLOYMENT_MODE", "local")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DifficultyRemote.Enabled ||
		cfg.DifficultyRemote.EndpointURL != "http://10.77.1.40:8001/internal/routing/difficulty/v1/classify" ||
		cfg.DifficultyRemote.ServiceToken != "unit-routing-token" ||
		cfg.DifficultyRemote.Timeout != 125*time.Millisecond || cfg.DifficultyRemote.MaximumConcurrent != 32 {
		t.Fatalf("unexpected remote config: %#v", cfg.DifficultyRemote)
	}
}

func TestDifficultyRemoteAndLocalModesAreMutuallyExclusive(t *testing.T) {
	t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_REMOTE_ENABLED", "true")
	t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "false")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "cannot be enabled together") {
		t.Fatalf("LoadWithError() error = %v", err)
	}
}

func TestDifficultyRemoteProductionLikeModeRejectsWeakTokenAndPublicHTTP(t *testing.T) {
	for _, test := range []struct {
		name     string
		endpoint string
		token    string
		message  string
	}{
		{
			name:     "weak token",
			endpoint: "http://10.77.1.40:8001/internal/routing/difficulty/v1/classify",
			token:    "replace-me",
			message:  "non-placeholder",
		},
		{
			name:     "public http",
			endpoint: "http://example.com/internal/routing/difficulty/v1/classify",
			token:    "0123456789abcdef0123456789abcdef",
			message:  "private service address",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED", "false")
			t.Setenv("GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED", "false")
			t.Setenv("GATEWAY_DIFFICULTY_REMOTE_ENABLED", "true")
			t.Setenv("GATEWAY_DIFFICULTY_REMOTE_URL", test.endpoint)
			t.Setenv("GATEWAY_DIFFICULTY_REMOTE_SERVICE_TOKEN", test.token)
			t.Setenv("DEPLOYMENT_MODE", "aws")

			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("LoadWithError() error = %v", err)
			}
		})
	}
}
