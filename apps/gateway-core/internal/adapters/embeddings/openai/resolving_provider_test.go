package openai

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/domain/credentials"
	"gatelm/apps/gateway-core/internal/domain/embedding"
)

type credentialResolverFunc func(context.Context, credentials.Ref) (credentials.Resolved, error)

func (f credentialResolverFunc) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	return f(ctx, ref)
}

func TestResolvingProviderObservesCredentialRotationBetweenLogicalCalls(t *testing.T) {
	keys := []string{"synthetic-old-key", "synthetic-rotated-key"}
	resolverCalls := 0
	resolvedRefs := make([]credentials.Ref, 0, len(keys))
	resolver := credentialResolverFunc(func(_ context.Context, ref credentials.Ref) (credentials.Resolved, error) {
		resolvedRefs = append(resolvedRefs, ref)
		key := keys[resolverCalls]
		resolverCalls++
		return credentials.Resolved{Value: key}, nil
	})

	providerCalls := 0
	authorizationHeaders := make([]string, 0, len(keys))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		providerCalls++
		authorizationHeaders = append(authorizationHeaders, request.Header.Get("Authorization"))
		writeEmbeddingResponse(t, w)
	}))
	defer server.Close()

	provider := newTestResolvingProvider(t, resolver, server, Config{MaxAttempts: 1})
	request := embedding.Request{Inputs: []string{"synthetic input"}, Model: "text-embedding-3-large", Dimensions: 2}
	for call := 0; call < 2; call++ {
		if _, err := provider.Embed(context.Background(), request); err != nil {
			t.Fatalf("embed call %d: %v", call+1, err)
		}
	}

	if resolverCalls != 2 || providerCalls != 2 {
		t.Fatalf("credential and provider must run once per logical call: resolver=%d provider=%d", resolverCalls, providerCalls)
	}
	if len(authorizationHeaders) != 2 || authorizationHeaders[0] != "Bearer "+keys[0] ||
		authorizationHeaders[1] != "Bearer "+keys[1] {
		t.Fatalf("rotated credential was not observed: %#v", authorizationHeaders)
	}
	for _, ref := range resolvedRefs {
		if ref.CredentialRefID != "rag-openai" || ref.CredentialVersion != 1 || ref.CredentialState != credentials.StateActive {
			t.Fatalf("resolver received unexpected server-owned reference: %+v", ref)
		}
	}
}

func TestResolvingProviderDoesNotReResolveDuringClientRetries(t *testing.T) {
	resolverCalls := 0
	resolver := credentialResolverFunc(func(_ context.Context, _ credentials.Ref) (credentials.Resolved, error) {
		resolverCalls++
		return credentials.Resolved{Value: "synthetic-stable-key"}, nil
	})
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		providerCalls++
		if request.Header.Get("Authorization") != "Bearer synthetic-stable-key" {
			t.Fatal("retry changed the resolved credential")
		}
		if providerCalls == 1 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		writeEmbeddingResponse(t, w)
	}))
	defer server.Close()

	provider := newTestResolvingProvider(t, resolver, server, Config{
		MaxAttempts: 2,
		Sleep: func(context.Context, time.Duration) error {
			return nil
		},
	})
	_, err := provider.Embed(context.Background(), embedding.Request{
		Inputs: []string{"synthetic input"}, Model: "text-embedding-3-large", Dimensions: 2,
	})
	if err != nil {
		t.Fatalf("embed with retry: %v", err)
	}
	if resolverCalls != 1 || providerCalls != 2 {
		t.Fatalf("retry must reuse one logical-call credential: resolver=%d provider=%d", resolverCalls, providerCalls)
	}
}

func TestResolvingProviderObservesRevocationBetweenLogicalCalls(t *testing.T) {
	resolverCalls := 0
	resolver := credentialResolverFunc(func(_ context.Context, _ credentials.Ref) (credentials.Resolved, error) {
		resolverCalls++
		if resolverCalls == 1 {
			return credentials.Resolved{Value: "synthetic-active-key"}, nil
		}
		return credentials.Resolved{}, fmt.Errorf("sensitive-revocation-detail: %w", credentials.ErrInactive)
	})
	providerCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls++
		writeEmbeddingResponse(t, w)
	}))
	defer server.Close()

	provider := newTestResolvingProvider(t, resolver, server, Config{MaxAttempts: 1})
	request := embedding.Request{Inputs: []string{"synthetic input"}, Model: "text-embedding-3-large", Dimensions: 2}
	if _, err := provider.Embed(context.Background(), request); err != nil {
		t.Fatalf("first embed: %v", err)
	}
	_, err := provider.Embed(context.Background(), request)
	if !errors.Is(err, embedding.ErrCredentialUnavailable) || strings.Contains(fmt.Sprint(err), "sensitive-revocation-detail") {
		t.Fatalf("revocation was not mapped safely: %v", err)
	}
	if resolverCalls != 2 || providerCalls != 1 {
		t.Fatalf("revoked credential must stop before a second HTTP call: resolver=%d provider=%d", resolverCalls, providerCalls)
	}
}

func TestResolvingProviderFailsBeforeHTTPWhenCredentialCannotBeResolved(t *testing.T) {
	tests := []struct {
		name       string
		resolved   credentials.Resolved
		resolveErr error
		wantErr    error
	}{
		{name: "missing", resolveErr: fmt.Errorf("sensitive-resolver-detail: %w", credentials.ErrMissingReference), wantErr: embedding.ErrCredentialRequired},
		{name: "revoked", resolveErr: fmt.Errorf("sensitive-resolver-detail: %w", credentials.ErrInactive), wantErr: embedding.ErrCredentialUnavailable},
		{name: "unavailable", resolveErr: fmt.Errorf("sensitive-resolver-detail: %w", credentials.ErrUnavailable), wantErr: embedding.ErrCredentialUnavailable},
		{name: "empty value", resolved: credentials.Resolved{}, wantErr: embedding.ErrCredentialUnavailable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			providerCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				providerCalls++
			}))
			defer server.Close()

			resolver := credentialResolverFunc(func(_ context.Context, _ credentials.Ref) (credentials.Resolved, error) {
				return test.resolved, test.resolveErr
			})
			provider := newTestResolvingProvider(t, resolver, server, Config{MaxAttempts: 1})
			_, err := provider.Embed(context.Background(), embedding.Request{
				Inputs: []string{"must not leave gateway"}, Model: "text-embedding-3-large", Dimensions: 2,
			})
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("want %v, got %v", test.wantErr, err)
			}
			if providerCalls != 0 {
				t.Fatalf("credential failure reached HTTP provider %d times", providerCalls)
			}
			if strings.Contains(fmt.Sprint(err), "sensitive-resolver-detail") {
				t.Fatalf("resolver detail leaked through safe error: %v", err)
			}
		})
	}
}

func TestResolvingProviderRejectsStaticCredentialConfiguration(t *testing.T) {
	resolver := credentialResolverFunc(func(context.Context, credentials.Ref) (credentials.Resolved, error) {
		t.Fatal("constructor must not resolve a credential")
		return credentials.Resolved{}, nil
	})
	_, err := NewResolvingProvider(resolver, testCredentialRef(), Config{
		APIKey: "sensitive-static-key", Model: "text-embedding-3-large", Dimensions: 2,
	})
	if !errors.Is(err, embedding.ErrInvalidRequest) || strings.Contains(fmt.Sprint(err), "sensitive-static-key") {
		t.Fatalf("static credential rejection was not safe: %v", err)
	}
}

func newTestResolvingProvider(
	t *testing.T,
	resolver credentials.Resolver,
	server *httptest.Server,
	override Config,
) *ResolvingProvider {
	t.Helper()
	config := Config{
		BaseURL:     server.URL,
		Model:       "text-embedding-3-large",
		Dimensions:  2,
		MaxAttempts: override.MaxAttempts,
		HTTPClient:  server.Client(),
		Sleep:       override.Sleep,
	}
	provider, err := NewResolvingProvider(resolver, testCredentialRef(), config)
	if err != nil {
		t.Fatalf("new resolving provider: %v", err)
	}
	return provider
}

func testCredentialRef() credentials.Ref {
	return credentials.Ref{
		CredentialRefID:   "rag-openai",
		CredentialVersion: 1,
		CredentialState:   credentials.StateActive,
	}
}

func writeEmbeddingResponse(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	writeJSON(t, w, map[string]any{
		"model": "text-embedding-3-large",
		"data": []map[string]any{{
			"index":     0,
			"embedding": []float64{0.1, 0.2},
		}},
		"usage": map[string]int{"prompt_tokens": 1, "total_tokens": 1},
	})
}
