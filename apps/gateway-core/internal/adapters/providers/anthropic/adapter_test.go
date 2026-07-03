package anthropic

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

func TestCreateChatCompletionTransformsAnthropicMessages(t *testing.T) {
	var captured struct {
		Model     string `json:"model"`
		MaxTokens int    `json:"max_tokens"`
		System    string `json:"system"`
		Messages  []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		Stream      bool     `json:"stream"`
		Temperature *float64 `json:"temperature"`
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("x-api-key") != "synthetic-credential" {
			t.Fatalf("missing provider credential header")
		}
		if r.Header.Get("anthropic-version") != defaultAPIVersion {
			t.Fatalf("unexpected api version: %s", r.Header.Get("anthropic-version"))
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"msg_synthetic_001",
			"type":"message",
			"role":"assistant",
			"model":"claude-synthetic-sonnet",
			"content":[{"type":"text","text":"safe answer"}],
			"stop_reason":"end_turn",
			"usage":{"input_tokens":7,"output_tokens":5}
		}`))
	}))
	defer server.Close()

	temperature := 0.7
	maxTokens := 256
	resp, err := NewAdapter(server.Client()).CreateChatCompletion(t.Context(), executionConfig(server.URL), provider.ChatCompletionRequest{
		RequestID:   "req_synthetic_001",
		Model:       "claude-synthetic-sonnet",
		MaxTokens:   &maxTokens,
		Temperature: &temperature,
		Messages: []provider.ChatMessage{
			{Role: "system", Content: rawString(t, "system guidance")},
			{Role: "user", Content: rawString(t, "hello")},
			{Role: "assistant", Content: rawString(t, "hi")},
			{Role: "user", Content: rawString(t, "continue")},
		},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion returned error: %v", err)
	}

	if captured.Model != "claude-synthetic-sonnet" {
		t.Fatalf("unexpected model: %s", captured.Model)
	}
	if captured.MaxTokens != 256 {
		t.Fatalf("unexpected max tokens: %d", captured.MaxTokens)
	}
	if captured.System != "system guidance" {
		t.Fatalf("unexpected system message: %q", captured.System)
	}
	if len(captured.Messages) != 3 || captured.Messages[0].Role != "user" || captured.Messages[0].Content != "hello" {
		t.Fatalf("unexpected messages: %#v", captured.Messages)
	}
	if captured.Stream {
		t.Fatalf("anthropic non-stream adapter should not request streaming")
	}
	if captured.Temperature == nil || *captured.Temperature != temperature {
		t.Fatalf("unexpected temperature: %v", captured.Temperature)
	}

	if resp.ID != "msg_synthetic_001" || resp.Object != "chat.completion" {
		t.Fatalf("unexpected response identity: %#v", resp)
	}
	if resp.Model != "claude-synthetic-sonnet" {
		t.Fatalf("unexpected response model: %s", resp.Model)
	}
	if len(resp.Choices) != 1 || string(resp.Choices[0].Message.Content) != `"safe answer"` {
		t.Fatalf("unexpected choices: %#v", resp.Choices)
	}
	if resp.Usage == nil || resp.Usage.PromptTokens != 7 || resp.Usage.CompletionTokens != 5 || resp.Usage.TotalTokens != 12 {
		t.Fatalf("unexpected usage: %#v", resp.Usage)
	}
}

func TestCreateChatCompletionMapsUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"type":"authentication_error"}}`))
	}))
	defer server.Close()

	_, err := NewAdapter(server.Client()).CreateChatCompletion(t.Context(), executionConfig(server.URL), provider.ChatCompletionRequest{
		Model:    "claude-synthetic-sonnet",
		Messages: []provider.ChatMessage{{Role: "user", Content: rawString(t, "hello")}},
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if provider.ErrorKindOf(err) != provider.ErrorKindUnauthorized {
		t.Fatalf("unexpected error kind: %s", provider.ErrorKindOf(err))
	}
}

func TestCreateChatCompletionRejectsWrongRequestFormat(t *testing.T) {
	config := executionConfig("http://provider.test")
	config.AdapterConfig.RequestFormat = providercatalog.RequestFormatOpenAIChatCompletions

	_, err := NewAdapter(nil).CreateChatCompletion(t.Context(), config, provider.ChatCompletionRequest{
		Model:    "claude-synthetic-sonnet",
		Messages: []provider.ChatMessage{{Role: "user", Content: rawString(t, "hello")}},
	})
	if err == nil {
		t.Fatal("expected unsupported request format error")
	}
}

func TestToAnthropicRequestRejectsNullOrMissingContent(t *testing.T) {
	tests := []struct {
		name    string
		content json.RawMessage
	}{
		{name: "missing content", content: nil},
		{name: "null content", content: json.RawMessage("null")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := toAnthropicRequest(provider.ChatCompletionRequest{
				Model:    "claude-synthetic-sonnet",
				Messages: []provider.ChatMessage{{Role: "user", Content: tt.content}},
			})
			if err == nil {
				t.Fatal("expected unsupported content error")
			}
			if provider.ErrorKindOf(err) != provider.ErrorKindError {
				t.Fatalf("unexpected error kind: %s", provider.ErrorKindOf(err))
			}
		})
	}
}

func TestListModelsNormalizesAnthropicModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"data":[
				{"id":"claude-synthetic-haiku","type":"model","display_name":"Claude Synthetic Haiku"},
				{"id":"claude-synthetic-sonnet","type":"model","display_name":"Claude Synthetic Sonnet"}
			]
		}`))
	}))
	defer server.Close()

	models, err := NewAdapter(server.Client()).ListModels(t.Context(), executionConfig(server.URL))
	if err != nil {
		t.Fatalf("ListModels returned error: %v", err)
	}
	if models.Object != "list" || len(models.Data) != 2 {
		t.Fatalf("unexpected models: %#v", models)
	}
	if models.Data[0].ID != "claude-synthetic-haiku" || models.Data[0].OwnedBy != "anthropic" {
		t.Fatalf("unexpected first model: %#v", models.Data[0])
	}
}

func TestNormalizeConfigStripsQueryAndFragment(t *testing.T) {
	config := executionConfig("https://api.anthropic.com/v1?region=us#models")
	normalized := normalizeConfig(config)

	if normalized.BaseURL != "https://api.anthropic.com/v1" {
		t.Fatalf("expected BaseURL to be stripped of query and fragment, got: %s", normalized.BaseURL)
	}
}

func TestClassifyTransportErrorChecksReturnedError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want provider.ErrorKind
	}{
		{name: "returned context canceled", err: context.Canceled, want: provider.ErrorKindError},
		{name: "returned deadline exceeded", err: context.DeadlineExceeded, want: provider.ErrorKindTimeout},
		{name: "generic transport error", err: errors.New("transport unavailable"), want: provider.ErrorKindError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := classifyTransportError(context.Background(), tt.err)
			if provider.ErrorKindOf(err) != tt.want {
				t.Fatalf("expected %s, got %s", tt.want, provider.ErrorKindOf(err))
			}
		})
	}
}

func executionConfig(baseURL string) provider.ExecutionConfig {
	return provider.ExecutionConfig{
		ProviderID:         "provider_synthetic_anthropic",
		ProviderName:       "claude-main",
		AdapterType:        providercatalog.AdapterTypeAnthropic,
		BaseURL:            baseURL,
		Timeout:            2 * time.Second,
		CredentialRequired: true,
		Credential:         &provider.ResolvedCredential{Value: "synthetic-credential"},
		AdapterConfig: provider.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatAnthropicMessages,
		},
	}
}

func rawString(t *testing.T, value string) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal raw string: %v", err)
	}
	return encoded
}
