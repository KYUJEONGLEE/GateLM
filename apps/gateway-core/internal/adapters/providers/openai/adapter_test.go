package openai

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

func TestAdapterCreateChatCompletionSendsOpenAICompatibleRequest(t *testing.T) {
	var gotModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") == "" {
			t.Fatal("expected authorization header")
		}
		var request provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotModel = request.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_fake","object":"chat.completion","created":1782108000,"model":"gpt-fake","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`))
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	resp, err := adapter.CreateChatCompletion(context.Background(), executionConfig(server.URL), provider.ChatCompletionRequest{
		RequestID: "request_test",
		Model:     "gpt-fake",
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(`"hello"`),
		}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion returned error: %v", err)
	}
	if gotModel != "gpt-fake" {
		t.Fatalf("expected provider model gpt-fake, got %s", gotModel)
	}
	if resp == nil || resp.Usage == nil || resp.Usage.TotalTokens != 3 {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestAdapterCreateChatCompletionStreamReadsOpenAICompatibleSSE(t *testing.T) {
	var gotStream bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Fatalf("expected event-stream accept header, got %q", r.Header.Get("Accept"))
		}
		var request provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		gotStream = request.Stream
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"created\":1782108000,\"model\":\"gpt-fake\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"안녕\"},\"finish_reason\":null}],\"usage\":null}\n\n"))
		_, _ = w.Write([]byte("data: {\"id\":\"chatcmpl_stream\",\"object\":\"chat.completion.chunk\",\"created\":1782108000,\"model\":\"gpt-fake\",\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3,\"total_tokens\":5}}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	stream, err := adapter.CreateChatCompletionStream(context.Background(), executionConfig(server.URL), minimalRequest())
	if err != nil {
		t.Fatalf("CreateChatCompletionStream returned error: %v", err)
	}
	defer stream.Close()

	if !gotStream {
		t.Fatal("expected upstream request stream=true")
	}

	first, err := stream.Next()
	if err != nil {
		t.Fatalf("read first stream event: %v", err)
	}
	if first.Usage != nil || !json.Valid(first.Data) {
		t.Fatalf("unexpected first event: %+v", first)
	}
	second, err := stream.Next()
	if err != nil {
		t.Fatalf("read usage stream event: %v", err)
	}
	if second.Usage == nil || second.Usage.TotalTokens != 5 {
		t.Fatalf("expected usage chunk, got %+v", second)
	}
	if _, err := stream.Next(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected EOF after DONE, got %v", err)
	}
}

func TestAdapterCreateChatCompletionStreamRejectsMalformedSSEJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {not-json}\n\n"))
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	stream, err := adapter.CreateChatCompletionStream(context.Background(), executionConfig(server.URL), minimalRequest())
	if err != nil {
		t.Fatalf("CreateChatCompletionStream returned error: %v", err)
	}
	defer stream.Close()

	if _, err := stream.Next(); err == nil || provider.SafeErrorCode(err) != provider.ErrorCodeProviderError {
		t.Fatalf("expected safe provider error for malformed stream json, got %v", err)
	}
}

func TestAdapterCreateChatCompletionStreamMapsUnauthorizedStatusToSafeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"raw provider body"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	_, err := adapter.CreateChatCompletionStream(context.Background(), executionConfig(server.URL), minimalRequest())
	if err == nil {
		t.Fatal("expected error")
	}
	if provider.SafeErrorCode(err) != provider.ErrorCodeProviderUnauthorized {
		t.Fatalf("expected unauthorized safe code, got %s", provider.SafeErrorCode(err))
	}
}

func TestAdapterCreateChatCompletionStreamMapsTimeoutToSafeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	config := executionConfig(server.URL)
	config.Timeout = 5 * time.Millisecond
	_, err := adapter.CreateChatCompletionStream(context.Background(), config, minimalRequest())
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if provider.SafeErrorCode(err) != provider.ErrorCodeProviderTimeout {
		t.Fatalf("expected timeout safe code, got %s", provider.SafeErrorCode(err))
	}
}

func TestAdapterCreateChatCompletionStreamDoesNotMapClientCancellationToProviderTimeout(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	adapter := NewAdapter(http.DefaultClient)
	_, err := adapter.CreateChatCompletionStream(ctx, executionConfig("http://127.0.0.1:1"), minimalRequest())
	if err == nil {
		t.Fatal("expected cancellation error")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected wrapped context.Canceled, got %v", err)
	}
	if provider.SafeErrorCode(err) == provider.ErrorCodeProviderTimeout {
		t.Fatalf("client cancellation must not map to %s", provider.ErrorCodeProviderTimeout)
	}
}

func TestAdapterMapsUnauthorizedStatusToSafeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":"raw provider body"}`, http.StatusUnauthorized)
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	_, err := adapter.CreateChatCompletion(context.Background(), executionConfig(server.URL), minimalRequest())
	if err == nil {
		t.Fatal("expected error")
	}
	if provider.SafeErrorCode(err) != provider.ErrorCodeProviderUnauthorized {
		t.Fatalf("expected unauthorized safe code, got %s", provider.SafeErrorCode(err))
	}
}

func TestAdapterMapsTimeoutToSafeError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	adapter := NewAdapter(server.Client())
	config := executionConfig(server.URL)
	config.Timeout = 5 * time.Millisecond
	_, err := adapter.CreateChatCompletion(context.Background(), config, minimalRequest())
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if provider.SafeErrorCode(err) != provider.ErrorCodeProviderTimeout {
		t.Fatalf("expected timeout safe code, got %s", provider.SafeErrorCode(err))
	}
}

func TestAdapterDoesNotMapClientCancellationToProviderTimeout(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	adapter := NewAdapter(http.DefaultClient)
	_, err := adapter.CreateChatCompletion(ctx, executionConfig("http://127.0.0.1:1"), minimalRequest())
	if err == nil {
		t.Fatal("expected cancellation error")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected wrapped context.Canceled, got %v", err)
	}
	if provider.SafeErrorCode(err) == provider.ErrorCodeProviderTimeout {
		t.Fatalf("client cancellation must not map to %s", provider.ErrorCodeProviderTimeout)
	}
}

func TestAdapterRejectsMissingCredentialBeforeHTTPCall(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	config := executionConfig(server.URL)
	config.Credential = nil
	adapter := NewAdapter(server.Client())
	_, err := adapter.CreateChatCompletion(context.Background(), config, minimalRequest())
	if err == nil {
		t.Fatal("expected missing credential error")
	}
	if called {
		t.Fatal("provider must not be called when credential is missing")
	}
	if provider.SafeErrorCode(err) != provider.ErrorCodeProviderCredentialUnavailable {
		t.Fatalf("expected credential safe code, got %s", provider.SafeErrorCode(err))
	}
}

func executionConfig(baseURL string) provider.ExecutionConfig {
	return provider.ExecutionConfig{
		AdapterType:        providercatalog.AdapterTypeOpenAICompatible,
		BaseURL:            baseURL,
		Timeout:            time.Second,
		CredentialRequired: true,
		Credential:         &provider.ResolvedCredential{Value: "test-provider-key"},
		AdapterConfig: provider.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatOpenAIChatCompletions,
		},
	}
}

func minimalRequest() provider.ChatCompletionRequest {
	return provider.ChatCompletionRequest{
		RequestID: "request_test",
		Model:     "gpt-fake",
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(`"hello"`),
		}},
	}
}
