package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeepolicy"

	"github.com/jackc/pgx/v5"
)

type Queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Resolver struct {
	db Queryer
}

type storedPolicy struct {
	RateLimit employeepolicy.RateLimitPolicy `json:"rateLimit"`
}

func NewResolver(db Queryer) *Resolver {
	return &Resolver{db: db}
}

func (r *Resolver) Resolve(ctx context.Context, req employeepolicy.ResolveRequest) (employeepolicy.Policy, error) {
	tenantID := strings.TrimSpace(req.TenantID)
	projectID := strings.TrimSpace(req.ProjectID)
	actorID := strings.TrimSpace(req.ActorID)
	if tenantID == "" || projectID == "" || actorID == "" {
		return employeepolicy.Policy{}, employeepolicy.ErrNotFound
	}
	if r == nil || r.db == nil {
		return employeepolicy.Policy{}, employeepolicy.ErrUnavailable
	}

	now := req.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	nextMonthStart := monthStart.AddDate(0, 1, 0)

	var employeeID string
	var policyJSON []byte
	var limitMicroUSD int64
	var warningThresholdPercent int
	var usedMicroUSD int64
	err := r.db.QueryRow(ctx, resolveEmployeePolicySQL,
		tenantID,
		projectID,
		actorID,
		monthStart,
		nextMonthStart,
	).Scan(
		&employeeID,
		&policyJSON,
		&limitMicroUSD,
		&warningThresholdPercent,
		&usedMicroUSD,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return employeepolicy.Policy{}, employeepolicy.ErrNotFound
		}
		return employeepolicy.Policy{}, fmt.Errorf("resolve employee policy: %w", err)
	}

	var persisted storedPolicy
	if len(policyJSON) > 0 {
		if err := json.Unmarshal(policyJSON, &persisted); err != nil {
			return employeepolicy.Policy{}, fmt.Errorf("decode employee policy: %w", err)
		}
	}

	return employeepolicy.Normalize(employeepolicy.Policy{
		TenantID:   tenantID,
		ProjectID:  projectID,
		EmployeeID: employeeID,
		RateLimit:  persisted.RateLimit,
		Quota: employeepolicy.QuotaPolicy{
			Enabled:                 limitMicroUSD > 0,
			LimitMicroUSD:           limitMicroUSD,
			UsedMicroUSD:            usedMicroUSD,
			WarningThresholdPercent: warningThresholdPercent,
		},
	}), nil
}

const resolveEmployeePolicySQL = `
with matched_assignment as (
  select
    pea."employeeId" as employee_id,
    pea."monthlyBudgetLimitMicroUsd" as limit_micro_usd,
    pea."warningThresholdPercent" as warning_threshold_percent,
    pea.policy,
    e."userId" as user_id,
    e.email
  from project_employee_assignments pea
  join employees e
    on e.id = pea."employeeId"
   and e."tenantId" = pea."tenantId"
  where pea."tenantId" = $1::uuid
    and pea."projectId" = $2::uuid
    and pea.status = 'active'
    and e."deletedAt" is null
    and e.status in ('staged', 'active')
    and (
      e.id::text = $3
      or e."userId"::text = $3
      or lower(e.email) = lower($3)
    )
  order by
    case
      when e.id::text = $3 then 0
      when e."userId"::text = $3 then 1
      else 2
    end,
    pea."updatedAt" desc
  limit 1
)
select
  a.employee_id::text,
  a.policy,
  a.limit_micro_usd,
  a.warning_threshold_percent,
  coalesce((
    select sum(l.cost_micro_usd)
    from p0_llm_invocation_logs l
    where l.tenant_id = $1::uuid
      and l.project_id = $2::uuid
      and l.created_at >= $4::timestamptz
      and l.created_at < $5::timestamptz
      and (
        l.end_user_id = a.employee_id::text
        or l.end_user_id = a.user_id::text
        or lower(l.end_user_id) = lower(a.email)
      )
  ), 0)::bigint as used_micro_usd
from matched_assignment a`
