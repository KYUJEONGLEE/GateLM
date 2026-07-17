package rag

import (
	"net/http"
	"strings"
	"testing"

	embeddingdomain "gatelm/apps/gateway-core/internal/domain/embedding"
)

func TestPrivateRAGEmbeddingMapsCredentialUnavailableWithoutDetail(t *testing.T) {
	service := &fakeEmbeddingService{err: embeddingdomain.ErrCredentialUnavailable}
	recorder := performRequest(t, NewRouter(&fakeAuthenticator{scope: routerScope(t)}, service, 64*1024), map[string]any{
		"purpose": "RAG_QUERY", "profileVersion": 1, "inputs": []string{"synthetic"},
	})
	if recorder.Code != http.StatusServiceUnavailable ||
		!strings.Contains(recorder.Body.String(), "RAG_EMBEDDING_UNAVAILABLE") ||
		strings.Contains(recorder.Body.String(), embeddingdomain.ErrCredentialUnavailable.Error()) {
		t.Fatalf("unsafe credential error mapping: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
