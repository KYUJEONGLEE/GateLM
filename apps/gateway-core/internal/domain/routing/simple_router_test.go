package routing

import (
	"context"
	"strings"
	"testing"
)

func TestSimpleRouterRoutesShortAutoPromptToLowCostModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Write a short refund response.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock", "mock-fast", ReasonSupportRefundLowCost, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategorySupportRefund,
		Tier:          TierLowCost,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterRoutesLongAutoPromptToDefaultModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     strings.Repeat("a", 301),
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock", "mock-balanced", ReasonDefaultBalanced, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryGeneral,
		Tier:          TierBalanced,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterKeepsExplicitModelPinned(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider: "mock",
		DefaultModel:    "mock-balanced",
		LowCostModel:    "mock-fast",
		PolicyHash:      "route_p0_v1",
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "mock-smart",
		PromptText:     "Use the requested model.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("mock-smart", "mock", "mock-smart", ReasonPinned, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModePinned,
		Category:      CategoryGeneral,
		Tier:          TierBalanced,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterUsesRequestRuntimeConfigWithoutChangingDecisionSemantics(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		PolicyHash:          "route_base",
		ShortPromptMaxChars: 300,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "short prompt",
		Config: &SimpleRouterConfig{
			DefaultProvider:     "runtime-provider",
			DefaultModel:        "runtime-balanced",
			LowCostModel:        "runtime-fast",
			PolicyHash:          "hash_runtime_routing_policy",
			ShortPromptMaxChars: 20,
		},
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "runtime-provider", "runtime-fast", ReasonShortPromptLowCost, "hash_runtime_routing_policy", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryGeneral,
		Tier:          TierLowCost,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterRoutingDecisionHashChangesByCategory(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	codeDecision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Fix this TypeScript function error.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}
	translationDecision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "이 문장을 영어로 번역해줘.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	if codeDecision.RoutingDecisionMaterial.Category != CategoryCode {
		t.Fatalf("expected code category, got %#v", codeDecision.RoutingDecisionMaterial)
	}
	if translationDecision.RoutingDecisionMaterial.Category != CategoryTranslation {
		t.Fatalf("expected translation category, got %#v", translationDecision.RoutingDecisionMaterial)
	}
	if codeDecision.RoutingDecisionKeyHash == translationDecision.RoutingDecisionKeyHash {
		t.Fatal("expected category to affect routing decision key hash")
	}
}

func TestSimpleRouterRoutesCodeCategoryToHighQualityModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		HighQualityProvider: "mock-premium",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Fix this TypeScript function error.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock-premium", "mock-smart", ReasonCodeHighQuality, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryCode,
		Tier:          TierHighQuality,
		Capability:    CapabilityCode,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterRoutesTranslationCategoryToBalancedModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "이 문장을 영어로 번역해줘.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock", "mock-balanced", ReasonTranslationBalanced, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryTranslation,
		Tier:          TierBalanced,
		Capability:    CapabilityTranslation,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterRoutesLongSupportRefundCategoryToLowCostModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostProvider:     "mock-cheap",
		LowCostModel:        "mock-fast",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 30,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Write a detailed refund response for a customer. " + strings.Repeat("a", 100),
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock-cheap", "mock-fast", ReasonSupportRefundLowCost, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategorySupportRefund,
		Tier:          TierLowCost,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterRoutesReasoningCategoryToHighQualityModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostProvider:     "mock-cheap",
		LowCostModel:        "mock-fast",
		HighQualityProvider: "mock-premium",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Compare these rollout options and explain the tradeoff.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock-premium", "mock-smart", ReasonReasoningHighQuality, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryReasoning,
		Tier:          TierHighQuality,
		Capability:    CapabilityReasoning,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterFallsBackWhenSelectedCandidateUnavailable(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock-default",
		DefaultModel:        "mock-balanced",
		LowCostProvider:     "mock-cheap",
		LowCostModel:        "mock-fast",
		HighQualityProvider: "mock-premium",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
		CandidateStatuses: []RouteCandidateStatus{
			{Provider: "mock-premium", Model: "mock-smart", Status: RouteCandidateUnavailable},
			{Provider: "mock-default", Model: "mock-balanced", Status: RouteCandidateAvailable, FallbackPriority: 10, LatencyP95Ms: 180},
			{Provider: "mock-cheap", Model: "mock-fast", Status: RouteCandidateAvailable, FallbackPriority: 20, LatencyP95Ms: 90},
		},
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Compare these rollout options and explain the tradeoff.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock-default", "mock-balanced", ReasonProviderHealthFallback, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryReasoning,
		Tier:          TierBalanced,
		Capability:    CapabilityReasoning,
		PolicyVariant: PolicyVariantProviderHealthFallback,
	}))
}

func TestSimpleRouterHealthFallbackUsesPriorityThenLatency(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock-default",
		DefaultModel:        "mock-balanced",
		LowCostProvider:     "mock-cheap",
		LowCostModel:        "mock-fast",
		HighQualityProvider: "mock-premium",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
		CandidateStatuses: []RouteCandidateStatus{
			{Provider: "mock-cheap", Model: "mock-fast", Status: RouteCandidateUnavailable},
			{Provider: "mock-default", Model: "mock-balanced", Status: RouteCandidateAvailable, FallbackPriority: 10, LatencyP95Ms: 200},
			{Provider: "mock-premium", Model: "mock-smart", Status: RouteCandidateAvailable, FallbackPriority: 10, LatencyP95Ms: 120},
		},
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Write a short refund response.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("auto", "mock-premium", "mock-smart", ReasonProviderHealthFallback, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategorySupportRefund,
		Tier:          TierHighQuality,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantProviderHealthFallback,
	}))
}

func TestSimpleRouterDoesNotHealthFallbackPinnedModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider: "mock",
		DefaultModel:    "mock-balanced",
		LowCostModel:    "mock-fast",
		PolicyHash:      "route_p0_v1",
		CandidateStatuses: []RouteCandidateStatus{
			{Provider: "mock", Model: "mock-smart", Status: RouteCandidateUnavailable},
			{Provider: "mock", Model: "mock-balanced", Status: RouteCandidateAvailable, FallbackPriority: 1},
		},
	})

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "mock-smart",
		PromptText:     "Use this exact model.",
	})
	if err != nil {
		t.Fatalf("DecideRoute returned error: %v", err)
	}

	assertDecision(t, decision, expectedDecision("mock-smart", "mock", "mock-smart", ReasonPinned, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModePinned,
		Category:      CategoryGeneral,
		Tier:          TierBalanced,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
}

func TestSimpleRouterRoutesStructuredCategoriesToBalancedModel(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostProvider:     "mock-cheap",
		LowCostModel:        "mock-fast",
		HighQualityProvider: "mock-premium",
		HighQualityModel:    "mock-smart",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	cases := []struct {
		name       string
		prompt     string
		category   string
		capability string
		reason     string
	}{
		{
			name:       "summarization",
			prompt:     "Summarize the attached meeting notes into decisions and blockers.",
			category:   CategorySummarization,
			capability: CapabilitySummarization,
			reason:     ReasonSummarizationBalanced,
		},
		{
			name:       "extraction_json",
			prompt:     "Extract the order id and status as JSON.",
			category:   CategoryExtractionJSON,
			capability: CapabilityJSON,
			reason:     ReasonExtractionJSONBalanced,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			decision, err := router.DecideRoute(context.Background(), Request{
				RequestedModel: "auto",
				PromptText:     tc.prompt,
			})
			if err != nil {
				t.Fatalf("DecideRoute returned error: %v", err)
			}

			assertDecision(t, decision, expectedDecision("auto", "mock", "mock-balanced", tc.reason, "route_p0_v1", DecisionMaterial{
				RoutingMode:   RoutingModeAuto,
				Category:      tc.category,
				Tier:          TierBalanced,
				Capability:    tc.capability,
				PolicyVariant: PolicyVariantDefault,
			}))
		})
	}
}

func TestSimpleRouterClassifiesRoutingCategory(t *testing.T) {
	router := NewSimpleRouter(SimpleRouterConfig{
		DefaultProvider:     "mock",
		DefaultModel:        "mock-balanced",
		LowCostModel:        "mock-fast",
		PolicyHash:          "route_p0_v1",
		ShortPromptMaxChars: 300,
	})

	cases := []struct {
		name     string
		prompt   string
		category string
	}{
		{name: "RT-CATEGORY-001 refund", prompt: "배송비도 환불되나요?", category: CategorySupportRefund},
		{name: "RT-CATEGORY-002 general", prompt: "비밀번호 재설정 방법 알려줘", category: CategoryGeneral},
		{name: "RT-CATEGORY-003 translation", prompt: "이 문장을 영어로 번역해줘", category: CategoryTranslation},
		{name: "RT-CATEGORY-004 code block", prompt: "```ts\nconst value = 1\n``` 이 에러를 봐줘", category: CategoryCode},
		{name: "RT-CATEGORY-005 empty", prompt: "", category: CategoryUnknown},
		{name: "RT-CATEGORY-006 translation priority", prompt: "환불 정책을 영어로 번역해줘", category: CategoryTranslation},
		{name: "RT-CATEGORY-006 code priority", prompt: "이 코드를 영어로 번역해줘", category: CategoryCode},
		{name: "RT-CATEGORY-007 summarization", prompt: "Summarize the meeting notes into key points", category: CategorySummarization},
		{name: "RT-CATEGORY-008 extraction json", prompt: "Extract the order id and status as JSON", category: CategoryExtractionJSON},
		{name: "RT-CATEGORY-009 reasoning", prompt: "Compare these options and explain the tradeoff", category: CategoryReasoning},
		{name: "RT-CATEGORY-008 ambiguous go let words stay general", prompt: "Let me know if we can go ahead with the weekly update", category: CategoryGeneral},
		{name: "RT-CATEGORY-009 select update delete words stay general", prompt: "Please select a plan, update my profile, and delete the old address", category: CategoryGeneral},
		{name: "RT-CATEGORY-010 bug without code context stays general", prompt: "I found a bug in my order status page", category: CategoryGeneral},
		{name: "RT-CATEGORY-011 SQL pattern is code", prompt: "select * from users where id = 1", category: CategoryCode},
		{name: "RT-CATEGORY-012 long prompt only uses classifier prefix", prompt: strings.Repeat("hello ", 420) + "```go\nconst value = 1\n```", category: CategoryGeneral},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			decision, err := router.DecideRoute(context.Background(), Request{
				RequestedModel: "auto",
				PromptText:     tc.prompt,
			})
			if err != nil {
				t.Fatalf("DecideRoute returned error: %v", err)
			}
			if decision.RoutingDecisionMaterial.Category != tc.category {
				t.Fatalf("category 불일치: got %q want %q", decision.RoutingDecisionMaterial.Category, tc.category)
			}
			expectedHash, err := DecisionKeyHash(decision.RoutingDecisionMaterial)
			if err != nil {
				t.Fatalf("routing decision hash 생성 실패: %v", err)
			}
			if decision.RoutingDecisionKeyHash != expectedHash {
				t.Fatalf("routingDecisionKeyHash는 category 포함 material에서 생성되어야 함: got %q want %q", decision.RoutingDecisionKeyHash, expectedHash)
			}
		})
	}
}

func TestKoreanCategoryClassifierCoverage(t *testing.T) {
	classifier := NewRuleBasedCategoryClassifier()

	cases := []struct {
		name     string
		category string
		prompts  []string
	}{
		{
			name:     "support_refund",
			category: CategorySupportRefund,
			prompts: []string{
				"배송비도 환불되나요?",
				"반품하면 배송비도 돌려받나요?",
				"주문 취소하고 싶어요",
				"결제 취소 가능한가요?",
				"교환이나 환불은 어디서 하나요?",
			},
		},
		{
			name:     "translation",
			category: CategoryTranslation,
			prompts: []string{
				"이 문장을 영어로 번역해줘",
				"이걸 한국어로 바꿔줘",
				"일본어로 번역해줘",
				"다음 문장을 중국어로 옮겨줘",
			},
		},
		{
			name:     "code",
			category: CategoryCode,
			prompts: []string{
				"이 코드 설명해줘",
				"이 함수 왜 에러나?",
				"컴파일 오류가 나요",
				"실행하면 버그가 생겨요",
				"```go\nconst value = 1\n``` 코드 블록이 포함된 요청",
			},
		},
		{
			name:     "general",
			category: CategoryGeneral,
			prompts: []string{
				"비밀번호 재설정 방법 알려줘",
				"API Key 발급 방법 알려줘",
				"사용량은 어디서 확인해?",
				"계정 설정은 어디서 바꿔?",
			},
		},
	}

	for _, tc := range cases {
		for _, prompt := range tc.prompts {
			t.Run(tc.name+"/"+prompt, func(t *testing.T) {
				if got := classifier.Classify(prompt); got != tc.category {
					t.Fatalf("한국어 category 분류 불일치: prompt=%q got=%q want=%q", prompt, got, tc.category)
				}
			})
		}
	}
}

func TestRoutingDecisionKeyHashChangesWhenCategoryChanges(t *testing.T) {
	base := DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryGeneral,
		Tier:          TierBalanced,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}
	generalHash, err := DecisionKeyHash(base)
	if err != nil {
		t.Fatalf("general hash 생성 실패: %v", err)
	}

	base.Category = CategorySupportRefund
	refundHash, err := DecisionKeyHash(base)
	if err != nil {
		t.Fatalf("support_refund hash 생성 실패: %v", err)
	}
	if generalHash == refundHash {
		t.Fatalf("RT-CATEGORY-007 category가 다르면 routingDecisionKeyHash도 달라야 함: %q", generalHash)
	}
}

func assertDecision(t *testing.T, actual Decision, expected Decision) {
	t.Helper()

	if actual != expected {
		t.Fatalf("unexpected decision:\nactual:   %#v\nexpected: %#v", actual, expected)
	}
}

func expectedDecision(requestedModel string, selectedProvider string, selectedModel string, reason string, policyHash string, material DecisionMaterial) Decision {
	hash, err := DecisionKeyHash(material)
	if err != nil {
		panic(err)
	}
	return Decision{
		RequestedModel:             requestedModel,
		SelectedProvider:           selectedProvider,
		SelectedProviderCatalogKey: selectedProvider,
		SelectedModel:              selectedModel,
		SelectedModelID:            selectedModel,
		RoutingReason:              reason,
		PolicyHash:                 policyHash,
		RoutingDecisionMaterial:    material,
		RoutingDecisionKeyHash:     hash,
	}
}
