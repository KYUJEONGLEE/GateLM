package pipeline

import "context"

type Stage interface {
	Name() string
	Execute(ctx context.Context, req *RequestContext) error
}

type Pipeline struct {
	stages []Stage
}

func New(stages ...Stage) Pipeline {
	return Pipeline{stages: stages}
}

func (p Pipeline) Execute(ctx context.Context, req *RequestContext) error {
	for _, stage := range p.stages {
		if err := stage.Execute(ctx, req); err != nil {
			return err
		}
	}
	return nil
}
