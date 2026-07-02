package cache

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultOpenAIEmbeddingBaseURL = "https://api.openai.com/v1"

var (
	ErrOpenAIEmbeddingAPIKeyRequired = errors.New("openai embedding api key is required")
	ErrOpenAIEmbeddingInputEmpty     = errors.New("openai embedding input is empty")
	ErrOpenAIEmbeddingRequestFailed  = errors.New("openai embedding request failed")
	ErrOpenAIEmbeddingInvalidReply   = errors.New("openai embedding response is invalid")
	ErrOpenAIEmbeddingEmptyVector    = errors.New("openai embedding response vector is empty")
)

type OpenAIEmbeddingProviderConfig struct {
	APIKey     string
	BaseURL    string
	ModelName  string
	Dimensions int
	Timeout    time.Duration
	HTTPClient *http.Client
}

type OpenAIEmbeddingProvider struct {
	apiKey     string
	baseURL    string
	modelName  string
	dimensions int
	timeout    time.Duration
	httpClient *http.Client
}

func NewOpenAIEmbeddingProvider(config OpenAIEmbeddingProviderConfig) (OpenAIEmbeddingProvider, error) {
	apiKey := strings.TrimSpace(config.APIKey)
	if apiKey == "" {
		return OpenAIEmbeddingProvider{}, ErrOpenAIEmbeddingAPIKeyRequired
	}

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

	httpClient := config.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: timeout}
	}

	return OpenAIEmbeddingProvider{
		apiKey:     apiKey,
		baseURL:    baseURL,
		modelName:  modelName,
		dimensions: config.Dimensions,
		timeout:    timeout,
		httpClient: httpClient,
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

	body, err := json.Marshal(openAIEmbeddingRequest{
		Input:      text,
		Model:      p.modelName,
		Dimensions: optionalPositiveInt(p.dimensions),
	})
	if err != nil {
		return EmbeddingResult{}, fmt.Errorf("%w: encode request", ErrOpenAIEmbeddingRequestFailed)
	}

	reqCtx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, openAIEmbeddingEndpoint(p.baseURL), bytes.NewReader(body))
	if err != nil {
		return EmbeddingResult{}, fmt.Errorf("%w: build request", ErrOpenAIEmbeddingRequestFailed)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) || errors.Is(reqCtx.Err(), context.Canceled) {
			return EmbeddingResult{}, context.Canceled
		}
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(reqCtx.Err(), context.DeadlineExceeded) {
			return EmbeddingResult{}, context.DeadlineExceeded
		}
		return EmbeddingResult{}, fmt.Errorf("%w: transport", ErrOpenAIEmbeddingRequestFailed)
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		drainOpenAIEmbeddingBody(resp.Body)
		return EmbeddingResult{}, fmt.Errorf("%w: status %d", ErrOpenAIEmbeddingRequestFailed, resp.StatusCode)
	}

	var decoded openAIEmbeddingResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&decoded); err != nil {
		return EmbeddingResult{}, fmt.Errorf("%w: decode", ErrOpenAIEmbeddingInvalidReply)
	}
	if len(decoded.Data) == 0 || len(decoded.Data[0].Embedding) == 0 {
		return EmbeddingResult{}, ErrOpenAIEmbeddingEmptyVector
	}

	return EmbeddingResult{
		Vector: append([]float64(nil), decoded.Data[0].Embedding...),
		Model:  p.modelName,
	}, nil
}

type openAIEmbeddingRequest struct {
	Input      string `json:"input"`
	Model      string `json:"model"`
	Dimensions *int   `json:"dimensions,omitempty"`
}

type openAIEmbeddingResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
}

func optionalPositiveInt(value int) *int {
	if value <= 0 {
		return nil
	}
	copied := value
	return &copied
}

func openAIEmbeddingEndpoint(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultOpenAIEmbeddingBaseURL
	}
	return baseURL + "/embeddings"
}

func drainOpenAIEmbeddingBody(body io.Reader) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
}
