package mock

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/provider"
)

func TestCreateChatCompletionClassifiesTimeoutStatus(t *testing.T) {
	err := exerciseChatCompletionStatus(t, http.StatusGatewayTimeout)

	var providerErr *provider.Error
	if !errors.As(err, &providerErr) {
		t.Fatalf("expected provider error, got %T: %v", err, err)
	}
	if providerErr.Kind != provider.ErrorKindTimeout || providerErr.Code != provider.ErrorCodeProviderTimeout {
		t.Fatalf("expected provider timeout, got kind=%s code=%s", providerErr.Kind, providerErr.Code)
	}
}

func TestCreateChatCompletionClassifiesGenericErrorStatus(t *testing.T) {
	err := exerciseChatCompletionStatus(t, http.StatusInternalServerError)

	var providerErr *provider.Error
	if !errors.As(err, &providerErr) {
		t.Fatalf("expected provider error, got %T: %v", err, err)
	}
	if providerErr.Kind != provider.ErrorKindError || providerErr.Code != provider.ErrorCodeProviderError {
		t.Fatalf("expected provider error, got kind=%s code=%s", providerErr.Kind, providerErr.Code)
	}
}

func exerciseChatCompletionStatus(t *testing.T, statusCode int) error {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(`{"error":{"code":"synthetic_failure"}}`))
	}))
	t.Cleanup(server.Close)

	adapter := NewAdapter(server.URL, server.Client())
	_, err := adapter.CreateChatCompletion(context.Background(), provider.ExecutionConfig{}, provider.ChatCompletionRequest{
		RequestID: "request_mock_adapter_status_test",
		Model:     "mock-fast",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	return err
}
