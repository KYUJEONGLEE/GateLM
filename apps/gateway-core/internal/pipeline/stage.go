package pipeline

import (
	"context"

	"gatelm/apps/gateway-core/internal/domain/request"
)

type DomainStage interface {
	Name() string
	Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error
}
