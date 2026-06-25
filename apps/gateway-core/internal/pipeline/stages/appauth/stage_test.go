package appauth

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/pipeline"
)

type fakeValidator struct {
	identity auth.AppTokenIdentity
	err      error
}

func (v fakeValidator) ValidateAppToken(_ context.Context, _ string) (auth.AppTokenIdentity, error) {
	return v.identity, v.err
}

func TestStageWritesAppTokenIdentity(t *testing.T) {
	stage := NewStage(fakeValidator{
		identity: auth.AppTokenIdentity{
			AppTokenID:    "app_token_demo",
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
	}, "redacted_app_token")
	req := &pipeline.RequestContext{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}

	if err := stage.Execute(context.Background(), req); err != nil {
		t.Fatalf("expected app token stage to pass, got %v", err)
	}
	if req.AppTokenID != "app_token_demo" || req.ApplicationID != "app_demo" {
		t.Fatalf("expected app token identity to be written, got %#v", req)
	}
}

func TestStageRejectsScopeMismatch(t *testing.T) {
	stage := NewStage(fakeValidator{
		identity: auth.AppTokenIdentity{
			AppTokenID:    "app_token_demo",
			TenantID:      "tenant_demo",
			ProjectID:     "other_project",
			ApplicationID: "app_demo",
		},
	}, "redacted_app_token")
	req := &pipeline.RequestContext{
		TenantID:  "tenant_demo",
		ProjectID: "project_demo",
	}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 403 || gatewayErr.Code != "scope_mismatch" {
		t.Fatalf("expected 403 scope_mismatch, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
}

func TestStageRejectsApplicationScopeMismatch(t *testing.T) {
	stage := NewStage(fakeValidator{
		identity: auth.AppTokenIdentity{
			AppTokenID:    "app_token_demo",
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "other_app",
		},
	}, "redacted_app_token")
	req := &pipeline.RequestContext{
		TenantID:      "tenant_demo",
		ProjectID:     "project_demo",
		ApplicationID: "app_demo",
	}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 403 || gatewayErr.Code != "scope_mismatch" {
		t.Fatalf("expected 403 scope_mismatch, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
}

func TestStageMapsInvalidAppTokenToGatewayError(t *testing.T) {
	stage := NewStage(fakeValidator{err: auth.ErrInvalidAppToken}, "redacted_app_token")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 403 || gatewayErr.Code != "invalid_app_token" {
		t.Fatalf("expected 403 invalid_app_token, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
}

func TestStageMapsUnexpectedValidatorErrorToInternalError(t *testing.T) {
	upstreamErr := errors.New("credential store unavailable")
	stage := NewStage(fakeValidator{err: upstreamErr}, "redacted_app_token")
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
	stage := NewStage(fakeValidator{err: context.Canceled}, "redacted_app_token")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != gatewayerrors.StatusClientClosedRequest || gatewayErr.Code == "invalid_app_token" {
		t.Fatalf("expected cancelled context not invalid_app_token, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
	if gatewayErr.Stage != StageName {
		t.Fatalf("expected stage %s, got %s", StageName, gatewayErr.Stage)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected wrapped context.Canceled, got %v", err)
	}
}

func TestStageMapsDeadlineExceededToInternalError(t *testing.T) {
	stage := NewStage(fakeValidator{err: context.DeadlineExceeded}, "redacted_app_token")
	req := &pipeline.RequestContext{}

	err := stage.Execute(context.Background(), req)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 500 || gatewayErr.Code != "internal_error" {
		t.Fatalf("expected 500 internal_error, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
	if gatewayErr.Stage != StageName {
		t.Fatalf("expected stage %s, got %s", StageName, gatewayErr.Stage)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected wrapped context.DeadlineExceeded, got %v", err)
	}
}
