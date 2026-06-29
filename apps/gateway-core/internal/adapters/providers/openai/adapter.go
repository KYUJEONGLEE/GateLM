package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/provider"
)

const defaultBaseURL = "https://api.openai.com"

type Adapter struct {
	name       string
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

func NewAdapter(name string, baseURL string, apiKey string, httpClient *http.Client) *Adapter {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "openai"
	}
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Adapter{
		name:       name,
		baseURL:    baseURL,
		apiKey:     strings.TrimSpace(apiKey),
		httpClient: httpClient,
	}
}

func (a *Adapter) Name() string {
	if a == nil || strings.TrimSpace(a.name) == "" {
		return "openai"
	}
	return a.name
}

func (a *Adapter) ListModels(ctx context.Context) (*provider.ModelListResponse, error) {
	if a == nil || a.apiKey == "" {
		return nil, provider.NewFailure(provider.FailureKindUnauthorized, 0, "list_models")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, fmt.Errorf("build openai provider models request: %w", err)
	}
	a.setHeaders(req)

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, providerFailureFromTransport(err, "list_models")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, provider.FailureFromHTTPStatus(resp.StatusCode, "list_models")
	}

	var models provider.ModelListResponse
	if err := json.NewDecoder(resp.Body).Decode(&models); err != nil {
		return nil, fmt.Errorf("decode openai provider models response: %w", err)
	}
	return &models, nil
}

func (a *Adapter) CreateChatCompletion(ctx context.Context, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	if a == nil || a.apiKey == "" {
		return nil, provider.NewFailure(provider.FailureKindUnauthorized, 0, "chat_completion")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode openai provider chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build openai provider chat request: %w", err)
	}
	a.setHeaders(httpReq)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, providerFailureFromTransport(err, "chat_completion")
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, provider.FailureFromHTTPStatus(resp.StatusCode, "chat_completion")
	}

	var completion provider.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&completion); err != nil {
		return nil, fmt.Errorf("decode openai provider chat response: %w", err)
	}
	return &completion, nil
}

func (a *Adapter) CreateChatCompletionStream(ctx context.Context, req provider.ChatCompletionRequest) (provider.ChatCompletionStream, error) {
	if a == nil || a.apiKey == "" {
		return nil, provider.NewFailure(provider.FailureKindUnauthorized, 0, "chat_completion_stream")
	}
	req.Stream = true
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encode openai provider stream request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build openai provider stream request: %w", err)
	}
	a.setHeaders(httpReq)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, providerFailureFromTransport(err, "chat_completion_stream")
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, provider.FailureFromHTTPStatus(resp.StatusCode, "chat_completion_stream")
	}

	return provider.NewReadCloserStream(resp.Body), nil
}

func (a *Adapter) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
}

func providerFailureFromTransport(err error, op string) provider.ProviderError {
	if errors.Is(err, context.DeadlineExceeded) {
		return provider.NewFailure(provider.FailureKindTimeout, 0, op)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return provider.NewFailure(provider.FailureKindTimeout, 0, op)
	}
	return provider.NewFailure(provider.FailureKindError, 0, op)
}
