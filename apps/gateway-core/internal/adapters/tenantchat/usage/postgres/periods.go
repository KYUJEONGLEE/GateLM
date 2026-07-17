package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
)

type tokenPeriod struct {
	Start         time.Time
	End           time.Time
	Timezone      string
	Limit         int64
	Warning       int64
	Economy       int64
	HardStop      int64
	Reserved      int64
	Confirmed     int64
	Unconfirmed   int64
	State         string
	PolicyVersion int64
}

type costPeriod struct {
	Start       time.Time
	End         time.Time
	Timezone    string
	Limit       int64
	Warning     int64
	Economy     int64
	HardStop    int64
	Reserved    int64
	Confirmed   int64
	Unconfirmed int64
	State       string
}

func ensureTokenPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	now time.Time,
) (tokenPeriod, error) {
	period, err := findTokenPeriod(ctx, tx, requestContext, now)
	if err == nil {
		return syncTokenPeriodPolicy(ctx, tx, requestContext, snapshot, period, now)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return tokenPeriod{}, err
	}
	start, end, err := calendarMonth(now, snapshot.Policies.Quota.Timezone)
	if err != nil {
		return tokenPeriod{}, err
	}
	limit := snapshot.Policies.Quota.DefaultMonthlyTokenLimit
	warning, economy, hardStop := thresholds(
		limit,
		snapshot.Policies.Quota.WarningPercent,
		snapshot.Policies.Quota.EconomyPercent,
		snapshot.Policies.Quota.HardStopPercent,
	)
	state := "normal"
	if limit == 0 {
		state = "blocked"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_user_token_periods (
		  tenant_id, user_id, period_start, period_end, period_timezone,
		  limit_tokens, warning_threshold_tokens, economy_threshold_tokens, hard_stop_tokens, state
		) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (tenant_id, user_id, period_start) DO NOTHING
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		start, end, snapshot.Policies.Quota.Timezone, limit, warning, economy, hardStop, state)
	if err != nil {
		return tokenPeriod{}, err
	}
	return findTokenPeriod(ctx, tx, requestContext, now)
}

// syncTokenPeriodPolicy applies the active Snapshot's quota to the current
// period without changing its calendar boundary or resetting any usage. The
// period row is already locked by findTokenPeriod, and ConsumeAndReserve holds
// the actor advisory lock, so the policy and the next reservation are atomic.
func syncTokenPeriodPolicy(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	period tokenPeriod,
	now time.Time,
) (tokenPeriod, error) {
	configured := tokenPeriodForQuotaPolicy(period, snapshot.Policies.Quota)
	if configured.Limit == period.Limit &&
		configured.Warning == period.Warning &&
		configured.Economy == period.Economy &&
		configured.HardStop == period.HardStop &&
		configured.State == period.State {
		return period, nil
	}

	_, err := tx.Exec(ctx, `
		UPDATE tenant_chat_user_token_periods
		SET limit_tokens = $4,
		    warning_threshold_tokens = $5,
		    economy_threshold_tokens = $6,
		    hard_stop_tokens = $7,
		    state = $8,
		    version = version + 1,
		    updated_at = $9
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		period.Start, configured.Limit, configured.Warning, configured.Economy,
		configured.HardStop, configured.State, now)
	if err != nil {
		return tokenPeriod{}, err
	}
	return configured, nil
}

func tokenPeriodForQuotaPolicy(period tokenPeriod, policy tenantruntime.QuotaPolicy) tokenPeriod {
	warning, economy, hardStop := thresholds(
		policy.DefaultMonthlyTokenLimit,
		policy.WarningPercent,
		policy.EconomyPercent,
		policy.HardStopPercent,
	)
	period.Limit = policy.DefaultMonthlyTokenLimit
	period.Warning = warning
	period.Economy = economy
	period.HardStop = hardStop
	period.State = usageState(period.Reserved+period.Confirmed+period.Unconfirmed, warning, economy, hardStop)
	return period
}

func findTokenPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	now time.Time,
) (result tokenPeriod, err error) {
	err = tx.QueryRow(ctx, `
		SELECT period_start, period_end, period_timezone, limit_tokens,
		       warning_threshold_tokens, economy_threshold_tokens, hard_stop_tokens,
		       reserved_tokens, confirmed_total_tokens, unconfirmed_tokens, state
		FROM tenant_chat_user_token_periods
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid
		  AND period_start <= $3 AND period_end > $3
		ORDER BY period_start DESC LIMIT 1 FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID, now).Scan(
		&result.Start, &result.End, &result.Timezone, &result.Limit,
		&result.Warning, &result.Economy, &result.HardStop,
		&result.Reserved, &result.Confirmed, &result.Unconfirmed, &result.State,
	)
	return result, err
}

// ensureEmployeeWeeklyTokenPeriod is deliberately driven only by the signed
// Tenant Chat employee actor and the published snapshot. Admin actors and
// snapshots without a matching employee entry remain unlimited.
func ensureEmployeeWeeklyTokenPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	now time.Time,
) (*tokenPeriod, error) {
	actor := requestContext.ExecutionScope.Actor
	if actor.ActorKind != "employee" || actor.EmployeeID == "" {
		return nil, nil
	}
	limit, enabled := snapshot.Policies.Quota.EmployeeWeeklyTokenLimit(actor.EmployeeID)
	if !enabled {
		return nil, nil
	}
	period, err := findEmployeeWeeklyTokenPeriod(ctx, tx, requestContext, now)
	if err == nil {
		return syncEmployeeWeeklyTokenPeriodPolicy(
			ctx,
			tx,
			requestContext,
			period,
			limit,
			snapshot.PolicyVersion,
			now,
		)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	start, end, err := calendarWeek(now, snapshot.Policies.Quota.Timezone)
	if err != nil {
		return nil, err
	}
	// This bootstrap is authoritative: it reads the reservation/admission
	// ledger rather than a dashboard or invocation-log projection.
	var reserved, confirmedInput, confirmedOutput, unconfirmed int64
	err = tx.QueryRow(ctx, `
		SELECT coalesce(sum(reservation.reserved_tokens), 0)::bigint,
		       coalesce(sum(reservation.confirmed_input_tokens), 0)::bigint,
		       coalesce(sum(reservation.confirmed_output_tokens), 0)::bigint,
		       coalesce(sum(reservation.unconfirmed_tokens), 0)::bigint
		FROM tenant_chat_usage_reservations reservation
		JOIN tenant_chat_request_admissions admission
		  ON admission.tenant_id = reservation.tenant_id
		 AND admission.user_id = reservation.user_id
		 AND admission.request_id = reservation.request_id
		WHERE reservation.tenant_id = $1::uuid
		  AND admission.employee_id = $2::uuid
		  AND reservation.reserved_at >= $3
		  AND reservation.reserved_at < $4
	`, requestContext.ExecutionScope.TenantID, actor.EmployeeID, start, end).Scan(
		&reserved, &confirmedInput, &confirmedOutput, &unconfirmed,
	)
	if err != nil {
		return nil, err
	}
	state := "normal"
	if limit == 0 || reserved+confirmedInput+confirmedOutput+unconfirmed >= limit {
		state = "blocked"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_employee_weekly_token_periods (
		  tenant_id, employee_id, period_start, period_end, period_timezone,
		  limit_tokens, reserved_tokens, confirmed_input_tokens, confirmed_output_tokens,
		  confirmed_total_tokens, unconfirmed_tokens, state, policy_version
		) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $8::bigint + $9::bigint, $10, $11, $12)
		ON CONFLICT (tenant_id, employee_id, period_start) DO NOTHING
	`, requestContext.ExecutionScope.TenantID, actor.EmployeeID, start, end,
		snapshot.Policies.Quota.Timezone, limit, reserved, confirmedInput, confirmedOutput,
		unconfirmed, state, snapshot.PolicyVersion)
	if err != nil {
		return nil, err
	}
	period, err = findEmployeeWeeklyTokenPeriod(ctx, tx, requestContext, now)
	if err != nil {
		return nil, err
	}
	return &period, nil
}

// syncEmployeeWeeklyTokenPeriodPolicy applies a newly published employee
// limit to the current week without clearing usage already recorded for that
// week. The caller holds the employee-week advisory lock, so the new policy
// and the following admission decision remain atomic.
func syncEmployeeWeeklyTokenPeriodPolicy(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	period tokenPeriod,
	limit int64,
	policyVersion int64,
	now time.Time,
) (*tokenPeriod, error) {
	state := "normal"
	if limit == 0 || period.Reserved+period.Confirmed+period.Unconfirmed >= limit {
		state = "blocked"
	}
	if period.Limit == limit && period.PolicyVersion == policyVersion && period.State == state {
		return &period, nil
	}
	_, err := tx.Exec(ctx, `
		UPDATE tenant_chat_employee_weekly_token_periods
		SET limit_tokens = $4,
		    policy_version = $5,
		    state = $6,
		    version = version + 1,
		    updated_at = $7
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid AND period_start = $3
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.EmployeeID,
		period.Start, limit, policyVersion, state, now)
	if err != nil {
		return nil, err
	}
	period.Limit = limit
	period.Warning = limit
	period.Economy = limit
	period.HardStop = limit
	period.PolicyVersion = policyVersion
	period.State = state
	return &period, nil
}

func findEmployeeWeeklyTokenPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	now time.Time,
) (result tokenPeriod, err error) {
	err = tx.QueryRow(ctx, `
		SELECT period_start, period_end, period_timezone, limit_tokens,
		       limit_tokens, limit_tokens, limit_tokens,
		       reserved_tokens, confirmed_total_tokens, unconfirmed_tokens, state, policy_version
		FROM tenant_chat_employee_weekly_token_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
		  AND period_start <= $3 AND period_end > $3
		ORDER BY period_start DESC LIMIT 1 FOR UPDATE
	`, requestContext.ExecutionScope.TenantID,
		requestContext.ExecutionScope.Actor.EmployeeID, now).Scan(
		&result.Start, &result.End, &result.Timezone, &result.Limit,
		&result.Warning, &result.Economy, &result.HardStop,
		&result.Reserved, &result.Confirmed, &result.Unconfirmed, &result.State, &result.PolicyVersion,
	)
	return result, err
}

func ensureCostPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	now time.Time,
) (costPeriod, error) {
	period, err := findCostPeriod(ctx, tx, requestContext, now)
	if err == nil {
		return period, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return costPeriod{}, err
	}
	start, end, err := calendarMonth(now, snapshot.Policies.Budget.Timezone)
	if err != nil {
		return costPeriod{}, err
	}
	limit := snapshot.Policies.Budget.MonthlyLimitMicroUSD
	warning, economy, hardStop := thresholds(
		limit,
		snapshot.Policies.Budget.WarningPercent,
		snapshot.Policies.Budget.EconomyPercent,
		snapshot.Policies.Budget.HardStopPercent,
	)
	state := "normal"
	if limit == 0 {
		state = "blocked"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_tenant_cost_periods (
		  tenant_id, period_start, period_end, period_timezone, currency,
		  limit_micro_usd, warning_threshold_micro_usd, economy_threshold_micro_usd,
		  hard_stop_micro_usd, state
		) VALUES ($1::uuid, $2, $3, $4, 'USD', $5, $6, $7, $8, $9)
		ON CONFLICT (tenant_id, period_start, currency) DO NOTHING
	`, requestContext.ExecutionScope.TenantID, start, end, snapshot.Policies.Budget.Timezone,
		limit, warning, economy, hardStop, state)
	if err != nil {
		return costPeriod{}, err
	}
	return findCostPeriod(ctx, tx, requestContext, now)
}

func findCostPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	now time.Time,
) (result costPeriod, err error) {
	err = tx.QueryRow(ctx, `
		SELECT period_start, period_end, period_timezone, limit_micro_usd,
		       warning_threshold_micro_usd, economy_threshold_micro_usd, hard_stop_micro_usd,
		       reserved_cost_micro_usd, confirmed_cost_micro_usd,
		       unconfirmed_exposure_micro_usd, state
		FROM tenant_chat_tenant_cost_periods
		WHERE tenant_id = $1::uuid AND currency = 'USD'
		  AND period_start <= $2 AND period_end > $2
		ORDER BY period_start DESC LIMIT 1 FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, now).Scan(
		&result.Start, &result.End, &result.Timezone, &result.Limit,
		&result.Warning, &result.Economy, &result.HardStop,
		&result.Reserved, &result.Confirmed, &result.Unconfirmed, &result.State,
	)
	return result, err
}
