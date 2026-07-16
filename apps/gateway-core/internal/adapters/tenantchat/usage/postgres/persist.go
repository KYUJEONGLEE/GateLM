package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
)

func persistReservation(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	_ tenantchat.SelectedRoute,
	userPeriod tokenPeriod,
	tenantPeriod costPeriod,
	reservationID string,
	eventID string,
	reservedTokens int64,
	reservedCost int64,
	quotaState string,
	budgetState string,
	cacheOutcome string,
	now time.Time,
) error {
	actor := requestContext.ExecutionScope.Actor
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_user_token_periods
		SET reserved_tokens = reserved_tokens + $4, state = $5, version = version + 1, updated_at = $6
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND period_start = $3
	`, requestContext.ExecutionScope.TenantID, actor.UserID, userPeriod.Start, reservedTokens, quotaState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("update tenant chat token period")
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_tenant_cost_periods
		SET reserved_cost_micro_usd = reserved_cost_micro_usd + $3,
		    state = $4, version = version + 1, updated_at = $5
		WHERE tenant_id = $1::uuid AND period_start = $2 AND currency = 'USD'
	`, requestContext.ExecutionScope.TenantID, tenantPeriod.Start, reservedCost, budgetState, now)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("update tenant chat cost period")
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_reservations (
		  reservation_id, tenant_id, user_id, request_id, turn_id, idempotency_key,
		  user_period_start, tenant_period_start, currency,
		  snapshot_version, snapshot_digest, pricing_version, cache_outcome, state,
		  reserved_tokens, reserved_cost_micro_usd, ledger_version, reserved_at, created_at, updated_at
		) VALUES (
		  $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
		  $7, $8, 'USD', $9, $10, $11, $12, 'reserved',
		  $13, $14, 1, $15, $15, $15
		)
	`, reservationID, requestContext.ExecutionScope.TenantID, actor.UserID,
		requestContext.RequestID, requestContext.TurnID, requestContext.IdempotencyKey,
		userPeriod.Start, tenantPeriod.Start, requestContext.Snapshot.Version,
		requestContext.Snapshot.Digest, snapshot.Pricing.Version, cacheOutcome,
		reservedTokens, reservedCost, now)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_usage_ledger_entries (
		  request_id, ledger_version, event_id, reservation_id, tenant_id, event_type,
		  reserved_tokens_delta, reserved_cost_micro_usd_delta, occurred_at
		) VALUES ($1, 1, $2::uuid, $3::uuid, $4::uuid, 'usage_reserved', $5, $6, $7)
	`, requestContext.RequestID, eventID, reservationID, requestContext.ExecutionScope.TenantID,
		reservedTokens, reservedCost, now)
	if err != nil {
		return err
	}
	payload, err := reservationEventPayload(
		eventID, reservationID, requestContext, snapshot, userPeriod,
		quotaState, budgetState, reservedTokens, reservedCost, now,
		cacheOutcome,
	)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_invocation_outbox (
		  event_id, tenant_id, aggregate_id, event_type, event_version, payload, occurred_at, available_at
		) VALUES ($1::uuid, $2::uuid, $3, 'usage_reserved', 1, $4::jsonb, $5, $5)
	`, eventID, requestContext.ExecutionScope.TenantID, requestContext.RequestID, payload, now)
	if err != nil {
		return err
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_chat_request_admissions
		SET state = 'consumed', consumed_at = $3,
		    slot_released_at = COALESCE(slot_released_at, $3), updated_at = $3
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND state = 'active'
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID, now)
	if err != nil || tag.RowsAffected() != 1 {
		return errors.New("consume tenant chat admission")
	}
	return nil
}

func reservationEventPayload(
	eventID string,
	reservationID string,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	userPeriod tokenPeriod,
	quotaState string,
	budgetState string,
	reservedTokens int64,
	reservedCost int64,
	now time.Time,
	cacheOutcome string,
) ([]byte, error) {
	return usageDeltaEventPayload(
		"usage_reserved", eventID, reservationID, 1, requestContext, snapshot,
		userPeriod, quotaState, budgetState, reservedTokens, reservedCost, now,
		cacheOutcome,
	)
}

func usageDeltaEventPayload(
	eventType string,
	eventID string,
	reservationID string,
	eventVersion int64,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	userPeriod tokenPeriod,
	quotaState string,
	budgetState string,
	reservedTokensDelta int64,
	reservedCostDelta int64,
	now time.Time,
	cacheOutcome string,
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
		"eventId": eventID, "schemaVersion": 3, "eventType": eventType, "eventVersion": eventVersion,
		"occurredAt": now.Format(time.RFC3339Nano), "aggregateId": requestContext.RequestID,
		"requestId": requestContext.RequestID, "turnId": requestContext.TurnID,
		"idempotencyKey": requestContext.IdempotencyKey, "reservationId": reservationID,
		"executionScope": executionScope,
		"period": map[string]any{
			"start": userPeriod.Start.Format(time.RFC3339Nano), "end": userPeriod.End.Format(time.RFC3339Nano),
			"timezone": userPeriod.Timezone, "currency": "USD",
		},
		"snapshotVersion": requestContext.Snapshot.Version, "pricingVersion": snapshot.Pricing.Version,
		"cacheOutcome": cacheOutcome,
		"quota": map[string]any{
			"state": quotaState, "reservedTokensDelta": reservedTokensDelta,
			"confirmedInputTokensDelta": 0, "confirmedOutputTokensDelta": 0,
			"confirmedTotalTokensDelta": 0, "unconfirmedTokensDelta": 0,
		},
		"budget": map[string]any{
			"state": budgetState, "reservedCostMicroUsdDelta": reservedCostDelta,
			"confirmedCostMicroUsdDelta": 0, "unconfirmedExposureMicroUsdDelta": 0,
		},
		"attempts": []any{},
	}
	return json.Marshal(payload)
}

func reservationCacheOutcome(
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
) string {
	if snapshot.Policies.Cache.Enabled && snapshot.Policies.Cache.Strategy == "exact" &&
		requestContext.UsageIntent != nil && requestContext.UsageIntent.CacheStrategy == "exact" {
		return "miss"
	}
	return "off"
}
