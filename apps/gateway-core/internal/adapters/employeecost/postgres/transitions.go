package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeecost"

	"github.com/jackc/pgx/v5"
)

type reservationRow struct {
	ReservationID      string
	TenantID           string
	EmployeeID         string
	Surface            employeecost.Surface
	RequestID          string
	DayStart           time.Time
	WeekStart          time.Time
	PolicyVersion      int64
	EnforcementMode    employeecost.EnforcementMode
	EnforcementOutcome string
	DailyEnabled       bool
	DailyLimit         int64
	DailyWarning       int64
	WeeklyEnabled      bool
	WeeklyLimit        int64
	WeeklyWarning      int64
	PricingRuleID      string
	PricingVersion     string
	EstimateVersion    string
	Reserved           int64
	Confirmed          int64
	Unconfirmed        int64
	State              employeecost.ReservationState
	LedgerVersion      int64
}

type attemptRow struct {
	AttemptNo          int
	Kind               employeecost.AttemptKind
	ProviderID         string
	ModelKey           string
	Pricing            employeecost.PricingPin
	Reserved           int64
	ConfirmedInput     int64
	ConfirmedOutput    int64
	ConfirmedCacheRead int64
	Confirmed          int64
	Unconfirmed        int64
	DispatchState      employeecost.DispatchState
	Outcome            *string
	UsageQuality       employeecost.UsageQuality
}

func (s *Store) StartPrimaryAttempt(
	ctx context.Context,
	tx pgx.Tx,
	input StartPrimaryAttemptInput,
) (TransitionResult, error) {
	if tx == nil || input.TenantID == "" || input.EmployeeID == "" || input.RequestID == "" ||
		input.ReservationID == "" || !input.Surface.Valid() || input.Now.IsZero() ||
		input.DispatchIntentExpiresAt.Before(input.Now) ||
		!validAttemptInput(input.Attempt) || input.Attempt.AttemptNo != 1 ||
		input.Attempt.Kind != employeecost.AttemptKindPrimary {
		return TransitionResult{}, ErrInvalidInput
	}
	reservation, found, err := lockCommonReservation(ctx, tx, input.Surface, input.RequestID)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if !reservation.matches(input.TenantID, input.EmployeeID, input.ReservationID) {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	if reservation.State != employeecost.ReservationStateReserved {
		return TransitionResult{}, ErrInvariantViolation
	}
	if input.Attempt.Pricing.EstimateVersion != reservation.EstimateVersion {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	if existing, found, err := lockAttempt(ctx, tx, reservation, input.Attempt.AttemptNo); err != nil {
		return TransitionResult{}, err
	} else if found {
		if existing.Kind != input.Attempt.Kind || existing.ProviderID != input.Attempt.ProviderID ||
			existing.ModelKey != input.Attempt.ModelKey || !samePinnedAttempt(existing, input.Attempt) {
			return TransitionResult{}, ErrIdempotencyConflict
		}
		if err := markCommonDispatchIntent(ctx, tx, reservation, input.DispatchIntentExpiresAt, input.Now); err != nil {
			return TransitionResult{}, err
		}
		return transitionFromReservation(reservation, true), nil
	}
	cost, err := input.Attempt.Pricing.EstimatedCostMicroUSD()
	if err != nil || cost != reservation.Reserved ||
		input.Attempt.Pricing.RuleID != reservation.PricingRuleID ||
		input.Attempt.Pricing.Version != reservation.PricingVersion ||
		input.Attempt.Pricing.EstimateVersion != reservation.EstimateVersion {
		return TransitionResult{}, ErrInvariantViolation
	}
	if err := insertAttempt(ctx, tx, input.TenantID, input.EmployeeID, input.Surface,
		input.RequestID, input.ReservationID, input.Attempt, cost, input.Now); err != nil {
		return TransitionResult{}, err
	}
	if err := markCommonDispatchIntent(ctx, tx, reservation, input.DispatchIntentExpiresAt, input.Now); err != nil {
		return TransitionResult{}, err
	}
	return transitionFromReservation(reservation, false), nil
}

func (s *Store) TopUpAttempt(ctx context.Context, tx pgx.Tx, input TopUpAttemptInput) (TopUpResult, error) {
	if tx == nil || input.TenantID == "" || input.EmployeeID == "" || input.RequestID == "" ||
		input.ReservationID == "" || !input.Surface.Valid() || input.Now.IsZero() ||
		input.DispatchIntentExpiresAt.Before(input.Now) ||
		input.CandidateTier == "" || !validAttemptInput(input.Attempt) ||
		input.Attempt.Kind != employeecost.AttemptKindFallback {
		return TopUpResult{}, ErrInvalidInput
	}
	reservation, found, err := lockCommonReservation(ctx, tx, input.Surface, input.RequestID)
	if err != nil || !found {
		return TopUpResult{}, err
	}
	if !reservation.matches(input.TenantID, input.EmployeeID, input.ReservationID) {
		return TopUpResult{}, ErrIdempotencyConflict
	}
	if reservation.State != employeecost.ReservationStateReserved {
		return TopUpResult{}, ErrInvariantViolation
	}
	if input.Attempt.Pricing.EstimateVersion != reservation.EstimateVersion {
		return TopUpResult{}, ErrIdempotencyConflict
	}
	if existing, found, err := lockAttempt(ctx, tx, reservation, input.Attempt.AttemptNo); err != nil {
		return TopUpResult{}, err
	} else if found {
		if existing.Kind != input.Attempt.Kind || existing.ProviderID != input.Attempt.ProviderID ||
			existing.ModelKey != input.Attempt.ModelKey ||
			!samePinnedAttempt(existing, input.Attempt) {
			return TopUpResult{}, ErrIdempotencyConflict
		}
		if err := markCommonDispatchIntent(ctx, tx, reservation, input.DispatchIntentExpiresAt, input.Now); err != nil {
			return TopUpResult{}, err
		}
		return TopUpResult{Applied: true, Replayed: true, LedgerVersion: reservation.LedgerVersion}, nil
	}
	day, week, err := lockReservationPeriods(ctx, tx, reservation)
	if err != nil {
		return TopUpResult{}, err
	}
	cost, err := input.Attempt.Pricing.EstimatedCostMicroUSD()
	if err != nil {
		return TopUpResult{}, ErrInvalidInput
	}
	class := employeecost.ClassifyCandidate(input.Surface, input.CandidateTier)
	limitsEnabled := reservation.DailyEnabled || reservation.WeeklyEnabled
	if limitsEnabled && class == employeecost.CandidateCostClassUnknown && reservation.EnforcementOutcome != "monitored" {
		return TopUpResult{Applied: true, GuardUnavailable: true, CoverageInvalid: true}, nil
	}
	if reservation.EnforcementMode == employeecost.EnforcementModeRestrictHighCost &&
		reservation.EnforcementOutcome != "monitored" && class == employeecost.CandidateCostClassHigh &&
		(periodExceeded(day, reservation.DailyEnabled, reservation.DailyLimit, cost) ||
			periodExceeded(week, reservation.WeeklyEnabled, reservation.WeeklyLimit, cost)) {
		return TopUpResult{Applied: true, RestrictHighCost: true}, nil
	}
	if err := insertAttempt(ctx, tx, input.TenantID, input.EmployeeID, input.Surface,
		input.RequestID, input.ReservationID, input.Attempt, cost, input.Now); err != nil {
		return TopUpResult{}, err
	}
	nextVersion := reservation.LedgerVersion + 1
	dailyState := stateForPeriod(day, reservation.DailyEnabled, reservation.DailyLimit, reservation.DailyWarning, cost, 0, 0)
	weeklyState := stateForPeriod(week, reservation.WeeklyEnabled, reservation.WeeklyLimit, reservation.WeeklyWarning, cost, 0, 0)
	if err := updatePeriodBalance(ctx, tx, input.TenantID, input.EmployeeID, day.Bounds,
		cost, 0, 0, dailyState, reservation.PolicyVersion, input.Now); err != nil {
		return TopUpResult{}, err
	}
	if err := updatePeriodBalance(ctx, tx, input.TenantID, input.EmployeeID, week.Bounds,
		cost, 0, 0, weeklyState, reservation.PolicyVersion, input.Now); err != nil {
		return TopUpResult{}, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations
		SET reserved_cost_micro_usd = reserved_cost_micro_usd + $6,
		    daily_state = $7, weekly_state = $8,
		    ledger_version = $9, updated_at = $10
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND employee_id = $3::uuid
		  AND surface = $4 AND request_id = $5 AND state = 'reserved'
		  AND ledger_version = $11
	`, input.ReservationID, input.TenantID, input.EmployeeID, string(input.Surface),
		input.RequestID, cost, string(dailyState), string(weeklyState), nextVersion,
		input.Now, reservation.LedgerVersion)
	if err != nil || tag.RowsAffected() != 1 {
		return TopUpResult{}, ErrInvariantViolation
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_ledger_entries (
		  reservation_id, tenant_id, employee_id, surface, request_id, attempt_no,
		  event_version, event_type, reserved_cost_micro_usd_delta, occurred_at
		) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'top_up', $8, $9)
	`, input.ReservationID, input.TenantID, input.EmployeeID, string(input.Surface),
		input.RequestID, input.Attempt.AttemptNo, nextVersion, cost, input.Now)
	if err != nil {
		return TopUpResult{}, err
	}
	if err := markCommonDispatchIntent(ctx, tx, reservation, input.DispatchIntentExpiresAt, input.Now); err != nil {
		return TopUpResult{}, err
	}
	return TopUpResult{Applied: true, LedgerVersion: nextVersion}, nil
}

func (s *Store) MarkDispatched(ctx context.Context, tx pgx.Tx, ref AttemptRef) (TransitionResult, error) {
	reservation, attempt, found, err := lockTransitionAttempt(ctx, tx, ref)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if reservation.State != employeecost.ReservationStateReserved {
		return TransitionResult{}, ErrInvariantViolation
	}
	if attempt.DispatchState == employeecost.DispatchStateStarted {
		return transitionFromReservation(reservation, true), nil
	}
	if attempt.UsageQuality != employeecost.UsageQualityNotAvailable {
		return TransitionResult{}, ErrInvariantViolation
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_provider_attempts
		SET dispatch_state = 'started', started_at = $4, updated_at = $4
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
		  AND dispatch_state = 'not_started'
	`, string(ref.Surface), ref.RequestID, ref.AttemptNo, ref.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations
		SET usage_pending_at = COALESCE(usage_pending_at, $6), updated_at = $6
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND employee_id = $3::uuid AND surface = $4 AND request_id = $5
		  AND state = 'reserved'
	`, ref.ReservationID, ref.TenantID, ref.EmployeeID,
		string(ref.Surface), ref.RequestID, ref.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	return transitionFromReservation(reservation, false), nil
}

func (s *Store) RecordConfirmedAttempt(
	ctx context.Context,
	tx pgx.Tx,
	input RecordConfirmedAttemptInput,
) (TransitionResult, error) {
	if !input.Outcome.Valid() || input.Usage.InputTokens < 0 || input.Usage.OutputTokens < 0 ||
		input.Usage.CacheReadInputTokens < 0 || input.Usage.CacheReadInputTokens > input.Usage.InputTokens {
		return TransitionResult{}, ErrInvalidInput
	}
	reservation, attempt, found, err := lockTransitionAttempt(ctx, tx, input.AttemptRef)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	cost, err := attempt.Pricing.ConfirmedCostMicroUSD(
		input.Usage.InputTokens, input.Usage.OutputTokens, input.Usage.CacheReadInputTokens,
	)
	if err != nil {
		return TransitionResult{}, ErrInvariantViolation
	}
	if attempt.UsageQuality == employeecost.UsageQualityConfirmed {
		if attempt.ConfirmedInput != input.Usage.InputTokens || attempt.ConfirmedOutput != input.Usage.OutputTokens ||
			attempt.ConfirmedCacheRead != input.Usage.CacheReadInputTokens || attempt.Confirmed != cost ||
			attempt.Outcome == nil || *attempt.Outcome != string(input.Outcome) {
			return TransitionResult{}, ErrIdempotencyConflict
		}
		return transitionFromReservation(reservation, true), nil
	}
	if attempt.UsageQuality != employeecost.UsageQualityNotAvailable {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	if reservation.State != employeecost.ReservationStateReserved {
		return TransitionResult{}, ErrInvariantViolation
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_provider_attempts
		SET confirmed_input_tokens = $4, confirmed_output_tokens = $5,
		    confirmed_cache_read_input_tokens = $6, confirmed_cost_micro_usd = $7,
		    unconfirmed_cost_micro_usd = 0, dispatch_state = 'started',
		    outcome = $8, usage_quality = 'confirmed',
		    started_at = COALESCE(started_at, $9), completed_at = $9,
		    usage_pending_at = NULL, updated_at = $9
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
		  AND usage_quality = 'not_available'
	`, string(input.Surface), input.RequestID, input.AttemptNo,
		input.Usage.InputTokens, input.Usage.OutputTokens, input.Usage.CacheReadInputTokens,
		cost, string(input.Outcome), input.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	if err = refreshReservationPendingMarker(ctx, tx, input.AttemptRef); err != nil {
		return TransitionResult{}, err
	}
	return transitionFromReservation(reservation, false), nil
}

func (s *Store) ConfirmPendingAttempt(
	ctx context.Context,
	tx pgx.Tx,
	input ConfirmPendingAttemptInput,
) (TransitionResult, error) {
	if input.Usage.InputTokens < 0 || input.Usage.OutputTokens < 0 ||
		input.Usage.CacheReadInputTokens < 0 || input.Usage.CacheReadInputTokens > input.Usage.InputTokens {
		return TransitionResult{}, ErrInvalidInput
	}
	reservation, attempt, found, err := lockTransitionAttempt(ctx, tx, input.AttemptRef)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	cost, err := attempt.Pricing.ConfirmedCostMicroUSD(
		input.Usage.InputTokens, input.Usage.OutputTokens, input.Usage.CacheReadInputTokens,
	)
	if err != nil {
		return TransitionResult{}, ErrInvariantViolation
	}
	if attempt.UsageQuality == employeecost.UsageQualityConfirmed {
		if attempt.ConfirmedInput != input.Usage.InputTokens || attempt.ConfirmedOutput != input.Usage.OutputTokens ||
			attempt.ConfirmedCacheRead != input.Usage.CacheReadInputTokens || attempt.Confirmed != cost {
			return TransitionResult{}, ErrIdempotencyConflict
		}
		return transitionFromReservation(reservation, true), nil
	}
	if reservation.State != employeecost.ReservationStateReserved ||
		attempt.UsageQuality != employeecost.UsageQualityPendingUnconfirmed || attempt.Outcome == nil {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_provider_attempts
		SET confirmed_input_tokens = $4, confirmed_output_tokens = $5,
		    confirmed_cache_read_input_tokens = $6, confirmed_cost_micro_usd = $7,
		    unconfirmed_cost_micro_usd = 0, usage_quality = 'confirmed',
		    usage_pending_at = NULL, updated_at = $8
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
		  AND usage_quality = 'pending_unconfirmed'
	`, string(input.Surface), input.RequestID, input.AttemptNo,
		input.Usage.InputTokens, input.Usage.OutputTokens,
		input.Usage.CacheReadInputTokens, cost, input.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations AS reservation
		SET usage_pending_at = CASE WHEN EXISTS (
		      SELECT 1 FROM tenant_employee_cost_provider_attempts AS attempt
		      WHERE attempt.reservation_id = reservation.reservation_id
		        AND attempt.surface = reservation.surface
		        AND attempt.request_id = reservation.request_id
		        AND attempt.usage_quality IN ('pending_unconfirmed', 'not_available')
		    ) THEN COALESCE(reservation.usage_pending_at, $6) ELSE NULL END,
		    updated_at = $6
		WHERE reservation.reservation_id = $1::uuid
		  AND reservation.tenant_id = $2::uuid
		  AND reservation.employee_id = $3::uuid
		  AND reservation.surface = $4 AND reservation.request_id = $5
		  AND reservation.state = 'reserved'
	`, input.ReservationID, input.TenantID, input.EmployeeID,
		string(input.Surface), input.RequestID, input.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	return transitionFromReservation(reservation, false), nil
}

func refreshReservationPendingMarker(ctx context.Context, tx pgx.Tx, ref AttemptRef) error {
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations AS reservation
		SET usage_pending_at = CASE WHEN EXISTS (
		      SELECT 1 FROM tenant_employee_cost_provider_attempts AS attempt
		      WHERE attempt.reservation_id = reservation.reservation_id
		        AND attempt.surface = reservation.surface
		        AND attempt.request_id = reservation.request_id
		        AND attempt.usage_quality IN ('pending_unconfirmed', 'not_available')
		    ) THEN COALESCE(reservation.usage_pending_at, $6) ELSE NULL END,
		    updated_at = $6
		WHERE reservation.reservation_id = $1::uuid
		  AND reservation.tenant_id = $2::uuid
		  AND reservation.employee_id = $3::uuid
		  AND reservation.surface = $4 AND reservation.request_id = $5
		  AND reservation.state = 'reserved'
	`, ref.ReservationID, ref.TenantID, ref.EmployeeID,
		string(ref.Surface), ref.RequestID, ref.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return ErrInvariantViolation
	}
	return nil
}

func markCommonDispatchIntent(
	ctx context.Context,
	tx pgx.Tx,
	reservation reservationRow,
	expiresAt time.Time,
	now time.Time,
) error {
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations
		SET usage_pending_at = COALESCE(usage_pending_at, $6), updated_at = $7
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND employee_id = $3::uuid AND surface = $4 AND request_id = $5
		  AND state = 'reserved'
	`, reservation.ReservationID, reservation.TenantID, reservation.EmployeeID,
		string(reservation.Surface), reservation.RequestID, expiresAt, now)
	if err != nil || tag.RowsAffected() != 1 {
		return ErrInvariantViolation
	}
	return nil
}

func (s *Store) RecordPreCallFailure(
	ctx context.Context,
	tx pgx.Tx,
	ref AttemptRef,
) (TransitionResult, error) {
	reservation, attempt, found, err := lockTransitionAttempt(ctx, tx, ref)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if attempt.UsageQuality == employeecost.UsageQualityConfirmed {
		if attempt.ConfirmedInput != 0 || attempt.ConfirmedOutput != 0 ||
			attempt.ConfirmedCacheRead != 0 || attempt.Confirmed != 0 ||
			attempt.Outcome == nil || *attempt.Outcome != string(employeecost.AttemptOutcomeFailedPreDelta) {
			return TransitionResult{}, ErrIdempotencyConflict
		}
		return transitionFromReservation(reservation, true), nil
	}
	if reservation.State != employeecost.ReservationStateReserved ||
		attempt.UsageQuality != employeecost.UsageQualityNotAvailable ||
		attempt.DispatchState != employeecost.DispatchStateNotStarted {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_provider_attempts
		SET confirmed_input_tokens = 0, confirmed_output_tokens = 0,
		    confirmed_cache_read_input_tokens = 0, confirmed_cost_micro_usd = 0,
		    unconfirmed_cost_micro_usd = 0, outcome = 'failed_pre_delta',
		    usage_quality = 'confirmed', completed_at = $4,
		    usage_pending_at = NULL, updated_at = $4
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
		  AND dispatch_state = 'not_started' AND usage_quality = 'not_available'
	`, string(ref.Surface), ref.RequestID, ref.AttemptNo, ref.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	return transitionFromReservation(reservation, false), nil
}

func (s *Store) MarkPending(ctx context.Context, tx pgx.Tx, input MarkPendingInput) (TransitionResult, error) {
	if !input.Outcome.Valid() {
		return TransitionResult{}, ErrInvalidInput
	}
	reservation, attempt, found, err := lockTransitionAttempt(ctx, tx, input.AttemptRef)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if attempt.UsageQuality == employeecost.UsageQualityPendingUnconfirmed {
		if attempt.Outcome == nil || *attempt.Outcome != string(input.Outcome) {
			return TransitionResult{}, ErrIdempotencyConflict
		}
		return transitionFromReservation(reservation, true), nil
	}
	if attempt.UsageQuality != employeecost.UsageQualityNotAvailable || reservation.State != employeecost.ReservationStateReserved {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_provider_attempts
		SET dispatch_state = 'started', started_at = COALESCE(started_at, $4),
		    outcome = $5, usage_quality = 'pending_unconfirmed',
		    usage_pending_at = $4, completed_at = $4, updated_at = $4
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
	`, string(input.Surface), input.RequestID, input.AttemptNo, input.Now, string(input.Outcome))
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	tag, err = tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations
		SET usage_pending_at = $4, updated_at = $4
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid
		  AND employee_id = $3::uuid AND state = 'reserved'
	`, input.ReservationID, input.TenantID, input.EmployeeID, input.Now)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	return transitionFromReservation(reservation, false), nil
}

func (s *Store) Settle(ctx context.Context, tx pgx.Tx, input SettleInput) (TransitionResult, error) {
	reservation, found, err := lockCommonReservation(ctx, tx, input.Surface, input.RequestID)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if !reservation.matches(input.TenantID, input.EmployeeID, input.ReservationID) {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	if reservation.State == employeecost.ReservationStateSettled {
		return transitionFromReservation(reservation, true), nil
	}
	if reservation.State != employeecost.ReservationStateReserved ||
		(input.ExpectedLedgerVersion > 0 && reservation.LedgerVersion != input.ExpectedLedgerVersion) {
		return TransitionResult{}, ErrInvariantViolation
	}
	attempts, err := lockAttempts(ctx, tx, reservation)
	if err != nil || len(attempts) == 0 {
		return TransitionResult{}, ErrInvariantViolation
	}
	confirmed := int64(0)
	for _, attempt := range attempts {
		if attempt.UsageQuality != employeecost.UsageQualityConfirmed {
			return TransitionResult{}, ErrInvariantViolation
		}
		confirmed += attempt.Confirmed
	}
	return s.finishReservation(ctx, tx, reservation, input.AttemptNo, "settle",
		-reservation.Reserved, confirmed, 0, employeecost.ReservationStateSettled, input.Now)
}

func (s *Store) Release(ctx context.Context, tx pgx.Tx, input ReleaseInput) (TransitionResult, error) {
	reservation, found, err := lockCommonReservation(ctx, tx, input.Surface, input.RequestID)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if !reservation.matches(input.TenantID, input.EmployeeID, input.ReservationID) {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	if reservation.State == employeecost.ReservationStateReleased {
		return transitionFromReservation(reservation, true), nil
	}
	if reservation.State != employeecost.ReservationStateReserved ||
		(input.ExpectedLedgerVersion > 0 && reservation.LedgerVersion != input.ExpectedLedgerVersion) {
		return TransitionResult{}, ErrInvariantViolation
	}
	if input.AttemptNo != nil {
		attempt, found, err := lockAttempt(ctx, tx, reservation, *input.AttemptNo)
		if err != nil || !found {
			return TransitionResult{}, ErrInvariantViolation
		}
		if attempt.UsageQuality == employeecost.UsageQualityNotAvailable {
			if attempt.DispatchState != employeecost.DispatchStateNotStarted {
				return TransitionResult{}, ErrInvariantViolation
			}
			tag, updateErr := tx.Exec(ctx, `
				UPDATE tenant_employee_cost_provider_attempts
				SET outcome = 'failed_pre_delta', usage_quality = 'confirmed',
				    completed_at = $4, usage_pending_at = NULL, updated_at = $4
				WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
				  AND dispatch_state = 'not_started' AND usage_quality = 'not_available'
			`, string(input.Surface), input.RequestID, *input.AttemptNo, input.Now)
			if updateErr != nil || tag.RowsAffected() != 1 {
				return TransitionResult{}, ErrInvariantViolation
			}
		}
	}
	attempts, err := lockAttempts(ctx, tx, reservation)
	if err != nil {
		return TransitionResult{}, err
	}
	for _, attempt := range attempts {
		if attempt.UsageQuality != employeecost.UsageQualityConfirmed ||
			attempt.Outcome == nil || attempt.ConfirmedInput != 0 ||
			attempt.ConfirmedOutput != 0 || attempt.ConfirmedCacheRead != 0 ||
			attempt.Confirmed != 0 || attempt.Unconfirmed != 0 {
			return TransitionResult{}, ErrInvariantViolation
		}
		if attempt.DispatchState == employeecost.DispatchStateNotStarted &&
			*attempt.Outcome != string(employeecost.AttemptOutcomeFailedPreDelta) {
			return TransitionResult{}, ErrInvariantViolation
		}
	}
	return s.finishReservation(ctx, tx, reservation, valueOrZero(input.AttemptNo), "release",
		-reservation.Reserved, 0, 0, employeecost.ReservationStateReleased, input.Now)
}

func (s *Store) ReconcileToUnconfirmed(
	ctx context.Context,
	tx pgx.Tx,
	input ReconcileInput,
) (TransitionResult, error) {
	reservation, found, err := lockCommonReservation(ctx, tx, input.Surface, input.RequestID)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	if !reservation.matches(input.TenantID, input.EmployeeID, input.ReservationID) {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	if reservation.State == employeecost.ReservationStateUnconfirmed || reservation.State == employeecost.ReservationStateSettled {
		return transitionFromReservation(reservation, true), nil
	}
	if reservation.State != employeecost.ReservationStateReserved ||
		(input.ExpectedLedgerVersion > 0 && reservation.LedgerVersion != input.ExpectedLedgerVersion) {
		return TransitionResult{}, ErrInvariantViolation
	}
	attempts, err := lockAttempts(ctx, tx, reservation)
	if err != nil || len(attempts) == 0 {
		return TransitionResult{}, ErrInvariantViolation
	}
	confirmed, unconfirmed, eventAttempt := int64(0), int64(0), 0
	hasPending := false
	for _, attempt := range attempts {
		eventAttempt = attempt.AttemptNo
		switch attempt.UsageQuality {
		case employeecost.UsageQualityConfirmed:
			confirmed += attempt.Confirmed
		case employeecost.UsageQualityPendingUnconfirmed:
			hasPending = true
			unconfirmed += attempt.Reserved
			_, err = tx.Exec(ctx, `
				UPDATE tenant_employee_cost_provider_attempts
				SET unconfirmed_cost_micro_usd = reserved_cost_micro_usd, updated_at = $4
				WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
			`, string(input.Surface), input.RequestID, attempt.AttemptNo, input.Now)
			if err != nil {
				return TransitionResult{}, err
			}
		default:
			return TransitionResult{}, ErrInvariantViolation
		}
	}
	state := employeecost.ReservationStateSettled
	eventType := "settle"
	if hasPending {
		state = employeecost.ReservationStateUnconfirmed
		eventType = "unconfirmed"
	}
	return s.finishReservation(ctx, tx, reservation, eventAttempt, eventType,
		-reservation.Reserved, confirmed, unconfirmed, state, input.Now)
}

func (s *Store) ApplyLateReceipt(
	ctx context.Context,
	tx pgx.Tx,
	input LateReceiptInput,
) (TransitionResult, error) {
	if input.Usage.InputTokens < 0 || input.Usage.OutputTokens < 0 ||
		input.Usage.CacheReadInputTokens < 0 || input.Usage.CacheReadInputTokens > input.Usage.InputTokens {
		return TransitionResult{}, ErrInvalidInput
	}
	reservation, attempt, found, err := lockTransitionAttempt(ctx, tx, input.AttemptRef)
	if err != nil || !found {
		return TransitionResult{}, err
	}
	cost, err := attempt.Pricing.ConfirmedCostMicroUSD(
		input.Usage.InputTokens, input.Usage.OutputTokens, input.Usage.CacheReadInputTokens,
	)
	if err != nil {
		return TransitionResult{}, ErrInvariantViolation
	}
	if attempt.UsageQuality == employeecost.UsageQualityConfirmed {
		if attempt.ConfirmedInput != input.Usage.InputTokens || attempt.ConfirmedOutput != input.Usage.OutputTokens ||
			attempt.ConfirmedCacheRead != input.Usage.CacheReadInputTokens || attempt.Confirmed != cost {
			return TransitionResult{}, ErrIdempotencyConflict
		}
		return transitionFromReservation(reservation, true), nil
	}
	if reservation.State != employeecost.ReservationStateUnconfirmed ||
		attempt.UsageQuality != employeecost.UsageQualityPendingUnconfirmed || attempt.Unconfirmed < 0 ||
		(input.ExpectedLedgerVersion > 0 && reservation.LedgerVersion != input.ExpectedLedgerVersion) {
		return TransitionResult{}, ErrIdempotencyConflict
	}
	day, week, err := lockReservationPeriods(ctx, tx, reservation)
	if err != nil {
		return TransitionResult{}, err
	}
	dailyState := stateForPeriod(day, reservation.DailyEnabled, reservation.DailyLimit,
		reservation.DailyWarning, 0, cost, -attempt.Unconfirmed)
	weeklyState := stateForPeriod(week, reservation.WeeklyEnabled, reservation.WeeklyLimit,
		reservation.WeeklyWarning, 0, cost, -attempt.Unconfirmed)
	if err := updatePeriodBalance(ctx, tx, reservation.TenantID, reservation.EmployeeID, day.Bounds,
		0, cost, -attempt.Unconfirmed, dailyState, reservation.PolicyVersion, input.Now); err != nil {
		return TransitionResult{}, err
	}
	if err := updatePeriodBalance(ctx, tx, reservation.TenantID, reservation.EmployeeID, week.Bounds,
		0, cost, -attempt.Unconfirmed, weeklyState, reservation.PolicyVersion, input.Now); err != nil {
		return TransitionResult{}, err
	}
	newUnconfirmed := reservation.Unconfirmed - attempt.Unconfirmed
	var hasRemainingPending bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1
		  FROM tenant_employee_cost_provider_attempts
		  WHERE reservation_id = $1::uuid AND surface = $2 AND request_id = $3
		    AND attempt_no <> $4 AND usage_quality = 'pending_unconfirmed'
		)
	`, reservation.ReservationID, string(reservation.Surface),
		reservation.RequestID, input.AttemptNo).Scan(&hasRemainingPending); err != nil {
		return TransitionResult{}, err
	}
	state := employeecost.ReservationStateUnconfirmed
	if newUnconfirmed == 0 && !hasRemainingPending {
		state = employeecost.ReservationStateSettled
	}
	nextVersion := reservation.LedgerVersion + 1
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations
		SET state = $6, confirmed_cost_micro_usd = confirmed_cost_micro_usd + $7,
		    unconfirmed_cost_micro_usd = unconfirmed_cost_micro_usd - $8,
		    daily_state = $9, weekly_state = $10,
		    ledger_version = $11, terminal_at = $12, updated_at = $12
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND employee_id = $3::uuid
		  AND surface = $4 AND request_id = $5 AND state = 'unconfirmed'
		  AND ledger_version = $13 AND unconfirmed_cost_micro_usd >= $8
	`, reservation.ReservationID, reservation.TenantID, reservation.EmployeeID,
		string(reservation.Surface), reservation.RequestID, string(state), cost,
		attempt.Unconfirmed, string(dailyState), string(weeklyState), nextVersion,
		input.Now, reservation.LedgerVersion)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	_, err = tx.Exec(ctx, `
		UPDATE tenant_employee_cost_provider_attempts
		SET confirmed_input_tokens = $4, confirmed_output_tokens = $5,
		    confirmed_cache_read_input_tokens = $6, confirmed_cost_micro_usd = $7,
		    unconfirmed_cost_micro_usd = 0, usage_quality = 'confirmed',
		    usage_pending_at = NULL, updated_at = $8
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
	`, string(input.Surface), input.RequestID, input.AttemptNo, input.Usage.InputTokens,
		input.Usage.OutputTokens, input.Usage.CacheReadInputTokens, cost, input.Now)
	if err != nil {
		return TransitionResult{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_ledger_entries (
		  reservation_id, tenant_id, employee_id, surface, request_id, attempt_no,
		  event_version, event_type, confirmed_cost_micro_usd_delta,
		  unconfirmed_cost_micro_usd_delta, occurred_at
		) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
		  'late_correction', $8, $9, $10)
	`, reservation.ReservationID, reservation.TenantID, reservation.EmployeeID,
		string(reservation.Surface), reservation.RequestID, input.AttemptNo,
		nextVersion, cost, -attempt.Unconfirmed, input.Now)
	if err != nil {
		return TransitionResult{}, err
	}
	reservation.State = state
	reservation.Confirmed += cost
	reservation.Unconfirmed = newUnconfirmed
	reservation.LedgerVersion = nextVersion
	return transitionFromReservation(reservation, false), nil
}

func (s *Store) finishReservation(
	ctx context.Context,
	tx pgx.Tx,
	reservation reservationRow,
	attemptNo int,
	eventType string,
	reservedDelta, confirmedDelta, unconfirmedDelta int64,
	state employeecost.ReservationState,
	now time.Time,
) (TransitionResult, error) {
	day, week, err := lockReservationPeriods(ctx, tx, reservation)
	if err != nil {
		return TransitionResult{}, err
	}
	dailyState := stateForPeriod(day, reservation.DailyEnabled, reservation.DailyLimit,
		reservation.DailyWarning, reservedDelta, confirmedDelta, unconfirmedDelta)
	weeklyState := stateForPeriod(week, reservation.WeeklyEnabled, reservation.WeeklyLimit,
		reservation.WeeklyWarning, reservedDelta, confirmedDelta, unconfirmedDelta)
	if err := updatePeriodBalance(ctx, tx, reservation.TenantID, reservation.EmployeeID, day.Bounds,
		reservedDelta, confirmedDelta, unconfirmedDelta, dailyState, reservation.PolicyVersion, now); err != nil {
		return TransitionResult{}, err
	}
	if err := updatePeriodBalance(ctx, tx, reservation.TenantID, reservation.EmployeeID, week.Bounds,
		reservedDelta, confirmedDelta, unconfirmedDelta, weeklyState, reservation.PolicyVersion, now); err != nil {
		return TransitionResult{}, err
	}
	nextVersion := reservation.LedgerVersion + 1
	terminalAt := any(now)
	if state == employeecost.ReservationStateReserved {
		terminalAt = nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_reservations
		SET state = $6, reserved_cost_micro_usd = reserved_cost_micro_usd + $7,
		    confirmed_cost_micro_usd = confirmed_cost_micro_usd + $8,
		    unconfirmed_cost_micro_usd = unconfirmed_cost_micro_usd + $9,
		    daily_state = $10, weekly_state = $11, ledger_version = $12,
		    usage_pending_at = NULL, terminal_at = $13, updated_at = $14
		WHERE reservation_id = $1::uuid AND tenant_id = $2::uuid AND employee_id = $3::uuid
		  AND surface = $4 AND request_id = $5 AND state = 'reserved'
		  AND ledger_version = $15
		  AND reserved_cost_micro_usd + $7 >= 0
		  AND confirmed_cost_micro_usd + $8 >= 0
		  AND unconfirmed_cost_micro_usd + $9 >= 0
	`, reservation.ReservationID, reservation.TenantID, reservation.EmployeeID,
		string(reservation.Surface), reservation.RequestID, string(state), reservedDelta,
		confirmedDelta, unconfirmedDelta, string(dailyState), string(weeklyState),
		nextVersion, terminalAt, now, reservation.LedgerVersion)
	if err != nil || tag.RowsAffected() != 1 {
		return TransitionResult{}, ErrInvariantViolation
	}
	var ledgerAttempt any
	if attemptNo > 0 {
		ledgerAttempt = attemptNo
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_ledger_entries (
		  reservation_id, tenant_id, employee_id, surface, request_id, attempt_no,
		  event_version, event_type, reserved_cost_micro_usd_delta,
		  confirmed_cost_micro_usd_delta, unconfirmed_cost_micro_usd_delta, occurred_at
		) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, reservation.ReservationID, reservation.TenantID, reservation.EmployeeID,
		string(reservation.Surface), reservation.RequestID, ledgerAttempt, nextVersion,
		eventType, reservedDelta, confirmedDelta, unconfirmedDelta, now)
	if err != nil {
		return TransitionResult{}, err
	}
	reservation.State = state
	reservation.Reserved += reservedDelta
	reservation.Confirmed += confirmedDelta
	reservation.Unconfirmed += unconfirmedDelta
	reservation.LedgerVersion = nextVersion
	return transitionFromReservation(reservation, false), nil
}

func lockCommonReservation(
	ctx context.Context,
	tx pgx.Tx,
	surface employeecost.Surface,
	requestID string,
) (reservationRow, bool, error) {
	var row reservationRow
	var surfaceValue, mode, state string
	err := tx.QueryRow(ctx, `
		SELECT reservation_id::text, tenant_id::text, employee_id::text, surface, request_id,
		       day_period_start, week_period_start, pinned_policy_version,
		       enforcement_mode, enforcement_outcome,
		       daily_enabled, daily_limit_micro_usd, daily_warning_micro_usd,
		       weekly_enabled, weekly_limit_micro_usd, weekly_warning_micro_usd,
		       pricing_rule_id, pricing_version, estimate_version,
		       reserved_cost_micro_usd, confirmed_cost_micro_usd,
		       unconfirmed_cost_micro_usd, state, ledger_version
		FROM tenant_employee_cost_reservations
		WHERE surface = $1 AND request_id = $2
		FOR UPDATE
	`, string(surface), requestID).Scan(
		&row.ReservationID, &row.TenantID, &row.EmployeeID, &surfaceValue, &row.RequestID,
		&row.DayStart, &row.WeekStart, &row.PolicyVersion, &mode, &row.EnforcementOutcome,
		&row.DailyEnabled, &row.DailyLimit, &row.DailyWarning,
		&row.WeeklyEnabled, &row.WeeklyLimit, &row.WeeklyWarning,
		&row.PricingRuleID, &row.PricingVersion, &row.EstimateVersion,
		&row.Reserved, &row.Confirmed, &row.Unconfirmed, &state, &row.LedgerVersion,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return reservationRow{}, false, nil
	}
	if err != nil {
		return reservationRow{}, false, err
	}
	row.Surface = employeecost.Surface(surfaceValue)
	row.EnforcementMode = employeecost.EnforcementMode(mode)
	row.State = employeecost.ReservationState(state)
	return row, true, nil
}

func (row reservationRow) matches(tenantID, employeeID, reservationID string) bool {
	return row.TenantID == tenantID && row.EmployeeID == employeeID && row.ReservationID == reservationID
}

func lockReservationPeriods(ctx context.Context, tx pgx.Tx, reservation reservationRow) (periodRow, periodRow, error) {
	day, err := lockExistingPeriod(ctx, tx, reservation, employeecost.PeriodKindDay, reservation.DayStart)
	if err != nil {
		return periodRow{}, periodRow{}, err
	}
	week, err := lockExistingPeriod(ctx, tx, reservation, employeecost.PeriodKindWeek, reservation.WeekStart)
	return day, week, err
}

func lockExistingPeriod(
	ctx context.Context,
	tx pgx.Tx,
	reservation reservationRow,
	kind employeecost.PeriodKind,
	start time.Time,
) (periodRow, error) {
	row := periodRow{Bounds: employeecost.PeriodBounds{Kind: kind, Start: start}}
	err := tx.QueryRow(ctx, `
		SELECT period_end, period_timezone, confirmed_cost_micro_usd,
		       reserved_cost_micro_usd, unconfirmed_cost_micro_usd, version
		FROM tenant_employee_cost_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
		  AND period_kind = $3 AND period_start = $4 AND currency = 'USD'
		FOR UPDATE
	`, reservation.TenantID, reservation.EmployeeID, string(kind), start).Scan(
		&row.Bounds.End, &row.Bounds.Timezone, &row.Confirmed, &row.Reserved,
		&row.Unconfirmed, &row.Version,
	)
	return row, err
}

func lockTransitionAttempt(ctx context.Context, tx pgx.Tx, ref AttemptRef) (reservationRow, attemptRow, bool, error) {
	if tx == nil || ref.TenantID == "" || ref.EmployeeID == "" || ref.RequestID == "" ||
		ref.ReservationID == "" || !ref.Surface.Valid() || ref.AttemptNo < 1 || ref.AttemptNo > 4 || ref.Now.IsZero() {
		return reservationRow{}, attemptRow{}, false, ErrInvalidInput
	}
	reservation, found, err := lockCommonReservation(ctx, tx, ref.Surface, ref.RequestID)
	if err != nil || !found {
		return reservationRow{}, attemptRow{}, false, err
	}
	if !reservation.matches(ref.TenantID, ref.EmployeeID, ref.ReservationID) {
		return reservationRow{}, attemptRow{}, false, ErrIdempotencyConflict
	}
	attempt, found, err := lockAttempt(ctx, tx, reservation, ref.AttemptNo)
	if err == nil && !found {
		return reservationRow{}, attemptRow{}, false, ErrInvariantViolation
	}
	return reservation, attempt, found, err
}

func lockAttempt(ctx context.Context, tx pgx.Tx, reservation reservationRow, attemptNo int) (attemptRow, bool, error) {
	var row attemptRow
	var kind, dispatch, quality string
	var outcome *string
	var cachePrice *int64
	err := tx.QueryRow(ctx, `
		SELECT attempt_no, kind, provider_id, model_key, pricing_rule_id, pricing_version,
		       input_micro_usd_per_million_tokens, output_micro_usd_per_million_tokens,
		       cache_read_input_micro_usd_per_million_tokens, estimated_input_tokens,
		       max_output_tokens, reserved_cost_micro_usd, confirmed_input_tokens,
		       confirmed_output_tokens, confirmed_cache_read_input_tokens,
		       confirmed_cost_micro_usd, unconfirmed_cost_micro_usd,
		       dispatch_state, outcome, usage_quality
		FROM tenant_employee_cost_provider_attempts
		WHERE surface = $1 AND request_id = $2 AND attempt_no = $3
		  AND reservation_id = $4::uuid AND tenant_id = $5::uuid AND employee_id = $6::uuid
		FOR UPDATE
	`, string(reservation.Surface), reservation.RequestID, attemptNo, reservation.ReservationID,
		reservation.TenantID, reservation.EmployeeID).Scan(
		&row.AttemptNo, &kind, &row.ProviderID, &row.ModelKey, &row.Pricing.RuleID,
		&row.Pricing.Version, &row.Pricing.InputMicroUSDPerMillion,
		&row.Pricing.OutputMicroUSDPerMillion, &cachePrice,
		&row.Pricing.EstimatedInputTokens, &row.Pricing.MaxOutputTokens, &row.Reserved,
		&row.ConfirmedInput, &row.ConfirmedOutput, &row.ConfirmedCacheRead,
		&row.Confirmed, &row.Unconfirmed, &dispatch, &outcome, &quality,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return attemptRow{}, false, nil
	}
	if err != nil {
		return attemptRow{}, false, err
	}
	row.Kind = employeecost.AttemptKind(kind)
	row.DispatchState = employeecost.DispatchState(dispatch)
	row.UsageQuality = employeecost.UsageQuality(quality)
	row.Outcome = outcome
	row.Pricing.Currency = employeecost.CurrencyUSD
	row.Pricing.EstimateVersion = "stored"
	row.Pricing.CacheReadInputMicroUSDPerMillion = cachePrice
	return row, true, nil
}

func lockAttempts(ctx context.Context, tx pgx.Tx, reservation reservationRow) ([]attemptRow, error) {
	rows, err := tx.Query(ctx, `
		SELECT attempt_no
		FROM tenant_employee_cost_provider_attempts
		WHERE surface = $1 AND request_id = $2 AND reservation_id = $3::uuid
		ORDER BY attempt_no
		FOR UPDATE
	`, string(reservation.Surface), reservation.RequestID, reservation.ReservationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	numbers := make([]int, 0, 4)
	for rows.Next() {
		var number int
		if err := rows.Scan(&number); err != nil {
			return nil, err
		}
		numbers = append(numbers, number)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make([]attemptRow, 0, len(numbers))
	for _, number := range numbers {
		attempt, found, err := lockAttempt(ctx, tx, reservation, number)
		if err != nil || !found {
			return nil, ErrInvariantViolation
		}
		result = append(result, attempt)
	}
	return result, nil
}

func stateForPeriod(row periodRow, enabled bool, limit, warning, reservedDelta, confirmedDelta, unconfirmedDelta int64) employeecost.PeriodState {
	if !enabled {
		return employeecost.PeriodStateNotConfigured
	}
	exposure := row.Confirmed + confirmedDelta + row.Reserved + reservedDelta + row.Unconfirmed + unconfirmedDelta
	switch {
	case exposure >= limit:
		return employeecost.PeriodStateExceeded
	case exposure >= warning:
		return employeecost.PeriodStateWarning
	default:
		return employeecost.PeriodStateNormal
	}
}

func periodExceeded(row periodRow, enabled bool, limit, additional int64) bool {
	return enabled && row.Confirmed+row.Reserved+row.Unconfirmed+additional >= limit
}

func samePinnedAttempt(existing attemptRow, input AttemptInput) bool {
	if existing.Pricing.RuleID != input.Pricing.RuleID ||
		existing.Pricing.Version != input.Pricing.Version ||
		existing.Pricing.InputMicroUSDPerMillion != input.Pricing.InputMicroUSDPerMillion ||
		existing.Pricing.OutputMicroUSDPerMillion != input.Pricing.OutputMicroUSDPerMillion ||
		existing.Pricing.EstimatedInputTokens != input.Pricing.EstimatedInputTokens ||
		existing.Pricing.MaxOutputTokens != input.Pricing.MaxOutputTokens {
		return false
	}
	if (existing.Pricing.CacheReadInputMicroUSDPerMillion == nil) !=
		(input.Pricing.CacheReadInputMicroUSDPerMillion == nil) {
		return false
	}
	if existing.Pricing.CacheReadInputMicroUSDPerMillion != nil &&
		*existing.Pricing.CacheReadInputMicroUSDPerMillion != *input.Pricing.CacheReadInputMicroUSDPerMillion {
		return false
	}
	cost, err := input.Pricing.EstimatedCostMicroUSD()
	return err == nil && existing.Reserved == cost
}

func transitionFromReservation(row reservationRow, replayed bool) TransitionResult {
	return TransitionResult{
		Applied: true, Replayed: replayed, ReservationID: row.ReservationID,
		State: row.State, LedgerVersion: row.LedgerVersion,
		ConfirmedCostMicroUSD: row.Confirmed, ReservedCostMicroUSD: row.Reserved,
		UnconfirmedCostMicroUSD: row.Unconfirmed,
	}
}

func valueOrZero(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}
