package authenticate

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/pipeline"
)

const StageName = "authenticate_api_key"

type APIKeyAuthenticator interface {
	AuthenticateAPIKey(ctx context.Context, bearerToken string) (auth.APIKeyIdentity, error)
}

type Stage struct {
	authenticator APIKeyAuthenticator
	bearerToken   string
}

func NewStage(authenticator APIKeyAuthenticator, bearerToken string) Stage {
	return Stage{
		authenticator: authenticator,
		bearerToken:   bearerToken,
	}
}

func (s Stage) Name() string {
	return StageName
}

func (s Stage) Execute(ctx context.Context, req *pipeline.RequestContext) error {
	identity, err := s.authenticator.AuthenticateAPIKey(ctx, s.bearerToken)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return gatewayerrors.RequestCancelled(StageName, err)
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return gatewayerrors.InternalError(StageName, "Gateway authentication timed out.", err)
		}
		var gatewayErr gatewayerrors.GatewayError
		if errors.As(err, &gatewayErr) {
			return err
		}
		if errors.Is(err, auth.ErrInvalidAPIKey) {
			return gatewayerrors.InvalidAPIKey(StageName)
		}
		return gatewayerrors.InternalError(StageName, "Gateway API key authentication failed.", err)
	}

	req.APIKeyID = identity.APIKeyID
	req.TenantID = identity.TenantID
	req.ProjectID = identity.ProjectID
	if identity.ApplicationID != "" {
		req.ApplicationID = identity.ApplicationID
	}

	return nil
}
