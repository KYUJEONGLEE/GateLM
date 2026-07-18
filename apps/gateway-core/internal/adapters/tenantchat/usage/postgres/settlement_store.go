package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"

	"github.com/jackc/pgx/v5"
)

func (s *ReservationStore) FinalizeConfirmed(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
	usage tenantchat.ConfirmedUsage,
	outcome string,
) (result tenantchat.UsageSettlement, err error) {
	started := time.Now()
	defer s.observeTransaction("finalize_confirmed", started)
	if s == nil || s.pool == nil || attemptNo < 1 || attemptNo > 4 || !validAttemptOutcome(outcome) ||
		usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.CacheReadInputTokens < 0 ||
		usage.CacheReadInputTokens > usage.InputTokens {
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

	now := s.now().UTC()
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-user:"+requestContext.ExecutionScope.TenantID+":"+requestContext.ExecutionScope.Actor.UserID); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-cost:"+requestContext.ExecutionScope.TenantID); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}

	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if reservation.State == "settled" {
		if err = s.recordConfirmedAttemptTx(
			ctx, tx, s.now().UTC(), requestContext, reservationID, attemptNo, usage, outcome,
		); err != nil {
			return tenantchat.UsageSettlement{}, err
		}
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

	attempt, err := lockAttempt(ctx, tx, requestContext, reservationID, attemptNo)
	if err != nil || attempt.CompletedAt != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	confirmedCost, err := confirmedAttemptCost(attempt, usage)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
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
		outcome, now, requestContext.ExecutionScope.TenantID); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = s.recordEmployeeConfirmedAttempt(
		ctx, tx, requestContext, reservationID, attemptNo, usage, outcome,
	); err != nil {
		return tenantchat.UsageSettlement{}, err
	}

	attempts, totals, hasPending, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil || len(attempts) == 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if hasPending {
		return tenantchat.UsageSettlement{}, tenantchat.ErrIdempotencyConflict
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(ctx, tx, requestContext, reservation)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	projectedTokens := userPeriod.Confirmed + userPeriod.Unconfirmed + totals.InputTokens + totals.OutputTokens + userPeriod.Reserved - reservation.ReservedTokens
	projectedCost := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + totals.CostMicroUSD + tenantPeriod.Reserved - reservation.ReservedCostMicroUSD
	if projectedTokens < 0 || projectedCost < 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(projectedTokens, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(projectedCost, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	nextVersion := reservation.LedgerVersion + 1
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}

	if err = persistSettlement(
		ctx, tx, requestContext, reservationID, reservation, userPeriod, tenantPeriod,
		attempts, totals, quotaState, budgetState, eventID, nextVersion, now,
	); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = s.settleEmployeeCost(
		ctx, tx, requestContext, reservationID, attemptNo, reservation.LedgerVersion,
	); err != nil {
		return tenantchat.UsageSettlement{}, err
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

func (s *ReservationStore) FinalizeRecordedAttempts(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	reservationID string,
) (result tenantchat.UsageSettlement, err error) {
	started := time.Now()
	defer s.observeTransaction("finalize_recorded", started)
	if s == nil || s.pool == nil {
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
	if reservation.State == "settled" {
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
	attempts, totals, hasPending, err := readSettlementAttempts(ctx, tx, requestContext, reservationID)
	if err != nil || len(attempts) == 0 || hasPending {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	for _, attempt := range attempts {
		if attempt.UsageQuality != "confirmed" {
			return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
		}
	}
	userPeriod, tenantPeriod, err := lockSettlementPeriods(ctx, tx, requestContext, reservation)
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	projectedTokens := userPeriod.Confirmed + userPeriod.Unconfirmed + totals.InputTokens + totals.OutputTokens + userPeriod.Reserved - reservation.ReservedTokens
	projectedCost := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + totals.CostMicroUSD + tenantPeriod.Reserved - reservation.ReservedCostMicroUSD
	if projectedTokens < 0 || projectedCost < 0 {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	quotaState := usageState(projectedTokens, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(projectedCost, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	nextVersion := reservation.LedgerVersion + 1
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	now := s.now().UTC()
	if err = persistSettlement(
		ctx, tx, requestContext, reservationID, reservation, userPeriod, tenantPeriod,
		attempts, totals, quotaState, budgetState, eventID, nextVersion, now,
	); err != nil {
		return tenantchat.UsageSettlement{}, tenantchat.ErrUsageGuardUnavailable
	}
	lastAttemptNo := attempts[len(attempts)-1].AttemptNo
	if err = s.settleEmployeeCost(
		ctx, tx, requestContext, reservationID, lastAttemptNo, reservation.LedgerVersion,
	); err != nil {
		return tenantchat.UsageSettlement{}, err
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

type settlementReservation struct {
	State                string
	UserPeriodStart      time.Time
	TenantPeriodStart    time.Time
	ReservedTokens       int64
	ReservedCostMicroUSD int64
	LedgerVersion        int64
	PricingVersion       int64
	CacheOutcome         string
}

type settlementAttempt struct {
	InputPrice     int64
	OutputPrice    int64
	CacheReadPrice *int64
	CompletedAt    *time.Time
}

type settlementTotals struct {
	InputTokens  int64
	OutputTokens int64
	CostMicroUSD int64
}

func lockReservationForSettlement(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
) (result settlementReservation, err error) {
	err = tx.QueryRow(ctx, `
		SELECT state, user_period_start, tenant_period_start,
		       reserved_tokens, reserved_cost_micro_usd, ledger_version, pricing_version,
		       cache_outcome
		FROM tenant_chat_usage_reservations
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
		  AND request_id = $4 AND turn_id = $5 AND idempotency_key = $6
		FOR UPDATE
	`, reservationID, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		requestContext.RequestID, requestContext.TurnID, requestContext.IdempotencyKey).Scan(
		&result.State, &result.UserPeriodStart, &result.TenantPeriodStart,
		&result.ReservedTokens, &result.ReservedCostMicroUSD, &result.LedgerVersion,
		&result.PricingVersion, &result.CacheOutcome,
	)
	return result, err
}

func lockAttempt(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	attemptNo int,
) (result settlementAttempt, err error) {
	err = tx.QueryRow(ctx, `
		SELECT input_micro_usd_per_million_tokens, output_micro_usd_per_million_tokens,
		       cache_read_input_micro_usd_per_million_tokens, completed_at
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $4::uuid
		FOR UPDATE
	`, requestContext.RequestID, attemptNo, reservationID, requestContext.ExecutionScope.TenantID).Scan(
		&result.InputPrice, &result.OutputPrice, &result.CacheReadPrice, &result.CompletedAt,
	)
	return result, err
}

func confirmedAttemptCost(attempt settlementAttempt, usage tenantchat.ConfirmedUsage) (int64, error) {
	if attempt.InputPrice < 0 || attempt.OutputPrice < 0 ||
		(attempt.CacheReadPrice != nil && (*attempt.CacheReadPrice < 0 || *attempt.CacheReadPrice > attempt.InputPrice)) {
		return 0, errors.New("invalid pinned settlement pricing")
	}
	if usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.CacheReadInputTokens < 0 ||
		usage.CacheReadInputTokens > usage.InputTokens {
		return 0, errors.New("invalid confirmed usage values")
	}
	regularInput := usage.InputTokens
	cacheRead := int64(0)
	cachePrice := attempt.InputPrice
	if attempt.CacheReadPrice != nil {
		regularInput -= usage.CacheReadInputTokens
		cacheRead = usage.CacheReadInputTokens
		cachePrice = *attempt.CacheReadPrice
	}
	regularCost, err := ceilMulDiv(regularInput, attempt.InputPrice, 1_000_000)
	if err != nil {
		return 0, err
	}
	cacheCost, err := ceilMulDiv(cacheRead, cachePrice, 1_000_000)
	if err != nil {
		return 0, err
	}
	outputCost, err := ceilMulDiv(usage.OutputTokens, attempt.OutputPrice, 1_000_000)
	if err != nil || regularCost > math.MaxInt64-cacheCost || regularCost+cacheCost > math.MaxInt64-outputCost {
		return 0, errors.New("confirmed cost overflow")
	}
	return regularCost + cacheCost + outputCost, nil
}

func readSettlementAttempts(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
) ([]tenantchat.ProviderAttempt, settlementTotals, bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT attempt_no, kind, provider_id, model_key, outcome, usage_quality,
		       confirmed_input_tokens, confirmed_output_tokens, confirmed_cost_micro_usd
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND reservation_id = $2::uuid AND tenant_id = $3::uuid
		ORDER BY attempt_no
	`, requestContext.RequestID, reservationID, requestContext.ExecutionScope.TenantID)
	if err != nil {
		return nil, settlementTotals{}, false, err
	}
	defer rows.Close()
	attempts := make([]tenantchat.ProviderAttempt, 0, 4)
	totals := settlementTotals{}
	hasPending := false
	for rows.Next() {
		var attempt tenantchat.ProviderAttempt
		if err := rows.Scan(
			&attempt.AttemptNo, &attempt.Kind, &attempt.ProviderID, &attempt.ModelKey,
			&attempt.Outcome, &attempt.UsageQuality, &attempt.InputTokens,
			&attempt.OutputTokens, &attempt.CostMicroUSD,
		); err != nil {
			return nil, settlementTotals{}, false, err
		}
		attempt.RequestID = requestContext.RequestID
		attempts = append(attempts, attempt)
		if attempt.UsageQuality == "confirmed" {
			totals.InputTokens += attempt.InputTokens
			totals.OutputTokens += attempt.OutputTokens
			totals.CostMicroUSD += attempt.CostMicroUSD
		} else if attempt.UsageQuality == "pending_unconfirmed" {
			hasPending = true
		}
	}
	if err := rows.Err(); err != nil {
		return nil, settlementTotals{}, false, errors.New("provider attempts are unavailable")
	}
	return attempts, totals, hasPending, nil
}

func lockSettlementPeriods(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservation settlementReservation,
) (tokenPeriod, costPeriod, error) {
	var userPeriod tokenPeriod
	err := tx.QueryRow(ctx, `
		SELECT period_start, period_end, period_timezone, limit_tokens,
		       warning_threshold_tokens, economy_threshold_tokens, hard_stop_tokens,
		       reserved_tokens, confirmed_total_tokens, unconfirmed_tokens, state
		FROM tenant_chat_user_token_periods
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
		FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		reservation.UserPeriodStart).Scan(
		&userPeriod.Start, &userPeriod.End, &userPeriod.Timezone, &userPeriod.Limit,
		&userPeriod.Warning, &userPeriod.Economy, &userPeriod.HardStop,
		&userPeriod.Reserved, &userPeriod.Confirmed, &userPeriod.Unconfirmed, &userPeriod.State,
	)
	if err != nil {
		return tokenPeriod{}, costPeriod{}, err
	}
	var tenantPeriod costPeriod
	err = tx.QueryRow(ctx, `
		SELECT period_start, period_end, period_timezone, limit_micro_usd,
		       warning_threshold_micro_usd, economy_threshold_micro_usd, hard_stop_micro_usd,
		       reserved_cost_micro_usd, confirmed_cost_micro_usd,
		       unconfirmed_exposure_micro_usd, state
		FROM tenant_chat_tenant_cost_periods
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
		FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, reservation.TenantPeriodStart).Scan(
		&tenantPeriod.Start, &tenantPeriod.End, &tenantPeriod.Timezone, &tenantPeriod.Limit,
		&tenantPeriod.Warning, &tenantPeriod.Economy, &tenantPeriod.HardStop,
		&tenantPeriod.Reserved, &tenantPeriod.Confirmed, &tenantPeriod.Unconfirmed, &tenantPeriod.State,
	)
	return userPeriod, tenantPeriod, err
}

func validAttemptOutcome(value string) bool {
	switch value {
	case "succeeded", "failed_pre_delta", "failed_post_delta", "cancelled", "timed_out":
		return true
	default:
		return false
	}
}

func readSettlement(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
) (tenantchat.UsageSettlement, error) {
	var result tenantchat.UsageSettlement
	err := tx.QueryRow(ctx, `
		SELECT reservation.request_id, reservation.reservation_id::text, reservation.state,
		       reservation.confirmed_input_tokens, reservation.confirmed_output_tokens,
		       reservation.confirmed_cost_micro_usd, reservation.unconfirmed_tokens,
		       reservation.unconfirmed_exposure_micro_usd, token_period.state,
		       cost_period.state, reservation.ledger_version, reservation.cache_outcome
		FROM tenant_chat_usage_reservations AS reservation
		JOIN tenant_chat_user_token_periods AS token_period
		  ON token_period.tenant_id = reservation.tenant_id
		 AND token_period.user_id = reservation.user_id
		 AND token_period.period_start = reservation.user_period_start
		JOIN tenant_chat_tenant_cost_periods AS cost_period
		  ON cost_period.tenant_id = reservation.tenant_id
		 AND cost_period.period_start = reservation.tenant_period_start
		 AND cost_period.currency = reservation.currency
		WHERE reservation.reservation_id = $1::uuid AND reservation.tenant_id = $2::uuid
	`, reservationID, requestContext.ExecutionScope.TenantID).Scan(
		&result.RequestID, &result.ReservationID, &result.State, &result.ConfirmedInputTokens,
		&result.ConfirmedOutputTokens, &result.ConfirmedCostMicroUSD, &result.UnconfirmedTokens,
		&result.UnconfirmedExposureMicroUSD, &result.QuotaState, &result.BudgetState,
		&result.LedgerVersion, &result.CacheOutcome,
	)
	return result, err
}

func settlementAttemptsPayload(attempts []tenantchat.ProviderAttempt) []map[string]any {
	result := make([]map[string]any, 0, len(attempts))
	for _, attempt := range attempts {
		result = append(result, map[string]any{
			"attemptNo": attempt.AttemptNo, "kind": attempt.Kind,
			"providerId": attempt.ProviderID, "modelKey": attempt.ModelKey,
			"outcome": attempt.Outcome, "usageQuality": attempt.UsageQuality,
			"inputTokens": attempt.InputTokens, "outputTokens": attempt.OutputTokens,
			"costMicroUsd": attempt.CostMicroUSD,
		})
	}
	return result
}

func settlementEventPayload(
	eventID string,
	reservationID string,
	eventVersion int64,
	requestContext tenantchat.RequestContext,
	reservation settlementReservation,
	userPeriod tokenPeriod,
	quotaState string,
	budgetState string,
	attempts []tenantchat.ProviderAttempt,
	totals settlementTotals,
	terminalOutcome string,
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
	payload := map[string]any{
		"eventId": eventID, "schemaVersion": 3, "eventType": "usage_settled", "eventVersion": eventVersion,
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
			"confirmedInputTokensDelta": totals.InputTokens, "confirmedOutputTokensDelta": totals.OutputTokens,
			"confirmedTotalTokensDelta": totals.InputTokens + totals.OutputTokens, "unconfirmedTokensDelta": 0,
		},
		"budget": map[string]any{
			"state": budgetState, "reservedCostMicroUsdDelta": -reservation.ReservedCostMicroUSD,
			"confirmedCostMicroUsdDelta": totals.CostMicroUSD, "unconfirmedExposureMicroUsdDelta": 0,
		},
		"attempts": settlementAttemptsPayload(attempts), "terminalOutcome": terminalOutcome,
	}
	if err := addRoutingDifficultyPayload(payload, requestContext); err != nil {
		return nil, err
	}
	if err := addSafetySummaryPayload(payload, requestContext.Safety); err != nil {
		return nil, err
	}
	appendTTFT(payload, requestContext)
	return json.Marshal(payload)
}

func appendTTFT(payload map[string]any, requestContext tenantchat.RequestContext) {
	if requestContext.TTFTMs != nil && *requestContext.TTFTMs >= 0 {
		payload["ttftMs"] = *requestContext.TTFTMs
	}
}
