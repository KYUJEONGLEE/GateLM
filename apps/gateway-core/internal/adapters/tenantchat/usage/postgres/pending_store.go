package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func (s *ReservationStore) MarkPending(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	outcome string,
) (result tenantchat.UsageSettlement, err error) {
	started := time.Now()
	defer s.observeTransaction("mark_pending", started)
	if s == nil || s.pool == nil || attemptNo < 1 || attemptNo > 4 || !validAttemptOutcome(outcome) {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if reservation.State != "reserved" {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	attempt, err := lockAttempt(ctx, tx, requestContext, reservationID, attemptNo)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if attempt.CompletedAt != nil {
		attempts, _, pending, readErr := readSettlementAttempts(ctx, tx, requestContext, reservationID)
		if readErr != nil || !pending {
			return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.UsageSettlement{
			RequestID: requestContext.RequestID, ReservationID: reservationID,
			State: "pending_unconfirmed", CacheOutcome: reservation.CacheOutcome,
			Attempts: attempts, Replayed: true,
		}, nil
	}
	now := s.now().UTC()
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_provider_attempts
		SET outcome = $4, usage_quality = 'pending_unconfirmed', completed_at = $5, updated_at = $5
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $6::uuid
	`, requestContext.RequestID, attemptNo, reservationID, outcome, now, requestContext.ExecutionScope.TenantID)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET usage_pending_at = COALESCE(usage_pending_at, $3), updated_at = $3
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND state = 'reserved'
	`, reservationID, requestContext.ExecutionScope.TenantID, now)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	attempts, _, pending, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil || !pending {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageSettlement{
		RequestID: requestContext.RequestID, ReservationID: reservationID,
		State: "pending_unconfirmed", CacheOutcome: reservation.CacheOutcome, Attempts: attempts,
	}, nil
}

func (s *ReservationStore) readPendingTerminal(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
) (tenantchat.UsageSettlement, error) {
	var pending bool
	var cacheOutcome string
	if err := tx.QueryRow(ctx, `
		SELECT usage_pending_at IS NOT NULL, cache_outcome
		FROM tenant_chat_usage_reservations
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND request_id = $3
	`, reservationID, requestContext.ExecutionScope.TenantID, requestContext.RequestID).Scan(&pending, &cacheOutcome); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if !pending {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	attempts, _, hasPending, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil || !hasPending {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageSettlement{
		RequestID: requestContext.RequestID, ReservationID: reservationID,
		State: "pending_unconfirmed", CacheOutcome: cacheOutcome, Attempts: attempts, Replayed: true,
	}, nil
}
