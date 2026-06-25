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
	if got.Name() != "mock" {
		t.Fatalf("unexpected adapter name: %s", got.Name())
	}
}

type registryTestAdapter struct {
	name string
}

func (a registryTestAdapter) Name() string {
	return a.name
}

func (a registryTestAdapter) ListModels(ctx context.Context) (*ModelListResponse, error) {
	return &ModelListResponse{}, nil
}

func (a registryTestAdapter) CreateChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error) {
	return &ChatCompletionResponse{}, nil
}
