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

func (s *ReservationStore) FinalizeLedgerless(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	terminalOutcome string,
	errorCode string,
	cacheOutcome string,
) (replayed bool, err error) {
	started := time.Now()
	defer s.observeTransaction("finalize_ledgerless", started)
	if s == nil || s.pool == nil || !validLedgerlessOutcome(terminalOutcome, errorCode, cacheOutcome) {
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
	now := s.now().UTC()
	state, expiresAt, err := lockAdmission(ctx, tx, requestContext)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, tenantchat.ErrAdmissionExpired
		}
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if state == "consumed" {
		var count int
		if err = tx.QueryRow(ctx, `
			SELECT count(*) FROM tenant_chat_invocation_outbox
			WHERE tenant_id = $1::uuid AND aggregate_id = $2
			  AND event_type = 'invocation_terminal' AND event_version = 1
			  AND payload->>'terminalOutcome' = $3
			  AND COALESCE(payload->>'errorCode', '') = $4
			  AND payload->>'cacheOutcome' = $5
		`, requestContext.ExecutionScope.TenantID, requestContext.RequestID,
			terminalOutcome, errorCode, cacheOutcome).Scan(&count); err != nil || count != 1 {
			return false, tenantchat.ErrIdempotencyConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return false, tenantchat.ErrUsageGuardUnavailable
		}
		return true, nil
	}
	if state != "active" || !expiresAt.After(now) {
		return false, tenantchat.ErrAdmissionExpired
	}
	eventID, err := newUUID()
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	payload, err := ledgerlessTerminalPayload(
		eventID, requestContext, snapshot, terminalOutcome, errorCode, cacheOutcome, now,
	)
	if err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO tenant_chat_invocation_outbox (
		  event_id, tenant_id, aggregate_id, event_type, event_version,
		  payload, occurred_at, available_at
		) VALUES ($1::uuid, $2::uuid, $3, 'invocation_terminal', 1, $4::jsonb, $5, $5)
	`, eventID, requestContext.ExecutionScope.TenantID, requestContext.RequestID, payload, now); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_chat_request_admissions
		SET state = 'consumed', consumed_at = $3,
		    slot_released_at = COALESCE(slot_released_at, $3), updated_at = $3
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND state = 'active'
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID, now)
	if err != nil || tag.RowsAffected() != 1 {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return false, tenantchat.ErrUsageGuardUnavailable
	}
	return false, nil
}

func ledgerlessTerminalPayload(
	eventID string,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	terminalOutcome string,
	errorCode string,
	cacheOutcome string,
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
		"eventId": eventID, "schemaVersion": 2, "eventType": "invocation_terminal", "eventVersion": 1,
		"occurredAt": now.Format(time.RFC3339Nano), "aggregateId": requestContext.RequestID,
		"requestId": requestContext.RequestID, "turnId": requestContext.TurnID,
		"idempotencyKey": requestContext.IdempotencyKey, "executionScope": executionScope,
		"snapshotVersion": requestContext.Snapshot.Version, "pricingVersion": snapshot.Pricing.Version,
		"terminalOutcome": terminalOutcome, "quotaState": "normal", "budgetState": "normal",
		"cacheOutcome": cacheOutcome, "latencyMs": 0,
	}
	if errorCode != "" {
		payload["errorCode"] = errorCode
	}
	return json.Marshal(payload)
}

func validLedgerlessOutcome(terminalOutcome string, errorCode string, cacheOutcome string) bool {
	if cacheOutcome != "off" && cacheOutcome != "hit" && cacheOutcome != "miss" {
		return false
	}
	switch terminalOutcome {
	case "safety_blocked":
		return errorCode == "CHAT_SAFETY_BLOCKED"
	case "cache_hit":
		return errorCode == "" && cacheOutcome == "hit"
	default:
		return false
	}
}
