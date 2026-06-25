package authenticate

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/pipeline"
)

type fakeAuthenticator struct {
	identity auth.APIKeyIdentity
	err      error
}

func (a fakeAuthenticator) AuthenticateAPIKey(_ context.Context, _ string) (auth.APIKeyIdentity, error) {
	return a.identity, a.err
}

func TestStageWritesAPIKeyIdentity(t *testing.T) {
	stage := NewStage(fakeAuthenticator{
		identity: auth.APIKeyIdentity{
			APIKeyID:      "api_key_demo",
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
	}, "redacted_api_key")
	req := &pipeline.RequestContext{}

	if err := stage.Execute(context.Background(), req); err != nil {
		t.Fatalf("expected API key stage to pass, got %v", err)
	}
	if req.APIKeyID != "api_key_demo" || req.TenantID != "tenant_demo" {
		t.Fatalf("expected API key identity to be written, got %#v", req)
	}
}

func TestStageMapsInvalidAPIKeyToGatewayError(t *testing.T) {
	stage := NewStage(fakeAuthenticator{err: auth.ErrInvalidAPIKey}, "redacted_api_key")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 401 || gatewayErr.Code != "invalid_api_key" {
		t.Fatalf("expected 401 invalid_api_key, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
}

func TestStageMapsUnexpectedAuthenticatorErrorToInternalError(t *testing.T) {
	upstreamErr := errors.New("credential store unavailable")
	stage := NewStage(fakeAuthenticator{err: upstreamErr}, "redacted_api_key")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 500 || gatewayErr.Code != "internal_error" {
		t.Fatalf("expected 500 internal_error, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
	if !errors.Is(err, upstreamErr) {
		t.Fatalf("expected wrapped upstream error, got %v", err)
	}
}

func TestStagePreservesCanceledContextAsCancelled(t *testing.T) {
	stage := NewStage(fakeAuthenticator{err: context.Canceled}, "redacted_api_key")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != gatewayerrors.StatusClientClosedRequest || gatewayErr.Code == "invalid_api_key" {
		t.Fatalf("expected cancelled context not invalid_api_key, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected wrapped context.Canceled, got %v", err)
	}
}

func TestStageMapsDeadlineExceededToInternalError(t *testing.T) {
	stage := NewStage(fakeAuthenticator{err: context.DeadlineExceeded}, "redacted_api_key")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 500 || gatewayErr.Code != "internal_error" {
		t.Fatalf("expected 500 internal_error, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected wrapped context.DeadlineExceeded, got %v", err)
	}
}
