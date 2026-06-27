package routingstage

import (
	"context"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

type fakeRouter struct {
	decision routing.Decision
	request  routing.Request
}

func (r *fakeRouter) DecideRoute(_ context.Context, req routing.Request) (routing.Decision, error) {
	r.request = req
	return r.decision, nil
}

func TestStageWritesRoutingFields(t *testing.T) {
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock",
			SelectedModel:    "mock-fast",
			RoutingReason:    routing.ReasonShortPromptLowCost,
			PolicyHash:       "route_p0_v1",
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "short prompt",
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}

	if gatewayCtx.Routing.RequestedModel != "auto" {
		t.Fatalf("expected requested model to remain auto, got %s", gatewayCtx.Routing.RequestedModel)
	}
	if gatewayCtx.Routing.SelectedProvider != "mock" || gatewayCtx.Routing.SelectedModel != "mock-fast" {
		t.Fatalf("expected mock/mock-fast route, got %s/%s", gatewayCtx.Routing.SelectedProvider, gatewayCtx.Routing.SelectedModel)
	}
	if gatewayCtx.Routing.RoutingReason != routing.ReasonShortPromptLowCost {
		t.Fatalf("expected short prompt routing reason, got %s", gatewayCtx.Routing.RoutingReason)
	}
	if gatewayCtx.Routing.RoutingPolicyHash != "route_p0_v1" {
		t.Fatalf("expected route_p0_v1 policy hash, got %s", gatewayCtx.Routing.RoutingPolicyHash)
	}
}

func TestStagePassesRuntimeRoutingPolicyToRouter(t *testing.T) {
	router := &fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock",
			SelectedModel:    "mock-fast",
			RoutingReason:    routing.ReasonShortPromptLowCost,
			PolicyHash:       "hash_routing_policy_test",
		},
	}
	stage := NewStage(router)
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{
			RequestedModel: "auto",
			PromptText:     "short prompt",
		},
		Runtime: request.RuntimeContext{
			RoutingPolicy: runtimeconfig.RoutingPolicy{
				DefaultProvider:     "mock",
				DefaultModel:        "mock-balanced",
				LowCostProvider:     "mock",
				LowCostModel:        "mock-fast",
				FallbackProvider:    "mock",
				FallbackModel:       "mock-balanced",
				ShortPromptMaxChars: 500,
				RoutingPolicyHash:   "hash_routing_policy_test",
			},
			HasRoutingPolicy: true,
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}

	if router.request.Config == nil {
		t.Fatal("expected runtime routing config to be passed")
	}
	if router.request.Config.PolicyHash != "hash_routing_policy_test" || router.request.Config.ShortPromptMaxChars != 500 {
		t.Fatalf("unexpected runtime routing config: %#v", router.request.Config)
	}
}
