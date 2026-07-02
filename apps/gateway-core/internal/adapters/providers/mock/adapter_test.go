package mock

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/provider"
)

func TestAdapterCreateChatCompletionStreamReadsMockProviderSSE(t *testing.T) {
	var sawStream bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Fatalf("expected event-stream accept header, got %q", r.Header.Get("Accept"))
		}
		if r.Header.Get("X-GateLM-Request-Id") != "request_mock_stream" {
			t.Fatalf("expected request id header, got %q", r.Header.Get("X-GateLM-Request-Id"))
		}

		var req provider.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if !req.Stream {
			t.Fatal("expected upstream mock request stream=true")
		}
		sawStream = true

		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		fmt.Fprint(w, `data: {"id":"mock_stream","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"로컬 mock streaming"},"finish_reason":null}]}`+"\n\n")
		fmt.Fprint(w, `data: {"id":"mock_stream","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	stream, err := NewAdapter(server.URL, server.Client()).CreateChatCompletionStream(context.Background(), provider.ExecutionConfig{}, provider.ChatCompletionRequest{
		RequestID: "request_mock_stream",
		Model:     "mock-balanced",
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(`"안녕하세요"`),
		}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletionStream returned error: %v", err)
	}
	defer stream.Close()

	first, err := stream.Next()
	if err != nil {
		t.Fatalf("first stream event failed: %v", err)
	}
	if !strings.Contains(string(first.Data), "로컬 mock streaming") {
		t.Fatalf("unexpected first event: %s", string(first.Data))
	}

	second, err := stream.Next()
	if err != nil {
		t.Fatalf("second stream event failed: %v", err)
	}
	if second.Usage == nil || second.Usage.TotalTokens != 5 {
		t.Fatalf("expected usage from final chunk, got %+v", second.Usage)
	}

	if _, err := stream.Next(); !errors.Is(err, io.EOF) {
		t.Fatalf("expected EOF after DONE, got %v", err)
	}
	if !sawStream {
		t.Fatal("mock provider did not receive stream=true request")
	}
}

func TestAdapterCreateChatCompletionStreamRemovesOnlyOneSpaceAfterDataPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		fmt.Fprint(w, `data:  {"id":"mock_stream","object":"chat.completion.chunk","created":1782108000,"model":"mock-balanced","choices":[{"index":0,"delta":{"content":"leading space"},"finish_reason":null}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	stream, err := NewAdapter(server.URL, server.Client()).CreateChatCompletionStream(context.Background(), provider.ExecutionConfig{}, provider.ChatCompletionRequest{
		RequestID: "request_mock_stream_space",
		Model:     "mock-balanced",
	})
	if err != nil {
		t.Fatalf("CreateChatCompletionStream returned error: %v", err)
	}
	defer stream.Close()

	event, err := stream.Next()
	if err != nil {
		t.Fatalf("stream event failed: %v", err)
	}
	if !strings.HasPrefix(string(event.Data), " ") {
		t.Fatalf("expected one leading payload space to be preserved, got %q", string(event.Data))
	}
}

func TestAdapterCreateChatCompletionStreamMapsProviderStatusSafely(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "raw provider body must not be surfaced", http.StatusGatewayTimeout)
	}))
	defer server.Close()

	_, err := NewAdapter(server.URL, server.Client()).CreateChatCompletionStream(context.Background(), provider.ExecutionConfig{}, provider.ChatCompletionRequest{
		RequestID: "request_mock_stream_timeout",
		Model:     "mock-balanced",
	})
	if err == nil {
		t.Fatal("expected streaming status error")
	}
	if got := provider.SafeErrorCode(err); got != provider.ErrorCodeProviderTimeout {
		t.Fatalf("expected provider_timeout, got %q err=%v", got, err)
	}
	if strings.Contains(err.Error(), "raw provider body") {
		t.Fatalf("provider raw error body leaked: %v", err)
	}
}

func TestClassifyMockTransportAndReadErrorsPreserveCancellationAndTimeout(t *testing.T) {
	cancelErr := fmt.Errorf("wrapped cancellation: %w", context.Canceled)
	if err := classifyMockTransportError(context.Background(), cancelErr); !errors.Is(err, context.Canceled) {
		t.Fatalf("transport cancellation must be preserved, got %v", err)
	}
	if err := classifyMockStreamReadError(context.Background(), cancelErr); !errors.Is(err, context.Canceled) {
		t.Fatalf("stream read cancellation must be preserved, got %v", err)
	}

	timeoutErr := fmt.Errorf("wrapped timeout: %w", context.DeadlineExceeded)
	if err := classifyMockTransportError(context.Background(), timeoutErr); provider.SafeErrorCode(err) != provider.ErrorCodeProviderTimeout {
		t.Fatalf("transport deadline must map to provider timeout, got %s err=%v", provider.SafeErrorCode(err), err)
	}
	if err := classifyMockStreamReadError(context.Background(), timeoutErr); provider.SafeErrorCode(err) != provider.ErrorCodeProviderTimeout {
		t.Fatalf("stream read deadline must map to provider timeout, got %s err=%v", provider.SafeErrorCode(err), err)
	}
}
