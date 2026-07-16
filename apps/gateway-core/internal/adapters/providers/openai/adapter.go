package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

const adapterType = providercatalog.AdapterTypeOpenAICompatible

type Adapter struct {
	httpClient *http.Client
}

func NewAdapter(httpClient *http.Client) *Adapter {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &Adapter{httpClient: httpClient}
}

func (a *Adapter) AdapterType() string {
	return adapterType
}

func (a *Adapter) ListModels(ctx context.Context, config provider.ExecutionConfig) (*provider.ModelListResponse, error) {
	config = normalizeConfig(config)
	if err := validateConfig(config, false); err != nil {
		return nil, err
	}

	reqCtx, cancel := contextWithTimeout(ctx, config.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, providerEndpoint(config.BaseURL, "/models"), nil)
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider models request: %w", err))
	}
	if config.Credential != nil && strings.TrimSpace(config.Credential.Value) != "" {
		req.Header.Set("Authorization", "Bearer "+config.Credential.Value)
	}

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return nil, classifyTransportError(reqCtx, err)
	}
	defer resp.Body.Close()

	if err := classifyStatus(resp); err != nil {
		return nil, err
	}

	var models provider.ModelListResponse
	if err := json.NewDecoder(resp.Body).Decode(&models); err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider models response: %w", err))
	}
	return &models, nil
}

func (a *Adapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	req.DispatchTracker.Observe()
	config = normalizeConfig(config)
	if err := validateConfig(config, true); err != nil {
		return nil, err
	}

	body, err := json.Marshal(openAIRequestForModel(config, req))
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("encode provider chat request: %w", err))
	}

	reqCtx, cancel := contextWithTimeout(ctx, config.Timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, providerEndpoint(config.BaseURL, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider chat request: %w", err))
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+config.Credential.Value)
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)
	if req.BeforeDispatch != nil {
		if err := req.BeforeDispatch(reqCtx); err != nil {
			return nil, provider.NewNotStartedError(err)
		}
	}
	req.DispatchTracker.MarkStarted()

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, classifyTransportError(reqCtx, err)
	}
	defer resp.Body.Close()

	if err := classifyStatus(resp); err != nil {
		return nil, err
	}

	var completion provider.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&completion); err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider chat response: %w", err))
	}

	return &completion, nil
}

func (a *Adapter) CreateChatCompletionStream(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (provider.ChatCompletionStreamReader, error) {
	req.DispatchTracker.Observe()
	config = normalizeConfig(config)
	if err := validateConfig(config, true); err != nil {
		return nil, err
	}

	req.Stream = true
	if supportsStreamingUsageOptions(config) {
		req.StreamOptions = withStreamingUsage(req.StreamOptions)
	} else {
		req.StreamOptions = nil
	}
	body, err := json.Marshal(openAIRequestForModel(config, req))
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("encode provider streaming chat request: %w", err))
	}

	reqCtx, cancel := contextWithTimeout(ctx, config.Timeout)
	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, providerEndpoint(config.BaseURL, "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		cancel()
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider streaming chat request: %w", err))
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Authorization", "Bearer "+config.Credential.Value)
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)
	if req.BeforeDispatch != nil {
		if err := req.BeforeDispatch(reqCtx); err != nil {
			cancel()
			return nil, provider.NewNotStartedError(err)
		}
	}
	req.DispatchTracker.MarkStarted()

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		cancel()
		return nil, classifyTransportError(reqCtx, err)
	}

	if err := classifyStatus(resp); err != nil {
		resp.Body.Close()
		cancel()
		return nil, err
	}

	return &openAIStreamReader{
		ctx:    reqCtx,
		cancel: cancel,
		body:   resp.Body,
		reader: bufio.NewReader(resp.Body),
	}, nil
}

func withStreamingUsage(options *provider.ChatCompletionStreamOptions) *provider.ChatCompletionStreamOptions {
	if options == nil {
		return &provider.ChatCompletionStreamOptions{IncludeUsage: true}
	}

	copied := *options
	copied.IncludeUsage = true
	return &copied
}

type openAIChatCompletionRequest struct {
	Model               string                                `json:"model"`
	Messages            []provider.ChatMessage                `json:"messages"`
	Temperature         *float64                              `json:"temperature,omitempty"`
	MaxTokens           *int                                  `json:"max_tokens,omitempty"`
	MaxCompletionTokens *int                                  `json:"max_completion_tokens,omitempty"`
	Stream              bool                                  `json:"stream,omitempty"`
	StreamOptions       *provider.ChatCompletionStreamOptions `json:"stream_options,omitempty"`
	Metadata            json.RawMessage                       `json:"metadata,omitempty"`
	GateLM              json.RawMessage                       `json:"gate_lm,omitempty"`
}

func openAIRequestForModel(config provider.ExecutionConfig, req provider.ChatCompletionRequest) openAIChatCompletionRequest {
	out := openAIChatCompletionRequest{
		Model:               req.Model,
		Messages:            req.Messages,
		Temperature:         req.Temperature,
		MaxTokens:           req.MaxTokens,
		MaxCompletionTokens: req.MaxCompletionTokens,
		Stream:              req.Stream,
		StreamOptions:       req.StreamOptions,
		Metadata:            req.Metadata,
		GateLM:              req.GateLM,
	}
	if requiresMaxCompletionTokens(config, req.Model) {
		if out.MaxCompletionTokens == nil {
			out.MaxCompletionTokens = out.MaxTokens
		}
		out.MaxTokens = nil
	}
	if usesOpenAIReasoningParameters(req.Model) {
		out.Temperature = nil
	}
	return out
}

func requiresMaxCompletionTokens(config provider.ExecutionConfig, model string) bool {
	return isCerebrasCompatible(config) || usesOpenAIReasoningParameters(model)
}

func usesOpenAIReasoningParameters(model string) bool {
	normalized := normalizeOpenAIModelName(model)
	return strings.HasPrefix(normalized, "gpt-5") ||
		strings.HasPrefix(normalized, "o1") ||
		strings.HasPrefix(normalized, "o3") ||
		strings.HasPrefix(normalized, "o4")
}

func supportsStreamingUsageOptions(config provider.ExecutionConfig) bool {
	return !isCerebrasCompatible(config)
}

func isCerebrasCompatible(config provider.ExecutionConfig) bool {
	providerName := strings.ToLower(strings.TrimSpace(config.ProviderName))
	if providerName == "cerebras" || strings.HasPrefix(providerName, "cerebras-") {
		return true
	}

	baseURL, err := url.Parse(strings.TrimSpace(config.BaseURL))
	return err == nil && strings.EqualFold(baseURL.Hostname(), "api.cerebras.ai")
}

func normalizeOpenAIModelName(model string) string {
	normalized := strings.TrimSpace(strings.ToLower(model))
	if index := strings.LastIndex(normalized, ":"); index >= 0 {
		normalized = strings.TrimSpace(normalized[index+1:])
	}
	return normalized
}

func normalizeConfig(config provider.ExecutionConfig) provider.ExecutionConfig {
	config.ProviderID = strings.TrimSpace(config.ProviderID)
	config.ProviderName = strings.TrimSpace(config.ProviderName)
	config.AdapterType = strings.TrimSpace(config.AdapterType)
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	config.AdapterConfig.RequestFormat = strings.TrimSpace(config.AdapterConfig.RequestFormat)
	config.AdapterConfig.APIVersion = strings.TrimSpace(config.AdapterConfig.APIVersion)
	return config
}

func validateConfig(config provider.ExecutionConfig, requireCredential bool) error {
	if config.BaseURL == "" {
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider base URL is missing"))
	}
	if config.AdapterConfig.RequestFormat != "" &&
		config.AdapterConfig.RequestFormat != providercatalog.RequestFormatOpenAIChatCompletions {
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider request format is unsupported"))
	}
	if requireCredential && (config.Credential == nil || strings.TrimSpace(config.Credential.Value) == "") {
		return provider.NewError(provider.ErrorKindCredential, provider.ErrorCodeProviderCredentialUnavailable, errors.New("provider credential is unavailable"))
	}
	return nil
}

func contextWithTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, timeout)
}

func providerEndpoint(baseURL string, path string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	endpointPath := "/" + strings.TrimLeft(strings.TrimSpace(path), "/")
	if endpointPath == "/" {
		endpointPath = ""
	}

	parsedURL, err := url.Parse(baseURL)
	if err == nil && parsedURL.Scheme != "" && parsedURL.Host != "" {
		basePath := strings.TrimRight(parsedURL.Path, "/")
		if basePath == "" || basePath == "/" {
			basePath = "/v1"
		}
		parsedURL.Path = basePath + endpointPath
		parsedURL.RawPath = ""
		parsedURL.RawQuery = ""
		parsedURL.Fragment = ""
		return parsedURL.String()
	}

	if !strings.HasSuffix(baseURL, "/v1") {
		baseURL += "/v1"
	}
	return baseURL + endpointPath
}

func classifyTransportError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.Canceled) {
			return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, ctxErr)
		}
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, ctxErr)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, err)
	}
	return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
}

func classifyStatus(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	drainProviderErrorBody(resp.Body)
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return provider.NewError(provider.ErrorKindUnauthorized, provider.ErrorCodeProviderUnauthorized, fmt.Errorf("provider returned status %d", resp.StatusCode))
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, fmt.Errorf("provider returned status %d", resp.StatusCode))
	default:
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("provider returned status %d", resp.StatusCode))
	}
}

func drainProviderErrorBody(body io.Reader) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
}

type openAIStreamReader struct {
	ctx    context.Context
	cancel context.CancelFunc
	body   io.ReadCloser
	reader *bufio.Reader
	closed bool
}

func (r *openAIStreamReader) Next() (provider.ChatCompletionStreamEvent, error) {
	if r == nil || r.reader == nil {
		return provider.ChatCompletionStreamEvent{}, io.EOF
	}

	for {
		payload, err := r.readEventData()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return provider.ChatCompletionStreamEvent{}, io.EOF
			}
			return provider.ChatCompletionStreamEvent{}, classifyStreamReadError(r.ctx, err)
		}
		payload = strings.TrimSpace(payload)
		if payload == "" {
			continue
		}
		if payload == "[DONE]" {
			return provider.ChatCompletionStreamEvent{}, io.EOF
		}

		raw := json.RawMessage([]byte(payload))
		if !json.Valid(raw) {
			return provider.ChatCompletionStreamEvent{}, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider stream returned malformed json chunk"))
		}

		var metadata struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *provider.Usage `json:"usage"`
		}
		if err := json.Unmarshal(raw, &metadata); err != nil {
			return provider.ChatCompletionStreamEvent{}, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider streaming chunk metadata: %w", err))
		}

		var delta string
		for _, choice := range metadata.Choices {
			if choice.Delta.Content != "" {
				delta = choice.Delta.Content
				break
			}
		}
		if metadata.Usage != nil && metadata.Usage.PromptTokensDetails != nil {
			metadata.Usage.CacheReadInputTokens = metadata.Usage.PromptTokensDetails.CachedTokens
		}
		copied := append(json.RawMessage(nil), raw...)
		return provider.ChatCompletionStreamEvent{
			Data:  copied,
			Delta: delta,
			Usage: metadata.Usage,
		}, nil
	}
}

func (r *openAIStreamReader) Close() error {
	if r == nil || r.closed {
		return nil
	}
	r.closed = true
	if r.cancel != nil {
		r.cancel()
	}
	if r.body != nil {
		return r.body.Close()
	}
	return nil
}

func (r *openAIStreamReader) readEventData() (string, error) {
	var dataLines []string
	for {
		line, err := r.reader.ReadString('\n')
		if err != nil && !errors.Is(err, io.EOF) {
			return "", err
		}

		line = strings.TrimRight(line, "\r\n")
		if strings.TrimSpace(line) == "" {
			if len(dataLines) == 0 && errors.Is(err, io.EOF) {
				return "", io.EOF
			}
			if len(dataLines) > 0 {
				return strings.Join(dataLines, "\n"), nil
			}
			if errors.Is(err, io.EOF) {
				return "", io.EOF
			}
			continue
		}

		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, strings.TrimLeft(line[len("data:"):], " "))
		}

		if errors.Is(err, io.EOF) {
			if len(dataLines) == 0 {
				return "", io.EOF
			}
			return strings.Join(dataLines, "\n"), nil
		}
	}
}

func classifyStreamReadError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.Canceled) {
			return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, ctxErr)
		}
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, ctxErr)
	}
	return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
}
