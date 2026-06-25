package pipeline

import (
	"context"

	"github.com/gatelm/llmops-gateway/apps/gateway-core/internal/domain/request"
)

type Stage interface {
	Name() string
	Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error
}
