package postgres

import (
	"context"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func (s *ReservationStore) BeginFallback(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	reservationID string,
	previousAttemptNo int,
	previousUsage tenantchat.ConfirmedUsage,
	previousOutcome string,
	route tenantchat.SelectedRoute,
	attemptNo int,
) (err error) {
	started := time.Now()
	defer s.observeTransaction("begin_fallback", started)
	if s == nil || s.pool == nil || requestContext.UsageIntent == nil ||
		previousAttemptNo < 1 || previousAttemptNo > 3 || attemptNo != previousAttemptNo+1 || attemptNo > 4 ||
		!validAttemptOutcome(previousOutcome) || previousUsage.InputTokens < 0 ||
		previousUsage.OutputTokens < 0 || previousUsage.CacheReadInputTokens < 0 ||
		previousUsage.CacheReadInputTokens > previousUsage.InputTokens {
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
	if err = lockUsageActors(ctx, tx, requestContext); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil || reservation.State != "reserved" {
		return tenantchat.ErrUsageGuardUnavailable
	}
	now := s.now().UTC()
	if err = recordConfirmedAttemptTx(
		ctx, tx, now, requestContext, reservationID, previousAttemptNo, previousUsage, previousOutcome,
	); err != nil {
		return err
	}
	exposureCost, err := reservationCost(
		requestContext.UsageIntent.EstimatedInputTokens,
		requestContext.UsageIntent.MaxOutputTokens,
		route.InputMicroUSDPerMillionTokens,
		route.OutputMicroUSDPerMillionTokens,
	)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if err = s.topUpFallback(
		ctx, tx, requestContext, snapshot, reservationID, reservation.LedgerVersion, exposureCost, now,
	); err != nil {
		return err
	}
	if err = insertAttemptRow(
		ctx, tx, requestContext, reservationID, route, attemptNo, "fallback", exposureCost, now,
	); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return nil
}
