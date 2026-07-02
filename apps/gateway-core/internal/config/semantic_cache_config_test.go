package config

import (
	"strings"
	"testing"
	"time"
)

var semanticCacheEnvKeys = []string{
	"SEMANTIC_CACHE_ENABLED",
	"SEMANTIC_CACHE_THRESHOLD",
	"SEMANTIC_CACHE_TOP_K",
	"SEMANTIC_CACHE_TTL_SECONDS",
	"SEMANTIC_CACHE_STORE",
	"SEMANTIC_CACHE_MAX_ENTRIES",
	"SEMANTIC_CACHE_POLICY_VERSION",
	"SEMANTIC_CACHE_KEY_VERSION",
	"SEMANTIC_CACHE_EMBEDDING_PROVIDER",
	"SEMANTIC_CACHE_EMBEDDING_MODEL",
	"SEMANTIC_CACHE_EMBEDDING_DIMENSIONS",
	"SEMANTIC_CACHE_EMBEDDING_TIMEOUT_MS",
	"SEMANTIC_CACHE_OPENAI_BASE_URL",
	"SEMANTIC_CACHE_ALLOW_CATEGORIES",
	"SEMANTIC_CACHE_DENY_CATEGORIES",
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
	if strings.Join(cfg.AllowCategories, ",") != "general,support_refund" {
		t.Fatalf("allow category 기본값 불일치: got %v", cfg.AllowCategories)
	}
	if strings.Join(cfg.DenyCategories, ",") != "code,translation,reasoning,sensitive,tool_call,unknown" {
		t.Fatalf("deny category 기본값 불일치: got %v", cfg.DenyCategories)
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
	if got := strings.Join(cfg.DenyCategories, ","); got != "code,translation,reasoning,sensitive,tool_call,unknown" {
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

		cfg, err := LoadSemanticCacheConfig()
		if err != nil {
			t.Fatalf("범위 밖 숫자값은 fallback되어야 함: %v", err)
		}
		if cfg.Threshold != 0.92 || cfg.TopK != 3 || cfg.TTL != time.Hour || cfg.MaxEntries != 1000 || cfg.EmbeddingDimensions != 0 || cfg.EmbeddingTimeout != 3*time.Second {
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

	t.Run("unknown embedding provider returns explicit error", func(t *testing.T) {
		resetSemanticCacheEnv(t)
		t.Setenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER", "openai")

		_, err := LoadSemanticCacheConfig()
		if err == nil || !strings.Contains(err.Error(), "unsupported semantic cache embedding provider") {
			t.Fatalf("unknown embedding provider는 명시 에러를 반환해야 함: %v", err)
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
}
