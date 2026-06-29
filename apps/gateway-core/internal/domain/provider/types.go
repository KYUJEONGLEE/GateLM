package provider

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

type ChatMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type ChatCompletionRequest struct {
	RequestID   string          `json:"-"`
	Model       string          `json:"model"`
	Messages    []ChatMessage   `json:"messages"`
	Temperature *float64        `json:"temperature,omitempty"`
	MaxTokens   *int            `json:"max_tokens,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Metadata    json.RawMessage `json:"metadata,omitempty"`
	GateLM      json.RawMessage `json:"gate_lm,omitempty"`
}

type ChatCompletionResponse struct {
	ID      string           `json:"id"`
	Object  string           `json:"object"`
	Created int64            `json:"created"`
	Model   string           `json:"model"`
	Choices []ChatChoice     `json:"choices"`
	Usage   *Usage           `json:"usage,omitempty"`
	GateLM  *GateLMMetadata  `json:"gate_lm,omitempty"`
	Raw     *json.RawMessage `json:"-"`
}

type ChatChoice struct {
	Index        int         `json:"index"`
	Message      ChatMessage `json:"message"`
	FinishReason string      `json:"finish_reason"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type GateLMMetadata struct {
	RequestID        string `json:"requestId"`
	TenantID         string `json:"tenantId,omitempty"`
	ProjectID        string `json:"projectId,omitempty"`
	ApplicationID    string `json:"applicationId,omitempty"`
	RequestedModel   string `json:"requestedModel"`
	SelectedProvider string `json:"selectedProvider"`
	SelectedModel    string `json:"selectedModel"`
	CacheStatus      string `json:"cacheStatus"`
	RoutingReason    string `json:"routingReason,omitempty"`
	MaskingAction    string `json:"maskingAction"`
	EstimatedCostUSD string `json:"estimatedCostUsd,omitempty"`
	LatencyMs        int64  `json:"latencyMs"`
}

type ModelListResponse struct {
	Object string      `json:"object"`
	Data   []ModelInfo `json:"data"`
}

type ModelInfo struct {
	ID      string          `json:"id"`
	Object  string          `json:"object"`
	Created int64           `json:"created,omitempty"`
	OwnedBy string          `json:"owned_by"`
	GateLM  json.RawMessage `json:"gate_lm,omitempty"`
}

type Adapter interface {
	Name() string
	ListModels(ctx context.Context) (*ModelListResponse, error)
	CreateChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error)
}

type StreamingAdapter interface {
	CreateChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (ChatCompletionStream, error)
}

type ChatCompletionStream interface {
	Recv(ctx context.Context) (ChatCompletionStreamFrame, error)
	Close() error
}

type ChatCompletionStreamFrame struct {
	Payload []byte
}

func NewReadCloserStream(body io.ReadCloser) ChatCompletionStream {
	return &readCloserStream{
		reader: bufio.NewReader(body),
		body:   body,
	}
}

type readCloserStream struct {
	reader *bufio.Reader
	body   io.ReadCloser
}

func (s *readCloserStream) Recv(ctx context.Context) (ChatCompletionStreamFrame, error) {
	if s == nil || s.reader == nil {
		return ChatCompletionStreamFrame{}, io.EOF
	}
	select {
	case <-ctx.Done():
		return ChatCompletionStreamFrame{}, ctx.Err()
	default:
	}

	payload, err := s.reader.ReadBytes('\n')
	if len(payload) > 0 {
		return ChatCompletionStreamFrame{Payload: payload}, nil
	}
	if err != nil {
		return ChatCompletionStreamFrame{}, err
	}
	return ChatCompletionStreamFrame{}, nil
}

func (s *readCloserStream) Close() error {
	if s == nil || s.body == nil {
		return nil
	}
	return s.body.Close()
}

type FailureKind string

const (
	FailureKindError        FailureKind = "error"
	FailureKindTimeout      FailureKind = "timeout"
	FailureKindUnauthorized FailureKind = "unauthorized"
)

type ProviderError struct {
	Kind       FailureKind
	StatusCode int
	Op         string
}

func (e ProviderError) Error() string {
	switch e.Kind {
	case FailureKindTimeout:
		return "provider request timed out"
	case FailureKindUnauthorized:
		return "provider request was unauthorized"
	default:
		return "provider request failed"
	}
}

func (e ProviderError) SanitizedCode() string {
	switch e.Kind {
	case FailureKindTimeout:
		return "provider_timeout"
	case FailureKindUnauthorized:
		return "provider_unauthorized"
	default:
		return "provider_error"
	}
}

func NewFailure(kind FailureKind, statusCode int, op string) ProviderError {
	if kind == "" {
		kind = FailureKindError
	}
	return ProviderError{Kind: kind, StatusCode: statusCode, Op: op}
}

func FailureFromHTTPStatus(statusCode int, op string) ProviderError {
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return NewFailure(FailureKindUnauthorized, statusCode, op)
	case statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout:
		return NewFailure(FailureKindTimeout, statusCode, op)
	default:
		return NewFailure(FailureKindError, statusCode, op)
	}
}

func ClassifyFailure(err error) ProviderError {
	var providerErr ProviderError
	if errors.As(err, &providerErr) {
		return providerErr
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return NewFailure(FailureKindTimeout, 0, "")
	}
	return NewFailure(FailureKindError, 0, "")
}
