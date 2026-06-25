package routingstage

import (
	"context"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/pipeline"
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
			RoutingReason:    "low_cost",
			PolicyHash:       "routing_policy_demo",
		},
	})
	req := &pipeline.RequestContext{
		RequestedModel: "auto",
		PromptText:     "short prompt",
	}

	if err := stage.Execute(context.Background(), req); err != nil {
		t.Fatalf("expected routing stage to pass, got %v", err)
	}

	if req.RequestedModel != "auto" {
		t.Fatalf("expected requested model to remain auto, got %s", req.RequestedModel)
	}
	if req.SelectedProvider != "mock" || req.SelectedModel != "mock-fast" {
		t.Fatalf("expected mock/mock-fast route, got %s/%s", req.SelectedProvider, req.SelectedModel)
	}
	if req.RoutingReason != "low_cost" {
		t.Fatalf("expected low_cost routing reason, got %s", req.RoutingReason)
	}
}
