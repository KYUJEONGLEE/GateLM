package requestauth

import (
	"context"
	"errors"
	"testing"
	"time"

	"gatelm/apps/gateway-core/internal/adapters/tenantchat/workloadauth"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/golang-jwt/jwt/v5"
)

type fakeVerifier struct {
	token workloadauth.VerifiedToken
	err   error
}

func (v fakeVerifier) Verify(_ string, _ tenantchat.Phase) (workloadauth.VerifiedToken, error) {
	return v.token, v.err
}

type fakeJTIConsumer struct {
	calls int
	jti   string
	err   error
}

func (c *fakeJTIConsumer) Consume(_ context.Context, jti string, _ time.Time) error {
	c.calls++
	c.jti = jti
	return c.err
}

func TestAuthenticateConsumesJTIOnlyAfterExactBinding(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	requestContext := admissionContextFixture()
	bindingDigest, _, err := tenantchat.ComputeBindingDigest(
		tenantchat.BuildBindingObject(requestContext, tenantchat.EmptyPayloadDigest),
		key,
	)
	if err != nil {
		t.Fatalf("compute fixture binding: %v", err)
	}
	requestContext.BindingDigest = bindingDigest
	claims := claimsForContext(requestContext, bindingDigest)
	consumer := &fakeJTIConsumer{}
	authenticator := New(fakeVerifier{token: workloadauth.VerifiedToken{
		Claims:     claims,
		KID:        "fixture_kid",
		BindingKey: key,
	}}, consumer)

	verified, err := authenticator.Authenticate(
		context.Background(),
		"Bearer signed-token",
		tenantchat.PhaseAdmission,
		requestContext,
		nil,
	)
	if err != nil {
		t.Fatalf("authenticate exact request: %v", err)
	}
	if verified.Claims.ID != claims.ID || consumer.calls != 1 || consumer.jti != claims.ID {
		t.Fatalf("unexpected authentication result or jti consumption")
	}

	requestContext.BindingDigest = "hmac-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	if _, err := authenticator.Authenticate(
		context.Background(),
		"Bearer signed-token",
		tenantchat.PhaseAdmission,
		requestContext,
		nil,
	); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("want invalid token for changed binding, got %v", err)
	}
	if consumer.calls != 1 {
		t.Fatalf("binding failure consumed jti: calls=%d", consumer.calls)
	}
}

func TestAuthenticateFailsClosedWhenJTIStoreIsUnavailable(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	requestContext := admissionContextFixture()
	bindingDigest, _, err := tenantchat.ComputeBindingDigest(
		tenantchat.BuildBindingObject(requestContext, tenantchat.EmptyPayloadDigest),
		key,
	)
	if err != nil {
		t.Fatalf("compute fixture binding: %v", err)
	}
	requestContext.BindingDigest = bindingDigest
	claims := claimsForContext(requestContext, bindingDigest)
	authenticator := New(
		fakeVerifier{token: workloadauth.VerifiedToken{Claims: claims, BindingKey: key}},
		&fakeJTIConsumer{err: workloadauth.ErrJTIUnavailable},
	)

	if _, err := authenticator.Authenticate(
		context.Background(),
		"Bearer signed-token",
		tenantchat.PhaseAdmission,
		requestContext,
		nil,
	); !errors.Is(err, ErrGuardUnavailable) {
		t.Fatalf("want unavailable guard, got %v", err)
	}
}

func admissionContextFixture() tenantchat.RequestContext {
	return tenantchat.RequestContext{
		Surface:        "tenant_chat",
		Phase:          tenantchat.PhaseAdmission,
		RequestID:      "request_fixture_001",
		TurnID:         "turn_fixture_001",
		IdempotencyKey: "turn_fixture_001_attempt_1",
		ExecutionScope: tenantchat.ExecutionScope{
			Kind:     "tenant_chat",
			TenantID: "tenant_fixture_001",
			Actor: tenantchat.Actor{
				UserID:     "user_fixture_001",
				ActorKind:  "employee",
				EmployeeID: "employee_fixture_001",
			},
			QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: "user_fixture_001"},
			BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: "tenant_fixture_001"},
		},
		Snapshot: tenantchat.SnapshotReference{
			Version:               12,
			Digest:                "sha256:QTJXSkcD9dvUyD2iz63k6npQETJmbS9IvHe9Bx8xx9M",
			PolicyVersion:         4,
			EmployeeNoticeVersion: 2,
			PricingVersion:        7,
		},
		BindingDigest: "hmac-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	}
}

func claimsForContext(context tenantchat.RequestContext, bindingDigest string) workloadauth.Claims {
	now := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)
	return workloadauth.Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "jti_fixture_001",
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-5 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(30 * time.Second)),
		},
		Phase:              context.Phase,
		RequestID:          context.RequestID,
		TurnID:             context.TurnID,
		IdempotencyKey:     context.IdempotencyKey,
		TenantID:           context.ExecutionScope.TenantID,
		UserID:             context.ExecutionScope.Actor.UserID,
		ActorKind:          context.ExecutionScope.Actor.ActorKind,
		EmployeeID:         context.ExecutionScope.Actor.EmployeeID,
		SnapshotVersion:    context.Snapshot.Version,
		SnapshotDigest:     context.Snapshot.Digest,
		BindingDigest:      bindingDigest,
		ActorAuthzVersion:  1,
		TenantAuthzVersion: 1,
		SessionVersion:     1,
	}
}
