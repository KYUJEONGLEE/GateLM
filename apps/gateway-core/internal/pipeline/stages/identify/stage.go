package identify

import (
	"context"

	gatewayerrors "github.com/gatelm/llmops-gateway/apps/gateway-core/internal/domain/errors"
	"github.com/gatelm/llmops-gateway/apps/gateway-core/internal/domain/request"
)

const StageName = "resolve_tenant_project_application"

type Stage struct {
	expectedTenantID      string
	expectedProjectID     string
	expectedApplicationID string
}

func NewStage(expectedTenantID string, expectedProjectID string, expectedApplicationID string) Stage {
	return Stage{
		expectedTenantID:      expectedTenantID,
		expectedProjectID:     expectedProjectID,
		expectedApplicationID: expectedApplicationID,
	}
}

func (s Stage) Name() string {
	return StageName
}

func (s Stage) Execute(_ context.Context, gatewayCtx *request.GatewayContext) error {
	if s.expectedTenantID != "" && gatewayCtx.Identity.TenantID != s.expectedTenantID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if s.expectedProjectID != "" && gatewayCtx.Identity.ProjectID != s.expectedProjectID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if s.expectedApplicationID != "" && gatewayCtx.Identity.ApplicationID != s.expectedApplicationID {
		return gatewayerrors.ScopeMismatch(StageName)
	}

	return nil
}
