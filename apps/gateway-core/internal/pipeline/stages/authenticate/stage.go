package authenticate

import (
	"context"

	"github.com/gatelm/llmops-gateway/apps/gateway-core/internal/domain/auth"
	"github.com/gatelm/llmops-gateway/apps/gateway-core/internal/domain/request"
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

func (s Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	identity, err := s.authenticator.AuthenticateAPIKey(ctx, s.bearerToken)
	if err != nil {
		return err
	}

	gatewayCtx.Identity.APIKeyID = identity.APIKeyID
	gatewayCtx.Identity.TenantID = identity.TenantID
	gatewayCtx.Identity.ProjectID = identity.ProjectID
	if identity.ApplicationID != "" {
		gatewayCtx.Identity.ApplicationID = identity.ApplicationID
	}

	return nil
}
