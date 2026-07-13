package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func persistSettlement(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	reservation settlementReservation,
	userPeriod tokenPeriod,
	tenantPeriod costPeriod,
	attempts []tenantchat.ProviderAttempt,
	totals settlementTotals,
	quotaState string,
	budgetState string,
	eventID string,
	eventVersion int64,
	now time.Time,
) error {
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_user_token_periods
		SET reserved_tokens = reserved_tokens - $4,
		    confirmed_input_tokens = confirmed_input_tokens + $5,
		    confirmed_output_tokens = confirmed_output_tokens + $6,
		    confirmed_total_tokens = confirmed_total_tokens + $5 + $6,
		    state = $7, version = version + 1, updated_at = $8
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
		  AND reserved_tokens >= $4
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		userPeriod.Start, reservation.ReservedTokens, totals.InputTokens, totals.OutputTokens,
		quotaState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("settle tenant chat token period")
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_tenant_cost_periods
		SET reserved_cost_micro_usd = reserved_cost_micro_usd - $3,
		    confirmed_cost_micro_usd = confirmed_cost_micro_usd + $4,
		    state = $5, version = version + 1, updated_at = $6
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
		  AND reserved_cost_micro_usd >= $3
	`, requestContext.ExecutionScope.TenantID, tenantPeriod.Start,
		reservation.ReservedCostMicroUSD, totals.CostMicroUSD, budgetState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("settle tenant chat cost period")
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET state = 'settled', reserved_tokens = 0, reserved_cost_micro_usd = 0,
		    confirmed_input_tokens = $3, confirmed_output_tokens = $4,
		    confirmed_cost_micro_usd = $5, ledger_version = $6,
		    usage_pending_at = NULL, terminal_at = $7, updated_at = $7
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND state = 'reserved' AND ledger_version = $8
	`, reservationID, requestContext.ExecutionScope.TenantID,
		totals.InputTokens, totals.OutputTokens, totals.CostMicroUSD, eventVersion, now,
		reservation.LedgerVersion)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("settle tenant chat reservation")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_ledger_entries (
		  request_id, ledger_version, event_id, reservation_id, tenant_id, event_type,
		  reserved_tokens_delta, confirmed_input_tokens_delta, confirmed_output_tokens_delta,
		  reserved_cost_micro_usd_delta, confirmed_cost_micro_usd_delta, occurred_at
		) VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'usage_settled',
		  $6, $7, $8, $9, $10, $11)
	`, requestContext.RequestID, eventVersion, eventID, reservationID,
		requestContext.ExecutionScope.TenantID, -reservation.ReservedTokens,
		totals.InputTokens, totals.OutputTokens, -reservation.ReservedCostMicroUSD,
		totals.CostMicroUSD, now)
	if err != nil {
		return err
	}
	terminalOutcome := "failed"
	if attempts[len(attempts)-1].Outcome == "succeeded" {
		terminalOutcome = "succeeded"
	}
	payload, err := settlementEventPayload(
		eventID, reservationID, eventVersion, requestContext, reservation,
		userPeriod, quotaState, budgetState, attempts, totals, terminalOutcome, now,
	)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_invocation_outbox (
		  event_id, tenant_id, aggregate_id, event_type, event_version, payload, occurred_at, available_at
		) VALUES ($1::uuid, $2::uuid, $3, 'usage_settled', $4, $5::jsonb, $6, $6)
	`, eventID, requestContext.ExecutionScope.TenantID, requestContext.RequestID, eventVersion, payload, now)
	return err
}
