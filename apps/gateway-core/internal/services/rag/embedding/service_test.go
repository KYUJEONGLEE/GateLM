package embedding

import (
	"context"
	"errors"
	"math"
	"testing"

	embeddingdomain "gatelm/apps/gateway-core/internal/domain/embedding"
	"gatelm/apps/gateway-core/internal/domain/ragembedding"
)

type fakeProvider struct {
	result  embeddingdomain.Result
	err     error
	request embeddingdomain.Request
	calls   int
}

func (p *fakeProvider) ProviderName() string { return embeddingdomain.ProviderOpenAI }

func (p *fakeProvider) Embed(_ context.Context, request embeddingdomain.Request) (embeddingdomain.Result, error) {
	p.calls++
	p.request = request
	return p.result, p.err
}

func TestServiceEmbedsSingleAndBatchWithFixedProfile(t *testing.T) {
	for _, inputs := range [][]string{{"query"}, {"first", "second"}} {
		provider := &fakeProvider{result: embeddingdomain.Result{
			Vectors: makeVectors(len(inputs), 1536), Model: "text-embedding-3-large",
			Usage: embeddingdomain.Usage{PromptTokens: len(inputs), TotalTokens: len(inputs)},
		}}
		service := newTestService(t, provider)
		request := ragembedding.Request{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: inputs}
		response, err := service.Embed(context.Background(), testScope(t, ragembedding.PurposeQuery), request)
		if err != nil {
			t.Fatalf("embed %d inputs: %v", len(inputs), err)
		}
		if len(response.Embeddings) != len(inputs) || response.Usage.InputCount != len(inputs) ||
			response.Provider != "openai" || response.Model != "text-embedding-3-large" ||
			response.Dimensions != 1536 || response.ProfileVersion != 1 {
			t.Fatalf("unexpected response: %#v", response)
		}
		if provider.request.Model != "text-embedding-3-large" || provider.request.Dimensions != 1536 {
			t.Fatalf("provider did not receive fixed profile: %#v", provider.request)
		}
	}
}

func TestServiceRejectsLimitsBeforeProvider(t *testing.T) {
	provider := &fakeProvider{}
	service := newTestService(t, provider)
	tests := []ragembedding.Request{
		{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1},
		{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: []string{""}},
		{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: []string{string([]byte{0xff})}},
		{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: []string{"123456789"}},
		{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: []string{"one", "two", "three"}},
		{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: []string{"1234567", "1234567"}},
	}
	for _, request := range tests {
		if _, err := service.Embed(context.Background(), testScope(t, ragembedding.PurposeQuery), request); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("want invalid request for %#v, got %v", request, err)
		}
	}
	if provider.calls != 0 {
		t.Fatalf("invalid inputs reached provider: calls=%d", provider.calls)
	}
}

func TestServiceKeepsQueryAndIngestionUsageSeparate(t *testing.T) {
	for _, purpose := range []ragembedding.Purpose{ragembedding.PurposeQuery, ragembedding.PurposeIngestion} {
		provider := &fakeProvider{result: embeddingdomain.Result{
			Vectors: makeVectors(1, 1536), Model: "text-embedding-3-large",
			Usage: embeddingdomain.Usage{PromptTokens: 1, TotalTokens: 1},
		}}
		service := newTestService(t, provider)
		response, err := service.Embed(
			context.Background(),
			testScope(t, purpose),
			ragembedding.Request{Purpose: purpose, ProfileVersion: 1, Inputs: []string{"input"}},
		)
		if err != nil {
			t.Fatalf("embed purpose %s: %v", purpose, err)
		}
		if response.Purpose != purpose || response.Usage.InputCount != 1 || response.Usage.PromptTokens != 1 {
			t.Fatalf("usage purpose was not preserved: purpose=%s response=%+v", purpose, response)
		}
	}
}

func TestServiceRejectsPurposeMismatchAndInvalidProviderShape(t *testing.T) {
	provider := &fakeProvider{result: embeddingdomain.Result{
		Vectors: [][]float64{{math.NaN()}}, Model: "text-embedding-3-large",
		Usage: embeddingdomain.Usage{PromptTokens: 1, TotalTokens: 1},
	}}
	service := newTestService(t, provider)
	request := ragembedding.Request{Purpose: ragembedding.PurposeIngestion, ProfileVersion: 1, Inputs: []string{"chunk"}}
	if _, err := service.Embed(context.Background(), testScope(t, ragembedding.PurposeQuery), request); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("want purpose mismatch, got %v", err)
	}
	request.Purpose = ragembedding.PurposeQuery
	if _, err := service.Embed(context.Background(), testScope(t, ragembedding.PurposeQuery), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("want invalid provider response, got %v", err)
	}
}

func TestServiceRejectsZeroProviderUsage(t *testing.T) {
	provider := &fakeProvider{result: embeddingdomain.Result{
		Vectors: makeVectors(1, 1536), Model: "text-embedding-3-large",
		Usage: embeddingdomain.Usage{},
	}}
	service := newTestService(t, provider)
	request := ragembedding.Request{Purpose: ragembedding.PurposeQuery, ProfileVersion: 1, Inputs: []string{"query"}}

	if _, err := service.Embed(context.Background(), testScope(t, ragembedding.PurposeQuery), request); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("want invalid zero provider usage, got %v", err)
	}
}

func newTestService(t *testing.T, provider embeddingdomain.Provider) *Service {
	t.Helper()
	service, err := New(provider, Config{
		Provider: "openai", Model: "text-embedding-3-large", Dimensions: 1536, ProfileVersion: 1,
		MaxInputs: 2, MaxTokensPerInput: 8, MaxBatchTokens: 12,
	})
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	return service
}

func testScope(t *testing.T, purpose ragembedding.Purpose) ragembedding.VerifiedScope {
	t.Helper()
	caller, err := ragembedding.NewCallerIdentity("gatelm-chat-api", "service:chat-api", "chat-rag-key")
	if err != nil {
		t.Fatalf("new caller: %v", err)
	}
	scope, err := ragembedding.NewVerifiedScope(
		"00000000-0000-4000-8000-000000000100", "request_001", "operation_001", purpose, 1, caller,
	)
	if err != nil {
		t.Fatalf("new scope: %v", err)
	}
	return scope
}

func makeVectors(count, dimensions int) [][]float64 {
	vectors := make([][]float64, count)
	for index := range vectors {
		vectors[index] = make([]float64, dimensions)
		vectors[index][0] = float64(index + 1)
	}
	return vectors
}
