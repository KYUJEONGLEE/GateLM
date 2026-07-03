package cache

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"
	"time"
)

func TestSemanticFakeEmbeddingProviderDeterministic(t *testing.T) {
	provider := NewFakeEmbeddingProvider("fake-test")
	ctx := context.Background()

	first, err := provider.Embed(ctx, EmbeddingInput{NormalizedText: "비밀번호 재설정 방법 알려줘"})
	if err != nil {
		t.Fatalf("fake embedding 생성 실패: %v", err)
	}
	second, err := provider.Embed(ctx, EmbeddingInput{NormalizedText: "비밀번호 재설정 방법 알려줘"})
	if err != nil {
		t.Fatalf("fake embedding 재생성 실패: %v", err)
	}
	if !reflect.DeepEqual(first.Vector, second.Vector) {
		t.Fatalf("FakeEmbeddingProvider는 같은 normalized input에 대해 deterministic vector를 반환해야 함")
	}

	similar, err := provider.Embed(ctx, EmbeddingInput{NormalizedText: "패스워드 초기화는 어떻게 해?"})
	if err != nil {
		t.Fatalf("similar embedding 생성 실패: %v", err)
	}
	similarity, err := CosineSimilarity(first.Vector, similar.Vector)
	if err != nil {
		t.Fatalf("similar cosine 계산 실패: %v", err)
	}
	if similarity < 0.92 {
		t.Fatalf("비밀번호 재설정 유사 문장은 threshold 이상이어야 함: got %f", similarity)
	}

	unrelated, err := provider.Embed(ctx, EmbeddingInput{NormalizedText: "사용량 메뉴 위치 알려줘"})
	if err != nil {
		t.Fatalf("unrelated embedding 생성 실패: %v", err)
	}
	unrelatedSimilarity, err := CosineSimilarity(first.Vector, unrelated.Vector)
	if err != nil {
		t.Fatalf("unrelated cosine 계산 실패: %v", err)
	}
	if unrelatedSimilarity >= 0.92 {
		t.Fatalf("사용량 메뉴 위치 문장은 password reset threshold 미만이어야 함: got %f", unrelatedSimilarity)
	}

	refundFirst, err := provider.Embed(ctx, EmbeddingInput{NormalizedText: "배송비도 환불되나요?"})
	if err != nil {
		t.Fatalf("support_refund 첫 embedding 생성 실패: %v", err)
	}
	refundSecond, err := provider.Embed(ctx, EmbeddingInput{NormalizedText: "반품하면 배송비도 돌려받나요?"})
	if err != nil {
		t.Fatalf("support_refund 유사 embedding 생성 실패: %v", err)
	}
	refundSimilarity, err := CosineSimilarity(refundFirst.Vector, refundSecond.Vector)
	if err != nil {
		t.Fatalf("support_refund cosine 계산 실패: %v", err)
	}
	if refundSimilarity < 0.92 {
		t.Fatalf("support_refund 유사 문장은 threshold 이상이어야 함: got %f", refundSimilarity)
	}
}

func TestSemanticCosineSimilarity(t *testing.T) {
	identical, err := CosineSimilarity([]float64{1, 0}, []float64{1, 0})
	if err != nil {
		t.Fatalf("identical cosine 계산 실패: %v", err)
	}
	if math.Abs(identical-1) > 0.0000001 {
		t.Fatalf("identical cosine은 1이어야 함: got %f", identical)
	}

	similar, err := CosineSimilarity([]float64{1, 0.1}, []float64{1, 0.2})
	if err != nil {
		t.Fatalf("similar cosine 계산 실패: %v", err)
	}
	if similar < 0.98 {
		t.Fatalf("가까운 vector는 높은 유사도여야 함: got %f", similar)
	}

	unrelated, err := CosineSimilarity([]float64{1, 0}, []float64{0, 1})
	if err != nil {
		t.Fatalf("unrelated cosine 계산 실패: %v", err)
	}
	if unrelated != 0 {
		t.Fatalf("직교 vector cosine은 0이어야 함: got %f", unrelated)
	}

	if _, err := CosineSimilarity(nil, []float64{1}); !errors.Is(err, ErrSemanticVectorEmpty) {
		t.Fatalf("empty vector는 명시 에러여야 함: %v", err)
	}
	if _, err := CosineSimilarity([]float64{1}, []float64{1, 2}); !errors.Is(err, ErrSemanticVectorDimensionMismatch) {
		t.Fatalf("dimension mismatch는 명시 에러여야 함: %v", err)
	}
	if _, err := CosineSimilarity([]float64{0, 0}, []float64{1, 0}); !errors.Is(err, ErrSemanticVectorZero) {
		t.Fatalf("zero magnitude vector는 명시 에러여야 함: %v", err)
	}
}

func TestSemanticInMemoryStoreHit(t *testing.T) {
	ctx := context.Background()
	provider := NewFakeEmbeddingProvider("fake-test")
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	entryVector := testSemanticVector(t, provider, "비밀번호 재설정 방법 알려줘")
	err := store.Upsert(ctx, testSemanticEntry("entry-1", "request-1", boundary, entryVector, now, now.Add(time.Hour)))
	if err != nil {
		t.Fatalf("semantic entry 저장 실패: %v", err)
	}

	queryVector := testSemanticVector(t, provider, "패스워드 초기화는 어떻게 해?")
	result, err := store.Search(ctx, boundary, queryVector, 0.92, 3)
	if err != nil {
		t.Fatalf("semantic search 실패: %v", err)
	}
	if !result.Hit || result.MatchedEntry == nil {
		t.Fatalf("같은 boundary의 유사 문장은 semantic cache hit이어야 함: %+v", result)
	}
	if result.MatchedEntry.RequestID != "request-1" {
		t.Fatalf("matched request id 불일치: got %q", result.MatchedEntry.RequestID)
	}
	if result.Similarity < 0.92 {
		t.Fatalf("hit similarity는 threshold 이상이어야 함: got %f", result.Similarity)
	}
}

func TestSemanticInMemoryStoreMissByThreshold(t *testing.T) {
	ctx := context.Background()
	provider := NewFakeEmbeddingProvider("fake-test")
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	err := store.Upsert(ctx, testSemanticEntry("entry-1", "request-1", boundary, testSemanticVector(t, provider, "비밀번호 재설정 방법 알려줘"), now, now.Add(time.Hour)))
	if err != nil {
		t.Fatalf("semantic entry 저장 실패: %v", err)
	}

	result, err := store.Search(ctx, boundary, testSemanticVector(t, provider, "사용량 메뉴 위치 알려줘"), 0.92, 3)
	if err != nil {
		t.Fatalf("semantic search 실패: %v", err)
	}
	if result.Hit {
		t.Fatalf("threshold 미만 문장은 miss여야 함: %+v", result)
	}
	if result.Reason != SemanticCacheReasonThresholdMiss {
		t.Fatalf("miss reason 불일치: got %q", result.Reason)
	}
}

func TestSemanticInMemoryStoreMissByBoundary(t *testing.T) {
	ctx := context.Background()
	provider := NewFakeEmbeddingProvider("fake-test")
	baseBoundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	err := store.Upsert(ctx, testSemanticEntry("entry-1", "request-1", baseBoundary, testSemanticVector(t, provider, "비밀번호 재설정 방법 알려줘"), now, now.Add(time.Hour)))
	if err != nil {
		t.Fatalf("semantic entry 저장 실패: %v", err)
	}
	queryVector := testSemanticVector(t, provider, "패스워드 초기화는 어떻게 해?")

	cases := map[string]func(*SemanticCacheBoundary){
		"tenantId":                   func(b *SemanticCacheBoundary) { b.TenantID = "tenant-other" },
		"projectId":                  func(b *SemanticCacheBoundary) { b.ProjectID = "project-other" },
		"applicationId":              func(b *SemanticCacheBoundary) { b.ApplicationID = "application-other" },
		"promptCategory":             func(b *SemanticCacheBoundary) { b.PromptCategory = "code" },
		"selectedProviderId":         func(b *SemanticCacheBoundary) { b.SelectedProviderID = "provider-other" },
		"selectedModelId":            func(b *SemanticCacheBoundary) { b.SelectedModelID = "model-other" },
		"providerCatalogContentHash": func(b *SemanticCacheBoundary) { b.ProviderCatalogContentHash = "catalog-other" },
		"routingPolicyHash":          func(b *SemanticCacheBoundary) { b.RoutingPolicyHash = "routing-other" },
		"routingDecisionKeyHash":     func(b *SemanticCacheBoundary) { b.RoutingDecisionKeyHash = "decision-other" },
		"semanticCachePolicyHash":    func(b *SemanticCacheBoundary) { b.SemanticCachePolicyHash = "semantic-policy-other" },
		"safetyPolicyHash":           func(b *SemanticCacheBoundary) { b.SafetyPolicyHash = "safety-other" },
		"maskingPolicyHash":          func(b *SemanticCacheBoundary) { b.MaskingPolicyHash = "masking-other" },
		"requestParamsHash":          func(b *SemanticCacheBoundary) { b.RequestParamsHash = "params-other" },
		"cacheVersion":               func(b *SemanticCacheBoundary) { b.CacheVersion = "v2" },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			boundary := testSemanticBoundary(t, mutate)
			result, err := store.Search(ctx, boundary, queryVector, 0.92, 3)
			if err != nil {
				t.Fatalf("semantic search 실패: %v", err)
			}
			if result.Hit {
				t.Fatalf("%s가 다르면 semantic cache miss여야 함: %+v", name, result)
			}
			if result.Reason != SemanticCacheReasonNoBoundaryMatch {
				t.Fatalf("boundary miss reason 불일치: got %q", result.Reason)
			}
		})
	}
}

func TestSemanticInMemoryStoreTTLExpired(t *testing.T) {
	ctx := context.Background()
	provider := NewFakeEmbeddingProvider("fake-test")
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	store.now = func() time.Time { return now }

	err := store.Upsert(ctx, testSemanticEntry("entry-1", "request-1", boundary, testSemanticVector(t, provider, "비밀번호 재설정 방법 알려줘"), now.Add(-2*time.Hour), now.Add(-time.Hour)))
	if err != nil {
		t.Fatalf("semantic entry 저장 실패: %v", err)
	}

	result, err := store.Search(ctx, boundary, testSemanticVector(t, provider, "패스워드 초기화는 어떻게 해?"), 0.92, 3)
	if err != nil {
		t.Fatalf("semantic search 실패: %v", err)
	}
	if result.Hit {
		t.Fatalf("TTL 만료 entry는 miss여야 함: %+v", result)
	}
	if _, ok := store.entries["entry-1"]; ok {
		t.Fatalf("TTL 만료 entry는 search 중 제거되어야 함")
	}
}

func TestSemanticInMemoryStoreTopKOrdering(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	entries := []struct {
		entryID string
		vector  []float64
	}{
		{entryID: "entry-worst", vector: []float64{0.93, 0.07}},
		{entryID: "entry-best", vector: []float64{1, 0}},
		{entryID: "entry-middle", vector: []float64{0.97, 0.03}},
	}
	for index, entry := range entries {
		err := store.Upsert(ctx, testSemanticEntry(entry.entryID, "request-"+entry.entryID, boundary, entry.vector, now.Add(time.Duration(index)*time.Second), now.Add(time.Hour)))
		if err != nil {
			t.Fatalf("semantic entry 저장 실패: %v", err)
		}
	}

	result, err := store.Search(ctx, boundary, []float64{1, 0}, 0.90, 2)
	if err != nil {
		t.Fatalf("semantic search 실패: %v", err)
	}
	if !result.Hit || len(result.Matches) != 2 {
		t.Fatalf("topK=2 search 결과 불일치: %+v", result)
	}
	if result.Matches[0].Entry.EntryID != "entry-best" || result.Matches[1].Entry.EntryID != "entry-middle" {
		t.Fatalf("similarity 내림차순 topK 정렬 불일치: %+v", result.Matches)
	}
}

func TestSemanticInMemoryStoreMaxEntriesPolicy(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(2)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	for i, entryID := range []string{"entry-oldest", "entry-middle", "entry-newest"} {
		err := store.Upsert(ctx, testSemanticEntry(entryID, "request-"+entryID, boundary, []float64{1, float64(i) / 100}, now.Add(time.Duration(i)*time.Minute), now.Add(time.Hour)))
		if err != nil {
			t.Fatalf("semantic entry 저장 실패: %v", err)
		}
	}

	if len(store.entries) != 2 {
		t.Fatalf("maxEntries=2를 초과하면 안 됨: got %d", len(store.entries))
	}
	if _, ok := store.entries["entry-oldest"]; ok {
		t.Fatalf("maxEntries 초과 시 가장 오래된 entry가 제거되어야 함")
	}
	if _, ok := store.entries["entry-middle"]; !ok {
		t.Fatalf("entry-middle은 남아 있어야 함")
	}
	if _, ok := store.entries["entry-newest"]; !ok {
		t.Fatalf("entry-newest는 남아 있어야 함")
	}
}

func TestSemanticInMemoryStoreDirectInitUpsertInitializesEntries(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	store := &InMemorySemanticCacheStore{}
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }

	err := store.Upsert(ctx, testSemanticEntry("entry-direct", "request-direct", boundary, []float64{1, 0}, now, now.Add(time.Hour)))
	if err != nil {
		t.Fatalf("직접 초기화한 store도 panic 없이 저장되어야 함: %v", err)
	}
	if len(store.entries) != 1 {
		t.Fatalf("직접 초기화한 store의 entries map이 초기화되어야 함: got %d", len(store.entries))
	}

	result, err := store.Search(ctx, boundary, []float64{1, 0}, 0.90, 1)
	if err != nil {
		t.Fatalf("직접 초기화한 store search 실패: %v", err)
	}
	if !result.Hit || result.MatchedEntry == nil || result.MatchedEntry.RequestID != "request-direct" {
		t.Fatalf("직접 초기화한 store에서도 저장된 entry가 조회되어야 함: %+v", result)
	}
}

func TestSemanticInMemoryStoreRejectsForbiddenSensitivePayload(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)

	cases := map[string]string{
		"raw prompt":                 "raw prompt=비밀번호 재설정 방법 알려줘",
		"raw PII":                    "raw PII=010-1234-5678",
		"API Key":                    "api_key=test-secret",
		"App Token":                  "app_token=test-secret",
		"Provider Key":               "provider_key=test-secret",
		"Authorization header":       "Authorization: Bearer token",
		"provider raw error":         "provider raw error={\"error\":\"secret\"}",
		"provider raw response body": "provider raw response body={\"answer\":\"secret\"}",
	}

	for name, payload := range cases {
		t.Run(name, func(t *testing.T) {
			store := NewInMemorySemanticCacheStore(10)
			entry := testSemanticEntry("entry-secret", "request-secret", boundary, []float64{1, 0}, now, now.Add(time.Hour))
			entry.CachedResponse = []byte(payload)

			err := store.Upsert(ctx, entry)
			if !errors.Is(err, ErrSemanticCachePayloadUnsafe) {
				t.Fatalf("%s는 저장 차단되어야 함: %v", name, err)
			}
			if len(store.entries) != 0 {
				t.Fatalf("unsafe payload는 in-memory store에 남으면 안 됨")
			}
		})
	}
}

func TestSemanticCacheServiceNormalizesInputInternally(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	service := NewSemanticCacheService(store, NewFakeEmbeddingProvider("fake-test"), SemanticCacheServiceConfig{
		Enabled:       true,
		Threshold:     0.92,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
		HitPolicy:     testSemanticHitPolicy(t),
	})

	decision, err := service.Upsert(ctx, SemanticCacheStoreRequest{
		EntryID:        "entry-normalized",
		RequestID:      "request-normalized",
		Boundary:       boundary,
		NormalizedText: "  PASSWORD    RESET  ",
		CachedResponse: []byte(`{"answer":"safe response"}`),
		Now:            now,
	})
	if err != nil {
		t.Fatalf("정규화 전 입력도 service 내부에서 canonical normalize 후 저장되어야 함: %v", err)
	}
	if decision.SemanticCacheDecisionReason != SemanticCacheReasonStored {
		t.Fatalf("store decision reason 불일치: %+v", decision)
	}

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "password reset",
	})
	if err != nil {
		t.Fatalf("정규화된 query search 실패: %v", err)
	}
	if !result.Hit || !decision.SemanticCacheHit || decision.SemanticMatchedRequestID != "request-normalized" {
		t.Fatalf("service 내부 정규화 후 같은 의미 입력은 hit이어야 함: result=%+v decision=%+v", result, decision)
	}
}

func TestSemanticCacheServiceRequiresIntentMaterialForHit(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	provider := NewFakeEmbeddingProvider("fake-test")
	service := NewSemanticCacheService(store, provider, SemanticCacheServiceConfig{
		Enabled:       true,
		Threshold:     0.92,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
		HitPolicy:     testSemanticHitPolicy(t),
	})

	legacyEntry := testSemanticEntry("entry-legacy", "request-legacy", boundary, testSemanticVector(t, provider, "비밀번호 재설정 방법 알려줘"), now, now.Add(time.Hour))
	if err := store.Upsert(ctx, legacyEntry); err != nil {
		t.Fatalf("legacy semantic entry 저장 실패: %v", err)
	}

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "패스워드 초기화는 어떻게 해?",
	})
	if err != nil {
		t.Fatalf("semantic search 실패: %v", err)
	}
	if result.Hit || decision.SemanticCacheHit {
		t.Fatalf("intent material 없는 legacy entry는 similarity가 높아도 hit 금지여야 함: result=%+v decision=%+v", result, decision)
	}
	if decision.SemanticCacheDecisionReason != SemanticCacheReasonIntentMaterialMissing {
		t.Fatalf("legacy entry miss reason 불일치: %+v", decision)
	}
}

func TestSemanticCacheServiceUpsertReusesProvidedEmbeddingVector(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	store := NewInMemorySemanticCacheStore(10)
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	provider := &countingTestEmbeddingProvider{delegate: NewFakeEmbeddingProvider("fake-test")}
	service := NewSemanticCacheService(store, provider, SemanticCacheServiceConfig{
		Enabled:       true,
		Threshold:     0.92,
		TopK:          3,
		TTL:           time.Hour,
		PolicyVersion: "v1",
		HitPolicy:     testSemanticHitPolicy(t),
	})

	result, decision, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "비밀번호 재설정 방법 알려줘",
	})
	if err != nil {
		t.Fatalf("semantic search 실패: %v", err)
	}
	if result.Hit || len(result.QueryVector) == 0 || decision.SemanticCacheDecisionReason != SemanticCacheReasonNoBoundaryMatch {
		t.Fatalf("첫 lookup은 miss이고 query vector를 반환해야 함: result=%+v decision=%+v", result, decision)
	}
	if provider.calls != 1 {
		t.Fatalf("lookup에서 embedding을 1회 생성해야 함: got %d", provider.calls)
	}

	decision, err = service.Upsert(ctx, SemanticCacheStoreRequest{
		EntryID:         "entry-reuse",
		RequestID:       "request-reuse",
		Boundary:        boundary,
		NormalizedText:  "비밀번호 재설정 방법 알려줘",
		EmbeddingVector: result.QueryVector,
		CachedResponse:  []byte(`{"answer":"normalized safe response"}`),
		Now:             now,
	})
	if err != nil {
		t.Fatalf("semantic upsert 실패: %v", err)
	}
	if decision.SemanticCacheDecisionReason != SemanticCacheReasonStored {
		t.Fatalf("store decision reason 불일치: %+v", decision)
	}
	if provider.calls != 1 {
		t.Fatalf("제공된 embedding vector가 있으면 store에서 embedding을 재생성하면 안 됨: got %d", provider.calls)
	}
}

func TestSemanticCacheServiceStoreEligibilityPolicy(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)

	cases := []struct {
		name              string
		category          string
		normalizedText    string
		cachedResponse    []byte
		cacheabilityClass string
		providerOutcome   string
		fallbackUsed      bool
		stream            bool
		wantReason        string
		wantStored        bool
		wantEmbeddingCall bool
	}{
		{
			name:              "cacheable password reset FAQ stores",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"비밀번호 재설정 메뉴에서 재설정 메일을 요청할 수 있습니다."}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonStored,
			wantStored:        true,
			wantEmbeddingCall: true,
		},
		{
			name:              "usage number response bypasses store",
			category:          "general",
			normalizedText:    "이번 달 사용량 통계를 보여줘",
			cachedResponse:    []byte(`{"answer":"이번 달 사용량: 12345 tokens"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonDynamicUserState,
		},
		{
			name:              "account status response bypasses store",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"계정 상태: 잠김"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonDynamicUserState,
		},
		{
			name:              "refund status response bypasses store",
			category:          "support_refund",
			normalizedText:    "배송비도 환불되나요?",
			cachedResponse:    []byte(`{"answer":"환불 상태: 처리 중"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityPolicySummary,
			wantReason:        SemanticCacheReasonDynamicUserState,
		},
		{
			name:              "credential marker response bypasses store",
			category:          "account_access",
			normalizedText:    "API Key 발급 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"api_key=test-secret"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonPayloadUnsafe,
		},
		{
			name:              "authorization marker response bypasses store",
			category:          "account_access",
			normalizedText:    "App Token 생성은 어디서 해?",
			cachedResponse:    []byte(`{"answer":"Authorization: Bearer token"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonPayloadUnsafe,
		},
		{
			name:              "app token marker response bypasses store",
			category:          "account_access",
			normalizedText:    "App Token 생성은 어디서 해?",
			cachedResponse:    []byte(`{"answer":"app_token=test-secret"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonPayloadUnsafe,
		},
		{
			name:              "provider key marker response bypasses store",
			category:          "account_access",
			normalizedText:    "API Key 발급 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"provider_key=test-secret"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonPayloadUnsafe,
		},
		{
			name:              "raw prompt marker response bypasses store",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"raw prompt must not be cached"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonPayloadUnsafe,
		},
		{
			name:              "raw response marker response bypasses store",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"raw response must not be cached"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonPayloadUnsafe,
		},
		{
			name:           "unknown cacheability response bypasses store",
			category:       "account_access",
			normalizedText: "비밀번호 재설정 방법 알려줘",
			cachedResponse: []byte(`{"answer":"safe looking but unclassified response"}`),
			wantReason:     SemanticCacheReasonResponseNotCacheable,
		},
		{
			name:              "fallback response bypasses store",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"fallback safe response"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			fallbackUsed:      true,
			wantReason:        SemanticCacheReasonFallbackResponse,
		},
		{
			name:              "provider error response bypasses store",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"provider failed"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityProviderError,
			providerOutcome:   SemanticCacheProviderOutcomeError,
			wantReason:        SemanticCacheReasonProviderError,
		},
		{
			name:              "stream response bypasses store",
			category:          "account_access",
			normalizedText:    "비밀번호 재설정 방법 알려줘",
			cachedResponse:    []byte(`{"answer":"stream response"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			stream:            true,
			wantReason:        SemanticCacheReasonStreamingResponse,
		},
		{
			name:              "code category bypasses store",
			category:          "code",
			normalizedText:    "이 코드 설명해줘",
			cachedResponse:    []byte(`{"answer":"code response"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonCategoryDisabled,
		},
		{
			name:              "translation category bypasses store",
			category:          "translation",
			normalizedText:    "이 문장을 영어로 번역해줘",
			cachedResponse:    []byte(`{"answer":"translation response"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonCategoryDisabled,
		},
		{
			name:              "unknown category bypasses store",
			category:          "unknown",
			normalizedText:    "분류하기 어려운 요청",
			cachedResponse:    []byte(`{"answer":"unknown response"}`),
			cacheabilityClass: SemanticCacheResponseCacheabilityStaticGuidance,
			wantReason:        SemanticCacheReasonCategoryDisabled,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := NewInMemorySemanticCacheStore(10)
			store.now = func() time.Time { return now }
			provider := &countingTestEmbeddingProvider{delegate: NewFakeEmbeddingProvider("fake-test")}
			service := NewSemanticCacheService(store, provider, SemanticCacheServiceConfig{
				Enabled:       true,
				Threshold:     0.92,
				TopK:          3,
				TTL:           time.Hour,
				PolicyVersion: "v1",
				HitPolicy:     testSemanticHitPolicy(t),
				StorePolicy:   testSemanticStorePolicy(),
			})
			boundary := testSemanticBoundary(t, func(b *SemanticCacheBoundary) {
				b.PromptCategory = tc.category
			})

			decision, err := service.Upsert(ctx, SemanticCacheStoreRequest{
				EntryID:                   "entry-" + tc.name,
				RequestID:                 "request-" + tc.name,
				Boundary:                  boundary,
				NormalizedText:            tc.normalizedText,
				CachedResponse:            tc.cachedResponse,
				ResponseCacheabilityClass: tc.cacheabilityClass,
				ProviderOutcome:           tc.providerOutcome,
				FallbackUsed:              tc.fallbackUsed,
				Stream:                    tc.stream,
				Now:                       now,
			})
			if err != nil {
				t.Fatalf("store eligibility bypass는 에러로 승격되면 안 됨: %v", err)
			}
			if decision.SemanticCacheDecisionReason != tc.wantReason {
				t.Fatalf("store decision reason 불일치: got=%q want=%q decision=%+v", decision.SemanticCacheDecisionReason, tc.wantReason, decision)
			}
			if gotStored := len(store.entries) == 1; gotStored != tc.wantStored {
				t.Fatalf("store 여부 불일치: got=%v want=%v entries=%d", gotStored, tc.wantStored, len(store.entries))
			}
			if gotEmbeddingCall := provider.calls > 0; gotEmbeddingCall != tc.wantEmbeddingCall {
				t.Fatalf("embedding 호출 여부 불일치: got=%v calls=%d want=%v", gotEmbeddingCall, provider.calls, tc.wantEmbeddingCall)
			}
		})
	}
}

func TestSemanticCacheServiceRejectsForbiddenInputAfterNormalization(t *testing.T) {
	ctx := context.Background()
	boundary := testSemanticBoundary(t, nil)
	service := NewSemanticCacheService(NewInMemorySemanticCacheStore(10), NewFakeEmbeddingProvider("fake-test"), SemanticCacheServiceConfig{
		Enabled:   true,
		HitPolicy: testSemanticHitPolicy(t),
	})

	_, _, err := service.Search(ctx, SemanticCacheLookupRequest{
		Boundary:       boundary,
		NormalizedText: "  RAW    PROMPT = customer secret  ",
	})
	if !errors.Is(err, ErrSemanticCacheInputUnsafe) {
		t.Fatalf("금지 material은 내부 정규화 후에도 차단되어야 함: %v", err)
	}
}

func TestSemanticCacheFactoryRejectsUnknownImplementations(t *testing.T) {
	if _, err := NewSemanticCacheStore("qdrant", 10); err == nil {
		t.Fatalf("지원하지 않는 semantic cache store는 에러여야 함")
	}
	if _, err := NewSemanticCacheEmbeddingProvider("unknown", "text-embedding-3-small"); err == nil {
		t.Fatalf("지원하지 않는 embedding provider는 에러여야 함")
	}
}

func TestSemanticCacheCategoryPolicyAllowsRoutingMVPAllowlist(t *testing.T) {
	policy := NewSemanticCacheCategoryPolicy(
		[]string{"general", "support_refund"},
		[]string{"code", "translation", "summarization", "extraction_json", "reasoning", "sensitive", "tool_call", "unknown"},
	)

	for _, category := range []string{"general", "support_refund"} {
		t.Run(category, func(t *testing.T) {
			if !policy.Allows(category) {
				t.Fatalf("SC-CATEGORY-002 %q는 Semantic Cache 후보가 될 수 있어야 함", category)
			}
		})
	}
}

func TestSemanticCacheCategoryPolicyDeniesRiskyCategories(t *testing.T) {
	policy := NewSemanticCacheCategoryPolicy(
		[]string{"general", "support_refund"},
		[]string{"code", "translation", "summarization", "extraction_json", "reasoning", "sensitive", "tool_call", "unknown"},
	)

	for _, category := range []string{"code", "translation", "summarization", "extraction_json", "reasoning", "sensitive", "tool_call", "unknown"} {
		t.Run(category, func(t *testing.T) {
			if policy.Allows(category) {
				t.Fatalf("SC-CATEGORY-003 %q는 Semantic Cache에서 bypass되어야 함", category)
			}
		})
	}
}

func TestSemanticCacheCategoryPolicyDeniesUnknownCategoryValues(t *testing.T) {
	policy := NewSemanticCacheCategoryPolicy(
		[]string{"general", "support_refund"},
		[]string{"code", "translation", "summarization", "extraction_json", "reasoning", "sensitive", "tool_call", "unknown"},
	)

	for _, category := range []string{"faq", "simple_chat", "billing", "", " GENERAL "} {
		t.Run(category, func(t *testing.T) {
			allowed := policy.Allows(category)
			if category == " GENERAL " {
				if !allowed {
					t.Fatalf("known category는 canonical normalize 후 허용되어야 함")
				}
				return
			}
			if allowed {
				t.Fatalf("SC-CATEGORY-004 알 수 없는 category %q는 안전하게 bypass되어야 함", category)
			}
		})
	}
}

func testSemanticBoundary(t *testing.T, mutate func(*SemanticCacheBoundary)) SemanticCacheBoundary {
	t.Helper()
	boundary := SemanticCacheBoundary{
		TenantID:                   "tenant-1",
		ProjectID:                  "project-1",
		ApplicationID:              "application-1",
		PromptCategory:             "general",
		SelectedProviderID:         "provider-1",
		SelectedModelID:            "model-1",
		ProviderCatalogContentHash: "catalog-hash-1",
		RoutingPolicyHash:          "routing-policy-1",
		RoutingDecisionKeyHash:     "routing-decision-1",
		SemanticCachePolicyHash:    "semantic-policy-1",
		SafetyPolicyHash:           "safety-policy-1",
		MaskingPolicyHash:          "masking-policy-1",
		RequestParamsHash:          "params-1",
		CacheVersion:               "semantic-v1",
	}
	if mutate != nil {
		mutate(&boundary)
	}
	if err := boundary.Validate(); err != nil {
		t.Fatalf("테스트 boundary가 유효해야 함: %v", err)
	}
	return boundary
}

func testSemanticVector(t *testing.T, provider FakeEmbeddingProvider, normalizedText string) []float64 {
	t.Helper()
	result, err := provider.Embed(context.Background(), EmbeddingInput{NormalizedText: normalizedText})
	if err != nil {
		t.Fatalf("test embedding 생성 실패: %v", err)
	}
	return result.Vector
}

func testSemanticEntry(entryID string, requestID string, boundary SemanticCacheBoundary, vector []float64, createdAt time.Time, expiresAt time.Time) SemanticCacheEntry {
	return SemanticCacheEntry{
		EntryID:                    entryID,
		RequestID:                  requestID,
		Boundary:                   boundary,
		EmbeddingVector:            append([]float64{}, vector...),
		CachedResponse:             []byte(`{"answer":"normalized safe response"}`),
		CreatedAt:                  createdAt,
		ExpiresAt:                  expiresAt,
		SemanticCachePolicyVersion: "v1",
	}
}

func testSemanticStorePolicy() *SemanticCacheStorePolicy {
	return &SemanticCacheStorePolicy{
		PolicyVersion: "store-v1",
		DefaultMode:   SemanticCacheStoreModeDisabled,
		Categories: map[string]SemanticCacheCategoryStorePolicy{
			"account_access": {
				Mode:                          SemanticCacheStoreModeStrictStore,
				AllowCacheabilityClasses:      []string{SemanticCacheResponseCacheabilityStaticGuidance},
				RequiresIntent:                true,
				RequiresRequiredSlots:         true,
				RequiresForbiddenPayloadGuard: true,
				RequiresProviderSuccess:       true,
				DenyFallback:                  true,
				DenyStream:                    true,
			},
			"general": {
				Mode:                          SemanticCacheStoreModeStrictStore,
				AllowCacheabilityClasses:      []string{SemanticCacheResponseCacheabilityStaticGuidance},
				RequiresIntent:                true,
				RequiresRequiredSlots:         true,
				RequiresForbiddenPayloadGuard: true,
				RequiresProviderSuccess:       true,
				DenyFallback:                  true,
				DenyStream:                    true,
			},
			"support_refund": {
				Mode:                          SemanticCacheStoreModeStrictStore,
				AllowCacheabilityClasses:      []string{SemanticCacheResponseCacheabilityPolicySummary},
				RequiresIntent:                true,
				RequiresRequiredSlots:         true,
				RequiresForbiddenPayloadGuard: true,
				RequiresProviderSuccess:       true,
				DenyFallback:                  true,
				DenyStream:                    true,
			},
			"code": {
				Mode: SemanticCacheStoreModeDisabled,
			},
			"translation": {
				Mode: SemanticCacheStoreModeDisabled,
			},
			"unknown": {
				Mode: SemanticCacheStoreModeDisabled,
			},
		},
	}
}

type countingTestEmbeddingProvider struct {
	delegate FakeEmbeddingProvider
	calls    int
}

func (p *countingTestEmbeddingProvider) Embed(ctx context.Context, input EmbeddingInput) (EmbeddingResult, error) {
	p.calls++
	return p.delegate.Embed(ctx, input)
}

func (p *countingTestEmbeddingProvider) ProviderName() string {
	return p.delegate.ProviderName()
}

func (p *countingTestEmbeddingProvider) ModelName() string {
	return p.delegate.ModelName()
}
