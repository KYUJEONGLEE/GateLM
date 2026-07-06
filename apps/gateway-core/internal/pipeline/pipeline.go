package pipeline

import (
	"context"
	"time"

	"gatelm/apps/gateway-core/internal/domain/request"
	"gatelm/apps/gateway-core/internal/domain/stagetiming"
)

type Pipeline struct {
	stages []Stage
}

func New(stages ...Stage) Pipeline {
	return Pipeline{stages: stages}
}

func (p Pipeline) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	for _, stage := range p.stages {
		startedAt := time.Now()
		err := stage.Execute(ctx, gatewayCtx)
		if gatewayCtx != nil {
			stagetiming.Record(&gatewayCtx.StageTimings, stage.Name(), time.Since(startedAt))
		}
		if err != nil {
			return err
		}
	}
	return nil
}
