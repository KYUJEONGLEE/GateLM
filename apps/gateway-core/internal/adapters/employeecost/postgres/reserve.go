package postgres

import (
	"context"
	"errors"
	"time"

	"gatelm/apps/gateway-core/internal/domain/employeecost"

	"github.com/jackc/pgx/v5"
)

type Store struct{}

func NewStore() *Store { return &Store{} }

type rolloutSnapshot struct {
	Mode                          employeecost.RolloutMode
	ActivationBoundaryAt          *time.Time
	ProjectApplicationCoveredFrom *time.Time
	TenantChatCoveredFrom         *time.Time
	CoverageInvalidatedAt         *time.Time
}

type policySnapshot struct {
	Policy employeecost.Policy
}

type periodRow struct {
	Bounds      employeecost.PeriodBounds
	Confirmed   int64
	Reserved    int64
	Unconfirmed int64
	Version     int64
}

func (s *Store) Reserve(ctx context.Context, tx pgx.Tx, input ReserveInput) (ReserveResult, error) {
	if tx == nil || !validReserveInput(input) {
		return ReserveResult{}, ErrInvalidInput
	}
	if input.EmployeeID == "" {
		return ReserveResult{Decision: DecisionRolloutOff}, nil
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
		"employee-cost:"+string(input.Surface)+":"+input.RequestID); err != nil {
		return ReserveResult{}, err
	}
	if replay, found, err := lockReservationReplay(ctx, tx, input); err != nil {
		return ReserveResult{}, err
	} else if found {
		return replay, nil
	}

	rollout, found, err := lockRollout(ctx, tx, input.TenantID)
	if err != nil {
		return ReserveResult{}, err
	}
	if !found || rollout.Mode == employeecost.RolloutModeOff {
		return ReserveResult{Decision: DecisionRolloutOff}, nil
	}
	policy, err := lockPolicy(ctx, tx, input.TenantID, input.EmployeeID)
	if err != nil {
		return ReserveResult{}, err
	}
	dayBounds, weekBounds, err := periodBounds(input.Now, policy.Policy.PeriodTimezone)
	if err != nil {
		return ReserveResult{}, err
	}

	day, err := ensureAndLockPeriod(ctx, tx, input, policy.Policy.Version, dayBounds)
	if err != nil {
		return ReserveResult{}, err
	}
	week, err := ensureAndLockPeriod(ctx, tx, input, policy.Policy.Version, weekBounds)
	if err != nil {
		return ReserveResult{}, err
	}
	if replay, found, err := lockReservationReplay(ctx, tx, input); err != nil {
		return ReserveResult{}, err
	} else if found {
		return replay, nil
	}
	effectiveMode, err := (employeecost.Rollout{
		Mode:                 rollout.Mode,
		ActivationBoundaryAt: rollout.ActivationBoundaryAt,
	}).EffectiveMode(input.Now)
	if err != nil {
		return ReserveResult{}, ErrInvariantViolation
	}
	coverageComplete := rolloutCovers(rollout, dayBounds, weekBounds)
	if effectiveMode == employeecost.RolloutModeEnforce && policy.Policy.HasEnabledLimit() && !coverageComplete {
		return ReserveResult{
			Applied: true, GuardUnavailable: true, CoverageInvalid: true,
			Decision: DecisionGuardUnavailable,
		}, nil
	}

	reservedCost, err := input.Pricing.EstimatedCostMicroUSD()
	if err != nil {
		return ReserveResult{}, ErrInvalidInput
	}
	balancesAuthoritative := coverageComplete || effectiveMode == employeecost.RolloutModeShadow
	decision, err := employeecost.EvaluateReservation(employeecost.ReservationDecisionInput{
		Rollout: employeecost.Rollout{
			Mode:                 rollout.Mode,
			ActivationBoundaryAt: rollout.ActivationBoundaryAt,
		},
		Now:                    input.Now,
		Policy:                 policy.Policy,
		DailyBalance:           periodBalance(day, balancesAuthoritative),
		WeeklyBalance:          periodBalance(week, balancesAuthoritative),
		CandidateCostClass:     employeecost.ClassifyCandidate(input.Surface, input.CandidateTier),
		AdditionalCostMicroUSD: reservedCost,
	})
	if err != nil {
		return ReserveResult{}, ErrInvariantViolation
	}
	if decision.GuardUnavailable {
		return ReserveResult{
			Applied: true, GuardUnavailable: true, CoverageInvalid: decision.CoverageInvalid,
			Decision: DecisionGuardUnavailable,
		}, nil
	}
	if decision.RestrictHighCost {
		return ReserveResult{
			Applied: true, RestrictHighCost: true, Decision: DecisionHighCostRestricted,
		}, nil
	}
	if !decision.ShouldReserve {
		return ReserveResult{}, ErrInvariantViolation
	}

	if err := persistReserve(ctx, tx, input, policy.Policy, day, week, decision, reservedCost, effectiveMode); err != nil {
		return ReserveResult{}, err
	}
	return ReserveResult{
		Applied:         true,
		Decision:        reserveDecision(effectiveMode),
		ReservationID:   input.ReservationID,
		State:           employeecost.ReservationStateReserved,
		LedgerVersion:   1,
		CoverageInvalid: decision.CoverageInvalid,
		Daily:           periodEvidence(day, decision.Daily.State, 0, reservedCost, 0),
		Weekly:          periodEvidence(week, decision.Weekly.State, 0, reservedCost, 0),
	}, nil
}

func validReserveInput(input ReserveInput) bool {
	if input.TenantID == "" || input.RequestID == "" || input.ReservationID == "" ||
		!input.Surface.Valid() || input.Now.IsZero() ||
		input.Pricing.Validate() != nil {
		return false
	}
	if input.PrimaryAttempt == nil {
		return input.DispatchIntentExpiresAt.IsZero()
	}
	return validAttemptInput(*input.PrimaryAttempt) && input.PrimaryAttempt.AttemptNo == 1 &&
		input.PrimaryAttempt.Kind == employeecost.AttemptKindPrimary &&
		samePricingPin(input.Pricing, input.PrimaryAttempt.Pricing) &&
		!input.DispatchIntentExpiresAt.Before(input.Now)
}

func samePricingPin(left, right employeecost.PricingPin) bool {
	if left.RuleID != right.RuleID || left.Version != right.Version || left.Currency != right.Currency ||
		left.InputMicroUSDPerMillion != right.InputMicroUSDPerMillion ||
		left.OutputMicroUSDPerMillion != right.OutputMicroUSDPerMillion ||
		left.EstimateVersion != right.EstimateVersion ||
		left.EstimatedInputTokens != right.EstimatedInputTokens ||
		left.MaxOutputTokens != right.MaxOutputTokens ||
		(left.CacheReadInputMicroUSDPerMillion == nil) != (right.CacheReadInputMicroUSDPerMillion == nil) {
		return false
	}
	return left.CacheReadInputMicroUSDPerMillion == nil ||
		*left.CacheReadInputMicroUSDPerMillion == *right.CacheReadInputMicroUSDPerMillion
}

func validAttemptInput(input AttemptInput) bool {
	return input.AttemptNo >= 1 && input.AttemptNo <= 4 && input.Kind.Valid() &&
		input.ProviderID != "" && input.ModelKey != "" && input.Pricing.Validate() == nil
}

func lockRollout(ctx context.Context, tx pgx.Tx, tenantID string) (rolloutSnapshot, bool, error) {
	var row rolloutSnapshot
	var mode string
	err := tx.QueryRow(ctx, `
		SELECT mode, activation_boundary_at, project_application_covered_from,
		       tenant_chat_covered_from, coverage_invalidated_at
		FROM tenant_employee_cost_ledger_rollouts
		WHERE tenant_id = $1::uuid
		FOR SHARE
	`, tenantID).Scan(
		&mode, &row.ActivationBoundaryAt, &row.ProjectApplicationCoveredFrom,
		&row.TenantChatCoveredFrom, &row.CoverageInvalidatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return rolloutSnapshot{}, false, nil
	}
	if err != nil {
		return rolloutSnapshot{}, false, err
	}
	row.Mode = employeecost.RolloutMode(mode)
	if !row.Mode.Valid() {
		return rolloutSnapshot{}, false, ErrInvariantViolation
	}
	return row, true, nil
}

func lockPolicy(ctx context.Context, tx pgx.Tx, tenantID, employeeID string) (policySnapshot, error) {
	var policy policySnapshot
	var enforcementMode string
	var dailyLimit, weeklyLimit int64
	err := tx.QueryRow(ctx, `
		SELECT version, currency, period_timezone, daily_enabled,
		       daily_limit_micro_usd, weekly_enabled, weekly_limit_micro_usd,
		       warning_threshold_percent, enforcement_mode
		FROM tenant_employee_cost_policies
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
		FOR SHARE
	`, tenantID, employeeID).Scan(
		&policy.Policy.Version, &policy.Policy.Currency, &policy.Policy.PeriodTimezone,
		&policy.Policy.Daily.Enabled, &dailyLimit, &policy.Policy.Weekly.Enabled,
		&weeklyLimit, &policy.Policy.WarningThresholdPercent, &enforcementMode,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		policy.Policy = employeecost.Policy{
			Configured: false, Version: 0, Currency: employeecost.CurrencyUSD,
			PeriodTimezone:          employeecost.DefaultPeriodTimezone,
			WarningThresholdPercent: 80, EnforcementMode: employeecost.EnforcementModeMonitor,
		}
	} else if err != nil {
		return policySnapshot{}, err
	} else {
		policy.Policy.Configured = true
		policy.Policy.Daily.LimitMicroUSD = dailyLimit
		policy.Policy.Weekly.LimitMicroUSD = weeklyLimit
		policy.Policy.EnforcementMode = employeecost.EnforcementMode(enforcementMode)
	}
	if err := policy.Policy.Validate(); err != nil {
		return policySnapshot{}, ErrInvariantViolation
	}
	return policy, nil
}

func periodBounds(now time.Time, timezone string) (employeecost.PeriodBounds, employeecost.PeriodBounds, error) {
	day, err := employeecost.CalendarBounds(now, employeecost.PeriodKindDay, timezone)
	if err != nil {
		return employeecost.PeriodBounds{}, employeecost.PeriodBounds{}, err
	}
	week, err := employeecost.CalendarBounds(now, employeecost.PeriodKindWeek, timezone)
	return day, week, err
}

func ensureAndLockPeriod(
	ctx context.Context,
	tx pgx.Tx,
	input ReserveInput,
	policyVersion int64,
	bounds employeecost.PeriodBounds,
) (periodRow, error) {
	_, err := tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_periods (
		  tenant_id, employee_id, period_kind, period_start, period_end,
		  period_timezone, currency, created_policy_version,
		  last_evaluated_policy_version, state
		) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'USD', $7, $7, 'not_configured')
		ON CONFLICT (tenant_id, employee_id, period_kind, period_start, currency) DO NOTHING
	`, input.TenantID, input.EmployeeID, string(bounds.Kind), bounds.Start, bounds.End,
		bounds.Timezone, policyVersion)
	if err != nil {
		return periodRow{}, err
	}
	row := periodRow{Bounds: bounds}
	var timezone, currency string
	err = tx.QueryRow(ctx, `
		SELECT period_end, period_timezone, currency, confirmed_cost_micro_usd,
		       reserved_cost_micro_usd, unconfirmed_cost_micro_usd, version
		FROM tenant_employee_cost_periods
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
		  AND period_kind = $3 AND period_start = $4 AND currency = 'USD'
		FOR UPDATE
	`, input.TenantID, input.EmployeeID, string(bounds.Kind), bounds.Start).Scan(
		&row.Bounds.End, &timezone, &currency, &row.Confirmed, &row.Reserved,
		&row.Unconfirmed, &row.Version,
	)
	if err != nil || timezone != bounds.Timezone || currency != employeecost.CurrencyUSD ||
		!row.Bounds.End.Equal(bounds.End) {
		return periodRow{}, ErrInvariantViolation
	}
	return row, nil
}

func rolloutCovers(rollout rolloutSnapshot, day, week employeecost.PeriodBounds) bool {
	if rollout.CoverageInvalidatedAt != nil || rollout.ProjectApplicationCoveredFrom == nil ||
		rollout.TenantChatCoveredFrom == nil {
		return false
	}
	for _, start := range []time.Time{day.Start, week.Start} {
		if rollout.ProjectApplicationCoveredFrom.After(start) || rollout.TenantChatCoveredFrom.After(start) {
			return false
		}
	}
	return true
}

func periodBalance(row periodRow, authoritative bool) employeecost.PeriodBalance {
	return employeecost.PeriodBalance{
		Authoritative: authoritative, ConfirmedCostMicroUSD: row.Confirmed,
		ReservedCostMicroUSD: row.Reserved, UnconfirmedCostMicroUSD: row.Unconfirmed,
	}
}

func lockReservationReplay(ctx context.Context, tx pgx.Tx, input ReserveInput) (ReserveResult, bool, error) {
	var reservationID, tenantID, employeeID, state, outcome string
	var pricingRuleID, pricingVersion, estimateVersion string
	var initialReservedCost, ledgerVersion int64
	err := tx.QueryRow(ctx, `
		SELECT reservation_id::text, tenant_id::text, employee_id::text,
		       state, enforcement_outcome, pricing_rule_id, pricing_version,
		       estimate_version,
		       COALESCE((
		         SELECT ledger.reserved_cost_micro_usd_delta
		         FROM tenant_employee_cost_ledger_entries AS ledger
		         WHERE ledger.reservation_id = reservation.reservation_id
		           AND ledger.event_version = 1 AND ledger.event_type = 'reserve'
		       ), 0) AS initial_reserved_cost_micro_usd,
		       ledger_version
		FROM tenant_employee_cost_reservations AS reservation
		WHERE surface = $1 AND request_id = $2
		FOR UPDATE OF reservation
	`, string(input.Surface), input.RequestID).Scan(
		&reservationID, &tenantID, &employeeID, &state, &outcome,
		&pricingRuleID, &pricingVersion, &estimateVersion, &initialReservedCost, &ledgerVersion,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ReserveResult{}, false, nil
	}
	if err != nil {
		return ReserveResult{}, false, err
	}
	if reservationID != input.ReservationID || tenantID != input.TenantID || employeeID != input.EmployeeID {
		return ReserveResult{}, false, ErrIdempotencyConflict
	}
	estimatedCost, err := input.Pricing.EstimatedCostMicroUSD()
	if err != nil || pricingRuleID != input.Pricing.RuleID || pricingVersion != input.Pricing.Version ||
		estimateVersion != input.Pricing.EstimateVersion || initialReservedCost != estimatedCost ||
		(outcome == "restricted_to_lower_cost") != input.RestrictedFromHigh {
		return ReserveResult{}, false, ErrIdempotencyConflict
	}
	reservation := reservationRow{
		ReservationID: reservationID, TenantID: tenantID, EmployeeID: employeeID,
		Surface: input.Surface, RequestID: input.RequestID,
	}
	storedAttempt, hasAttempt, err := lockAttempt(ctx, tx, reservation, 1)
	if err != nil {
		return ReserveResult{}, false, err
	}
	if (input.PrimaryAttempt != nil) != hasAttempt {
		return ReserveResult{}, false, ErrIdempotencyConflict
	}
	if input.PrimaryAttempt != nil &&
		(storedAttempt.Kind != input.PrimaryAttempt.Kind ||
			storedAttempt.ProviderID != input.PrimaryAttempt.ProviderID ||
			storedAttempt.ModelKey != input.PrimaryAttempt.ModelKey ||
			!samePinnedAttempt(storedAttempt, *input.PrimaryAttempt)) {
		return ReserveResult{}, false, ErrIdempotencyConflict
	}
	decision := DecisionReserved
	if outcome == "monitored" {
		decision = DecisionObserved
	}
	return ReserveResult{
		Applied: true, Replayed: true, Decision: decision,
		ReservationID: reservationID, State: employeecost.ReservationState(state),
		LedgerVersion: ledgerVersion,
	}, true, nil
}

func persistReserve(
	ctx context.Context,
	tx pgx.Tx,
	input ReserveInput,
	policy employeecost.Policy,
	day, week periodRow,
	decision employeecost.ReservationDecision,
	reservedCost int64,
	effectiveMode employeecost.RolloutMode,
) error {
	dailyWarning, weeklyWarning := int64(0), int64(0)
	if policy.Daily.Enabled {
		dailyWarning = decision.Daily.WarningAtMicroUSD
	}
	if policy.Weekly.Enabled {
		weeklyWarning = decision.Weekly.WarningAtMicroUSD
	}
	outcome := "allowed"
	switch {
	case !policy.HasEnabledLimit():
		outcome = "not_configured"
	case effectiveMode == employeecost.RolloutModeShadow:
		outcome = "monitored"
	case input.RestrictedFromHigh:
		outcome = "restricted_to_lower_cost"
	}
	var usagePendingAt any
	if input.PrimaryAttempt != nil {
		usagePendingAt = input.DispatchIntentExpiresAt
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_reservations (
		  reservation_id, tenant_id, employee_id, surface, request_id,
		  day_period_start, week_period_start, currency,
		  pinned_policy_version, enforcement_mode,
		  daily_enabled, daily_limit_micro_usd, daily_warning_micro_usd, daily_state,
		  weekly_enabled, weekly_limit_micro_usd, weekly_warning_micro_usd, weekly_state,
		  enforcement_outcome, pricing_rule_id, pricing_version, estimate_version,
		  reserved_cost_micro_usd, usage_pending_at,
		  state, ledger_version, reserved_at, created_at, updated_at
		) VALUES (
		  $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'USD',
		  $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
		  $18, $19, $20, $21, $22, $23, 'reserved', 1, $24, $24, $24
		)
	`, input.ReservationID, input.TenantID, input.EmployeeID, string(input.Surface),
		input.RequestID, day.Bounds.Start, week.Bounds.Start, policy.Version,
		string(policy.EnforcementMode), policy.Daily.Enabled, policy.Daily.LimitMicroUSD,
		dailyWarning, string(decision.Daily.State), policy.Weekly.Enabled,
		policy.Weekly.LimitMicroUSD, weeklyWarning, string(decision.Weekly.State), outcome,
		input.Pricing.RuleID, input.Pricing.Version, input.Pricing.EstimateVersion,
		reservedCost, usagePendingAt, input.Now)
	if err != nil {
		return err
	}
	if input.PrimaryAttempt != nil {
		attemptCost, costErr := input.PrimaryAttempt.Pricing.EstimatedCostMicroUSD()
		if costErr != nil || attemptCost != reservedCost {
			return ErrInvariantViolation
		}
		if err := insertAttempt(ctx, tx, input.TenantID, input.EmployeeID, input.Surface,
			input.RequestID, input.ReservationID, *input.PrimaryAttempt, attemptCost, input.Now); err != nil {
			return err
		}
	}
	if err := updatePeriodBalance(ctx, tx, input.TenantID, input.EmployeeID, day.Bounds,
		reservedCost, 0, 0, decision.Daily.State, policy.Version, input.Now); err != nil {
		return err
	}
	if err := updatePeriodBalance(ctx, tx, input.TenantID, input.EmployeeID, week.Bounds,
		reservedCost, 0, 0, decision.Weekly.State, policy.Version, input.Now); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_ledger_entries (
		  reservation_id, tenant_id, employee_id, surface, request_id,
		  event_version, event_type, reserved_cost_micro_usd_delta, occurred_at
		) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 1, 'reserve', $6, $7)
	`, input.ReservationID, input.TenantID, input.EmployeeID, string(input.Surface),
		input.RequestID, reservedCost, input.Now)
	return err
}

func insertAttempt(
	ctx context.Context,
	tx pgx.Tx,
	tenantID, employeeID string,
	surface employeecost.Surface,
	requestID, reservationID string,
	input AttemptInput,
	reservedCost int64,
	now time.Time,
) error {
	var cacheReadPrice any
	if input.Pricing.CacheReadInputMicroUSDPerMillion != nil {
		cacheReadPrice = *input.Pricing.CacheReadInputMicroUSDPerMillion
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO tenant_employee_cost_provider_attempts (
		  surface, request_id, attempt_no, reservation_id, tenant_id, employee_id,
		  kind, provider_id, model_key, pricing_rule_id, pricing_version,
		  input_micro_usd_per_million_tokens, output_micro_usd_per_million_tokens,
		  cache_read_input_micro_usd_per_million_tokens, estimated_input_tokens,
		  max_output_tokens, reserved_cost_micro_usd, dispatch_state,
		  usage_quality, created_at, updated_at
		) VALUES (
		  $1, $2, $3, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10, $11,
		  $12, $13, $14, $15, $16, $17, 'not_started', 'not_available', $18, $18
		)
	`, string(surface), requestID, input.AttemptNo, reservationID, tenantID, employeeID,
		string(input.Kind), input.ProviderID, input.ModelKey, input.Pricing.RuleID,
		input.Pricing.Version, input.Pricing.InputMicroUSDPerMillion,
		input.Pricing.OutputMicroUSDPerMillion, cacheReadPrice,
		input.Pricing.EstimatedInputTokens, input.Pricing.MaxOutputTokens, reservedCost, now)
	return err
}

func updatePeriodBalance(
	ctx context.Context,
	tx pgx.Tx,
	tenantID, employeeID string,
	bounds employeecost.PeriodBounds,
	reservedDelta, confirmedDelta, unconfirmedDelta int64,
	state employeecost.PeriodState,
	policyVersion int64,
	now time.Time,
) error {
	tag, err := tx.Exec(ctx, `
		UPDATE tenant_employee_cost_periods
		SET reserved_cost_micro_usd = reserved_cost_micro_usd + $5,
		    confirmed_cost_micro_usd = confirmed_cost_micro_usd + $6,
		    unconfirmed_cost_micro_usd = unconfirmed_cost_micro_usd + $7,
		    state = $8,
		    last_evaluated_policy_version = GREATEST(last_evaluated_policy_version, $9),
		    version = version + 1, updated_at = $10
		WHERE tenant_id = $1::uuid AND employee_id = $2::uuid
		  AND period_kind = $3 AND period_start = $4 AND currency = 'USD'
		  AND reserved_cost_micro_usd + $5 >= 0
		  AND confirmed_cost_micro_usd + $6 >= 0
		  AND unconfirmed_cost_micro_usd + $7 >= 0
	`, tenantID, employeeID, string(bounds.Kind), bounds.Start, reservedDelta,
		confirmedDelta, unconfirmedDelta, string(state), policyVersion, now)
	if err != nil || tag.RowsAffected() != 1 {
		return ErrInvariantViolation
	}
	return nil
}

func periodEvidence(row periodRow, state employeecost.PeriodState, confirmedDelta, reservedDelta, unconfirmedDelta int64) PeriodEvidence {
	return PeriodEvidence{
		Kind: row.Bounds.Kind, Start: row.Bounds.Start, End: row.Bounds.End,
		Timezone: row.Bounds.Timezone, State: state,
		ConfirmedCostMicroUSD:   row.Confirmed + confirmedDelta,
		ReservedCostMicroUSD:    row.Reserved + reservedDelta,
		UnconfirmedCostMicroUSD: row.Unconfirmed + unconfirmedDelta,
	}
}

func reserveDecision(mode employeecost.RolloutMode) Decision {
	if mode == employeecost.RolloutModeShadow {
		return DecisionObserved
	}
	return DecisionReserved
}
