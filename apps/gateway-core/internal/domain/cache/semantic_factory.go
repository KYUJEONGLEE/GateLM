package cache

import (
	"fmt"
	"strings"
)

const (
	SemanticCacheStoreInMemory         = "in_memory"
	SemanticCacheEmbeddingProviderFake = "fake"
)

func NewSemanticCacheStore(store string, maxEntries int) (SemanticCacheStore, error) {
	switch strings.TrimSpace(store) {
	case SemanticCacheStoreInMemory:
		return NewInMemorySemanticCacheStore(maxEntries), nil
	default:
		return nil, fmt.Errorf("unsupported semantic cache store %q", store)
	}
}

func NewSemanticCacheEmbeddingProvider(provider string, modelName string) (EmbeddingProvider, error) {
	switch strings.TrimSpace(provider) {
	case SemanticCacheEmbeddingProviderFake:
		return NewFakeEmbeddingProvider(modelName), nil
	default:
		return nil, fmt.Errorf("unsupported semantic cache embedding provider %q", provider)
	}
}
