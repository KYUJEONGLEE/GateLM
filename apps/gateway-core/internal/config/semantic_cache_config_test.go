package config

import (
	"strings"
	"testing"
	"time"
)

var semanticCacheEnvKeys = []string{
	"SEMANTIC_CACHE_ENABLED",
	"SEMANTIC_CACHE_MODE",
	"SEMANTIC_CACHE_THRESHOLD",
	"SEMANTIC_CACHE_DEFAULT_THRESHOLD",
	"SEMANTIC_CACHE_TOP_K",
	"SEMANTIC_CACHE_TTL_SECONDS",
	"SEMANTIC_CACHE_STORE",
	"SEMANTIC_CACHE_MAX_ENTRIES",
	"SEMANTIC_CACHE_POLICY_VERSION",
	"SEMANTIC_CACHE_KEY_VERSION",
	"SEMANTIC_CACHE_INTENT_POLICY_PATH",
	"SEMANTIC_CACHE_EMBEDDING_PROVIDER",
	"SEMANTIC_CACHE_EMBEDDING_MODEL",
	"SEMANTIC_CACHE_EMBEDDING_DIMENSIONS",
	"SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS",
	"SEMANTIC_CACHE_OPENAI_BASE_URL",
	"SEMANTIC_CACHE_ALLOW_CATEGORIES",
	"SEMANTIC_CACHE_DENY_CATEGORIES",
	"SEMANTIC_CACHE_ALLOWED_TENANT_IDS",
	"SEMANTIC_CACHE_ALLOWED_APPLICATION_IDS",
	"SEMANTIC_CACHE_ALLOWED_CATEGORIES",
	"SEMANTIC_CACHE_CLASSIFIER_ENABLED",
	"SEMANTIC_CACHE_CLASSIFIER_TYPE",
	"SEMANTIC_CACHE_CLASSIFIER_ENDPOINT",
	"SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE",
	"SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS",
	"SEMANTIC_CACHE_THRESHOLD_GENERAL",
	"SEMANTIC_CACHE_THRESHOLD_ACCOUNT_ACCESS",
	"SEMANTIC_CACHE_THRESHOLD_SUPPORT_REFUND",
	"SEMANTIC_CACHE_THRESHOLD_CODE",
	"SEMANTIC_CACHE_THRESHOLD_TRANSLATION",
	"SEMANTIC_CACHE_THRESHOLD_UNKNOWN",
	"OPENAI_API_KEY",
}

func resetSemanticCacheEnv(t *testing.T) {
	t.Helper()
	for _, key := range semanticCacheEnvKeys {
		t.Setenv(key, "")
		t.Setenv("GATEWAY_"+key, "")
	}
}

func TestSemanticCacheConfigDefaults(t *testing.T) {
	resetSemanticCacheEnv(t)

	cfg, err := LoadSemanticCacheConfig()
	if err != nil {
		t.Fatalf("기본 Semantic Cache config는 에러 없이 로드되어야 함: %v", err)
	}

	if cfg.Enabled {
		t.Fatalf("Semantic Cache 기본값은 disabled여야 함")
	}
	if cfg.Mode != "enforce" {
		t.Fatalf("Semantic Cache mode 기본값은 enforce여야 함: got %q", cfg.Mode)
	}
	if cfg.Threshold != 0.92 {
		t.Fatalf("threshold 기본값 불일치: got %v", cfg.Threshold)
	}
	if cfg.TopK != 3 {
		t.Fatalf("topK 기본값 불일치: got %d", cfg.TopK)
	}
	if cfg.TTL != time.Hour {
		t.Fatalf("TTL 기본값 불일치: got %s", cfg.TTL)
	}
	if cfg.Store != SemanticCacheStoreInMemory {
		t.Fatalf("store 기본값 불일치: got %q", cfg.Store)
	}
	if cfg.MaxEntries != 1000 {
		t.Fatalf("maxEntries 기본값 불일치: got %d", cfg.MaxEntries)
	}
	if cfg.EmbeddingProvider != SemanticCacheEmbeddingProviderFake {
		t.Fatalf("embedding provider 기본값 불일치: got %q", cfg.EmbeddingProvider)
	}
	if cfg.EmbeddingModel != "text-embedding-3-small" {
		t.Fatalf("embedding model 기본값 불일치: got %q", cfg.EmbeddingModel)
	}
	if cfg.EmbeddingDimensions != 0 {
		t.Fatalf("embedding dimensions 기본값 불일치: got %d", cfg.EmbeddingDimensions)
	}
	if cfg.EmbeddingTimeout != 3*time.Second {
		t.Fatalf("embedding timeout 기본값 불일치: got %s", cfg.EmbeddingTimeout)
	}
	if cfg.OpenAIBaseURL != "https://api.openai.com/v1" {
		t.Fatalf("OpenAI base URL 기본값 불일치: got %q", cfg.OpenAIBaseURL)
	}
	if cfg.PolicyVersion != "v1" || cfg.KeyVersion != "v1" {
		t.Fatalf("policy/key version 기본값 불일치: policy=%q key=%q", cfg.PolicyVersion, cfg.KeyVersion)
	}
	if cfg.IntentPolicyPath != "" {
		t.Fatalf("intent policy path 기본값은 비어 있어야 함: got %q", cfg.IntentPolicyPath)
	}
	if strings.Join(cfg.AllowCategories, ",") != "general,support_refund" {
		t.Fatalf("allow category 기본값 불일치: got %v", cfg.AllowCategories)
	}
	if strings.Join(cfg.DenyCategories, ",") != "code,translation,summarization,extraction_json,reasoning,sensitive,tool_call,unknown" {
		t.Fatalf("deny category 기본값 불일치: got %v", cfg.DenyCategories)
	}
	if len(cfg.AllowedTenantIDs) != 0 || len(cfg.AllowedApplicationIDs) != 0 || len(cfg.AllowedCategories) != 0 {
		t.Fatalf("scoped rollout 기본값은 비어 있어 기존 동작을 유지해야 함: %+v", cfg)
	}
	if len(cfg.CategoryThresholds) != 0 {
		t.Fatalf("category threshold override 기본값은 비어 있어야 함: %+v", cfg.CategoryThresholds)
	}
	if cfg.ClassifierEnabled {
		t.Fatalf("cacheability classifier 기본값은 disabled여야 함")
	}
	if cfg.ClassifierType != SemanticCacheClassifierTypeStub {
		t.Fatalf("cacheability classifier type 기본값 불일치: got %q", cfg.ClassifierType)
	}
	if cfg.ClassifierEndpoint != "" {
		t.Fatalf("cacheability classifier endpoint 기본값은 비어 있어야 함: got %q", cfg.ClassifierEndpoint)
	}
	if cfg.ClassifierMinConfidence != 0.90 {
		t.Fatalf("cacheability classifier min confidence 기본값 불일치: got %v", cfg.ClassifierMinConfidence)
	}
	if cfg.ClassifierTimeout != 30*time.Millisecond {
		t.Fatalf("cacheability classifier timeout 기본값 불일치: got %s", cfg.ClassifierTimeout)
	}
}

func TestSemanticCacheConfigDefaultCategoriesUseRoutingContract(t *testing.T) {
	resetSemanticCacheEnv(t)

	cfg, err := LoadSemanticCacheConfig()
	if err != nil {
		t.Fatalf("기본 Semantic Cache config는 에러 없이 로드되어야 함: %v", err)
	}

	if got := strings.Join(cfg.AllowCategories, ","); got != "general,support_refund" {
		t.Fatalf("SC-CATEGORY-001 allow categories는 routing category 기준이어야 함: got %q", got)
	}
	if got := strings.Join(cfg.DenyCategories, ","); got != "code,translation,summarization,extraction_json,reasoning,sensitive,tool_call,unknown" {
		t.Fatalf("SC-CATEGORY-001 deny categories는 위험 category를 차단해야 함: got %q", got)
	}
}

func TestSemanticCacheConfigInvalidValues(t *testing.T) {
	t.Run("invalid numeric values fall back to defaults", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_THRESHOLD", "2")
		t.Setenv("SEMANTIC_CACHE_TOP_K", "0")
		t.Setenv("SEMANTIC_CACHE_TTL_SECONDS", "-1")
		t.Setenv("SEMANTIC_CACHE_MAX_ENTRIES", "0")
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_DIMENSIONS", "-1")
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS", "0")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE", "2")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS", "0")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("범위 밖 숫자값은 fallback되어야 함: %v", err)
		}
		if cfg.Threshold != 0.92 || cfg.TopK != 3 || cfg.TTL != time.Hour || cfg.MaxEntries != 1000 || cfg.EmbeddingDimensions != 0 || cfg.EmbeddingTimeout != 3*time.Second || cfg.ClassifierMinConfidence != 0.90 || cfg.ClassifierTimeout != 30*time.Millisecond {
			t.Fatalf("invalid numeric fallback 불일치: %+v", cfg)
		}
	})

	t.Run("unknown store returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_STORE", "redis_vector")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "unsupported semantic cache store") {
			t.Fatalf("unknown store는 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("unknown mode returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_MODE", "observe")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "unsupported semantic cache mode") {
			t.Fatalf("unknown mode는 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("pgvector store returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_STORE", "pgvector")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "unsupported semantic cache store") {
			t.Fatalf("pgvector store는 아직 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("openai embedding provider is allowed while semantic cache is disabled", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "openai")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("disabled 상태에서는 OPENAI_API_KEY 없이도 openai provider config를 로드해야 함: %v", err)
		}
		if cfg.EmbeddingProvider != SemanticCacheEmbeddingProviderOpenAI {
			t.Fatalf("embedding provider 불일치: got %q", cfg.EmbeddingProvider)
		}
		if cfg.OpenAIAPIKey != "" {
			t.Fatalf("테스트 기본값에서는 OpenAI API key가 없어야 함")
		}
	})

	t.Run("enabled openai embedding provider without intent policy does not require OPENAI_API_KEY", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "openai")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("policy path가 없으면 OpenAI key 없이 no-op config를 로드해야 함: %v", err)
		}
		if cfg.IntentPolicyPath != "" || cfg.EmbeddingProvider != SemanticCacheEmbeddingProviderOpenAI {
			t.Fatalf("policy 없는 openai no-op config 불일치: %+v", cfg)
		}
	})

	t.Run("enabled openai embedding provider requires OPENAI_API_KEY when intent policy is set", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "openai")
		t.Setenv("SEMANTIC_CACHE_INTENT_POLICY_PATH", "apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "OPENAI_API_KEY is required") {
			t.Fatalf("policy가 있는 enabled openai provider는 OPENAI_API_KEY 누락 시 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("mode off does not require OPENAI_API_KEY", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_MODE", "off")
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "openai")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("mode=off에서는 OpenAI key 없이 config를 로드해야 함: %v", err)
		}
		if cfg.Mode != "off" || cfg.EmbeddingProvider != SemanticCacheEmbeddingProviderOpenAI {
			t.Fatalf("mode off config 불일치: %+v", cfg)
		}
	})

	t.Run("enabled openai embedding provider accepts OPENAI_API_KEY", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "openai")
		t.Setenv("OPENAI_API_KEY", "test_openai_api_key_redacted")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("OPENAI_API_KEY가 있으면 enabled openai provider config를 로드해야 함: %v", err)
		}
		if cfg.EmbeddingProvider != SemanticCacheEmbeddingProviderOpenAI || cfg.OpenAIAPIKey != "test_openai_api_key_redacted" {
			t.Fatalf("openai provider config 불일치: provider=%q key_set=%t", cfg.EmbeddingProvider, cfg.OpenAIAPIKey != "")
		}
	})

	t.Run("unknown embedding provider returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "unknown")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "unsupported semantic cache embedding provider") {
			t.Fatalf("unknown embedding provider는 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("unknown classifier type returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_TYPE", "remote_llm")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "unsupported semantic cache classifier type") {
			t.Fatalf("unknown classifier type은 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("invalid enabled bool returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_ENABLED", "maybe")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "must be a boolean") {
			t.Fatalf("invalid bool은 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("invalid classifier enabled bool returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_ENABLED", "maybe")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "must be a boolean") {
			t.Fatalf("invalid classifier bool은 명시 에러를 반환해야 함: %v", err)
		}
	})

	t.Run("intent policy path is optional config material", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_INTENT_POLICY_PATH", "apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("intent policy path는 config material로 로드되어야 함: %v", err)
		}
		if cfg.IntentPolicyPath == "" {
			t.Fatalf("intent policy path가 보존되어야 함")
		}
	})

	t.Run("scoped rollout and category thresholds are parsed", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_ALLOWED_TENANT_IDS", "tenant-a, tenant-b")
		t.Setenv("SEMANTIC_CACHE_ALLOWED_APPLICATION_IDS", "app-a")
		t.Setenv("SEMANTIC_CACHE_ALLOWED_CATEGORIES", "general,support_refund")
		t.Setenv("SEMANTIC_CACHE_DEFAULT_THRESHOLD", "0.8")
		t.Setenv("SEMANTIC_CACHE_THRESHOLD_GENERAL", "0.45")
		t.Setenv("SEMANTIC_CACHE_THRESHOLD_SUPPORT_REFUND", "0.7")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("scoped rollout config는 로드되어야 함: %v", err)
		}
		if strings.Join(cfg.AllowedTenantIDs, ",") != "tenant-a,tenant-b" ||
			strings.Join(cfg.AllowedApplicationIDs, ",") != "app-a" ||
			strings.Join(cfg.AllowedCategories, ",") != "general,support_refund" {
			t.Fatalf("scoped rollout parsing 불일치: %+v", cfg)
		}
		if cfg.Threshold != 0.8 {
			t.Fatalf("default threshold override 불일치: %v", cfg.Threshold)
		}
		if cfg.CategoryThresholds["general"] != 0.45 || cfg.CategoryThresholds["support_refund"] != 0.7 {
			t.Fatalf("category threshold parsing 불일치: %+v", cfg.CategoryThresholds)
		}
	})

	t.Run("cacheability classifier can be explicitly enabled for stub", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_TYPE", "stub")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE", "0.91")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS", "25")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("classifier stub config는 로드되어야 함: %v", err)
		}
		if !cfg.ClassifierEnabled || cfg.ClassifierType != SemanticCacheClassifierTypeStub || cfg.ClassifierMinConfidence != 0.91 || cfg.ClassifierTimeout != 25*time.Millisecond {
			t.Fatalf("classifier config parsing 불일치: %+v", cfg)
		}
	})

	t.Run("cacheability classifier can be explicitly enabled for fasttext sidecar", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_TYPE", "fasttext")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_ENDPOINT", "http://127.0.0.1:8765/classify")

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("classifier fasttext config는 endpoint와 함께 로드되어야 함: %v", err)
		}
		if !cfg.ClassifierEnabled || cfg.ClassifierType != SemanticCacheClassifierTypeFastText || cfg.ClassifierEndpoint != "http://127.0.0.1:8765/classify" {
			t.Fatalf("fasttext classifier config parsing 불일치: %+v", cfg)
		}
	})

	t.Run("enabled fasttext classifier requires endpoint", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_ENABLED", "true")
		t.Setenv("SEMANTIC_CACHE_CLASSIFIER_TYPE", "fasttext")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "SEMANTIC_CACHE_CLASSIFIER_ENDPOINT is required") {
			t.Fatalf("enabled fasttext classifier는 endpoint 누락 시 명시 에러를 반환해야 함: %v", err)
		}
	})
}
