package openai

import (
	"context"
	"encoding/json"
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
