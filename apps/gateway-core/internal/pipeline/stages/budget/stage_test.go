package budgetstage

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/budget"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/outcome"
	"gatelm/apps/gateway-core/internal/domain/request"
)

type fakeBudgetChecker struct {
	decision budget.Decision
	err      error
	req      budget.Request
}

func (f *fakeBudgetChecker) CheckBudget(_ context.Context, req budget.Request) (budget.Decision, error) {
	f.req = req
	if f.err != nil {
		return budget.Decision{}, f.err
	}
	return f.decision, nil
}

func TestStageAllowsWarnBudgetDecision(t *testing.T) {
	checker := &fakeBudgetChecker{
		decision: budget.Decision{
			Outcome: budget.OutcomeWarned,
			Scope: budget.Scope{
				Type:       budget.ScopeTypeApplication,
				ID:         "app_demo",
				ResolvedBy: budget.ResolvedByRuntimeSnapshot,
			},
		},
	}
	stage := NewStage(checker)
	gatewayCtx := testBudgetGatewayContext()

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected budget stage to allow warned request, got %v", err)
	}

	if checker.req.Policy.EnforcementMode != budget.EnforcementModeWarn {
		t.Fatalf("expected runtime budget policy in request, got %#v", checker.req.Policy)
	}
	if gatewayCtx.Governance.BudgetOutcome != budget.OutcomeWarned {
		t.Fatalf("expected warned budget outcome, got %#v", gatewayCtx.Governance)
	}
	if gatewayCtx.Budget.ID != "app_demo" || gatewayCtx.Budget.ResolvedBy != budget.ResolvedByRuntimeSnapshot {
		t.Fatalf("expected normalized runtime budget scope, got %#v", gatewayCtx.Budget)
	}
}

func TestStageBlocksBeforeCacheAndProvider(t *testing.T) {
	stage := NewStage(&fakeBudgetChecker{
		decision: budget.Decision{
			Outcome: budget.OutcomeBlocked,
			Scope: budget.Scope{
				Type:       budget.ScopeTypeApplication,
				ID:         "app_demo",
				ResolvedBy: budget.ResolvedByRuntimeSnapshot,
			},
		},
	})
	gatewayCtx := testBudgetGatewayContext()

	err := stage.Execute(context.Background(), gatewayCtx)

	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected gateway error, got %T %v", err, err)
	}
	if gatewayErr.Code != ErrorCodeBudgetBlocked || gatewayCtx.Status.HTTPStatus != 403 {
		t.Fatalf("expected budget block status, error=%#v status=%#v", gatewayErr, gatewayCtx.Status)
	}
	if gatewayCtx.Governance.BudgetOutcome != budget.OutcomeBlocked {
		t.Fatalf("expected blocked budget outcome, got %#v", gatewayCtx.Governance)
	}
	if gatewayCtx.Cache.CacheStatus != "bypass" || gatewayCtx.Cache.CacheType != "none" {
		t.Fatalf("blocked budget must bypass cache, got %#v", gatewayCtx.Cache)
	}
}

func TestStageFailsClosedOnCheckerError(t *testing.T) {
	stage := NewStage(&fakeBudgetChecker{err: errors.New("budget service unavailable")})
	gatewayCtx := testBudgetGatewayContext()

	err := stage.Execute(context.Background(), gatewayCtx)

	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected gateway error, got %T %v", err, err)
	}
	if gatewayErr.Code != "internal_error" || gatewayCtx.Status.HTTPStatus != 500 {
		t.Fatalf("expected internal error status, error=%#v status=%#v", gatewayErr, gatewayCtx.Status)
	}
	if gatewayCtx.Governance.BudgetOutcome != outcome.BudgetNotChecked {
		t.Fatalf("expected not_checked budget outcome on checker error, got %#v", gatewayCtx.Governance)
	}
	if gatewayCtx.Cache.CacheStatus != "bypass" || gatewayCtx.Cache.CacheType != "none" {
		t.Fatalf("budget checker error must bypass cache, got %#v", gatewayCtx.Cache)
	}
}

func testBudgetGatewayContext() *request.GatewayContext {
	return &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_demo",
			ProjectID:     "project_demo",
			ApplicationID: "app_demo",
		},
		Budget: budget.Scope{
			Type:       budget.ScopeTypeApplication,
			ID:         "app_demo",
			ResolvedBy: budget.ResolvedByRuntimeSnapshot,
		},
		Runtime: request.RuntimeContext{
			BudgetPolicy: budget.Policy{
				Enabled:                 true,
				EnforcementMode:         budget.EnforcementModeWarn,
				WarningThresholdPercent: 80,
			},
			HasBudgetPolicy: true,
		},
		Cache: request.CacheContext{
			CacheStatus: "miss",
			CacheType:   "exact",
			CacheKeyHash: "hmac-sha256:cache",
		},
	}
}
