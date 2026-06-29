package budgetstage

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/budget"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/outcome"
	"gatelm/apps/gateway-core/internal/domain/request"
)

const (
	StageName              = "check_budget"
	ErrorCodeBudgetBlocked = "budget_blocked"
)

type Stage struct {
	checker budget.Checker
}

func NewStage(checker budget.Checker) *Stage {
	if checker == nil {
		checker = budget.AllowAllChecker{}
	}
	return &Stage{checker: checker}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	if gatewayCtx == nil {
		return gatewayerrors.InternalError(StageName, "Gateway context is not initialized.", nil)
	}
	checker := budget.Checker(budget.AllowAllChecker{})
	if s != nil && s.checker != nil {
		checker = s.checker
	}

	policy := budget.Policy{}
	if gatewayCtx.Runtime.HasBudgetPolicy {
		policy = gatewayCtx.Runtime.BudgetPolicy
	}
	budgetReq := budget.Request{
		TenantID:      gatewayCtx.Identity.TenantID,
		ProjectID:     gatewayCtx.Identity.ProjectID,
		ApplicationID: gatewayCtx.Identity.ApplicationID,
		Scope:         budget.NormalizeScope(gatewayCtx.Budget, gatewayCtx.Identity.ApplicationID),
		Policy:        policy,
	}
	decision, err := checker.CheckBudget(ctx, budgetReq)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return gatewayerrors.RequestCancelled(StageName, err)
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return gatewayerrors.InternalError(StageName, "Gateway budget check timed out.", err)
		}
		gatewayCtx.SetError(500, "internal_error", "Gateway budget check failed.", StageName)
		gatewayCtx.BypassCache()
		gatewayCtx.Governance.BudgetOutcome = outcome.BudgetNotChecked
		return gatewayerrors.InternalError(StageName, "Gateway budget check failed.", err)
	}

	decision = budget.NormalizeDecision(decision, budgetReq)
	gatewayCtx.Budget = decision.Scope
	gatewayCtx.Governance.BudgetOutcome = decision.Outcome

	if decision.Outcome != budget.OutcomeBlocked {
		return nil
	}

	gatewayCtx.SetError(403, ErrorCodeBudgetBlocked, "Budget policy blocked this request.", StageName)
	gatewayCtx.BypassCache()
	return gatewayerrors.New(403, ErrorCodeBudgetBlocked, "Budget policy blocked this request.", StageName)
}
