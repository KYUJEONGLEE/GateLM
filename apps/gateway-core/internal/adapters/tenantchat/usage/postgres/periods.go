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
	Start     time.Time
	End       time.Time
	Timezone  string
	Limit     int64
	Warning   int64
	Economy   int64
	HardStop  int64
	Reserved  int64
	Confirmed int64
	State     string
}

type costPeriod struct {
	Start     time.Time
	End       time.Time
	Timezone  string
	Limit     int64
	Warning   int64
	Economy   int64
	HardStop  int64
	Reserved  int64
	Confirmed int64
	State     string
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
		return period, nil
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

func findTokenPeriod(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	now time.Time,
) (result tokenPeriod, err error) {
	err = tx.QueryRow(ctx, `
		SELECT period_start, period_end, period_timezone, limit_tokens,
		       warning_threshold_tokens, economy_threshold_tokens, hard_stop_tokens,
		       reserved_tokens, confirmed_total_tokens, state
		FROM tenant_chat_user_token_periods
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid
		  AND period_start <= $3 AND period_end > $3
		ORDER BY period_start DESC LIMIT 1 FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID, now).Scan(
		&result.Start, &result.End, &result.Timezone, &result.Limit,
		&result.Warning, &result.Economy, &result.HardStop,
		&result.Reserved, &result.Confirmed, &result.State,
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
		       reserved_cost_micro_usd, confirmed_cost_micro_usd, state
		FROM tenant_chat_tenant_cost_periods
		WHERE tenant_id = $1::uuid AND currency = 'USD'
		  AND period_start <= $2 AND period_end > $2
		ORDER BY period_start DESC LIMIT 1 FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, now).Scan(
		&result.Start, &result.End, &result.Timezone, &result.Limit,
		&result.Warning, &result.Economy, &result.HardStop,
		&result.Reserved, &result.Confirmed, &result.State,
	)
	return result, err
}
