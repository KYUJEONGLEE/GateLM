package postgres

import (
	"context"
	"errors"
	"strconv"
	"time"

	employeepostgres "gatelm/apps/gateway-core/internal/adapters/employeecost/postgres"
	"gatelm/apps/gateway-core/internal/domain/employeecost"
	"gatelm/apps/gateway-core/internal/domain/metrics"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ReservationStore struct {
	pool          *pgxpool.Pool
	now           func() time.Time
	metrics       *metrics.Registry
	employeeCosts *employeepostgres.Store
}

func (s *ReservationStore) WithMetrics(registry *metrics.Registry) *ReservationStore {
	if s != nil {
		s.metrics = registry
	}
	return s
}

func (s *ReservationStore) observeTransaction(transition string, started time.Time) {
	if s == nil || s.metrics == nil {
		return
	}
	s.metrics.ObserveHistogram(
		metrics.TenantChatAccountingTransactionSeconds,
		[]metrics.Label{{Name: "transition", Value: transition}},
		time.Since(started).Seconds(),
	)
}

func NewReservationStore(pool *pgxpool.Pool) *ReservationStore {
	return &ReservationStore{pool: pool, now: time.Now, employeeCosts: employeepostgres.NewStore()}
}

func (s *ReservationStore) ConsumeAndReserve(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
) (tenantchat.UsageReservation, error) {
	return s.consumeAndReserve(ctx, requestContext, snapshot, false)
}

func (s *ReservationStore) BeginExecution(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
) (tenantchat.UsageReservation, error) {
	started := time.Now()
	defer s.observeTransaction("begin_execution", started)
	return s.consumeAndReserve(ctx, requestContext, snapshot, true)
}

// commitUsageGuardRejection preserves an active Snapshot policy that was
// synchronized into a current period before the request was rejected. Without
// this commit, a newly published zero limit would be rolled back together with
// the rejected request and the next request could observe the stale policy.
func commitUsageGuardRejection(
	ctx context.Context,
	tx pgx.Tx,
	rejection error,
) (tenantchat.UsageReservation, error) {
	if err := tx.Commit(ctx); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageReservation{}, rejection
}

func (s *ReservationStore) consumeAndReserve(
	ctx context.Context,
	requestContext tenantchat.RequestContext,
	snapshot tenantruntime.Snapshot,
	startPrimary bool,
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
	streamDuration, durationErr := snapshot.Policies.Streaming.Duration()
	if durationErr != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	dispatchIntentExpiresAt := now.Add(streamDuration)
	actor := requestContext.ExecutionScope.Actor
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-user:"+requestContext.ExecutionScope.TenantID+":"+actor.UserID); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"tenant-chat-cost:"+requestContext.ExecutionScope.TenantID); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if actor.ActorKind == "employee" && actor.EmployeeID != "" {
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
			"tenant-chat-employee-week:"+requestContext.ExecutionScope.TenantID+":"+actor.EmployeeID); err != nil {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
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

	admission, err := lockAdmission(ctx, tx, requestContext)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantchat.UsageReservation{}, tenantchat.ErrAdmissionExpired
		}
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if admission.State != "active" || !admission.ExpiresAt.After(now) {
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
		return commitUsageGuardRejection(ctx, tx, tenantchat.ErrQuotaHardLimit)
	}
	if tenantPeriod.State == "blocked" {
		return commitUsageGuardRejection(ctx, tx, tenantchat.ErrBudgetHardLimit)
	}
	employeeWeeklyPeriod, err := ensureEmployeeWeeklyTokenPeriod(ctx, tx, requestContext, snapshot, now)
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if employeeWeeklyPeriod != nil && employeeWeeklyPeriod.State == "blocked" {
		return commitUsageGuardRejection(ctx, tx, tenantchat.ErrEmployeeWeeklyTokenQuotaHardLimit)
	}

	route, err := selectExecutionRoute(snapshot, requestContext, userPeriod.State, tenantPeriod.State)
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
		return commitUsageGuardRejection(ctx, tx, tenantchat.ErrQuotaHardLimit)
	}
	if employeeWeeklyPeriod != nil {
		projectedEmployeeTokens := employeeWeeklyPeriod.Confirmed + employeeWeeklyPeriod.Unconfirmed + employeeWeeklyPeriod.Reserved + reservedTokens
		if projectedEmployeeTokens < reservedTokens || projectedEmployeeTokens > employeeWeeklyPeriod.HardStop {
			return commitUsageGuardRejection(ctx, tx, tenantchat.ErrEmployeeWeeklyTokenQuotaHardLimit)
		}
	}
	projectedCost := tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + tenantPeriod.Reserved + reservedCost
	if projectedCost < reservedCost || projectedCost > tenantPeriod.HardStop {
		return commitUsageGuardRejection(ctx, tx, tenantchat.ErrBudgetHardLimit)
	}
	quotaState := usageState(projectedTokens, userPeriod.Warning, userPeriod.Economy, userPeriod.HardStop)
	budgetState := usageState(projectedCost, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
	cacheOutcome := reservationCacheOutcome(requestContext, snapshot)

	reservationID, err := newUUID()
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	employeeReservation, employeeErr := s.reserveEmployeeCost(
		ctx, tx, requestContext, route, reservationID, now,
		dispatchIntentExpiresAt, startPrimary, false,
	)
	if employeeErr != nil {
		return tenantchat.UsageReservation{}, employeeErr
	}
	if employeeReservation.GuardUnavailable {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if employeeReservation.Replayed {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if employeeReservation.RestrictHighCost {
		if route.Tier != employeecost.TenantChatRouteTierHighQuality {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
		route, err = selectRoute(
			snapshot, employeecost.TenantChatRouteTierStandard, userPeriod.State, tenantPeriod.State,
		)
		if err != nil {
			return tenantchat.UsageReservation{}, err
		}
		reservedCost, err = reservationCost(
			requestContext.UsageIntent.EstimatedInputTokens,
			requestContext.UsageIntent.MaxOutputTokens,
			route.InputMicroUSDPerMillionTokens,
			route.OutputMicroUSDPerMillionTokens,
		)
		if err != nil {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
		projectedCost = tenantPeriod.Confirmed + tenantPeriod.Unconfirmed + tenantPeriod.Reserved + reservedCost
		if projectedCost < reservedCost || projectedCost > tenantPeriod.HardStop {
			return tenantchat.UsageReservation{}, tenantchat.ErrBudgetHardLimit
		}
		budgetState = usageState(projectedCost, tenantPeriod.Warning, tenantPeriod.Economy, tenantPeriod.HardStop)
		employeeReservation, employeeErr = s.reserveEmployeeCost(
			ctx, tx, requestContext, route, reservationID, now,
			dispatchIntentExpiresAt, startPrimary, true,
		)
		if employeeErr != nil {
			return tenantchat.UsageReservation{}, employeeErr
		}
		if employeeReservation.GuardUnavailable || employeeReservation.RestrictHighCost || employeeReservation.Replayed {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
	}
	if employeeReservation.Applied && employeeReservation.LedgerVersion != 1 {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	eventID, err := newUUID()
	if err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if err = persistReservation(
		ctx, tx, requestContext, snapshot, route, userPeriod, tenantPeriod, employeeWeeklyPeriod,
		reservationID, eventID, reservedTokens, reservedCost, quotaState, budgetState, cacheOutcome, now,
	); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	if startPrimary {
		if err = insertAttemptRow(
			ctx, tx, requestContext, reservationID, route, 1, "primary", reservedCost, now,
		); err != nil {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
		if err = markNativeDispatchIntent(
			ctx, tx, requestContext, reservationID, dispatchIntentExpiresAt, now,
		); err != nil {
			return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return tenantchat.UsageReservation{}, tenantchat.ErrUsageGuardUnavailable
	}
	return tenantchat.UsageReservation{
		ReservationID: reservationID, RequestID: requestContext.RequestID, State: "reserved",
		ReservedTokens: reservedTokens, ReservedCostMicroUSD: reservedCost,
		QuotaState: quotaState, BudgetState: budgetState, LedgerVersion: 1,
		CacheOutcome: cacheOutcome, Route: route, Safety: tenantchat.CloneSafetySummary(admission.Safety),
	}, nil
}

func (s *ReservationStore) reserveEmployeeCost(
	ctx context.Context,
	tx pgx.Tx,
	requestContext tenantchat.RequestContext,
	route tenantchat.SelectedRoute,
	reservationID string,
	now time.Time,
	dispatchIntentExpiresAt time.Time,
	startPrimary bool,
	restrictedFromHigh bool,
) (employeepostgres.ReserveResult, error) {
	// Tenant Chat employee cost enforcement was retired in favour of the
	// snapshot-bound weekly token ledger. The legacy cross-surface cost tables
	// are intentionally retained for audit/history but are not read or written
	// by new Tenant Chat execution.
	if employeeCostEmployeeID(requestContext) == "" {
		return employeepostgres.ReserveResult{}, nil
	}
	if s == nil || s.employeeCosts == nil {
		return employeepostgres.ReserveResult{}, tenantchat.ErrUsageGuardUnavailable
	}
	pricing := employeeCostPricing(requestContext, route)
	var primaryAttempt *employeepostgres.AttemptInput
	if startPrimary {
		primaryAttempt = &employeepostgres.AttemptInput{
			AttemptNo:  1,
			Kind:       employeecost.AttemptKindPrimary,
			ProviderID: route.ProviderID,
			ModelKey:   route.ModelKey,
			Pricing:    pricing,
		}
	}
	var employeeDispatchIntentExpiresAt time.Time
	if startPrimary {
		employeeDispatchIntentExpiresAt = dispatchIntentExpiresAt
	}
	result, err := s.employeeCosts.Reserve(ctx, tx, employeepostgres.ReserveInput{
		TenantID:                requestContext.ExecutionScope.TenantID,
		EmployeeID:              employeeCostEmployeeID(requestContext),
		Surface:                 employeecost.SurfaceTenantChat,
		RequestID:               requestContext.RequestID,
		ReservationID:           reservationID,
		CandidateTier:           route.Tier,
		RestrictedFromHigh:      restrictedFromHigh,
		Pricing:                 pricing,
		PrimaryAttempt:          primaryAttempt,
		DispatchIntentExpiresAt: employeeDispatchIntentExpiresAt,
		Now:                     now,
	})
	if err != nil {
		return employeepostgres.ReserveResult{}, employeeCostAdapterError(err)
	}
	return result, nil
}

func employeeCostEmployeeID(requestContext tenantchat.RequestContext) string {
	return ""
}

func employeeCostAdapterError(err error) error {
	if errors.Is(err, employeepostgres.ErrIdempotencyConflict) {
		return tenantchat.ErrIdempotencyConflict
	}
	return tenantchat.ErrUsageGuardUnavailable
}

func employeeCostPricing(
	requestContext tenantchat.RequestContext,
	route tenantchat.SelectedRoute,
) employeecost.PricingPin {
	return employeecost.PricingPin{
		RuleID:                           route.RouteID,
		Version:                          strconv.FormatInt(route.PricingVersion, 10),
		Currency:                         employeecost.CurrencyUSD,
		InputMicroUSDPerMillion:          route.InputMicroUSDPerMillionTokens,
		OutputMicroUSDPerMillion:         route.OutputMicroUSDPerMillionTokens,
		CacheReadInputMicroUSDPerMillion: route.CacheReadInputMicroUSDPerMillionTokens,
		EstimateVersion:                  "utf8_message_bytes_v1",
		EstimatedInputTokens:             requestContext.UsageIntent.EstimatedInputTokens,
		MaxOutputTokens:                  requestContext.UsageIntent.MaxOutputTokens,
	}
}

func findReservationReplay(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) (tenantchat.UsageReservation, bool, error) {
	var result tenantchat.UsageReservation
	row := tx.QueryRow(ctx, `
		SELECT reservation.reservation_id::text, reservation.request_id, reservation.state,
		       reservation.reserved_tokens, reservation.reserved_cost_micro_usd,
		       reservation.ledger_version, reservation.cache_outcome,
		       admission.masking_action, admission.masking_detected_types::text,
		       admission.masking_detected_count, admission.safety_policy_digest
		FROM tenant_chat_usage_reservations reservation
		JOIN tenant_chat_request_admissions admission
		  ON admission.tenant_id = reservation.tenant_id
		 AND admission.user_id = reservation.user_id
		 AND admission.request_id = reservation.request_id
		WHERE reservation.tenant_id = $1::uuid AND reservation.user_id = $2::uuid
		  AND reservation.idempotency_key = $3
		FOR UPDATE
	`, requestContext.ExecutionScope.TenantID, requestContext.ExecutionScope.Actor.UserID, requestContext.IdempotencyKey)
	var action, detectedTypesJSON, policyDigest *string
	var detectedCount *int
	err := row.Scan(
		&result.ReservationID, &result.RequestID, &result.State, &result.ReservedTokens,
		&result.ReservedCostMicroUSD, &result.LedgerVersion, &result.CacheOutcome,
		&action, &detectedTypesJSON, &detectedCount, &policyDigest,
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
	result.Safety, err = safetySummaryFromColumns(action, detectedTypesJSON, detectedCount, policyDigest)
	if err != nil {
		return tenantchat.UsageReservation{}, false, err
	}
	result.Replayed = true
	return result, true, nil
}

func lockAdmission(ctx context.Context, tx pgx.Tx, requestContext tenantchat.RequestContext) (admissionRecord, error) {
	var result admissionRecord
	var action, detectedTypesJSON, policyDigest *string
	var detectedCount *int
	err := tx.QueryRow(ctx, `
		SELECT state, expires_at, created_at, masking_action, masking_detected_types::text,
		       masking_detected_count, safety_policy_digest
		FROM tenant_chat_request_admissions
		WHERE admission_id = $1::uuid AND tenant_id = $2::uuid AND user_id = $3::uuid
		  AND request_id = $4 AND turn_id = $5 AND idempotency_key = $6
		  AND snapshot_version = $7
		FOR UPDATE
	`, requestContext.AdmissionID, requestContext.ExecutionScope.TenantID,
		requestContext.ExecutionScope.Actor.UserID, requestContext.RequestID,
		requestContext.TurnID, requestContext.IdempotencyKey,
		requestContext.Snapshot.Version,
	).Scan(&result.State, &result.ExpiresAt, &result.CreatedAt, &action, &detectedTypesJSON, &detectedCount, &policyDigest)
	if err != nil {
		return admissionRecord{}, err
	}
	result.Safety, err = safetySummaryFromColumns(action, detectedTypesJSON, detectedCount, policyDigest)
	return result, err
}
