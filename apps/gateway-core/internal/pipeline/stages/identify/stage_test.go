package identify

import (
	"context"
	"errors"
	"testing"

	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
)

func TestStageAllowsMatchingIdentityContext(t *testing.T) {
	stage := NewStage("tenant_demo", "project_demo", "app_demo")
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
			APIKeyID:      "api_key_demo",
			AppTokenID:    "app_token_demo",
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected matching identity context to pass, got %v", err)
	}
}

func TestStageAllowsUnspecifiedExpectedScope(t *testing.T) {
	stage := NewStage("tenant_demo", "project_demo", "")
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
	}

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected unspecified application scope to pass, got %v", err)
	}
}

func TestStageRejectsScopeMismatch(t *testing.T) {
	stage := NewStage("tenant_demo", "project_demo", "app_demo")
	gatewayCtx := &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "other_project",
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
