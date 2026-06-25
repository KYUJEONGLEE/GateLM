package appauth

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/pipeline"
)

const StageName = "validate_app_token"

type AppTokenValidator interface {
	ValidateAppToken(ctx context.Context, appToken string) (auth.AppTokenIdentity, error)
}

type Stage struct {
	validator AppTokenValidator
	appToken  string
}

func NewStage(validator AppTokenValidator, appToken string) Stage {
	return Stage{
		validator: validator,
		appToken:  appToken,
	}
}

func (s Stage) Name() string {
	return StageName
}

func (s Stage) Execute(ctx context.Context, req *pipeline.RequestContext) error {
	identity, err := s.validator.ValidateAppToken(ctx, s.appToken)
	if err != nil {
		var gatewayErr gatewayerrors.GatewayError
		if errors.As(err, &gatewayErr) {
			return err
		}
		return gatewayerrors.InvalidAppToken(StageName)
	}

	if req.TenantID != "" && req.TenantID != identity.TenantID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if req.ProjectID != "" && req.ProjectID != identity.ProjectID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if req.ApplicationID != "" && req.ApplicationID != identity.ApplicationID {
		return gatewayerrors.ScopeMismatch(StageName)
	}

	req.AppTokenID = identity.AppTokenID
	if req.TenantID == "" {
		req.TenantID = identity.TenantID
	}
	if req.ProjectID == "" {
		req.ProjectID = identity.ProjectID
	}
	if req.ApplicationID == "" {
		req.ApplicationID = identity.ApplicationID
	}

	return nil
}
