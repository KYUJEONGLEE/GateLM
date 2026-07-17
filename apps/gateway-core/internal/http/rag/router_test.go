package rag

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	ragworkloadauth "gatelm/apps/gateway-core/internal/adapters/rag/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/ragembedding"
	ragservice "gatelm/apps/gateway-core/internal/services/rag/embedding"
)

type fakeAuthenticator struct {
	scope ragembedding.VerifiedScope
	err   error
	calls int
}

func (a *fakeAuthenticator) Authenticate(
	_ context.Context,
	_ string,
	_ ragembedding.Request,
) (ragembedding.VerifiedScope, error) {
	a.calls++
	return a.scope, a.err
}

type fakeEmbeddingService struct {
	response ragservice.Response
	err      error
	calls    int
	request  ragembedding.Request
}

func (s *fakeEmbeddingService) Embed(
	_ context.Context,
	_ ragembedding.VerifiedScope,
	request ragembedding.Request,
) (ragservice.Response, error) {
	s.calls++
	s.request = request
	return s.response, s.err
}

func TestPrivateRAGEmbeddingReturnsBoundedResponse(t *testing.T) {
	auth := &fakeAuthenticator{scope: routerScope(t)}
	service := &fakeEmbeddingService{response: ragservice.Response{
		RequestID: "request_001", Purpose: ragembedding.PurposeQuery,
		Provider: "openai", Model: "text-embedding-3-large", Dimensions: 1536, ProfileVersion: 1,
		Embeddings: [][]float64{make([]float64, 1536)}, Usage: ragservice.Usage{InputCount: 1, PromptTokens: 2, TotalTokens: 2},
	}}
	recorder := performRequest(t, NewRouter(auth, service, 64*1024), map[string]any{
		"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{"synthetic input"},
	})
	if recorder.Code != http.StatusOK || auth.calls != 1 || service.calls != 1 {
		t.Fatalf("unexpected result: status=%d auth=%d service=%d body=%s", recorder.Code, auth.calls, service.calls, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" || strings.Contains(recorder.Body.String(), "tenantId") {
		t.Fatalf("response leaked forbidden state or cache policy: %s", recorder.Body.String())
	}
}

func TestPrivateRAGEmbeddingMetricsUseOnlyBoundedSafeLabels(t *testing.T) {
	registry := metrics.NewRegistry()
	service := &fakeEmbeddingService{response: ragservice.Response{
		RequestID: "request_001", Purpose: ragembedding.PurposeQuery,
		Provider: "openai", Model: "text-embedding-3-large", Dimensions: 1536, ProfileVersion: 1,
		Embeddings: [][]float64{make([]float64, 1536)}, Usage: ragservice.Usage{InputCount: 1, PromptTokens: 7, TotalTokens: 7},
	}}
	recorder := performRequest(t, NewRouter(&fakeAuthenticator{scope: routerScope(t)}, service, 64*1024, WithMetrics(registry)), map[string]any{
		"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{"confidential query must not be a label"},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d", recorder.Code)
	}
	output := registry.RenderPrometheus()
	for _, expected := range []string{
		`gatelm_rag_embedding_requests_total{failure_code="none",job_type="query",model="text-embedding-3-large",provider="openai",service="gateway-core"} 1`,
		`gatelm_rag_embedding_input_tokens_total{failure_code="none",job_type="query",model="text-embedding-3-large",provider="openai",service="gateway-core"} 7`,
	} {
		if !strings.Contains(output, expected) {
			t.Fatalf("missing safe metric %q\n%s", expected, output)
		}
	}
	for _, forbidden := range []string{"confidential query", "tenant_id=", "document_id=", "api_key="} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("metric leaked %q\n%s", forbidden, output)
		}
	}
}

func TestPrivateRAGEmbeddingRejectsAuthBeforeProvider(t *testing.T) {
	auth := &fakeAuthenticator{err: ragworkloadauth.ErrTokenInvalid}
	service := &fakeEmbeddingService{}
	recorder := performRequest(t, NewRouter(auth, service, 64*1024), map[string]any{
		"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{"must not reach provider"},
	})
	if recorder.Code != http.StatusUnauthorized || service.calls != 0 {
		t.Fatalf("auth failure reached service: status=%d calls=%d", recorder.Code, service.calls)
	}
}

func TestPrivateRAGEmbeddingRejectsClientOwnedProfileAndTenantFields(t *testing.T) {
	for _, forbidden := range []map[string]any{
		{"tenantId": "00000000-0000-4000-8000-000000000100"},
		{"model": "arbitrary"},
		{"dimensions": 3},
		{"cacheMode": "BYPASS"},
		{"semanticCache": "disabled"},
	} {
		payload := map[string]any{"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{"synthetic"}}
		for key, value := range forbidden {
			payload[key] = value
		}
		recorder := performRequest(t, NewRouter(&fakeAuthenticator{}, &fakeEmbeddingService{}, 64*1024), payload)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("forbidden payload %#v returned %d", forbidden, recorder.Code)
		}
	}
}

func TestPrivateRAGEmbeddingMapsSafeProviderErrors(t *testing.T) {
	tests := []struct {
		err    error
		status int
		code   string
	}{
		{err: context.DeadlineExceeded, status: http.StatusGatewayTimeout, code: "RAG_EMBEDDING_PROVIDER_TIMEOUT"},
		{err: errors.New("provider raw body secret"), status: http.StatusBadGateway, code: "RAG_EMBEDDING_PROVIDER_FAILED"},
	}
	for _, test := range tests {
		service := &fakeEmbeddingService{err: test.err}
		recorder := performRequest(t, NewRouter(&fakeAuthenticator{scope: routerScope(t)}, service, 64*1024), map[string]any{
			"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{"synthetic"},
		})
		if recorder.Code != test.status || !strings.Contains(recorder.Body.String(), test.code) ||
			strings.Contains(recorder.Body.String(), "raw body") {
			t.Fatalf("unsafe error mapping: status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestPrivateRAGEmbeddingEnforcesRequestBodyLimit(t *testing.T) {
	recorder := performRequest(t, NewRouter(&fakeAuthenticator{}, &fakeEmbeddingService{}, 32), map[string]any{
		"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{strings.Repeat("x", 128)},
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("want bounded body rejection, got %d", recorder.Code)
	}
}

func performRequest(t *testing.T, handler http.Handler, payload any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/internal/v1/rag/embeddings", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer synthetic-token")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func routerScope(t *testing.T) ragembedding.VerifiedScope {
	t.Helper()
	caller, err := ragembedding.NewCallerIdentity("gatelm-chat-api", "service:chat-api", "chat-rag-key")
	if err != nil {
		t.Fatalf("caller: %v", err)
	}
	scope, err := ragembedding.NewVerifiedScope(
		"00000000-0000-4000-8000-000000000100", "request_001", "operation_001", ragembedding.PurposeQuery, 1, caller,
	)
	if err != nil {
		t.Fatalf("scope: %v", err)
	}
	return scope
}
