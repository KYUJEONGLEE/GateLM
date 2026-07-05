package cache

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestSemanticCacheRerankerOffKeepsExistingHit(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	service, _, _ := newSemanticRerankerTestService(t, boundary, nil)

	storeSemanticRerankerEntry(t, ctx, service, boundary, "사용량 메뉴 위치 알려줘", "request-reranker-off")

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "API 사용량 확인 화면은 어디야?",
	})
	if err != nil {
		t.Fatalf("reranker off search 실패: %v", err)
	}
	if !result.Hit || !decision.SemanticCacheHit || decision.SemanticMatchedRequestID != "request-reranker-off" {
		t.Fatalf("reranker off에서는 기존 semantic hit 동작이 유지되어야 함: result=%+v decision=%+v", result, decision)
	}
	if result.RerankerApplied || decision.RerankerApplied || decision.RerankerDecisionReason != "" {
		t.Fatalf("reranker off에서는 reranker field가 채워지면 안 됨: result=%+v decision=%+v", result, decision)
	}
}

func TestSemanticCacheRerankerRejectsPolicyAcceptedCandidate(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	reranker := &deterministicTestSemanticCacheReranker{
		results: []SemanticCacheRerankResult{{
			Applied:               true,
			Passed:                false,
			Score:                 0.21,
			Threshold:             0.80,
			DecisionReason:        SemanticCacheReasonRerankerScoreMiss,
			ProviderBypassAllowed: false,
		}},
	}
	service, _, _ := newSemanticRerankerTestService(t, boundary, reranker)

	storeSemanticRerankerEntry(t, ctx, service, boundary, "사용량 메뉴 위치 알려줘", "request-reranker-reject")

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "사용량 메뉴 위치 알려줘",
	})
	if err != nil {
		t.Fatalf("reranker reject search 실패: %v", err)
	}
	if result.Hit || decision.SemanticCacheHit {
		t.Fatalf("reranker reject면 similarity가 높아도 miss여야 함: result=%+v decision=%+v", result, decision)
	}
	if reranker.calls != 1 {
		t.Fatalf("policy guard 통과 후보 1개에 대해서만 reranker가 호출되어야 함: got %d", reranker.calls)
	}
	if decision.SemanticCacheDecisionReason != SemanticCacheReasonRerankerScoreMiss ||
		!decision.RerankerApplied ||
		decision.RerankerPassed ||
		decision.RerankerScore != 0.21 ||
		decision.RerankerThreshold != 0.80 {
		t.Fatalf("reranker reject decision field 불일치: %+v", decision)
	}
}

func TestSemanticCacheRerankerAcceptsAfterPolicyAndThresholdPass(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	reranker := &deterministicTestSemanticCacheReranker{
		results: []SemanticCacheRerankResult{{
			Applied:        true,
			Passed:         true,
			Score:          0.93,
			Threshold:      0.80,
			DecisionReason: SemanticCacheReasonRerankerPass,
		}},
	}
	service, _, _ := newSemanticRerankerTestService(t, boundary, reranker)

	storeSemanticRerankerEntry(t, ctx, service, boundary, "사용량 메뉴 위치 알려줘", "request-reranker-accept")

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "사용량 메뉴 위치 알려줘",
	})
	if err != nil {
		t.Fatalf("reranker accept search 실패: %v", err)
	}
	if !result.Hit || !decision.SemanticCacheHit || decision.SemanticMatchedRequestID != "request-reranker-accept" {
		t.Fatalf("reranker accept + policy guard + threshold 통과면 hit이어야 함: result=%+v decision=%+v", result, decision)
	}
	if reranker.calls != 1 || !decision.RerankerApplied || !decision.RerankerPassed || decision.RerankerDecisionReason != SemanticCacheReasonRerankerPass {
		t.Fatalf("reranker accept decision field 불일치: calls=%d decision=%+v", reranker.calls, decision)
	}
}

func TestSemanticCacheRerankerFailureFallsBackToMiss(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	reranker := &deterministicTestSemanticCacheReranker{err: errors.New("reranker unavailable")}
	service, _, _ := newSemanticRerankerTestService(t, boundary, reranker)

	storeSemanticRerankerEntry(t, ctx, service, boundary, "사용량 메뉴 위치 알려줘", "request-reranker-failure")

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "사용량 메뉴 위치 알려줘",
	})
	if err != nil {
		t.Fatalf("reranker failure는 main request error로 전파되면 안 됨: %v", err)
	}
	if result.Hit || decision.SemanticCacheHit || decision.SemanticCacheDecisionReason != SemanticCacheReasonRerankerProviderFailure {
		t.Fatalf("reranker failure는 안전하게 miss/provider path로 fallback되어야 함: result=%+v decision=%+v", result, decision)
	}
	if reranker.calls != 1 || !decision.RerankerApplied || decision.RerankerPassed {
		t.Fatalf("reranker failure decision field 불일치: calls=%d decision=%+v", reranker.calls, decision)
	}
}

func TestSemanticCacheRerankerNotCalledBeforePolicyGuard(t *testing.T) {
	ctx := context.Background()
	reranker := &deterministicTestSemanticCacheReranker{
		results: []SemanticCacheRerankResult{{
			Applied: true,
			Passed:  true,
		}},
	}
	provider := &countingTestEmbeddingProvider{delegate: NewFakeEmbeddingProvider("fake-test")}
	service := NewSemanticCacheService(NewInMemorySemanticCacheStore(10), provider, SemanticCacheServiceConfig{
		Enabled:       true,
		Threshold:     0.50,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
		HitPolicy:     testSemanticHitPolicy(t),
		Reranker:      reranker,
	})

	cases := []struct {
		name           string
		category       string
		normalizedText string
	}{
		{name: "code bypass", category: SemanticCacheCategoryCode, normalizedText: "이 코드 설명해줘"},
		{name: "translation bypass", category: SemanticCacheCategoryTranslation, normalizedText: "이 문장을 영어로 번역해줘"},
		{name: "unknown bypass", category: SemanticCacheCategoryUnknown, normalizedText: "무슨 요청인지 애매한 문장"},
		{name: "dynamic usage bypass", category: SemanticCacheCategoryGeneral, normalizedText: "내 이번 달 사용량 보여줘"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			beforeRerankerCalls := reranker.calls
			beforeEmbeddingCalls := provider.calls
			boundary := testSemanticBoundary(t, func(boundary *SemanticCacheBoundary) {
				boundary.PromptCategory = tc.category
			})

			result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
				Boundary:       boundary,
				NormalizedText: tc.normalizedText,
			})
			if err != nil {
				t.Fatalf("policy guard 전 bypass search는 error 없이 miss여야 함: %v", err)
			}
			if result.Hit || decision.SemanticCacheHit {
				t.Fatalf("policy guard 전 bypass category/query는 hit되면 안 됨: result=%+v decision=%+v", result, decision)
			}
			if reranker.calls != beforeRerankerCalls {
				t.Fatalf("policy guard 전 bypass는 reranker 호출 전 종료되어야 함: before=%d after=%d", beforeRerankerCalls, reranker.calls)
			}
			if provider.calls != beforeEmbeddingCalls {
				t.Fatalf("policy guard 전 bypass는 embedding 호출 전 종료되어야 함: before=%d after=%d", beforeEmbeddingCalls, provider.calls)
			}
		})
	}
}

func TestSemanticCacheRerankerRequestDoesNotCarryRawPromptOrSecrets(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	reranker := &deterministicTestSemanticCacheReranker{
		results: []SemanticCacheRerankResult{{
			Applied: true,
			Passed:  true,
			Score:   0.91,
		}},
	}
	service, _, _ := newSemanticRerankerTestService(t, boundary, reranker)

	storeSemanticRerankerEntry(t, ctx, service, boundary, "사용량 메뉴 위치 알려줘", "request-reranker-safe-material")

	_, _, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "API 사용량 확인 화면은 어디야?",
	})
	if err != nil {
		t.Fatalf("reranker leakage 검증 search 실패: %v", err)
	}
	if reranker.calls != 1 || len(reranker.requests) != 1 {
		t.Fatalf("reranker request 1개가 캡처되어야 함: calls=%d requests=%d", reranker.calls, len(reranker.requests))
	}
	payload, err := json.Marshal(reranker.requests[0])
	if err != nil {
		t.Fatalf("reranker request marshal 실패: %v", err)
	}
	serialized := string(payload)
	for _, forbidden := range []string{
		"사용량 메뉴 위치 알려줘",
		"API 사용량 확인 화면은 어디야?",
		"OPENAI_API_KEY",
		"glm_app_token",
		"Authorization",
		"Provider Key",
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("reranker request에는 raw prompt/secret material이 남으면 안 됨: forbidden=%q payload=%s", forbidden, serialized)
		}
	}
}

func newSemanticRerankerTestService(t *testing.T, boundary SemanticCacheBoundary, reranker SemanticCacheReranker) (SemanticCacheService, *countingTestEmbeddingProvider, *InMemorySemanticCacheStore) {
	t.Helper()
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	provider := &countingTestEmbeddingProvider{delegate: NewFakeEmbeddingProvider("fake-test")}
	service := NewSemanticCacheService(store, provider, SemanticCacheServiceConfig{
		Enabled:       true,
		Threshold:     0.50,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
		HitPolicy:     testSemanticHitPolicy(t),
		Reranker:      reranker,
	})
	if err := boundary.Validate(); err != nil {
		t.Fatalf("reranker test boundary invalid: %v", err)
	}
	return service, provider, store
}

func storeSemanticRerankerEntry(t *testing.T, ctx context.Context, service SemanticCacheService, boundary SemanticCacheBoundary, normalizedText string, requestID string) {
	t.Helper()
	decision, err := service.Upsert(ctx, SemanticCacheStoreRequest{
		EntryID:        "entry-" + requestID,
		RequestID:      requestID,
		Boundary:       boundary,
		NormalizedText: normalizedText,
		CachedResponse: []byte(`{"answer":"safe response"}`),
		Now:            time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("reranker test semantic entry 저장 실패: %v", err)
	}
	if decision.SemanticCacheDecisionReason != SemanticCacheReasonStored {
		t.Fatalf("reranker test semantic entry 저장 decision 불일치: %+v", decision)
	}
}

type deterministicTestSemanticCacheReranker struct {
	results  []SemanticCacheRerankResult
	err      error
	calls    int
	requests []SemanticCacheRerankRequest
}

func (r *deterministicTestSemanticCacheReranker) Rerank(ctx context.Context, request SemanticCacheRerankRequest) (SemanticCacheRerankResult, error) {
	if err := ctx.Err(); err != nil {
		return SemanticCacheRerankResult{}, err
	}
	r.calls++
	r.requests = append(r.requests, request)
	if r.err != nil {
		return SemanticCacheRerankResult{}, r.err
	}
	if len(r.results) >= r.calls {
		return r.results[r.calls-1], nil
	}
	return SemanticCacheRerankResult{
		Applied:        true,
		Passed:         true,
		Score:          request.SemanticSimilarity,
		Threshold:      request.Threshold,
		DecisionReason: SemanticCacheReasonRerankerPass,
	}, nil
}
