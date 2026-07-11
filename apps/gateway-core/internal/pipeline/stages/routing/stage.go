package routingstage

import (
	"context"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/employeepolicy"
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
		HighQualityRestricted: budget.RestrictsHighQuality(gatewayCtx.Governance.BudgetDecision) ||
			employeepolicy.RestrictsHighQuality(gatewayCtx.Governance.EmployeePolicyDecision),
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
	gatewayCtx.Routing.SelectedProvider = decision.SelectedProvider
	gatewayCtx.Routing.SelectedProviderID = decision.SelectedProviderID
	gatewayCtx.Routing.SelectedProviderCatalogKey = decision.SelectedProviderCatalogKey
	gatewayCtx.Routing.SelectedModel = decision.SelectedModel
	gatewayCtx.Routing.SelectedModelID = decision.SelectedModelID
	gatewayCtx.Routing.ProviderCatalogContentHash = decision.ProviderCatalogContentHash
	gatewayCtx.Routing.RoutingDecisionKeyHash = decision.RoutingDecisionKeyHash
	gatewayCtx.Routing.RoutingDecisionMaterial = map[string]string{
		"routingMode":   decision.RoutingDecisionMaterial.RoutingMode,
		"category":      decision.RoutingDecisionMaterial.Category,
		"tier":          decision.RoutingDecisionMaterial.Tier,
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
