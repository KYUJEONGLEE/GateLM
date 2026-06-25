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
	decision, err := s.router.DecideRoute(ctx, routing.Request{
		RequestedModel: gatewayCtx.Request.RequestedModel,
		PromptText:     gatewayCtx.Request.PromptText,
	})
	if err != nil {
		return err
	}

	gatewayCtx.Routing.RequestedModel = decision.RequestedModel
	gatewayCtx.Routing.SelectedProvider = decision.SelectedProvider
	gatewayCtx.Routing.SelectedModel = decision.SelectedModel
	gatewayCtx.Routing.RoutingReason = decision.RoutingReason
	gatewayCtx.Routing.RoutingPolicyHash = decision.PolicyHash

	return nil
}
