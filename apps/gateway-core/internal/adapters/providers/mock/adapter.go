package mock

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
		return nil, fmt.Errorf("mock provider models returned status %d", resp.StatusCode)
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
		return nil, fmt.Errorf("mock provider chat completion returned status %d", resp.StatusCode)
	}

	var completion provider.ChatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&completion); err != nil {
		return nil, fmt.Errorf("decode mock provider chat response: %w", err)
	}

	return &completion, nil
}

func (a *Adapter) CreateChatCompletionStream(ctx context.Context, config provider.ExecutionConfig, req provider.ChatCompletionRequest) (provider.ChatCompletionStreamReader, error) {
	req.Stream = true
	body, err := json.Marshal(req)
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("encode mock provider streaming chat request: %w", err))
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, providerEndpoint(firstNonEmpty(config.BaseURL, a.baseURL), "/chat/completions"), bytes.NewReader(body))
	if err != nil {
		return nil, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("build mock provider streaming chat request: %w", err))
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("X-GateLM-Request-Id", req.RequestID)

	resp, err := a.httpClient.Do(httpReq)
	if err != nil {
		return nil, classifyMockTransportError(ctx, err)
	}
	if err := classifyMockStatus(resp); err != nil {
		resp.Body.Close()
		return nil, err
	}

	return &mockStreamReader{
		ctx:    ctx,
		body:   resp.Body,
		reader: bufio.NewReader(resp.Body),
	}, nil
}

type mockStreamReader struct {
	ctx    context.Context
	body   io.ReadCloser
	reader *bufio.Reader
	closed bool
}

func (r *mockStreamReader) Next() (provider.ChatCompletionStreamEvent, error) {
	if r == nil || r.reader == nil {
		return provider.ChatCompletionStreamEvent{}, io.EOF
	}

	for {
		payload, err := r.readEventData()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return provider.ChatCompletionStreamEvent{}, io.EOF
			}
			return provider.ChatCompletionStreamEvent{}, classifyMockStreamReadError(r.ctx, err)
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
			return provider.ChatCompletionStreamEvent{}, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, errors.New("mock provider stream returned malformed json chunk"))
		}

		var metadata struct {
			Usage *provider.Usage `json:"usage"`
		}
		if err := json.Unmarshal(raw, &metadata); err != nil {
			return provider.ChatCompletionStreamEvent{}, provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("decode mock provider streaming chunk metadata: %w", err))
		}

		copied := append(json.RawMessage(nil), raw...)
		return provider.ChatCompletionStreamEvent{
			Data:  copied,
			Usage: metadata.Usage,
		}, nil
	}
}

func (r *mockStreamReader) Close() error {
	if r == nil || r.closed {
		return nil
	}
	r.closed = true
	if r.body != nil {
		return r.body.Close()
	}
	return nil
}

func (r *mockStreamReader) readEventData() (string, error) {
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

func classifyMockStatus(resp *http.Response) error {
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	drainMockProviderErrorBody(resp.Body)
	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden:
		return provider.NewError(provider.ErrorKindUnauthorized, provider.ErrorCodeProviderUnauthorized, fmt.Errorf("mock provider returned status %d", resp.StatusCode))
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, fmt.Errorf("mock provider returned status %d", resp.StatusCode))
	default:
		return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, fmt.Errorf("mock provider returned status %d", resp.StatusCode))
	}
}

func classifyMockTransportError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.Canceled) {
			return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, ctxErr)
		}
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, ctxErr)
	}
	return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
}

func classifyMockStreamReadError(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.Canceled) {
			return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, ctxErr)
		}
		return provider.NewError(provider.ErrorKindTimeout, provider.ErrorCodeProviderTimeout, ctxErr)
	}
	return provider.NewError(provider.ErrorKindError, provider.ErrorCodeProviderError, err)
}

func drainMockProviderErrorBody(body io.Reader) {
	if body == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(body, 4096))
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
