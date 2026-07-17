package cache

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	openaiembedding "gatelm/apps/gateway-core/internal/adapters/embeddings/openai"
	"gatelm/apps/gateway-core/internal/domain/embedding"
)

const defaultOpenAIEmbeddingBaseURL = "https://api.openai.com/v1"

// These aliases preserve the existing Semantic Cache error contract while the
// provider transport lives behind the neutral embedding boundary.
var (
	ErrOpenAIEmbeddingAPIKeyRequired = embedding.ErrCredentialRequired
	ErrOpenAIEmbeddingInputEmpty     = embedding.ErrInputEmpty
	ErrOpenAIEmbeddingRequestFailed  = embedding.ErrRequestFailed
	ErrOpenAIEmbeddingInvalidReply   = embedding.ErrInvalidResponse
	ErrOpenAIEmbeddingEmptyVector    = embedding.ErrEmptyVector
)

type OpenAIEmbeddingProviderConfig struct {
	APIKey     string
	BaseURL    string
	ModelName  string
	Dimensions int
	Timeout    time.Duration
	HTTPClient *http.Client
}

// OpenAIEmbeddingProvider is a compatibility adapter for the existing
// Semantic Cache single-input contract. Semantic Cache normalization remains
// here and is intentionally not applied by the provider-neutral client.
type OpenAIEmbeddingProvider struct {
	client     embedding.Provider
	modelName  string
	dimensions int
}

func NewOpenAIEmbeddingProvider(config OpenAIEmbeddingProviderConfig) (OpenAIEmbeddingProvider, error) {
	modelName := strings.TrimSpace(config.ModelName)
	if modelName == "" {
		modelName = "text-embedding-3-small"
	}
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultOpenAIEmbeddingBaseURL
	}
	timeout := config.Timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}

	client, err := openaiembedding.NewClient(openaiembedding.Config{
		APIKey:                 config.APIKey,
		BaseURL:                baseURL,
		Model:                  modelName,
		Dimensions:             config.Dimensions,
		Timeout:                timeout,
		MaxAttempts:            1,
		MaxResponseBytes:       1 << 20,
		ResponseValidationMode: openaiembedding.ResponseValidationLegacySemanticCache,
		HTTPClient:             config.HTTPClient,
	})
	if err != nil {
		return OpenAIEmbeddingProvider{}, err
	}
	return OpenAIEmbeddingProvider{
		client:     client,
		modelName:  modelName,
		dimensions: config.Dimensions,
	}, nil
}

func (p OpenAIEmbeddingProvider) ProviderName() string {
	return SemanticCacheEmbeddingProviderOpenAI
}

func (p OpenAIEmbeddingProvider) ModelName() string {
	return p.modelName
}

func (p OpenAIEmbeddingProvider) Embed(ctx context.Context, input EmbeddingInput) (EmbeddingResult, error) {
	text := normalizeSemanticText(input.NormalizedText)
	if text == "" {
		return EmbeddingResult{}, ErrOpenAIEmbeddingInputEmpty
	}
	if p.client == nil {
		return EmbeddingResult{}, fmt.Errorf("%w: provider unavailable", ErrOpenAIEmbeddingRequestFailed)
	}

	result, err := p.client.Embed(ctx, embedding.Request{
		Inputs:     []string{text},
		Model:      p.modelName,
		Dimensions: p.dimensions,
	})
	if err != nil {
		return EmbeddingResult{}, err
	}
	if len(result.Vectors) != 1 || len(result.Vectors[0]) == 0 {
		return EmbeddingResult{}, ErrOpenAIEmbeddingInvalidReply
	}
	return EmbeddingResult{
		Vector: append([]float64(nil), result.Vectors[0]...),
		Model:  p.modelName,
	}, nil
}

// Retained for existing package-level request-shape and endpoint compatibility
// tests. Production HTTP transport is implemented in adapters/embeddings/openai.
type openAIEmbeddingRequest struct {
	Input      string `json:"input"`
	Model      string `json:"model"`
	Dimensions *int   `json:"dimensions,omitempty"`
}

func openAIEmbeddingEndpoint(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultOpenAIEmbeddingBaseURL
	}
	return baseURL + "/embeddings"
}
