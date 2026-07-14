package config

import (
	"strings"
	"testing"
)

const strongObservabilityTokenForTest = "obs-prod-4f97209ca67b8d351bf27f22d01d55d9"

func TestObservabilityAuthDefaultsOptionalWithoutToken(t *testing.T) {
	resetObservabilityAuthEnv(t)
	resetSemanticCacheEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ObservabilityAuthRequired || cfg.ObservabilityInternalToken != "" {
		t.Fatalf("unexpected default observability auth config: required=%v token=%q", cfg.ObservabilityAuthRequired, cfg.ObservabilityInternalToken)
	}
}

func TestObservabilityAuthLoadsDedicatedTrimmedToken(t *testing.T) {
	resetObservabilityAuthEnv(t)
	resetSemanticCacheEnv(t)
	t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", "  local-observability-token  ")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.ObservabilityInternalToken != "local-observability-token" || cfg.ObservabilityAuthRequired {
		t.Fatalf("unexpected observability auth config: required=%v token=%q", cfg.ObservabilityAuthRequired, cfg.ObservabilityInternalToken)
	}
}

func TestObservabilityAuthRequiredRejectsMissingAndWeakTokens(t *testing.T) {
	for _, token := range []string{
		"",
		"short-token",
		"replace-me-observability-token-1234567890",
		"local-observability-token-for-dev-only-1234",
		"observability-token-redacted-1234567890",
	} {
		t.Run(token, func(t *testing.T) {
			resetObservabilityAuthEnv(t)
			resetSemanticCacheEnv(t)
			t.Setenv("GATEWAY_OBSERVABILITY_AUTH_REQUIRED", "true")
			t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", token)

			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN") {
				t.Fatalf("expected weak observability token error, got %v", err)
			}
		})
	}
}

func TestObservabilityAuthRequiredAcceptsStrongDedicatedToken(t *testing.T) {
	resetObservabilityAuthEnv(t)
	resetSemanticCacheEnv(t)
	t.Setenv("GATEWAY_OBSERVABILITY_AUTH_REQUIRED", "true")
	t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", strongObservabilityTokenForTest)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if !cfg.ObservabilityAuthRequired || cfg.ObservabilityInternalToken != strongObservabilityTokenForTest {
		t.Fatalf("unexpected required observability auth config: required=%v token=%q", cfg.ObservabilityAuthRequired, cfg.ObservabilityInternalToken)
	}
}

func TestObservabilityAuthProductionLikeCannotBeDisabled(t *testing.T) {
	for _, test := range []struct {
		name  string
		key   string
		value string
	}{
		{name: "node production", key: "NODE_ENV", value: "production"},
		{name: "aws runtime", key: "AWS_EXECUTION_ENV", value: "AWS_ECS_FARGATE"},
		{name: "self host deployment", key: "DEPLOYMENT_MODE", value: "self_host"},
		{name: "saas deployment", key: "DEPLOYMENT_MODE", value: "saas"},
		{name: "self host deployment env", key: "GATELM_DEPLOYMENT_ENV", value: "selfhost"},
	} {
		t.Run(test.name, func(t *testing.T) {
			resetObservabilityAuthEnv(t)
			resetSemanticCacheEnv(t)
			t.Setenv("GATEWAY_OBSERVABILITY_AUTH_REQUIRED", "false")
			t.Setenv(test.key, test.value)

			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN") {
				t.Fatalf("expected production-like fail-closed error, got %v", err)
			}

			t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", strongObservabilityTokenForTest)
			cfg, err := LoadWithError()
			if err != nil {
				t.Fatalf("load production-like config with strong token: %v", err)
			}
			if !cfg.ObservabilityAuthRequired {
				t.Fatal("production-like environment must force observability auth")
			}
		})
	}
}

func TestObservabilityAuthInvalidRequiredFlagFailsClosed(t *testing.T) {
	resetObservabilityAuthEnv(t)
	resetSemanticCacheEnv(t)
	t.Setenv("GATEWAY_OBSERVABILITY_AUTH_REQUIRED", "definitely-not-a-boolean")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN") {
		t.Fatalf("invalid required flag must fail closed, got %v", err)
	}
}

func resetObservabilityAuthEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"GATEWAY_OBSERVABILITY_INTERNAL_TOKEN",
		"GATEWAY_OBSERVABILITY_AUTH_REQUIRED",
		"DEPLOYMENT_MODE",
		"NODE_ENV",
		"APP_ENV",
		"ENV",
		"DEPLOYMENT_ENV",
		"GATELM_DEPLOYMENT_ENV",
		"AWS_EXECUTION_ENV",
		"ECS_CONTAINER_METADATA_URI",
		"ECS_CONTAINER_METADATA_URI_V4",
		"AWS_LAMBDA_FUNCTION_NAME",
	} {
		t.Setenv(key, "")
	}
}
