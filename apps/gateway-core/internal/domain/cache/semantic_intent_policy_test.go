package cache

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type semanticIntentEvalDataset struct {
	DatasetID string                   `json:"datasetId"`
	Cases     []semanticIntentEvalCase `json:"cases"`
}

type semanticIntentEvalCase struct {
	CaseID                string            `json:"caseId"`
	PairType              string            `json:"pairType"`
	Category              string            `json:"category"`
	CanonicalIntent       string            `json:"canonicalIntent"`
	First                 string            `json:"first"`
	Second                string            `json:"second"`
	FirstCanonicalIntent  string            `json:"firstCanonicalIntent"`
	SecondCanonicalIntent string            `json:"secondCanonicalIntent"`
	RequiredSlots         map[string]string `json:"requiredSlots"`
	OptionalSlots         map[string]string `json:"optionalSlots"`
	SameAnswerReusable    bool              `json:"sameAnswerReusable"`
	HardNegative          bool              `json:"hardNegative"`
	DenyCategory          bool              `json:"denyCategory"`
	ExpectedDecision      string            `json:"expectedDecision"`
	Reason                string            `json:"reason"`
}

func TestSemanticCacheHitPolicyMaterializesKoreanPasswordReset(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	first, decision := policy.Materialize(SemanticCacheCategoryGeneral, "비밀번호 재설정 방법 알려줘")
	if !decision.Allowed || first.CanonicalIntent != "account.password_reset" {
		t.Fatalf("비밀번호 재설정 요청은 account.password_reset material이어야 함: material=%+v decision=%+v", first, decision)
	}
	second, decision := policy.Materialize(SemanticCacheCategoryGeneral, "패스워드 초기화는 어떻게 해?")
	if !decision.Allowed || second.CanonicalIntent != "account.password_reset" {
		t.Fatalf("패스워드 초기화 요청은 account.password_reset material이어야 함: material=%+v decision=%+v", second, decision)
	}
	if first.RequiredSlotsHash == "" || first.RequiredSlotsHash != second.RequiredSlotsHash {
		t.Fatalf("password reset pair는 같은 requiredSlotsHash여야 함: first=%+v second=%+v", first, second)
	}
}

func TestSemanticCacheHitPolicyRejectsSupportRefundHardNegative(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	refund, decision := policy.Materialize(SemanticCacheCategorySupportRefund, "배송비도 환불되나요?")
	if !decision.Allowed || refund.CanonicalIntent != "support_refund.shipping_fee_refund" {
		t.Fatalf("배송비 환불 요청 material 불일치: material=%+v decision=%+v", refund, decision)
	}
	cancel, decision := policy.Materialize(SemanticCacheCategorySupportRefund, "주문 취소하고 싶어요")
	if !decision.Allowed || cancel.CanonicalIntent != "support_refund.order_cancel" {
		t.Fatalf("주문 취소 요청 material 불일치: material=%+v decision=%+v", cancel, decision)
	}

	hitDecision := policy.Evaluate(cancel, refund, 0.99, 0.92)
	if hitDecision.ProviderBypassAllowed || hitDecision.Reason != SemanticCacheReasonHardNegative {
		t.Fatalf("support_refund hard negative는 similarity가 높아도 hit 금지여야 함: %+v", hitDecision)
	}
}

func TestSemanticCacheHitPolicyUsesCategoryThresholdsFromKoreanPolicy(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	if policy.DefaultThreshold != 0.92 {
		t.Fatalf("defaultThreshold는 보수 기본값으로 유지되어야 함: got=%f", policy.DefaultThreshold)
	}
	cases := map[string]float64{
		SemanticCacheCategoryAccountAccess: 0.50,
		SemanticCacheCategoryGeneral:       0.50,
		SemanticCacheCategorySupportRefund: 0.70,
		SemanticCacheCategoryTranslation:   0.92,
		SemanticCacheCategoryCode:          0.92,
		SemanticCacheCategoryUnknown:       0.92,
	}
	for category, want := range cases {
		t.Run(category, func(t *testing.T) {
			if got := policy.CategoryThreshold(category, policy.DefaultThreshold); got != want {
				t.Fatalf("categoryThreshold 불일치: category=%s got=%f want=%f", category, got, want)
			}
		})
	}
}

func TestSemanticCacheHitPolicyAppliesCategoryThresholdAfterIntentGuards(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	passwordReset := mustMaterializeText(t, policy, SemanticCacheCategoryAccountAccess, "비밀번호 재설정 방법 알려줘")
	passwordInit := mustMaterializeText(t, policy, SemanticCacheCategoryAccountAccess, "패스워드 초기화는 어떻게 해?")
	assertPolicyDecision(t, policy.Evaluate(passwordInit, passwordReset, 0.49, policy.DefaultThreshold), false, SemanticCacheReasonThresholdMiss)
	assertPolicyDecision(t, policy.Evaluate(passwordInit, passwordReset, 0.50, policy.DefaultThreshold), true, SemanticCacheReasonHit)

	usageMenu := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "사용량은 어디서 확인해?")
	usageStats := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "이번 달 사용량 통계를 보여줘")
	assertPolicyDecision(t, policy.Evaluate(usageStats, usageMenu, 0.49, policy.DefaultThreshold), false, SemanticCacheReasonThresholdMiss)
	assertPolicyDecision(t, policy.Evaluate(usageStats, usageMenu, 0.50, policy.DefaultThreshold), true, SemanticCacheReasonHit)

	shippingRefund := mustMaterializeText(t, policy, SemanticCacheCategorySupportRefund, "배송비도 환불되나요?")
	returnShippingRefund := mustMaterializeText(t, policy, SemanticCacheCategorySupportRefund, "반품하면 배송비도 돌려받나요?")
	assertPolicyDecision(t, policy.Evaluate(returnShippingRefund, shippingRefund, 0.69, policy.DefaultThreshold), false, SemanticCacheReasonThresholdMiss)
	assertPolicyDecision(t, policy.Evaluate(returnShippingRefund, shippingRefund, 0.70, policy.DefaultThreshold), true, SemanticCacheReasonHit)

	orderCancel := mustMaterializeText(t, policy, SemanticCacheCategorySupportRefund, "주문 취소하고 싶어요")
	hardNegative := policy.Evaluate(orderCancel, shippingRefund, 0.99, policy.DefaultThreshold)
	if hardNegative.ProviderBypassAllowed || hardNegative.Reason != SemanticCacheReasonHardNegative {
		t.Fatalf("support_refund hard negative는 categoryThreshold보다 높아도 hit 금지여야 함: %+v", hardNegative)
	}
}

func TestSemanticCacheIntentEvalCasesMatchHitPolicyContract(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	dataset := loadSemanticIntentEvalDataset(t)
	categoryPolicy := NewSemanticCacheCategoryPolicy(
		[]string{SemanticCacheCategoryGeneral, SemanticCacheCategoryAccountAccess, SemanticCacheCategorySupportRefund},
		[]string{SemanticCacheCategoryCode, SemanticCacheCategoryTranslation, SemanticCacheCategoryUnknown},
	)

	for _, tc := range dataset.Cases {
		t.Run(tc.CaseID, func(t *testing.T) {
			switch tc.ExpectedDecision {
			case "hit_candidate", "strict_hit_candidate":
				first := mustMaterializeEvalCaseText(t, policy, tc, tc.First)
				second := mustMaterializeEvalCaseText(t, policy, tc, tc.Second)
				if tc.CanonicalIntent != "" && tc.CanonicalIntent != "mixed" {
					if first.CanonicalIntent != tc.CanonicalIntent || second.CanonicalIntent != tc.CanonicalIntent {
						t.Fatalf("positive eval case는 같은 canonicalIntent여야 함: expected=%q first=%+v second=%+v", tc.CanonicalIntent, first, second)
					}
				}
				if first.RequiredSlotsHash == "" || first.RequiredSlotsHash != second.RequiredSlotsHash {
					t.Fatalf("positive eval case는 같은 requiredSlotsHash여야 함: first=%+v second=%+v", first, second)
				}

				decision := policy.Evaluate(second, first, 0.99, policy.DefaultThreshold)
				if !decision.ProviderBypassAllowed || decision.Outcome != SemanticCacheOutcomeHit || decision.Reason != SemanticCacheReasonHit {
					t.Fatalf("positive eval case는 high similarity에서 hit 후보여야 함: %+v", decision)
				}

			case "miss":
				first := mustMaterializeEvalCaseText(t, policy, tc, tc.First)
				second := mustMaterializeEvalCaseText(t, policy, tc, tc.Second)
				if tc.FirstCanonicalIntent != "" && first.CanonicalIntent != tc.FirstCanonicalIntent {
					t.Fatalf("negative eval case firstCanonicalIntent 불일치: expected=%q material=%+v", tc.FirstCanonicalIntent, first)
				}
				if tc.SecondCanonicalIntent != "" && second.CanonicalIntent != tc.SecondCanonicalIntent {
					t.Fatalf("negative eval case secondCanonicalIntent 불일치: expected=%q material=%+v", tc.SecondCanonicalIntent, second)
				}
				decision := policy.Evaluate(second, first, 0.99, policy.DefaultThreshold)
				if decision.ProviderBypassAllowed || decision.Allowed || decision.Outcome != SemanticCacheOutcomeMiss {
					t.Fatalf("negative eval case는 high similarity여도 miss여야 함: %+v", decision)
				}
				if decision.Reason == SemanticCacheReasonThresholdMiss {
					t.Fatalf("negative eval case는 threshold 때문이 아니라 intent/slot/hard negative 정책으로 miss여야 함: %+v", decision)
				}

			case "bypass":
				if !tc.DenyCategory {
					t.Fatalf("bypass eval case는 denyCategory=true여야 함: %+v", tc)
				}
				if categoryPolicy.Allows(tc.Category) {
					t.Fatalf("deny category는 Semantic Cache category policy에서 bypass되어야 함: category=%q", tc.Category)
				}
				material := evalCaseIntentMaterial(policy, tc)
				decision := policy.Evaluate(material, material, 0.99, policy.DefaultThreshold)
				if decision.ProviderBypassAllowed || decision.Outcome != SemanticCacheOutcomeBypassed || decision.Reason != SemanticCacheReasonCategoryDisabled {
					t.Fatalf("deny category eval case는 hit policy에서 bypass되어야 함: %+v", decision)
				}

			default:
				t.Fatalf("지원하지 않는 expectedDecision: %q", tc.ExpectedDecision)
			}
		})
	}
}

func TestSemanticCacheIntentEvalCasesDriveServiceHitAndMissWithoutOpenAI(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	dataset := loadSemanticIntentEvalDataset(t)
	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)

	for _, tc := range dataset.Cases {
		if tc.ExpectedDecision == "bypass" {
			continue
		}
		t.Run(tc.CaseID, func(t *testing.T) {
			store := NewInMemorySemanticCacheStore(10)
			store.now = func() time.Time { return now }
			service := NewSemanticCacheService(store, newEvalCaseEmbeddingProvider(tc.First, tc.Second), SemanticCacheServiceConfig{
				Enabled:       true,
				Threshold:     0.92,
				TopK:          3,
				TTL:           time.Hour,
				PolicyVersion: "v1",
				HitPolicy:     policy,
			})
			boundary := testSemanticBoundary(t, func(b *SemanticCacheBoundary) {
				b.PromptCategory = tc.Category
			})

			storeDecision, err := service.Upsert(context.Background(), SemanticCacheStoreRequest{
				EntryID:        "entry-" + tc.CaseID,
				RequestID:      "request-" + tc.CaseID,
				Boundary:       boundary,
				NormalizedText: tc.First,
				CachedResponse: []byte(`{"answer":"safe eval response"}`),
				Now:            now,
			})
			if err != nil {
				t.Fatalf("eval case store 실패: %v", err)
			}
			if storeDecision.SemanticCacheDecisionReason != SemanticCacheReasonStored {
				t.Fatalf("eval case store decision 불일치: %+v", storeDecision)
			}

			result, decision, err := service.Search(context.Background(), SemanticCacheLookupRequest{
				Boundary:       boundary,
				NormalizedText: tc.Second,
			})
			if err != nil {
				t.Fatalf("eval case search 실패: %v", err)
			}

			switch tc.ExpectedDecision {
			case "hit_candidate", "strict_hit_candidate":
				if !result.Hit || !decision.SemanticCacheHit || decision.Outcome != SemanticCacheOutcomeHit {
					t.Fatalf("positive eval case는 service search에서 hit이어야 함: result=%+v decision=%+v", result, decision)
				}
			case "miss":
				if result.Hit || decision.SemanticCacheHit || decision.Outcome != SemanticCacheOutcomeMiss {
					t.Fatalf("negative eval case는 service search에서 miss여야 함: result=%+v decision=%+v", result, decision)
				}
				if decision.SemanticCacheDecisionReason == SemanticCacheReasonThresholdMiss {
					t.Fatalf("negative eval case는 high similarity에서도 policy로 miss되어야 함: result=%+v decision=%+v", result, decision)
				}
			default:
				t.Fatalf("service eval에서 지원하지 않는 expectedDecision: %q", tc.ExpectedDecision)
			}
		})
	}
}

func TestSemanticCacheHitPolicyDeniesDisabledCategories(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	material := NewSemanticCacheIntentMaterial(
		SemanticCacheCategoryTranslation,
		"translation.translate_text",
		map[string]string{"translationAction": "translate"},
		nil,
		policy.CanonicalizationVersion,
		policy.SynonymPolicyVersion,
	)

	decision := policy.Evaluate(material, material, 0.99, 0.92)
	if decision.ProviderBypassAllowed || decision.Outcome != SemanticCacheOutcomeBypassed || decision.Reason != SemanticCacheReasonCategoryDisabled {
		t.Fatalf("translation category는 policy에서 bypass되어야 함: %+v", decision)
	}
}

func TestSemanticCacheHitPolicyReportsSlotsUnavailableForIncompleteMaterial(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	request := SemanticCacheIntentMaterial{
		Category:                SemanticCacheCategoryGeneral,
		CanonicalIntent:         "account.password_reset",
		CanonicalizationVersion: policy.CanonicalizationVersion,
		SynonymPolicyVersion:    policy.SynonymPolicyVersion,
	}
	cached := NewSemanticCacheIntentMaterial(
		SemanticCacheCategoryGeneral,
		"account.password_reset",
		map[string]string{"accountAction": "password_reset"},
		nil,
		policy.CanonicalizationVersion,
		policy.SynonymPolicyVersion,
	)

	decision := policy.Evaluate(request, cached, 0.99, 0.92)
	if decision.ProviderBypassAllowed || decision.Reason != SemanticCacheReasonSlotsUnavailable {
		t.Fatalf("slot 없는 material은 intent unavailable이 아니라 slots_unavailable이어야 함: %+v", decision)
	}
}

func TestSemanticCacheHitPolicyNormalizesNilSynonymValuesToEmptySlice(t *testing.T) {
	policy := SemanticCacheHitPolicy{
		PolicyVersion:           "v1",
		CanonicalizationVersion: "ko-canon-v1",
		SynonymPolicyVersion:    "ko-synonym-v1",
		Synonyms: map[string]map[string][]string{
			"ko": {
				"password": nil,
			},
		},
		Intents: map[string]SemanticCacheIntentRule{
			"account.password_reset": {
				Category:      SemanticCacheCategoryGeneral,
				MatchAll:      []string{"password"},
				RequiredSlots: map[string]string{"accountAction": "password_reset"},
			},
		},
	}

	normalized, err := policy.Normalize()
	if err != nil {
		t.Fatalf("nil synonym value가 있어도 policy normalize는 성공해야 함: %v", err)
	}
	values, ok := normalized.Synonyms["ko"]["password"]
	if !ok {
		t.Fatalf("synonym term은 normalize 후에도 남아야 함: %+v", normalized.Synonyms)
	}
	if values == nil {
		t.Fatalf("nil synonym value는 빈 slice로 정규화되어야 함")
	}
	if len(values) != 0 {
		t.Fatalf("nil synonym value는 빈 slice여야 함: %+v", values)
	}
}

func testSemanticHitPolicy(t *testing.T) *SemanticCacheHitPolicy {
	t.Helper()
	policy, err := LoadSemanticCacheHitPolicyFile(filepath.Join("testdata", "semantic_cache_policy_ko_v1.json"))
	if err != nil {
		t.Fatalf("semantic cache test policy 로드 실패: %v", err)
	}
	return &policy
}

func loadSemanticIntentEvalDataset(t *testing.T) semanticIntentEvalDataset {
	t.Helper()
	payload, err := os.ReadFile(filepath.Join("testdata", "semantic_cache_intent_eval_cases.json"))
	if err != nil {
		t.Fatalf("semantic cache intent eval dataset 로드 실패: %v", err)
	}
	var dataset semanticIntentEvalDataset
	if err := json.Unmarshal(payload, &dataset); err != nil {
		t.Fatalf("semantic cache intent eval dataset JSON 파싱 실패: %v", err)
	}
	if dataset.DatasetID == "" || len(dataset.Cases) == 0 {
		t.Fatalf("semantic cache intent eval dataset은 datasetId와 cases가 필요함: %+v", dataset)
	}
	return dataset
}

func mustMaterializeEvalCaseText(t *testing.T, policy *SemanticCacheHitPolicy, tc semanticIntentEvalCase, text string) SemanticCacheIntentMaterial {
	t.Helper()
	material, decision := policy.Materialize(tc.Category, text)
	if material.IsZero() || !decision.Allowed {
		t.Fatalf("eval case text는 intent material로 변환되어야 함: case=%s text=%q material=%+v decision=%+v", tc.CaseID, text, material, decision)
	}
	return material
}

func mustMaterializeText(t *testing.T, policy *SemanticCacheHitPolicy, category string, text string) SemanticCacheIntentMaterial {
	t.Helper()
	material, decision := policy.Materialize(category, text)
	if material.IsZero() || !decision.Allowed {
		t.Fatalf("text는 intent material로 변환되어야 함: category=%s text=%q material=%+v decision=%+v", category, text, material, decision)
	}
	return material
}

func assertPolicyDecision(t *testing.T, decision SemanticCacheIntentDecision, wantHit bool, wantReason string) {
	t.Helper()
	if decision.ProviderBypassAllowed != wantHit || decision.Reason != wantReason {
		t.Fatalf("policy decision 불일치: wantHit=%v wantReason=%s decision=%+v", wantHit, wantReason, decision)
	}
}

func evalCaseIntentMaterial(policy *SemanticCacheHitPolicy, tc semanticIntentEvalCase) SemanticCacheIntentMaterial {
	return NewSemanticCacheIntentMaterial(
		tc.Category,
		tc.CanonicalIntent,
		tc.RequiredSlots,
		tc.OptionalSlots,
		policy.CanonicalizationVersion,
		policy.SynonymPolicyVersion,
	)
}

type evalCaseEmbeddingProvider struct {
	vectors map[string][]float64
}

func newEvalCaseEmbeddingProvider(first string, second string) evalCaseEmbeddingProvider {
	sharedVector := []float64{1, 0, 0, 0, 0, 0}
	return evalCaseEmbeddingProvider{
		vectors: map[string][]float64{
			normalizeSemanticText(first):  append([]float64(nil), sharedVector...),
			normalizeSemanticText(second): append([]float64(nil), sharedVector...),
		},
	}
}

func (p evalCaseEmbeddingProvider) Embed(ctx context.Context, input EmbeddingInput) (EmbeddingResult, error) {
	if err := ctx.Err(); err != nil {
		return EmbeddingResult{}, err
	}
	vector, ok := p.vectors[normalizeSemanticText(input.NormalizedText)]
	if !ok {
		vector = []float64{0, 1, 0, 0, 0, 0}
	}
	return EmbeddingResult{
		Vector: append([]float64(nil), vector...),
		Model:  p.ModelName(),
	}, nil
}

func (p evalCaseEmbeddingProvider) ProviderName() string {
	return "fake-eval"
}

func (p evalCaseEmbeddingProvider) ModelName() string {
	return "semantic-cache-intent-eval"
}
