package budgetstage

import (
	"context"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"
	gatewayerrors "gatelm/apps/gateway-core/internal/domain/errors"
	"gatelm/apps/gateway-core/internal/domain/request"
)

const StageName = "check_budget"

type Stage struct {
	checker budget.Checker
	now     func() time.Time
}

func NewStage(checker budget.Checker) *Stage {
	return &Stage{
		checker: checker,
		now:     time.Now,
	}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, gatewayCtx *request.GatewayContext) error {
	if gatewayCtx == nil {
		return gatewayerrors.InternalError(StageName, "Gateway context is not initialized.", nil)
	}
	if s == nil || s.checker == nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway budget checker is not initialized.", StageName)
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway budget checker is not initialized.", nil)
	}

	nowFn := s.now
	if nowFn == nil {
		nowFn = time.Now
	}
	policy := budget.Policy{}
	if gatewayCtx.Runtime.HasBudgetPolicy {
		policy = gatewayCtx.Runtime.BudgetPolicy
	}
	req := budget.Request{
		TenantID:      gatewayCtx.Identity.TenantID,
		ProjectID:     gatewayCtx.Identity.ProjectID,
		ApplicationID: gatewayCtx.Identity.ApplicationID,
		Scope:         gatewayCtx.Budget,
		Policy:        policy,
		Now:           nowFn(),
	}
	decision, err := s.checker.Check(ctx, req)
	if err != nil {
		decision, _ = budget.NormalizeDecision(budget.Decision{
			Allowed: true,
			Outcome: budget.OutcomeNotChecked,
			Scope:   req.Scope,
			Policy:  req.Policy,
			Reason:  "checker_error",
		}, req)
		gatewayCtx.Governance.BudgetDecision = decision.Clone()
		gatewayCtx.SetError(500, "internal_error", "Gateway budget check failed.", StageName)
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway budget check failed.", err)
	}
	decision, normalizeErr := budget.NormalizeDecision(decision, req)
	if normalizeErr != nil {
		gatewayCtx.SetError(500, "internal_error", "Gateway budget check failed.", StageName)
		gatewayCtx.BypassCache()
		return gatewayerrors.InternalError(StageName, "Gateway budget check failed.", normalizeErr)
	}
	gatewayCtx.Governance.BudgetDecision = decision.Clone()

	if decision.Allowed {
		return nil
	}

	gatewayCtx.BypassCache()
	gatewayCtx.Status.Status = "blocked"
	gatewayCtx.Status.HTTPStatus = 403
	gatewayCtx.Status.ErrorCode = "budget_blocked"
	gatewayCtx.Status.ErrorMessage = "Budget policy blocked this request."
	gatewayCtx.Status.ErrorStage = StageName
	return gatewayerrors.BudgetBlocked(StageName)
}
