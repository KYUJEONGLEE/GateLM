//go:build live

package openai

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/provider"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
)

func TestLiveOpenAIChatCompletionOptIn(t *testing.T) {
	if os.Getenv("GATELM_ENABLE_LIVE_PROVIDER_TESTS") != "1" {
		t.Skip("live provider smoke is opt-in because it can incur provider cost")
	}
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY is required for live provider smoke")
	}

	modelName := strings.TrimSpace(os.Getenv("GATELM_LIVE_OPENAI_MODEL_NAME"))
	if modelName == "" {
		modelName = "gpt-4o-mini"
	}

	adapter := NewAdapter(nil)
	resp, err := adapter.CreateChatCompletion(context.Background(), provider.ExecutionConfig{
		AdapterType:        providercatalog.AdapterTypeOpenAICompatible,
		BaseURL:            firstNonEmpty(os.Getenv("GATELM_LIVE_OPENAI_BASE_URL"), "https://api.openai.com/v1"),
		Timeout:            15 * time.Second,
		CredentialRequired: true,
		Credential:         &provider.ResolvedCredential{Value: apiKey},
		AdapterConfig: provider.AdapterConfig{
			RequestFormat: providercatalog.RequestFormatOpenAIChatCompletions,
		},
	}, provider.ChatCompletionRequest{
		RequestID: "request_live_openai_smoke",
		Model:     modelName,
		Messages: []provider.ChatMessage{{
			Role:    "user",
			Content: json.RawMessage(`"Reply with exactly: GateLM live smoke ok"`),
		}},
		MaxTokens: intPointer(16),
	})
	if err != nil {
		t.Fatalf("live provider smoke failed with safe code %s: %v", provider.SafeErrorCode(err), err)
	}
	if resp == nil || len(resp.Choices) == 0 {
		t.Fatal("live provider smoke returned an empty response")
	}
}

func intPointer(value int) *int {
	return &value
}
