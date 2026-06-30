package budgetstage

import (
	"context"
	"errors"
	"testing"

	"gatelm/apps/gateway-core/internal/domain/budget"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
)

func TestStageAllowsDisabledPolicyAsNotUsed(t *testing.T) {
	stage := NewStage(budget.AllowChecker{})
	gatewayCtx := testBudgetGatewayContext()

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected disabled budget policy to allow request, got %v", err)
	}
	if gatewayCtx.Governance.BudgetDecision == nil {
		t.Fatal("expected budget decision")
	}
	if gatewayCtx.Governance.BudgetDecision.Outcome != budget.OutcomeNotUsed {
		t.Fatalf("expected not_used budget outcome, got %+v", gatewayCtx.Governance.BudgetDecision)
	}
	if !gatewayCtx.Governance.BudgetDecision.Allowed {
		t.Fatalf("expected budget decision to allow request: %+v", gatewayCtx.Governance.BudgetDecision)
	}
}

func TestStageAllowsEnabledPolicyAsNotCheckedWithoutLedger(t *testing.T) {
	stage := NewStage(budget.AllowChecker{})
	gatewayCtx := testBudgetGatewayContext()
	gatewayCtx.Runtime.BudgetPolicy = budget.Policy{
		Enabled:                 true,
		EnforcementMode:         budget.EnforcementModeBlock,
		WarningThresholdPercent: 80,
	}
	gatewayCtx.Runtime.HasBudgetPolicy = true

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected no-op checker to allow request, got %v", err)
	}
	if gatewayCtx.Governance.BudgetDecision == nil {
		t.Fatal("expected budget decision")
	}
	if gatewayCtx.Governance.BudgetDecision.Outcome != budget.OutcomeNotChecked {
		t.Fatalf("expected not_checked budget outcome, got %+v", gatewayCtx.Governance.BudgetDecision)
	}
	if !gatewayCtx.Governance.BudgetDecision.Allowed {
		t.Fatalf("expected no-op checker to let request proceed: %+v", gatewayCtx.Governance.BudgetDecision)
	}
}

func TestStageBlocksBeforeProviderPath(t *testing.T) {
	stage := NewStage(fakeBudgetChecker{decision: budget.Decision{
		Allowed: false,
		Outcome: budget.OutcomeBlocked,
	}})
	gatewayCtx := testBudgetGatewayContext()
	gatewayCtx.Runtime.BudgetPolicy = budget.Policy{
		Enabled:                 true,
		EnforcementMode:         budget.EnforcementModeBlock,
		WarningThresholdPercent: 80,
	}
	gatewayCtx.Runtime.HasBudgetPolicy = true

	err := stage.Execute(context.Background(), gatewayCtx)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected gateway error, got %T %v", err, err)
	}
	if gatewayErr.Code != "budget_blocked" || gatewayErr.Stage != StageName {
		t.Fatalf("unexpected gateway error: %#v", gatewayErr)
	}
	if gatewayCtx.Status.Status != "blocked" || gatewayCtx.Status.HTTPStatus != 403 {
		t.Fatalf("unexpected blocked status: %#v", gatewayCtx.Status)
	}
	if gatewayCtx.Cache.CacheStatus != "bypass" || gatewayCtx.Cache.CacheType != "none" {
		t.Fatalf("budget block must bypass cache, got %#v", gatewayCtx.Cache)
	}
	if gatewayCtx.Governance.BudgetDecision == nil ||
		gatewayCtx.Governance.BudgetDecision.Outcome != budget.OutcomeBlocked ||
		gatewayCtx.Governance.BudgetDecision.Allowed {
		t.Fatalf("unexpected budget decision: %#v", gatewayCtx.Governance.BudgetDecision)
	}
}

func TestStagePropagatesSyntheticAllowedDecision(t *testing.T) {
	stage := NewStage(fakeBudgetChecker{decision: budget.Decision{
		Allowed: true,
		Outcome: budget.OutcomeAllowed,
	}})
	gatewayCtx := testBudgetGatewayContext()
	gatewayCtx.Runtime.BudgetPolicy = budget.Policy{
		Enabled:                 true,
		EnforcementMode:         budget.EnforcementModeBlock,
		WarningThresholdPercent: 80,
	}
	gatewayCtx.Runtime.HasBudgetPolicy = true

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected synthetic allowed decision to allow request, got %v", err)
	}
	if gatewayCtx.Governance.BudgetDecision == nil ||
		gatewayCtx.Governance.BudgetDecision.Outcome != budget.OutcomeAllowed ||
		!gatewayCtx.Governance.BudgetDecision.Allowed {
		t.Fatalf("unexpected budget decision: %#v", gatewayCtx.Governance.BudgetDecision)
	}
}

func TestStagePropagatesWarnedDecision(t *testing.T) {
	stage := NewStage(fakeBudgetChecker{decision: budget.Decision{
		Allowed: true,
		Outcome: budget.OutcomeWarned,
	}})
	gatewayCtx := testBudgetGatewayContext()
	gatewayCtx.Runtime.BudgetPolicy = budget.Policy{
		Enabled:                 true,
		EnforcementMode:         budget.EnforcementModeWarn,
		WarningThresholdPercent: 70,
	}
	gatewayCtx.Runtime.HasBudgetPolicy = true

	if err := stage.Execute(context.Background(), gatewayCtx); err != nil {
		t.Fatalf("expected warned budget decision to allow request, got %v", err)
	}
	if gatewayCtx.Governance.BudgetDecision == nil ||
		gatewayCtx.Governance.BudgetDecision.Outcome != budget.OutcomeWarned ||
		!gatewayCtx.Governance.BudgetDecision.Allowed {
		t.Fatalf("unexpected budget decision: %#v", gatewayCtx.Governance.BudgetDecision)
	}
}

func TestStageFailsClosedOnCheckerError(t *testing.T) {
	stage := NewStage(fakeBudgetChecker{err: errors.New("budget source unavailable")})
	gatewayCtx := testBudgetGatewayContext()

	err := stage.Execute(context.Background(), gatewayCtx)
	var gatewayErr gatewayerrors.GatewayError
	if !errors.As(err, &gatewayErr) {
		t.Fatalf("expected gateway error, got %T %v", err, err)
	}
	if gatewayErr.Code != "internal_error" || gatewayErr.Stage != StageName {
		t.Fatalf("unexpected gateway error: %#v", gatewayErr)
	}
	if gatewayCtx.Status.Status != "failed" || gatewayCtx.Status.HTTPStatus != 500 {
		t.Fatalf("unexpected status: %#v", gatewayCtx.Status)
	}
	if gatewayCtx.Cache.CacheStatus != "bypass" || gatewayCtx.Cache.CacheType != "none" {
		t.Fatalf("checker error must bypass cache, got %#v", gatewayCtx.Cache)
	}
	if gatewayCtx.Governance.BudgetDecision == nil ||
		gatewayCtx.Governance.BudgetDecision.Outcome != budget.OutcomeNotChecked ||
		!gatewayCtx.Governance.BudgetDecision.Allowed {
		t.Fatalf("checker error must be recorded as not_checked, got %#v", gatewayCtx.Governance.BudgetDecision)
	}
}

type fakeBudgetChecker struct {
	decision budget.Decision
	err      error
}

func (f fakeBudgetChecker) Check(_ context.Context, req budget.Request) (budget.Decision, error) {
	decision := f.decision
	decision.Scope = req.Scope
	decision.Policy = req.Policy
	return decision, f.err
}

func testBudgetGatewayContext() *request.GatewayContext {
	return &request.GatewayContext{
		Identity: request.IdentityContext{
			TenantID:      "tenant_test",
			ProjectID:     "project_test",
			ApplicationID: "app_test",
		},
		Budget: budget.DefaultScope("app_test"),
	}
}
