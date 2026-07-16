package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func (s *ReservationStore) ReadTerminal(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
) (result tenantchat.UsageSettlement, err error) {
	if s == nil || s.pool == nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err = readSettlement(ctx, tx, requestContext, reservationID)
	if err != nil || result.RequestID != requestContext.RequestID {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if result.State == "reserved" {
		return s.readPendingTerminal(ctx, tx, requestContext, reservationID)
	}
	attempts, _, _, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	result.Attempts = attempts
	result.Replayed = true
	return result, nil
}

func (s *ReservationStore) FinalizeReleased(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
	terminalOutcome string,
) (result tenantchat.UsageSettlement, err error) {
	started := time.Now()
	defer s.observeTransaction("finalize_released", started)
	if s == nil || s.pool == nil || !validTerminalOutcome(terminalOutcome) {
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
	if err = lockUsageActors(ctx, tx, requestContext); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if reservation.State == "released" {
		result, err = readSettlement(ctx, tx, requestContext, reservationID)
		if err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		result.Replayed = true
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		return result, nil
	}
	if reservation.State != "reserved" {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	var attemptCount int
	if err = tx.QueryRow(ctx, `
		SELECT count(*) FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND reservation_id = $2::uuid AND tenant_id = $3::uuid
	`, requestContext.RequestID, reservationID, requestContext.ExecutionScope.TenantID).Scan(&attemptCount); err != nil || attemptCount != 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(ctx, tx, requestContext, reservation)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaExposure := userPeriod.Confirmed + userPeriod.Unconfirmed + userPeriod.Reserved - reservation.ReservedTokens
	budgetExposure := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + tenantPeriod.Reserved - reservation.ReservedCostMicroUSD
	if quotaExposure < 0 || budgetExposure < 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(quotaExposure, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(budgetExposure, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	nextVersion := reservation.LedgerVersion + 1
	now := s.now().UTC()
	if err = persistReleased(
		ctx, tx, requestContext, reservationID, reservation, userPeriod, tenantPeriod,
		quotaState, budgetState, eventID, nextVersion, terminalOutcome, now,
	); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageSettlement{
		RequestID: requestContext.RequestID, ReservationID: reservationID, State: "released",
		QuotaState: quotaState, BudgetState: budgetState, LedgerVersion: nextVersion,
		CacheOutcome: reservation.CacheOutcome,
	}, nil
}

func (s *ReservationStore) FinalizePreCall(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	terminalOutcome string,
) (result tenantchat.UsageSettlement, err error) {
	started := time.Now()
	defer s.observeTransaction("finalize_pre_call", started)
	if s == nil || s.pool == nil || attemptNo < 1 || attemptNo > 4 ||
		(terminalOutcome != "rate_limited" && terminalOutcome != "failed") {
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
	if err = lockUsageActors(ctx, tx, requestContext); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil || reservation.State != "reserved" {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	attempt, err := lockAttempt(ctx, tx, requestContext, reservationID, attemptNo)
	if err != nil || attempt.CompletedAt != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	now := s.now().UTC()
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_provider_attempts
		SET confirmed_input_tokens = 0, confirmed_output_tokens = 0,
		    confirmed_cache_read_input_tokens = 0, confirmed_cost_micro_usd = 0,
		    outcome = 'failed_pre_delta', usage_quality = 'confirmed',
		    completed_at = $4, updated_at = $4
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $5::uuid
	`, requestContext.RequestID, attemptNo, reservationID, now, requestContext.ExecutionScope.TenantID)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	attempts, totals, pending, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil || pending || len(attempts) != attemptNo {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(ctx, tx, requestContext, reservation)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaExposure := userPeriod.Confirmed + userPeriod.Unconfirmed + totals.InputTokens + totals.OutputTokens + userPeriod.Reserved - reservation.ReservedTokens
	budgetExposure := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + totals.CostMicroUSD + tenantPeriod.Reserved - reservation.ReservedCostMicroUSD
	if quotaExposure < 0 || budgetExposure < 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(quotaExposure, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(budgetExposure, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	nextVersion := reservation.LedgerVersion + 1
	if totals.InputTokens > 0 || totals.OutputTokens > 0 || totals.CostMicroUSD > 0 {
		if err = persistSettlement(
			ctx, tx, requestContext, reservationID, reservation, userPeriod, tenantPeriod,
			attempts, totals, quotaState, budgetState, eventID, nextVersion, now,
		); err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.UsageSettlement{
			RequestID: requestContext.RequestID, ReservationID: reservationID, State: "settled",
			ConfirmedInputTokens: totals.InputTokens, ConfirmedOutputTokens: totals.OutputTokens,
			ConfirmedCostMicroUSD: totals.CostMicroUSD, QuotaState: quotaState, BudgetState: budgetState,
			LedgerVersion: nextVersion, CacheOutcome: reservation.CacheOutcome, Attempts: attempts,
		}, nil
	}
	if err = persistReleased(
		ctx, tx, requestContext, reservationID, reservation, userPeriod, tenantPeriod,
		quotaState, budgetState, eventID, nextVersion, terminalOutcome, now,
	); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageSettlement{
		RequestID: requestContext.RequestID, ReservationID: reservationID, State: "released",
		QuotaState: quotaState, BudgetState: budgetState, LedgerVersion: nextVersion,
		CacheOutcome: reservation.CacheOutcome, Attempts: attempts,
	}, nil
}

func (s *ReservationStore) FinalizeUnconfirmed(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	outcome string,
) (result tenantchat.UsageSettlement, err error) {
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
	if err = lockUsageActors(ctx, tx, requestContext); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if reservation.State == "unconfirmed" {
		result, err = readSettlement(ctx, tx, requestContext, reservationID)
		if err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		result.Attempts, _, _, err = readSettlementAttempts(ctx, tx, requestContext, reservationID)
		if err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		result.Replayed = true
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
		return result, nil
	}
	if reservation.State != "reserved" {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	attempt, err := lockAttempt(ctx, tx, requestContext, reservationID, attemptNo)
	if err != nil || attempt.CompletedAt != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
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
	attempts, _, _, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil || len(attempts) == 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(ctx, tx, requestContext, reservation)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaExposure := userPeriod.Confirmed + userPeriod.Unconfirmed + userPeriod.Reserved
	budgetExposure := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + tenantPeriod.Reserved
	quotaState := usageState(quotaExposure, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(budgetExposure, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	nextVersion := reservation.LedgerVersion + 1
	if err = persistUnconfirmed(
		ctx, tx, requestContext, reservationID, reservation, userPeriod, tenantPeriod,
		attempts, quotaState, budgetState, eventID, nextVersion, now,
	); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageSettlement{
		RequestID: requestContext.RequestID, ReservationID: reservationID, State: "unconfirmed",
		UnconfirmedTokens:           reservation.ReservedTokens,
		UnconfirmedExposureMicroUSD: reservation.ReservedCostMicroUSD,
		QuotaState:                  quotaState, BudgetState: budgetState, LedgerVersion: nextVersion,
		CacheOutcome: reservation.CacheOutcome, Attempts: attempts,
	}, nil
}

func lockUsageActors(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-user:"+requestContext.ExecutionScope.TenantID+":"+requestContext.ExecutionScope.Actor.UserID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-cost:"+requestContext.ExecutionScope.TenantID)
	return err
}

func persistReleased(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	reservation settlementReservation,
	userPeriod tokenPeriod,
	tenantPeriod costPeriod,
	quotaState string,
	budgetState string,
	eventID string,
	eventVersion int64,
	terminalOutcome string,
	now time.Time,
) error {
	if err := releasePeriodBalances(ctx, tx, requestContext, reservation, userPeriod, tenantPeriod, quotaState, budgetState, false, now); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET state = 'released', reserved_tokens = 0, reserved_cost_micro_usd = 0,
		    ledger_version = $3, terminal_at = $4, updated_at = $4
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND state = 'reserved' AND ledger_version = $5
	`, reservationID, requestContext.ExecutionScope.TenantID, eventVersion, now, reservation.LedgerVersion)
	if err := validateTerminalWrite(ctx, "release tenant chat reservation", err, tag.RowsAffected()); err != nil {
		return err
	}
	if err = insertTerminalLedger(ctx, tx, requestContext, reservationID, reservation, eventID, eventVersion, "usage_released", false, now); err != nil {
		return err
	}
	payload, err := terminalUsageEventPayload(
		"usage_released", eventID, reservationID, eventVersion, requestContext, reservation,
		userPeriod, quotaState, budgetState, nil, terminalOutcome, false, now,
	)
	if err != nil {
		return err
	}
	return insertTerminalOutbox(ctx, tx, requestContext, eventID, eventVersion, "usage_released", payload, now)
}

func persistUnconfirmed(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	reservation settlementReservation,
	userPeriod tokenPeriod,
	tenantPeriod costPeriod,
	attempts []tenantchat.ProviderAttempt,
	quotaState string,
	budgetState string,
	eventID string,
	eventVersion int64,
	now time.Time,
) error {
	if err := releasePeriodBalances(ctx, tx, requestContext, reservation, userPeriod, tenantPeriod, quotaState, budgetState, true, now); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET state = 'unconfirmed', reserved_tokens = 0, reserved_cost_micro_usd = 0,
		    unconfirmed_tokens = $3, unconfirmed_exposure_micro_usd = $4,
		    ledger_version = $5, terminal_at = $6, updated_at = $6
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND state = 'reserved' AND ledger_version = $7
	`, reservationID, requestContext.ExecutionScope.TenantID, reservation.ReservedTokens,
		reservation.ReservedCostMicroUSD, eventVersion, now, reservation.LedgerVersion)
	if err := validateTerminalWrite(ctx, "mark tenant chat reservation unconfirmed", err, tag.RowsAffected()); err != nil {
		return err
	}
	if err = insertTerminalLedger(ctx, tx, requestContext, reservationID, reservation, eventID, eventVersion, "usage_unconfirmed", true, now); err != nil {
		return err
	}
	payload, err := terminalUsageEventPayload(
		"usage_unconfirmed", eventID, reservationID, eventVersion, requestContext, reservation,
		userPeriod, quotaState, budgetState, attempts, terminalOutcomeForAttempt(attempts), true, now,
	)
	if err != nil {
		return err
	}
	return insertTerminalOutbox(ctx, tx, requestContext, eventID, eventVersion, "usage_unconfirmed", payload, now)
}

func releasePeriodBalances(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservation settlementReservation,
	userPeriod tokenPeriod,
	tenantPeriod costPeriod,
	quotaState string,
	budgetState string,
	unconfirmed bool,
	now time.Time,
) error {
	unconfirmedTokens := int64(0)
	unconfirmedCost := int64(0)
	if unconfirmed {
		unconfirmedTokens = reservation.ReservedTokens
		unconfirmedCost = reservation.ReservedCostMicroUSD
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_user_token_periods
		SET reserved_tokens = reserved_tokens - $4,
		    unconfirmed_tokens = unconfirmed_tokens + $5,
		    state = $6, version = version + 1, updated_at = $7
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
		  AND reserved_tokens >= $4
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		userPeriod.Start, reservation.ReservedTokens, unconfirmedTokens, quotaState, now)
	if err := validateTerminalWrite(ctx, "release tenant chat token period", err, tag.RowsAffected()); err != nil {
		return err
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_tenant_cost_periods
		SET reserved_cost_micro_usd = reserved_cost_micro_usd - $3,
		    unconfirmed_exposure_micro_usd = unconfirmed_exposure_micro_usd + $4,
		    state = $5, version = version + 1, updated_at = $6
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
		  AND reserved_cost_micro_usd >= $3
	`, requestContext.ExecutionScope.TenantID, tenantPeriod.Start,
		reservation.ReservedCostMicroUSD, unconfirmedCost, budgetState, now)
	if err := validateTerminalWrite(ctx, "release tenant chat cost period", err, tag.RowsAffected()); err != nil {
		return err
	}
	return nil
}

func validateTerminalWrite(ctx context.Context, operation string, err error, rowsAffected int64) error {
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%s: %w", operation, err)
	}
	if rowsAffected != 1 {
		return fmt.Errorf("%s: no rows affected", operation)
	}
	return nil
}

func insertTerminalLedger(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	reservation settlementReservation,
	eventID string,
	eventVersion int64,
	eventType string,
	unconfirmed bool,
	now time.Time,
) error {
	unconfirmedTokens := int64(0)
	unconfirmedCost := int64(0)
	if unconfirmed {
		unconfirmedTokens = reservation.ReservedTokens
		unconfirmedCost = reservation.ReservedCostMicroUSD
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_ledger_entries (
		  request_id, ledger_version, event_id, reservation_id, tenant_id, event_type,
		  reserved_tokens_delta, unconfirmed_tokens_delta,
		  reserved_cost_micro_usd_delta, unconfirmed_exposure_micro_usd_delta, occurred_at
		) VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10, $11)
	`, requestContext.RequestID, eventVersion, eventID, reservationID,
		requestContext.ExecutionScope.TenantID, eventType, -reservation.ReservedTokens,
		unconfirmedTokens, -reservation.ReservedCostMicroUSD, unconfirmedCost, now)
	return err
}

func insertTerminalOutbox(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	eventID string,
	eventVersion int64,
	eventType string,
	payload []byte,
	now time.Time,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO tenant_chat_invocation_outbox (
		  event_id, tenant_id, aggregate_id, event_type, event_version, payload, occurred_at, available_at
		) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $7)
	`, eventID, requestContext.ExecutionScope.TenantID, requestContext.RequestID,
		eventType, eventVersion, payload, now)
	return err
}

func terminalUsageEventPayload(
	eventType string,
	eventID string,
	reservationID string,
	eventVersion int64,
	requestContext tenantchat.RequestContext,
	reservation settlementReservation,
	userPeriod tokenPeriod,
	quotaState string,
	budgetState string,
	attempts []tenantchat.ProviderAttempt,
	terminalOutcome string,
	unconfirmed bool,
	now time.Time,
) ([]byte, error) {
	actor := requestContext.ExecutionScope.Actor
	executionScope := map[string]any{
		"kind": "tenant_chat", "tenantId": requestContext.ExecutionScope.TenantID,
		"userId": actor.UserID, "actorKind": actor.ActorKind,
	}
	if actor.EmployeeID != "" {
		executionScope["employeeId"] = actor.EmployeeID
	}
	unconfirmedTokens := int64(0)
	unconfirmedCost := int64(0)
	if unconfirmed {
		unconfirmedTokens = reservation.ReservedTokens
		unconfirmedCost = reservation.ReservedCostMicroUSD
	}
	payload := map[string]any{
		"eventId": eventID, "schemaVersion": 3, "eventType": eventType, "eventVersion": eventVersion,
		"occurredAt": now.Format(time.RFC3339Nano), "aggregateId": requestContext.RequestID,
		"requestId": requestContext.RequestID, "turnId": requestContext.TurnID,
		"idempotencyKey": requestContext.IdempotencyKey, "reservationId": reservationID,
		"executionScope": executionScope,
		"period": map[string]any{
			"start": userPeriod.Start.Format(time.RFC3339Nano), "end": userPeriod.End.Format(time.RFC3339Nano),
			"timezone": userPeriod.Timezone, "currency": "USD",
		},
		"snapshotVersion": requestContext.Snapshot.Version, "pricingVersion": reservation.PricingVersion,
		"cacheOutcome": reservation.CacheOutcome,
		"quota": map[string]any{
			"state": quotaState, "reservedTokensDelta": -reservation.ReservedTokens,
			"confirmedInputTokensDelta": 0, "confirmedOutputTokensDelta": 0,
			"confirmedTotalTokensDelta": 0, "unconfirmedTokensDelta": unconfirmedTokens,
		},
		"budget": map[string]any{
			"state": budgetState, "reservedCostMicroUsdDelta": -reservation.ReservedCostMicroUSD,
			"confirmedCostMicroUsdDelta": 0, "unconfirmedExposureMicroUsdDelta": unconfirmedCost,
		},
		"attempts": settlementAttemptsPayload(attempts), "terminalOutcome": terminalOutcome,
	}
	return json.Marshal(payload)
}

func validTerminalOutcome(value string) bool {
	switch value {
	case "failed", "cancelled", "rate_limited", "quota_blocked", "budget_blocked":
		return true
	default:
		return false
	}
}

func terminalOutcomeForAttempt(attempts []tenantchat.ProviderAttempt) string {
	if len(attempts) > 0 && attempts[len(attempts)-1].Outcome == "cancelled" {
		return "cancelled"
	}
	return "failed"
}
