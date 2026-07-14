package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
)

func (s *ReservationStore) StartAttempt(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	reservationID string,
	route tenantchat.SelectedRoute,
	attemptNo int,
	kind string,
) (err error) {
	if s == nil || s.pool == nil || requestContext.UsageIntent == nil ||
		attemptNo < 1 || attemptNo > 4 || (kind != "primary" && kind != "fallback") ||
		(kind == "primary" && attemptNo != 1) {
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

	now := s.now().UTC()
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-user:"+requestContext.ExecutionScope.TenantID+":"+requestContext.ExecutionScope.Actor.UserID); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-cost:"+requestContext.ExecutionScope.TenantID); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}

	var reservationState string
	var storedRequestID string
	var storedSnapshotVersion int64
	var ledgerVersion int64
	err = tx.QueryRow(ctx, `
		SELECT state, request_id, snapshot_version, ledger_version
		FROM tenant_chat_usage_reservations
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
		FOR UPDATE
	`, reservationID, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID).Scan(
		&reservationState, &storedRequestID, &storedSnapshotVersion, &ledgerVersion,
	)
	if err != nil || reservationState != "reserved" || storedRequestID != requestContext.RequestID ||
		storedSnapshotVersion != requestContext.Snapshot.Version {
		return tenantchat.ErrUsageGuardUnavailable
	}

	var existingKind string
	var existingProvider string
	var existingModel string
	err = tx.QueryRow(ctx, `
		SELECT kind, provider_id, model_key
		FROM tenant_chat_provider_attempts
		WHERE request_id = $1 AND attempt_no = $2
		  AND reservation_id = $3::uuid AND tenant_id = $4::uuid
	`, requestContext.RequestID, attemptNo, reservationID, requestContext.ExecutionScope.TenantID).Scan(
		&existingKind,
		&existingProvider,
		&existingModel,
	)
	if err == nil {
		if existingKind != kind || existingProvider != route.ProviderID || existingModel != route.ModelKey {
			return tenantchat.ErrIdempotencyConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.ErrUsageGuardUnavailable
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return tenantchat.ErrUsageGuardUnavailable
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
	if kind == "fallback" {
		if err = s.topUpFallback(
			ctx, tx, requestContext, snapshot, reservationID, ledgerVersion,
			exposureCost, now,
		); err != nil {
			return err
		}
	}

	if err = insertAttemptRow(
		ctx, tx, requestContext, reservationID, route, attemptNo, kind, exposureCost, now,
	); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return nil
}

func insertAttemptRow(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	reservationID string,
	route tenantchat.SelectedRoute,
	attemptNo int,
	kind string,
	exposureCost int64,
	now time.Time,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO tenant_chat_provider_attempts (
		  request_id, attempt_no, reservation_id, tenant_id, kind, provider_id, model_key,
		  pricing_version, input_micro_usd_per_million_tokens,
		  output_micro_usd_per_million_tokens, cache_read_input_micro_usd_per_million_tokens,
		  estimated_input_tokens, max_output_tokens, reserved_cost_micro_usd,
		  usage_quality, started_at, created_at, updated_at
		) VALUES (
		  $1, $2, $3::uuid, $4::uuid, $5, $6, $7,
		  $8, $9, $10, $11, $12, $13, $14, 'not_available', $15, $15, $15
		)
	`, requestContext.RequestID, attemptNo, reservationID, requestContext.ExecutionScope.TenantID,
		kind, route.ProviderID, route.ModelKey, route.PricingVersion,
		route.InputMicroUSDPerMillionTokens, route.OutputMicroUSDPerMillionTokens,
		route.CacheReadInputMicroUSDPerMillionTokens,
		requestContext.UsageIntent.EstimatedInputTokens, requestContext.UsageIntent.MaxOutputTokens,
		exposureCost, now)
	return err
}

func (s *ReservationStore) topUpFallback(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	reservationID string,
	ledgerVersion int64,
	exposureCost int64,
	now time.Time,
) error {
	additionalTokens := requestContext.UsageIntent.EstimatedInputTokens + requestContext.UsageIntent.MaxOutputTokens
	userPeriod, err := findTokenPeriod(ctx, tx, requestContext, now)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	tenantPeriod, err := findCostPeriod(ctx, tx, requestContext, now)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	projectedTokens := userPeriod.Confirmed + userPeriod.Unconfirmed + userPeriod.Reserved + additionalTokens
	if projectedTokens < additionalTokens || projectedTokens > userPeriod.HardStop {
		return tenantchat.ErrQuotaHardLimit
	}
	projectedCost := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + tenantPeriod.Reserved + exposureCost
	if projectedCost < exposureCost || projectedCost > tenantPeriod.HardStop {
		return tenantchat.ErrBudgetHardLimit
	}
	quotaState := usageState(projectedTokens, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(projectedCost, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	nextVersion := ledgerVersion + 1
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}

	if _, err = tx.Exec(ctx, `
		UPDATE tenant_chat_user_token_periods
		SET reserved_tokens = reserved_tokens + $4, state = $5, version = version + 1, updated_at = $6
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID,
		userPeriod.Start, additionalTokens, quotaState, now); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `
		UPDATE tenant_chat_tenant_cost_periods
		SET reserved_cost_micro_usd = reserved_cost_micro_usd + $3,
		    state = $4, version = version + 1, updated_at = $5
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
	`, requestContext.ExecutionScope.TenantID, tenantPeriod.Start, exposureCost, budgetState, now); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `
		UPDATE tenant_chat_usage_reservations
		SET reserved_tokens = reserved_tokens + $3,
		    reserved_cost_micro_usd = reserved_cost_micro_usd + $4,
		    ledger_version = $5, updated_at = $6
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND state = 'reserved'
	`, reservationID, requestContext.ExecutionScope.TenantID, additionalTokens, exposureCost, nextVersion, now); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_ledger_entries (
		  request_id, ledger_version, event_id, reservation_id, tenant_id, event_type,
		  reserved_tokens_delta, reserved_cost_micro_usd_delta, occurred_at
		) VALUES ($1, $2, $3::uuid, $4::uuid, $5::uuid, 'usage_topped_up', $6, $7, $8)
	`, requestContext.RequestID, nextVersion, eventID, reservationID,
		requestContext.ExecutionScope.TenantID, additionalTokens, exposureCost, now); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	payload, err := usageDeltaEventPayload(
		"usage_topped_up", eventID, reservationID, nextVersion, requestContext, snapshot,
		userPeriod, quotaState, budgetState, additionalTokens, exposureCost, now,
	)
	if err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_invocation_outbox (
		  event_id, tenant_id, aggregate_id, event_type, event_version, payload, occurred_at, available_at
		) VALUES ($1::uuid, $2::uuid, $3, 'usage_topped_up', $4, $5::jsonb, $6, $6)
	`, eventID, requestContext.ExecutionScope.TenantID, requestContext.RequestID, nextVersion, payload, now); err != nil {
		return tenantchat.ErrUsageGuardUnavailable
	}
	return nil
}
