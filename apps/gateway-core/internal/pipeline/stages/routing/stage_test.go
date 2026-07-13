package routingstage

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/domain/runtimeconfig"
)

type fakeRouter struct {
	decision routing.Decision
	err      error
	request  routing.Request
}

func (r *fakeRouter) DecideRoute(_ context.Context, req routing.Request) (routing.Decision, error) {
	r.request = req
	return r.decision, r.err
}

func TestStageWritesV2RoutingDecisionWithoutProviderOrTier(t *testing.T) {
	t.Parallel()
	router := &fakeRouter{decision: routing.Decision{
		RequestedModel:     "auto",
		ModelRef:           "model-code-primary",
		CandidateModelRefs: []string{"model-code-primary", "model-code-fallback"},
		RoutingReason:      routing.ReasonMatrixRoute,
		PolicyHash:         "route_v2_test",
		RoutingDecisionMaterial: routing.DecisionMaterial{
			RoutingMode: routing.RoutingModeAuto, Category: routing.CategoryCode,
			Difficulty: routing.DifficultyComplex, Capability: routing.CapabilityCode,
			PolicyVariant: routing.PolicyVariantDefault,
		},
		CategoryDiagnostics: routing.CategoryDiagnostics{TopCategory: routing.CategoryCode, TopScore: 5},
	}}
	gatewayCtx := &request.GatewayContext{Request: request.RequestContext{RequestedModel: "auto", PromptText: "debug several files"}}

	if err := NewStage(router).Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if gatewayCtx.Routing.ModelRef != "model-code-primary" || !reflect.DeepEqual(gatewayCtx.Routing.CandidateModelRefs, []string{"model-code-primary", "model-code-fallback"}) {
		t.Fatalf("unexpected model refs: %#v", gatewayCtx.Routing)
	}
	if gatewayCtx.Routing.RoutingDecisionMaterial["category"] != routing.CategoryCode || gatewayCtx.Routing.RoutingDecisionMaterial["difficulty"] != routing.DifficultyComplex {
		t.Fatalf("unexpected decision material: %#v", gatewayCtx.Routing.RoutingDecisionMaterial)
	}
	if _, exists := gatewayCtx.Routing.RoutingDecisionMaterial["tier"]; exists {
		t.Fatalf("tier leaked into v2 decision: %#v", gatewayCtx.Routing.RoutingDecisionMaterial)
	}
}

func TestStagePassesRuntimeV2RoutingPolicy(t *testing.T) {
	t.Parallel()
	policy := runtimeconfig.BootstrapRoutingPolicy("route_v2_runtime")
	policy.Routes.Reasoning.Complex.ModelRefs = []string{"reason-primary", "reason-fallback"}
	router := &fakeRouter{decision: routing.Decision{RequestedModel: "auto", ModelRef: "reason-primary"}}
	gatewayCtx := &request.GatewayContext{
		Request: request.RequestContext{RequestedModel: "auto", PromptText: "compare options"},
		Runtime: request.RuntimeContext{RoutingPolicy: policy, HasRoutingPolicy: true},
	}

	if err := NewStage(router).Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if router.request.Config == nil || router.request.Config.PolicyHash != "route_v2_runtime" {
		t.Fatalf("runtime config was not passed: %#v", router.request.Config)
	}
	if !reflect.DeepEqual(router.request.Config.Routes.Reasoning.Complex.ModelRefs, []string{"reason-primary", "reason-fallback"}) {
		t.Fatalf("ordered runtime refs were not passed: %#v", router.request.Config)
	}
}

func TestStagePropagatesAutoRoutingDisabled(t *testing.T) {
	t.Parallel()
	router := &fakeRouter{err: routing.ErrAutoRoutingDisabled}
	err := NewStage(router).Execute(context.Background(), &request.GatewayContext{Request: request.RequestContext{RequestedModel: "auto"}})
	if !errors.Is(err, routing.ErrAutoRoutingDisabled) {
		t.Fatalf("Execute() error = %v, want ErrAutoRoutingDisabled", err)
	}
}
