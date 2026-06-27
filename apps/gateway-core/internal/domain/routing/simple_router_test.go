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

	assertDecision(t, decision, Decision{
		RequestedModel:   "auto",
		SelectedProvider: "mock",
		SelectedModel:    "mock-fast",
		RoutingReason:    ReasonShortPromptLowCost,
		PolicyHash:       "route_p0_v1",
	})
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

	assertDecision(t, decision, Decision{
		RequestedModel:   "auto",
		SelectedProvider: "mock",
		SelectedModel:    "mock-balanced",
		RoutingReason:    ReasonDefaultBalanced,
		PolicyHash:       "route_p0_v1",
	})
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

	assertDecision(t, decision, Decision{
		RequestedModel:   "mock-smart",
		SelectedProvider: "mock",
		SelectedModel:    "mock-smart",
		RoutingReason:    ReasonPinned,
		PolicyHash:       "route_p0_v1",
	})
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

	assertDecision(t, decision, Decision{
		RequestedModel:   "auto",
		SelectedProvider: "runtime-provider",
		SelectedModel:    "runtime-fast",
		RoutingReason:    ReasonShortPromptLowCost,
		PolicyHash:       "hash_runtime_routing_policy",
	})
}

func assertDecision(t *testing.T, actual Decision, expected Decision) {
	t.Helper()

	if actual != expected {
		t.Fatalf("unexpected decision:\nactual:   %#v\nexpected: %#v", actual, expected)
	}
}
