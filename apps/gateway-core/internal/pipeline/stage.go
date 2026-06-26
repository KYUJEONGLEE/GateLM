package pipeline

import (
	"context"

	"gatelm/apps/gateway-core/internal/domain/request"
)

type Stage interface {
	Name() string
	Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error
}

type DomainStage = Stage
