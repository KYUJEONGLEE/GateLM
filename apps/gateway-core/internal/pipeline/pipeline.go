package pipeline

import (
	"context"

	"gatelm/apps/gateway-core/internal/domain/request"
)

type Pipeline struct {
	stages []Stage
}

func New(stages ...Stage) Pipeline {
	return Pipeline{stages: stages}
}

func (p Pipeline) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	for _, stage := range p.stages {
		if err := stage.Execute(ctx, gatewayCtx); err != nil {
			return err
		}
	}
	return nil
}
