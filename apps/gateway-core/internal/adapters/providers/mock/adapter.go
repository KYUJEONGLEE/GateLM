package mock

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/provider"
)

type Adapter struct {
	baseURL    string
	httpClient *http.Client
}

func NewAdapter(baseURL string, httpClient *http.Client) *Adapter {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	return &Adapter{
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: httpClient,
	}
}

func (a *Adapter) Name() string {
	return "mock"
}

func (a *Adapter) AdapterType() string {
	return "mock"
}

func (a *Adapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, providerEndpoint(firstNonEmpty(config.BaseURL, a.baseURL), "/models"), nil)
	if err != nil {
		return nil, fmt.Errorf("build mock provider models request: %w", err)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call mock provider models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, classifyStatus(resp.StatusCode, "models")
	}

	var models provider.ModelListResponse
	if err := json.NewDecoder(resp.Body).Decode(&models); err != nil {
		return nil, fmt.Errorf("decode mock provider models response: %w", err)
	}

	return &models, nil
}

func (a *Adapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode mock provider chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, providerEndpoint(firstNonEmpty(config.BaseURL, a.baseURL), "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build mock provider chat request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("call mock provider chat completion: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, classifyStatus(resp.StatusCode, "chat completion")
	}

	var completion provider.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&completion); err != nil {
		return nil, fmt.Errorf("decode mock provider chat response: %w", err)
	}

	return &completion, nil
}

func classifyStatus(statusCode int, operation string) error {
	err := fmt.Errorf("mock provider %s returned status %d", operation, statusCode)
	switch statusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return provider.NewError(provider.ErrorKindUnauthorized, provider.ErrorCodeProviderUnauthorized, err)
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, err)
	default:
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
	}
}

func providerEndpoint(baseURL string, path string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(baseURL, "/v1") {
		baseURL += "/v1"
	}
	return baseURL + path
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
