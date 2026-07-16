package postgres

import (
	"context"
	"errors"
	"time"

	employeepostgres "gatelm/apps/gateway-core/internal/adapters/employeecost/postgres"
	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
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
) (restricted bool, err error) {
	started := time.Now()
	defer s.observeTransaction("begin_fallback", started)
	if s == nil || s.pool == nil || requestContext.UsageIntent == nil ||
		previousAttemptNo < 1 || previousAttemptNo > 3 || attemptNo != previousAttemptNo+1 || attemptNo > 4 ||
		!validAttemptOutcome(previousOutcome) || previousUsage.InputTokens < 0 ||
		previousUsage.OutputTokens < 0 || previousUsage.CacheReadInputTokens < 0 ||
		previousUsage.CacheReadInputTokens > previousUsage.InputTokens {
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
	if err = lockUsageActors(ctx, tx, requestContext); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	reservation, err := lockReservationForSettlement(ctx, tx, requestContext, reservationID)
	if err != nil || reservation.State != "reserved" {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	now := s.now().UTC()
	streamDuration, durationErr := snapshot.Policies.Streaming.Duration()
	if durationErr != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	dispatchIntentExpiresAt := now.Add(streamDuration)
	if err = recordConfirmedAttemptNativeTx(
		ctx, tx, now, requestContext, reservationID, previousAttemptNo, previousUsage, previousOutcome,
	); err != nil {
		return false, err
	}
	exposureCost, err := reservationCost(
		requestContext.UsageIntent.EstimatedInputTokens,
		requestContext.UsageIntent.MaxOutputTokens,
		route.InputMicroUSDPerMillionTokens,
		route.OutputMicroUSDPerMillionTokens,
	)
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	nativeReplayed, err := lockFallbackAttemptReplay(
		ctx, tx, requestContext, reservationID, route, attemptNo, exposureCost,
	)
	if err != nil {
		return false, err
	}
	if nativeReplayed {
		if err = s.replayEmployeeFallback(
			ctx, tx, requestContext, reservationID, reservation.LedgerVersion,
			previousAttemptNo, previousUsage, previousOutcome, route, attemptNo,
			dispatchIntentExpiresAt, now,
		); err != nil {
			return false, err
		}
		if err = markNativeDispatchIntent(
			ctx, tx, requestContext, reservationID, dispatchIntentExpiresAt, now,
		); err != nil {
			return false, err
		}
		if err = tx.Commit(ctx); err != nil {
			return false, tenantchat.ErrUsageGuardUnavailable
		}
		return false, nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET usage_pending_at = NULL, updated_at = $4
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND request_id = $3 AND state = 'reserved'
	`, reservationID, requestContext.ExecutionScope.TenantID, requestContext.RequestID, now)
	if err != nil || tag.RowsAffected() != 1 {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if err = s.topUpFallback(
		ctx, tx, requestContext, snapshot, reservationID, reservation.LedgerVersion,
		exposureCost, reservation.CacheOutcome, now,
	); err != nil {
		return false, err
	}
	employeeID := employeeCostEmployeeID(requestContext)
	if employeeID != "" {
		if s.employeeCosts == nil {
			return false, tenantchat.ErrUsageGuardUnavailable
		}
		pricing := employeeCostPricing(requestContext, route)
		topUp, topUpErr := s.employeeCosts.TopUpAttempt(ctx, tx, employeepostgres.TopUpAttemptInput{
			TenantID:      requestContext.ExecutionScope.TenantID,
			EmployeeID:    employeeID,
			Surface:       employeecost.SurfaceTenantChat,
			RequestID:     requestContext.RequestID,
			ReservationID: reservationID,
			CandidateTier: route.Tier,
			Attempt: employeepostgres.AttemptInput{
				AttemptNo:  attemptNo,
				Kind:       employeecost.AttemptKindFallback,
				ProviderID: route.ProviderID,
				ModelKey:   route.ModelKey,
				Pricing:    pricing,
			},
			DispatchIntentExpiresAt: dispatchIntentExpiresAt,
			Now:                     now,
		})
		if topUpErr != nil {
			return false, employeeCostAdapterError(topUpErr)
		}
		if topUp.GuardUnavailable || topUp.Replayed {
			return false, tenantchat.ErrUsageGuardUnavailable
		}
		if topUp.RestrictHighCost {
			if route.Tier != employeecost.TenantChatRouteTierHighQuality {
				return false, tenantchat.ErrUsageGuardUnavailable
			}
			if rollbackErr := tx.Rollback(ctx); rollbackErr != nil {
				return false, tenantchat.ErrUsageGuardUnavailable
			}
			return true, nil
		}
		if topUp.Applied && topUp.LedgerVersion != reservation.LedgerVersion+1 {
			return false, tenantchat.ErrUsageGuardUnavailable
		}
		if err = s.recordEmployeeConfirmedAttempt(
			ctx, tx, requestContext, reservationID, previousAttemptNo, previousUsage, previousOutcome,
		); err != nil {
			return false, err
		}
	}
	if err = insertAttemptRow(
		ctx, tx, requestContext, reservationID, route, attemptNo, "fallback", exposureCost, now,
	); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if err = markNativeDispatchIntent(
		ctx, tx, requestContext, reservationID, dispatchIntentExpiresAt, now,
	); err != nil {
		return false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	return false, nil
}

func lockFallbackAttemptReplay(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	route tenantchat.SelectedRoute,
	attemptNo int,
	exposureCost int64,
) (bool, error) {
	var kind string
	var providerID string
	var modelKey string
	var pricingVersion int64
	var inputRate int64
	var outputRate int64
	var cacheReadRate *int64
	var estimatedInputTokens int64
	var maxOutputTokens int64
	var reservedCost int64
	err := tx.QueryRow(ctx, `
		SELECT kind, provider_id, model_key, pricing_version,
		       input_micro_usd_per_million_tokens,
		       output_micro_usd_per_million_tokens,
		       cache_read_input_micro_usd_per_million_tokens,
		       estimated_input_tokens, max_output_tokens, reserved_cost_micro_usd
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $4::uuid
		FOR UPDATE
	`, requestContext.RequestID, attemptNo, reservationID,
		requestContext.ExecutionScope.TenantID).Scan(
		&kind, &providerID, &modelKey, &pricingVersion,
		&inputRate, &outputRate, &cacheReadRate,
		&estimatedInputTokens, &maxOutputTokens, &reservedCost,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if kind != "fallback" || providerID != route.ProviderID || modelKey != route.ModelKey ||
		pricingVersion != route.PricingVersion ||
		inputRate != route.InputMicroUSDPerMillionTokens ||
		outputRate != route.OutputMicroUSDPerMillionTokens ||
		!sameOptionalRate(cacheReadRate, route.CacheReadInputMicroUSDPerMillionTokens) ||
		estimatedInputTokens != requestContext.UsageIntent.EstimatedInputTokens ||
		maxOutputTokens != requestContext.UsageIntent.MaxOutputTokens ||
		reservedCost != exposureCost {
		return false, tenantchat.ErrIdempotencyConflict
	}
	return true, nil
}

func sameOptionalRate(left *int64, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func (s *ReservationStore) replayEmployeeFallback(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	ledgerVersion int64,
	previousAttemptNo int,
	previousUsage tenantchat.ConfirmedUsage,
	previousOutcome string,
	route tenantchat.SelectedRoute,
	attemptNo int,
	dispatchIntentExpiresAt time.Time,
	now time.Time,
) error {
	employeeID := employeeCostEmployeeID(requestContext)
	if employeeID == "" {
		return nil
	}
	if s.employeeCosts == nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	topUp, err := s.employeeCosts.TopUpAttempt(ctx, tx, employeepostgres.TopUpAttemptInput{
		TenantID:      requestContext.ExecutionScope.TenantID,
		EmployeeID:    employeeID,
		Surface:       employeecost.SurfaceTenantChat,
		RequestID:     requestContext.RequestID,
		ReservationID: reservationID,
		CandidateTier: route.Tier,
		Attempt: employeepostgres.AttemptInput{
			AttemptNo: attemptNo, Kind: employeecost.AttemptKindFallback,
			ProviderID: route.ProviderID, ModelKey: route.ModelKey,
			Pricing: employeeCostPricing(requestContext, route),
		},
		DispatchIntentExpiresAt: dispatchIntentExpiresAt,
		Now:                     now,
	})
	if err != nil {
		return employeeCostAdapterError(err)
	}
	if topUp.GuardUnavailable || topUp.RestrictHighCost ||
		(topUp.Applied && (!topUp.Replayed || topUp.LedgerVersion != ledgerVersion)) {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return s.recordEmployeeConfirmedAttempt(
		ctx, tx, requestContext, reservationID,
		previousAttemptNo, previousUsage, previousOutcome,
	)
}
