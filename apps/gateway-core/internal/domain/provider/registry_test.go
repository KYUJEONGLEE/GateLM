package provider

import (
	"context"
	"testing"
)

func TestRegistryRegisterInitializesZeroValueAdapters(t *testing.T) {
	var registry Registry
	adapter := registryTestAdapter{name: "mock"}

	registry.Register(adapter)

	got, err := registry.Get("mock")
	if err != nil {
		t.Fatalf("get registered adapter: %v", err)
	}
	if got.AdapterType() != "mock" {
		t.Fatalf("unexpected adapter type: %s", got.AdapterType())
	}
}

type registryTestAdapter struct {
	name string
}

func (a registryTestAdapter) AdapterType() string {
	return a.name
}

func (a registryTestAdapter) ListModels(ctx context.Context, config ExecutionConfig) (*ModelListResponse, error) {
	return &ModelListResponse{}, nil
}

func (a registryTestAdapter) CreateChatCompletion(ctx context.Context, config ExecutionConfig, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	return &ChatCompletionResponse{}, nil
}
