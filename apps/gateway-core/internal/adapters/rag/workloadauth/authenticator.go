package workloadauth

import (
	"context"
	"errors"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/ragembedding"
)

var (
	ErrInvalidRequest   = errors.New("rag embedding request is invalid")
	ErrTokenInvalid     = errors.New("rag embedding workload token is invalid")
	ErrGuardUnavailable = errors.New("rag embedding workload replay guard is unavailable")
)

type JTIConsumer interface {
	Consume(ctx context.Context, jti string, expiresAt time.Time) error
}

type Authenticator struct {
	verifier *Verifier
	jti      JTIConsumer
}

func NewAuthenticator(verifier *Verifier, jti JTIConsumer) *Authenticator {
	return &Authenticator{verifier: verifier, jti: jti}
}

func (a *Authenticator) Authenticate(
	ctx context.Context,
	authorization string,
	request ragembedding.Request,
) (ragembedding.VerifiedScope, error) {
	if a == nil || a.verifier == nil || a.jti == nil {
		return ragembedding.VerifiedScope{}, ErrGuardUnavailable
	}
	if err := ragembedding.ValidateRequest(request); err != nil {
		return ragembedding.VerifiedScope{}, ErrInvalidRequest
	}
	rawToken, err := BearerToken(authorization)
	if err != nil {
		return ragembedding.VerifiedScope{}, ErrTokenInvalid
	}
	verified, err := a.verifier.verify(rawToken)
	if err != nil {
		return ragembedding.VerifiedScope{}, ErrTokenInvalid
	}
	if verified.claims.Purpose != request.Purpose || verified.claims.ProfileVersion != request.ProfileVersion {
		return ragembedding.VerifiedScope{}, ErrTokenInvalid
	}

	payloadDigest, err := ragembedding.ComputePayloadDigest(request)
	if err != nil {
		return ragembedding.VerifiedScope{}, ErrInvalidRequest
	}
	binding := ragembedding.BindingObject{
		TenantID:       verified.claims.TenantID,
		RequestID:      verified.claims.RequestID,
		OperationID:    verified.claims.OperationID,
		Purpose:        verified.claims.Purpose,
		ProfileVersion: verified.claims.ProfileVersion,
		PayloadDigest:  payloadDigest,
	}
	bindingDigest, _, err := ragembedding.ComputeBindingDigest(binding, verified.bindingKey)
	if err != nil || !ragembedding.BindingDigestMatches(verified.claims.BindingDigest, bindingDigest) {
		return ragembedding.VerifiedScope{}, ErrTokenInvalid
	}

	caller, err := ragembedding.NewCallerIdentity(
		verified.identity.issuer,
		verified.identity.subject,
		verified.kid,
	)
	if err != nil {
		return ragembedding.VerifiedScope{}, ErrTokenInvalid
	}
	scope, err := ragembedding.NewVerifiedScope(
		verified.claims.TenantID,
		verified.claims.RequestID,
		verified.claims.OperationID,
		verified.claims.Purpose,
		verified.claims.ProfileVersion,
		caller,
	)
	if err != nil {
		return ragembedding.VerifiedScope{}, ErrTokenInvalid
	}

	if err := a.jti.Consume(ctx, verified.claims.ID, verified.claims.ExpiresAt.Time); err != nil {
		if errors.Is(err, errJTIReplayed) {
			return ragembedding.VerifiedScope{}, ErrTokenInvalid
		}
		return ragembedding.VerifiedScope{}, ErrGuardUnavailable
	}
	return scope, nil
}

func BearerToken(authorization string) (string, error) {
	parts := strings.Fields(authorization)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", ErrTokenInvalid
	}
	return parts[1], nil
}
