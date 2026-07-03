package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

func TestOpenAIEmbeddingProviderClassifiesTransportContextErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want error
	}{
		{name: "context canceled", err: context.Canceled, want: context.Canceled},
		{name: "deadline exceeded", err: context.DeadlineExceeded, want: context.DeadlineExceeded},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			provider, err := NewOpenAIEmbeddingProvider(OpenAIEmbeddingProviderConfig{
				APIKey:    "test_openai_api_key_redacted",
				BaseURL:   "http://127.0.0.1/v1",
				ModelName: "text-embedding-3-small",
				Timeout:   time.Second,
				HTTPClient: &http.Client{
					Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
						return nil, tc.err
					}),
				},
			})
			if err != nil {
				t.Fatalf("OpenAIEmbeddingProvider 생성 실패: %v", err)
			}

			_, err = provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "비밀번호 재설정 방법 알려줘"})
			if !errors.Is(err, tc.want) {
				t.Fatalf("transport context error 분류 불일치: got=%v want=%v", err, tc.want)
			}
			if errors.Is(err, ErrOpenAIEmbeddingRequestFailed) {
				t.Fatalf("context error는 provider request failure로 오분류되면 안 됨: %v", err)
			}
		})
	}
}

func TestOpenAIEmbeddingEndpointUsesConfiguredBaseURLPath(t *testing.T) {
	cases := []struct {
		name    string
		baseURL string
		want    string
	}{
		{
			name:    "default includes v1",
			baseURL: "",
			want:    "https://api.openai.com/v1/embeddings",
		},
		{
			name:    "openai v1 path",
			baseURL: "https://api.openai.com/v1",
			want:    "https://api.openai.com/v1/embeddings",
		},
		{
			name:    "custom path is preserved",
			baseURL: "http://localhost:11434/openai-compatible",
			want:    "http://localhost:11434/openai-compatible/embeddings",
		},
		{
			name:    "trailing slash is trimmed",
			baseURL: "http://localhost:11434/openai-compatible/",
			want:    "http://localhost:11434/openai-compatible/embeddings",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := openAIEmbeddingEndpoint(tc.baseURL); got != tc.want {
				t.Fatalf("embedding endpoint 불일치: got=%q want=%q", got, tc.want)
			}
		})
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
	usage, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: "사용량 메뉴 위치 알려줘"})
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

func TestOpenAIEmbeddingProviderGeneralOnlyEvalKoreanSimilarityDistribution(t *testing.T) {
	if os.Getenv("SEMANTIC_CACHE_OPENAI_EVAL") != "1" {
		t.Skip("SEMANTIC_CACHE_OPENAI_EVAL=1일 때만 실제 OpenAI embedding eval을 실행한다")
	}
	if provider := strings.TrimSpace(os.Getenv("SEMANTIC_CACHE_EMBEDDING_PROVIDER")); provider != "" && provider != SemanticCacheEmbeddingProviderOpenAI {
		t.Skip("SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai 또는 빈 값일 때만 OpenAI embedding eval을 실행한다")
	}
	apiKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY가 없어 실제 OpenAI embedding eval을 건너뛴다")
	}

	provider, err := NewOpenAIEmbeddingProvider(OpenAIEmbeddingProviderConfig{
		APIKey:     apiKey,
		BaseURL:    os.Getenv("SEMANTIC_CACHE_OPENAI_BASE_URL"),
		ModelName:  firstNonEmptyString(os.Getenv("SEMANTIC_CACHE_EMBEDDING_MODEL"), "text-embedding-3-small"),
		Dimensions: testOpenAIEmbeddingDimensions(t),
		Timeout:    15 * time.Second,
	})
	if err != nil {
		t.Fatalf("OpenAIEmbeddingProvider 생성 실패: %v", err)
	}

	vectors := map[string][]float64{}
	embed := func(label string, text string) []float64 {
		t.Helper()
		key := normalizeSemanticText(text)
		if vector, ok := vectors[key]; ok {
			return vector
		}
		result, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: text})
		if err != nil {
			t.Fatalf("%s embedding 생성 실패: %v", label, err)
		}
		if len(result.Vector) == 0 {
			t.Fatalf("%s embedding vector가 비어 있으면 안 됨", label)
		}
		vectors[key] = result.Vector
		return result.Vector
	}

	pairs := []openAIEmbeddingEvalPair{
		{id: "positive_usage_menu_location", kind: "positive", leftLabel: "p_usage_menu_a", rightLabel: "p_usage_menu_b", leftText: "사용량 메뉴 위치 알려줘", rightText: "API 사용량 확인 화면은 어디야?", policyGuardAllowsHit: true},
		{id: "positive_usage_stats_screen_location", kind: "positive", leftLabel: "p_usage_stats_a", rightLabel: "p_usage_stats_b", leftText: "사용량 통계 화면 위치 알려줘", rightText: "월간 사용량 대시보드 메뉴 어디야?", policyGuardAllowsHit: true},
		{id: "dynamic_usage_current_month", kind: "dynamic_negative", leftLabel: "d_usage_static_a", rightLabel: "d_usage_dynamic_b", leftText: "사용량 메뉴 위치 알려줘", rightText: "내 이번 달 사용량 보여줘", policyGuardAllowsHit: false},
		{id: "dynamic_usage_project_cost", kind: "dynamic_negative", leftLabel: "d_usage_screen_a", rightLabel: "d_cost_dynamic_b", leftText: "API 사용량 확인 화면은 어디야?", rightText: "현재 프로젝트별 비용 알려줘", policyGuardAllowsHit: false},
		{id: "dynamic_usage_today_tokens", kind: "dynamic_negative", leftLabel: "d_usage_stats_a", rightLabel: "d_tokens_dynamic_b", leftText: "사용량 통계 화면 위치 알려줘", rightText: "오늘 토큰 사용량 몇이야?", policyGuardAllowsHit: false},
		{id: "unrelated_usage_vs_account_setting", kind: "unrelated", leftLabel: "u_usage_menu_a", rightLabel: "u_account_setting_b", leftText: "사용량 메뉴 위치 알려줘", rightText: "계정 설정은 어디서 바꿔?", policyGuardAllowsHit: false},
	}

	t.Logf("OpenAI embedding general-only eval model=%s pair_count=%d", provider.ModelName(), len(pairs))
	for i := range pairs {
		left := embed(pairs[i].leftLabel, pairs[i].leftText)
		right := embed(pairs[i].rightLabel, pairs[i].rightText)
		similarity, err := CosineSimilarity(left, right)
		if err != nil {
			t.Fatalf("%s cosine 계산 실패: %v", pairs[i].id, err)
		}
		pairs[i].similarity = similarity
		t.Logf("pair=%s kind=%s similarity=%.6f policyGuardAllowsHit=%t", pairs[i].id, pairs[i].kind, pairs[i].similarity, pairs[i].policyGuardAllowsHit)
	}

	thresholds := []float64{0.35, 0.45, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.92}
	for _, threshold := range thresholds {
		summary := summarizeOpenAIEmbeddingEvalPairs(pairs, threshold)
		t.Logf(
			"threshold=%.2f positiveAbove=%d/%d dynamicNegativeAbove=%d/%d hardNegativeAbove=%d/%d unrelatedAbove=%d/%d policyGuardHitPossible=%d/%d",
			threshold,
			summary.positiveAbove,
			summary.positiveTotal,
			summary.dynamicNegativeAbove,
			summary.dynamicNegativeTotal,
			summary.hardNegativeAbove,
			summary.hardNegativeTotal,
			summary.unrelatedAbove,
			summary.unrelatedTotal,
			summary.policyGuardHitPossible,
			len(pairs),
		)
	}
}

type openAIEmbeddingEvalPair struct {
	id                   string
	kind                 string
	leftLabel            string
	rightLabel           string
	leftText             string
	rightText            string
	policyGuardAllowsHit bool
	similarity           float64
}

type openAIEmbeddingEvalSummary struct {
	positiveAbove          int
	positiveTotal          int
	dynamicNegativeAbove   int
	dynamicNegativeTotal   int
	hardNegativeAbove      int
	hardNegativeTotal      int
	unrelatedAbove         int
	unrelatedTotal         int
	policyGuardHitPossible int
}

func summarizeOpenAIEmbeddingEvalPairs(pairs []openAIEmbeddingEvalPair, threshold float64) openAIEmbeddingEvalSummary {
	var summary openAIEmbeddingEvalSummary
	for _, pair := range pairs {
		above := pair.similarity >= threshold
		if above && pair.policyGuardAllowsHit {
			summary.policyGuardHitPossible++
		}
		switch pair.kind {
		case "positive":
			summary.positiveTotal++
			if above {
				summary.positiveAbove++
			}
		case "dynamic_negative":
			summary.dynamicNegativeTotal++
			if above {
				summary.dynamicNegativeAbove++
			}
		case "hard_negative":
			summary.hardNegativeTotal++
			if above {
				summary.hardNegativeAbove++
			}
		case "unrelated":
			summary.unrelatedTotal++
			if above {
				summary.unrelatedAbove++
			}
		default:
			panic(fmt.Sprintf("unknown OpenAI embedding eval pair kind: %s", pair.kind))
		}
	}
	return summary
}

func testOpenAIEmbeddingDimensions(t *testing.T) int {
	t.Helper()
	raw := strings.TrimSpace(os.Getenv("SEMANTIC_CACHE_EMBEDDING_DIMENSIONS"))
	if raw == "" {
		return 0
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		t.Fatalf("SEMANTIC_CACHE_EMBEDDING_DIMENSIONS 값이 숫자가 아님")
	}
	return parsed
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
