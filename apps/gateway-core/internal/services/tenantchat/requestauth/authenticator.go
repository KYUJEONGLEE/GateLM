package requestauth

import (
	"context"
	"errors"
	"regexp"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
)

var canonicalUUIDPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
)

var (
	ErrInvalidRequest   = errors.New("tenant chat request is invalid")
	ErrTokenInvalid     = errors.New("tenant chat workload token is invalid")
	ErrGuardUnavailable = errors.New("tenant chat workload replay guard is unavailable")
)

type tokenVerifier interface {
	Verify(rawToken string, expectedPhase tenantchat.Phase) (workloadauth.VerifiedToken, error)
}

type jtiConsumer interface {
	Consume(ctx context.Context, jti string, expiresAt time.Time) error
}

type Authenticator struct {
	verifier tokenVerifier
	jti      jtiConsumer
}

func New(verifier tokenVerifier, jti jtiConsumer) *Authenticator {
	return &Authenticator{verifier: verifier, jti: jti}
}

func (a *Authenticator) Authenticate(
	ctx context.Context,
	authorization string,
	expectedPhase tenantchat.Phase,
	requestContext tenantchat.RequestContext,
	payload any,
) (workloadauth.VerifiedToken, error) {
	if a == nil || a.verifier == nil || a.jti == nil {
		return workloadauth.VerifiedToken{}, ErrGuardUnavailable
	}
	if err := tenantchat.ValidateContext(requestContext, expectedPhase); err != nil {
		return workloadauth.VerifiedToken{}, ErrInvalidRequest
	}
	rawToken, err := workloadauth.BearerToken(authorization)
	if err != nil {
		return workloadauth.VerifiedToken{}, ErrTokenInvalid
	}
	verified, err := a.verifier.Verify(rawToken, expectedPhase)
	if err != nil || workloadauth.MatchContext(verified, requestContext) != nil {
		return workloadauth.VerifiedToken{}, ErrTokenInvalid
	}
	if !validPersistenceIdentity(requestContext) {
		return workloadauth.VerifiedToken{}, ErrTokenInvalid
	}

	payloadDigest := tenantchat.EmptyPayloadDigest
	if expectedPhase == tenantchat.PhaseCompletion || expectedPhase == tenantchat.PhaseSanitization {
		payloadDigest, err = tenantchat.ComputePayloadDigest(payload)
		if err != nil {
			return workloadauth.VerifiedToken{}, ErrInvalidRequest
		}
	}
	binding := tenantchat.BuildBindingObject(requestContext, payloadDigest)
	bindingDigest, _, err := tenantchat.ComputeBindingDigest(binding, verified.BindingKey)
	if err != nil || !tenantchat.BindingDigestMatches(verified.Claims.BindingDigest, bindingDigest) {
		return workloadauth.VerifiedToken{}, ErrTokenInvalid
	}
	if err := a.jti.Consume(ctx, verified.Claims.ID, verified.Claims.ExpiresAt.Time); err != nil {
		if errors.Is(err, workloadauth.ErrJTIReplayed) {
			return workloadauth.VerifiedToken{}, ErrTokenInvalid
		}
		return workloadauth.VerifiedToken{}, ErrGuardUnavailable
	}
	return verified, nil
}

func validPersistenceIdentity(requestContext tenantchat.RequestContext) bool {
	actor := requestContext.ExecutionScope.Actor
	if !canonicalUUIDPattern.MatchString(requestContext.ExecutionScope.TenantID) ||
		!canonicalUUIDPattern.MatchString(actor.UserID) {
		return false
	}
	if actor.EmployeeID != "" && !canonicalUUIDPattern.MatchString(actor.EmployeeID) {
		return false
	}
	if requestContext.Phase != tenantchat.PhaseAdmission &&
		!canonicalUUIDPattern.MatchString(requestContext.AdmissionID) {
		return false
	}
	return true
}
