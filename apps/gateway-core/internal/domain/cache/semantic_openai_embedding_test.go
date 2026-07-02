package cache

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestOpenAIEmbeddingProviderSendsExpectedRequest(t *testing.T) {
	const apiKey = "test_openai_api_key_redacted"
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodPost {
			t.Fatalf("OpenAI embedding은 POST로 호출해야 함: method=%s", r.Method)
		}
		if r.URL.Path != "/v1/embeddings" {
			t.Fatalf("OpenAI embedding path 불일치: path=%s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+apiKey {
			t.Fatalf("OpenAI API key는 Authorization bearer header로만 전달되어야 함")
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Fatalf("Content-Type 불일치: %q", got)
		}

		var body openAIEmbeddingRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("embedding request body decode 실패: %v", err)
		}
		if body.Input != "비밀번호 재설정 방법 알려줘" {
			t.Fatalf("normalized input 불일치: %q", body.Input)
		}
		if body.Model != "text-embedding-3-small" {
			t.Fatalf("embedding model 불일치: %q", body.Model)
		}
		if body.Dimensions == nil || *body.Dimensions != 256 {
			t.Fatalf("embedding dimensions 불일치: %+v", body.Dimensions)
		}
		encodedBody, _ := json.Marshal(body)
		if strings.Contains(string(encodedBody), apiKey) {
			t.Fatalf("OpenAI API key가 request body에 들어가면 안 됨")
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"object":"embedding","index":0,"embedding":[0.1,0.2,0.3]}],"model":"text-embedding-3-small"}`))
	}))
	defer server.Close()

	provider, err := NewOpenAIEmbeddingProvider(OpenAIEmbeddingProviderConfig{
		APIKey:     apiKey,
		BaseURL:    server.URL + "/v1",
		ModelName:  "text-embedding-3-small",
		Dimensions: 256,
		Timeout:    time.Second,
	})
	if err != nil {
		t.Fatalf("OpenAIEmbeddingProvider 생성 실패: %v", err)
	}

	result, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "  비밀번호   재설정 방법 알려줘  "})
	if err != nil {
		t.Fatalf("OpenAI embedding 생성 실패: %v", err)
	}
	if requests != 1 {
		t.Fatalf("OpenAI embedding request 횟수 불일치: got %d", requests)
	}
	if result.Model != "text-embedding-3-small" {
		t.Fatalf("embedding result model 불일치: %q", result.Model)
	}
	if got := len(result.Vector); got != 3 {
		t.Fatalf("embedding vector 길이 불일치: got %d", got)
	}
}

func TestOpenAIEmbeddingProviderDoesNotLeakSecretsOrRawErrorBody(t *testing.T) {
	const apiKey = "test_openai_api_key_redacted"
	const rawErrorBody = "openai raw error body must not leak"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, rawErrorBody, http.StatusTooManyRequests)
	}))
	defer server.Close()

	provider, err := NewOpenAIEmbeddingProvider(OpenAIEmbeddingProviderConfig{
		APIKey:    apiKey,
		BaseURL:   server.URL,
		ModelName: "text-embedding-3-small",
		Timeout:   time.Second,
	})
	if err != nil {
		t.Fatalf("OpenAIEmbeddingProvider 생성 실패: %v", err)
	}

	_, err = provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "비밀번호 재설정 방법 알려줘"})
	if !errors.Is(err, ErrOpenAIEmbeddingRequestFailed) {
		t.Fatalf("non-2xx 응답은 request failed 에러여야 함: %v", err)
	}
	if strings.Contains(err.Error(), apiKey) || strings.Contains(err.Error(), rawErrorBody) {
		t.Fatalf("OpenAI provider error에는 API key나 raw error body가 남으면 안 됨: %v", err)
	}
}

func TestOpenAIEmbeddingProviderFactoryCreatesOpenAIProvider(t *testing.T) {
	provider, err := NewSemanticCacheEmbeddingProviderWithConfig(SemanticCacheEmbeddingProviderConfig{
		Provider:      SemanticCacheEmbeddingProviderOpenAI,
		ModelName:     "text-embedding-3-small",
		OpenAIAPIKey:  "test_openai_api_key_redacted",
		OpenAIBaseURL: "http://127.0.0.1:1/v1",
		Timeout:       time.Millisecond,
	})
	if err != nil {
		t.Fatalf("factory는 openai provider를 생성해야 함: %v", err)
	}
	if provider.ProviderName() != SemanticCacheEmbeddingProviderOpenAI {
		t.Fatalf("provider name 불일치: %q", provider.ProviderName())
	}

	_, err = NewSemanticCacheEmbeddingProviderWithConfig(SemanticCacheEmbeddingProviderConfig{
		Provider: SemanticCacheEmbeddingProviderOpenAI,
	})
	if !errors.Is(err, ErrOpenAIEmbeddingAPIKeyRequired) {
		t.Fatalf("openai provider는 API key 누락 시 명시 에러여야 함: %v", err)
	}
}

func TestOpenAIEmbeddingProviderSmokeKoreanSimilarity(t *testing.T) {
	if os.Getenv("SEMANTIC_CACHE_OPENAI_SMOKE") != "1" {
		t.Skip("SEMANTIC_CACHE_OPENAI_SMOKE=1일 때만 실제 OpenAI embedding smoke를 실행한다")
	}
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY가 없어 실제 OpenAI embedding smoke를 건너뛴다")
	}

	dimensions := 0
	if raw := strings.TrimSpace(os.Getenv("SEMANTIC_CACHE_EMBEDDING_DIMENSIONS")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatalf("SEMANTIC_CACHE_EMBEDDING_DIMENSIONS 값이 숫자가 아님")
		}
		dimensions = parsed
	}
	provider, err := NewOpenAIEmbeddingProvider(OpenAIEmbeddingProviderConfig{
		APIKey:     apiKey,
		BaseURL:    os.Getenv("SEMANTIC_CACHE_OPENAI_BASE_URL"),
		ModelName:  firstNonEmptyString(os.Getenv("SEMANTIC_CACHE_EMBEDDING_MODEL"), "text-embedding-3-small"),
		Dimensions: dimensions,
		Timeout:    10 * time.Second,
	})
	if err != nil {
		t.Fatalf("OpenAIEmbeddingProvider 생성 실패: %v", err)
	}

	reset, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "비밀번호 재설정 방법 알려줘"})
	if err != nil {
		t.Fatalf("한국어 유사 pair 첫 embedding 실패: %v", err)
	}
	password, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "패스워드 초기화는 어떻게 해?"})
	if err != nil {
		t.Fatalf("한국어 유사 pair 둘째 embedding 실패: %v", err)
	}
	usage, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "이번 달 사용량 통계를 보여줘"})
	if err != nil {
		t.Fatalf("한국어 비유사 pair embedding 실패: %v", err)
	}

	similar, err := CosineSimilarity(reset.Vector, password.Vector)
	if err != nil {
		t.Fatalf("한국어 유사 pair cosine 계산 실패: %v", err)
	}
	unrelated, err := CosineSimilarity(reset.Vector, usage.Vector)
	if err != nil {
		t.Fatalf("한국어 비유사 pair cosine 계산 실패: %v", err)
	}
	if similar <= unrelated {
		t.Fatalf("한국어 유사 pair similarity가 비유사 pair보다 커야 함: similar=%f unrelated=%f", similar, unrelated)
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
