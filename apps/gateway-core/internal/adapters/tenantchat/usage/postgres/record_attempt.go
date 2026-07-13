package postgres

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func (s *ReservationStore) RecordConfirmedAttempt(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	usage tenantchat.ConfirmedUsage,
	outcome string,
) (err error) {
	if s == nil || s.pool == nil || attemptNo < 1 || attemptNo > 4 || !validAttemptOutcome(outcome) ||
		usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.CacheReadInputTokens < 0 ||
		usage.CacheReadInputTokens > usage.InputTokens {
		return tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil || reservation.State != "reserved" {
		return tenantchat.ErrUsageGuardUnavailable
	}
	attempt, err := lockAttempt(ctx, tx, requestContext, reservationID, attemptNo)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	confirmedCost, err := confirmedAttemptCost(attempt, usage)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if attempt.CompletedAt != nil {
		var storedOutcome string
		var storedInput int64
		var storedOutput int64
		var storedCacheRead int64
		var storedCost int64
		err = tx.QueryRow(ctx, `
			SELECT outcome, confirmed_input_tokens, confirmed_output_tokens,
			       confirmed_cache_read_input_tokens, confirmed_cost_micro_usd
			FROM tenant_chat_provider_attempts
			WHERE request_id = $1 AND attempt_no = $2
			  AND reservation_id = $3::uuid AND tenant_id = $4::uuid
		`, requestContext.RequestID, attemptNo, reservationID, requestContext.ExecutionScope.TenantID).Scan(
			&storedOutcome, &storedInput, &storedOutput, &storedCacheRead, &storedCost,
		)
		if err != nil || storedOutcome != outcome || storedInput != usage.InputTokens ||
			storedOutput != usage.OutputTokens || storedCacheRead != usage.CacheReadInputTokens || storedCost != confirmedCost {
			return tenantchat.ErrIdempotencyConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.ErrUsageGuardUnavailable
		}
		return nil
	}
	if _, err = tx.Exec(ctx, `
		UPDATE tenant_chat_provider_attempts
		SET confirmed_input_tokens = $4, confirmed_output_tokens = $5,
		    confirmed_cache_read_input_tokens = $6, confirmed_cost_micro_usd = $7,
		    outcome = $8, usage_quality = 'confirmed', completed_at = $9, updated_at = $9
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $10::uuid
	`, requestContext.RequestID, attemptNo, reservationID,
		usage.InputTokens, usage.OutputTokens, usage.CacheReadInputTokens, confirmedCost,
		outcome, s.now().UTC(), requestContext.ExecutionScope.TenantID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.ErrIdempotencyConflict
		}
		return tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return nil
}
