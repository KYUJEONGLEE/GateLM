package openai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/provider"
)

func TestAdapterCreateChatCompletionSuccessUsesInternalAuthorization(t *testing.T) {
	transport := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", req.URL.Path)
		}
		if req.Header.Get("Authorization") != "Bearer test-provider-key" {
			t.Fatalf("missing provider authorization header")
		}
		if req.Header.Get("X-GateLM-Request-Id") != "req_openai_success" {
			t.Fatalf("missing request id header")
		}
		return jsonResponse(http.StatusOK, provider.ChatCompletionResponse{
			ID:      "chatcmpl_openai_test",
			Object:  "chat.completion",
			Created: 1782108000,
			Model:   "gpt-test-low-cost",
			Choices: []provider.ChatChoice{
				{
					Index: 0,
					Message: provider.ChatMessage{
						Role:    "assistant",
						Content: json.RawMessage(`"OpenAI-compatible response"`),
					},
					FinishReason: "stop",
				},
			},
			Usage: &provider.Usage{
				PromptTokens:     3,
				CompletionTokens: 4,
				TotalTokens:      7,
			},
		}), nil
	})
	adapter := NewAdapter("openai", "https://provider.test", "test-provider-key", &http.Client{Transport: transport})

	resp, err := adapter.CreateChatCompletion(context.Background(), provider.ChatCompletionRequest{
		RequestID: "req_openai_success",
		Model:     "gpt-test-low-cost",
		Messages: []provider.ChatMessage{
			{Role: "user", Content: json.RawMessage(`"Hello"`)}},
	})

	if err != nil {
		t.Fatalf("expected success, got %v", err)
	}
	if resp == nil || resp.ID != "chatcmpl_openai_test" || resp.Usage.TotalTokens != 7 {
		t.Fatalf("unexpected response: %#v", resp)
	}
	if resp.Raw != nil {
		t.Fatalf("adapter must not retain provider raw response body")
	}
}

func TestAdapterSanitizesProviderErrorBody(t *testing.T) {
	const rawBody = `{"error":{"message":"provider raw detail should stay hidden","code":"too_much_detail"}}`
	adapter := NewAdapter("openai", "https://provider.test", "test-provider-key", &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return stringResponse(http.StatusUnauthorized, rawBody), nil
		}),
	})

	_, err := adapter.CreateChatCompletion(context.Background(), provider.ChatCompletionRequest{
		RequestID: "req_openai_unauthorized",
		Model:     "gpt-test-low-cost",
		Messages: []provider.ChatMessage{
			{Role: "user", Content: json.RawMessage(`"Hello"`)}},
	})

	if err == nil {
		t.Fatalf("expected provider failure")
	}
	failure := provider.ClassifyFailure(err)
	if failure.Kind != provider.FailureKindUnauthorized || failure.SanitizedCode() != "provider_unauthorized" {
		t.Fatalf("unexpected provider failure: %#v", failure)
	}
	if strings.Contains(err.Error(), "provider raw detail") || strings.Contains(err.Error(), "too_much_detail") {
		t.Fatalf("provider raw error body leaked through error: %q", err.Error())
	}
}

func TestAdapterClassifiesTransportTimeout(t *testing.T) {
	adapter := NewAdapter("openai", "https://provider.test", "test-provider-key", &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			return nil, context.DeadlineExceeded
		}),
	})

	_, err := adapter.ListModels(context.Background())

	if err == nil {
		t.Fatalf("expected timeout")
	}
	failure := provider.ClassifyFailure(err)
	if failure.Kind != provider.FailureKindTimeout || failure.SanitizedCode() != "provider_timeout" {
		t.Fatalf("unexpected provider failure: %#v", failure)
	}
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	if f == nil {
		return nil, errors.New("missing round trip function")
	}
	return f(req)
}

func jsonResponse(status int, value any) *http.Response {
	body, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return stringResponse(status, string(body))
}

func stringResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       ioReadCloser{Reader: strings.NewReader(body)},
	}
}

type ioReadCloser struct {
	*strings.Reader
}

func (c ioReadCloser) Close() error {
	return nil
}
