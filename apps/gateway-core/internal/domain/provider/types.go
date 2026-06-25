package provider

import (
	"context"
	"encoding/json"
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
	RequestedModel   string `json:"requestedModel"`
	SelectedProvider string `json:"selectedProvider"`
	SelectedModel    string `json:"selectedModel"`
	CacheStatus      string `json:"cacheStatus"`
	RoutingReason    string `json:"routingReason,omitempty"`
	MaskingAction    string `json:"maskingAction"`
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
