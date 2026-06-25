package identify

import (
	"context"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/pipeline"
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

func (s Stage) Execute(_ context.Context, req *pipeline.RequestContext) error {
	if s.expectedTenantID != "" && req.TenantID != s.expectedTenantID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if s.expectedProjectID != "" && req.ProjectID != s.expectedProjectID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if s.expectedApplicationID != "" && req.ApplicationID != s.expectedApplicationID {
		return gatewayerrors.ScopeMismatch(StageName)
	}

	return nil
}
