package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type pendingReservation struct {
	ID          string
	Request     tenantchat.RequestContext
	Reservation settlementReservation
	EmployeeID  *string
}

type reconciliationExposure struct {
	Attempts          []tenantchat.ProviderAttempt
	Confirmed         settlementTotals
	UnconfirmedTokens int64
	UnconfirmedCost   int64
}

func (s *ReservationStore) ReconcileNextPending(
	ctx context.Context,
	cutoff time.Time,
) (processed bool, err error) {
	started := time.Now()
	defer s.observeTransaction("reconcile_pending", started)
	if s == nil || s.pool == nil || cutoff.IsZero() {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	pending, err := lockNextPendingReservation(ctx, tx, cutoff.UTC())
	if errors.Is(err, pgx.ErrNoRows) {
		_ = tx.Rollback(ctx)
		return false, nil
	}
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	// The reservation row is claimed with SKIP LOCKED before its actor is known.
	// Do not acquire actor advisory locks here: terminal paths acquire those locks
	// before the reservation, and reversing that order can deadlock. The user then
	// tenant period row locks below provide the required accounting serialization.
	now := s.now().UTC()
	if err = s.promoteDispatchedAttemptToPending(ctx, tx, pending, now); err != nil {
		return false, err
	}
	exposure, err := readReconciliationExposure(ctx, tx, pending)
	if err != nil || exposure.UnconfirmedTokens <= 0 || exposure.UnconfirmedCost < 0 {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(ctx, tx, pending.Request, pending.Reservation)
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	quotaExposure := userPeriod.Confirmed + userPeriod.Unconfirmed + exposure.Confirmed.InputTokens +
		exposure.Confirmed.OutputTokens + exposure.UnconfirmedTokens + userPeriod.Reserved - pending.Reservation.ReservedTokens
	budgetExposure := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + exposure.Confirmed.CostMicroUSD +
		exposure.UnconfirmedCost + tenantPeriod.Reserved - pending.Reservation.ReservedCostMicroUSD
	if quotaExposure < 0 || budgetExposure < 0 || exposure.UnconfirmedTokens > pending.Reservation.ReservedTokens ||
		exposure.UnconfirmedCost > pending.Reservation.ReservedCostMicroUSD {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(quotaExposure, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(budgetExposure, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	eventID, err := newUUID()
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	eventVersion := pending.Reservation.LedgerVersion + 1
	if err = persistReconciliation(
		ctx, tx, pending, userPeriod, tenantPeriod, exposure,
		quotaState, budgetState, eventID, eventVersion, now,
	); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if err = s.reconcileEmployeeCost(
		ctx, tx, pending.Request, pending.ID, pending.Reservation.LedgerVersion, now,
	); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	return true, nil
}

func (s *ReservationStore) promoteDispatchedAttemptToPending(
	ctx context.Context,
	tx pgx.Tx,
	pending pendingReservation,
	now time.Time,
) error {
	var pendingCount int
	var notAvailableCount int
	if err := tx.QueryRow(ctx, `
		SELECT
		  count(*) FILTER (WHERE usage_quality = 'pending_unconfirmed'),
		  count(*) FILTER (WHERE usage_quality = 'not_available')
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND reservation_id = $2::uuid AND tenant_id = $3::uuid
	`, pending.Request.RequestID, pending.ID, pending.Request.ExecutionScope.TenantID).Scan(
		&pendingCount, &notAvailableCount,
	); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if pendingCount > 0 {
		return nil
	}
	if notAvailableCount == 0 {
		return nil
	}
	if notAvailableCount != 1 {
		return tenantchat.ErrUsageGuardUnavailable
	}
	var attemptNo int
	err := tx.QueryRow(ctx, `
		UPDATE tenant_chat_provider_attempts
		SET outcome = 'timed_out', usage_quality = 'pending_unconfirmed',
		    completed_at = $4, updated_at = $4
		WHERE request_id = $1 AND reservation_id = $2::uuid AND tenant_id = $3::uuid
		  AND usage_quality = 'not_available'
		RETURNING attempt_no
	`, pending.Request.RequestID, pending.ID,
		pending.Request.ExecutionScope.TenantID, now).Scan(&attemptNo)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return s.markEmployeePending(
		ctx, tx, pending.Request, pending.ID, attemptNo, "timed_out",
	)
}

func lockNextPendingReservation(ctx context.Context, tx pgx.Tx, cutoff time.Time) (pendingReservation, error) {
	var result pendingReservation
	var employeeID *string
	var routingDifficulty *string
	err := tx.QueryRow(ctx, `
		SELECT reservation.reservation_id::text, reservation.tenant_id::text,
		       reservation.user_id::text, reservation.request_id, reservation.turn_id,
		       reservation.idempotency_key, reservation.snapshot_version,
		       reservation.snapshot_digest, reservation.pricing_version,
		       reservation.user_period_start, reservation.tenant_period_start,
		       reservation.reserved_tokens, reservation.reserved_cost_micro_usd,
		       reservation.ledger_version, reservation.cache_outcome,
		       reservation.routing_difficulty,
		       admission.actor_kind, admission.employee_id::text
		FROM tenant_chat_usage_reservations AS reservation
		JOIN tenant_chat_request_admissions AS admission
		  ON admission.tenant_id = reservation.tenant_id
		 AND admission.user_id = reservation.user_id
		 AND admission.request_id = reservation.request_id
		WHERE reservation.state = 'reserved'
		  AND reservation.usage_pending_at IS NOT NULL
		  AND reservation.usage_pending_at <= $1
		ORDER BY reservation.usage_pending_at, reservation.reservation_id
		FOR UPDATE OF reservation SKIP LOCKED
		LIMIT 1
	`, cutoff).Scan(
		&result.ID, &result.Request.ExecutionScope.TenantID,
		&result.Request.ExecutionScope.Actor.UserID, &result.Request.RequestID, &result.Request.TurnID,
		&result.Request.IdempotencyKey, &result.Request.Snapshot.Version,
		&result.Request.Snapshot.Digest, &result.Reservation.PricingVersion,
		&result.Reservation.UserPeriodStart, &result.Reservation.TenantPeriodStart,
		&result.Reservation.ReservedTokens, &result.Reservation.ReservedCostMicroUSD,
		&result.Reservation.LedgerVersion, &result.Reservation.CacheOutcome,
		&routingDifficulty,
		&result.Request.ExecutionScope.Actor.ActorKind, &employeeID,
	)
	if err != nil {
		return pendingReservation{}, err
	}
	result.Request.Surface = "tenant_chat"
	result.Request.Phase = tenantchat.PhaseCompletion
	result.Request.ExecutionScope.Kind = "tenant_chat"
	result.Request.ExecutionScope.QuotaScope = tenantchat.ScopeReference{
		Type: "user", ID: result.Request.ExecutionScope.Actor.UserID,
	}
	result.Request.ExecutionScope.BudgetScope = tenantchat.ScopeReference{
		Type: "tenant", ID: result.Request.ExecutionScope.TenantID,
	}
	result.Request.Snapshot.PricingVersion = result.Reservation.PricingVersion
	restoreRoutingDifficulty(&result.Request, routingDifficulty)
	if employeeID != nil {
		result.Request.ExecutionScope.Actor.EmployeeID = *employeeID
	}
	result.Reservation.State = "reserved"
	return result, nil
}

func restoreRoutingDifficulty(requestContext *tenantchat.RequestContext, difficulty *string) {
	if difficulty == nil {
		return
	}
	if requestContext.Routing == nil {
		requestContext.Routing = &tenantchat.RoutingDecision{}
	}
	requestContext.Routing.Difficulty = *difficulty
}

func readReconciliationExposure(
	ctx context.Context,
	tx pgx.Tx,
	pending pendingReservation,
) (reconciliationExposure, error) {
	rows, err := tx.Query(ctx, `
		SELECT attempt_no, kind, provider_id, model_key, outcome, usage_quality,
		       confirmed_input_tokens, confirmed_output_tokens, confirmed_cost_micro_usd,
		       estimated_input_tokens, max_output_tokens, reserved_cost_micro_usd
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND reservation_id = $2::uuid AND tenant_id = $3::uuid
		ORDER BY attempt_no
	`, pending.Request.RequestID, pending.ID, pending.Request.ExecutionScope.TenantID)
	if err != nil {
		return reconciliationExposure{}, err
	}
	defer rows.Close()
	result := reconciliationExposure{Attempts: make([]tenantchat.ProviderAttempt, 0, 4)}
	for rows.Next() {
		var attempt tenantchat.ProviderAttempt
		var estimatedInput, maxOutput, reservedCost int64
		if err := rows.Scan(
			&attempt.AttemptNo, &attempt.Kind, &attempt.ProviderID, &attempt.ModelKey,
			&attempt.Outcome, &attempt.UsageQuality, &attempt.InputTokens,
			&attempt.OutputTokens, &attempt.CostMicroUSD,
			&estimatedInput, &maxOutput, &reservedCost,
		); err != nil {
			return reconciliationExposure{}, err
		}
		attempt.RequestID = pending.Request.RequestID
		result.Attempts = append(result.Attempts, attempt)
		switch attempt.UsageQuality {
		case "confirmed":
			result.Confirmed.InputTokens += attempt.InputTokens
			result.Confirmed.OutputTokens += attempt.OutputTokens
			result.Confirmed.CostMicroUSD += attempt.CostMicroUSD
		case "pending_unconfirmed":
			result.UnconfirmedTokens += estimatedInput + maxOutput
			result.UnconfirmedCost += reservedCost
		default:
			return reconciliationExposure{}, tenantchat.ErrUsageGuardUnavailable
		}
	}
	if err := rows.Err(); err != nil || len(result.Attempts) == 0 {
		return reconciliationExposure{}, tenantchat.ErrUsageGuardUnavailable
	}
	return result, nil
}

func persistReconciliation(
	ctx context.Context,
	tx pgx.Tx,
	pending pendingReservation,
	userPeriod tokenPeriod,
	tenantPeriod costPeriod,
	exposure reconciliationExposure,
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
		    unconfirmed_tokens = unconfirmed_tokens + $7,
		    state = $8, version = version + 1, updated_at = $9
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
		  AND reserved_tokens >= $4
	`, pending.Request.ExecutionScope.TenantID, pending.Request.ExecutionScope.Actor.UserID,
		userPeriod.Start, pending.Reservation.ReservedTokens,
		exposure.Confirmed.InputTokens, exposure.Confirmed.OutputTokens, exposure.UnconfirmedTokens,
		quotaState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.ErrUsageGuardUnavailable
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_tenant_cost_periods
		SET reserved_cost_micro_usd = reserved_cost_micro_usd - $3,
		    confirmed_cost_micro_usd = confirmed_cost_micro_usd + $4,
		    unconfirmed_exposure_micro_usd = unconfirmed_exposure_micro_usd + $5,
		    state = $6, version = version + 1, updated_at = $7
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
		  AND reserved_cost_micro_usd >= $3
	`, pending.Request.ExecutionScope.TenantID, tenantPeriod.Start,
		pending.Reservation.ReservedCostMicroUSD, exposure.Confirmed.CostMicroUSD,
		exposure.UnconfirmedCost, budgetState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.ErrUsageGuardUnavailable
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET state = 'unconfirmed', reserved_tokens = 0, reserved_cost_micro_usd = 0,
		    confirmed_input_tokens = $3, confirmed_output_tokens = $4,
		    confirmed_cost_micro_usd = $5, unconfirmed_tokens = $6,
		    unconfirmed_exposure_micro_usd = $7, ledger_version = $8,
		    usage_pending_at = NULL, terminal_at = $9, updated_at = $9
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND state = 'reserved' AND ledger_version = $10
	`, pending.ID, pending.Request.ExecutionScope.TenantID,
		exposure.Confirmed.InputTokens, exposure.Confirmed.OutputTokens,
		exposure.Confirmed.CostMicroUSD, exposure.UnconfirmedTokens, exposure.UnconfirmedCost,
		eventVersion, now, pending.Reservation.LedgerVersion)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.ErrUsageGuardUnavailable
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_ledger_entries (
		  request_id, ledger_version, event_id, reservation_id, tenant_id, event_type,
		  reserved_tokens_delta, confirmed_input_tokens_delta, confirmed_output_tokens_delta,
		  unconfirmed_tokens_delta, reserved_cost_micro_usd_delta,
		  confirmed_cost_micro_usd_delta, unconfirmed_exposure_micro_usd_delta, occurred_at
		) VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'usage_unconfirmed',
		  $6, $7, $8, $9, $10, $11, $12, $13)
	`, pending.Request.RequestID, eventVersion, eventID, pending.ID,
		pending.Request.ExecutionScope.TenantID, -pending.Reservation.ReservedTokens,
		exposure.Confirmed.InputTokens, exposure.Confirmed.OutputTokens, exposure.UnconfirmedTokens,
		-pending.Reservation.ReservedCostMicroUSD, exposure.Confirmed.CostMicroUSD,
		exposure.UnconfirmedCost, now)
	if err != nil {
		return err
	}
	payload, err := reconciliationEventPayload(
		eventID, eventVersion, pending, userPeriod, exposure, quotaState, budgetState, now,
	)
	if err != nil {
		return err
	}
	return insertTerminalOutbox(
		ctx, tx, pending.Request, eventID, eventVersion, "usage_unconfirmed", payload, now,
	)
}

func reconciliationEventPayload(
	eventID string,
	eventVersion int64,
	pending pendingReservation,
	userPeriod tokenPeriod,
	exposure reconciliationExposure,
	quotaState string,
	budgetState string,
	now time.Time,
) ([]byte, error) {
	actor := pending.Request.ExecutionScope.Actor
	executionScope := map[string]any{
		"kind": "tenant_chat", "tenantId": pending.Request.ExecutionScope.TenantID,
		"userId": actor.UserID, "actorKind": actor.ActorKind,
	}
	if actor.EmployeeID != "" {
		executionScope["employeeId"] = actor.EmployeeID
	}
	payload := map[string]any{
		"eventId": eventID, "schemaVersion": 3, "eventType": "usage_unconfirmed", "eventVersion": eventVersion,
		"occurredAt": now.Format(time.RFC3339Nano), "aggregateId": pending.Request.RequestID,
		"requestId": pending.Request.RequestID, "turnId": pending.Request.TurnID,
		"idempotencyKey": pending.Request.IdempotencyKey, "reservationId": pending.ID,
		"executionScope": executionScope,
		"period": map[string]any{
			"start": userPeriod.Start.Format(time.RFC3339Nano), "end": userPeriod.End.Format(time.RFC3339Nano),
			"timezone": userPeriod.Timezone, "currency": "USD",
		},
		"snapshotVersion": pending.Request.Snapshot.Version, "pricingVersion": pending.Reservation.PricingVersion,
		"cacheOutcome": pending.Reservation.CacheOutcome,
		"quota": map[string]any{
			"state": quotaState, "reservedTokensDelta": -pending.Reservation.ReservedTokens,
			"confirmedInputTokensDelta":  exposure.Confirmed.InputTokens,
			"confirmedOutputTokensDelta": exposure.Confirmed.OutputTokens,
			"confirmedTotalTokensDelta":  exposure.Confirmed.InputTokens + exposure.Confirmed.OutputTokens,
			"unconfirmedTokensDelta":     exposure.UnconfirmedTokens,
		},
		"budget": map[string]any{
			"state": budgetState, "reservedCostMicroUsdDelta": -pending.Reservation.ReservedCostMicroUSD,
			"confirmedCostMicroUsdDelta":       exposure.Confirmed.CostMicroUSD,
			"unconfirmedExposureMicroUsdDelta": exposure.UnconfirmedCost,
		},
		"attempts":        settlementAttemptsPayload(exposure.Attempts),
		"terminalOutcome": terminalOutcomeForAttempt(exposure.Attempts), "lateUsage": false,
	}
	return json.Marshal(payload)
}
