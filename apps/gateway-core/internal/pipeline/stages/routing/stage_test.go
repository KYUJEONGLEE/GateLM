package routingstage

import (
	"context"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

type fakeRouter struct {
	decision routing.Decision
}

func (r fakeRouter) DecideRoute(_ context.Context, _ routing.Request) (routing.Decision, error) {
	return r.decision, nil
}

func TestStageWritesRoutingFields(t *testing.T) {
	stage := NewStage(fakeRouter{
		decision: routing.Decision{
			RequestedModel:   "auto",
			SelectedProvider: "mock",
			SelectedModel:    "mock-fast",
			RoutingReason:    routing.ReasonShortPromptLowCost,
			PolicyHash:       "route_p0_v1",
		},
	})
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
