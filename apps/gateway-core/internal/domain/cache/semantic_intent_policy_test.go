package cache

import (
	"path/filepath"
	"testing"
)

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

func testSemanticHitPolicy(t *testing.T) *SemanticCacheHitPolicy {
	t.Helper()
	policy, err := LoadSemanticCacheHitPolicyFile(filepath.Join("testdata", "semantic_cache_policy_ko_v1.json"))
	if err != nil {
		t.Fatalf("semantic cache test policy 로드 실패: %v", err)
	}
	return &policy
}
