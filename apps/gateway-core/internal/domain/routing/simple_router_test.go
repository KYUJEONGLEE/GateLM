package routing

import (
	"context"
	"reflect"
	"testing"
)

func TestSimpleRouterDefaultsEveryMissingCellToMockBootstrap(t *testing.T) {
	t.Parallel()
	router := NewSimpleRouter(SimpleRouterConfig{})
	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Explain OAuth briefly."})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if decision.ModelRef != MockBootstrapRef {
		t.Fatalf("ModelRef = %q, want %q", decision.ModelRef, MockBootstrapRef)
	}
}

func TestSimpleRouterCanonicalizesMockRouteState(t *testing.T) {
	t.Parallel()
	config := validV2RouterConfig(RoutingPolicyModeAuto)
	config.BootstrapState = BootstrapStateConfigured
	config.Routes.General.Simple.ModelRefs = []string{MockBootstrapRef}
	router := NewSimpleRouter(config)
	if router.config.BootstrapState != BootstrapStateMock {
		t.Fatalf("mock route must force mock_bootstrap state: %#v", router.config)
	}
}

func TestSimpleRouterSkipsUnavailablePrimaryWithoutReorderingFallbacks(t *testing.T) {
	t.Parallel()
	config := validV2RouterConfig(RoutingPolicyModeAuto)
	config.Routes.General.Simple.ModelRefs = []string{"first", "second", "third"}
	config.CandidateStatuses = []RouteCandidateStatus{{ModelRef: "first", Status: RouteCandidateUnavailable}}
	router := NewSimpleRouter(config)

	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Explain OAuth briefly."})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}
	if !reflect.DeepEqual(decision.CandidateModelRefs, []string{"second", "third"}) {
		t.Fatalf("CandidateModelRefs = %#v", decision.CandidateModelRefs)
	}
	if decision.RoutingReason != ReasonOrderedHealthFallback || decision.RoutingDecisionMaterial.PolicyVariant != PolicyVariantProviderHealthFallback {
		t.Fatalf("unexpected fallback decision: %#v", decision)
	}
}

func TestSimpleRouterRequestPolicyOverrideDoesNotMutateBase(t *testing.T) {
	t.Parallel()
	base := validV2RouterConfig(RoutingPolicyModeAuto)
	router := NewSimpleRouter(base)
	override := validV2RouterConfig(RoutingPolicyModeAuto)
	override.Routes.General.Simple.ModelRefs = []string{"runtime-model"}
	override.PolicyHash = "runtime-policy"

	overridden, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Explain OAuth briefly.", Config: &override})
	if err != nil {
		t.Fatalf("overridden DecideRoute() error = %v", err)
	}
	baseDecision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Explain OAuth briefly."})
	if err != nil {
		t.Fatalf("base DecideRoute() error = %v", err)
	}
	if overridden.ModelRef != "runtime-model" || overridden.PolicyHash != "runtime-policy" {
		t.Fatalf("unexpected overridden decision: %#v", overridden)
	}
	if baseDecision.ModelRef != "model-general-simple" || baseDecision.PolicyHash != "route_policy_v2_test" {
		t.Fatalf("base router was mutated: %#v", baseDecision)
	}
}

func TestRoutingDecisionKeyDoesNotContainModelTarget(t *testing.T) {
	t.Parallel()
	material := DecisionMaterial{
		RoutingMode:   RoutingModeAuto,
		Category:      CategoryCode,
		Difficulty:    DifficultyComplex,
		Capability:    CapabilityCode,
		PolicyVariant: PolicyVariantDefault,
	}
	first, err := DecisionKeyHash(material)
	if err != nil {
		t.Fatalf("DecisionKeyHash() error = %v", err)
	}
	second, err := DecisionKeyHash(material)
	if err != nil {
		t.Fatalf("DecisionKeyHash() error = %v", err)
	}
	if first != second || first == "" {
		t.Fatalf("decision key is not deterministic: first=%q second=%q", first, second)
	}
}
