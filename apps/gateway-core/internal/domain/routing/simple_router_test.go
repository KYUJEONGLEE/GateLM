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

	assertDecision(t, decision, expectedDecision("auto", "mock", "mock-smart", ReasonCodeHighQuality, "route_p0_v1", DecisionMaterial{
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

	assertDecision(t, decision, expectedDecision("auto", "mock", "mock-fast", ReasonSupportRefundLowCost, "route_p0_v1", DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategorySupportRefund,
		Tier:          TierLowCost,
		Capability:    CapabilityChat,
		PolicyVariant: PolicyVariantDefault,
	}))
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
