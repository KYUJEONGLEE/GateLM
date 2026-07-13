package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ReservationStore struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewReservationStore(pool *pgxpool.Pool) *ReservationStore {
	return &ReservationStore{pool: pool, now: time.Now}
}

func (s *ReservationStore) ConsumeAndReserve(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
) (result tenantchat.UsageReservation, err error) {
	if s == nil || s.pool == nil || requestContext.UsageIntent == nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	now := s.now().UTC()
	actor := requestContext.ExecutionScope.Actor
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-user:"+requestContext.ExecutionScope.TenantID+":"+actor.UserID); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-cost:"+requestContext.ExecutionScope.TenantID); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}

	replay, found, replayErr := findReservationReplay(ctx, tx, requestContext)
	if replayErr != nil {
		if errors.Is(replayErr, tenantchat.ErrIdempotencyConflict) {
			return tenantchat.UsageReservation{}, replayErr
		}
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if found {
		if err = tx.Commit(ctx); err != nil {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
		return replay, nil
	}

	admissionState, admissionExpiry, err := lockAdmission(ctx, tx, requestContext)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.UsageReservation{}, tenantchat.ErrAdmissionExpired
		}
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if admissionState != "active" || !admissionExpiry.After(now) {
		return tenantchat.UsageReservation{}, tenantchat.ErrAdmissionExpired
	}

	userPeriod, err := ensureTokenPeriod(ctx, tx, requestContext, snapshot, now)
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	tenantPeriod, err := ensureCostPeriod(ctx, tx, requestContext, snapshot, now)
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if userPeriod.State == "blocked" {
		return tenantchat.UsageReservation{}, tenantchat.ErrQuotaHardLimit
	}
	if tenantPeriod.State == "blocked" {
		return tenantchat.UsageReservation{}, tenantchat.ErrBudgetHardLimit
	}

	route, err := selectRoute(snapshot, requestContext.UsageIntent.RequestedTier, userPeriod.State, tenantPeriod.State)
	if err != nil {
		return tenantchat.UsageReservation{}, err
	}
	reservedTokens := requestContext.UsageIntent.EstimatedInputTokens + requestContext.UsageIntent.MaxOutputTokens
	if reservedTokens < requestContext.UsageIntent.EstimatedInputTokens {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	reservedCost, err := reservationCost(
		requestContext.UsageIntent.EstimatedInputTokens,
		requestContext.UsageIntent.MaxOutputTokens,
		route.InputMicroUSDPerMillionTokens,
		route.OutputMicroUSDPerMillionTokens,
	)
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	projectedTokens := userPeriod.Confirmed + userPeriod.Unconfirmed + userPeriod.Reserved + reservedTokens
	if projectedTokens < reservedTokens || projectedTokens > userPeriod.HardStop {
		return tenantchat.UsageReservation{}, tenantchat.ErrQuotaHardLimit
	}
	projectedCost := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + tenantPeriod.Reserved + reservedCost
	if projectedCost < reservedCost || projectedCost > tenantPeriod.HardStop {
		return tenantchat.UsageReservation{}, tenantchat.ErrBudgetHardLimit
	}
	quotaState := usageState(projectedTokens, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(projectedCost, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)

	reservationID, err := newUUID()
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = persistReservation(
		ctx, tx, requestContext, snapshot, route, userPeriod, tenantPeriod,
		reservationID, eventID, reservedTokens, reservedCost, quotaState, budgetState, now,
	); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageReservation{
		ReservationID: reservationID, RequestID: requestContext.RequestID, State: "reserved",
		ReservedTokens: reservedTokens, ReservedCostMicroUSD: reservedCost,
		QuotaState: quotaState, BudgetState: budgetState, LedgerVersion: 1, Route: route,
	}, nil
}

func findReservationReplay(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) (tenantchat.UsageReservation, bool, error) {
	var result tenantchat.UsageReservation
	err := tx.QueryRow(ctx, `
		SELECT reservation_id::text, request_id, state, reserved_tokens,
		       reserved_cost_micro_usd, ledger_version
		FROM tenant_chat_usage_reservations
		WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND idempotency_key = $3
		FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID, requestContext.IdempotencyKey).Scan(
		&result.ReservationID, &result.RequestID, &result.State, &result.ReservedTokens,
		&result.ReservedCostMicroUSD, &result.LedgerVersion,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenantchat.UsageReservation{}, false, nil
	}
	if err != nil {
		return tenantchat.UsageReservation{}, false, err
	}
	if result.RequestID != requestContext.RequestID {
		return tenantchat.UsageReservation{}, false, tenantchat.ErrIdempotencyConflict
	}
	result.Replayed = true
	return result, true, nil
}

func lockAdmission(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) (string, time.Time, error) {
	var state string
	var expiresAt time.Time
	err := tx.QueryRow(ctx, `
		SELECT state, expires_at
		FROM tenant_chat_request_admissions
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
		  AND request_id = $4 AND turn_id = $5 AND idempotency_key = $6
		  AND snapshot_version = $7
		FOR UPDATE
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID,
		requestContext.ExecutionScope.Actor.UserID, requestContext.RequestID,
		requestContext.TurnID, requestContext.IdempotencyKey,
		requestContext.Snapshot.Version,
	).Scan(&state, &expiresAt)
	return state, expiresAt, err
}
