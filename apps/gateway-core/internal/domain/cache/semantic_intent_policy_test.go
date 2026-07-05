package cache

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type semanticIntentEvalDataset struct {
	DatasetID string                   `json:"datasetId"`
	Cases     []semanticIntentEvalCase `json:"cases"`
}

type semanticIntentEvalCase struct {
	CaseID                    string            `json:"caseId"`
	PairType                  string            `json:"pairType"`
	Category                  string            `json:"category"`
	CanonicalIntent           string            `json:"canonicalIntent"`
	First                     string            `json:"first"`
	Second                    string            `json:"second"`
	FirstCanonicalIntent      string            `json:"firstCanonicalIntent"`
	SecondCanonicalIntent     string            `json:"secondCanonicalIntent"`
	RequiredSlots             map[string]string `json:"requiredSlots"`
	OptionalSlots             map[string]string `json:"optionalSlots"`
	ExpectedSemanticHit       *bool             `json:"expectedSemanticHit"`
	ExpectedCategory          string            `json:"expectedCategory"`
	ExpectedCanonicalIntent   string            `json:"expectedCanonicalIntent"`
	ExpectedRequiredSlotsHash string            `json:"expectedRequiredSlotsHash"`
	SameAnswerReusable        bool              `json:"sameAnswerReusable"`
	HardNegative              bool              `json:"hardNegative"`
	DenyCategory              bool              `json:"denyCategory"`
	ExpectedDecision          string            `json:"expectedDecision"`
	Reason                    string            `json:"reason"`
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

func TestSemanticCacheHitPolicyMaterializesCommonStaticGuidanceIntents(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	cases := []struct {
		name       string
		text       string
		wantIntent string
		wantSlots  map[string]string
	}{
		{
			name:       "usage location Korean short",
			text:       "사용량은 어디서 확인해?",
			wantIntent: "usage.monthly_usage_check",
			wantSlots: map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "static_guidance",
			},
		},
		{
			name:       "usage location Korean screen",
			text:       "API 사용량 확인 화면은 어디야?",
			wantIntent: "usage.monthly_usage_check",
			wantSlots: map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "static_guidance",
			},
		},
		{
			name:       "RPS definition Korean",
			text:       "RPS 뜻 알려줘",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition Korean explain",
			text:       "RPS 뜻 설명해줘",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition Korean meaning explain",
			text:       "RPS 의미 설명해줘",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition Korean josa meaning",
			text:       "RPS의 뜻이 뭐야?",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition Korean concept noun phrase",
			text:       "RPS의 개념",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition Korean subject particle",
			text:       "RPS가 뭐야?",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition Korean topic particle polite",
			text:       "RPS는 뭔가요?",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS definition English full name",
			text:       "What is requests per second?",
			wantIntent: "performance.rps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "rps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "TPS definition",
			text:       "Explain TPS",
			wantIntent: "performance.tps_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "tps",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "latency definition",
			text:       "레이턴시란 뭐야?",
			wantIntent: "performance.latency_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "latency",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "throughput definition",
			text:       "throughput 뜻 알려줘",
			wantIntent: "performance.throughput_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "throughput",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "error rate definition",
			text:       "error rate 의미 알려줘",
			wantIntent: "performance.error_rate_definition",
			wantSlots: map[string]string{
				"performanceConcept":    "error_rate",
				"performanceAnswerType": "definition",
			},
		},
		{
			name:       "RPS TPS comparison",
			text:       "What is the difference between RPS and TPS?",
			wantIntent: "performance.rps_tps_compare",
			wantSlots: map[string]string{
				"performanceConceptPair": "rps_tps",
				"performanceAnswerType":  "comparison",
			},
		},
		{
			name:       "help center location",
			text:       "도움말 센터 어디서 봐?",
			wantIntent: "product.help_center_location",
			wantSlots: map[string]string{
				"guideObject":     "help_center",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "billing invoice location",
			text:       "청구서 메뉴 어디야?",
			wantIntent: "billing.invoice_location",
			wantSlots: map[string]string{
				"guideObject":     "billing_invoice",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "payment method location",
			text:       "결제수단 어디서 변경해?",
			wantIntent: "billing.payment_method_location",
			wantSlots: map[string]string{
				"guideObject":     "billing_payment_method",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "team invite location",
			text:       "팀원 초대 메뉴 알려줘",
			wantIntent: "team.member_invite_location",
			wantSlots: map[string]string{
				"guideObject":     "team_member_invite",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "project settings location",
			text:       "프로젝트 설정 어디서 바꿔?",
			wantIntent: "project.settings_location",
			wantSlots: map[string]string{
				"guideObject":     "project_settings",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "API docs location",
			text:       "API 문서 어디서 확인해?",
			wantIntent: "developer.api_docs_location",
			wantSlots: map[string]string{
				"guideObject":     "api_docs",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "status page location",
			text:       "서비스 상태 페이지 어디야?",
			wantIntent: "product.status_page_location",
			wantSlots: map[string]string{
				"guideObject":     "status_page",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "release notes location",
			text:       "업데이트 내역은 어디서 봐?",
			wantIntent: "product.release_notes_location",
			wantSlots: map[string]string{
				"guideObject":     "release_notes",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "profile settings location",
			text:       "내 프로필 설정 어디야?",
			wantIntent: "account.profile_settings_location",
			wantSlots: map[string]string{
				"accountAction":   "profile_settings_location",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "security settings location",
			text:       "2단계 인증 설정 어디서 해?",
			wantIntent: "account.security_settings_location",
			wantSlots: map[string]string{
				"accountAction":   "security_settings_location",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "notification settings location",
			text:       "알림 설정 어디야?",
			wantIntent: "product.notification_settings_location",
			wantSlots: map[string]string{
				"guideObject":     "notification_settings",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "team role permission location",
			text:       "멤버 권한 설정 어디서 해?",
			wantIntent: "team.role_permission_location",
			wantSlots: map[string]string{
				"guideObject":     "team_role_permission",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "billing plan location",
			text:       "가격표 어디서 봐?",
			wantIntent: "billing.plan_pricing_location",
			wantSlots: map[string]string{
				"guideObject":     "billing_plan",
				"guideAnswerType": "static_guidance",
			},
		},
		{
			name:       "data export location",
			text:       "데이터 내보내기 메뉴 어디야?",
			wantIntent: "product.data_export_location",
			wantSlots: map[string]string{
				"guideObject":     "data_export",
				"guideAnswerType": "static_guidance",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			material := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, tc.text)
			if material.CanonicalIntent != tc.wantIntent {
				t.Fatalf("canonicalIntent 불일치: got=%s want=%s material=%+v", material.CanonicalIntent, tc.wantIntent, material)
			}
			for key, want := range tc.wantSlots {
				if got := material.RequiredSlots[key]; got != want {
					t.Fatalf("requiredSlots.%s 불일치: got=%s want=%s material=%+v", key, got, want, material)
				}
			}
		})
	}
}

func TestSemanticCacheHitPolicyDoesNotCollapseMultiConceptDefinitionToSingleIntent(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	for _, text := range []string{
		"RPS와 TPS의 뜻 알려줘",
		"RPS랑 TPS 개념 설명해줘",
	} {
		t.Run(text, func(t *testing.T) {
			material, decision := policy.Materialize(SemanticCacheCategoryGeneral, text)
			if !material.IsZero() || decision.Allowed || decision.Reason != SemanticCacheReasonIntentUnavailable {
				t.Fatalf("복수 성능 개념 질문은 단일 definition intent로 접으면 안 됨: material=%+v decision=%+v", material, decision)
			}
		})
	}
}

func TestSemanticCacheHitPolicyKeepsOperationalRPSQuestionsOutOfDefinitionIntent(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	cases := []string{
		"How can I increase RPS?",
		"Why is my RPS low?",
		"How do I measure RPS?",
		"What is a good RPS for my service?",
		"Which tool should I use to test RPS?",
	}
	for _, text := range cases {
		t.Run(text, func(t *testing.T) {
			material, decision := policy.Materialize(SemanticCacheCategoryGeneral, text)
			if !material.IsZero() || decision.Allowed || decision.Reason != SemanticCacheReasonIntentUnavailable {
				t.Fatalf("운영성 RPS 질문은 definition intent로 넓게 잡히면 안 됨: text=%q material=%+v decision=%+v", text, material, decision)
			}
		})
	}
}

func TestSemanticCacheHitPolicySeparatesCommonStaticGuidanceIntents(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	rpsDefinition := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "What does RPS mean?")
	rpsTPSCompare := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "What is the difference between RPS and TPS?")
	decision := policy.Evaluate(rpsTPSCompare, rpsDefinition, 0.99, policy.DefaultThreshold)
	if decision.ProviderBypassAllowed || decision.Reason != SemanticCacheReasonHardNegative {
		t.Fatalf("RPS definition과 RPS/TPS comparison은 similarity가 높아도 hit 금지여야 함: %+v", decision)
	}

	invoice := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "청구서 메뉴 어디야?")
	paymentMethod := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "결제수단 어디서 변경해?")
	decision = policy.Evaluate(paymentMethod, invoice, 0.99, policy.DefaultThreshold)
	if decision.ProviderBypassAllowed || decision.Reason != SemanticCacheReasonIntentMismatch {
		t.Fatalf("청구서 위치와 결제수단 위치는 별도 static guidance여야 함: %+v", decision)
	}

	statusPage := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "서비스 상태 페이지 어디야?")
	releaseNotes := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "릴리즈 노트 어디서 봐?")
	decision = policy.Evaluate(releaseNotes, statusPage, 0.99, policy.DefaultThreshold)
	if decision.ProviderBypassAllowed || decision.Reason != SemanticCacheReasonIntentMismatch {
		t.Fatalf("상태 페이지와 릴리즈 노트 위치는 별도 static guidance여야 함: %+v", decision)
	}

	profileSettings := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "내 프로필 설정 어디야?")
	securitySettings := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "2단계 인증 설정 어디서 해?")
	decision = policy.Evaluate(securitySettings, profileSettings, 0.99, policy.DefaultThreshold)
	if decision.ProviderBypassAllowed || decision.Reason != SemanticCacheReasonAccountAccessDenied {
		t.Fatalf("account_access 설정 안내는 semantic cached response 반환 금지여야 함: %+v", decision)
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
	if hitDecision.ProviderBypassAllowed || hitDecision.Reason != SemanticCacheReasonSupportRefundDenied {
		t.Fatalf("support_refund는 hard negative 이전에 기본 deny되어야 함: %+v", hitDecision)
	}
}

func TestSemanticCacheHitPolicyUsesCategoryThresholdsFromKoreanPolicy(t *testing.T) {
	policy := testSemanticHitPolicy(t)

	if policy.DefaultThreshold != 0.92 {
		t.Fatalf("defaultThreshold는 보수 기본값으로 유지되어야 함: got=%f", policy.DefaultThreshold)
	}
	cases := map[string]float64{
		SemanticCacheCategoryAccountAccess: 0.92,
		SemanticCacheCategoryGeneral:       0.92,
		SemanticCacheCategorySupportRefund: 0.92,
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
	assertPolicyDecision(t, policy.Evaluate(passwordInit, passwordReset, 0.99, policy.DefaultThreshold), false, SemanticCacheReasonAccountAccessDenied)

	usageMenu := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "사용량 메뉴 위치 알려줘")
	usageStats := mustMaterializeText(t, policy, SemanticCacheCategoryGeneral, "API 사용량 확인 화면은 어디야?")
	assertPolicyDecision(t, policy.Evaluate(usageStats, usageMenu, 0.91, policy.DefaultThreshold), false, SemanticCacheReasonThresholdMiss)
	assertPolicyDecision(t, policy.Evaluate(usageStats, usageMenu, 0.92, policy.DefaultThreshold), true, SemanticCacheReasonHit)

	dynamicUsage, dynamicDecision := policy.Materialize(SemanticCacheCategoryGeneral, "내 이번 달 사용량 보여줘")
	if !dynamicUsage.IsZero() || dynamicDecision.Allowed || dynamicDecision.Reason != SemanticCacheReasonIntentUnavailable {
		t.Fatalf("사용자별 동적 사용량 조회는 general semantic cache material이 아니어야 함: material=%+v decision=%+v", dynamicUsage, dynamicDecision)
	}

	shippingRefund := mustMaterializeText(t, policy, SemanticCacheCategorySupportRefund, "배송비도 환불되나요?")
	returnShippingRefund := mustMaterializeText(t, policy, SemanticCacheCategorySupportRefund, "반품하면 배송비도 돌려받나요?")
	assertPolicyDecision(t, policy.Evaluate(returnShippingRefund, shippingRefund, 0.99, policy.DefaultThreshold), false, SemanticCacheReasonSupportRefundDenied)

	orderCancel := mustMaterializeText(t, policy, SemanticCacheCategorySupportRefund, "주문 취소하고 싶어요")
	hardNegative := policy.Evaluate(orderCancel, shippingRefund, 0.99, policy.DefaultThreshold)
	if hardNegative.ProviderBypassAllowed || hardNegative.Reason != SemanticCacheReasonSupportRefundDenied {
		t.Fatalf("support_refund는 categoryThreshold보다 높아도 기본 deny되어야 함: %+v", hardNegative)
	}
}

func TestSemanticCacheIntentEvalCasesMatchHitPolicyContract(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	dataset := loadSemanticIntentEvalDataset(t)
	categoryPolicy := NewSemanticCacheCategoryPolicy(
		[]string{SemanticCacheCategoryGeneral},
		[]string{SemanticCacheCategoryAccountAccess, SemanticCacheCategorySupportRefund, SemanticCacheCategoryCode, SemanticCacheCategoryTranslation, SemanticCacheCategoryUnknown},
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
				if denyReason := semanticEvalCaseDenyReason(tc); denyReason != "" {
					if decision.ProviderBypassAllowed || decision.Reason != denyReason {
						t.Fatalf("deny-first eval case는 high similarity여도 hit 금지여야 함: wantReason=%s decision=%+v", denyReason, decision)
					}
					return
				}
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
				if denyReason := semanticEvalCaseDenyReason(tc); denyReason != "" {
					if decision.ProviderBypassAllowed || decision.Reason != denyReason {
						t.Fatalf("deny-first negative eval case reason 불일치: wantReason=%s decision=%+v", denyReason, decision)
					}
					return
				}
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
			if denyReason := semanticEvalCaseDenyReason(tc); denyReason != "" {
				if storeDecision.SemanticCacheDecisionReason != denyReason {
					t.Fatalf("deny-first eval case store reason 불일치: want=%s decision=%+v", denyReason, storeDecision)
				}
				result, decision, err := service.Search(context.Background(), SemanticCacheLookupRequest{
					Boundary:       boundary,
					NormalizedText: tc.Second,
				})
				if err != nil {
					t.Fatalf("deny-first eval case search 실패: %v", err)
				}
				if result.Hit || decision.SemanticCacheHit || decision.SemanticCacheDecisionReason != denyReason {
					t.Fatalf("deny-first eval case는 service search에서 hit 금지여야 함: want=%s result=%+v decision=%+v", denyReason, result, decision)
				}
				return
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

func TestSemanticCacheIntentEvalCasesHaveShadowReportLabels(t *testing.T) {
	dataset := loadSemanticIntentEvalDataset(t)
	if len(dataset.Cases) < 90 || len(dataset.Cases) > 120 {
		t.Fatalf("shadow rollout core dataset은 약 100 cases 수준이어야 함: got=%d", len(dataset.Cases))
	}
	for _, tc := range dataset.Cases {
		t.Run(tc.CaseID, func(t *testing.T) {
			if tc.ExpectedSemanticHit == nil {
				t.Fatalf("expectedSemanticHit label이 필요함: %+v", tc)
			}
			if CanonicalSemanticCacheCategory(tc.ExpectedCategory) != CanonicalSemanticCacheCategory(tc.Category) {
				t.Fatalf("expectedCategory는 category와 canonical하게 일치해야 함: category=%q expected=%q", tc.Category, tc.ExpectedCategory)
			}
			if tc.ExpectedCanonicalIntent == "" {
				t.Fatalf("expectedCanonicalIntent label이 필요함: %+v", tc)
			}
			if *tc.ExpectedSemanticHit != semanticEvalCaseExpectedHit(tc) {
				t.Fatalf("expectedSemanticHit과 expectedDecision이 불일치함: %+v", tc)
			}
		})
	}
}

func TestSemanticCacheIntentEvalCasesBuildShadowReportWithoutOpenAI(t *testing.T) {
	policy := testSemanticHitPolicy(t)
	dataset := loadSemanticIntentEvalDataset(t)
	reportCases := make([]SemanticCacheShadowEvalCase, 0, len(dataset.Cases))
	for _, tc := range dataset.Cases {
		reportCases = append(reportCases, semanticIntentEvalCaseToShadowReportCase(policy, tc))
	}

	report := BuildSemanticCacheShadowEvalReport(reportCases, []float64{0.85, 0.88, 0.90, 0.92, 0.95})
	if report.TotalCases != len(dataset.Cases) {
		t.Fatalf("report totalCases 불일치: got=%d want=%d", report.TotalCases, len(dataset.Cases))
	}
	if report.WouldHitCount == 0 || report.WouldMissCount == 0 {
		t.Fatalf("report에는 wouldHit/wouldMiss 분포가 모두 있어야 함: %+v", report)
	}
	if report.ReturnedFromSemanticCacheCount != 0 {
		t.Fatalf("shadow eval report에서는 semantic cached response 반환 count가 0이어야 함: %+v", report)
	}
	if len(report.ThresholdSensitivity) == 0 {
		t.Fatalf("threshold sensitivity 결과가 필요함: %+v", report)
	}
	payload, err := MarshalSemanticCacheShadowEvalReport(report)
	if err != nil {
		t.Fatalf("shadow eval report marshal 실패: %v", err)
	}
	for _, forbidden := range []string{
		"비밀번호 재설정 방법 알려줘",
		"패스워드 초기화는 어떻게 해?",
		"배송비도 환불되나요?",
		"raw prompt",
		"raw response",
		"api_key=",
		"app_token=",
		"Authorization:",
		"provider raw error",
	} {
		if strings.Contains(string(payload), forbidden) {
			t.Fatalf("shadow eval report output에는 raw prompt/secrets가 없어야 함: marker=%q payload=%s", forbidden, payload)
		}
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
		CanonicalIntent:         "usage.monthly_usage_check",
		CanonicalizationVersion: policy.CanonicalizationVersion,
		SynonymPolicyVersion:    policy.SynonymPolicyVersion,
	}
	cached := NewSemanticCacheIntentMaterial(
		SemanticCacheCategoryGeneral,
		"usage.monthly_usage_check",
		map[string]string{"usageObject": "api_usage", "usageAnswerType": "static_guidance"},
		nil,
		policy.CanonicalizationVersion,
		policy.SynonymPolicyVersion,
	)

	decision := policy.Evaluate(request, cached, 0.99, 0.92)
	if decision.ProviderBypassAllowed || decision.Reason != SemanticCacheReasonSlotsUnavailable {
		t.Fatalf("slot 없는 material은 intent unavailable이 아니라 slots_unavailable이어야 함: %+v", decision)
	}
}

func TestSemanticCacheServiceGeneralPolicyGuardsBlockHitDespiteGeneralCategory(t *testing.T) {
	tests := []struct {
		name             string
		firstText        string
		secondText       string
		cachedMaterial   SemanticCacheIntentMaterial
		requestMaterial  SemanticCacheIntentMaterial
		policy           SemanticCacheHitPolicy
		wantReason       string
		wantProviderName string
	}{
		{
			name:       "required slots mismatch",
			firstText:  "사용량 메뉴 위치 알려줘",
			secondText: "API 사용량 확인 화면은 어디야?",
			cachedMaterial: testGeneralIntentMaterial("general.usage_check", map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "static_guidance",
			}),
			requestMaterial: testGeneralIntentMaterial("general.usage_check", map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "dynamic_user_state",
			}),
			policy:     testGeneralPolicyWithForbiddenPairs(nil),
			wantReason: SemanticCacheReasonSlotsMismatch,
		},
		{
			name:       "hard negative guard",
			firstText:  "사용량 메뉴 위치 알려줘",
			secondText: "계정 삭제 위치 알려줘",
			cachedMaterial: testGeneralIntentMaterial("general.usage_check", map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "static_guidance",
			}),
			requestMaterial: testGeneralIntentMaterial("general.account_delete", map[string]string{
				"accountAction": "account_delete",
			}),
			policy: testGeneralPolicyWithForbiddenPairs([]SemanticCacheIntentPair{
				{
					Category: SemanticCacheCategoryGeneral,
					First:    "general.usage_check",
					Second:   "general.account_delete",
					Reason:   "usage check and account deletion are not answer-compatible",
				},
			}),
			wantReason: SemanticCacheReasonHardNegative,
		},
		{
			name:       "threshold miss",
			firstText:  "사용량 메뉴 위치 알려줘",
			secondText: "비밀번호 재설정 방법 알려줘",
			cachedMaterial: testGeneralIntentMaterial("general.usage_check", map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "static_guidance",
			}),
			requestMaterial: testGeneralIntentMaterial("general.usage_check", map[string]string{
				"usageObject":     "api_usage",
				"usageAnswerType": "static_guidance",
			}),
			policy:     testGeneralPolicyWithForbiddenPairs(nil),
			wantReason: SemanticCacheReasonThresholdMiss,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := newEvalCaseEmbeddingProvider(tt.firstText, tt.secondText)
			if tt.wantReason == SemanticCacheReasonThresholdMiss {
				provider = evalCaseEmbeddingProvider{vectors: map[string][]float64{
					normalizeSemanticText(tt.firstText):  {1, 0, 0, 0, 0, 0},
					normalizeSemanticText(tt.secondText): {0, 1, 0, 0, 0, 0},
				}}
			}
			service := NewSemanticCacheService(NewInMemorySemanticCacheStore(10), provider, SemanticCacheServiceConfig{
				Enabled:       true,
				Threshold:     0.92,
				TopK:          3,
				TTL:           time.Hour,
				PolicyVersion: "v1",
				HitPolicy:     &tt.policy,
			})
			boundary := testSemanticBoundary(t, nil)
			now := time.Now().UTC()
			storeDecision, err := service.Upsert(context.Background(), SemanticCacheStoreRequest{
				EntryID:        "guard-entry",
				RequestID:      "guard-request",
				Boundary:       boundary,
				NormalizedText: tt.firstText,
				IntentMaterial: tt.cachedMaterial,
				CachedResponse: []byte(`{"id":"semantic_guard","choices":[]}`),
				Now:            now,
			})
			if err != nil {
				t.Fatalf("guard seed 저장 실패: decision=%+v err=%v", storeDecision, err)
			}
			if storeDecision.SemanticCacheDecisionReason != SemanticCacheReasonStored {
				t.Fatalf("guard seed는 저장되어야 함: %+v", storeDecision)
			}

			result, decision, err := service.Search(context.Background(), SemanticCacheLookupRequest{
				Boundary:       boundary,
				NormalizedText: tt.secondText,
				IntentMaterial: tt.requestMaterial,
			})
			if err != nil {
				t.Fatalf("guard search 실패: %v", err)
			}
			if result.Hit || decision.SemanticCacheHit || decision.Outcome != SemanticCacheOutcomeMiss {
				t.Fatalf("general category라도 policy guard 실패 시 hit하면 안 됨: result=%+v decision=%+v", result, decision)
			}
			if decision.SemanticCacheDecisionReason != tt.wantReason || result.Reason != tt.wantReason {
				t.Fatalf("policy guard reason 불일치: want=%s result=%+v decision=%+v", tt.wantReason, result, decision)
			}
		})
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

func testGeneralIntentMaterial(intent string, slots map[string]string) SemanticCacheIntentMaterial {
	return NewSemanticCacheIntentMaterial(
		SemanticCacheCategoryGeneral,
		intent,
		slots,
		nil,
		"ko-canon-v1",
		"ko-synonym-v1",
	)
}

func testGeneralPolicyWithForbiddenPairs(pairs []SemanticCacheIntentPair) SemanticCacheHitPolicy {
	policy := SemanticCacheHitPolicy{
		PolicyVersion:           "v1",
		CanonicalizationVersion: "ko-canon-v1",
		SynonymPolicyVersion:    "ko-synonym-v1",
		DefaultThreshold:        0.92,
		Categories: map[string]SemanticCacheCategoryMode{
			SemanticCacheCategoryGeneral: {
				Enabled:               true,
				Mode:                  SemanticCachePolicyModeStrictHit,
				CategoryThreshold:     0.92,
				RequiresIntent:        true,
				RequiresRequiredSlots: true,
				RequiresHardNegative:  true,
			},
		},
		Synonyms: map[string]map[string][]string{
			"ko": {
				"usage":  {"사용량"},
				"delete": {"삭제"},
			},
		},
		Intents: map[string]SemanticCacheIntentRule{
			"general.usage_check": {
				Category:      SemanticCacheCategoryGeneral,
				MatchAll:      []string{"usage"},
				RequiredSlots: map[string]string{"usageObject": "api_usage", "usageAnswerType": "static_guidance"},
				Priority:      10,
			},
			"general.account_delete": {
				Category:      SemanticCacheCategoryGeneral,
				MatchAll:      []string{"delete"},
				RequiredSlots: map[string]string{"accountAction": "account_delete"},
				Priority:      10,
			},
		},
		ForbiddenIntentPairs: pairs,
	}
	normalized, err := policy.Normalize()
	if err != nil {
		panic(err)
	}
	return normalized
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

func semanticEvalCaseExpectedHitFromDecision(decision string) bool {
	switch strings.TrimSpace(decision) {
	case "hit_candidate", "strict_hit_candidate":
		return true
	default:
		return false
	}
}

func semanticEvalCaseDenyReason(tc semanticIntentEvalCase) string {
	switch CanonicalSemanticCacheCategory(tc.Category) {
	case SemanticCacheCategoryAccountAccess:
		return SemanticCacheReasonAccountAccessDenied
	case SemanticCacheCategorySupportRefund:
		return SemanticCacheReasonSupportRefundDenied
	case SemanticCacheCategoryCode,
		SemanticCacheCategoryTranslation,
		SemanticCacheCategoryReasoning,
		SemanticCacheCategorySensitive,
		SemanticCacheCategoryToolCall,
		SemanticCacheCategoryUnknown:
		return SemanticCacheReasonCategoryDenied
	default:
		return ""
	}
}

func semanticEvalCaseExpectedHit(tc semanticIntentEvalCase) bool {
	if semanticEvalCaseDenyReason(tc) != "" {
		return false
	}
	return semanticEvalCaseExpectedHitFromDecision(tc.ExpectedDecision)
}

func semanticIntentEvalCaseToShadowReportCase(policy *SemanticCacheHitPolicy, tc semanticIntentEvalCase) SemanticCacheShadowEvalCase {
	expectedHit := false
	if tc.ExpectedSemanticHit != nil {
		expectedHit = *tc.ExpectedSemanticHit
	}
	reportCase := SemanticCacheShadowEvalCase{
		Category:                   tc.Category,
		ExpectedSemanticHit:        expectedHit,
		HardNegative:               tc.HardNegative,
		DenyCategory:               tc.DenyCategory,
		SemanticCacheMode:          SemanticCacheModeShadow,
		SemanticCacheEnabled:       true,
		SemanticCachePolicyVersion: policy.PolicyVersion,
		SemanticReturnedFromCache:  false,
	}
	if denyReason := semanticEvalCaseDenyReason(tc); denyReason != "" {
		reportCase.SemanticCacheWouldMiss = true
		reportCase.SemanticDecisionReason = denyReason
		if material := evalCaseIntentMaterial(policy, tc); !material.IsZero() {
			decision := policy.Evaluate(material, material, 0.99, policy.DefaultThreshold)
			reportCase.SemanticCacheThreshold = decision.CategoryThreshold
			reportCase.SemanticCanonicalIntent = decision.CanonicalIntent
			reportCase.SemanticRequiredSlotsHash = decision.RequiredSlotsHash
		}
		return reportCase
	}
	if tc.ExpectedDecision == "bypass" {
		material := evalCaseIntentMaterial(policy, tc)
		decision := policy.Evaluate(material, material, 0.99, policy.DefaultThreshold)
		reportCase.SemanticCacheWouldMiss = true
		reportCase.SemanticDecisionReason = decision.Reason
		reportCase.SemanticCacheThreshold = decision.CategoryThreshold
		reportCase.SemanticCanonicalIntent = decision.CanonicalIntent
		reportCase.SemanticRequiredSlotsHash = decision.RequiredSlotsHash
		return reportCase
	}
	first, firstDecision := policy.Materialize(tc.Category, tc.First)
	second, secondDecision := policy.Materialize(tc.Category, tc.Second)
	if first.IsZero() || second.IsZero() || !firstDecision.Allowed || !secondDecision.Allowed {
		reportCase.SemanticCacheWouldMiss = true
		reportCase.SemanticDecisionReason = SemanticCacheReasonIntentUnavailable
		return reportCase
	}
	decision := policy.Evaluate(second, first, 0.99, policy.DefaultThreshold)
	reportCase.SemanticCandidateFound = true
	reportCase.SemanticSimilarity = 0.99
	reportCase.SemanticCacheThreshold = decision.CategoryThreshold
	reportCase.SemanticCanonicalIntent = decision.CanonicalIntent
	reportCase.SemanticRequiredSlotsHash = decision.RequiredSlotsHash
	reportCase.SemanticDecisionReason = decision.Reason
	if decision.ProviderBypassAllowed {
		reportCase.SemanticCacheWouldHit = true
	} else {
		reportCase.SemanticCacheWouldMiss = true
	}
	return reportCase
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
