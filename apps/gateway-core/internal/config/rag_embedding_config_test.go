package config

import (
	"strings"
	"testing"
	"time"
)

var ragEmbeddingEnvKeys = []string{
	"TENANT_CHAT_RAG_ENABLED",
	"RAG_EMBEDDING_PROVIDER",
	"RAG_EMBEDDING_MODEL",
	"RAG_EMBEDDING_DIMENSIONS",
	"RAG_EMBEDDING_PROFILE_VERSION",
	"RAG_DISTANCE_METRIC",
	"RAG_EMBEDDING_CREDENTIAL_REF_ID",
	"RAG_EMBEDDING_OPENAI_BASE_URL",
	"RAG_EMBEDDING_ATTEMPT_TIMEOUT_MS",
	"RAG_EMBEDDING_MAX_ATTEMPTS",
	"RAG_EMBEDDING_MAX_INPUTS",
	"RAG_EMBEDDING_MAX_TOKENS_PER_INPUT",
	"RAG_EMBEDDING_MAX_BATCH_TOKENS",
	"RAG_EMBEDDING_MAX_RESPONSE_BYTES",
	"RAG_EMBEDDING_WORKLOAD_JWKS_FILE",
	"RAG_EMBEDDING_BINDING_HMAC_KEYS_FILE",
	"RAG_EMBEDDING_WORKLOAD_IDENTITIES_FILE",
	"RAG_EMBEDDING_WORKLOAD_JTI_REDIS_PREFIX",
}

func TestRAGEmbeddingConfigDefaultsAreDisabledAndFixed(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load default config: %v", err)
	}
	rag := cfg.RAGEmbedding
	if rag.Enabled {
		t.Fatal("RAG embedding must default to disabled")
	}
	if rag.Provider != RAGEmbeddingProviderOpenAI || rag.Model != RAGEmbeddingModel ||
		rag.Dimensions != RAGEmbeddingDimensions || rag.ProfileVersion != RAGEmbeddingProfileVersion ||
		rag.DistanceMetric != RAGEmbeddingDistanceMetric {
		t.Fatalf("unexpected fixed RAG profile: %+v", rag)
	}
	if rag.CredentialRefID != defaultRAGEmbeddingCredentialRefID || rag.OpenAIBaseURL != defaultRAGEmbeddingOpenAIBaseURL {
		t.Fatalf("unexpected provider defaults: credential=%q baseURL=%q", rag.CredentialRefID, rag.OpenAIBaseURL)
	}
	if rag.AttemptTimeout != 10*time.Second || rag.MaxAttempts != 3 || rag.MaxInputs != 128 ||
		rag.MaxTokensPerInput != 8192 || rag.MaxBatchTokens != 300_000 ||
		rag.MaxResponseBytes != 16*1024*1024 {
		t.Fatalf("unexpected bounded defaults: %+v", rag)
	}
	if rag.WorkloadJWKSFile != "" || rag.BindingHMACKeysFile != "" || rag.WorkloadIdentitiesFile != "" ||
		rag.WorkloadJTIPrefix != defaultRAGEmbeddingWorkloadJTIPrefix {
		t.Fatalf("unexpected workload auth defaults: %+v", rag)
	}
}

func TestRAGEmbeddingConfigRejectsFixedProfileMismatchWhileDisabled(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "provider", key: "RAG_EMBEDDING_PROVIDER", value: "fake"},
		{name: "model", key: "RAG_EMBEDDING_MODEL", value: "text-embedding-3-small"},
		{name: "dimensions", key: "RAG_EMBEDDING_DIMENSIONS", value: "3072"},
		{name: "profile version", key: "RAG_EMBEDDING_PROFILE_VERSION", value: "2"},
		{name: "distance", key: "RAG_DISTANCE_METRIC", value: "euclidean"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resetRAGEmbeddingConfigEnv(t)
			t.Setenv(test.key, test.value)
			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), test.key) {
				t.Fatalf("expected %s mismatch, got %v", test.key, err)
			}
		})
	}
}

func TestRAGEmbeddingConfigRejectsInvalidFlagAndBounds(t *testing.T) {
	tests := []struct {
		name  string
		key   string
		value string
	}{
		{name: "flag", key: "TENANT_CHAT_RAG_ENABLED", value: "enabled"},
		{name: "attempt timeout zero", key: "RAG_EMBEDDING_ATTEMPT_TIMEOUT_MS", value: "0"},
		{name: "attempt timeout too high", key: "RAG_EMBEDDING_ATTEMPT_TIMEOUT_MS", value: "120001"},
		{name: "attempt count zero", key: "RAG_EMBEDDING_MAX_ATTEMPTS", value: "0"},
		{name: "attempt count too high", key: "RAG_EMBEDDING_MAX_ATTEMPTS", value: "4"},
		{name: "input count too high", key: "RAG_EMBEDDING_MAX_INPUTS", value: "129"},
		{name: "per input token cap too high", key: "RAG_EMBEDDING_MAX_TOKENS_PER_INPUT", value: "8193"},
		{name: "batch token cap too high", key: "RAG_EMBEDDING_MAX_BATCH_TOKENS", value: "300001"},
		{name: "response body too small", key: "RAG_EMBEDDING_MAX_RESPONSE_BYTES", value: "1023"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resetRAGEmbeddingConfigEnv(t)
			t.Setenv(test.key, test.value)
			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), test.key) {
				t.Fatalf("expected bounded %s error, got %v", test.key, err)
			}
		})
	}
}

func TestRAGEmbeddingConfigEnabledRequiresPrivateGateway(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	t.Setenv("TENANT_CHAT_RAG_ENABLED", "true")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "TENANT_CHAT_PRIVATE_GATEWAY_ENABLED=true") {
		t.Fatalf("expected private Gateway requirement, got %v", err)
	}
}

func TestRAGEmbeddingConfigEnabledRequiresDedicatedAuthAndCredential(t *testing.T) {
	tests := []struct {
		name string
		key  string
	}{
		{name: "workload jwks", key: "RAG_EMBEDDING_WORKLOAD_JWKS_FILE"},
		{name: "binding keys", key: "RAG_EMBEDDING_BINDING_HMAC_KEYS_FILE"},
		{name: "workload identities", key: "RAG_EMBEDDING_WORKLOAD_IDENTITIES_FILE"},
		{name: "workload jti prefix", key: "RAG_EMBEDDING_WORKLOAD_JTI_REDIS_PREFIX"},
		{name: "credential ref", key: "RAG_EMBEDDING_CREDENTIAL_REF_ID"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resetRAGEmbeddingConfigEnv(t)
			setValidRAGEmbeddingEnabledEnv(t, "http://127.0.0.1:18080/v1")
			t.Setenv(test.key, " ")
			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), test.key) {
				t.Fatalf("expected %s requirement, got %v", test.key, err)
			}
		})
	}
}

func TestRAGEmbeddingConfigLoadsBoundedLocalSettings(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	setValidRAGEmbeddingEnabledEnv(t, "http://127.0.0.1:18080/v1/")
	t.Setenv("RAG_EMBEDDING_CREDENTIAL_REF_ID", "credential_ref_rag_test")
	t.Setenv("RAG_EMBEDDING_ATTEMPT_TIMEOUT_MS", "2500")
	t.Setenv("RAG_EMBEDDING_MAX_ATTEMPTS", "3")
	t.Setenv("RAG_EMBEDDING_MAX_INPUTS", "64")
	t.Setenv("RAG_EMBEDDING_MAX_TOKENS_PER_INPUT", "4096")
	t.Setenv("RAG_EMBEDDING_MAX_BATCH_TOKENS", "200000")
	t.Setenv("RAG_EMBEDDING_MAX_RESPONSE_BYTES", "8388608")

	cfg, err := LoadWithError()
	if err != nil {
		t.Fatalf("load enabled local RAG config: %v", err)
	}
	rag := cfg.RAGEmbedding
	if !rag.Enabled || rag.CredentialRefID != "credential_ref_rag_test" ||
		rag.OpenAIBaseURL != "http://127.0.0.1:18080/v1" || rag.AttemptTimeout != 2500*time.Millisecond ||
		rag.MaxAttempts != 3 || rag.MaxInputs != 64 || rag.MaxTokensPerInput != 4096 ||
		rag.MaxBatchTokens != 200000 || rag.MaxResponseBytes != 8388608 {
		t.Fatalf("unexpected enabled local config: %+v", rag)
	}
}

func TestRAGEmbeddingConfigRejectsInvalidBaseURL(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	setValidRAGEmbeddingEnabledEnv(t, "https://user:secret@example.com/v1")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "RAG_EMBEDDING_OPENAI_BASE_URL") {
		t.Fatalf("expected invalid base URL error, got %v", err)
	}
}

func TestRAGEmbeddingConfigRejectsUnsafeProductionBaseURL(t *testing.T) {
	tests := []string{
		"http://api.openai.com/v1",
		"https://localhost/v1",
		"https://127.0.0.1/v1",
		"https://[::1]/v1",
		"https://0.0.0.0/v1",
		"https://fake-embedding.example/v1",
		"https://api.openai.com.example/v1",
		"https://api.openai.com/v1/proxy",
	}
	for _, baseURL := range tests {
		t.Run(baseURL, func(t *testing.T) {
			resetRAGEmbeddingConfigEnv(t)
			setValidRAGEmbeddingEnabledEnv(t, baseURL)
			t.Setenv("GATELM_DEPLOYMENT_ENV", "staging")
			t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", "production-observability-token-value")
			_, err := LoadWithError()
			if err == nil || !strings.Contains(err.Error(), "RAG_EMBEDDING_OPENAI_BASE_URL") {
				t.Fatalf("expected production URL rejection for %q, got %v", baseURL, err)
			}
		})
	}
}

func TestRAGEmbeddingConfigAcceptsHTTPSProviderInProductionLikeEnvironment(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	setValidRAGEmbeddingEnabledEnv(t, "https://api.openai.com/v1")
	t.Setenv("GATELM_DEPLOYMENT_ENV", "staging")
	t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", "production-observability-token-value")

	if _, err := LoadWithError(); err != nil {
		t.Fatalf("load production-like HTTPS RAG config: %v", err)
	}
}

func TestRAGEmbeddingConfigRejectsFakeProductionEndpointWhileDisabled(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	t.Setenv("RAG_EMBEDDING_OPENAI_BASE_URL", "https://fake-embedding.example/v1")
	t.Setenv("GATELM_DEPLOYMENT_ENV", "staging")
	t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", "production-observability-token-value")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "official OpenAI API origin") {
		t.Fatalf("disabled production RAG config must reject fake endpoints, got %v", err)
	}
}

func TestRAGEmbeddingConfigRejectsCustomEndpointWithoutExplicitLocalOrTestMode(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	t.Setenv("RAG_EMBEDDING_OPENAI_BASE_URL", "http://127.0.0.1:18080/v1")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "DEPLOYMENT_MODE explicitly selects local or test") {
		t.Fatalf("unclassified environment must reject custom RAG endpoint, got %v", err)
	}
}

func TestRAGEmbeddingConfigTreatsSelfHostAsActualProviderRuntime(t *testing.T) {
	resetRAGEmbeddingConfigEnv(t)
	setValidRAGEmbeddingEnabledEnv(t, "https://fake-embedding.example/v1")
	t.Setenv("DEPLOYMENT_MODE", "self_host")
	t.Setenv("GATEWAY_OBSERVABILITY_INTERNAL_TOKEN", "production-observability-token-value")

	_, err := LoadWithError()
	if err == nil || !strings.Contains(err.Error(), "official OpenAI API origin") {
		t.Fatalf("self-host RAG must reject fake endpoints, got %v", err)
	}
}

func resetRAGEmbeddingConfigEnv(t *testing.T) {
	t.Helper()
	resetSemanticCacheEnv(t)
	for _, key := range ragEmbeddingEnvKeys {
		t.Setenv(key, "")
	}
	for _, key := range []string{
		"TENANT_CHAT_PRIVATE_GATEWAY_ENABLED",
		"TENANT_CHAT_PRIVATE_LISTEN_ADDRESS",
		"TENANT_CHAT_WORKLOAD_JWKS_FILE",
		"TENANT_CHAT_BINDING_HMAC_KEYS_FILE",
		"TENANT_CHAT_CACHE_KEYSETS_FILE",
		"TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE",
		"TENANT_CHAT_WORKLOAD_JTI_REDIS_PREFIX",
		"NODE_ENV",
		"APP_ENV",
		"ENV",
		"DEPLOYMENT_ENV",
		"DEPLOYMENT_MODE",
		"GATELM_DEPLOYMENT_ENV",
		"AWS_EXECUTION_ENV",
		"ECS_CONTAINER_METADATA_URI",
		"ECS_CONTAINER_METADATA_URI_V4",
		"AWS_LAMBDA_FUNCTION_NAME",
		"GATEWAY_OBSERVABILITY_INTERNAL_TOKEN",
	} {
		t.Setenv(key, "")
	}
}

func setValidRAGEmbeddingEnabledEnv(t *testing.T, baseURL string) {
	t.Helper()
	t.Setenv("DEPLOYMENT_MODE", "test")
	t.Setenv("TENANT_CHAT_RAG_ENABLED", "true")
	t.Setenv("TENANT_CHAT_PRIVATE_GATEWAY_ENABLED", "true")
	t.Setenv("TENANT_CHAT_WORKLOAD_JWKS_FILE", "testdata/tenant-chat-workload-jwks.json")
	t.Setenv("TENANT_CHAT_BINDING_HMAC_KEYS_FILE", "testdata/tenant-chat-binding-keys.json")
	t.Setenv("TENANT_CHAT_CACHE_KEYSETS_FILE", "testdata/tenant-chat-cache-keys.json")
	t.Setenv("TENANT_CHAT_USAGE_RECEIPT_TOKEN_FILE", "testdata/tenant-chat-receipt-token")
	t.Setenv("RAG_EMBEDDING_OPENAI_BASE_URL", baseURL)
	t.Setenv("RAG_EMBEDDING_WORKLOAD_JWKS_FILE", "testdata/rag-workload-jwks.json")
	t.Setenv("RAG_EMBEDDING_BINDING_HMAC_KEYS_FILE", "testdata/rag-binding-keys.json")
	t.Setenv("RAG_EMBEDDING_WORKLOAD_IDENTITIES_FILE", "testdata/rag-workload-identities.json")
}
