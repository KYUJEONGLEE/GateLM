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

func TestAuthenticateBindsSanitizationInputBeforeConsumingJTI(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	requestContext := admissionContextFixture()
	requestContext.Phase = tenantchat.PhaseSanitization
	requestContext.AdmissionID = "00000000-0000-4000-8000-000000000400"
	input := tenantchat.SanitizationInput{
		Messages: []tenantchat.EphemeralMessage{{Role: "user", Content: "raw input"}},
	}
	payloadDigest, err := tenantchat.ComputePayloadDigest(input)
	if err != nil {
		t.Fatalf("compute sanitization payload digest: %v", err)
	}
	bindingDigest, _, err := tenantchat.ComputeBindingDigest(
		tenantchat.BuildBindingObject(requestContext, payloadDigest),
		key,
	)
	if err != nil {
		t.Fatalf("compute sanitization binding: %v", err)
	}
	requestContext.BindingDigest = bindingDigest
	claims := claimsForContext(requestContext, bindingDigest)

	consumer := &fakeJTIConsumer{}
	authenticator := New(fakeVerifier{token: workloadauth.VerifiedToken{
		Claims: claims, BindingKey: key,
	}}, consumer)
	if _, err := authenticator.Authenticate(
		context.Background(), "Bearer signed-token", tenantchat.PhaseSanitization, requestContext, input,
	); err != nil {
		t.Fatalf("authenticate sanitization input: %v", err)
	}
	if consumer.calls != 1 {
		t.Fatalf("valid sanitization did not consume jti exactly once: %d", consumer.calls)
	}

	tamperedConsumer := &fakeJTIConsumer{}
	tamperedAuthenticator := New(fakeVerifier{token: workloadauth.VerifiedToken{
		Claims: claims, BindingKey: key,
	}}, tamperedConsumer)
	input.Messages[0].Content = "tampered raw input"
	if _, err := tamperedAuthenticator.Authenticate(
		context.Background(), "Bearer signed-token", tenantchat.PhaseSanitization, requestContext, input,
	); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("want invalid token for changed sanitization payload, got %v", err)
	}
	if tamperedConsumer.calls != 0 {
		t.Fatalf("tampered sanitization consumed jti: calls=%d", tamperedConsumer.calls)
	}
}

func TestAuthenticateRejectsNonUUIDPersistenceIdentityBeforeJTIConsumption(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	requestContext := admissionContextFixture()
	requestContext.ExecutionScope.TenantID = "tenant_fixture_001"
	requestContext.ExecutionScope.BudgetScope.ID = requestContext.ExecutionScope.TenantID
	bindingDigest, _, err := tenantchat.ComputeBindingDigest(
		tenantchat.BuildBindingObject(requestContext, tenantchat.EmptyPayloadDigest),
		key,
	)
	if err != nil {
		t.Fatalf("compute fixture binding: %v", err)
	}
	requestContext.BindingDigest = bindingDigest
	consumer := &fakeJTIConsumer{}
	authenticator := New(
		fakeVerifier{token: workloadauth.VerifiedToken{
			Claims:     claimsForContext(requestContext, bindingDigest),
			BindingKey: key,
		}},
		consumer,
	)

	if _, err := authenticator.Authenticate(
		context.Background(),
		"Bearer signed-token",
		tenantchat.PhaseAdmission,
		requestContext,
		nil,
	); !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("want invalid token for non-UUID persistence identity, got %v", err)
	}
	if consumer.calls != 0 {
		t.Fatalf("invalid persistence identity consumed jti: calls=%d", consumer.calls)
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
			TenantID: "00000000-0000-4000-8000-000000000100",
			Actor: tenantchat.Actor{
				UserID:     "00000000-0000-4000-8000-000000000200",
				ActorKind:  "employee",
				EmployeeID: "00000000-0000-4000-8000-000000000300",
			},
			QuotaScope:  tenantchat.ScopeReference{Type: "user", ID: "00000000-0000-4000-8000-000000000200"},
			BudgetScope: tenantchat.ScopeReference{Type: "tenant", ID: "00000000-0000-4000-8000-000000000100"},
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
		AdmissionID:        context.AdmissionID,
		ActorAuthzVersion:  1,
		TenantAuthzVersion: 1,
		SessionVersion:     1,
	}
}
