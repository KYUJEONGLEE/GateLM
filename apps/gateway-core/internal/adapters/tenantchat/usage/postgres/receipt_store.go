package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

type receiptReservation struct {
	Pending           pendingReservation
	State             string
	ConfirmedInput    int64
	ConfirmedOutput   int64
	ConfirmedCost     int64
	UnconfirmedTokens int64
	UnconfirmedCost   int64
}

type receiptAttempt struct {
	ProviderID      string
	UsageQuality    string
	InputTokens     int64
	OutputTokens    int64
	CacheReadTokens int64
	Cost            int64
	EstimatedInput  int64
	MaxOutput       int64
	ReservedCost    int64
	Pricing         settlementAttempt
}

func (s *ReservationStore) RecordUsageReceipt(
	ctx context.Context,
	receipt tenantchat.UsageReceipt,
) (result tenantchat.UsageReceiptResult, err error) {
	started := time.Now()
	defer s.observeTransaction("usage_receipt", started)
	if s == nil || s.pool == nil || receipt.RequestID == "" || receipt.AttemptNo < 1 || receipt.AttemptNo > 4 ||
		receipt.ProviderID == "" || receipt.InputTokens < 0 || receipt.OutputTokens < 0 ||
		receipt.CacheReadInputTokens < 0 || receipt.CacheReadInputTokens > receipt.InputTokens {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	reservation, err := lockReceiptReservation(ctx, tx, receipt.RequestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrIdempotencyConflict
	}
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	// The receipt owns the reservation before it can reconstruct the actor. Avoid
	// taking the terminal path's advisory locks in reverse order; the user then
	// tenant period row locks in the settlement paths serialize the balance write.
	attempt, err := lockReceiptAttempt(ctx, tx, reservation, receipt.AttemptNo)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && attempt.ProviderID != receipt.ProviderID) {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrIdempotencyConflict
	}
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	usage := tenantchat.ConfirmedUsage{
		InputTokens: receipt.InputTokens, OutputTokens: receipt.OutputTokens,
		CacheReadInputTokens: receipt.CacheReadInputTokens,
	}
	cost, err := confirmedAttemptCost(attempt.Pricing, usage)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	if attempt.UsageQuality == "confirmed" {
		if attempt.InputTokens != receipt.InputTokens || attempt.OutputTokens != receipt.OutputTokens ||
			attempt.CacheReadTokens != receipt.CacheReadInputTokens || attempt.Cost != cost {
			return tenantchat.UsageReceiptResult{}, tenantchat.ErrIdempotencyConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.UsageReceiptResult{
			RequestID: receipt.RequestID, AttemptNo: receipt.AttemptNo,
			State: receiptResponseState(reservation.State), Replayed: true,
		}, nil
	}
	if attempt.UsageQuality != "pending_unconfirmed" ||
		(reservation.State != "reserved" && reservation.State != "unconfirmed") {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrIdempotencyConflict
	}
	now := s.now().UTC()
	if err = confirmReceiptAttempt(ctx, tx, reservation, receipt, cost, now); err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	if reservation.State == "reserved" {
		if err = s.confirmEmployeePendingAttempt(
			ctx, tx, reservation.Pending.Request, reservation.Pending.ID, receipt.AttemptNo, usage,
		); err != nil {
			return tenantchat.UsageReceiptResult{}, err
		}
		return s.finishPendingReceipt(ctx, tx, reservation, receipt, now)
	}
	return s.finishLateReceipt(ctx, tx, reservation, attempt, receipt, cost, now)
}

func lockReceiptReservation(ctx context.Context, tx pgx.Tx, requestID string) (receiptReservation, error) {
	var result receiptReservation
	var employeeID *string
	var routingDifficulty *string
	err := tx.QueryRow(ctx, `
		SELECT reservation.reservation_id::text, reservation.tenant_id::text,
		       reservation.user_id::text, reservation.request_id, reservation.turn_id,
		       reservation.idempotency_key, reservation.snapshot_version,
		       reservation.snapshot_digest, reservation.pricing_version,
		       reservation.cache_outcome, reservation.routing_difficulty,
		       reservation.user_period_start, reservation.tenant_period_start,
		       reservation.reserved_tokens, reservation.reserved_cost_micro_usd,
		       reservation.ledger_version, reservation.state,
		       reservation.confirmed_input_tokens, reservation.confirmed_output_tokens,
		       reservation.confirmed_cost_micro_usd, reservation.unconfirmed_tokens,
		       reservation.unconfirmed_exposure_micro_usd,
		       admission.actor_kind, admission.employee_id::text
		FROM tenant_chat_usage_reservations AS reservation
		JOIN tenant_chat_request_admissions AS admission
		  ON admission.tenant_id = reservation.tenant_id
		 AND admission.user_id = reservation.user_id
		 AND admission.request_id = reservation.request_id
		WHERE reservation.request_id = $1
		FOR UPDATE OF reservation
	`, requestID).Scan(
		&result.Pending.ID, &result.Pending.Request.ExecutionScope.TenantID,
		&result.Pending.Request.ExecutionScope.Actor.UserID, &result.Pending.Request.RequestID,
		&result.Pending.Request.TurnID, &result.Pending.Request.IdempotencyKey,
		&result.Pending.Request.Snapshot.Version, &result.Pending.Request.Snapshot.Digest,
		&result.Pending.Reservation.PricingVersion, &result.Pending.Reservation.CacheOutcome,
		&routingDifficulty,
		&result.Pending.Reservation.UserPeriodStart,
		&result.Pending.Reservation.TenantPeriodStart, &result.Pending.Reservation.ReservedTokens,
		&result.Pending.Reservation.ReservedCostMicroUSD, &result.Pending.Reservation.LedgerVersion,
		&result.State, &result.ConfirmedInput, &result.ConfirmedOutput, &result.ConfirmedCost,
		&result.UnconfirmedTokens, &result.UnconfirmedCost,
		&result.Pending.Request.ExecutionScope.Actor.ActorKind, &employeeID,
	)
	if err != nil {
		return receiptReservation{}, err
	}
	result.Pending.Reservation.State = result.State
	result.Pending.Request.Surface = "tenant_chat"
	result.Pending.Request.Phase = tenantchat.PhaseCompletion
	result.Pending.Request.ExecutionScope.Kind = "tenant_chat"
	result.Pending.Request.ExecutionScope.QuotaScope = tenantchat.ScopeReference{
		Type: "user", ID: result.Pending.Request.ExecutionScope.Actor.UserID,
	}
	result.Pending.Request.ExecutionScope.BudgetScope = tenantchat.ScopeReference{
		Type: "tenant", ID: result.Pending.Request.ExecutionScope.TenantID,
	}
	result.Pending.Request.Snapshot.PricingVersion = result.Pending.Reservation.PricingVersion
	restoreRoutingDifficulty(&result.Pending.Request, routingDifficulty)
	if employeeID != nil {
		result.Pending.Request.ExecutionScope.Actor.EmployeeID = *employeeID
	}
	return result, nil
}

func lockReceiptAttempt(
	ctx context.Context,
	tx pgx.Tx,
	reservation receiptReservation,
	attemptNo int,
) (receiptAttempt, error) {
	var result receiptAttempt
	err := tx.QueryRow(ctx, `
		SELECT provider_id, usage_quality, confirmed_input_tokens,
		       confirmed_output_tokens, confirmed_cache_read_input_tokens,
		       confirmed_cost_micro_usd, estimated_input_tokens, max_output_tokens,
		       reserved_cost_micro_usd, input_micro_usd_per_million_tokens,
		       output_micro_usd_per_million_tokens,
		       cache_read_input_micro_usd_per_million_tokens, completed_at
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $4::uuid
		FOR UPDATE
	`, reservation.Pending.Request.RequestID, attemptNo, reservation.Pending.ID,
		reservation.Pending.Request.ExecutionScope.TenantID).Scan(
		&result.ProviderID, &result.UsageQuality, &result.InputTokens,
		&result.OutputTokens, &result.CacheReadTokens, &result.Cost,
		&result.EstimatedInput, &result.MaxOutput, &result.ReservedCost,
		&result.Pricing.InputPrice, &result.Pricing.OutputPrice,
		&result.Pricing.CacheReadPrice, &result.Pricing.CompletedAt,
	)
	return result, err
}

func confirmReceiptAttempt(
	ctx context.Context,
	tx pgx.Tx,
	reservation receiptReservation,
	receipt tenantchat.UsageReceipt,
	cost int64,
	now time.Time,
) error {
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_provider_attempts
		SET confirmed_input_tokens = $4, confirmed_output_tokens = $5,
		    confirmed_cache_read_input_tokens = $6, confirmed_cost_micro_usd = $7,
		    usage_quality = 'confirmed', updated_at = $8
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $9::uuid
		  AND provider_id = $10 AND usage_quality = 'pending_unconfirmed'
	`, receipt.RequestID, receipt.AttemptNo, reservation.Pending.ID,
		receipt.InputTokens, receipt.OutputTokens, receipt.CacheReadInputTokens,
		cost, now, reservation.Pending.Request.ExecutionScope.TenantID, receipt.ProviderID)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return nil
}

func (s *ReservationStore) finishPendingReceipt(
	ctx context.Context,
	tx pgx.Tx,
	reservation receiptReservation,
	receipt tenantchat.UsageReceipt,
	now time.Time,
) (tenantchat.UsageReceiptResult, error) {
	attempts, totals, pending, err := readSettlementAttempts(
		ctx, tx, reservation.Pending.Request, reservation.Pending.ID,
	)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	if pending {
		if err := tx.Commit(ctx); err != nil {
			return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
		}
		return tenantchat.UsageReceiptResult{
			RequestID: receipt.RequestID, AttemptNo: receipt.AttemptNo, State: "pending",
		}, nil
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(
		ctx, tx, reservation.Pending.Request, reservation.Pending.Reservation,
	)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaExposure := userPeriod.Confirmed + userPeriod.Unconfirmed + totals.InputTokens + totals.OutputTokens +
		userPeriod.Reserved - reservation.Pending.Reservation.ReservedTokens
	budgetExposure := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + totals.CostMicroUSD +
		tenantPeriod.Reserved - reservation.Pending.Reservation.ReservedCostMicroUSD
	if quotaExposure < 0 || budgetExposure < 0 {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(quotaExposure, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(budgetExposure, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = persistSettlement(
		ctx, tx, reservation.Pending.Request, reservation.Pending.ID,
		reservation.Pending.Reservation, userPeriod, tenantPeriod, attempts, totals,
		quotaState, budgetState, eventID, reservation.Pending.Reservation.LedgerVersion+1, now,
	); err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	lastAttemptNo := attempts[len(attempts)-1].AttemptNo
	if err = s.settleEmployeeCost(
		ctx, tx, reservation.Pending.Request, reservation.Pending.ID,
		lastAttemptNo, reservation.Pending.Reservation.LedgerVersion,
	); err != nil {
		return tenantchat.UsageReceiptResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageReceiptResult{
		RequestID: receipt.RequestID, AttemptNo: receipt.AttemptNo, State: "settled",
	}, nil
}

func (s *ReservationStore) finishLateReceipt(
	ctx context.Context,
	tx pgx.Tx,
	reservation receiptReservation,
	attempt receiptAttempt,
	receipt tenantchat.UsageReceipt,
	cost int64,
	now time.Time,
) (tenantchat.UsageReceiptResult, error) {
	attemptExposureTokens := attempt.EstimatedInput + attempt.MaxOutput
	if attemptExposureTokens <= 0 || attempt.ReservedCost < 0 ||
		attemptExposureTokens > reservation.UnconfirmedTokens || attempt.ReservedCost > reservation.UnconfirmedCost {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(
		ctx, tx, reservation.Pending.Request, reservation.Pending.Reservation,
	)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	newUnconfirmedTokens := reservation.UnconfirmedTokens - attemptExposureTokens
	newUnconfirmedCost := reservation.UnconfirmedCost - attempt.ReservedCost
	quotaExposure := userPeriod.Confirmed + receipt.InputTokens + receipt.OutputTokens +
		userPeriod.Unconfirmed - attemptExposureTokens + userPeriod.Reserved
	budgetExposure := tenantPeriod.Confirmed + cost + tenantPeriod.Unconfirmed - attempt.ReservedCost + tenantPeriod.Reserved
	if quotaExposure < 0 || budgetExposure < 0 {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(quotaExposure, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(budgetExposure, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_user_token_periods
		SET confirmed_input_tokens = confirmed_input_tokens + $4,
		    confirmed_output_tokens = confirmed_output_tokens + $5,
		    confirmed_total_tokens = confirmed_total_tokens + $4 + $5,
		    unconfirmed_tokens = unconfirmed_tokens - $6,
		    state = $7, version = version + 1, updated_at = $8
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
		  AND unconfirmed_tokens >= $6
	`, reservation.Pending.Request.ExecutionScope.TenantID,
		reservation.Pending.Request.ExecutionScope.Actor.UserID, userPeriod.Start,
		receipt.InputTokens, receipt.OutputTokens, attemptExposureTokens, quotaState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_tenant_cost_periods
		SET confirmed_cost_micro_usd = confirmed_cost_micro_usd + $3,
		    unconfirmed_exposure_micro_usd = unconfirmed_exposure_micro_usd - $4,
		    state = $5, version = version + 1, updated_at = $6
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
		  AND unconfirmed_exposure_micro_usd >= $4
	`, reservation.Pending.Request.ExecutionScope.TenantID, tenantPeriod.Start,
		cost, attempt.ReservedCost, budgetState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	state := "unconfirmed"
	responseState := "unconfirmed"
	if newUnconfirmedTokens == 0 && newUnconfirmedCost == 0 {
		state = "settled"
		responseState = "settled"
	}
	eventVersion := reservation.Pending.Reservation.LedgerVersion + 1
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET state = $3, confirmed_input_tokens = confirmed_input_tokens + $4,
		    confirmed_output_tokens = confirmed_output_tokens + $5,
		    confirmed_cost_micro_usd = confirmed_cost_micro_usd + $6,
		    unconfirmed_tokens = $7, unconfirmed_exposure_micro_usd = $8,
		    ledger_version = $9, updated_at = $10
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND state = 'unconfirmed' AND ledger_version = $11
	`, reservation.Pending.ID, reservation.Pending.Request.ExecutionScope.TenantID,
		state, receipt.InputTokens, receipt.OutputTokens, cost,
		newUnconfirmedTokens, newUnconfirmedCost, eventVersion, now,
		reservation.Pending.Reservation.LedgerVersion)
	if err != nil || tag.RowsAffected() != 1 {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_ledger_entries (
		  request_id, ledger_version, event_id, reservation_id, tenant_id, event_type,
		  confirmed_input_tokens_delta, confirmed_output_tokens_delta,
		  unconfirmed_tokens_delta, confirmed_cost_micro_usd_delta,
		  unconfirmed_exposure_micro_usd_delta, occurred_at
		) VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'usage_settled',
		  $6, $7, $8, $9, $10, $11)
	`, receipt.RequestID, eventVersion, eventID, reservation.Pending.ID,
		reservation.Pending.Request.ExecutionScope.TenantID,
		receipt.InputTokens, receipt.OutputTokens, -attemptExposureTokens,
		cost, -attempt.ReservedCost, now)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	attempts, _, _, err := readSettlementAttempts(
		ctx, tx, reservation.Pending.Request, reservation.Pending.ID,
	)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	payload, err := lateReceiptEventPayload(
		eventID, eventVersion, reservation, userPeriod, attempts, receipt,
		attemptExposureTokens, attempt.ReservedCost, cost, quotaState, budgetState, now,
	)
	if err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = insertTerminalOutbox(
		ctx, tx, reservation.Pending.Request, eventID, eventVersion, "usage_settled", payload, now,
	); err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	usage := tenantchat.ConfirmedUsage{
		InputTokens: receipt.InputTokens, OutputTokens: receipt.OutputTokens,
		CacheReadInputTokens: receipt.CacheReadInputTokens,
	}
	if err = s.applyEmployeeLateReceipt(
		ctx, tx, reservation.Pending.Request, reservation.Pending.ID, receipt.AttemptNo,
		usage, reservation.Pending.Reservation.LedgerVersion, now,
	); err != nil {
		return tenantchat.UsageReceiptResult{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageReceiptResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageReceiptResult{
		RequestID: receipt.RequestID, AttemptNo: receipt.AttemptNo, State: responseState,
	}, nil
}

func lateReceiptEventPayload(
	eventID string,
	eventVersion int64,
	reservation receiptReservation,
	userPeriod tokenPeriod,
	attempts []tenantchat.ProviderAttempt,
	receipt tenantchat.UsageReceipt,
	attemptExposureTokens int64,
	attemptExposureCost int64,
	confirmedCost int64,
	quotaState string,
	budgetState string,
	now time.Time,
) ([]byte, error) {
	actor := reservation.Pending.Request.ExecutionScope.Actor
	executionScope := map[string]any{
		"kind": "tenant_chat", "tenantId": reservation.Pending.Request.ExecutionScope.TenantID,
		"userId": actor.UserID, "actorKind": actor.ActorKind,
	}
	if actor.EmployeeID != "" {
		executionScope["employeeId"] = actor.EmployeeID
	}
	payload := map[string]any{
		"eventId": eventID, "schemaVersion": 3, "eventType": "usage_settled", "eventVersion": eventVersion,
		"occurredAt": now.Format(time.RFC3339Nano), "aggregateId": receipt.RequestID,
		"requestId": receipt.RequestID, "turnId": reservation.Pending.Request.TurnID,
		"idempotencyKey": reservation.Pending.Request.IdempotencyKey, "reservationId": reservation.Pending.ID,
		"executionScope": executionScope,
		"period": map[string]any{
			"start": userPeriod.Start.Format(time.RFC3339Nano), "end": userPeriod.End.Format(time.RFC3339Nano),
			"timezone": userPeriod.Timezone, "currency": "USD",
		},
		"snapshotVersion": reservation.Pending.Request.Snapshot.Version,
		"pricingVersion":  reservation.Pending.Reservation.PricingVersion,
		"cacheOutcome":    reservation.Pending.Reservation.CacheOutcome,
		"quota": map[string]any{
			"state": quotaState, "reservedTokensDelta": 0,
			"confirmedInputTokensDelta":  receipt.InputTokens,
			"confirmedOutputTokensDelta": receipt.OutputTokens,
			"confirmedTotalTokensDelta":  receipt.InputTokens + receipt.OutputTokens,
			"unconfirmedTokensDelta":     -attemptExposureTokens,
		},
		"budget": map[string]any{
			"state": budgetState, "reservedCostMicroUsdDelta": 0,
			"confirmedCostMicroUsdDelta":       confirmedCost,
			"unconfirmedExposureMicroUsdDelta": -attemptExposureCost,
		},
		"attempts":        settlementAttemptsPayload(attempts),
		"terminalOutcome": terminalOutcomeForAttempt(attempts), "lateUsage": true,
	}
	if err := addRoutingDifficultyPayload(payload, reservation.Pending.Request); err != nil {
		return nil, err
	}
	return json.Marshal(payload)
}

func receiptResponseState(state string) string {
	switch state {
	case "settled", "released":
		return "settled"
	case "unconfirmed":
		return "unconfirmed"
	default:
		return "pending"
	}
}
