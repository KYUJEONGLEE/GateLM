package routingstage

import (
	"context"

	"gatelm/apps/gateway-core/internal/domain/routing"
	"gatelm/apps/gateway-core/internal/pipeline"
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

func (s Stage) Execute(ctx context.Context, req *pipeline.RequestContext) error {
	decision, err := s.router.DecideRoute(ctx, routing.Request{
		RequestedModel: req.RequestedModel,
		PromptText:     req.PromptText,
	})
	if err != nil {
		return err
	}

	req.RequestedModel = decision.RequestedModel
	req.SelectedProvider = decision.SelectedProvider
	req.SelectedModel = decision.SelectedModel
	req.RoutingReason = decision.RoutingReason
	req.RoutingPolicyHash = decision.PolicyHash

	return nil
}
