package anthropic

import (
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

const (
	adapterType       = providercatalog.AdapterTypeAnthropic
	defaultAPIVersion = "2023-06-01"
	defaultMaxTokens  = 1024
)

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

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodGet, providerEndpoint(config.BaseURL, "/models"), nil)
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider models request: %w", err))
	}
	setAnthropicHeaders(httpReq, config, false, "")

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, classifyTransportError(reqCtx, err)
	}
	defer resp.Body.Close()

	if err := classifyStatus(resp); err != nil {
		return nil, err
	}

	var payload anthropicModelListResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider models response: %w", err))
	}

	return payload.toGateLM(), nil
}

func (a *Adapter) CreateChatCompletion(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (*provider.ChatCompletionResponse, error) {
	config = normalizeConfig(config)
	if err := validateConfig(config, true); err != nil {
		return nil, err
	}

	anthropicReq, err := toAnthropicRequest(req)
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(anthropicReq)
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("encode provider chat request: %w", err))
	}

	reqCtx, cancel := contextWithTimeout(ctx, config.Timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, providerEndpoint(config.BaseURL, "/messages"), bytes.NewReader(body))
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build provider chat request: %w", err))
	}
	setAnthropicHeaders(httpReq, config, true, req.RequestID)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, classifyTransportError(reqCtx, err)
	}
	defer resp.Body.Close()

	if err := classifyStatus(resp); err != nil {
		return nil, err
	}

	var completion anthropicMessageResponse
	if err := json.NewDecoder(resp.Body).Decode(&completion); err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode provider chat response: %w", err))
	}

	return completion.toGateLM(req.Model)
}

type anthropicRequest struct {
	Model       string             `json:"model"`
	MaxTokens   int                `json:"max_tokens"`
	Messages    []anthropicMessage `json:"messages"`
	System      string             `json:"system,omitempty"`
	Temperature *float64           `json:"temperature,omitempty"`
	Stream      bool               `json:"stream,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicMessageResponse struct {
	ID         string                  `json:"id"`
	Type       string                  `json:"type"`
	Role       string                  `json:"role"`
	Model      string                  `json:"model"`
	Content    []anthropicContentBlock `json:"content"`
	StopReason string                  `json:"stop_reason"`
	Usage      *anthropicUsage         `json:"usage"`
}

type anthropicContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type anthropicUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}

type anthropicModelListResponse struct {
	Data []anthropicModelInfo `json:"data"`
}

type anthropicModelInfo struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
}

func toAnthropicRequest(req provider.ChatCompletionRequest) (anthropicRequest, error) {
	messages := make([]anthropicMessage, 0, len(req.Messages))
	systemParts := []string{}

	for _, message := range req.Messages {
		text, err := textContent(message.Content)
		if err != nil {
			return anthropicRequest{}, err
		}

		role, err := anthropicRole(message.Role)
		if err != nil {
			return anthropicRequest{}, err
		}

		if role == "system" {
			if strings.TrimSpace(text) != "" {
				systemParts = append(systemParts, text)
			}
			continue
		}

		messages = append(messages, anthropicMessage{
			Role:    role,
			Content: text,
		})
	}

	if len(messages) == 0 {
		return anthropicRequest{}, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("anthropic messages request requires at least one user or assistant message"))
	}

	maxTokens := defaultMaxTokens
	if req.MaxTokens != nil && *req.MaxTokens > 0 {
		maxTokens = *req.MaxTokens
	}

	var temperature *float64
	if req.Temperature != nil && *req.Temperature >= 0 && *req.Temperature <= 1 {
		temperature = req.Temperature
	}

	return anthropicRequest{
		Model:       strings.TrimSpace(req.Model),
		MaxTokens:   maxTokens,
		Messages:    messages,
		System:      strings.Join(systemParts, "\n\n"),
		Temperature: temperature,
		Stream:      false,
	}, nil
}

func textContent(raw json.RawMessage) (string, error) {
	if len(bytes.TrimSpace(raw)) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return "", provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("invalid_request_error: null or missing message content is not supported"))
	}

	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text, nil
	}

	var blocks []json.RawMessage
	if err := json.Unmarshal(raw, &blocks); err == nil {
		parts := make([]string, 0, len(blocks))
		for _, block := range blocks {
			var item struct {
				Type string `json:"type"`
				Text string `json:"text"`
			}
			if err := json.Unmarshal(block, &item); err == nil && (item.Type == "" || item.Type == "text") {
				parts = append(parts, item.Text)
				continue
			}

			var itemText string
			if err := json.Unmarshal(block, &itemText); err == nil {
				parts = append(parts, itemText)
				continue
			}
		}
		if len(parts) > 0 {
			return strings.Join(parts, ""), nil
		}
	}

	var object struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &object); err == nil && object.Text != "" {
		return object.Text, nil
	}

	return "", provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("anthropic adapter supports text-only chat content"))
}

func anthropicRole(role string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case "system", "developer":
		return "system", nil
	case "user":
		return "user", nil
	case "assistant":
		return "assistant", nil
	default:
		return "", provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("anthropic adapter received an unsupported message role"))
	}
}

func (r anthropicMessageResponse) toGateLM(requestedModel string) (*provider.ChatCompletionResponse, error) {
	content, err := jsonString(r.text())
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("encode normalized provider response: %w", err))
	}

	model := firstNonEmpty(r.Model, requestedModel)
	resp := &provider.ChatCompletionResponse{
		ID:      firstNonEmpty(r.ID, "chatcmpl_anthropic"),
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   model,
		Choices: []provider.ChatChoice{{
			Index: 0,
			Message: provider.ChatMessage{
				Role:    firstNonEmpty(r.Role, "assistant"),
				Content: content,
			},
			FinishReason: finishReason(r.StopReason),
		}},
	}

	if r.Usage != nil {
		resp.Usage = &provider.Usage{
			PromptTokens:     r.Usage.InputTokens,
			CompletionTokens: r.Usage.OutputTokens,
			TotalTokens:      r.Usage.InputTokens + r.Usage.OutputTokens,
		}
	}

	return resp, nil
}

func (r anthropicMessageResponse) text() string {
	parts := make([]string, 0, len(r.Content))
	for _, block := range r.Content {
		if block.Type == "" || block.Type == "text" {
			parts = append(parts, block.Text)
		}
	}
	return strings.Join(parts, "")
}

func (r anthropicModelListResponse) toGateLM() *provider.ModelListResponse {
	models := make([]provider.ModelInfo, 0, len(r.Data))
	for _, model := range r.Data {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		models = append(models, provider.ModelInfo{
			ID:      id,
			Object:  firstNonEmpty(model.Type, "model"),
			OwnedBy: "anthropic",
		})
	}
	return &provider.ModelListResponse{
		Object: "list",
		Data:   models,
	}
}

func normalizeConfig(config provider.ExecutionConfig) provider.ExecutionConfig {
	config.ProviderID = strings.TrimSpace(config.ProviderID)
	config.ProviderName = strings.TrimSpace(config.ProviderName)
	config.AdapterType = strings.TrimSpace(config.AdapterType)
	baseURL := strings.TrimSpace(config.BaseURL)
	if parsedURL, err := url.Parse(baseURL); err == nil {
		parsedURL.RawQuery = ""
		parsedURL.Fragment = ""
		baseURL = parsedURL.String()
	}
	config.BaseURL = strings.TrimRight(baseURL, "/")
	config.AdapterConfig.RequestFormat = strings.TrimSpace(config.AdapterConfig.RequestFormat)
	config.AdapterConfig.APIVersion = strings.TrimSpace(config.AdapterConfig.APIVersion)
	return config
}

func validateConfig(config provider.ExecutionConfig, requireCredential bool) error {
	if config.BaseURL == "" {
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("provider base URL is missing"))
	}
	if config.AdapterConfig.RequestFormat != "" &&
		config.AdapterConfig.RequestFormat != providercatalog.RequestFormatAnthropicMessages {
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

func setAnthropicHeaders(req *http.Request, config provider.ExecutionConfig, jsonBody bool, requestID string) {
	if jsonBody {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("anthropic-version", firstNonEmpty(config.AdapterConfig.APIVersion, defaultAPIVersion))
	if config.Credential != nil && strings.TrimSpace(config.Credential.Value) != "" {
		req.Header.Set("x-api-key", config.Credential.Value)
	}
	if strings.TrimSpace(requestID) != "" {
		req.Header.Set("X-GateLM-Request-Id", requestID)
	}
}

func classifyTransportError(ctx context.Context, err error) error {
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, context.Canceled)
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, context.DeadlineExceeded)
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

func jsonString(value string) (json.RawMessage, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(encoded), nil
}

func finishReason(reason string) string {
	switch strings.TrimSpace(strings.ToLower(reason)) {
	case "max_tokens":
		return "length"
	case "end_turn", "stop_sequence", "":
		return "stop"
	default:
		return "stop"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
