package provider

import (
	"context"
	"io"
	"strings"
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

func TestStreamingAdapterIsOptionalProviderBoundary(t *testing.T) {
	var legacy Adapter = registryTestAdapter{name: "legacy"}
	if _, ok := legacy.(StreamingAdapter); ok {
		t.Fatal("plain provider adapter must not be required to implement streaming")
	}

	streamingAdapter := streamingRegistryTestAdapter{registryTestAdapter: registryTestAdapter{name: "streaming"}}
	registry := NewRegistry("streaming", streamingAdapter)

	got, err := registry.Get("streaming")
	if err != nil {
		t.Fatalf("get streaming adapter: %v", err)
	}
	streaming, ok := got.(StreamingAdapter)
	if !ok {
		t.Fatal("stream-capable provider should expose the optional streaming boundary")
	}

	stream, err := streaming.CreateChatCompletionStream(context.Background(), ChatCompletionRequest{Model: "mock-balanced"})
	if err != nil {
		t.Fatalf("create stream: %v", err)
	}
	defer stream.Close()

	frame, err := stream.Recv(context.Background())
	if err != nil {
		t.Fatalf("recv stream frame: %v", err)
	}
	if !strings.Contains(string(frame.Payload), "data:") {
		t.Fatalf("expected SSE pass-through payload, got %q", frame.Payload)
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

type streamingRegistryTestAdapter struct {
	registryTestAdapter
}

func (a streamingRegistryTestAdapter) CreateChatCompletionStream(ctx context.Context, req ChatCompletionRequest) (ChatCompletionStream, error) {
	return NewReadCloserStream(io.NopCloser(strings.NewReader("data: {}\n\n"))), nil
}
