package routingstage

import (
	"context"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

const StageName = "decide_model_route"

type Router interface {
	DecideRoute(ctx context.Context, req routing.Request) (routing.Decision, error)
}

type Stage struct {
	router Router
}

func NewStage(router Router) Stage {
	return Stage{router: router}
}

func (s Stage) Name() string {
	return StageName
}

func (s Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	routeReq := routing.Request{
		RequestedModel: gatewayCtx.Request.RequestedModel,
		PromptText:     gatewayCtx.Request.PromptText,
	}
	if gatewayCtx.Runtime.HasRoutingPolicy {
		config := gatewayCtx.Runtime.RoutingPolicy.SimpleRouterConfig()
		routeReq.Config = &config
	}

	decision, err := s.router.DecideRoute(ctx, routeReq)
	if err != nil {
		return err
	}

	gatewayCtx.Routing.RequestedModel = decision.RequestedModel
	gatewayCtx.Routing.ModelRef = decision.ModelRef
	gatewayCtx.Routing.CandidateModelRefs = append([]string(nil), decision.CandidateModelRefs...)
	gatewayCtx.Routing.RoutingDecisionKeyHash = decision.RoutingDecisionKeyHash
	gatewayCtx.Routing.RoutingDecisionMaterial = map[string]string{
		"routingMode":   decision.RoutingDecisionMaterial.RoutingMode,
		"category":      decision.RoutingDecisionMaterial.Category,
		"difficulty":    decision.RoutingDecisionMaterial.Difficulty,
		"capability":    decision.RoutingDecisionMaterial.Capability,
		"policyVariant": decision.RoutingDecisionMaterial.PolicyVariant,
	}
	gatewayCtx.Routing.RoutingReason = decision.RoutingReason
	gatewayCtx.Routing.RoutingPolicyHash = decision.PolicyHash
	if decision.CategoryDiagnostics.HasData() {
		gatewayCtx.Routing.CategoryDiagnostics = decision.CategoryDiagnostics.WithSelectedCategory(decision.RoutingDecisionMaterial.Category)
	}

	return nil
}
