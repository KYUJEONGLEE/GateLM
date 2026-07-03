package cache

import (
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	SemanticCacheStoreInMemory           = "in_memory"
	SemanticCacheEmbeddingProviderFake   = "fake"
	SemanticCacheEmbeddingProviderOpenAI = "openai"
)

type SemanticCacheEmbeddingProviderConfig struct {
	Provider         string
	ModelName        string
	OpenAIAPIKey     string
	OpenAIBaseURL    string
	OpenAIDimensions int
	Timeout          time.Duration
	HTTPClient       *http.Client
}

func NewSemanticCacheStore(store string, maxEntries int) (SemanticCacheStore, error) {
	switch strings.TrimSpace(store) {
	case SemanticCacheStoreInMemory:
		return NewInMemorySemanticCacheStore(maxEntries), nil
	default:
		return nil, fmt.Errorf("unsupported semantic cache store %q", store)
	}
}

func NewSemanticCacheEmbeddingProvider(provider string, modelName string) (EmbeddingProvider, error) {
	return NewSemanticCacheEmbeddingProviderWithConfig(SemanticCacheEmbeddingProviderConfig{
		Provider:  provider,
		ModelName: modelName,
	})
}

func NewSemanticCacheEmbeddingProviderWithConfig(config SemanticCacheEmbeddingProviderConfig) (EmbeddingProvider, error) {
	switch strings.TrimSpace(config.Provider) {
	case SemanticCacheEmbeddingProviderFake:
		return NewFakeEmbeddingProvider(config.ModelName), nil
	case SemanticCacheEmbeddingProviderOpenAI:
		return NewOpenAIEmbeddingProvider(OpenAIEmbeddingProviderConfig{
			APIKey:     config.OpenAIAPIKey,
			BaseURL:    config.OpenAIBaseURL,
			ModelName:  config.ModelName,
			Dimensions: config.OpenAIDimensions,
			Timeout:    config.Timeout,
			HTTPClient: config.HTTPClient,
		})
	default:
		return nil, fmt.Errorf("unsupported semantic cache embedding provider %q", config.Provider)
	}
}
