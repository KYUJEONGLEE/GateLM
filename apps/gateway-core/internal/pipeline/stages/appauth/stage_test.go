package appauth

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/auth"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
)

type fakeValidator struct {
	identity auth.AppTokenIdentity
}

func (v fakeValidator) ValidateAppToken(_ context.Context, _ string) (auth.AppTokenIdentity, error) {
	return v.identity, nil
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
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:  "tenant_demo",
			ProjectID: "project_demo",
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected app token stage to pass, got %v", err)
	}
	if gatewayCtx.Identity.AppTokenID != "app_token_demo" || gatewayCtx.Identity.ApplicationID != "app_demo" {
		t.Fatalf("expected app token identity to be written, got %#v", gatewayCtx.Identity)
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
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:  "tenant_demo",
			ProjectID: "project_demo",
		},
	}

	err := stage.Execute(context.Background(), gatewayCtx)
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
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
	}

	err := stage.Execute(context.Background(), gatewayCtx)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected GatewayError, got %T", err)
	}
	if gatewayErr.HTTPStatus != 403 || gatewayErr.Code != "scope_mismatch" {
		t.Fatalf("expected 403 scope_mismatch, got %d %s", gatewayErr.HTTPStatus, gatewayErr.Code)
	}
}
