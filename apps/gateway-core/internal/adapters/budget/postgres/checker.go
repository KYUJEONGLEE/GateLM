package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/budget"

	"github.com/jackc/pgx/v5"
)

var (
	ErrMissingBudgetScope = errors.New("budget request scope is missing")
	ErrMissingBudgetStore = errors.New("budget checker requires a database queryer")
)

type Queryer interface {
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
}

type Checker struct {
	db Queryer
}

func NewChecker(db Queryer) *Checker {
	return &Checker{db: db}
}

func (c *Checker) Check(ctx context.Context, req budget.Request) (budget.Decision, error) {
	policy := budget.NormalizePolicy(req.Policy)
	normalizedReq := req
	normalizedReq.Policy = policy
	scope := budget.NormalizeScope(req.Scope, req.ApplicationID)

	base := budget.Decision{
		Allowed:                 true,
		Outcome:                 budget.OutcomeNotChecked,
		Scope:                   scope,
		Policy:                  policy,
		WarningThresholdPercent: policy.WarningThresholdPercent,
	}

	if !policy.Enabled {
		base.Outcome = budget.OutcomeNotUsed
		base.Reason = "policy_disabled"
		return budget.NormalizeDecision(base, normalizedReq), nil
	}

	tenantID := strings.TrimSpace(req.TenantID)
	if tenantID == "" || strings.TrimSpace(scope.Type) == "" || strings.TrimSpace(scope.ID) == "" {
		base.Allowed = false
		base.Reason = "missing_scope"
		return budget.NormalizeDecision(base, normalizedReq), ErrMissingBudgetScope
	}
	if c == nil || c.db == nil {
		base.Allowed = false
		base.Reason = "checker_unavailable"
		return budget.NormalizeDecision(base, normalizedReq), ErrMissingBudgetStore
	}

	monthStart := monthStartUTC(req.Now)
	var limitMicroUSD int64
	var warningThresholdPercent int
	var usedMicroUSD int64
	if err := c.db.QueryRow(ctx, quotaUsageSQL,
		tenantID,
		scope.Type,
		scope.ID,
		monthStart,
	).Scan(&limitMicroUSD, &warningThresholdPercent, &usedMicroUSD); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			base.Outcome = budget.OutcomeNotChecked
			base.Reason = "quota_not_configured"
			return budget.NormalizeDecision(base, normalizedReq), nil
		}
		base.Allowed = false
		base.Reason = "checker_error"
		return budget.NormalizeDecision(base, normalizedReq), fmt.Errorf("check budget quota usage: %w", err)
	}

	decision := budget.Decision{
		Allowed:                 true,
		Outcome:                 budget.OutcomeAllowed,
		Scope:                   scope,
		Policy:                  policy,
		WarningThresholdPercent: warningThresholdPercent,
		Reason:                  "within_budget",
	}
	if limitMicroUSD <= 0 || usedMicroUSD >= limitMicroUSD {
		if policy.EnforcementMode == budget.EnforcementModeBlock {
			decision.Allowed = false
			decision.Outcome = budget.OutcomeBlocked
			decision.Reason = "quota_exceeded"
		} else {
			decision.Outcome = budget.OutcomeWarned
			decision.Reason = "quota_exceeded_warn_only"
		}
		return budget.NormalizeDecision(decision, normalizedReq), nil
	}

	warningAt := limitMicroUSD * int64(warningThresholdPercent) / 100
	if warningThresholdPercent > 0 && usedMicroUSD >= warningAt {
		decision.Outcome = budget.OutcomeWarned
		decision.Reason = "warning_threshold_reached"
	}
	return budget.NormalizeDecision(decision, normalizedReq), nil
}

func monthStartUTC(now time.Time) time.Time {
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
}

const quotaUsageSQL = `
with active_quota as (
  select limit_micro_usd, warning_threshold_percent
  from budget_quotas
  where tenant_id = $1::uuid
    and budget_scope_type = $2
    and budget_scope_id = $3
    and month_start = $4::date
    and status = 'active'
)
select
  q.limit_micro_usd,
  q.warning_threshold_percent,
  coalesce((
    select sum(cost_micro_usd)
    from budget_ledger_entries
    where tenant_id = $1::uuid
      and budget_scope_type = $2
      and budget_scope_id = $3
      and month_start = $4::date
  ), 0)::bigint as used_micro_usd
from active_quota q`
