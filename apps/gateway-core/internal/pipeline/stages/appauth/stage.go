package appauth

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
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

func (s Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	identity, err := s.validator.ValidateAppToken(ctx, s.appToken)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return gatewayerrors.RequestCancelled(StageName, err)
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return gatewayerrors.InternalError(StageName, "Gateway app token validation timed out.", err)
		}
		var gatewayErr gatewayerrors.GatewayError
		if errors.As(err, &gatewayErr) {
			return err
		}
		if errors.Is(err, auth.ErrInvalidAppToken) {
			return gatewayerrors.InvalidAppToken(StageName)
		}
		return gatewayerrors.InternalError(StageName, "Gateway app token validation failed.", err)
	}

	if gatewayCtx.Identity.TenantID != "" && gatewayCtx.Identity.TenantID != identity.TenantID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if gatewayCtx.Identity.ProjectID != "" && gatewayCtx.Identity.ProjectID != identity.ProjectID {
		return gatewayerrors.ScopeMismatch(StageName)
	}
	if gatewayCtx.Identity.ApplicationID != "" && gatewayCtx.Identity.ApplicationID != identity.ApplicationID {
		return gatewayerrors.ScopeMismatch(StageName)
	}

	gatewayCtx.Identity.AppTokenID = identity.AppTokenID
	if gatewayCtx.Identity.TenantID == "" {
		gatewayCtx.Identity.TenantID = identity.TenantID
	}
	if gatewayCtx.Identity.ProjectID == "" {
		gatewayCtx.Identity.ProjectID = identity.ProjectID
	}
	if gatewayCtx.Identity.ApplicationID == "" {
		gatewayCtx.Identity.ApplicationID = identity.ApplicationID
	}

	return nil
}
