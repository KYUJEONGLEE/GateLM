package config

import (
	"strings"
	"testing"
)

var tenantChatPrivateEnvKeys = []string{
	"TENANT_CHAT_PRIVATE_GATEWAY_ENABLED",
	"TENANT_CHAT_PRIVATE_LISTEN_ADDRESS",
	"TENANT_CHAT_WORKLOAD_JWKS_FILE",
	"TENANT_CHAT_BINDING_HMAC_KEYS_FILE",
	"TENANT_CHAT_CACHE_KEYSETS_FILE",
	"TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE",
	"TENANT_CHAT_WORKLOAD_JTI_REDIS_PREFIX",
}

func resetTenantChatPrivateEnv(t *testing.T) {
	t.Helper()
	for _, key := range tenantChatPrivateEnvKeys {
		t.Setenv(key, "")
	}
}

func TestTenantChatPrivateGatewayIsDisabledByDefault(t *testing.T) {
	resetTenantChatPrivateEnv(t)
	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load default config: %v", err)
	}
	if cfg.TenantChatPrivate.Enabled {
		t.Fatal("private Gateway must require explicit opt-in")
	}
	if cfg.Port != "8080" {
		t.Fatalf("public Gateway port changed: %q", cfg.Port)
	}
}

func TestTenantChatPrivateGatewayRequiresSecretsAndSeparateListener(t *testing.T) {
	resetTenantChatPrivateEnv(t)
	t.Setenv("TENANT_CHAT_PRIVATE_GATEWAY_ENABLED", "true")
	if _, err := LoadWithError(); err == nil || !strings.Contains(err.Error(), "TENANT_CHAT_WORKLOAD_JWKS_FILE") {
		t.Fatalf("expected missing JWKS error, got %v", err)
	}

	t.Setenv("TENANT_CHAT_WORKLOAD_JWKS_FILE", "/run/secrets/tenant_chat_workload_jwks")
	if _, err := LoadWithError(); err == nil || !strings.Contains(err.Error(), "TENANT_CHAT_BINDING_HMAC_KEYS_FILE") {
		t.Fatalf("expected missing HMAC keys error, got %v", err)
	}

	t.Setenv("TENANT_CHAT_BINDING_HMAC_KEYS_FILE", "/run/secrets/tenant_chat_binding_hmac_keys")
	if _, err := LoadWithError(); err == nil || !strings.Contains(err.Error(), "TENANT_CHAT_CACHE_KEYSETS_FILE") {
		t.Fatalf("expected missing cache keys error, got %v", err)
	}

	t.Setenv("TENANT_CHAT_CACHE_KEYSETS_FILE", "/run/secrets/tenant_chat_cache_keysets")
	if _, err := LoadWithError(); err == nil || !strings.Contains(err.Error(), "TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE") {
		t.Fatalf("expected missing receipt token error, got %v", err)
	}

	t.Setenv("TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE", "/run/secrets/tenant_chat_usage_receipt_token")
	t.Setenv("TENANT_CHAT_PRIVATE_LISTEN_ADDRESS", ":8080")
	if _, err := LoadWithError(); err == nil || !strings.Contains(err.Error(), "must not share") {
		t.Fatalf("expected shared listener rejection, got %v", err)
	}

	t.Setenv("TENANT_CHAT_PRIVATE_LISTEN_ADDRESS", ":8081")
	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load enabled private config: %v", err)
	}
	if cfg.Port != "8080" || cfg.TenantChatPrivate.ListenAddress != ":8081" {
		t.Fatalf("unexpected public/private listener config: public=%q private=%q", cfg.Port, cfg.TenantChatPrivate.ListenAddress)
	}
}
